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
let failure = null;
const check = (name, condition = true) => {
  assert(condition, name);
  log.push(name);
  console.log("PASS " + name);
};
const click = async (action) =>
  page.locator(`[data-action="${action}"]`).first().click();
const cardPart = (part) =>
  page.locator("#result-card").evaluate((canvas, area) => {
    const copy = document.createElement("canvas");
    [copy.width, copy.height] = [area[2], area[3]];
    copy.getContext("2d").drawImage(canvas, ...area, 0, 0, area[2], area[3]);
    return copy.toDataURL();
  }, part);
const signature = () => cardPart([0, 1300, 1080, 140]);
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
async function complete(
  code,
  clues = true,
  choices = [5, 5, 5, 5],
  inspectOrder = false,
) {
  await page.locator("#nickname").fill("校园自然观察员");
  if (clues) await click("clue1");
  await click("start");
  const orders = [[], [], [], []];
  for (let i = 0; i < 24; i++) {
    if (inspectOrder && i < 20)
      orders[i % 4].push(
        await page
          .locator("[data-answer]")
          .evaluateAll((bs) => bs.map((b) => b.dataset.answer).join("")),
      );
    const a = i < 20 ? ("BHTF".includes(code[i % 4]) ? 0 : 3) : choices[i - 20];
    await choose(a);
    if (i === 9) {
      if (clues) await click("clue2");
      await click("continue");
    }
  }
  if (await page.locator('[data-action="skip"]').count()) await click("skip");
  await cardReady();
  if (inspectOrder)
    for (let axis = 0; axis < 4; axis++)
      check(
        "same-axis option positions vary " + axis,
        new Set(orders[axis]).size >= 4 &&
          orders[axis].every((order) => [...order].sort().join("") === "0123"),
      );
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
  check(
    "home has no gallery before completion",
    (await page.locator('[data-action="gallery"]').count()) === 0,
  );
  check(
    "home top navigation only contains help",
    (await page.locator(".topbar nav button").count()) === 1 &&
      (await page.locator('.topbar [data-action="sound"]').count()) === 0,
  );
  check(
    "Science S is independently green",
    await page.locator(".science-letter").evaluate((e) => {
      const rgb = getComputedStyle(e).color.match(/\d+/g).map(Number);
      return rgb[1] > rgb[0] && rgb[1] > rgb[2];
    }),
  );
  await click("help");
  check(
    "help navigation highlights current page",
    (await page
      .locator('.topbar [data-action="help"]')
      .getAttribute("aria-current")) === "page",
  );
  await click("return");
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
    const tags = await page.locator(".intro-strip span").evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    check(
      "six interests form 3 columns and 2 rows at " + w,
      tags.length === 6 &&
        new Set(tags.map((r) => r.x)).size === 3 &&
        new Set(tags.map((r) => r.y)).size === 2,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await complete("BHSF", true, [5, 5, 5, 5], true);
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
  const baseSignature = await signature();
  const baseCanvas = await page
    .locator("#result-card")
    .evaluate((c) => c.toDataURL());
  const originalDimensions = await page.locator(".dimensions").innerText();
  await click("staff");
  await click("demofrog");
  await page.locator("[data-close]").click();
  await click("demolarva");
  await page.locator(".larva-modal").waitFor();
  await page.locator("[data-close]").click();
  await click("return");
  await cardReady();
  check(
    "staff frog demo preserves real result",
    (await page.locator(".dimensions").count()) === 1,
  );
  check(
    "staff egg demos preserve scores and real card pixels",
    (await page.locator(".dimensions").innerText()) === originalDimensions &&
      (await page.locator("#result-card").evaluate((c) => c.toDataURL())) ===
        baseCanvas,
  );
  await click("unlock");
  await page.locator(".frog-stamp").waitFor();
  check("frog reveal");
  await page.locator("[data-close]").click();
  await cardReady();
  const frogLeft = await cardPart([30, 760, 230, 270]);
  const beforeLarva = await cardPart([820, 760, 250, 270]);
  await click("snack");
  await page.locator(".snack-modal").waitFor();
  await page.locator("[data-close]").click();
  check(
    "dismissing snack does not unlock larva",
    (await page.locator(".snack-discovered").count()) === 0,
  );
  await click("snack");
  // Reuse the detached element to model a rapid second activation as well.
  await page.locator('[data-action="sharesnack"]').evaluate((b) => {
    b.click();
    b.click();
  });
  await page.locator(".larva-modal").waitFor();
  await page.locator("[data-close]").click();
  await cardReady();
  check(
    "both old and new eggs coexist",
    (await page.locator('[data-action="frog"]').count()) === 1 &&
      (await page.locator(".snack-discovered").count()) === 1,
  );
  check(
    "second sticker preserves first and adds its own image",
    (await cardPart([30, 760, 230, 270])) === frogLeft &&
      (await cardPart([820, 760, 250, 270])) !== beforeLarva,
  );
  check(
    "both stickers leave entire signature area unchanged",
    (await signature()) === baseSignature,
  );
  check(
    "egg actions do not change scores",
    (await page.locator(".dimensions").innerText()) === originalDimensions,
  );
  const bothCanvas = await page
    .locator("#result-card")
    .evaluate((c) => c.toDataURL());
  for (const action of ["frog", "snack", "frog", "snack"]) {
    await click(action);
    check(
      action + " repeat creates one overlay",
      (await page.locator("#overlay").count()) === 1,
    );
    await page.locator("[data-close]").click();
  }
  check(
    "repeated egg viewing leaves final card unchanged",
    (await page.locator("#result-card").evaluate((c) => c.toDataURL())) ===
      bothCanvas,
  );
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
  await click("gallery");
  await click("help");
  await click("return");
  await cardReady();
  check(
    "nested auxiliary pages return to real result",
    (await page.locator(".dimensions").count()) === 1,
  );
  await click("edit");
  check(
    "editing hides gallery until finished again",
    (await page.locator('[data-action="gallery"]').count()) === 0,
  );
  await click("help");
  await click("staff");
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
  await click("snack");
  await click("sharesnack");
  await page.locator(".larva-modal").waitFor();
  await page.locator("[data-close]").click();
  await cardReady();
  check(
    "new egg can unlock without any frog clue",
    (await page.locator(".snack-discovered").count()) === 1 &&
      (await page.locator('[data-action="frog"]').count()) === 0,
  );
  await click("reset");
  check(
    "next participant clears name",
    (await page.locator("#nickname").inputValue()) === "",
  );
  check(
    "next participant clears first clue and gallery access",
    (await page.locator(".mystery-box.found").count()) === 0 &&
      (await page.locator('[data-action="gallery"]').count()) === 0,
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
  check(
    "next result has neither old nor new sticker",
    (await page.locator('[data-action="frog"]').count()) === 0 &&
      (await page.locator(".snack-discovered").count()) === 0,
  );
  await click("reset");
  await complete("BHTP", false);
  check(
    "BHTP is real mouse-king result",
    (await page.locator("#result-card").getAttribute("aria-label")).includes(
      "鼠王",
    ) && (await page.locator(".dimensions").count()) === 1,
  );
  const ratCard = await page
    .locator("#result-card")
    .evaluate((c) => c.toDataURL().split(",")[1]);
  fs.writeFileSync(
    path.join(output, "鼠王_正式测评.png"),
    Buffer.from(ratCard, "base64"),
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
    cfg.version === 2 &&
      cfg.profiles.length === 16 &&
      cfg.questions.length === 20,
  );
  const old = structuredClone(cfg);
  old.version = 1;
  old.event = "旧版署名不应覆盖";
  old.profiles.find((p) => p.code === "BHTP").name = "磁铁";
  fs.writeFileSync(path.join(output, "legacy-v1.json"), JSON.stringify(old));
  await page
    .locator("#import-config")
    .setInputFiles(path.join(output, "legacy-v1.json"));
  await page.getByText("导入失败：", { exact: false }).waitFor();
  check(
    "legacy v1 import is rejected and rat stays",
    (await page.locator("#config-status").innerText()).includes("2.0") &&
      (await page.locator('[data-action="demo-BHTP"]').innerText()) === "鼠王",
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
  check(
    "valid config persists only under v2 key",
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("sbti-content-v2")).version === 2,
    ),
  );
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
    "gallery uses one atlas preview and 16 text buttons",
    (await page.locator(".atlas-art").count()) === 1 &&
      (await page.locator(".specimen").count()) === 16 &&
      (await page.locator("#main img").count()) === 1,
  );
  await page.screenshot({
    path: path.join(output, "05-gallery-desktop.png"),
    fullPage: true,
  });
  await click("view-BHTP");
  await page.locator(".detail-art").evaluate((i) => i.decode());
  check(
    "gallery detail loads one mouse-king image",
    (await page.locator("#main img").count()) === 1 &&
      (await page.locator(".gallery-detail h1").innerText()) === "鼠王",
  );
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
  const legacyCtx = await browser.newContext({ offline: true });
  await legacyCtx.addInitScript((old) => {
    localStorage.setItem("sbti-content-v1", JSON.stringify(old));
  }, old);
  const legacyPage = await legacyCtx.newPage();
  await legacyPage.goto(
    pathToFileURL(path.resolve(process.env.SBTI_TEST_HTML || "dist/index.html"))
      .href,
  );
  await legacyPage.locator('[data-action="staff"]').click();
  check(
    "old local storage cannot restore magnet in v2",
    (await legacyPage.locator('[data-action="demo-BHTP"]').innerText()) ===
      "鼠王" &&
      (await legacyPage.locator("#event-name").inputValue()) !== old.event,
  );
  await legacyCtx.close();
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
    failure = String(e.stack || e);
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          passed: !failure && errors.length === 0,
          checks: log,
          errors,
          failure,
          environment:
            "Desktop Edge mobile viewport emulation, no physical phone",
        },
        null,
        2,
      ),
    );
  });
