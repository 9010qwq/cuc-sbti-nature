import assert from "node:assert/strict";
import { defaultContent, profiles, questions } from "../src/data.ts";
import {
  classify,
  score,
  tagSelection,
  interestScores,
  validateContent,
  cleanName,
} from "../src/logic.ts";
let checks = 0;
const test = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log("PASS " + name);
};
for (const p of profiles)
  test("reachable " + p.code, () => {
    const a: Record<string, number> = {};
    questions.forEach(
      (q) =>
        (a[q.id] =
          p.code[q.axis] === "B" ||
          p.code[q.axis] === "H" ||
          p.code[q.axis] === "T" ||
          p.code[q.axis] === "F"
            ? 0
            : 3),
    );
    assert.equal(classify(score(questions, a)), p.code);
    assert.equal(classify(score(questions, a)), p.code);
  });
test("zero requires tie rather than random type", () => {
  assert.equal(classify([0, 0, 0, 0]), "????");
  assert.equal(classify([0, 0, 0, 0], { 0: 1, 1: -1, 2: 1, 3: -1 }), "BOTP");
});
test("back-edit replaces prior score, not accumulated", () => {
  const a = Object.fromEntries(questions.map((q) => [q.id, 0]));
  assert.deepEqual(score(questions, a), [10, 10, 10, 10]);
  a.q01 = 3;
  assert.deepEqual(score(questions, a), [6, 10, 10, 10]);
});
test("explicit zero reachable in 5 answers", () => {
  const a: Record<string, number> = {};
  questions.forEach((q, i) => (a[q.id] = [0, 0, 3, 2, 2][Math.floor(i / 4)]));
  assert.deepEqual(score(questions, a), [0, 0, 0, 0]);
});
test("interest ties require user, no arbitrary pick", () => {
  assert.deepEqual(tagSelection(interestScores([0, 1, 2, 3])), {
    fixed: [],
    candidates: [0, 1, 2, 3],
    slots: 2,
  });
  assert.deepEqual(tagSelection(interestScores([5, 5, 0, 1])), {
    fixed: [5],
    candidates: [0, 1],
    slots: 1,
  });
  assert.deepEqual(tagSelection(interestScores([5, 5, 5, 5])), {
    fixed: [5],
    candidates: [],
    slots: 0,
  });
});
test("configuration validation rejects malformed data", () => {
  validateContent(defaultContent);
  for (const mutate of [
    (c: any) => c.questions.pop(),
    (c: any) => (c.questions[0].id = c.questions[1].id),
    (c: any) => (c.profiles[0].color = "red;position:fixed"),
    (c: any) => (c.welcome = "hello"),
    (c: any) => (c.profiles[0].code = "BHSF"),
  ]) {
    const c = structuredClone(defaultContent);
    mutate(c);
    assert.throws(() => validateContent(c));
  }
});
test("name truncation and empty name", () => {
  assert.equal(cleanName("  "), "匿名自然人");
  assert.equal(Array.from(cleanName("甲".repeat(80))).length, 12);
});
console.log(`Total ${checks} meaningful logic checks passed.`);
