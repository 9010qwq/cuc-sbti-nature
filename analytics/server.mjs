import http from "node:http";
import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  scryptSync,
} from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openStore, exact, UUID } from "./store.mjs";
const dir = dirname(fileURLToPath(import.meta.url));
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(a, b);
export function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
export function createAnalyticsServer({
  store,
  origins,
  adminHash,
  publicOrigin,
  mode = "production",
  now = () => Date.now(),
  trustProxy = false,
}) {
  if (
    !origins?.length ||
    origins.some((o) => {
      try {
        return new URL(o).origin !== o;
      } catch {
        return true;
      }
    })
  )
    throw Error("Exact allowed origins required");
  if (!/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(adminHash || ""))
    throw Error("Admin scrypt hash required");
  if (
    !publicOrigin ||
    new URL(publicOrigin).origin !== publicOrigin ||
    (mode === "production" && !publicOrigin.startsWith("https://"))
  )
    throw Error("Production public origin must use HTTPS");
  const secret = randomBytes(32),
    buckets = new Map();
  function rate(key, limit) {
    const stamp = Math.floor(now() / 60000),
      old = buckets.get(key);
    const b = old?.stamp === stamp ? old : { stamp, n: 0 };
    buckets.set(key, b);
    return ++b.n <= limit;
  }
  const cleaner = setInterval(() => {
    for (const [k, b] of buckets)
      if (b.stamp < Math.floor(now() / 60000) - 1) buckets.delete(k);
    store.prune();
  }, 60000);
  cleaner.unref();
  const sign = (s) =>
    createHmac("sha256", secret).update(s).digest("base64url");
  function mint(i) {
    const b = Buffer.from(
      JSON.stringify({ ...i, exp: now() + 3600000 }),
    ).toString("base64url");
    return b + "." + sign(b);
  }
  function identity(token) {
    if (typeof token !== "string" || token.length > 1000) return null;
    const [b, s] = token.split(".");
    if (!s || !safeEqual(Buffer.from(s), Buffer.from(sign(b)))) return null;
    try {
      const i = JSON.parse(Buffer.from(b, "base64url").toString());
      return i.exp > now() ? i : null;
    } catch {
      return null;
    }
  }
  async function body(req) {
    let bytes = 0;
    const chunks = [];
    for await (const c of req) {
      bytes += c.length;
      if (bytes > 16384) throw Error("Payload too large");
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const assets = {
    "/admin/": ["index.html", "text/html; charset=utf-8"],
    "/admin/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/admin/style.css": ["style.css", "text/css; charset=utf-8"],
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const localProxy =
        trustProxy &&
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        );
      if (
        mode === "production" &&
        !(
          req.socket.encrypted ||
          (localProxy && req.headers["x-forwarded-proto"] === "https")
        )
      )
        return send(426, { error: "HTTPS required" });
      const url = new URL(req.url, publicOrigin),
        route = url.pathname;
      // Only trust X-Real-IP from a loopback reverse proxy explicitly enabled by the operator.
      const proxyOK =
        trustProxy &&
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        );
      const ip = proxyOK
        ? String(req.headers["x-real-ip"] || req.socket.remoteAddress)
        : req.socket.remoteAddress;
      const ipKey = sign(ip || "unknown"); // Short-lived HMAC keys, never stored or logged.
      if (route === "/health" && req.method === "GET")
        return send(200, { ok: true, mode });
      if (route === "/session" || route === "/collect") {
        const origin = req.headers.origin;
        if (!origins.includes(origin))
          return send(403, { error: "Origin denied" });
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
          });
          return res.end();
        }
        if (req.method !== "POST") return send(405, { error: "POST required" });
        if (
          url.search ||
          !String(req.headers["content-type"]).startsWith("application/json")
        )
          return send(400, { error: "JSON only, no query parameters" });
        if (Number(req.headers["content-length"]) > 16384)
          return send(413, { error: "Payload too large" });
        if (!rate("global", 3000) || !rate(ipKey, 1500))
          return send(429, { error: "Rate limited" });
        const data = await body(req);
        if (route === "/session") {
          if (!rate(ipKey + ":sessions", 150))
            return send(429, { error: "Rate limited" });
          if (
            !exact(data, ["visitor", "session", "version", "device"]) ||
            !UUID.test(data.visitor) ||
            !UUID.test(data.session) ||
            !/^\d+\.\d+\.\d+$/.test(data.version) ||
            !["phone", "tablet", "desktop"].includes(data.device)
          )
            return send(400, { error: "Invalid identity schema" });
          return send(200, { token: mint(data) });
        }
        if (!exact(data, ["token", "events"]))
          return send(400, { error: "Invalid envelope" });
        const i = identity(data.token);
        if (!i) return send(401, { error: "Session expired" });
        if (!rate(i.session, 100))
          return send(429, { error: "Session rate limited" });
        return send(200, { accepted: store.ingest(i, data.events) });
      }
      if (route.startsWith("/admin")) {
        if (req.method !== "GET") return send(405, { error: "Read only" });
        if (!rate("admin-global", 180) || !rate(ipKey + ":admin", 120))
          return send(429, { error: "Rate limited" });
        const raw = String(req.headers.authorization || "");
        let valid = false;
        if (raw.startsWith("Basic ") && raw.length < 1500) {
          const credentials = Buffer.from(raw.slice(6), "base64").toString(),
            p = credentials.indexOf(":");
          if (credentials.slice(0, p) === "admin") {
            const [salt, hash] = adminHash.split(":");
            valid = safeEqual(
              scryptSync(credentials.slice(p + 1), salt, 32),
              Buffer.from(hash, "hex"),
            );
          }
        }
        if (!valid) {
          res.setHeader(
            "WWW-Authenticate",
            'Basic realm="SBTI private analytics", charset="UTF-8"',
          );
          return send(401, { error: "Authentication required" });
        }
        if (assets[route]) {
          const [file, type] = assets[route];
          res.writeHead(200, { "Content-Type": type });
          return res.end(readFileSync(resolve(dir, "admin", file)));
        }
        if (route === "/admin/api/summary") {
          if (
            [...url.searchParams.keys()].some(
              (k) => !["from", "to", "version", "device", "offset"].includes(k),
            )
          )
            return send(400, { error: "Unknown filter" });
          const filters = {};
          for (const [k, v] of url.searchParams)
            filters[k] = ["from", "to", "offset"].includes(k) ? Number(v) : v;
          return send(200, store.summary(filters));
        }
      }
      send(404, { error: "Not found" });
    } catch (e) {
      send(e.message === "Capacity reached" ? 503 : 400, {
        error:
          e.message === "Capacity reached"
            ? "Storage capacity reached"
            : "Invalid request",
      });
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.on("close", () => clearInterval(cleaner));
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const filename = resolve(
    process.env.ANALYTICS_DB || "analytics-data/events.sqlite",
  );
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const mode = process.env.ANALYTICS_MODE || "production";
  if (!["production", "testing"].includes(mode))
    throw Error("Invalid analytics mode");
  const store = openStore(filename, { mode });
  const server = createAnalyticsServer({
    store,
    mode,
    origins: (process.env.ANALYTICS_ORIGINS || "").split(",").filter(Boolean),
    adminHash: process.env.ANALYTICS_ADMIN_HASH,
    publicOrigin: process.env.ANALYTICS_PUBLIC_ORIGIN,
    trustProxy: process.env.ANALYTICS_TRUST_PROXY === "loopback",
  });
  server.listen(Number(process.env.PORT || 8788), "127.0.0.1", () =>
    console.log(`SBTI analytics listening on loopback; mode=${mode}`),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () =>
      server.close(() => {
        store.close();
        process.exit();
      }),
    );
}
