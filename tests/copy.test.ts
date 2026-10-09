import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { axes, interestQuestions, interests, profiles, questions, type Profile } from "../src/data.ts";
import { validateContent } from "../src/logic.ts";
import { defaultContent } from "../src/data.ts";

interface CopyChange {
  id: string;
  file: string;
  after: string;
}
const changes: CopyChange[] = JSON.parse(
  readFileSync(new URL("./fixtures/copy-v2.1.0.json", import.meta.url), "utf8"),
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const axisIds = ["attention", "approach", "company", "pace"];
let checks = 0;
for (const change of changes) {
  const parts = change.id.split(".");
  let actual: unknown;
  if (parts[0] === "questions") {
    const question = questions.find((q) => q.id === parts[1]);
    actual = parts[2] === "title" ? question?.title : question?.options[Number(parts[3])];
  } else if (parts[0] === "profiles") {
    const profile = profiles.find((p) => p.code === parts[1]);
    actual = profile?.[parts[2] as keyof Profile];
  } else if (parts[0] === "axes") {
    actual = axes[axisIds.indexOf(parts[1])]?.hint;
  } else if (parts[0] === "interests") {
    actual = interests.find((interest) => interest.id === parts[1])?.name;
  } else if (parts[0] === "interestQuestions") {
    const question = interestQuestions[Number(parts[1].slice(1)) - 1];
    actual = question?.options[Number(parts[3])];
  } else if (parts[0] === "src" && change.file === "src/main.ts") {
    assert(mainSource.includes(change.after), change.id);
    checks++;
    continue;
  } else {
    throw Error(`Unrecognized copy ID ${change.id}`);
  }
  assert.equal(actual, change.after, change.id);
  checks++;
}
assert.equal(new Set(changes.map((c) => c.id)).size, changes.length);
assert.equal(questions.find((q) => q.id === "q14")?.options[1], "讲解操作两不误，不听讲解会错过蛮多的欸……", "q14 keeps the clarified wording");
assert.equal(questions.find((q) => q.id === "q03")?.options[1], "问问谁想去，有伴更合心意。");
assert.equal(questions.find((q) => q.id === "q14")?.options[3], "跟着实时画面看月面细节，听大家说发现。");
validateContent(defaultContent);
for (const id of ["bird", "plant", "food"]) {
  const label = interests.find((interest) => interest.id === id)?.name;
  assert(label && mainSource.includes(label), `${id} label matches homepage`);
}
console.log(`PASS ${checks} version 2.1.0 copy values match their stable IDs`);
console.log("PASS unchanged options preserved and clarified wording applied");
console.log("PASS content length limits and duplicate interest labels");
