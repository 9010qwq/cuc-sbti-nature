const $ = (id) => document.getElementById(id);
const names = {
  page_view: "页面打开",
  quiz_start: "开始测验",
  question_reached: "首次到达题目",
  quiz_complete: "首次完成",
  result_revision: "结果修订",
  egg_clue: "发现线索",
  egg_unlock: "首次解锁彩蛋",
  save_click: "保存图片点击",
  preview_ready: "PNG预览已生成",
  download_click: "下载按钮点击",
  screenshot_click: "截图模式点击",
  export_failed: "绘制/导出失败",
  page_error: "页面运行错误",
};
const roles = {
  BHTF: "浣熊",
  BHTP: "鼠王",
  BHSF: "黑洞",
  BHSP: "乌鸦",
  BOTF: "灰喜鹊",
  BOTP: "朱颈斑鸠",
  BOSF: "风滚草",
  BOSP: "星图",
  DHTF: "蜜蜂",
  DHTP: "砖头",
  DHSF: "蟑螂",
  DHSP: "晶体",
  DOTF: "菌丝",
  DOTP: "鲸",
  DOSF: "水豚",
  DOSP: "化石",
};
let latest = null;
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = String(text);
  return e;
};
function table(id, headers, rows) {
  const wrap = el("div");
  wrap.className = "table-scroll";
  const t = el("table"),
    head = el("thead"),
    tr = el("tr");
  headers.forEach((h) => tr.append(el("th", h)));
  head.append(tr);
  t.append(head);
  const body = el("tbody");
  for (const row of rows) {
    const r = el("tr");
    row.forEach((c) => r.append(el("td", c)));
    body.append(r);
  }
  if (!rows.length) {
    const r = el("tr"),
      c = el("td", "所选时段没有已收到的记录");
    c.colSpan = headers.length;
    r.append(c);
    body.append(r);
  }
  t.append(body);
  wrap.append(t);
  $(id).replaceChildren(wrap);
}
function cards(id, values) {
  $(id).replaceChildren(
    ...values.map(([label, n, note]) => {
      const e = el("div");
      e.className = "card";
      e.append(el("span", label), el("strong", n), el("small", note || ""));
      return e;
    }),
  );
}
function date(ms) {
  return ms === null
    ? "尚无记录"
    : new Date(ms + Number($("offset").value) * 60000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
}
function defaults() {
  const shift = Number($("offset").value) * 60000;
  const end = new Date(Date.now() + shift);
  $("to").value = new Date(end.getTime() + 60000).toISOString().slice(0, 16);
  $("from").value = new Date(end.getTime() - 7 * 86400000)
    .toISOString()
    .slice(0, 16);
}
async function load(e) {
  e?.preventDefault();
  $("status").textContent = "正在读取服务端数据…";
  $("status").className = "";
  $("export").disabled = true;
  latest = null;
  $("content").hidden = true;
  try {
    const shift = Number($("offset").value) * 60000;
    const params = new URLSearchParams({
      from: String(Date.parse($("from").value + "Z") - shift),
      to: String(Date.parse($("to").value + "Z") - shift),
      offset: $("offset").value,
      version: $("version").value,
      device: $("device").value,
    });
    const res = await fetch("/admin/api/summary?" + params, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw Error(
        res.status === 401
          ? "管理员认证失效"
          : res.status === 400
            ? "时间范围无效，最多选择31天"
            : "数据服务暂不可用",
      );
    const d = await res.json();
    latest = d;
    $("mode").textContent =
      d.mode === "production" ? "生产数据" : "测试数据库 · 非真实活动";
    $("mode").className = "badge " + (d.mode === "production" ? "" : "testing");
    $("freshness").textContent =
      `服务库建立：${d.createdAt} · 首次入库：${date(d.firstReceived)} · 最后入库：${date(d.lastReceived)} · 查询时间：${date(d.asOf)}。数据新鲜度请结合最后入库时间判断，安静时段不等于服务故障。`;
    const old = $("version").value;
    $("version").replaceChildren(
      new Option("全部版本", ""),
      ...d.versions.map((v) => new Option(v, v)),
    );
    $("version").value = old;
    if (d.firstReceived === null) {
      $("status").textContent =
        "统计服务可连接，但尚未收到事件。不能据此断言活动访问为0；请检查前端是否接入、用户是否同意以及网络是否可达。";
      return;
    }
    $("status").textContent =
      d.mode === "production"
        ? "以下为已收到的真实采集事件；不是全体活动人数。"
        : "以下全部来自隔离测试库，不能作为真实活动成绩。";
    $("content").hidden = false;
    $("export").disabled = false;
    cards("cards", [
      ["页面打开", d.byEvent.page_view.events, "事件次数"],
      ["匿名浏览器", d.activity.visitors, "按随机标识估算，非人数"],
      ["页面会话", d.activity.sessions, "每次打开产生新会话"],
      ["保存点击", d.byEvent.save_click.events, "不代表保存成功"],
    ]);
    const f = d.funnel;
    const visits = d.visitFunnel;
    $("visits").textContent =
      `访问批次漏斗：${visits.viewSessions} 个页面会话打开 → ${visits.startedSessions} 个开始 → ${visits.completedSessions} 个完成 → ${visits.saveClickSessions} 个点击保存。按所选时段打开的会话关联后续操作，不按人数计数。`;
    cards("funnel", [
      ["开始测验", f.startedAttempts, "所选时段开始批次"],
      [
        "完成测验",
        f.completedAttempts,
        f.startedAttempts
          ? `${((f.completedAttempts / f.startedAttempts) * 100).toFixed(1)}% 完成率`
          : "暂无开始批次",
      ],
      ["生成PNG预览", f.previewAttempts, "按已完成测验去重"],
      ["点击下载", f.downloadClickAttempts, "无法确认系统保存"],
    ]);
    $("pending").textContent =
      `未满30分钟待观察：${d.pendingAttempts} 次；超时未完成推算：${d.timedOutIncomplete} 次。同匿名浏览器多次测验：${d.repeatBrowserVisitors} 个浏览器、额外 ${d.additionalAttempts} 次测验，无法区分同人重测/下一位。`;
    table(
      "trend",
      ["时间", "打开", "开始", "完成", "保存点击"],
      d.trend.map((r) => [
        r.time,
        r.page_view,
        r.quiz_start,
        r.quiz_complete,
        r.save_click,
      ]),
    );
    table(
      "results",
      ["原形", "完成测验", "匿名浏览器"],
      d.resultDistribution.map((r) => [
        roles[r.code] + " " + r.code,
        r.attempts,
        r.visitors,
      ]),
    );
    table(
      "subtypes",
      ["现有卡片小类", "完成测验"],
      d.subtypes.map((r) => [
        r.subtype === "foodie" ? "狂吃型探索者" : "标准卡片",
        r.attempts,
      ]),
    );
    table(
      "eggs",
      ["彩蛋", "解锁事件", "会话", "匿名浏览器"],
      d.eggs.map((r) => [
        r.egg === "frog" ? "奶蛙目击者" : "快乐搭子",
        r.events,
        r.sessions,
        r.visitors,
      ]),
    );
    table(
      "durations",
      ["首次完成用时", "测验次数"],
      d.durations.map((r) => [r.label, r.attempts]),
    );
    table(
      "questions",
      ["题号", "到达测验数", "最高到达此题且超时未完成"],
      d.questions.map((r) => [r.question, r.reached, r.timedOutIncomplete]),
    );
    table(
      "events",
      ["操作", "事件次数", "会话", "匿名浏览器"],
      Object.entries(d.byEvent).map(([n, r]) => [
        names[n],
        r.events,
        r.sessions,
        r.visitors,
      ]),
    );
  } catch (error) {
    $("status").textContent = error.message + "。当前没有可用读数，不显示为0。";
    $("status").className = "error";
    $("mode").textContent = "未取得数据";
  }
}
$("filters").addEventListener("submit", load);
$("offset").addEventListener("change", defaults);
$("export").addEventListener("click", () => {
  if (!latest) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" }),
  );
  const a = el("a");
  a.href = url;
  a.download = `SBTI-${latest.mode}-summary.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
defaults();
void load();
