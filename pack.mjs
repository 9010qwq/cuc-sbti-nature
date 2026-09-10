import fs from "node:fs";
const js = fs
  .readFileSync("dist/app.js", "utf8")
  .replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync("dist/cuc-sbti-nature.css", "utf8");
const html =
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f4f0e5"><title>SBTI 自然界原形 · CUC自然科学社</title><style>' +
  css +
  '</style></head><body><div id="app"></div><script>' +
  js +
  "</script></body></html>";
fs.writeFileSync("dist/index.html", html);
console.log(
  "Standalone HTML: " + (Buffer.byteLength(html) / 1048576).toFixed(1) + " MiB",
);
