import { DatabaseSync } from "node:sqlite";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CODES = [
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
const shapes = {
  page_view: [],
  quiz_start: ["repeat", "clue1"],
  question_reached: ["question"],
  quiz_complete: ["result", "subtype", "seconds", "revision"],
  result_revision: ["result", "subtype", "seconds", "revision"],
  egg_clue: ["clue"],
  egg_unlock: ["egg"],
  save_click: [],
  preview_ready: [],
  download_click: [],
  screenshot_click: [],
  export_failed: ["error"],
  page_error: ["error"],
};
export function exact(obj, keys) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.keys(obj).length === keys.length &&
    keys.every((k) => Object.hasOwn(obj, k))
  );
}
export function validEvent(e) {
  if (
    !exact(e, ["id", "name", "attempt", "props"]) ||
    !UUID.test(e.id) ||
    !Object.hasOwn(shapes, e.name) ||
    !(e.attempt === null || UUID.test(e.attempt)) ||
    !exact(e.props, shapes[e.name])
  )
    return false;
  const p = e.props;
  if (!["page_view", "egg_clue", "page_error"].includes(e.name) && !e.attempt)
    return false;
  if (e.name === "page_view" && e.attempt !== null) return false;
  if (
    "question" in p &&
    (!Number.isInteger(p.question) || p.question < 1 || p.question > 24)
  )
    return false;
  if ("repeat" in p && typeof p.repeat !== "boolean") return false;
  if ("clue1" in p && typeof p.clue1 !== "boolean") return false;
  if ("clue" in p && ![1, 2].includes(p.clue)) return false;
  if ("egg" in p && !["frog", "larva"].includes(p.egg)) return false;
  if (
    "error" in p &&
    !(
      e.name === "page_error" ? ["script", "promise"] : ["card", "png"]
    ).includes(p.error)
  )
    return false;
  if (
    "result" in p &&
    (!CODES.includes(p.result) ||
      !["standard", "foodie"].includes(p.subtype) ||
      !Number.isInteger(p.seconds) ||
      p.seconds < 0 ||
      p.seconds > 86400 ||
      !Number.isInteger(p.revision) ||
      p.revision < 1 ||
      p.revision > 100)
  )
    return false;
  if (e.name === "quiz_complete" && p.revision !== 1) return false;
  if (e.name === "result_revision" && p.revision < 2) return false;
  return true;
}
export function openStore(
  filename,
  { now = () => Date.now(), mode = "production", maxRows = 200000 } = {},
) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, received INTEGER NOT NULL, session TEXT NOT NULL, visitor TEXT NOT NULL, version TEXT NOT NULL, device TEXT NOT NULL, attempt TEXT, name TEXT NOT NULL, props TEXT NOT NULL, dedupe TEXT UNIQUE);
 CREATE INDEX IF NOT EXISTS event_time ON events(received);CREATE INDEX IF NOT EXISTS event_session ON events(session);CREATE INDEX IF NOT EXISTS event_attempt ON events(attempt);`);
  const previous = db.prepare("SELECT value FROM meta WHERE key=?").get("mode");
  if (previous && previous.value !== mode) {
    db.close();
    throw Error(
      "Database mode mismatch: testing data must never become production",
    );
  }
  db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run("mode", mode);
  db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run(
    "createdAt",
    new Date(now()).toISOString(),
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  function prune() {
    db.prepare("DELETE FROM events WHERE received<?").run(
      now() - 30 * 86400000,
    );
  }
  function ingest(identity, events) {
    if (
      !Array.isArray(events) ||
      !events.length ||
      events.length > 20 ||
      !events.every(validEvent)
    )
      throw Error("Invalid event schema");
    prune();
    if (
      db.prepare("SELECT COUNT(*) n FROM events").get().n + events.length >
      maxRows
    )
      throw Error("Capacity reached");
    let accepted = 0;
    db.exec("BEGIN");
    try {
      for (const e of events) {
        const once = [
          "page_view",
          "quiz_start",
          "quiz_complete",
          "question_reached",
          "egg_unlock",
          "egg_clue",
        ].includes(e.name);
        const dedupe = once
          ? [
              identity.session,
              e.attempt || "page",
              e.name,
              e.props.question || e.props.egg || e.props.clue || "",
            ].join(":")
          : null;
        const props = { ...e.props };
        if ("seconds" in props)
          props.seconds = Math.floor(props.seconds / 15) * 15;
        accepted += Number(
          insert.run(
            e.id,
            now(),
            identity.session,
            identity.visitor,
            identity.version,
            identity.device,
            e.attempt,
            e.name,
            JSON.stringify(props),
            dedupe,
          ).changes,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    if (accepted) {
      db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run(
        "firstReceived",
        String(now()),
      );
      db.prepare("INSERT OR REPLACE INTO meta VALUES (?,?)").run(
        "lastReceived",
        String(now()),
      );
    }
    return accepted;
  }
  function summary({
    from = now() - 7 * 86400000,
    to = now() + 1,
    version = "",
    device = "",
    offset = 480,
  } = {}) {
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from >= to ||
      to - from > 31 * 86400000 ||
      !Number.isInteger(offset) ||
      offset < -720 ||
      offset > 840 ||
      !["", "phone", "tablet", "desktop"].includes(device) ||
      (version && !/^\d+\.\d+\.\d+$/.test(version))
    )
      throw Error("Invalid filters");
    prune();
    // Bounded retained dataset. No event-level identifiers are returned by the private API.
    const all = db
      .prepare("SELECT rowid,* FROM events ORDER BY received,rowid")
      .all()
      .map((e) => ({ ...e, props: JSON.parse(e.props) }));
    const selected = all.filter(
      (e) =>
        (!version || e.version === version) && (!device || e.device === device),
    );
    const activity = selected.filter(
      (e) => e.received >= from && e.received < to,
    );
    const count = (rows) => ({
      events: rows.length,
      sessions: new Set(rows.map((e) => e.session)).size,
      visitors: new Set(rows.map((e) => e.visitor)).size,
    });
    const byEvent = Object.fromEntries(
      Object.keys(shapes).map((n) => [
        n,
        count(activity.filter((e) => e.name === n)),
      ]),
    );
    const key = (e) => e.session + ":" + e.attempt;
    const views = new Map(
      activity
        .filter((e) => e.name === "page_view")
        .map((e) => [e.session, e.received]),
    );
    const viewStarts = new Map(
      selected
        .filter(
          (e) =>
            e.name === "quiz_start" &&
            views.has(e.session) &&
            e.received >= views.get(e.session),
        )
        .map((e) => [key(e), e]),
    );
    const viewCompletions = new Map(
      selected
        .filter(
          (e) =>
            e.name === "quiz_complete" &&
            viewStarts.has(key(e)) &&
            e.received >= viewStarts.get(key(e)).received,
        )
        .map((e) => [key(e), e]),
    );
    const viewSaves = selected.filter(
      (e) =>
        e.name === "save_click" &&
        viewCompletions.has(key(e)) &&
        e.received >= viewCompletions.get(key(e)).received,
    );
    const visitFunnel = {
      viewSessions: views.size,
      startedSessions: count([...viewStarts.values()]).sessions,
      completedSessions: count([...viewCompletions.values()]).sessions,
      saveClickSessions: count(viewSaves).sessions,
    };
    const starts = selected.filter(
      (e) => e.name === "quiz_start" && e.received >= from && e.received < to,
    );
    const attempts = new Map(
      starts.map((e) => [
        key(e),
        {
          start: e,
          events: [],
          complete: null,
          latest: null,
          last: e.received,
        },
      ]),
    );
    for (const e of selected) {
      const a = attempts.get(key(e));
      if (!a || e.received < a.start.received) continue;
      a.events.push(e);
      a.last = Math.max(a.last, e.received);
      if (e.name === "quiz_complete" && !a.complete) a.complete = e;
      if (
        ["quiz_complete", "result_revision"].includes(e.name) &&
        (!a.latest || e.props.revision > a.latest.props.revision)
      )
        a.latest = e;
    }
    const list = [...attempts.values()],
      completed = list.filter((a) => a.complete);
    const funnel = {
      startedAttempts: list.length,
      completedAttempts: completed.length,
      previewAttempts: completed.filter((a) =>
        a.events.some((e) => e.name === "preview_ready"),
      ).length,
      downloadClickAttempts: completed.filter((a) =>
        a.events.some((e) => e.name === "download_click"),
      ).length,
    };
    const resultDistribution = CODES.map((code) => ({
      code,
      ...count(
        completed
          .filter((a) => a.latest?.props.result === code)
          .map((a) => a.start),
      ),
      attempts: completed.filter((a) => a.latest?.props.result === code).length,
    }));
    const durations = [
      ["0–2分钟", 0, 120],
      ["2–4分钟", 120, 240],
      ["4–6分钟", 240, 360],
      ["6–10分钟", 360, 600],
      ["10–30分钟", 600, 1800],
      ["30分钟以上", 1800, Infinity],
    ].map(([label, min, max]) => ({
      label,
      attempts: completed.filter(
        (a) =>
          a.complete.props.seconds >= min && a.complete.props.seconds < max,
      ).length,
    }));
    const questions = Array.from({ length: 24 }, (_, i) => {
      const q = i + 1;
      return {
        question: q,
        reached: list.filter((a) =>
          a.events.some(
            (e) => e.name === "question_reached" && e.props.question === q,
          ),
        ).length,
        timedOutIncomplete: list.filter(
          (a) =>
            !a.complete &&
            now() - a.last >= 30 * 60000 &&
            Math.max(
              0,
              ...a.events
                .filter((e) => e.name === "question_reached")
                .map((e) => e.props.question),
            ) === q,
        ).length,
      };
    });
    const eggs = ["frog", "larva"].map((egg) => ({
      egg,
      ...count(
        activity.filter((e) => e.name === "egg_unlock" && e.props.egg === egg),
      ),
    }));
    const groups = {};
    for (const e of activity) {
      const bucket =
        new Date(e.received + offset * 60000).toISOString().slice(0, 13) +
        ":00";
      const g = (groups[bucket] ??= {
        time: bucket,
        page_view: 0,
        quiz_start: 0,
        quiz_complete: 0,
        save_click: 0,
      });
      if (e.name in g) g[e.name]++;
    }
    const visitAttempts = new Map();
    for (const a of list)
      visitAttempts.set(
        a.start.visitor,
        (visitAttempts.get(a.start.visitor) || 0) + 1,
      );
    return {
      mode,
      createdAt: db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get("createdAt").value,
      firstReceived: db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get("firstReceived")
        ? Number(
            db
              .prepare("SELECT value FROM meta WHERE key=?")
              .get("firstReceived").value,
          )
        : null,
      lastReceived: db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get("lastReceived")
        ? Number(
            db.prepare("SELECT value FROM meta WHERE key=?").get("lastReceived")
              .value,
          )
        : null,
      asOf: now(),
      retentionDays: 30,
      filters: { from, to, version, device, offset },
      versions: [...new Set(all.map((e) => e.version))],
      activity: count(activity),
      byEvent,
      visitFunnel,
      funnel,
      resultDistribution,
      subtypes: ["standard", "foodie"].map((subtype) => ({
        subtype,
        attempts: completed.filter((a) => a.latest?.props.subtype === subtype)
          .length,
      })),
      eggs,
      durations,
      questions,
      trend: Object.values(groups),
      repeatBrowserVisitors: [...visitAttempts.values()].filter((n) => n > 1)
        .length,
      additionalAttempts: [...visitAttempts.values()].reduce(
        (n, v) => n + Math.max(0, v - 1),
        0,
      ),
      pendingAttempts: list.filter(
        (a) => !a.complete && now() - a.last < 30 * 60000,
      ).length,
      timedOutIncomplete: list.filter(
        (a) => !a.complete && now() - a.last >= 30 * 60000,
      ).length,
      share: "not_instrumentable",
    };
  }
  return { ingest, summary, prune, close: () => db.close(), db };
}
