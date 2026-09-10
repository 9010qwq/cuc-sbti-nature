// Run with a deployed URL, or without arguments to serve dist-web under a
// GitHub Pages-style subpath. This uses an isolated browser, never a user profile.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");

const suppliedURL = process.argv[2];
const reportPath = path.resolve(
  process.argv[3] || "test-results/online-results.json",
);
const output = path.dirname(reportPath);
fs.mkdirSync(output, { recursive: true });
const report = {
  environment: "Isolated desktop Edge/Chromium with mobile viewport emulation; no physical phone test",
  checks: [],
  pageErrors: [],
  httpErrors: [],
  requestFailures: [],
  homepage: null,
};
const check = (name, condition = true) => {
  assert(condition, name);
  report.checks.push(name);
  console.log("PASS " + name);
};
let browser, server, page;
const traffic = [];
const pendingSizes = [];

async function serveBuild() {
  const root = path.resolve(__dirname, "../dist-web");
  assert(fs.existsSync(path.join(root, "index.html")), "Build dist-web first");
  const prefix = "/cuc-sbti-nature/";
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (!pathname.startsWith(prefix)) {
        res.writeHead(404).end("Not found");
        return;
      }
      const relative = pathname.slice(prefix.length) || "index.html";
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(root + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
        "Content-Length": fs.statSync(filename).size,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filename).pipe(res);
    } catch {
      res.writeHead(400).end("Bad request");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}${prefix}`;
}

const click = (action) => page.locator(`[data-action="${action}"]`).click();
const readyCard = () =>
  page.locator('[data-action="save"]:not([disabled])').waitFor({ timeout: 60000 });

(async () => {
  const url = suppliedURL || (await serveBuild());
  report.url = url;
  browser = await chromium.launch({
    channel: process.env.SBTI_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  report.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => report.requestFailures.push({
    url: request.url(), error: request.failure()?.errorText,
  }));
  page.on("response", (response) => {
    if (response.status() >= 400) report.httpErrors.push({
      url: response.url(), status: response.status(),
    });
  });
  page.on("requestfinished", (request) => {
    if (!/^https?:/.test(request.url())) return;
    const entry = { url: request.url(), type: request.resourceType() };
    traffic.push(entry);
    pendingSizes.push(request.sizes().then((sizes) => {
      entry.bodyBytes = sizes.responseBodySize;
      entry.headerBytes = sizes.responseHeadersSize;
    }).catch((error) => { entry.sizeError = String(error); }));
  });
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  check("online home returns HTTP 200", response.status() === 200);
  await page.locator('[data-action="start"]').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await Promise.all(pendingSizes);
  const homeImages = await page.locator("img").evaluateAll((images) =>
    images.map((image) => ({
      src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0,
    })),
  );
  check("home illustrations load as separate HTTP files", homeImages.length >= 3 &&
    homeImages.every((image) => image.loaded && /^https?:/.test(image.src)));
  check("web font loads as a separate HTTP file", traffic.some((item) => item.type === "font"));
  check("Chinese web font available", await page.evaluate(() =>
    [...document.fonts].some((face) => face.family.includes("Noto Sans SC") && face.status === "loaded")));
  report.homepage = {
    elapsedMs: Date.now() - started,
    responseBodyBytes: traffic.reduce((sum, item) => sum + (item.bodyBytes || 0), 0),
    responseWithHeadersBytes: traffic.reduce((sum, item) => sum + (item.bodyBytes || 0) + (item.headerBytes || 0), 0),
    requests: traffic.length,
    imageRequests: traffic.filter((item) => item.type === "image").length,
    fontRequests: traffic.filter((item) => item.type === "font").length,
    resources: traffic.map((item) => ({ ...item })),
    note: "Cold browser context; bytes are transferred response bodies (compressed if server uses compression), not a mobile speed benchmark",
  };
  await page.screenshot({ path: path.join(output, "online-home-390.png"), fullPage: true });
  check("homepage carries exact WeChat credit", (await page.locator("body").innerText()).includes("欢迎关注微信公众号 CUC自然科学社"));

  await page.locator("#nickname").fill("手机自然观察员");
  await click("clue1");
  check("frog first sighting is recorded", (await page.locator("body").innerText()).includes("目击记录①"));
  await click("start");
  for (let i = 0; i < 24; i++) {
    const answer = i < 20 ? [0, 0, 3, 0][i % 4] : i - 20;
    await page.locator(`[data-answer="${answer}"]`).click();
    await click("next");
    if (i === 9) {
      await click("clue2");
      await click("continue");
    }
  }
  check("all 24 answers reach interest tie selection", await page.locator("[data-tag]").count() === 4);
  await page.locator('[data-tag="0"]').click();
  await page.locator('[data-tag="1"]').click();
  await click("confirmtags");
  if (await page.locator('[data-action="skip"]').count()) await click("skip");
  await readyCard();
  check("online scoring resolves black hole EAT", (await page.locator("#result-card").getAttribute("aria-label")).includes("黑洞"));
  check("result card contains exact WeChat credit", (await page.locator("#result-card").getAttribute("aria-label")).includes("欢迎关注微信公众号 CUC自然科学社"));
  check("two sightings offer the hidden visitor", await page.locator('[data-action="unlock"]').count() === 1);
  await click("unlock");
  await page.locator(".frog-stamp").waitFor();
  await page.locator(".frog-art").evaluate((image) => image.decode());
  check("frog reveal loads its separate image", /^https?:/.test(await page.locator(".frog-art").getAttribute("src")) ||
    (await page.locator(".frog-art").evaluate((image) => image.currentSrc.startsWith(location.origin))));
  await page.locator("[data-close]").click();
  await readyCard();
  check("canvas remains exportable after frog sticker", await page.locator("#result-card").evaluate((canvas) => canvas.toDataURL("image/png").startsWith("data:image/png;base64,")));

  for (const [width, height] of [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    check(`result has no horizontal overflow at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await click("screenshot");
    const rect = await page.locator(".capture canvas").boundingBox();
    check(`whole 3:4 screenshot card fits ${width}x${height}`, rect.x >= 0 && rect.y >= 0 &&
      rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1 &&
      Math.abs(rect.width / rect.height - 0.75) < 0.01);
    await page.screenshot({ path: path.join(output, `online-capture-${width}.png`) });
    await page.locator(".capture").click();
  }
  await click("save");
  await page.locator(".export-image").waitFor();
  const dimensions = await page.locator(".export-image").evaluate(async (image) => {
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  check("long-press image preview is 1080x1440", dimensions[0] === 1080 && dimensions[1] === 1440);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".image-preview a").click();
  const download = await downloadPromise;
  const pngPath = path.join(output, "online-result-with-frog.png");
  await download.saveAs(pngPath);
  const png = fs.readFileSync(pngPath);
  check("downloaded PNG has valid signature and dimensions", png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1440);
  await page.waitForLoadState("networkidle");
  await Promise.all(pendingSizes);
  report.totalResources = traffic;
  check("all HTTP resources succeeded with no 404", report.httpErrors.length === 0);
  check("no failed network requests", report.requestFailures.length === 0);
  check("no script or cross-origin canvas errors", report.pageErrors.length === 0);
  report.passed = true;
})().catch((error) => {
  report.passed = false;
  report.failure = String(error.stack || error);
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
});
