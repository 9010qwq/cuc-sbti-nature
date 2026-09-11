import assert from "node:assert/strict";
import {
  defaultContent,
  profiles,
  questions,
  interests,
  interestQuestions,
} from "../src/data.ts";
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
  });
test("core questions keep five independent questions per axis", () => {
  assert.equal(questions.length, 20);
  assert.deepEqual(
    [0, 1, 2, 3].map((axis) => questions.filter((q) => q.axis === axis).length),
    [5, 5, 5, 5],
  );
  for (const q of questions) {
    for (const [answer, weight] of [2, 1, -1, -2].entries()) {
      const expected = [0, 0, 0, 0];
      expected[q.axis] = weight;
      assert.deepEqual(score(questions, { [q.id]: answer }), expected);
    }
  }
});

test("2.0 keeps raccoon and replaces magnet with rat king", () => {
  assert.equal(profiles.length, 16);
  assert.equal(profiles.find((p) => p.code === "BHTF")?.name, "浣熊");
  assert.equal(profiles.find((p) => p.code === "BHTP")?.name, "鼠王");
  assert.equal(profiles.find((p) => p.code === "BHTP")?.en, "RAT KING");
  assert.equal(profiles.find((p) => p.code === "BHSF")?.en, "EAT");
  assert.equal(
    profiles.some((p) => p.en === "LARVA"),
    false,
  );
});

test("four interest questions retain six fields outside core scoring", () => {
  assert.equal(interestQuestions.length, 4);
  assert.equal(interests.length, 6);
  assert.equal(
    interestQuestions.every((q) => q.options.length === 6),
    true,
  );
  const answers = Object.fromEntries(questions.map((q) => [q.id, 1]));
  const core = score(questions, answers);
  interestScores([5, 5, 5, 5]);
  assert.deepEqual(score(questions, answers), core);
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
test("configuration v2 round-trips and rejects v1 without mutating content", () => {
  assert.equal(defaultContent.version, 2);
  const saved = JSON.stringify(defaultContent);
  assert.deepEqual(validateContent(JSON.parse(saved)), defaultContent);
  const legacy = { ...structuredClone(defaultContent), version: 1 };
  assert.throws(() => validateContent(legacy), /2.0版.*1.0配置/);
  assert.equal(JSON.stringify(defaultContent), saved);
});
test("name truncation and empty name", () => {
  assert.equal(cleanName("  "), "匿名自然人");
  assert.equal(Array.from(cleanName("甲".repeat(80))).length, 12);
});
test("reserved imported IDs cannot bypass answer storage or completion", () => {
  for (const id of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf"]) {
    const c = structuredClone(defaultContent);
    c.questions[0].id = id;
    assert.throws(() => validateContent(c), /系统保留名称/);
  }
  const c = structuredClone(defaultContent);
  c.questions[0].id = "custom_q1";
  const valid = validateContent(c);
  assert.deepEqual(score(valid.questions, { custom_q1: 0 }), [2, 0, 0, 0]);
});
console.log(`Total ${checks} meaningful logic checks passed.`);
