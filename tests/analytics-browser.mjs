import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "vite";
import { chromium } from "playwright";
import { openStore } from "../analytics/store.mjs";
import { createAnalyticsServer, passwordHash } from "../analytics/server.mjs";
const output = path.resolve("test-results/analytics");
fs.mkdirSync(output, { recursive: true });
const report = {
  checks: [],
  pageErrors: [],
  environment:
    "User computer, isolated Edge; synthetic testing database, no production collection",
};
const check = (name, value = true) => {
  assert(value, name);
  report.checks.push(name);
  console.log("PASS", name);
};
const siteRoot = path.resolve("test-results/analytics-site");
let server, collector, browser, store;
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", r));
try {
  server = http.createServer((req, res) => {
    const rel =
        new URL(req.url, "http://localhost").pathname.slice(1) || "index.html",
      f = path.resolve(siteRoot, rel);
    if (!f.startsWith(siteRoot + path.sep) || !fs.existsSync(f)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".webp": "image/webp",
      }[path.extname(f)] || "application/octet-stream",
    );
    fs.createReadStream(f).pipe(res);
  });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  store = openStore(":memory:", { mode: "testing" });
  const pass = randomUUID();
  collector = createAnalyticsServer({
    store,
    origins: [origin],
    mode: "testing",
    publicOrigin: "http://127.0.0.1:8788",
    adminHash: passwordHash(pass),
  });
  await listen(collector);
  const api = `http://127.0.0.1:${collector.address().port}`;
  await build({
    mode: "analytics-test",
    configLoader: "native",
    build: { outDir: siteRoot },
    define: { "import.meta.env.VITE_ANALYTICS_URL": JSON.stringify(api) },
    logLevel: "warn",
  });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : "chromium",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.pageErrors.push(String(e)));
  const click = (a) => page.locator(`[data-action="${a}"]`).first().click();
  const ready = () =>
    page.locator('[data-action="save"]:not([disabled])').waitFor();
  const waitFor = async (predicate) => {
    for (let n = 0; n < 50; n++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out waiting for collector");
  };
  await page.goto(origin);
  await page.locator('[data-action="start"]').waitFor();
  check(
    "consent is opt-in and no collection occurs",
    store.summary().firstReceived === null,
  );
  await click("analytics-consent");
  await waitFor(() => store.summary().byEvent.page_view.events === 1);
  await page.locator("#nickname").fill("姓名绝不能上传");
  await click("clue1");
  await click("clue1");
  await click("reduce");
  await click("reduce");
  await click("start");
  async function answerAll(change = false) {
    for (let i = 0; i < 24; i++) {
      await page
        .locator(
          `[data-answer="${i < 20 ? (change ? 0 : [0, 0, 3, 0][i % 4]) : 5}"]`,
        )
        .click();
      await click("next");
      if (await page.locator('[data-action="continue"]').count()) {
        await click("clue2");
        await click("continue");
      }
    }
    await ready();
  }
  await answerAll();
  await waitFor(() => store.summary().funnel.completedAttempts === 1);
  await click("reduce");
  await ready();
  await click("unlock");
  await page.locator("[data-close]").click();
  await ready();
  await click("frog");
  await page.locator("[data-close]").click();
  await click("snack");
  await page.locator('[data-action="sharesnack"]').click();
  await page.locator("[data-close]").click();
  await ready();
  await click("save");
  await page.locator(".export-image").evaluate((i) => i.decode());
  const downloaded = page.waitForEvent("download");
  await page.locator(".image-preview a").click();
  await (await downloaded).saveAs(path.join(output, "real-flow-result.png"));
  await page.locator("[data-close]").click();
  await waitFor(() => store.summary().byEvent.download_click.events === 1);
  let d = store.summary();
  check("one page view despite renders", d.byEvent.page_view.events === 1);
  check(
    "24 question reaches without answers",
    d.byEvent.question_reached.events === 24,
  );
  check(
    "pre-start clue retained",
    JSON.parse(
      store.db.prepare("SELECT props FROM events WHERE name='quiz_start'").get()
        .props,
    ).clue1 === true,
  );
  check("duplicate clue clicks counted once", d.byEvent.egg_clue.events === 2);
  check(
    "both eggs unlocked once",
    d.eggs.every((e) => e.events === 1),
  );
  check(
    "save, preview and download distinguished",
    d.byEvent.save_click.events === 1 &&
      d.byEvent.preview_ready.events === 1 &&
      d.byEvent.download_click.events === 1,
  );
  await click("edit");
  await answerAll(true);
  await waitFor(() => store.summary().byEvent.result_revision.events === 1);
  d = store.summary();
  check(
    "editing produces revision, not a second participant",
    d.funnel.startedAttempts === 1 && d.funnel.completedAttempts === 1,
  );
  check(
    "latest result replaces original distribution",
    d.resultDistribution.find((r) => r.code === "BHTF").attempts === 1 &&
      d.resultDistribution.find((r) => r.code === "BHSF").attempts === 0,
  );
  check(
    "revisiting all questions does not recount",
    d.byEvent.question_reached.events === 24,
  );
  await click("staff");
  await click("demo-DOSP");
  await ready();
  await click("save");
  await page.locator(".export-image").evaluate((i) => i.decode());
  await page.locator("[data-close]").click();
  await new Promise((r) => setTimeout(r, 400));
  d = store.summary();
  check(
    "staff demo excluded from completion and save stats",
    d.funnel.completedAttempts === 1 && d.byEvent.save_click.events === 1,
  );
  await click("reset");
  await click("start");
  await waitFor(() => store.summary().funnel.startedAttempts === 2);
  check(
    "next participant is only a repeated browser attempt",
    store.summary().additionalAttempts === 1,
  );
  await page.route(api + "/**", (r) => r.abort());
  await answerAll();
  await click("save");
  await page.locator(".export-image").evaluate((i) => i.decode());
  check("collector failure does not block full quiz or PNG preview");
  await page.locator("[data-close]").click();
  await click("analytics-consent");
  check(
    "withdrawal removes persistent analytics identity",
    await page.evaluate(
      () => localStorage.getItem("sbti-analytics-visitor") === null,
    ),
  );
  const raw = store.db.prepare("SELECT * FROM events").all();
  check(
    "no name or answers in stored data",
    !JSON.stringify(raw).includes("姓名绝不能上传") &&
      !JSON.stringify(raw).includes("answers"),
  );
  check(
    "no share measurements invented",
    store.summary().share === "not_instrumentable",
  );
  async function crossTabWithdrawal(disableBroadcast) {
    const tabs = await browser.newContext();
    await tabs.addInitScript(
      ({ api, disableBroadcast }) => {
        if (disableBroadcast)
          Object.defineProperty(window, "BroadcastChannel", {
            value: undefined,
          });
        window.__telemetryRequests = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, options) => {
          if (!String(url).startsWith(api + "/"))
            return realFetch(url, options);
          const record = {
            route: new URL(url).pathname,
            body: JSON.parse(options.body),
            aborted: false,
            settled: false,
          };
          window.__telemetryRequests.push(record);
          options.signal.addEventListener(
            "abort",
            () => {
              record.aborted = true;
            },
            { once: true },
          );
          if (record.route === "/collect" && window.__holdCollect) {
            // Deliberately ignore abort here to model a late 401 that has already
            // crossed the network boundary. The app must still reject its generation.
            return new Promise((resolve) => {
              window.__late401 = () => {
                record.settled = true;
                resolve(new Response("{}", { status: 401 }));
              };
            });
          }
          return realFetch(url, options).finally(() => {
            record.settled = true;
          });
        };
      },
      { api, disableBroadcast },
    );
    const source = await tabs.newPage(),
      peer = await tabs.newPage();
    try {
      await source.goto(origin);
      await peer.goto(origin);
      await source.locator('[data-action="analytics-consent"]').click();
      await source.waitForFunction(() =>
        window.__telemetryRequests.some(
          (r) => r.route === "/collect" && r.settled,
        ),
      );
      await peer.locator('[data-action="analytics-consent"]').click();
      await peer.waitForFunction(() =>
        window.__telemetryRequests.some(
          (r) => r.route === "/collect" && r.settled,
        ),
      );
      const oldVisitor = await peer.evaluate(
        () => JSON.parse(localStorage.getItem("sbti-analytics-visitor")).id,
      );
      await peer.evaluate(() => {
        window.__holdCollect = true;
      });
      await peer.locator('[data-action="start"]').click();
      await peer.waitForFunction(() => typeof window.__late401 === "function");
      // A second event is queued behind the held collect request.
      await peer.locator('[data-answer="0"]').click();
      await peer.locator('[data-action="next"]').click();
      await peer.locator('[data-answer="1"]').click();
      const before = await peer.locator(".question-meta").innerText();
      await source.locator('[data-action="analytics-consent"]').click();
      await peer.waitForFunction(
        () =>
          document.querySelector('[data-action="analytics-consent"]')
            .textContent === "同意参与活动统计",
      );
      const suffix = disableBroadcast ? " (storage fallback)" : " (cross-tab)";
      check(
        "withdrawal propagates without replacing quiz state" + suffix,
        (await peer.locator(".question-meta").innerText()) === before &&
          (await peer
            .locator('[data-answer="1"]')
            .getAttribute("aria-pressed")) === "true",
      );
      check(
        "withdrawal aborts in-flight collection" + suffix,
        await peer.evaluate(() =>
          window.__telemetryRequests.some(
            (r) => r.route === "/collect" && r.aborted,
          ),
        ),
      );
      const sent = await peer.evaluate(() => window.__telemetryRequests.length);
      await peer.evaluate(() => window.__late401());
      await peer.locator('[data-action="next"]').click();
      await peer.waitForTimeout(700); // Beyond both queue timers: no delayed retry/session request.
      check(
        "late 401 and queued events cannot reauthorize after withdrawal" +
          suffix,
        (await peer.evaluate(() => window.__telemetryRequests.length)) === sent,
      );
      check(
        "shared identity removed on withdrawal" + suffix,
        await peer.evaluate(
          () =>
            localStorage.getItem("sbti-analytics-visitor") === null &&
            localStorage.getItem("sbti-analytics-consent") === null,
        ),
      );
      await peer.evaluate(() => {
        window.__holdCollect = false;
      });
      await peer.locator('[data-action="analytics-consent"]').click();
      await peer.waitForFunction(
        (sent) =>
          window.__telemetryRequests
            .slice(sent)
            .some((r) => r.route === "/collect" && r.settled),
        sent,
      );
      const restarted = await peer.evaluate(
        (sent) => ({
          visitor: JSON.parse(localStorage.getItem("sbti-analytics-visitor"))
            .id,
          events: window.__telemetryRequests
            .slice(sent)
            .filter((r) => r.route === "/collect")
            .flatMap((r) => r.body.events),
        }),
        sent,
      );
      check(
        "explicit new consent uses fresh identity and no stale queued attempt" +
          suffix,
        restarted.visitor !== oldVisitor &&
          restarted.events.length === 1 &&
          restarted.events[0].name === "page_view" &&
          restarted.events[0].attempt === null,
      );
      check(
        "consent in another tab does not silently reenable a withdrawn tab" +
          suffix,
        (await source
          .locator('[data-action="analytics-consent"]')
          .innerText()) === "同意参与活动统计",
      );
    } finally {
      await tabs.close();
    }
  }
  await crossTabWithdrawal(false);
  await crossTabWithdrawal(true);
  const adminCtx = await browser.newContext({
      httpCredentials: { username: "admin", password: pass },
      viewport: { width: 1280, height: 960 },
    }),
    admin = await adminCtx.newPage();
  await admin.goto(api + "/admin/");
  await admin.locator("#content:not([hidden])").waitFor();
  check(
    "private dashboard displays explicit testing label",
    (await admin.locator("#mode").innerText()).includes("非真实活动"),
  );
  await admin.screenshot({
    path: path.join(output, "admin-desktop.png"),
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  report.narrowLayout = await admin.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowing: [
      ...document.querySelectorAll(
        "input,select,header,form,section,.columns,.table-scroll",
      ),
    ]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        id: e.id,
        width: e.getBoundingClientRect().width,
        right: e.getBoundingClientRect().right,
      })),
  }));
  if (report.narrowLayout.scrollWidth > report.narrowLayout.width + 1)
    console.log("NARROW_LAYOUT", JSON.stringify(report.narrowLayout));
  check(
    "dashboard narrow layout has no horizontal overflow",
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await admin.screenshot({
    path: path.join(output, "admin-mobile.png"),
    fullPage: true,
  });
  const ep = admin.waitForEvent("download");
  await admin.locator("#export").click();
  await (await ep).saveAs(path.join(output, "testing-summary.json"));
  check("private aggregate export works");
  await admin.route("**/admin/api/**", (r) => r.abort());
  await admin.locator("#filters button").first().click();
  await admin.waitForFunction(() =>
    document.querySelector("#status").classList.contains("error"),
  );
  check(
    "backend unavailable displays no fake zeros",
    (await admin.locator("#content").getAttribute("hidden")) !== null,
  );
  check("no page runtime errors", report.pageErrors.length === 0);
  report.passed = true;
} catch (e) {
  report.failure = String(e.stack);
  process.exitCode = 1;
  console.error(e);
} finally {
  if (browser) await browser.close();
  if (collector) await new Promise((r) => collector.close(r));
  if (server) await new Promise((r) => server.close(r));
  if (store) store.close();
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
}
