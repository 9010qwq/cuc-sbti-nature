const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const report = { version: 2, checks: [], runtimeErrors: [], network: [] };
const check = (name, condition) => {
  assert(condition, name);
  report.checks.push(name);
};
let browser;
(async () => {
  const file = process.argv[2];
  if (!file) throw Error("Specify extracted HTML");
  browser = await chromium.launch({
    channel:
      process.env.SBTI_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    offline: true,
  });
  const page = await context.newPage();
  const click = (action) =>
    page.locator(`[data-action="${action}"]`).first().click();
  const ready = () =>
    page
      .locator('[data-action="save"]:not([disabled])')
      .waitFor({ timeout: 45000 });
  page.on("pageerror", (error) => report.runtimeErrors.push(String(error)));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) report.network.push(request.url());
  });
  await page.goto(pathToFileURL(path.resolve(file)).href);
  check(
    "offline homepage hides gallery before quiz",
    (await page.locator('[data-action="gallery"]').count()) === 0,
  );
  await click("clue1");
  await click("start");
  for (let i = 0; i < 24; i++) {
    // Semantic answer IDs remain stable after their displayed positions change.
    const answer = i < 20 ? [0, 0, 0, 3][i % 4] : 0;
    await page.locator(`[data-answer="${answer}"]`).click();
    await click("next");
    if (i === 9) {
      await click("clue2");
      await click("continue");
    }
  }
  if (await page.locator('[data-action="skip"]').count()) await click("skip");
  await ready();
  check(
    "full shuffled quiz resolves real mouse king",
    (await page.locator("#result-card").getAttribute("aria-label")).includes(
      "鼠王",
    ) && (await page.locator(".dimensions").count()) === 1,
  );
  await click("unlock");
  await page.locator(".frog-art").evaluate((image) => image.decode());
  await page.locator("[data-close]").click();
  await ready();
  await click("snack");
  await click("sharesnack");
  await page.locator(".larva-art").evaluate((image) => image.decode());
  await page.locator("[data-close]").click();
  await ready();
  check(
    "both guest stickers unlock offline",
    (await page.locator('[data-action="frog"]').count()) === 1 &&
      (await page.locator(".snack-discovered").count()) === 1,
  );
  await click("save");
  const image = page.locator(".export-image");
  await image.waitFor();
  await image.evaluate((image) => image.decode());
  const size = await image.evaluate((image) => [
    image.naturalWidth,
    image.naturalHeight,
  ]);
  check("export image is 1080x1440", size[0] === 1080 && size[1] === 1440);
  check("offline app makes zero web requests", report.network.length === 0);
  check("no runtime errors", report.runtimeErrors.length === 0);
  report.imageSize = size;
  report.passed = true;
})()
  .catch((error) => {
    report.passed = false;
    report.failure = String(error.stack || error);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    const output = path.resolve(
      process.argv[3] || "test-results/package-smoke.json",
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  });
