const STORAGE_KEY = "clockit-state-v1";

const defaultState = {
  page: "now",
  projects: [],
  sessions: [],
  active: null,
  lastProjectId: null,
  sheet: null,
};

let state = loadState();
let tickHandle = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return { ...defaultState };
    return {
      ...defaultState,
      ...saved,
      page: "now",
      sheet: null,
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    };
  } catch {
    return { ...defaultState };
  }
}

function persist() {
  const persisted = { ...state, page: "now", sheet: null };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function secondsToClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function secondsToHuman(seconds, compact = false) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (compact) return h ? `${h}h ${m}m` : `${m}m`;
  if (!h) return `${m} min`;
  return `${h} hr ${m} min`;
}

function activeElapsedSeconds() {
  if (!state.active?.startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - state.active.startedAt) / 1000));
}

function sessionSecondsForProject(projectId) {
  const complete = state.sessions
    .filter((session) => session.projectId === projectId)
    .reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0);
  const active = state.active?.projectId === projectId ? activeElapsedSeconds() : 0;
  return complete + active;
}

function earningsForProject(projectId) {
  return state.sessions
    .filter((session) => session.projectId === projectId)
    .reduce((sum, session) => sum + Number(session.earnings || 0), 0);
}

function getProject(projectId) {
  return state.projects.find((project) => project.id === projectId);
}

function remainingText(project) {
  if (!project?.budgetHours) return "No time budget";
  const budgetSeconds = Number(project.budgetHours) * 3600;
  const remaining = budgetSeconds - sessionSecondsForProject(project.id);
  if (remaining < 0) return `${secondsToHuman(Math.abs(remaining), true)} over budget`;
  return `${secondsToHuman(remaining, true)} left`;
}

function projectProgress(project) {
  if (!project?.budgetHours) return 0;
  const budgetSeconds = Number(project.budgetHours) * 3600;
  return Math.min(100, (sessionSecondsForProject(project.id) / budgetSeconds) * 100);
}

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const difference = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - difference);
  return date.getTime();
}

function sessionsThisWeek() {
  const start = startOfWeek();
  return state.sessions.filter((session) => Number(session.endedAt || 0) >= start);
}

function render() {
  clearInterval(tickHandle);
  const app = document.getElementById("app");
  if (!app) return;

  if (state.page === "history") app.innerHTML = historyView();
  else if (state.page === "insights") app.innerHTML = insightsView();
  else app.innerHTML = nowView();

  if (state.sheet) app.insertAdjacentHTML("beforeend", sheetView());
  bindEvents();

  if (state.active && state.page === "now") {
    tickHandle = setInterval(updateLiveTimer, 1000);
  }
}

function topbar() {
  return `
    <header class="topbar">
      <div class="brand">CLOCKIT</div>
      <button class="icon-button" data-action="open-projects" aria-label="Projects">+</button>
    </header>
  `;
}

function nav() {
  return `
    <nav class="nav" aria-label="Main navigation">
      <button data-page="now" class="${state.page === "now" ? "active" : ""}">Now</button>
      <button data-page="history" class="${state.page === "history" ? "active" : ""}">History</button>
      <button data-page="insights" class="${state.page === "insights" ? "active" : ""}">Insights</button>
    </nav>
  `;
}

function nowView() {
  const activeProject = state.active ? getProject(state.active.projectId) : null;
  const lastProject = state.lastProjectId ? getProject(state.lastProjectId) : null;

  if (state.active && activeProject) {
    return `
      ${topbar()}
      <section class="now-hero">
        <div class="eyebrow">Working on</div>
        <p class="active-project">${escapeHtml(activeProject.name)}</p>
        <div class="timer" id="live-timer">${secondsToClock(activeElapsedSeconds())}</div>
        <p class="remaining" id="live-remaining">${escapeHtml(remainingText(activeProject))}</p>
        <button class="stop-button" data-action="stop">Stop</button>
      </section>
      ${nav()}
    `;
  }

  return `
    ${topbar()}
    <section class="now-hero">
      <p class="hello">Make your time count.</p>
      <h1>What are you working on?</h1>
      <p class="muted">One tap in. One tap out.</p>
      <button class="primary-button" data-action="choose-project">Start working</button>
      ${lastProject ? `<button class="quick-resume" data-start-project="${lastProject.id}">Continue ${escapeHtml(lastProject.name)}</button>` : ""}
    </section>
    ${nav()}
  `;
}

function historyView() {
  const sessions = [...state.sessions].sort((a, b) => b.endedAt - a.endedAt);
  const rows = sessions.length
    ? sessions.map((session) => {
        const project = getProject(session.projectId);
        const date = new Date(session.endedAt);
        const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `
          <article class="session-row">
            <div class="row-top">
              <div class="row-title">${escapeHtml(project?.name || "Deleted project")}</div>
              <div class="row-value">${secondsToHuman(session.durationSeconds, true)}</div>
            </div>
            <div class="row-meta">${label}${session.earnings ? ` · ${money(session.earnings)}` : ""}${session.note ? ` · ${escapeHtml(session.note)}` : ""}</div>
          </article>
        `;
      }).join("")
    : `<div class="empty"><strong>No history yet</strong>Your completed work sessions will show up here.</div>`;

  return `
    ${topbar()}
    <div class="section-head">
      <div><div class="eyebrow">Your work</div><h1>History</h1></div>
    </div>
    <section class="card">${rows}</section>
    ${nav()}
  `;
}

function insightsView() {
  const week = sessionsThisWeek();
  const weekSeconds = week.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0);
  const weekEarnings = week.reduce((sum, session) => sum + Number(session.earnings || 0), 0);
  const hourly = weekSeconds > 0 ? weekEarnings / (weekSeconds / 3600) : 0;

  const summaries = state.projects.length
    ? state.projects.map((project) => {
        const seconds = sessionSecondsForProject(project.id);
        const earnings = earningsForProject(project.id);
        const rate = seconds > 0 ? earnings / (seconds / 3600) : 0;
        return `
          <article class="project-summary">
            <div class="row-top">
              <div class="row-title">${escapeHtml(project.name)}</div>
              <div class="row-value">${secondsToHuman(seconds, true)}</div>
            </div>
            <div class="row-meta">${escapeHtml(remainingText(project))}${earnings ? ` · ${money(rate)}/hr effective` : ""}</div>
            ${project.budgetHours ? `<div class="progress-track"><div class="progress-fill" style="width:${projectProgress(project)}%"></div></div>` : ""}
          </article>
        `;
      }).join("")
    : `<div class="empty"><strong>No projects yet</strong>Create a project and CLOCKIT will start learning where your time goes.</div>`;

  const strongest = state.projects
    .map((project) => {
      const seconds = sessionSecondsForProject(project.id);
      const earnings = earningsForProject(project.id);
      return { project, rate: seconds > 0 ? earnings / (seconds / 3600) : 0 };
    })
    .filter((item) => item.rate > 0)
    .sort((a, b) => b.rate - a.rate)[0];

  return `
    ${topbar()}
    <div class="section-head">
      <div><div class="eyebrow">This week</div><h1>Insights</h1></div>
      <button class="link-button" data-action="export">Export CSV</button>
    </div>
    ${strongest ? `<div class="insight-note"><strong>${escapeHtml(strongest.project.name)}</strong> is currently your highest value tracked work at about ${money(strongest.rate)}/hr.</div>` : ""}
    <section class="metric-grid">
      <div class="metric"><span>Time</span><strong>${secondsToHuman(weekSeconds, true)}</strong><span>tracked this week</span></div>
      <div class="metric"><span>Earnings</span><strong>${money(weekEarnings)}</strong><span>logged this week</span></div>
      <div class="metric"><span>Time value</span><strong>${money(hourly)}</strong><span>effective per hour</span></div>
      <div class="metric"><span>Projects</span><strong>${state.projects.length}</strong><span>active work buckets</span></div>
    </section>
    <h3>Projects</h3>
    <section class="card">${summaries}</section>
    ${nav()}
  `;
}

function sheetView() {
  if (state.sheet.type === "choose") return chooseProjectSheet();
  if (state.sheet.type === "new-project") return newProjectSheet();
  if (state.sheet.type === "details") return detailsSheet(state.sheet.sessionId);
  return "";
}

function sheetFrame(content) {
  return `
    <div class="sheet-backdrop" data-action="close-sheet">
      <section class="sheet" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="handle"></div>
        ${content}
      </section>
    </div>
  `;
}

function chooseProjectSheet() {
  const projects = [...state.projects].sort((a, b) => {
    if (a.id === state.lastProjectId) return -1;
    if (b.id === state.lastProjectId) return 1;
    return b.createdAt - a.createdAt;
  });

  const rows = projects.length
    ? projects.map((project) => `
        <button class="project-row" data-start-project="${project.id}">
          <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(remainingText(project))}</small></span>
          <span class="chevron">›</span>
        </button>
      `).join("")
    : `<div class="empty"><strong>Start with one project</strong>A project can be a client, performance, business, or idea you want to time-box.</div>`;

  return sheetFrame(`
    <h2 class="sheet-title">Choose your work</h2>
    <p class="sheet-subtitle">Pick it and the timer starts immediately.</p>
    ${rows}
    <button class="new-project-button" data-action="new-project">+ New project</button>
  `);
}

function newProjectSheet() {
  return sheetFrame(`
    <h2 class="sheet-title">New project</h2>
    <p class="sheet-subtitle">Only the name is required. Add a time budget when you want a boundary.</p>
    <form class="form" id="project-form">
      <div class="field">
        <label for="project-name">Project name</label>
        <input id="project-name" name="name" placeholder="Brand shoot, NC drop, product idea" maxlength="60" required autofocus />
      </div>
      <div class="field">
        <label for="budget-hours">Time budget in hours (optional)</label>
        <input id="budget-hours" name="budgetHours" type="number" min="0.25" step="0.25" placeholder="20" />
      </div>
      <div class="field">
        <label for="category">Type</label>
        <select id="category" name="category">
          <option value="Business">Business</option>
          <option value="Client">Client</option>
          <option value="Creative">Creative</option>
          <option value="Personal">Personal</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-action="close-sheet">Cancel</button>
        <button class="primary-button compact-primary" type="submit">Create + start</button>
      </div>
    </form>
  `);
}

function detailsSheet(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const project = session ? getProject(session.projectId) : null;
  if (!session) return "";

  return sheetFrame(`
    <h2 class="sheet-title">Session saved</h2>
    <p class="sheet-subtitle">${escapeHtml(project?.name || "Work")} · ${secondsToHuman(session.durationSeconds, true)}. Anything to add?</p>
    <form class="form" id="details-form" data-session-id="${session.id}">
      <div class="field">
        <label for="earnings">Money earned or attributed (optional)</label>
        <input id="earnings" name="earnings" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$0" value="${session.earnings || ""}" />
      </div>
      <div class="field">
        <label for="note">Quick note (optional)</label>
        <textarea id="note" name="note" maxlength="180" placeholder="Edited the final cut, performed set, client revisions...">${escapeHtml(session.note || "")}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-action="close-sheet">Skip</button>
        <button class="primary-button compact-primary" type="submit">Save details</button>
      </div>
    </form>
  `);
}

function bindEvents() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.page;
      state.sheet = null;
      render();
    });
  });

  document.querySelectorAll("[data-start-project]").forEach((button) => {
    button.addEventListener("click", () => startProject(button.dataset.startProject));
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = button.dataset.action;
      if (action === "choose-project" || action === "open-projects") openSheet("choose");
      if (action === "new-project") openSheet("new-project");
      if (action === "close-sheet") {
        event.stopPropagation();
        closeSheet();
      }
      if (action === "stop") stopActiveSession();
      if (action === "export") exportCsv();
    });
  });

  const projectForm = document.getElementById("project-form");
  if (projectForm) projectForm.addEventListener("submit", createProjectAndStart);

  const detailsForm = document.getElementById("details-form");
  if (detailsForm) detailsForm.addEventListener("submit", saveSessionDetails);
}

function openSheet(type, extra = {}) {
  state.sheet = { type, ...extra };
  render();
}

function closeSheet() {
  state.sheet = null;
  render();
}

function createProjectAndStart(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  if (!name) return;

  const budgetRaw = Number(form.get("budgetHours"));
  const project = {
    id: uid("project"),
    name,
    budgetHours: budgetRaw > 0 ? budgetRaw : null,
    category: String(form.get("category") || "Business"),
    createdAt: Date.now(),
  };
  state.projects.unshift(project);
  persist();
  startProject(project.id);
}

function startProject(projectId) {
  if (state.active) return;
  const project = getProject(projectId);
  if (!project) return;

  state.active = {
    projectId,
    startedAt: Date.now(),
  };
  state.lastProjectId = projectId;
  state.page = "now";
  state.sheet = null;
  persist();
  render();
}

function stopActiveSession() {
  if (!state.active) return;
  const endedAt = Date.now();
  const durationSeconds = Math.max(1, Math.floor((endedAt - state.active.startedAt) / 1000));
  const session = {
    id: uid("session"),
    projectId: state.active.projectId,
    startedAt: state.active.startedAt,
    endedAt,
    durationSeconds,
    earnings: 0,
    note: "",
    createdAt: endedAt,
  };

  state.sessions.push(session);
  state.lastProjectId = state.active.projectId;
  state.active = null;
  state.sheet = { type: "details", sessionId: session.id };
  persist();
  render();
  toast("Time saved");
}

function saveSessionDetails(event) {
  event.preventDefault();
  const sessionId = event.currentTarget.dataset.sessionId;
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const form = new FormData(event.currentTarget);
  session.earnings = Math.max(0, Number(form.get("earnings")) || 0);
  session.note = String(form.get("note") || "").trim();
  state.sheet = null;
  persist();
  render();
  toast("Details saved");
}

function updateLiveTimer() {
  const timer = document.getElementById("live-timer");
  const remaining = document.getElementById("live-remaining");
  if (timer) timer.textContent = secondsToClock(activeElapsedSeconds());
  const project = state.active ? getProject(state.active.projectId) : null;
  if (remaining && project) remaining.textContent = remainingText(project);
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 1800);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const header = ["Date", "Project", "Category", "Start", "End", "Hours", "Earnings", "Note"];
  const rows = state.sessions.map((session) => {
    const project = getProject(session.projectId);
    const start = new Date(session.startedAt);
    const end = new Date(session.endedAt);
    return [
      end.toLocaleDateString("en-US"),
      project?.name || "Deleted project",
      project?.category || "",
      start.toLocaleTimeString("en-US"),
      end.toLocaleTimeString("en-US"),
      (session.durationSeconds / 3600).toFixed(2),
      Number(session.earnings || 0).toFixed(2),
      session.note || "",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `clockit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("CSV exported");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
