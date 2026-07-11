import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const app = document.querySelector("#app");

const VALID_PAGES = ["home", "schedule", "journal", "wishes", "memories"];
const PAGE_META = {
  home: { title: "今日小窝", eyebrow: "OUR DAILY SPACE", badge: "TODAY TOGETHER", hero: "今天也分享一点彼此的生活", description: "选择任意日期，查看那一天独立保存的事项、心情、留言和回应。", action: "记录心情", dateVisible: true },
  schedule: { title: "爱心日程", eyebrow: "LOVE SCHEDULE", badge: "PLANS FOR TWO", hero: "把想一起做的事情认真安排下来", description: "你们分别完成自己的打勾；双方完成后，事项会自动进入共同回忆。", action: "添加事项", dateVisible: true },
  journal: { title: "每日日记", eyebrow: "DAILY JOURNAL", badge: "HOW WE FEEL", hero: "认真记录今天，也温柔理解彼此", description: "每个人只编辑自己的记录；共享记录会同步显示给对方。", action: "写今日记录", dateVisible: true },
  wishes: { title: "愿望清单", eyebrow: "OUR WISH LIST", badge: "SOMEDAY TOGETHER", hero: "把想一起完成的未来放在这里", description: "愿望可以从一个想法，逐渐变成已经安排和真正完成的共同回忆。", action: "添加愿望", dateVisible: false },
  memories: { title: "我们的回忆", eyebrow: "OUR MEMORIES", badge: "THINGS WE SHARED", hero: "我们认真共同生活过的证据", description: "共同完成的事项、实现的愿望和手动保存的纪念会汇成时间线。", action: "添加回忆", dateVisible: false }
};
const PERSON = {
  dog: { name: "狗狗", icon: "🐶" },
  cat: { name: "咪咪", icon: "🐱" }
};
const WISH_STAGES = ["刚刚想到", "正在计划", "已经安排", "已经完成"];

let supabase;
let session = null;
let context = null;
let currentPage = getPageFromUrl();
let selectedDate = localStorage.getItem("dogCat:selectedDate") || todayISO();
let scheduleRange = "day";
let wishFilter = "全部";
let realtimeChannel = null;
let refreshTimer = null;
let bootToken = 0;
let shellAbortController = null;

function getPageFromUrl() {
  const page = new URLSearchParams(location.search).get("page");
  return VALID_PAGES.includes(page) ? page : "home";
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function isoDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function shiftDate(value, amount) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}

function startOfWeek(value) {
  const date = parseDate(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return isoDate(date);
}

function endOfWeek(value) {
  return shiftDate(startOfWeek(value), 6);
}

function formatDate(value, options) {
  return new Intl.DateTimeFormat("zh-CN", options).format(parseDate(value));
}

function fullDate(value) {
  return formatDate(value, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function shortDate(value) {
  return formatDate(value, { month: "long", day: "numeric" });
}

function timeText(value) {
  return value ? String(value).slice(0, 5) : "";
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function getErrorMessage(error) {
  if (!error) return "发生了未知错误。";
  const raw = error.message || String(error);
  const mappings = [
    ["Invalid login credentials", "邮箱或密码不正确。"],
    ["User already registered", "这个邮箱已经注册过了。"],
    ["Password should be", "密码长度不足，请至少使用 6 个字符。"],
    ["Email not confirmed", "请先打开邮箱中的确认邮件。"],
    ["rate limit", "操作过于频繁，请稍后再试。"]
  ];
  const matched = mappings.find(([needle]) => raw.toLowerCase().includes(needle.toLowerCase()));
  return matched ? matched[1] : raw;
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? "#8c4451" : "#302d2f";
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setFormMessage(form, message, type = "") {
  const node = form.querySelector("[data-form-message]");
  if (!node) return;
  node.textContent = message;
  node.className = `form-message ${type}`;
}

function setBusy(button, busy, label = "处理中……") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function initialize() {
  if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes("YOUR_PROJECT")) {
    renderConfigScreen();
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn(error);
  session = data.session;

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    window.setTimeout(() => boot(), 0);
  });

  await boot();
}

async function boot() {
  const token = ++bootToken;
  unsubscribeRealtime();

  if (!session) {
    context = null;
    renderAuthScreen();
    return;
  }

  app.innerHTML = `<div class="boot-screen"><span class="boot-heart">♥</span><p>正在读取你们的共享空间……</p></div>`;
  try {
    const loaded = await loadContext();
    if (token !== bootToken) return;
    context = loaded;
    if (!context.membership) {
      renderOnboarding();
      return;
    }
    renderAppShell();
    subscribeRealtime();
    await renderCurrentPage();
  } catch (error) {
    console.error(error);
    renderFatalError(getErrorMessage(error));
  }
}

async function loadContext() {
  const userId = session.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_emoji")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const { data: membership, error: memberError } = await supabase
    .from("couple_members")
    .select("couple_id, user_id, role, joined_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw memberError;

  if (!membership) return { profile, membership: null, couple: null, members: [], profileMap: {} };

  const [{ data: couple, error: coupleError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from("couples").select("id, name, invite_code, created_at").eq("id", membership.couple_id).single(),
    supabase.from("couple_members").select("couple_id, user_id, role, joined_at").eq("couple_id", membership.couple_id)
  ]);
  if (coupleError) throw coupleError;
  if (membersError) throw membersError;

  const userIds = members.map((member) => member.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_emoji")
    .in("id", userIds);
  if (profilesError) throw profilesError;

  const profileMap = Object.fromEntries((profiles || []).map((item) => [item.id, item]));
  return { profile: profileMap[userId] || profile, membership, couple, members, profileMap };
}

function renderConfigScreen() {
  app.innerHTML = `<main class="config-screen">
    <section class="config-card">
      <p class="eyebrow">SUPABASE CONFIGURATION</p>
      <h1>还需要连接你的 Supabase 项目</h1>
      <p>这个版本已经改成正式云端架构，不再把共同内容保存在单台电脑。请复制 <code>.env.example</code> 为 <code>.env</code>，填入项目 URL 和 Publishable Key，然后重新运行。</p>
      <code class="config-code">VITE_SUPABASE_URL=https://你的项目.supabase.co<br>VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...</code>
      <p>数据库表、情侣邀请码、权限策略和实时同步脚本位于 <code>supabase/migrations/202607110001_initial_schema.sql</code>。</p>
    </section>
  </main>`;
}

function renderFatalError(message) {
  app.innerHTML = `<main class="config-screen"><section class="config-card"><p class="eyebrow">SOMETHING WENT WRONG</p><h1>共享空间暂时没有打开</h1><div class="error-panel">${escapeHTML(message)}</div><div style="margin-top:18px;display:flex;gap:10px"><button class="button primary" id="retryBoot">重新尝试</button><button class="button secondary" id="fatalLogout">退出登录</button></div></section></main>`;
  document.querySelector("#retryBoot")?.addEventListener("click", boot);
  document.querySelector("#fatalLogout")?.addEventListener("click", () => supabase.auth.signOut());
}

function renderAuthScreen(mode = "login", message = "") {
  const isLogin = mode === "login";
  app.innerHTML = `<main class="auth-screen">
    <section class="auth-card">
      <div class="auth-visual">
        <div>
          <span class="hero-badge">A HOME FOR TWO</span>
          <h1>狗狗与咪咪的<br>爱心日程表</h1>
          <p>分别登录、共同绑定，在不同城市看到同一份日程、心情、留言和回忆。</p>
        </div>
        <div class="auth-pets" aria-hidden="true"><div class="auth-pet">🐶</div><span class="auth-heart">♥</span><div class="auth-pet">🐱</div></div>
      </div>
      <div class="auth-panel">
        <p class="eyebrow">WELCOME HOME</p>
        <h2>${isLogin ? "回到我们的线上小窝" : "创建你的个人账号"}</h2>
        <p>${isLogin ? "登录后会读取你们两个人共享的云端内容。" : "注册完成后，你可以创建双人空间或输入对方的邀请码。"}</p>
        <div class="auth-tabs">
          <button class="auth-tab ${isLogin ? "active" : ""}" data-auth-mode="login">登录</button>
          <button class="auth-tab ${!isLogin ? "active" : ""}" data-auth-mode="signup">注册</button>
        </div>
        <form class="auth-form" id="authForm" data-mode="${mode}">
          ${isLogin ? "" : `<label>你的昵称<input name="displayName" maxlength="30" required placeholder="例如：狗狗" autocomplete="nickname"></label>`}
          <label>邮箱<input type="email" name="email" required placeholder="you@example.com" autocomplete="email"></label>
          <label>密码<input type="password" name="password" minlength="6" required placeholder="至少 6 个字符" autocomplete="${isLogin ? "current-password" : "new-password"}"></label>
          <p class="form-message ${message ? "success" : ""}" data-form-message>${escapeHTML(message)}</p>
          <button class="button primary" type="submit">${isLogin ? "登录" : "注册账号"}</button>
        </form>
      </div>
    </section>
  </main>`;

  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => renderAuthScreen(button.dataset.authMode)));
  document.querySelector("#authForm")?.addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const mode = form.dataset.mode;
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  setBusy(button, true);
  setFormMessage(form, "");

  try {
    if (mode === "signup") {
      const displayName = String(data.get("displayName") || "").trim();
      const { data: result, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      if (!result.session) {
        renderAuthScreen("login", "注册成功。请打开邮箱中的确认邮件，然后回来登录。");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    setFormMessage(form, getErrorMessage(error), "error");
    setBusy(button, false);
  }
}

function renderOnboarding() {
  const name = context.profile?.display_name || session.user.email?.split("@")[0] || "你好";
  app.innerHTML = `<main class="onboarding-screen">
    <section class="onboarding-card">
      <div class="onboarding-header">
        <div><p class="eyebrow">PAIR YOUR ACCOUNTS</p><h1>${escapeHTML(name)}，建立你们的双人空间</h1><p>只需要其中一人创建空间，另一人输入邀请码加入。</p></div>
        <button class="button secondary" id="onboardingLogout">退出登录</button>
      </div>
      <div class="onboarding-grid">
        <article class="onboarding-option">
          <span class="card-title-icon">＋</span><h3>创建新的线上小窝</h3><p>适合第一个开始设置的人。创建后会得到一个只用于绑定的 8 位邀请码。</p>
          <form class="onboarding-form" id="createCoupleForm">
            <label>空间名称<input name="name" maxlength="60" required value="狗狗与咪咪的线上小窝"></label>
            ${roleChoice("createRole")}
            <p class="form-message" data-form-message></p>
            <button class="button primary" type="submit">创建并获得邀请码</button>
          </form>
        </article>
        <article class="onboarding-option">
          <span class="card-title-icon">↗</span><h3>加入对方创建的空间</h3><p>输入对方发给你的邀请码，并选择尚未被占用的狗狗或咪咪角色。</p>
          <form class="onboarding-form" id="joinCoupleForm">
            <label>8 位邀请码<input name="inviteCode" maxlength="8" required placeholder="例如：A1B2C3D4" style="text-transform:uppercase;letter-spacing:.12em"></label>
            ${roleChoice("joinRole", "cat")}
            <p class="form-message" data-form-message></p>
            <button class="button primary" type="submit">加入这个空间</button>
          </form>
        </article>
      </div>
    </section>
  </main>`;

  document.querySelector("#onboardingLogout")?.addEventListener("click", () => supabase.auth.signOut());
  document.querySelector("#createCoupleForm")?.addEventListener("submit", handleCreateCouple);
  document.querySelector("#joinCoupleForm")?.addEventListener("submit", handleJoinCouple);
}

function roleChoice(name, checked = "dog") {
  return `<div><label style="margin-bottom:8px">你在小窝中的角色</label><div class="role-choice">
    <label><input type="radio" name="${name}" value="dog" ${checked === "dog" ? "checked" : ""}><span class="role-option">🐶 狗狗</span></label>
    <label><input type="radio" name="${name}" value="cat" ${checked === "cat" ? "checked" : ""}><span class="role-option">🐱 咪咪</span></label>
  </div></div>`;
}

async function handleCreateCouple(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  setBusy(button, true, "正在创建……");
  try {
    const { error } = await supabase.rpc("create_couple", { p_name: String(data.get("name") || "").trim(), p_role: data.get("createRole") });
    if (error) throw error;
    await boot();
  } catch (error) {
    setFormMessage(form, getErrorMessage(error), "error");
    setBusy(button, false);
  }
}

async function handleJoinCouple(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  setBusy(button, true, "正在加入……");
  try {
    const { error } = await supabase.rpc("join_couple_by_code", { p_invite_code: String(data.get("inviteCode") || "").trim().toUpperCase(), p_role: data.get("joinRole") });
    if (error) throw error;
    await boot();
  } catch (error) {
    setFormMessage(form, getErrorMessage(error), "error");
    setBusy(button, false);
  }
}

function renderAppShell() {
  const self = selfMember();
  const partner = partnerMember();
  const selfProfile = profileFor(self?.user_id);
  const partnerProfile = profileFor(partner?.user_id);

  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="?page=home" data-page-link="home"><span class="brand-mark">♡</span><span class="brand-copy"><strong>狗狗与咪咪</strong><small>OUR SHARED HOME</small></span></a>
      <nav class="side-nav" aria-label="主要页面">
        ${navLink("home", "⌂", "今日小窝", "当天概览与留言")}
        ${navLink("schedule", "✓", "爱心日程", "共同计划与打勾")}
        ${navLink("journal", "✎", "每日日记", "心情与关系感受")}
        ${navLink("wishes", "☆", "愿望清单", "以后想一起完成")}
        ${navLink("memories", "◇", "我们的回忆", "共同生活时间线")}
      </nav>
      <div class="user-panel">
        <section class="sidebar-profile">
          <div class="sidebar-profile-top"><span class="avatar">${PERSON[self.role].icon}</span><div><strong>${escapeHTML(selfProfile?.display_name || PERSON[self.role].name)}</strong><small>${partner ? `已和 ${escapeHTML(partnerProfile?.display_name || PERSON[partner.role].name)} 连接` : "等待对方加入"}</small></div></div>
          <div class="invite-box"><span>情侣邀请码</span><code>${escapeHTML(context.couple.invite_code)}</code></div>
          <div class="sidebar-actions"><button class="sidebar-mini-button" id="copyInvite">复制邀请码</button><button class="sidebar-mini-button" id="logoutButton">退出</button></div>
        </section>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div><p class="eyebrow" id="pageEyebrow"></p><h1 id="pageTitle"></h1></div>
        <div class="topbar-actions"><span class="sync-pill"><i class="sync-dot" id="syncDot"></i><span id="syncText">云端已连接</span></span><button class="button secondary" id="todayButton">回到今天</button><button class="button primary" id="pageActionButton"></button></div>
      </header>
      <section class="hero-banner">
        <div class="hero-copy"><span class="hero-badge" id="heroBadge"></span><h2 id="heroTitle"></h2><p id="heroDescription"></p></div>
        <div class="hero-scene" aria-hidden="true"><div class="pet-card pet-dog">🐶</div><span class="hero-heart">♥</span><div class="pet-card pet-cat">🐱</div></div>
      </section>
      <section class="date-console" id="dateConsole">
        <div class="date-heading"><button class="date-arrow" id="previousDate">‹</button><div><strong id="selectedDateTitle"></strong><span id="selectedDateSubtitle"></span></div><button class="date-arrow" id="nextDate">›</button></div>
        <div class="week-strip" id="weekStrip"></div>
        <label class="date-picker"><span>直接选择日期</span><input type="date" id="datePicker"></label>
      </section>
      <main class="page-root" id="pageRoot" aria-live="polite"></main>
    </div>
  </div>
  <div id="modalRoot"></div><div class="toast" id="toast" role="status"></div>`;

  bindShellEvents();
  updateChrome();
}

function navLink(page, icon, title, subtitle) {
  return `<a href="?page=${page}" data-page-link="${page}"><span class="nav-icon">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></a>`;
}

function bindShellEvents() {
  if (shellAbortController) shellAbortController.abort();
  shellAbortController = new AbortController();
  const { signal } = shellAbortController;
  document.querySelectorAll("[data-page-link]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(link.dataset.pageLink);
  }, { signal }));
  document.querySelector("#previousDate").addEventListener("click", () => selectDate(shiftDate(selectedDate, -1)), { signal });
  document.querySelector("#nextDate").addEventListener("click", () => selectDate(shiftDate(selectedDate, 1)), { signal });
  document.querySelector("#todayButton").addEventListener("click", () => selectDate(todayISO()), { signal });
  document.querySelector("#datePicker").addEventListener("change", (event) => selectDate(event.target.value), { signal });
  document.querySelector("#pageActionButton").addEventListener("click", handlePageAction, { signal });
  document.querySelector("#copyInvite").addEventListener("click", copyInviteCode, { signal });
  document.querySelector("#logoutButton").addEventListener("click", () => supabase.auth.signOut(), { signal });
  document.addEventListener("click", handleDelegatedClick, { signal });
  document.addEventListener("submit", handleDelegatedSubmit, { signal });
  document.addEventListener("keydown", handleEscape, { signal });
}

function selfMember() {
  return context.members.find((member) => member.user_id === session.user.id) || context.membership;
}
function partnerMember() {
  return context.members.find((member) => member.user_id !== session.user.id) || null;
}
function profileFor(userId) {
  return userId ? context.profileMap[userId] : null;
}

function navigate(page, replace = false) {
  if (!VALID_PAGES.includes(page)) page = "home";
  currentPage = page;
  const url = new URL(location.href);
  url.searchParams.set("page", page);
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  updateChrome();
  renderCurrentPage();
}

function selectDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  selectedDate = value;
  localStorage.setItem("dogCat:selectedDate", value);
  updateChrome();
  renderCurrentPage();
}

function updateChrome() {
  const meta = PAGE_META[currentPage];
  document.title = `${meta.title}｜狗狗与咪咪的爱心日程表`;
  document.querySelector("#pageTitle").textContent = meta.title;
  document.querySelector("#pageEyebrow").textContent = meta.eyebrow;
  document.querySelector("#heroBadge").textContent = meta.badge;
  document.querySelector("#heroTitle").textContent = meta.hero;
  document.querySelector("#heroDescription").textContent = meta.description;
  document.querySelector("#pageActionButton").textContent = meta.action;
  document.querySelector("#dateConsole").classList.toggle("hidden", !meta.dateVisible);
  document.querySelector("#todayButton").style.display = meta.dateVisible ? "inline-flex" : "none";
  document.querySelectorAll("[data-page-link]").forEach((link) => link.classList.toggle("active", link.dataset.pageLink === currentPage));
  document.querySelector("#selectedDateTitle").textContent = fullDate(selectedDate);
  document.querySelector("#selectedDateSubtitle").textContent = selectedDate === todayISO() ? "今天" : "这一天的内容会独立保存";
  document.querySelector("#datePicker").value = selectedDate;
  renderWeekStrip();
}

function renderWeekStrip() {
  const weekStart = startOfWeek(selectedDate);
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  document.querySelector("#weekStrip").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(weekStart, index);
    const parsed = parseDate(date);
    const prefix = date.slice(0, 7) === selectedDate.slice(0, 7) ? "" : `${parsed.getMonth() + 1}/`;
    return `<button class="week-day ${date === selectedDate ? "selected" : ""} ${date === todayISO() ? "today" : ""}" data-select-date="${date}"><span>${labels[index]}</span><strong>${prefix}${parsed.getDate()}</strong></button>`;
  }).join("");
}

async function copyInviteCode() {
  try {
    await navigator.clipboard.writeText(context.couple.invite_code);
    showToast("邀请码已经复制，可以发给对方。 ");
  } catch {
    window.prompt("复制这个邀请码发给对方：", context.couple.invite_code);
  }
}

async function renderCurrentPage() {
  const root = document.querySelector("#pageRoot");
  if (!root) return;
  root.innerHTML = `<section class="card loading-card">正在从云端读取内容……</section>`;
  try {
    if (currentPage === "home") await renderHome();
    if (currentPage === "schedule") await renderSchedule();
    if (currentPage === "journal") await renderJournal();
    if (currentPage === "wishes") await renderWishes();
    if (currentPage === "memories") await renderMemories();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="error-panel">${escapeHTML(getErrorMessage(error))}</div>`;
  }
}

async function fetchDay(date = selectedDate) {
  const coupleId = context.couple.id;
  const [noteResult, taskResult, entryResult, responseResult] = await Promise.all([
    supabase.from("daily_notes").select("*").eq("couple_id", coupleId).eq("record_date", date).maybeSingle(),
    supabase.from("tasks").select("*").eq("couple_id", coupleId).eq("task_date", date).order("task_time", { ascending: true, nullsFirst: false }).order("created_at"),
    supabase.from("daily_entries").select("*").eq("couple_id", coupleId).eq("record_date", date),
    supabase.from("responses").select("*").eq("couple_id", coupleId).eq("record_date", date).order("created_at", { ascending: false })
  ]);
  [noteResult, taskResult, entryResult, responseResult].forEach((result) => { if (result.error) throw result.error; });
  return { note: noteResult.data, tasks: taskResult.data || [], entries: entryResult.data || [], responses: responseResult.data || [] };
}

function entryForRole(entries, role) {
  const member = context.members.find((item) => item.role === role);
  return member ? entries.find((entry) => entry.user_id === member.user_id) || null : null;
}

function displayNameForRole(role) {
  const member = context.members.find((item) => item.role === role);
  return member ? profileFor(member.user_id)?.display_name || PERSON[role].name : PERSON[role].name;
}

function taskListHTML(tasks, compact = false) {
  const ownRole = selfMember().role;
  if (!tasks.length) return `<div class="empty-state ${compact ? "compact" : ""}">这一天还没有共同事项。<br><button class="button primary small" data-add-task style="margin-top:12px">添加一件事情</button></div>`;
  return `<div class="task-list">${tasks.map((task) => {
    const mineDone = ownRole === "dog" ? task.dog_done : task.cat_done;
    const otherRole = ownRole === "dog" ? "cat" : "dog";
    const otherDone = otherRole === "dog" ? task.dog_done : task.cat_done;
    return `<article class="task-row ${task.dog_done && task.cat_done ? "complete" : ""}">
      <div class="task-main"><div class="task-title-line"><strong>${escapeHTML(task.title)}</strong>${task.task_time ? `<span class="time-pill">${timeText(task.task_time)}</span>` : ""}</div><p>${escapeHTML(task.note || (task.dog_done && task.cat_done ? "我们一起完成啦。" : "等待我们一起完成。"))}</p></div>
      <div class="task-controls">
        <button class="person-check ${mineDone ? "done" : ""}" data-toggle-task="${task.id}">${PERSON[ownRole].icon} ${mineDone ? "我已完成" : "我来打勾"}</button>
        <span class="person-check ${otherDone ? "done" : ""}" style="cursor:default">${PERSON[otherRole].icon} ${otherDone ? "对方完成" : "等待对方"}</span>
        <button class="delete-button" title="删除事项" data-delete-task="${task.id}">×</button>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function moodCardHTML(role, entry, responses) {
  const member = context.members.find((item) => item.role === role);
  const name = displayNameForRole(role);
  if (!member) {
    return `<article class="mood-card ${role}"><div class="mood-top"><span class="person-label">${PERSON[role].icon} ${PERSON[role].name}</span><span class="mood-emoji">·</span></div><h4>等待对方加入</h4><p>把邀请码发给对方后，这里会出现另一位成员。</p></article>`;
  }
  if (!entry) {
    const canEdit = member.user_id === session.user.id;
    return `<article class="mood-card ${role}"><div class="mood-top"><span class="person-label">${PERSON[role].icon} ${escapeHTML(name)}</span><span class="mood-emoji">·</span></div><h4>还没有共享记录</h4><p>${canEdit ? "你可以写下这一天的心情。" : "对方这一天还没有发布共享心情。"}</p>${canEdit ? `<div class="response-row"><button class="button secondary small" data-edit-entry>写下心情</button></div>` : ""}</article>`;
  }
  const latestResponse = responses.find((response) => response.to_user === member.user_id);
  const canRespond = member.user_id !== session.user.id && partnerMember();
  return `<article class="mood-card ${role}">
    <div class="mood-top"><span class="person-label">${PERSON[role].icon} ${escapeHTML(name)}</span><span class="mood-emoji">${escapeHTML(entry.emoji)}</span></div>
    <h4>${escapeHTML(entry.mood)}</h4><p>${escapeHTML(entry.story || "今天没有写具体的小事。")}</p>
    ${canRespond ? `<div class="response-row"><button class="response-chip" data-response="抱抱你" data-target-user="${member.user_id}">抱抱你</button><button class="response-chip" data-response="我在这里" data-target-user="${member.user_id}">我在这里</button><button class="response-chip" data-response="晚上聊聊" data-target-user="${member.user_id}">晚上聊聊</button></div>` : ""}
    ${latestResponse ? `<div class="latest-response">${escapeHTML(profileFor(latestResponse.from_user)?.display_name || "对方")}：${escapeHTML(latestResponse.text)}</div>` : ""}
  </article>`;
}

async function renderHome() {
  const day = await fetchDay();
  const completed = day.tasks.filter((task) => task.dog_done && task.cat_done).length;
  const percentage = day.tasks.length ? Math.round(completed / day.tasks.length * 100) : 0;
  const sharedEntries = day.entries.length;
  const root = document.querySelector("#pageRoot");
  root.innerHTML = `<div class="dashboard-grid">
    <section class="card span-7"><div class="card-header"><div class="card-title"><span class="card-title-icon">✓</span><div><h3>今天一起做</h3><p>${shortDate(selectedDate)}的共同事项</p></div></div><button class="icon-button" data-add-task>＋</button></div>${taskListHTML(day.tasks, true)}</section>
    <section class="card span-5"><div class="card-header"><div class="card-title"><span class="card-title-icon">☁</span><div><h3>双方今日心情</h3><p>每个人只编辑自己的记录</p></div></div><button class="icon-button" data-edit-entry>＋</button></div><div class="mood-list">${moodCardHTML("dog", entryForRole(day.entries, "dog"), day.responses)}${moodCardHTML("cat", entryForRole(day.entries, "cat"), day.responses)}</div></section>
    <section class="card span-8"><div class="note-layout"><div class="quote-mark">“</div><div><div class="card-header" style="margin:0"><div><h3>留给对方的一句话</h3><p>只属于${shortDate(selectedDate)}的共享留言</p></div></div><blockquote>${day.note?.content ? `“${escapeHTML(day.note.content)}”` : "这一天还没有留下想说的话。"}</blockquote></div><button class="button secondary small" data-edit-note>${day.note ? "修改留言" : "写一句话"}</button></div></section>
    <section class="card span-4"><div class="card-header"><div class="card-title"><span class="card-title-icon">↗</span><div><h3>当天连接概览</h3><p>内容来自实时共享数据库</p></div></div></div><div class="summary-grid"><div class="summary-box"><span>共同完成</span><strong>${completed}/${day.tasks.length}</strong><div class="progress-track"><div class="progress-fill" style="width:${percentage}%"></div></div></div><div class="summary-box"><span>共享心情</span><strong>${sharedEntries}/2</strong><div class="progress-track"><div class="progress-fill" style="width:${sharedEntries * 50}%"></div></div></div><div class="summary-box"><span>温柔回应</span><strong>${day.responses.length}</strong><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, day.responses.length * 25)}%"></div></div></div></div></section>
  </div>`;
}

function rangeBounds() {
  if (scheduleRange === "day") return [selectedDate, selectedDate];
  if (scheduleRange === "week") return [startOfWeek(selectedDate), endOfWeek(selectedDate)];
  if (scheduleRange === "month") return [`${selectedDate.slice(0, 7)}-01`, isoDate(new Date(parseDate(`${selectedDate.slice(0, 7)}-01`).getFullYear(), parseDate(`${selectedDate.slice(0, 7)}-01`).getMonth() + 1, 0, 12))];
  return [null, null];
}

async function fetchTasksForRange() {
  let query = supabase.from("tasks").select("*").eq("couple_id", context.couple.id).order("task_date").order("task_time", { ascending: true, nullsFirst: false });
  const [start, end] = rangeBounds();
  if (start) query = query.gte("task_date", start).lte("task_date", end);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function renderSchedule() {
  const tasks = await fetchTasksForRange();
  const labels = { day: "当天", week: "本周", month: "本月", all: "全部" };
  const groups = tasks.reduce((accumulator, task) => {
    (accumulator[task.task_date] ||= []).push(task);
    return accumulator;
  }, {});
  document.querySelector("#pageRoot").innerHTML = `<div class="section-toolbar"><div class="section-heading"><h2>${labels[scheduleRange]}的共同事项</h2><p>点击左侧导航可以切换页面；上方日期只改变当前查看范围。</p></div><div class="segment-control">${Object.entries(labels).map(([key, label]) => `<button class="segment-button ${key === scheduleRange ? "active" : ""}" data-schedule-range="${key}">${label}</button>`).join("")}</div></div><div class="schedule-groups">${Object.keys(groups).length ? Object.entries(groups).map(([date, items]) => `<section class="schedule-group"><div class="schedule-group-header"><strong>${fullDate(date)}</strong><span>${items.filter((item) => item.dog_done && item.cat_done).length}/${items.length} 已共同完成</span></div>${taskListHTML(items)}</section>`).join("") : `<div class="empty-state">当前范围内还没有共同事项。<br><button class="button primary small" data-add-task style="margin-top:12px">添加一件事情</button></div>`}</div>`;
}

function journalCard(role, entry) {
  const member = context.members.find((item) => item.role === role);
  const isSelf = member?.user_id === session.user.id;
  const name = displayNameForRole(role);
  if (!member) return `<section class="card journal-card"><div class="journal-cover ${role}"><div><strong>${PERSON[role].icon} ${PERSON[role].name}的记录</strong><span>${fullDate(selectedDate)}</span></div><div class="big-emoji">·</div></div><div class="journal-empty">等待另一位成员通过邀请码加入。</div></section>`;
  if (!entry) return `<section class="card journal-card"><div class="journal-cover ${role}"><div><strong>${PERSON[role].icon} ${escapeHTML(name)}的记录</strong><span>${fullDate(selectedDate)}</span></div><div class="big-emoji">·</div></div><div class="journal-empty"><div>${isSelf ? "你这一天还没有发布共享记录。" : "对方这一天还没有发布共享记录。"}${isSelf ? `<br><button class="button primary small" data-edit-entry style="margin-top:14px">写下今日心情</button>` : ""}</div></div></section>`;
  return `<section class="card journal-card"><div class="journal-cover ${role}"><div><strong>${PERSON[role].icon} ${escapeHTML(name)}的记录</strong><span>${fullDate(selectedDate)}</span></div><div class="big-emoji">${escapeHTML(entry.emoji)}</div></div><div class="journal-body"><div class="journal-section"><small>今天的心情</small><p>${escapeHTML(entry.mood)}</p></div><div class="journal-section"><small>今天发生了什么</small><p>${escapeHTML(entry.story || "没有填写。")}</p></div><div class="journal-section"><small>因为对方而开心的事情</small><p>${escapeHTML(entry.happy || "没有填写。")}</p></div><div class="journal-section"><small>有一点不开心或生气的事情</small><p>${escapeHTML(entry.upset || "没有填写。")}</p></div><div class="journal-section"><small>希望对方怎样理解或支持我</small><p>${escapeHTML(entry.need || "没有填写。")}</p></div><div class="journal-section"><small>想对对方说</small><p>${escapeHTML(entry.message || "没有填写。")}</p></div>${isSelf ? `<button class="button secondary small" data-edit-entry>修改我的记录</button>` : ""}</div></section>`;
}

async function renderJournal() {
  const day = await fetchDay();
  document.querySelector("#pageRoot").innerHTML = `<div class="journal-columns">${journalCard("dog", entryForRole(day.entries, "dog"))}${journalCard("cat", entryForRole(day.entries, "cat"))}</div><section class="card communication-card"><div class="card-header"><div class="card-title"><span class="card-title-icon">♡</span><div><h3>这一天的温柔回应</h3><p>回应会实时出现在对方页面</p></div></div></div><div class="communication-list">${day.responses.length ? day.responses.map((response) => `<div class="communication-item"><strong>${escapeHTML(profileFor(response.from_user)?.display_name || "对方")} → ${escapeHTML(profileFor(response.to_user)?.display_name || "对方")}：${escapeHTML(response.text)}</strong><span>${new Date(response.created_at).toLocaleString("zh-CN")}</span></div>`).join("") : `<div class="empty-state compact">这一天还没有回应。</div>`}</div></section>`;
}

async function renderWishes() {
  const { data, error } = await supabase.from("wishes").select("*").eq("couple_id", context.couple.id).order("created_at", { ascending: false });
  if (error) throw error;
  const wishes = (data || []).filter((wish) => wishFilter === "全部" || wish.category === wishFilter);
  const categories = ["全部", "旅行", "美食", "电影", "体验", "生活", "长期目标"];
  document.querySelector("#pageRoot").innerHTML = `<div class="section-toolbar"><div class="section-heading"><h2>以后想一起完成的事情</h2><p>推进到“已经完成”后，会自动生成共同回忆。</p></div><div class="segment-control">${categories.map((item) => `<button class="segment-button ${wishFilter === item ? "active" : ""}" data-wish-filter="${item}">${item}</button>`).join("")}</div></div><div class="wish-board">${wishes.length ? wishes.map(wishCardHTML).join("") : `<div class="empty-state full-span">这个分类里还没有愿望。<br><button class="button primary small" data-add-wish style="margin-top:12px">添加一个愿望</button></div>`}</div>`;
}

function wishCardHTML(wish) {
  const ownerIcon = wish.owner_role === "both" ? "🐶🐱" : PERSON[wish.owner_role].icon;
  return `<article class="card wish-card"><div class="wish-top"><span class="status-label">${escapeHTML(wish.category)}</span><span>${ownerIcon}</span></div><h3>${escapeHTML(wish.title)}</h3><p>${escapeHTML(wish.note || "以后一起完成。")}</p><div class="wish-meta">${wish.planned_date ? `计划日期：${shortDate(wish.planned_date)}` : "暂时没有设定日期"}</div><div class="wish-bottom"><div class="wish-status-line"><span class="status-label">${WISH_STAGES[wish.status]}</span><span>${wish.status + 1}/4</span></div><div class="stage-track">${[0,1,2,3].map((index) => `<span class="${index <= wish.status ? "active" : ""}"></span>`).join("")}</div><div class="wish-actions"><button class="button primary small" data-advance-wish="${wish.id}" ${wish.status >= 3 ? "disabled" : ""}>${wish.status >= 3 ? "已经完成" : "推进一步"}</button><button class="button danger small" data-delete-wish="${wish.id}">删除</button></div></div></article>`;
}

async function renderMemories() {
  const { data, error } = await supabase.from("memories").select("*").eq("couple_id", context.couple.id).order("memory_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  const memories = data || [];
  const taskCount = memories.filter((item) => item.source_type === "task").length;
  const wishCount = memories.filter((item) => item.source_type === "wish").length;
  const uniqueDays = new Set(memories.map((item) => item.memory_date)).size;
  document.querySelector("#pageRoot").innerHTML = `<div class="memory-stats"><div class="memory-stat"><span class="memory-stat-icon">♥</span><div><span>共同回忆</span><strong>${memories.length}</strong></div></div><div class="memory-stat"><span class="memory-stat-icon">✓</span><div><span>完成事项</span><strong>${taskCount}</strong></div></div><div class="memory-stat"><span class="memory-stat-icon">☆</span><div><span>实现愿望</span><strong>${wishCount}</strong></div></div><div class="memory-stat"><span class="memory-stat-icon">☀</span><div><span>被记录的日子</span><strong>${uniqueDays}</strong></div></div></div><div class="timeline">${memories.length ? memories.map((memory) => `<article class="timeline-item"><time>${fullDate(memory.memory_date)}</time><h3>${escapeHTML(memory.icon)} ${escapeHTML(memory.title)}</h3><p>${escapeHTML(memory.note || "这是属于我们的共同回忆。")}</p>${memory.source_type === "manual" ? `<button class="delete-button" style="position:absolute;right:18px;top:18px" data-delete-memory="${memory.id}" title="删除回忆">×</button>` : ""}</article>`).join("") : `<div class="empty-state">共同完成的事情，会慢慢出现在这里。</div>`}</div>`;
}

function openModal(content) {
  const root = document.querySelector("#modalRoot");
  root.innerHTML = `<div class="modal-backdrop" data-close-backdrop>${content}</div>`;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  const root = document.querySelector("#modalRoot");
  if (root) root.innerHTML = "";
  document.body.style.overflow = "";
}
function modalHeader(eyebrow, title) {
  return `<div class="modal-header"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><button class="close-modal" type="button" data-close-modal>×</button></div>`;
}

function openTaskModal() {
  openModal(`<section class="modal">${modalHeader("NEW PLAN", "添加共同事项")}<form id="taskForm" class="form-grid"><div class="preset-row"><button type="button" class="preset-chip" data-task-preset="晚上视频通话">视频通话</button><button type="button" class="preset-chip" data-task-preset="一起看一部电影">一起看电影</button><button type="button" class="preset-chip" data-task-preset="一起学习一小时">一起学习</button><button type="button" class="preset-chip" data-task-preset="睡前认真说晚安">睡前晚安</button></div><label>事情名称<input name="title" required maxlength="100" placeholder="例如：晚上一起视频通话"></label><div class="form-row"><label>日期<input name="date" type="date" required value="${selectedDate}"></label><label>时间<input name="time" type="time"></label></div><label>备注<textarea name="note" maxlength="300" placeholder="写下一点小约定……"></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">保存到共享日程</button></div></form></section>`);
}

async function openEntryModal() {
  const member = selfMember();
  const { data: existing, error } = await supabase.from("daily_entries").select("*").eq("couple_id", context.couple.id).eq("record_date", selectedDate).eq("user_id", session.user.id).maybeSingle();
  if (error) { showToast(getErrorMessage(error), true); return; }
  const moods = [["😄","开心"],["🙂","平静"],["😫","疲惫"],["😔","难过"],["😡","生气"],["🥺","想你"]];
  openModal(`<section class="modal wide">${modalHeader("TODAY'S FEELING", `记录${fullDate(selectedDate)}的心情`)}<form id="entryForm" class="form-grid"><fieldset class="mood-options"><legend>今天感觉怎么样？</legend>${moods.map(([emoji, mood], index) => `<label><input type="radio" name="mood" value="${mood}" data-emoji="${emoji}" ${(existing?.mood === mood || (!existing && index === 1)) ? "checked" : ""}><span>${emoji}<small>${mood}</small></span></label>`).join("")}</fieldset><div class="form-row"><label>今天发生了什么<textarea name="story" maxlength="500">${escapeHTML(existing?.story || "")}</textarea></label><label>因为对方而开心的事情<textarea name="happy" maxlength="500">${escapeHTML(existing?.happy || "")}</textarea></label></div><div class="form-row"><label>有一点不开心或生气的事情<textarea name="upset" maxlength="500">${escapeHTML(existing?.upset || "")}</textarea></label><label>希望对方怎样理解或支持我<textarea name="need" maxlength="500">${escapeHTML(existing?.need || "")}</textarea></label></div><label>今天想对对方说<textarea name="message" maxlength="500">${escapeHTML(existing?.message || "")}</textarea></label><label class="checkbox-row"><input type="checkbox" name="shared" ${existing?.visibility !== "private" ? "checked" : ""}> 允许对方看到这一天的记录</label><p class="form-message" data-form-message></p><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">保存我的记录</button></div></form></section>`);
}

async function openNoteModal() {
  const { data } = await supabase.from("daily_notes").select("content").eq("couple_id", context.couple.id).eq("record_date", selectedDate).maybeSingle();
  openModal(`<section class="modal">${modalHeader("A NOTE FOR YOU", `留下${shortDate(selectedDate)}的一句话`)}<form id="noteForm" class="form-grid"><label>共享留言<textarea name="content" maxlength="500" required placeholder="例如：今天也要好好吃饭，晚上见。">${escapeHTML(data?.content || "")}</textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">保存共享留言</button></div></form></section>`);
}

function openWishModal() {
  openModal(`<section class="modal">${modalHeader("NEW WISH", "添加一个共同愿望")}<form id="wishForm" class="form-grid"><label>愿望标题<input name="title" required maxlength="100" placeholder="例如：一起去海边看日落"></label><div class="form-row"><label>类别<select name="category"><option>旅行</option><option>美食</option><option>电影</option><option>体验</option><option>生活</option><option>长期目标</option></select></label><label>谁想到的<select name="ownerRole"><option value="both">我们</option><option value="dog">狗狗</option><option value="cat">咪咪</option></select></label></div><label>计划日期（可选）<input name="plannedDate" type="date"></label><label>小备注<textarea name="note" maxlength="300" placeholder="为什么想一起完成它？"></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">放进愿望清单</button></div></form></section>`);
}

function openMemoryModal() {
  openModal(`<section class="modal">${modalHeader("NEW MEMORY", "保存一条共同回忆")}<form id="memoryForm" class="form-grid"><div class="form-row"><label>日期<input name="date" type="date" required value="${selectedDate}"></label><label>小图标<select name="icon"><option>♥</option><option>🏡</option><option>🎬</option><option>✈️</option><option>🎂</option><option>🌙</option><option>🌊</option></select></label></div><label>回忆标题<input name="title" required maxlength="120" placeholder="例如：第一次一起做晚饭"></label><label>想记住的细节<textarea name="note" maxlength="500"></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">保存到回忆</button></div></form></section>`);
}

function handlePageAction() {
  if (currentPage === "home" || currentPage === "journal") openEntryModal();
  if (currentPage === "schedule") openTaskModal();
  if (currentPage === "wishes") openWishModal();
  if (currentPage === "memories") openMemoryModal();
}

async function handleDelegatedClick(event) {
  const dateButton = event.target.closest("[data-select-date]");
  if (dateButton) { selectDate(dateButton.dataset.selectDate); return; }
  if (event.target.closest("[data-add-task]")) { openTaskModal(); return; }
  if (event.target.closest("[data-edit-entry]")) { openEntryModal(); return; }
  if (event.target.closest("[data-edit-note]")) { openNoteModal(); return; }
  if (event.target.closest("[data-add-wish]")) { openWishModal(); return; }
  if (event.target.closest("[data-close-modal]")) { closeModal(); return; }
  if (event.target.matches("[data-close-backdrop]")) { closeModal(); return; }

  const preset = event.target.closest("[data-task-preset]");
  if (preset) { const input = document.querySelector('#taskForm input[name="title"]'); if (input) { input.value = preset.dataset.taskPreset; input.focus(); } return; }
  const range = event.target.closest("[data-schedule-range]");
  if (range) { scheduleRange = range.dataset.scheduleRange; renderCurrentPage(); return; }
  const filter = event.target.closest("[data-wish-filter]");
  if (filter) { wishFilter = filter.dataset.wishFilter; renderCurrentPage(); return; }
  const toggle = event.target.closest("[data-toggle-task]");
  if (toggle) { await toggleTask(toggle.dataset.toggleTask); return; }
  const deleteTask = event.target.closest("[data-delete-task]");
  if (deleteTask) { await removeTask(deleteTask.dataset.deleteTask); return; }
  const response = event.target.closest("[data-response]");
  if (response) { await addResponse(response.dataset.targetUser, response.dataset.response); return; }
  const advance = event.target.closest("[data-advance-wish]");
  if (advance) { await advanceWish(advance.dataset.advanceWish); return; }
  const deleteWish = event.target.closest("[data-delete-wish]");
  if (deleteWish) { await removeWish(deleteWish.dataset.deleteWish); return; }
  const deleteMemory = event.target.closest("[data-delete-memory]");
  if (deleteMemory) { await removeMemory(deleteMemory.dataset.deleteMemory); }
}

async function handleDelegatedSubmit(event) {
  const form = event.target;
  if (!["taskForm", "entryForm", "noteForm", "wishForm", "memoryForm"].includes(form.id)) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  setBusy(button, true, "正在保存……");
  try {
    if (form.id === "taskForm") await saveTask(data);
    if (form.id === "entryForm") await saveEntry(form, data);
    if (form.id === "noteForm") await saveNote(data);
    if (form.id === "wishForm") await saveWish(data);
    if (form.id === "memoryForm") await saveMemory(data);
    closeModal();
    await renderCurrentPage();
  } catch (error) {
    setFormMessage(form, getErrorMessage(error), "error");
    showToast(getErrorMessage(error), true);
    setBusy(button, false);
  }
}

async function saveTask(data) {
  const date = String(data.get("date"));
  const { error } = await supabase.from("tasks").insert({ couple_id: context.couple.id, task_date: date, task_time: data.get("time") || null, title: String(data.get("title") || "").trim(), note: String(data.get("note") || "").trim(), created_by: session.user.id });
  if (error) throw error;
  selectedDate = date;
  localStorage.setItem("dogCat:selectedDate", date);
  updateChrome();
  showToast("新的共同事项已经同步给对方。 ");
}

async function saveEntry(form, data) {
  const selectedMood = form.querySelector('input[name="mood"]:checked');
  const payload = { couple_id: context.couple.id, record_date: selectedDate, user_id: session.user.id, mood: String(data.get("mood")), emoji: selectedMood.dataset.emoji, story: String(data.get("story") || "").trim(), happy: String(data.get("happy") || "").trim(), upset: String(data.get("upset") || "").trim(), need: String(data.get("need") || "").trim(), message: String(data.get("message") || "").trim(), visibility: data.get("shared") ? "shared" : "private" };
  const { error } = await supabase.from("daily_entries").upsert(payload, { onConflict: "couple_id,record_date,user_id" });
  if (error) throw error;
  showToast(payload.visibility === "shared" ? "今日记录已经同步给对方。" : "今日记录已保存为仅自己可见。 ");
}

async function saveNote(data) {
  const payload = { couple_id: context.couple.id, record_date: selectedDate, content: String(data.get("content") || "").trim(), author_id: session.user.id };
  const { error } = await supabase.from("daily_notes").upsert(payload, { onConflict: "couple_id,record_date" });
  if (error) throw error;
  showToast("这一天的留言已经同步。 ");
}

async function saveWish(data) {
  const { error } = await supabase.from("wishes").insert({ couple_id: context.couple.id, title: String(data.get("title") || "").trim(), category: String(data.get("category")), owner_role: String(data.get("ownerRole")), planned_date: data.get("plannedDate") || null, note: String(data.get("note") || "").trim(), created_by: session.user.id });
  if (error) throw error;
  showToast("新的愿望已经加入共同清单。 ");
}

async function saveMemory(data) {
  const { error } = await supabase.from("memories").insert({ couple_id: context.couple.id, memory_date: String(data.get("date")), title: String(data.get("title") || "").trim(), note: String(data.get("note") || "").trim(), icon: String(data.get("icon") || "♥"), source_type: "manual", created_by: session.user.id });
  if (error) throw error;
  showToast("这条共同回忆已经保存。 ");
}

async function toggleTask(taskId) {
  const role = selfMember().role;
  const field = role === "dog" ? "dog_done" : "cat_done";
  const { data: task, error: readError } = await supabase.from("tasks").select(`id, ${field}`).eq("id", taskId).single();
  if (readError) { showToast(getErrorMessage(readError), true); return; }
  const { error } = await supabase.from("tasks").update({ [field]: !task[field] }).eq("id", taskId);
  if (error) { showToast(getErrorMessage(error), true); return; }
  showToast("你的完成状态已经同步。 ");
  await renderCurrentPage();
}

async function removeTask(taskId) {
  if (!window.confirm("确定删除这项共同事项吗？")) return;
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) showToast(getErrorMessage(error), true); else { showToast("事项已经删除。 "); await renderCurrentPage(); }
}

async function addResponse(targetUser, text) {
  const { error } = await supabase.from("responses").insert({ couple_id: context.couple.id, record_date: selectedDate, from_user: session.user.id, to_user: targetUser, text });
  if (error) showToast(getErrorMessage(error), true); else { showToast(`已经对对方说：“${text}”。`); await renderCurrentPage(); }
}

async function advanceWish(wishId) {
  const { data: wish, error: readError } = await supabase.from("wishes").select("status").eq("id", wishId).single();
  if (readError) { showToast(getErrorMessage(readError), true); return; }
  const next = Math.min(3, wish.status + 1);
  const { error } = await supabase.from("wishes").update({ status: next }).eq("id", wishId);
  if (error) showToast(getErrorMessage(error), true); else { showToast(`愿望进入“${WISH_STAGES[next]}”阶段。`); await renderCurrentPage(); }
}

async function removeWish(wishId) {
  if (!window.confirm("确定删除这个愿望吗？")) return;
  const { error } = await supabase.from("wishes").delete().eq("id", wishId);
  if (error) showToast(getErrorMessage(error), true); else { showToast("愿望已经删除。 "); await renderCurrentPage(); }
}

async function removeMemory(memoryId) {
  if (!window.confirm("确定删除这条手动回忆吗？")) return;
  const { error } = await supabase.from("memories").delete().eq("id", memoryId);
  if (error) showToast(getErrorMessage(error), true); else { showToast("回忆已经删除。 "); await renderCurrentPage(); }
}

function handleEscape(event) {
  if (event.key === "Escape") closeModal();
}

function subscribeRealtime() {
  unsubscribeRealtime();
  const tables = ["daily_notes", "daily_entries", "tasks", "responses", "wishes", "memories"];
  realtimeChannel = supabase.channel(`couple-${context.couple.id}`);
  tables.forEach((table) => realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table, filter: `couple_id=eq.${context.couple.id}` }, scheduleRealtimeRefresh));
  realtimeChannel.subscribe((status) => {
    const dot = document.querySelector("#syncDot");
    const text = document.querySelector("#syncText");
    if (!dot || !text) return;
    const connected = status === "SUBSCRIBED";
    dot.classList.toggle("offline", !connected);
    text.textContent = connected ? "云端实时同步" : "正在连接云端";
  });
}

function scheduleRealtimeRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!document.querySelector(".modal-backdrop")) renderCurrentPage();
  }, 180);
}

function unsubscribeRealtime() {
  if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

window.addEventListener("popstate", () => {
  currentPage = getPageFromUrl();
  if (context?.membership) {
    updateChrome();
    renderCurrentPage();
  }
});

initialize();
