const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const output = path.resolve("test-results");
fs.mkdirSync(output, { recursive: true });
const codes = [
  "BHTF",
  "BHTP",
  "BHSF",
  "BHSP",
  "BOTF",
  "BOTP",
  "BOSF",
  "BOSP",
  "DHTF",
  "DHTP",
  "DHSF",
  "DHSP",
  "DOTF",
  "DOTP",
  "DOSF",
  "DOSP",
];
let browser, context, page;
const log = [];
const errors = [];
const check = (name, condition = true) => {
  assert(condition, name);
  log.push(name);
  console.log("PASS " + name);
};
const click = async (action) =>
  page.locator(`[data-action="${action}"]`).click();
async function overflow(name) {
  const r = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    w: innerWidth,
  }));
  check(name + " no horizontal overflow", r.doc <= r.w + 1);
}
async function cardReady() {
  await page
    .locator('[data-action="save"]:not([disabled])')
    .waitFor({ timeout: 45000 });
}
async function choose(i) {
  await page.locator(`[data-answer="${i}"]`).click();
  await click("next");
}
async function complete(code, clues = true, choices = [5, 5, 5, 5]) {
  await page.locator("#nickname").fill("校园自然观察员");
  if (clues) await click("clue1");
  await click("start");
  for (let i = 0; i < 24; i++) {
    const a = i < 20 ? ("BHTF".includes(code[i % 4]) ? 0 : 3) : choices[i - 20];
    await choose(a);
    if (i === 9) {
      if (clues) await click("clue2");
      await click("continue");
    }
  }
  if (await page.locator('[data-action="skip"]').count()) await click("skip");
  await cardReady();
}
(async () => {
  browser = await chromium.launch({
    channel:
      process.env.SBTI_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  let network = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await context.setOffline(true);
  await page.goto(
    pathToFileURL(path.resolve(process.env.SBTI_TEST_HTML || "dist/index.html"))
      .href,
  );
  await page.locator('[data-action="start"]').waitFor();
  check("standalone file opens offline");
  await page.screenshot({
    path: path.join(output, "01-home-390.png"),
    fullPage: true,
  });
  for (const w of [320, 360, 390, 430]) {
    await page.setViewportSize({ width: w, height: 844 });
    await overflow("home " + w);
    const min = await page
      .locator("button")
      .evaluateAll((bs) =>
        Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
      );
    check("home touch targets " + w, min >= 43.5);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await complete("BHSF");
  check(
    "normal flow resolves EAT",
    await page
      .locator("#result-card")
      .getAttribute("aria-label")
      .then((x) => x.includes("黑洞")),
  );
  check(
    "two clues expose visitor",
    (await page.locator('[data-action="unlock"]').count()) === 1,
  );
  await click("staff");
  await click("demofrog");
  await page.locator("[data-close]").click();
  await click("return");
  await cardReady();
  check(
    "staff frog demo preserves real result",
    (await page.locator(".dimensions").count()) === 1,
  );
  await click("unlock");
  await page.locator(".frog-stamp").waitFor();
  check("frog reveal");
  await page.locator("[data-close]").click();
  await cardReady();
  await page.screenshot({
    path: path.join(output, "02-result-390.png"),
    fullPage: true,
  });
  for (const [w, h] of [
    [320, 568],
    [360, 640],
    [390, 844],
    [430, 932],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await overflow("result " + w + "x" + h);
    await click("screenshot");
    const r = await page.locator(".capture canvas").boundingBox();
    check(
      "entire screenshot card visible " + w + "x" + h,
      r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 1 && r.y + r.height <= h + 1,
    );
    check(
      "screenshot ratio 3:4 " + w,
      Math.abs(r.width / r.height - 0.75) < 0.01,
    );
    await page.screenshot({ path: path.join(output, `03-capture-${w}.png`) });
    await page.locator(".capture").click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await click("save");
  await page.locator(".export-image").waitFor();
  const dimensions = await page.locator(".export-image").evaluate(
    (i) =>
      new Promise((res) => {
        if (i.complete) res([i.naturalWidth, i.naturalHeight]);
        else i.onload = () => res([i.naturalWidth, i.naturalHeight]);
      }),
  );
  check(
    "export PNG 1080x1440",
    dimensions[0] === 1080 && dimensions[1] === 1440,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".image-preview a").click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "实际下载_黑洞.png"));
  check(
    "download completed",
    fs.statSync(path.join(output, "实际下载_黑洞.png")).size > 10000,
  );
  await page.locator("[data-close]").click();
  await click("edit");
  await click("gallery");
  await click("help");
  await click("return");
  check(
    "nested auxiliary pages return to quiz",
    (await page.locator(".quiz-shell").count()) === 1,
  );
  await page.locator('[data-answer="3"]').click();
  check(
    "back edit selected changed answer",
    (await page.locator('[data-answer="3"]').getAttribute("aria-pressed")) ===
      "true",
  );
  await click("next");
  await click("back");
  check(
    "return retains changed answer",
    (await page.locator('[data-answer="3"]').getAttribute("aria-pressed")) ===
      "true",
  );
  await click("home");
  check(
    "leaving quiz resets name",
    (await page.locator("#nickname").inputValue()) === "",
  );
  await complete("DOSP", false);
  check(
    "missed clues do not unlock frog",
    (await page.locator('[data-action="unlock"]').count()) === 0,
  );
  await click("reset");
  check(
    "next participant clears name",
    (await page.locator("#nickname").inputValue()) === "",
  );
  await click("start");
  check(
    "next participant has no selected answer",
    (await page.locator(".option.selected").count()) === 0,
  );
  await click("home");
  await click("start");
  for (let i = 0; i < 24; i++) {
    await choose(i < 20 ? [0, 0, 3, 2, 2][Math.floor(i / 4)] : i - 20);
    if (i === 9) await click("continue");
  }
  for (let i = 0; i < 4; i++) {
    await page.locator(`[data-tie="${i}:1"]`).click();
  }
  check(
    "all 4 zero dimensions asked",
    (await page.locator("[data-tag]").count()) === 4,
  );
  await page.locator('[data-tag="0"]').click();
  await page.locator('[data-tag="1"]').click();
  await click("confirmtags");
  if (await page.locator('[data-action="skip"]').count()) await click("skip");
  await cardReady();
  check(
    "tie-break result BHTF",
    await page
      .locator("#result-card")
      .getAttribute("aria-label")
      .then((x) => x.includes("浣熊")),
  );
  await click("reset");
  await click("staff");
  const cfgDL = page.waitForEvent("download");
  await click("exportconfig");
  const cfgFile = path.join(output, "导出内容配置.json");
  await (await cfgDL).saveAs(cfgFile);
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  check(
    "config round trip exports all types",
    cfg.profiles.length === 16 && cfg.questions.length === 20,
  );
  const bad = { ...cfg, welcome: "missing" };
  fs.writeFileSync(path.join(output, "invalid.json"), JSON.stringify(bad));
  await page
    .locator("#import-config")
    .setInputFiles(path.join(output, "invalid.json"));
  await page.getByText("导入失败：", { exact: false }).waitFor();
  check("invalid config preserves content");
  cfg.event = "自然科学社 · 长文案现场验证";
  cfg.questions[0].options[0] =
    "这个选项稍微有一点长，用来验证在手机的小屏幕上，文字能够自然换行，按钮能够完整显示，而且不会把后面的内容挤出屏幕。";
  fs.writeFileSync(path.join(output, "valid.json"), JSON.stringify(cfg));
  await page
    .locator("#import-config")
    .setInputFiles(path.join(output, "valid.json"));
  await page.getByText("导入成功，旧答题已清空。").waitFor();
  check("valid configuration imported");
  await click("home");
  await page.locator("#nickname").fill("<img onerror=bad>超长名字");
  await click("start");
  await page.setViewportSize({ width: 320, height: 568 });
  await overflow("long option 320");
  await page.screenshot({
    path: path.join(output, "04-long-question-320.png"),
    fullPage: true,
  });
  check("nickname was not executed", errors.length === 0);
  await click("home");
  await click("staff");
  await click("defaultconfig");
  for (const code of codes) {
    await click("demo-" + code);
    await cardReady();
    const alt = await page.locator("#result-card").getAttribute("aria-label");
    check(
      code + " has welcome signature",
      alt.includes("欢迎关注微信公众号 CUC自然科学社"),
    );
    const data = await page
      .locator("#result-card")
      .evaluate((c) => c.toDataURL("image/png").split(",")[1]);
    fs.writeFileSync(
      path.join(output, code + ".png"),
      Buffer.from(data, "base64"),
    );
    await click("screenshot");
    check(
      code + " capture has no toast",
      (await page.locator("#toast").count()) === 0,
    );
    await page.locator(".capture").click();
    await click("staff");
  }
  await click("gallery");
  await page.setViewportSize({ width: 1280, height: 900 });
  await overflow("desktop gallery");
  check(
    "gallery includes all 16 independent images",
    (await page.locator(".specimen img").count()) === 16,
  );
  await page.screenshot({
    path: path.join(output, "05-gallery-desktop.png"),
    fullPage: true,
  });
  await click("home");
  await page.screenshot({
    path: path.join(output, "06-home-desktop.png"),
    fullPage: true,
  });
  check("zero external network requests", network.length === 0);
  check("no browser runtime exceptions", errors.length === 0);
  const privateCtx = await browser.newContext();
  await privateCtx.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("disabled for test");
      },
    });
  });
  const privatePage = await privateCtx.newPage();
  await privatePage.goto(pathToFileURL(path.resolve("dist/index.html")).href);
  await privatePage.locator('[data-action="start"]').click();
  await privatePage.locator(".option").first().click();
  check(
    "storage disabled still usable",
    (await privatePage.locator(".option.selected").count()) === 1,
  );
  await privateCtx.close();
  const contact = await context.newPage();
  await contact.setViewportSize({ width: 1440, height: 2050 });
  await contact.setContent(
    '<html><body style="margin:0;background:#e5e6dc;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px">' +
      codes
        .map(
          (c) =>
            '<img style="width:100%" src="data:image/png;base64,' +
            fs.readFileSync(path.join(output, c + ".png")).toString("base64") +
            '">',
        )
        .join("") +
      "</body></html>",
  );
  await contact
    .locator("img")
    .last()
    .evaluate((i) => i.decode());
  await contact.screenshot({
    path: path.join(output, "07-all-result-cards.png"),
    fullPage: true,
  });
  await contact.close();
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify({ checks: log, errors }, null, 2),
    );
  });
