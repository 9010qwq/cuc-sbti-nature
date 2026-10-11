import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openStore, validEvent } from "../analytics/store.mjs";
import { createAnalyticsServer, passwordHash } from "../analytics/server.mjs";
const identity = () => ({
  visitor: randomUUID(),
  session: randomUUID(),
  version: "2.2.0",
  device: "phone",
});
const event = (name, attempt = null, props = {}) => ({
  id: randomUUID(),
  name,
  attempt,
  props,
});
const start = (id) => event("quiz_start", id, { repeat: false, clue1: true });
const complete = (id, result = "BHSF", revision = 1) =>
  event(revision === 1 ? "quiz_complete" : "result_revision", id, {
    result,
    subtype: "foodie",
    seconds: 242,
    revision,
  });
test("strict schema rejects answers, free text, fabricated share events and invalid ranges", () => {
  const e = event("page_view");
  assert(validEvent(e));
  assert(!validEvent({ ...e, answers: [] }));
  assert(!validEvent({ ...e, props: { nickname: "secret" } }));
  assert(!validEvent(event("share_click", randomUUID())));
  assert(
    !validEvent(event("question_reached", randomUUID(), { question: 25 })),
  );
  assert(!validEvent(complete(randomUUID(), "FAKE")));
  assert(
    !validEvent(
      event("export_failed", randomUUID(), { error: "private stack" }),
    ),
  );
});
test("event and semantic deduplication; revisions retain one completed attempt", () => {
  const s = openStore(":memory:");
  try {
    const i = identity(),
      a = randomUUID(),
      c = complete(a);
    s.ingest(i, [
      event("page_view"),
      start(a),
      event("question_reached", a, { question: 1 }),
      c,
    ]);
    s.ingest(i, [
      c,
      event("question_reached", a, { question: 1 }),
      complete(a),
      complete(a, "DHTP", 2),
    ]);
    const r = s.summary();
    assert.equal(r.funnel.completedAttempts, 1);
    assert.equal(r.byEvent.quiz_complete.events, 1);
    assert.equal(r.questions[0].reached, 1);
    assert.equal(
      r.resultDistribution.find((x) => x.code === "DHTP").attempts,
      1,
    );
    assert.equal(
      r.resultDistribution.find((x) => x.code === "BHSF").attempts,
      0,
    );
    assert.equal(r.subtypes.find((x) => x.subtype === "foodie").attempts, 1);
    assert.equal(r.durations[2].attempts, 1);
    assert(!JSON.stringify(r).includes(i.visitor));
  } finally {
    s.close();
  }
});
test("late completion and revision belong to the original start cohort across midnight", () => {
  let now = Date.parse("2026-10-11T15:59:00Z");
  const s = openStore(":memory:", { now: () => now }),
    i = identity(),
    a = randomUUID(),
    from = now - 1000,
    to = now + 30000;
  try {
    s.ingest(i, [start(a)]);
    now += 120000;
    s.ingest(i, [complete(a)]);
    now += 1000;
    s.ingest(i, [complete(a, "BHTF", 2)]);
    const r = s.summary({ from, to });
    assert.equal(r.funnel.completedAttempts, 1);
    assert.equal(r.byEvent.quiz_complete.events, 0);
    assert.equal(
      r.resultDistribution.find((x) => x.code === "BHTF").attempts,
      1,
    );
  } finally {
    s.close();
  }
});
test("only 30-minute inactivity infers noncompletion; later completion reverses it", () => {
  let now = Date.now();
  const s = openStore(":memory:", { now: () => now }),
    i = identity(),
    a = randomUUID();
  try {
    s.ingest(i, [start(a), event("question_reached", a, { question: 7 })]);
    assert.equal(s.summary().pendingAttempts, 1);
    now += 31 * 60000;
    assert.equal(s.summary().timedOutIncomplete, 1);
    assert.equal(s.summary().questions[6].timedOutIncomplete, 1);
    s.ingest(i, [complete(a)]);
    assert.equal(s.summary().timedOutIncomplete, 0);
  } finally {
    s.close();
  }
});
test("anonymous browser repeats, egg deduplication and version/device filters", () => {
  const s = openStore(":memory:"),
    i = identity(),
    a = randomUUID(),
    b = randomUUID();
  try {
    s.ingest(i, [
      start(a),
      complete(a),
      event("egg_unlock", a, { egg: "frog" }),
      event("egg_unlock", a, { egg: "frog" }),
      start(b),
      complete(b),
      event("egg_unlock", b, { egg: "frog" }),
    ]);
    const r = s.summary();
    assert.equal(r.eggs[0].events, 2);
    assert.equal(r.eggs[0].visitors, 1);
    assert.equal(r.repeatBrowserVisitors, 1);
    assert.equal(r.additionalAttempts, 1);
    assert.equal(s.summary({ version: "2.1.0" }).activity.events, 0);
    assert.equal(s.summary({ device: "desktop" }).funnel.startedAttempts, 0);
  } finally {
    s.close();
  }
});
test("retention deletes old events and empty data remains distinguishable", () => {
  let now = Date.now();
  const s = openStore(":memory:", { now: () => now });
  try {
    assert.equal(s.summary().firstReceived, null);
    s.ingest(identity(), [event("page_view")]);
    now += 31 * 86400000;
    s.prune();
    assert.equal(s.summary().activity.events, 0);
    assert.equal(typeof s.summary().firstReceived, "number");
  } finally {
    s.close();
  }
});
test("private API auth, origin checks, token verification, payload limits, no public event reading", async () => {
  const store = openStore(":memory:", { mode: "testing" }),
    pass = randomUUID();
  const server = createAnalyticsServer({
    store,
    mode: "testing",
    origins: ["https://site.example"],
    adminHash: passwordHash(pass),
    publicOrigin: "http://127.0.0.1:8788",
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`,
    auth = "Basic " + Buffer.from("admin:" + pass).toString("base64");
  const post = (route, data, origin = "https://site.example") =>
    fetch(base + route, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    for (const route of ["/admin/", "/admin/api/summary", "/admin/app.js"])
      assert.equal((await fetch(base + route)).status, 401);
    assert.equal(
      (
        await fetch(base + "/admin/api/summary", {
          headers: { Authorization: auth },
        })
      ).status,
      200,
    );
    assert.equal(
      (await post("/session", identity(), "https://evil.example")).status,
      403,
    );
    assert.equal(
      (await post("/session", { ...identity(), name: "private" })).status,
      400,
    );
    const i = identity(),
      token = (await (await post("/session", i)).json()).token;
    assert.equal(
      (
        await post("/collect", {
          token: "forged",
          events: [event("page_view")],
        })
      ).status,
      401,
    );
    assert.equal(
      (await post("/collect", { token, events: [event("page_view")] })).status,
      200,
    );
    assert.equal(
      (
        await post("/collect", {
          token,
          events: [{ ...event("page_view"), answers: [1] }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/collect", {
          token,
          events: [],
          padding: "x".repeat(20000),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(base + "/collect", {
          headers: { Origin: "https://site.example" },
        })
      ).status,
      405,
    );
    const body = await (
      await fetch(base + "/admin/api/summary", {
        headers: { Authorization: auth },
      })
    ).text();
    assert(!body.includes(i.visitor));
    assert(!body.includes(i.session));
    assert.equal(
      (
        await fetch(base + "/admin/api/summary?version=%27OR1=1", {
          headers: { Authorization: auth },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/admin/api/summary", {
          method: "POST",
          headers: { Authorization: auth },
        })
      ).status,
      405,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});
test("production refuses missing authentication and HTTP deployment", () => {
  const store = openStore(":memory:");
  try {
    assert.throws(() =>
      createAnalyticsServer({
        store,
        origins: ["https://site.example"],
        publicOrigin: "https://stats.example",
      }),
    );
    assert.throws(() =>
      createAnalyticsServer({
        store,
        origins: ["https://site.example"],
        adminHash: passwordHash(randomUUID()),
        publicOrigin: "http://stats.example",
      }),
    );
  } finally {
    store.close();
  }
});
test("SQLite survives restart and refuses mixing testing and production", () => {
  const directory = resolve("test-results");
  mkdirSync(directory, { recursive: true });
  const filename = resolve(directory, "analytics-" + randomUUID() + ".sqlite");
  let store = openStore(filename, { mode: "testing" });
  try {
    store.ingest(identity(), [event("page_view")]);
    store.close();
    store = null;
    assert.throws(
      () => openStore(filename, { mode: "production" }),
      /mode mismatch/,
    );
    store = openStore(filename, { mode: "testing" });
    assert.equal(store.summary().byEvent.page_view.events, 1);
  } finally {
    store?.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(filename + suffix);
      } catch {}
    }
  }
});
test("shared campus exit permits 50 sessions; signed sessions expire", async () => {
  let clock = Date.now();
  const store = openStore(":memory:", { mode: "testing" });
  const server = createAnalyticsServer({
    store,
    mode: "testing",
    origins: ["https://site.example"],
    publicOrigin: "http://127.0.0.1:8788",
    adminHash: passwordHash(randomUUID()),
    now: () => clock,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        Origin: "https://site.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  try {
    let token;
    for (let n = 0; n < 50; n++) {
      const res = await post("/session", identity());
      assert.equal(res.status, 200);
      token = (await res.json()).token;
    }
    clock += 3600001;
    assert.equal(
      (await post("/collect", { token, events: [event("page_view")] })).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});
test("visit funnel deduplicates multiple attempts in one page session", () => {
  const s = openStore(":memory:"),
    i = identity(),
    a = randomUUID(),
    b = randomUUID();
  try {
    s.ingest(i, [
      event("page_view"),
      start(a),
      complete(a),
      event("save_click", a),
      start(b),
      complete(b),
    ]);
    assert.deepEqual(s.summary().visitFunnel, {
      viewSessions: 1,
      startedSessions: 1,
      completedSessions: 1,
      saveClickSessions: 1,
    });
    assert.equal(s.summary().funnel.startedAttempts, 2);
  } finally {
    s.close();
  }
});
