import "./font.css";
import "./style.css";
import { art } from "./assets";
import {
  axes,
  defaultContent,
  interests,
  interestQuestions,
  tiebreak,
  WELCOME,
  type Content,
  type Profile,
} from "./data";
import {
  score,
  classify,
  interestScores,
  tagSelection,
  cleanName,
  validateContent,
} from "./logic";
import { drawCard, canvasBlob, type CardData } from "./card";
const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    toast("设置仅在本次打开期间生效。");
  }
};
let content: Content = structuredClone(defaultContent);
try {
  const saved = read("sbti-content-v1");
  if (saved) content = validateContent(JSON.parse(saved));
} catch {
  /* A damaged saved configuration must not prevent startup. */
}
let sound = read("sbti-sound") === "true",
  reduce =
    read("sbti-reduce") === "true" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
type Page =
  | "home"
  | "quiz"
  | "observe"
  | "tie"
  | "tags"
  | "reveal"
  | "result"
  | "gallery"
  | "help"
  | "staff";
let page: Page = "home",
  lastPage: Page = "home",
  index = 0,
  name = "",
  answers: Record<string, number> = {},
  ia: number[] = [],
  ties: Record<number, number> = {},
  tags: number[] = [],
  pendingTags: number[] = [],
  seen1 = false,
  seen2 = false,
  observed = false,
  frog = false,
  demo = false,
  resultCode = "",
  galleryProfile = "",
  cardReady = false,
  cardJob = 0,
  revealTimer = 0,
  toastTimer = 0;
const img = (code: string, cls = "", alt = "") =>
  `<img class="${cls}" src="${art[code]}" alt="${esc(alt)}" decoding="async" loading="${cls ? "eager" : "lazy"}">`;
const btn = (action: string, label: string, cls = "secondary", extra = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
function toast(message: string) {
  document.querySelector("#toast")?.remove();
  clearTimeout(toastTimer);
  const e = document.createElement("div");
  e.id = "toast";
  e.setAttribute("role", "status");
  e.textContent = message;
  document.body.append(e);
  toastTimer = window.setTimeout(() => e.remove(), 4200);
}
let audio: AudioContext | null = null;
function tick() {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(530, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(760, audio.currentTime + 0.07);
    g.gain.setValueAtTime(0.035, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.13);
  } catch {}
}
function go(p: Page, scroll = true) {
  clearTimeout(revealTimer);
  page = p;
  render();
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
}
function reset() {
  name = "";
  answers = {};
  ia = [];
  ties = {};
  tags = [];
  pendingTags = [];
  seen1 = false;
  seen2 = false;
  observed = false;
  frog = false;
  demo = false;
  resultCode = "";
  index = 0;
  galleryProfile = "";
  go("home");
}
function scores() {
  return score(content.questions, answers);
}
function currentProfile() {
  return content.profiles.find((p) => p.code === resultCode)!;
}
function chooseTags() {
  const choice = tagSelection(interestScores(ia));
  tags = [...choice.fixed];
  pendingTags = [];
  if (choice.candidates.length) go("tags");
  else finish();
}
function resolveResult() {
  const ss = scores();
  if (ss.some((v, i) => v === 0 && ties[i] === undefined)) go("tie");
  else chooseTags();
}
function finish() {
  resultCode = classify(scores(), ties);
  demo = false;
  if (resultCode.includes("?")) {
    go("tie");
    return;
  }
  go("reveal");
  revealTimer = window.setTimeout(
    () => {
      if (page === "reveal") go("result");
    },
    reduce ? 0 : 1500,
  );
}
function box(stage: number) {
  return `<button type="button" class="mystery-box ${stage === 2 ? "wobble" : ""} ${(stage === 1 && seen1) || (stage === 2 && seen2) ? "found" : ""}" data-action="clue${stage}" aria-label="${stage === 1 ? "查看箱底露出的脚" : "查看正在移动的箱子"}"><span class="toes">● &nbsp; ●</span><span class="box-top"></span><span class="box-front">↗<small>望远镜 / 小心轻放</small></span></button>`;
}
function header() {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="返回首页"><b>SBTI<span>✦</span></b><small>自然界原形</small></button><nav>${btn("gallery", "图鉴", "navbtn")}${btn("help", "说明", "navbtn")}${btn("sound", sound ? "声音开" : "声音关", "navbtn", `aria-pressed="${sound}"`)}</nav></header>`;
}
function footer() {
  return `<footer><div class="follow">欢迎关注微信公众号 <strong>CUC自然科学社</strong></div><p>好奇心没有标准答案。原创娱乐测评，不检测智商。</p><div>${btn("reduce", reduce ? "动态效果：少" : "动态效果：标准", "textbtn", `aria-pressed="${reduce}"`)}${btn("staff", "工作人员", "textbtn")}</div></footer>`;
}
function home() {
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow">FIELD NOTES · ${esc(content.event)}</div><h1>测测你的<br><em>自然界原形</em><span class="tiny-star">✦</span></h1><p class="lede">宇宙很大，你是哪一款？<br>从星空到石头，从看鸟到狂吃。<br>来认领一只属于你的野生兴趣人格。</p><div class="hero-meta"><span>S = Science</span><span>16 种原形</span><span>约 4—6 分钟</span></div><label class="name-label" for="nickname">给观察记录留个名字 <small>选填，最多12字</small></label><input id="nickname" maxlength="24" autocomplete="off" placeholder="匿名自然人也欢迎" value="${esc(name)}"><button class="primary start" data-action="start">开始鉴定 <span>↗</span></button><p class="privacy">不用登录，回答只留在本次页面里。</p></div><div class="hero-art"><div class="orbit"></div>${img("BHSF", "hero-eat", "拿着勺子的黑洞")}${img("DHTP", "hero-brick", "背着物资的砖头")}${img("BOTP", "hero-dove", "拿签到板的朱颈斑鸠")}<span class="handnote">一起去看看<br>世界还有什么。</span><div class="hero-box">${box(1)}</div><span class="specimen-stamp">野生兴趣<br>正在出没</span></div></section><section class="intro-strip"><span>✦ 仰望星空</span><span>↗ 追着鸟看</span><span>♧ 植物朋友</span><span>◎ 动物观察</span><span>◇ 捡石头的</span><span>◒ 食趣研究</span></section>${seen1 ? '<p class="clue-note">目击记录①：望远镜似乎长脚了。先记着。</p>' : ""}<section class="home-note"><b>你可以是黑洞，也可以是一块砖。</b><p>20个生活小场景 + 4个兴趣小问题。选更像平时的自己，不用选“看起来更厉害”的答案。</p></section>`;
}
function quiz() {
  const core = index < 20;
  const q = core ? content.questions[index] : interestQuestions[index - 20];
  const val = core ? answers[content.questions[index].id] : ia[index - 20];
  return `<section class="quiz-shell"><div class="question-meta"><span>${core ? "野外观察记录" : "兴趣加注 · 不影响主类型"}</span><b>${String(index + 1).padStart(2, "0")} / 24</b></div><div class="progress" role="progressbar" aria-valuenow="${index + 1}" aria-valuemin="0" aria-valuemax="24" aria-label="答题进度"><i style="width:${((index + 1) / 24) * 100}%"></i></div><div class="q-heading"><span class="eyebrow">${core ? ["注意力正在漫游", "今天怎样接近自然", "同行的距离", "探索的步调"][content.questions[index].axis] : "哪一种好奇心在发光？"}</span><h1 tabindex="-1">${esc(q.title)}</h1></div><div class="options" role="group" aria-label="请选择更像你的选项">${q.options.map((o, i) => `<button class="option ${val === i ? "selected" : ""}" data-answer="${i}" aria-pressed="${val === i}"><span class="option-letter">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span><span class="check">${val === i ? "✓" : ""}</span></button>`).join("")}</div><div class="quiz-actions">${btn("back", "← 上一题", "secondary", index === 0 ? "disabled" : "")}${btn("next", index === 23 ? "生成我的原形 ↗" : "下一题 →", "primary", val === undefined ? "disabled" : "")}</div><p class="quiet">${core ? "没有标准答案。可以返回修改，分数会重新计算。" : "兴趣标签只影响报告里的兴趣描述。"}${index === 21 ? "<br>野外发现不入口；这里的“尝一口”只是脑内弹幕。" : ""}</p></section>`;
}
function observe() {
  return `<section class="interlude"><div class="eyebrow">路边观察 · 不计分</div><h1>等一下。<br>箱子刚刚是不是动了？</h1><p>部长在前面清点人数，物资却好像多了一位乘客。</p>${box(2)}<p class="clue-note">${seen2 ? "目击记录②：它可能不是望远镜。" : "仔细看看，也可以直接继续活动。"}</p>${btn("continue", "继续观察之旅 →", "primary")}</section>`;
}
function tiePage() {
  const ss = scores(),
    a = ss.findIndex((v, i) => v === 0 && ties[i] === undefined);
  if (a < 0) return "";
  return `<section class="quiz-shell"><span class="eyebrow">一个小小的分流问题</span><h1>${esc(tiebreak[a])}</h1><p>这一维刚好站在中间。按此刻更舒服的选择就好。</p><div class="options">${[axes[a].a, axes[a].b].map((v, i) => `<button class="option" data-tie="${a}:${i === 0 ? 1 : -1}"><span class="option-letter">${i ? "B" : "A"}</span>${esc(v)}</button>`).join("")}</div>${btn("edit", "返回检查回答", "textbtn")}</section>`;
}
function tagsPage() {
  const c = tagSelection(interestScores(ia));
  return `<section class="quiz-shell"><span class="eyebrow">兴趣同分，由你认领</span><h1>这几种好奇心，<br>你更想带走哪${c.slots === 2 ? "两" : "一"}种？</h1><p>选择${c.slots}个标签，不改变主类型。</p><div class="options">${c.candidates.map((i) => `<button class="option ${pendingTags.includes(i) ? "selected" : ""}" data-tag="${i}" aria-pressed="${pendingTags.includes(i)}">${interests[i].icon} ${interests[i].name}<span class="check">${pendingTags.includes(i) ? "✓" : ""}</span></button>`).join("")}</div>${btn("confirmtags", "带着兴趣，领取原形 →", "primary", pendingTags.length !== c.slots ? "disabled" : "")}${btn("edit", "返回检查回答", "textbtn")}</section>`;
}
function reveal() {
  return `<section class="interlude reveal"><div class="scan-ring">✦</div><span class="eyebrow">正在整理野生观察记录</span><h1>你的原形<br>准备登场。</h1><p>部长正在盖章，请稍候。</p>${btn("skip", "跳过动画", "secondary")}</section>`;
}
function profileBody(p: Profile) {
  return `<div class="profile-body"><h2>你的兴趣使用说明</h2><p>${esc(p.body)}</p><div class="note-pair"><section><h3>✦ 自带的本领</h3><p>${esc(p.strength)}</p></section><section><h3>↗ 偶尔的小状况</h3><p>${esc(p.quirk)}</p></section></div><section class="task-note"><span class="eyebrow">给今天的一项小任务</span><p>${esc(p.task)}</p></section></div>`;
}
function result() {
  const p = currentProfile();
  const ss = scores();
  return `<section class="result-layout"><div class="result-left"><div class="result-title"><span class="eyebrow">${demo ? "图鉴演示 · 非实际测评" : "发现一名新的自然人"}</span><h1>${esc(cleanName(name))}的原形</h1></div><div class="canvas-wrap"><canvas id="result-card" width="1080" height="1440" role="img" aria-label="${esc(p.name + "。" + p.quote + "。" + WELCOME)}"></canvas><div id="card-status" role="status">正在装裱你的结果卡…</div></div><div class="share-actions">${btn("screenshot", "截图模式", "primary", "disabled")}${btn("save", "保存图片 ↓", "secondary", "disabled")}</div><p class="quiet">截图模式可整张入镜；图片为1080 × 1440。<br>手机也可在图片预览里长按保存。</p><div class="follow result-follow">${WELCOME}</div></div><div class="result-right">${profileBody(p)}${
    !demo
      ? `<section class="dimensions"><h2>这次回答里的你</h2><p class="quiet">显示偏好方向，不是能力高低或准确率。</p>${axes.map((a, i) => `<div class="dimension"><div><b>${a.a}</b><small>${Math.abs(ss[i]) <= 2 ? "偏好较轻" : "本次倾向"} · ${ss[i] === 0 ? (ties[i] > 0 ? a.a : a.b) : ss[i] > 0 ? a.a : a.b}</small><b>${a.b}</b></div><div class="axis-bar"><i style="left:${50 - ss[i] * 4.5}%"></i></div></div>`).join("")}<details><summary>看看哪些回答形成了判断</summary>${content.questions
          .filter((_, i) => [0, 5, 10, 15].includes(i))
          .map(
            (q) =>
              `<p><b>${esc(q.title)}</b><br>你的回答：${esc(q.options[answers[q.id]])}</p>`,
          )
          .join(
            "",
          )}<p>每个维度由5道题共同计分。兴趣题、昵称和彩蛋不参与四维评分。</p></details>${
          ss.some((v) => Math.abs(v) <= 2)
            ? `<p class="quiet">相近原形也可以看看：</p><div class="chips">${ss
                .flatMap((v, i) => {
                  if (Math.abs(v) > 2) return [];
                  const letters = resultCode.split("");
                  letters[i] = axes[i].letters.find((l) => l !== letters[i])!;
                  const other = content.profiles.find(
                    (x) => x.code === letters.join(""),
                  )!;
                  return [btn("view-" + other.code, esc(other.name), "chip")];
                })
                .join("")}</div>`
            : ""
        }</section>`
      : ""
  }<section class="easter-result">${frog ? `<b>✦ 奶蛙目击者</b><p>它没参加测试，它只是来玩的。贴纸已加入结果卡。</p>${btn("frog", "再看看这位访客", "secondary")}` : seen1 && seen2 ? `<b>部长发现人数对不上。</b><p>你记录的两次异常，似乎来自同一个箱子。</p>${btn("unlock", "查看未登记访客 ↗", "primary")}` : "<p>图鉴里似乎少了一位访客。下次留意物资箱。</p>"}</section><div class="result-bottom">${!demo ? btn("edit", "修改回答", "secondary") : ""}${btn("gallery", "逛逛16型图鉴", "secondary")}${btn("reset", "下一位 / 重新开始", "primary")}</div></div></section>`;
}
function gallery() {
  if (galleryProfile) {
    const p = content.profiles.find((x) => x.code === galleryProfile)!;
    return `<section class="gallery-detail">${btn("galleryback", "← 返回图鉴", "textbtn")}<span class="eyebrow">图鉴档案 / ${p.code}</span><h1>${esc(p.name)} <small>${esc(p.en)}</small></h1>${img(p.code, "detail-art", p.name)}<blockquote>${esc(p.quote)}</blockquote>${profileBody(p)}${btn("return", "返回刚才页面", "secondary")}</section>`;
  }
  return `<section><span class="eyebrow">FIELD GUIDE / 16</span><h1>自然很大，<br>每一款都有位置。</h1><p>名字是玩笑，喜欢是真的。点击看看它的故事。</p><div class="gallery-grid">${content.profiles.map((p) => `<button class="specimen" data-action="view-${p.code}">${img(p.code, "", p.name)}<div><b>${esc(p.name)}</b><span>${esc(p.en)}</span><small>${p.code}</small></div></button>`).join("")}</div><p class="quiet">有一种生物没参加测试，却领到了活动证。${frog ? "你已经见过它了。" : "下次留意物资箱。"}</p>${btn("return", "返回刚才页面", "secondary")}</section>`;
}
function help() {
  return `<section class="reading"><span class="eyebrow">怎么愉快地认识自己</span><h1>好奇心，<br>没有标准答案。</h1><p>这里的 S 是 Science。自然科学社的天文、鸟类、植物、动物、矿物和食趣，都可以成为你的入口。</p><h2>如何得到结果？</h2><p>20道情境题形成四组偏好，组合成16种原形。平分时会多问一道；4道兴趣题只决定兴趣标签。参考趣味人格测评的形式，题目与分类为原创娱乐设计，不是心理量表。</p>${axes.map((a) => `<p><b>${a.a} / ${a.b}</b>：${a.hint}。两端没有高低。</p>`).join("")}<h2>怎么保存？</h2><p>结果页的“截图模式”会把整张卡缩进屏幕；“保存图片”生成高清PNG，若手机下载没有反应，可在预览中长按图片保存。浏览器系统栏由设备控制。</p><h2>本地与手机</h2><p>电脑解压后双击启动网页即可。手机页面已经适配，但文件管理器或微信聊天里的HTML预览不等于浏览器运行；手机使用浏览器打开受支持的本地文件，或由社团另行托管后访问链接。</p><h2>隐私与下一位</h2><p>不收集上传回答。刷新清除本次进度；“下一位”清除姓名、回答与彩蛋。设备设置和活动配置可保存在当前浏览器。</p><h2>图鉴是创作，不是物种百科</h2><p>灰喜鹊空袭、赤石仙人和黑洞狂吃都是角色笑点。“朱颈斑鸠”按社团部长自称保留。野外发现不入口，观察不追赶、不惊扰。</p>${btn("return", "知道了，返回", "primary")}</section>`;
}
function staff() {
  return `<section class="reading"><span class="eyebrow">活动现场 / 工作人员面板</span><h1>让下一场探索<br>准备妥当。</h1><p>仅管理这台设备上的活动设置。导入配置会清空当前答题；请在两位参与者之间操作。</p><label for="event-name">活动署名（最多40字）</label><input id="event-name" maxlength="40" value="${esc(content.event)}">${btn("saveevent", "保存活动署名", "primary")}<div class="staff-actions">${btn("exportconfig", "导出完整内容配置", "secondary")}<label class="secondary file-label">导入内容配置<input id="import-config" type="file" accept="application/json,.json"></label>${btn("defaultconfig", "恢复默认内容", "secondary")}</div><p id="config-status" role="status"></p><h2>演示一个原形</h2><p class="quiet">演示卡会标记“图鉴演示”，不会伪造测评回答。</p><div class="demo-grid">${content.profiles.map((p) => btn("demo-" + p.code, esc(p.name), "secondary")).join("")}</div>${btn("demofrog", "演示奶蛙彩蛋", "secondary")}${btn("return", "返回", "textbtn")}</section>`;
}
function render() {
  document.documentElement.classList.toggle("reduce", reduce);
  cardReady = false;
  cardJob++;
  root.innerHTML =
    header() +
    `<main id="main">${{ home, quiz, observe, tie: tiePage, tags: tagsPage, reveal, result, gallery, help, staff }[page]()}</main>` +
    footer();
  if (page === "result") {
    const job = cardJob;
    const canvas = document.querySelector<HTMLCanvasElement>("#result-card")!;
    const data: CardData = {
      profile: currentProfile(),
      name: cleanName(name),
      event: content.event,
      tags,
      frog,
      demo,
      foodie: ia.filter((v) => v === 5).length >= 2,
    };
    void drawCard(canvas, data)
      .then(() => {
        if (job !== cardJob) return;
        cardReady = true;
        document.querySelector("#card-status")?.remove();
        root
          .querySelectorAll<HTMLButtonElement>(
            '[data-action="save"],[data-action="screenshot"]',
          )
          .forEach((b) => (b.disabled = false));
      })
      .catch((e) => {
        if (job === cardJob) {
          const el = document.querySelector("#card-status");
          if (el) el.textContent = String(e.message);
          toast("装裱失败，可返回报告重试。");
        }
      });
  }
  const input = document.querySelector<HTMLInputElement>("#nickname");
  if (input)
    input.addEventListener(
      "input",
      () => (name = Array.from(input.value).slice(0, 12).join("")),
    );
  document
    .querySelector<HTMLInputElement>("#import-config")
    ?.addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        if (file.size > 200000) throw Error("配置文件不能超过200KB。");
        const next = validateContent(JSON.parse(await file.text()));
        content = next;
        write("sbti-content-v1", JSON.stringify(content));
        reset();
        go("staff");
        document.querySelector("#config-status")!.textContent =
          "导入成功，旧答题已清空。";
      } catch (err) {
        document.querySelector("#config-status")!.textContent =
          "导入失败：" + (err as Error).message + " 当前配置未改变。";
      }
    });
}
function modal(html: string, cls = "") {
  if (cls === "capture") {
    document.querySelector("#toast")?.remove();
    clearTimeout(toastTimer);
  }
  const old = document.querySelector("#overlay");
  old?.remove();
  const origin = document.activeElement as HTMLElement | null;
  const el = document.createElement("div");
  el.id = "overlay";
  el.className = "overlay " + cls;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute(
    "aria-label",
    cls === "capture" ? "截图模式，轻触退出" : "预览",
  );
  el.innerHTML = html;
  document.body.append(el);
  document.body.classList.add("modal-open");
  root.inert = true;
  const close = () => {
    el.remove();
    root.inert = false;
    document.body.classList.remove("modal-open");
    origin?.focus();
  };
  el.addEventListener("click", (e) => {
    if (
      cls === "capture" ||
      e.target === el ||
      (e.target as HTMLElement).closest("[data-close]")
    )
      close();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const focus = [
        ...el.querySelectorAll<HTMLElement>(
          'button,a[href],input,[tabindex="0"]',
        ),
      ];
      if (!focus.length) {
        e.preventDefault();
        return;
      }
      const first = focus[0],
        last = focus[focus.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  el.tabIndex = -1;
  el.focus();
  return el;
}
function showFrog(isDemo = demo) {
  modal(
    `<div class="modal-card frog-modal">${img("NAIWA", "frog-art", "黄色奶蛙")}<span class="eyebrow">未登记访客 / NAIWA</span><h2>“请问你属于哪一种？”</h2><div class="frog-stamp">来玩的。</div><p>${isDemo ? "工作人员彩蛋演示。" : "已获得「奶蛙目击者」贴纸。"}<br>原形照旧，快乐加一。</p><button class="primary" data-close>收好这份快乐</button></div>`,
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function saveCard() {
  if (!cardReady) return;
  const canvas = document.querySelector<HTMLCanvasElement>("#result-card")!;
  try {
    const blob = await canvasBlob(canvas);
    const url = URL.createObjectURL(blob);
    const el = modal(
      `<div class="modal-card image-preview"><h2>你的原形，带走吧。</h2><p>手机可长按图片保存。也可以点下载。</p><img class="export-image" src="${url}" alt="${esc(currentProfile().name + "结果卡。" + WELCOME)}"><a class="primary" href="${url}" download="SBTI-${esc(currentProfile().code)}.png">下载高清 PNG ↓</a><button class="secondary" data-close>回到报告</button></div>`,
    );
    const observer = new MutationObserver(() => {
      if (!document.body.contains(el)) {
        URL.revokeObjectURL(url);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  } catch (e) {
    toast((e as Error).message);
  }
}
root.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!target || target.disabled) return;
  tick();
  if (target.dataset.answer !== undefined) {
    const v = Number(target.dataset.answer);
    if (index < 20) {
      answers[content.questions[index].id] = v;
      ties = {};
    } else ia[index - 20] = v;
    render();
    return;
  }
  if (target.dataset.tie) {
    const [a, v] = target.dataset.tie.split(":").map(Number);
    ties[a] = v;
    resolveResult();
    return;
  }
  if (target.dataset.tag) {
    const i = Number(target.dataset.tag),
      c = tagSelection(interestScores(ia));
    if (pendingTags.includes(i))
      pendingTags = pendingTags.filter((x) => x !== i);
    else if (pendingTags.length < c.slots) pendingTags.push(i);
    else {
      toast(`最多选择${c.slots}个标签。`);
      return;
    }
    render();
    return;
  }
  const a = target.dataset.action;
  if (!a) return;
  if (a.startsWith("view-")) {
    galleryProfile = a.slice(5);
    if (page !== "gallery") lastPage = page;
    go("gallery");
    return;
  }
  if (a.startsWith("demo-")) {
    resultCode = a.slice(5);
    demo = true;
    name = "图鉴演示";
    tags = [0, 4];
    frog = false;
    seen1 = seen2 = false;
    go("result");
    return;
  }
  switch (a) {
    case "home":
      if (page === "quiz" || page === "tie" || page === "tags") {
        if (!confirm("返回首页会结束本次测评，确定吗？")) return;
        reset();
      } else go("home");
      break;
    case "start":
      demo = false;
      answers = {};
      ia = [];
      ties = {};
      tags = [];
      pendingTags = [];
      seen2 = false;
      observed = false;
      frog = false;
      resultCode = "";
      index = 0;
      go("quiz");
      break;
    case "next":
      if (
        (index < 20 && answers[content.questions[index].id] === undefined) ||
        (index >= 20 && ia[index - 20] === undefined)
      )
        return;
      if (index === 23) {
        resolveResult();
        return;
      }
      index++;
      if (index === 10 && !observed) go("observe");
      else go("quiz");
      break;
    case "back":
      if (index > 0) {
        index--;
        go("quiz");
      }
      break;
    case "continue":
      observed = true;
      go("quiz");
      break;
    case "clue1":
      seen1 = true;
      render();
      toast("目击记录①：望远镜似乎长脚了。");
      break;
    case "clue2":
      seen2 = true;
      render();
      toast("目击记录②：它可能不是望远镜。");
      break;
    case "confirmtags": {
      const c = tagSelection(interestScores(ia));
      if (pendingTags.length !== c.slots) return;
      tags = [...c.fixed, ...pendingTags];
      finish();
      break;
    }
    case "skip":
      go("result");
      break;
    case "edit":
      demo = false;
      index = 0;
      ties = {};
      go("quiz");
      break;
    case "reset":
      reset();
      break;
    case "gallery":
      if (!["gallery", "help", "staff"].includes(page)) lastPage = page;
      galleryProfile = "";
      go("gallery");
      break;
    case "galleryback":
      galleryProfile = "";
      go("gallery");
      break;
    case "help":
    case "staff":
      if (!["gallery", "help", "staff"].includes(page)) lastPage = page;
      go(a);
      break;
    case "return":
      go(lastPage === "reveal" ? "home" : lastPage);
      break;
    case "sound":
      sound = !sound;
      write("sbti-sound", String(sound));
      render();
      break;
    case "reduce":
      reduce = !reduce;
      write("sbti-reduce", String(reduce));
      render();
      break;
    case "unlock":
      if (seen1 && seen2) {
        frog = true;
        render();
        showFrog();
      }
      break;
    case "frog":
      showFrog();
      break;
    case "demofrog":
      showFrog(true);
      break;
    case "screenshot": {
      if (!cardReady) return;
      const original =
        document.querySelector<HTMLCanvasElement>("#result-card")!;
      const el = modal(
        '<canvas width="1080" height="1440" role="img" aria-label="完整结果卡，轻触退出"></canvas>',
        "capture",
      );
      el.querySelector("canvas")!.getContext("2d")!.drawImage(original, 0, 0);
      break;
    }
    case "save":
      void saveCard();
      break;
    case "saveevent": {
      const next = structuredClone(content);
      next.event = document
        .querySelector<HTMLInputElement>("#event-name")!
        .value.trim();
      try {
        content = validateContent(next);
        write("sbti-content-v1", JSON.stringify(content));
        toast("活动署名已保存。");
      } catch (err) {
        toast((err as Error).message);
      }
      break;
    }
    case "exportconfig":
      download(
        new Blob([JSON.stringify(content, null, 2)], {
          type: "application/json",
        }),
        "SBTI内容配置.json",
      );
      break;
    case "defaultconfig":
      if (confirm("恢复默认内容并清空当前回答？")) {
        content = structuredClone(defaultContent);
        write("sbti-content-v1", JSON.stringify(content));
        reset();
        go("staff");
      }
      break;
  }
});
render();
