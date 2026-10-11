// Optional, consent-based first-party telemetry. Never pass answer/content objects here.
export type EventName =
  | "page_view"
  | "quiz_start"
  | "question_reached"
  | "quiz_complete"
  | "result_revision"
  | "egg_clue"
  | "egg_unlock"
  | "save_click"
  | "preview_ready"
  | "download_click"
  | "screenshot_click"
  | "export_failed"
  | "page_error";
type Props = {
  question?: number;
  result?: string;
  subtype?: "standard" | "foodie";
  seconds?: number;
  revision?: number;
  egg?: "frog" | "larva";
  clue?: 1 | 2;
  error?: "script" | "promise" | "card" | "png";
  repeat?: boolean;
  clue1?: boolean;
};
type Event = {
  id: string;
  name: EventName;
  attempt: string | null;
  props: Props;
};
const configured = String(import.meta.env.VITE_ANALYTICS_URL || "").replace(
  /\/$/,
  "",
);
const isLocal = (s: string) =>
  /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(s);
const validOrigin = (() => {
  try {
    return new URL(configured).origin === configured;
  } catch {
    return false;
  }
})();
export const analyticsConfigured =
  validOrigin &&
  (/^https:\/\/[^/?#]+$/.test(configured) ||
    (import.meta.env.DEV && isLocal(configured)) ||
    (import.meta.env.MODE === "analytics-test" && isLocal(configured)));
const version = "2.2.0";
let consent = false,
  visitor = "",
  session = "",
  attempt: string | null = null,
  started = 0,
  result = "",
  revision = 0,
  starts = 0;
let queue: Event[] = [],
  pending = false,
  timer = 0,
  token = "",
  disposed = 0;
let inDemo = false;
const once = new Set<string>();
const uuid = () => crypto.randomUUID();
const blocked = () =>
  navigator.doNotTrack === "1" ||
  (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl === true;
const storage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
export const analyticsEnabled = () =>
  analyticsConfigured && consent && !blocked();
export function setAnalyticsConsent(value: boolean) {
  try {
    consent = value && analyticsConfigured && !blocked();
    disposed++;
    token = "";
    queue = [];
    once.clear();
    attempt = null;
    result = "";
    starts = 0;
    if (!consent) {
      storage.remove("sbti-analytics-consent");
      storage.remove("sbti-analytics-visitor");
      return;
    }
    const prior = JSON.parse(storage.get("sbti-analytics-visitor") || "null");
    visitor =
      prior && prior.expires > Date.now() && /^[\da-f-]{36}$/.test(prior.id)
        ? prior.id
        : uuid();
    session = uuid();
    storage.set(
      "sbti-analytics-visitor",
      JSON.stringify({
        id: visitor,
        expires:
          prior?.id === visitor ? prior.expires : Date.now() + 30 * 86400000,
      }),
    );
    storage.set("sbti-analytics-consent", "yes");
    emit("page_view", {}, "page");
  } catch {
    consent = false;
  }
}
function emit(name: EventName, props: Props = {}, key?: string) {
  try {
    if (!analyticsEnabled() || inDemo || queue.length >= 80) return;
    if (!attempt && !["page_view", "egg_clue", "page_error"].includes(name))
      return;
    if (key) {
      if (once.has(key)) return;
      once.add(key);
    }
    queue.push({ id: uuid(), name, attempt, props });
    clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), 200);
  } catch {
    /* Optional telemetry cannot interrupt the activity. */
  }
}
async function flush() {
  if (pending || !queue.length || !analyticsEnabled()) return;
  pending = true;
  const generation = disposed;
  const batch = queue.splice(0, 20);
  try {
    const request = (route: string, data: unknown) =>
      fetch(configured + route, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(3000),
        keepalive: true,
      });
    const authorize = async () => {
      const res = await request("/session", {
        visitor,
        session,
        version,
        device: matchMedia("(pointer: coarse)").matches
          ? innerWidth < 768
            ? "phone"
            : "tablet"
          : "desktop",
      });
      if (!res.ok || generation !== disposed || !analyticsEnabled())
        return false;
      token = (await res.json()).token;
      return true;
    };
    if (!token && !(await authorize())) return;
    if (generation !== disposed || !analyticsEnabled()) return;
    const res = await request("/collect", { token, events: batch });
    if (res.status === 401) {
      token = "";
      if (await authorize())
        await request("/collect", { token, events: batch });
    }
    // At most one retry, reusing event IDs. Delivery is best effort, never blocking UI.
    if (res.status >= 500 && generation === disposed && analyticsEnabled())
      await request("/collect", { token, events: batch });
  } catch {
    /* Drop failures: no offline personal-data queue or unbounded retry. */
  } finally {
    pending = false;
    if (queue.length) timer = window.setTimeout(() => void flush(), 500);
  }
}
export function analyticsStart(clue1 = false) {
  try {
    inDemo = false;
    if (!analyticsEnabled()) return;
    attempt = uuid();
    started = performance.now();
    result = "";
    revision = 0;
    starts++;
    emit("quiz_start", { repeat: starts > 1, clue1 }, attempt + ":start");
  } catch {}
}
export function analyticsQuestion(question: number) {
  if (attempt)
    emit("question_reached", { question }, attempt + ":q" + question);
}
export function analyticsComplete(code: string, foodie: boolean) {
  if (!attempt) return;
  const next = code + ":" + foodie;
  if (next === result) return;
  const first = !result;
  result = next;
  revision++;
  emit(
    first ? "quiz_complete" : "result_revision",
    {
      result: code,
      subtype: foodie ? "foodie" : "standard",
      seconds: Math.min(
        86400,
        Math.round((performance.now() - started) / 1000),
      ),
      revision,
    },
    first ? attempt + ":complete" : undefined,
  );
}
export function analyticsEvent(
  name: EventName,
  props: Props = {},
  unique?: string,
) {
  emit(name, props, unique ? (attempt || session) + ":" + unique : undefined);
}
export function analyticsReset(demo = false) {
  attempt = null;
  result = "";
  inDemo = demo;
}
// Async export callbacks must not attach to a newly started participant's attempt.
export function analyticsOperation() {
  const captured = attempt,
    generation = disposed;
  return (name: EventName, props: Props = {}) => {
    if (captured && attempt === captured && generation === disposed)
      analyticsEvent(name, props);
  };
}
export function analyticsPrivacy() {
  if (!analyticsConfigured) return "";
  return `<section class="analytics-privacy"><p>可选活动统计：经你同意，仅记录匿名随机标识、访问/答题进度、结果类型、彩蛋、用时区间及保存等操作；不发送昵称、逐题答案或联系方式。保留30天，浏览器/会话数不等于人数，点击不等于保存或分享成功。服务连接会向运营方提供网络地址，但应用不将其写入统计库。拒绝不影响测试。</p><button type="button" class="textbtn" data-action="analytics-consent">${analyticsEnabled() ? "关闭活动统计" : "同意参与活动统计"}</button><span>${blocked() ? "已遵循浏览器隐私偏好，统计关闭。" : analyticsEnabled() ? "活动统计已开启，可随时关闭。" : "活动统计未开启。"}</span></section>`;
}
try {
  if (analyticsConfigured && storage.get("sbti-analytics-consent") === "yes")
    setAnalyticsConsent(true);
  if (analyticsConfigured) {
    addEventListener("error", () =>
      analyticsEvent("page_error", { error: "script" }, "script-error"),
    );
    addEventListener("unhandledrejection", () =>
      analyticsEvent("page_error", { error: "promise" }, "promise-error"),
    );
    addEventListener("pagehide", () => {
      void flush();
    }); // Not an abandonment event.
  }
} catch {
  /* Fail closed. */
}
