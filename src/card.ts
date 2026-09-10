import { art } from "./assets";
import { interests, type Profile } from "./data";
export interface CardData {
  profile: Profile;
  name: string;
  event: string;
  tags: number[];
  frog: boolean;
  demo: boolean;
  foodie: boolean;
}
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(code: string) {
  if (!imageCache.has(code))
    imageCache.set(
      code,
      new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => {
          imageCache.delete(code);
          reject(Error("角色图片未能载入，请重试。"));
        };
        im.src = art[code];
      }),
    );
  return imageCache.get(code)!;
}
function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  width: number,
  weight = 400,
) {
  ctx.font = `${weight} ${size}px "Noto Sans SC",sans-serif`;
  while (ctx.measureText(s).width > width && size > 16) {
    size--;
    ctx.font = `${weight} ${size}px "Noto Sans SC",sans-serif`;
  }
  ctx.fillText(s, x, y);
}
function lines(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
) {
  ctx.font = `700 ${size}px "Noto Sans SC",sans-serif`;
  let line = "",
    row = 0;
  for (const c of s) {
    if (ctx.measureText(line + c).width > maxWidth && line) {
      ctx.fillText(line, x, y + row * 58);
      row++;
      line = "";
    }
    line += c;
  }
  ctx.fillText(line, x, y + row * 58);
}
export async function drawCard(canvas: HTMLCanvasElement, data: CardData) {
  await document.fonts.load(
    '400 32px "Noto Sans SC"',
    JSON.stringify(data) +
      "欢迎关注微信公众号 CUC自然科学社 探索偏好 野生兴趣档案 奶蛙目击者",
  );
  await document.fonts.ready;
  const im = await loadImage(data.profile.code);
  const frog = data.frog ? await loadImage("NAIWA") : null;
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("浏览器不支持图片绘制。");
  const p = data.profile;
  ctx.fillStyle = "#f4f0e5";
  ctx.fillRect(0, 0, 1080, 1440);
  ctx.strokeStyle = "#bdc0ad";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, 1024, 1384);
  ctx.fillStyle = "#253d32";
  text(ctx, "SBTI / 自然界原形", 60, 85, 36, 700, 700);
  text(ctx, data.demo ? "图鉴演示" : "野生兴趣档案", 790, 85, 26, 230);
  ctx.fillStyle = "#697761";
  text(ctx, data.event, 60, 127, 22, 950);
  ctx.fillStyle = p.color;
  ctx.fillRect(60, 145, 960, 3);
  ctx.fillStyle = "#25372e";
  text(ctx, p.en, 60, 233, 94, 900, 700);
  text(ctx, p.name, 60, 303, 76, 960, 700);
  ctx.fillStyle = "#5d665a";
  text(
    ctx,
    `${data.name} · ${data.foodie ? "狂吃型探索者" : "今日原形已登记"}`,
    60,
    352,
    32,
    950,
  );
  ctx.drawImage(im, 200, 370, 680, 680);
  ctx.fillStyle = "#25372e";
  lines(ctx, p.quote, 60, 1103, 960, 42);
  ctx.fillStyle = p.color;
  let x = 60;
  for (const t of data.tags) {
    const s = interests[t].name;
    ctx.font = '28px "Noto Sans SC"';
    const w = ctx.measureText(s).width + 38;
    ctx.fillStyle = "#e1e4d5";
    ctx.fillRect(x, 1203, w, 48);
    ctx.fillStyle = "#334b3b";
    ctx.fillText(s, x + 19, 1237);
    x += w + 12;
  }
  ctx.fillStyle = "#677060";
  text(ctx, `探索偏好 · ${p.code}  /  趣味测评`, 60, 1290, 27, 680);
  if (frog) {
    ctx.drawImage(frog, 850, 1170, 100, 100);
    ctx.save();
    ctx.translate(890, 1290);
    ctx.rotate(-0.04);
    ctx.strokeStyle = "#5f7750";
    ctx.lineWidth = 2;
    ctx.strokeRect(-90, -25, 180, 36);
    ctx.fillStyle = "#496038";
    ctx.textAlign = "center";
    text(ctx, "奶蛙目击者", 0, 0, 24, 162, 700);
    ctx.restore();
  }
  ctx.strokeStyle = "#bcc0af";
  ctx.beginPath();
  ctx.moveTo(60, 1312);
  ctx.lineTo(1020, 1312);
  ctx.stroke();
  ctx.fillStyle = "#334b3b";
  ctx.textAlign = "center";
  text(ctx, "欢迎关注微信公众号", 540, 1353, 31, 960);
  text(ctx, "CUC自然科学社", 540, 1400, 40, 960, 700);
  ctx.textAlign = "left";
  return canvas;
}
export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("图片生成失败，请使用截图模式。"))),
      "image/png",
    ),
  );
}
