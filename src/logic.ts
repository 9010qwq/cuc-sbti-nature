import { axes, WELCOME, type Content, type Question } from "./data.ts";
export const weights = [2, 1, -1, -2];
export function score(questions: Question[], answers: Record<string, number>) {
  const scores = [0, 0, 0, 0];
  for (const q of questions) {
    const a = answers[q.id];
    if (Number.isInteger(a) && a >= 0 && a < 4) scores[q.axis] += weights[a];
  }
  return scores;
}
export function classify(scores: number[], ties: Record<number, number> = {}) {
  return scores
    .map((v, i) =>
      v === 0
        ? ties[i] === undefined
          ? "?"
          : axes[i].letters[ties[i] > 0 ? 0 : 1]
        : axes[i].letters[v > 0 ? 0 : 1],
    )
    .join("");
}
export function interestScores(answers: number[]) {
  const s = [0, 0, 0, 0, 0, 0];
  for (const a of answers) if (Number.isInteger(a) && a >= 0 && a < 6) s[a]++;
  return s;
}
export function tagSelection(scores: number[]) {
  const sorted = scores
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.i - b.i);
  if (sorted.length <= 2)
    return { fixed: sorted.map((x) => x.i), candidates: [], slots: 0 };
  const cutoff = sorted[1].v;
  const fixed = sorted.filter((x) => x.v > cutoff).map((x) => x.i),
    boundary = sorted.filter((x) => x.v === cutoff).map((x) => x.i);
  return boundary.length <= 2 - fixed.length
    ? { fixed: [...fixed, ...boundary], candidates: [], slots: 0 }
    : { fixed, candidates: boundary, slots: 2 - fixed.length };
}
export function cleanName(name: string) {
  return (
    Array.from(name.replace(/[\u0000-\u001f\u007f]/g, "").trim())
      .slice(0, 12)
      .join("") || "匿名自然人"
  );
}
export function validateContent(input: unknown): Content {
  if (!input || typeof input !== "object") throw Error("配置必须是对象。");
  const c = input as Content;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (c.version !== 2)
    throw Error(
      "请使用2.x版导出的配置（version: 2）。1.0配置含旧角色，不能直接导入；当前内容未更改。",
    );
  if (!str(c.event, 40)) throw Error("活动署名需为1—40字。");
  if (c.welcome !== WELCOME) throw Error("公众号关注文案必须完整保留。");
  if (!Array.isArray(c.questions) || c.questions.length !== 20)
    throw Error("需有20道核心题。");
  const ids = new Set<string>();
  const counts = [0, 0, 0, 0];
  for (const q of c.questions) {
    if (!str(q.id, 30) || ids.has(q.id)) throw Error("题目ID为空或重复。");
    if (q.id in Object.prototype || q.id === "prototype")
      throw Error("题目ID不能使用系统保留名称，请换一个ID。");
    ids.add(q.id);
    if (!Number.isInteger(q.axis) || q.axis < 0 || q.axis > 3)
      throw Error("题目维度只能为0—3。");
    counts[q.axis]++;
    if (
      !str(q.title, 100) ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      q.options.some((x) => !str(x, 140))
    )
      throw Error("题干最多100字，每题需4个不超过140字的选项。");
  }
  if (counts.some((n) => n !== 5)) throw Error("每个维度必须恰好5题。");
  if (!Array.isArray(c.profiles) || c.profiles.length !== 16)
    throw Error("需保留16个类型。");
  const codes = new Set<string>();
  for (const p of c.profiles) {
    if (!/^[BD][HO][TS][FP]$/.test(p.code) || codes.has(p.code))
      throw Error("类型代码错误或重复。");
    codes.add(p.code);
    for (const k of [
      "name",
      "en",
      "quote",
      "body",
      "strength",
      "quirk",
      "task",
    ] as const) {
      const max = {
        name: 12,
        en: 12,
        quote: 38,
        body: 350,
        strength: 160,
        quirk: 160,
        task: 180,
      }[k];
      if (!str(p[k], max))
        throw Error(`${p.code} 的 ${k} 为空或超过${max}字。`);
    }
    if (!/^#[a-fA-F0-9]{6}$/.test(p.color))
      throw Error("颜色需为六位十六进制。");
  }
  if (c.profiles.find((p) => p.code === "BHSF")?.en !== "EAT")
    throw Error("黑洞趣味英文名请保留 EAT。");
  return JSON.parse(JSON.stringify(c));
}
