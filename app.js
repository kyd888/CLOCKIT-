const STORAGE_KEY = "clockit-state-v1";

const defaultState = {
  page: "now",
  projects: [],
  sessions: [],
  active: null,
  lastProjectId: null,
  sheet: null,
};

let storageError = "";
let storageReadBlocked = false;
let sheetTrigger = null;
let state = loadState();
let tickHandle = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...defaultState };
    const saved = JSON.parse(raw);
    if (!validStoredState(saved)) throw new Error("Invalid saved data");
    return {
      ...defaultState,
      ...saved,
      page: "now",
      sheet: null,
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    };
  } catch {
    storageReadBlocked = true;
    storageError = "Your saved data could not be opened. Reload to try again. CLOCKIT will not overwrite it.";
    return { ...defaultState };
  }
}

function validStoredState(saved) {
  const id = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
  const time = (value) => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  if (!saved || !Array.isArray(saved.projects) || !Array.isArray(saved.sessions)) return false;
  if (!saved.projects.every((project) => project && id(project.id) && typeof project.name === "string"
    && typeof project.category === "string" && time(project.createdAt)
    && (project.budgetHours === null || (Number.isFinite(project.budgetHours) && project.budgetHours > 0)))) return false;
  if (!saved.sessions.every((session) => session && id(session.id) && id(session.projectId)
    && time(session.startedAt) && time(session.endedAt) && session.endedAt >= session.startedAt
    && Number.isFinite(session.durationSeconds) && session.durationSeconds >= 0
    && Number.isFinite(session.earnings) && session.earnings >= 0 && typeof session.note === "string")) return false;
  if (saved.active && (!time(saved.active.startedAt) || !saved.projects.some((project) => project.id === saved.active.projectId))) return false;
  return new Set(saved.projects.map((project) => project.id)).size === saved.projects.length
    && new Set(saved.sessions.map((session) => session.id)).size === saved.sessions.length;
}

function persist(nextState) {
  if (storageReadBlocked) {
    showStorageError();
    return false;
  }
  try {
    const persisted = { ...nextState, page: "now", sheet: null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    state = nextState;
    storageError = "";
    document.getElementById("storage-error")?.remove();
    return true;
  } catch {
    storageError = "Could not save this change. Your previous data is unchanged. Check that browser storage is available, then try again.";
    showStorageError();
    return false;
  }
}

function showStorageError() {
  let alert = document.getElementById("storage-error");
  if (!alert) {
    alert = document.createElement("p");
    alert.id = "storage-error";
    alert.className = "storage-error";
    alert.setAttribute("role", "alert");
    document.body.appendChild(alert);
  }
  alert.textContent = storageError;
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
  if (storageError) showStorageError();
  document.body.classList.toggle("sheet-open", Boolean(state.sheet));
  app.querySelectorAll(":scope > :not(.sheet-backdrop)").forEach((element) => {
    element.inert = Boolean(state.sheet);
  });
  if (state.sheet) {
    const dialog = document.querySelector(".sheet");
    (dialog.querySelector("[autofocus]") || dialog.querySelector("input, select, textarea") || dialog).focus();
  }

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
            <button class="link-button session-edit" data-edit-session="${session.id}" aria-label="Edit session for ${escapeHtml(project?.name || "Work")} on ${label}">Edit session</button>
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
  if (state.sheet.type === "edit-session") return editSessionSheet(state.sheet.sessionId);
  return "";
}

function sheetFrame(content) {
  return `
    <div class="sheet-backdrop" data-action="close-sheet">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-heading" tabindex="-1" onclick="event.stopPropagation()">
        <div class="handle"></div>
        <button class="icon-button sheet-close" data-action="close-sheet" aria-label="Close dialog">×</button>
        ${content.replace('class="sheet-title"', 'class="sheet-title" id="sheet-heading"')}
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
        <button class="project-row" data-start-project="${project.id}" ${state.active ? "disabled" : ""}>
          <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(remainingText(project))}</small></span>
          <span class="chevron">›</span>
        </button>
      `).join("")
    : `<div class="empty"><strong>Start with one project</strong>A project can be a client, performance, business, or idea you want to time-box.</div>`;

  return sheetFrame(`
    <h2 class="sheet-title">Choose your work</h2>
    <p class="sheet-subtitle">${state.active ? "A timer is running. Stop it before starting another project." : "Pick it and the timer starts immediately."}</p>
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
        <button class="primary-button compact-primary" type="submit">${state.active ? "Create project" : "Create + start"}</button>
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

function localDateTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function editSessionSheet(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return "";
  return sheetFrame(`
    <h2 class="sheet-title">Edit session</h2>
    <p class="sheet-subtitle">Forgot to stop? Correct the time here. Your totals will update automatically.</p>
    <form class="form" id="session-form" data-session-id="${session.id}">
      <div class="field">
        <label for="session-project">Project</label>
        <select id="session-project" name="projectId" required>
          ${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === session.projectId ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="session-start">Started</label>
        <input id="session-start" name="startedAt" type="datetime-local" step="60" value="${localDateTime(session.startedAt).slice(0, 16)}" required />
      </div>
      <div class="field">
        <label for="session-end">Ended</label>
        <input id="session-end" name="endedAt" type="datetime-local" step="60" value="${localDateTime(session.endedAt).slice(0, 16)}" required />
      </div>
      <div class="field">
        <label for="earnings">Money earned or attributed (optional)</label>
        <input id="earnings" name="earnings" type="number" min="0" step="0.01" inputmode="decimal" value="${session.earnings || ""}" placeholder="$0" />
      </div>
      <div class="field">
        <label for="note">Quick note (optional)</label>
        <textarea id="note" name="note" maxlength="180">${escapeHtml(session.note || "")}</textarea>
      </div>
      <p class="form-error" id="session-error" role="alert" hidden></p>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-action="close-sheet">Cancel</button>
        <button class="primary-button compact-primary" type="submit">Save changes</button>
      </div>
    </form>
  `);
}

function saveEditedSession(event) {
  event.preventDefault();
  const sessionId = event.currentTarget.dataset.sessionId;
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const form = new FormData(event.currentTarget);
  // Keep the exact original timestamp when a date field was not changed,
  // including milliseconds and ambiguous local times around daylight saving.
  const readTime = (key) => {
    const raw = String(form.get(key));
    if (raw === localDateTime(session[key]).slice(0, 16)) return session[key];
    const value = raw.length === 16 ? `${raw}:00` : raw;
    if (value === localDateTime(session[key])) return session[key];
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && localDateTime(timestamp) === value ? timestamp : NaN;
  };
  const startedAt = readTime("startedAt");
  const endedAt = readTime("endedAt");
  const earnings = Number(form.get("earnings"));
  const projectId = String(form.get("projectId"));
  let error = "";
  if (!getProject(projectId)) error = "Choose a project for this session.";
  else if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) error = "Enter valid start and end times.";
  else if (endedAt <= startedAt) error = "End time must be after start time.";
  else if (endedAt > Date.now()) error = "End time cannot be in the future.";
  else if (!Number.isFinite(earnings) || earnings < 0) error = "Enter earnings of zero or more.";
  if (error) {
    const message = document.getElementById("session-error");
    message.textContent = error;
    message.hidden = false;
    return;
  }
  const updated = {
    ...session, projectId, startedAt, endedAt,
    durationSeconds: Math.max(1, Math.floor((endedAt - startedAt) / 1000)),
    earnings,
    note: String(form.get("note") || "").trim(),
    updatedAt: Date.now(),
  };
  if (!persist({ ...state, sessions: state.sessions.map((item) => item.id === sessionId ? updated : item), sheet: null })) return;
  render();
  document.querySelector(`[data-edit-session="${sessionId}"]`)?.focus();
  toast("Session updated");
}

function bindEvents() {
  document.querySelectorAll("[data-edit-session]").forEach((button) => {
    button.addEventListener("click", () => openSheet("edit-session", { sessionId: button.dataset.editSession }));
  });
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
  const sessionForm = document.getElementById("session-form");
  if (sessionForm) sessionForm.addEventListener("submit", saveEditedSession);
}

function openSheet(type, extra = {}) {
  if (!state.sheet) {
    const trigger = document.activeElement;
    sheetTrigger = trigger?.dataset.editSession
      ? `[data-edit-session="${trigger.dataset.editSession}"]`
      : trigger?.dataset.action ? `[data-action="${trigger.dataset.action}"]` : null;
  }
  state.sheet = { type, ...extra };
  render();
}

function closeSheet() {
  state.sheet = null;
  render();
  if (sheetTrigger) document.querySelector(sheetTrigger)?.focus();
  sheetTrigger = null;
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
  if (!Number.isFinite(budgetRaw) || budgetRaw < 0) return;
  const nextState = { ...state, projects: [project, ...state.projects], sheet: null };
  if (!state.active) {
    nextState.active = { projectId: project.id, startedAt: Date.now() };
    nextState.lastProjectId = project.id;
    nextState.page = "now";
  }
  if (!persist(nextState)) return;
  render();
}

function startProject(projectId) {
  if (state.active) return;
  const project = getProject(projectId);
  if (!project) return;

  if (!persist({
    ...state,
    active: { projectId, startedAt: Date.now() },
    lastProjectId: projectId,
    page: "now",
    sheet: null,
  })) return;
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

  if (!persist({
    ...state,
    sessions: [...state.sessions, session],
    lastProjectId: state.active.projectId,
    active: null,
    sheet: { type: "details", sessionId: session.id },
  })) return;
  render();
  toast("Time saved");
}

function saveSessionDetails(event) {
  event.preventDefault();
  const sessionId = event.currentTarget.dataset.sessionId;
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const form = new FormData(event.currentTarget);
  const earnings = Number(form.get("earnings"));
  if (!Number.isFinite(earnings) || earnings < 0) return;
  const updated = { ...session, earnings, note: String(form.get("note") || "").trim() };
  if (!persist({ ...state, sessions: state.sessions.map((item) => item.id === sessionId ? updated : item), sheet: null })) return;
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
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 1800);
}

function csvCell(value) {
  const text = String(value ?? "");
  // Spreadsheet apps may execute formulas even when a CSV field is quoted.
  const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
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

document.addEventListener("keydown", (event) => {
  if (!state.sheet) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSheet();
  }
  if (event.key === "Tab") {
    const controls = [...document.querySelectorAll('.sheet button:not([disabled]), .sheet input, .sheet select, .sheet textarea')];
    const first = controls[0];
    const last = controls.at(-1);
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !controls.includes(current))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (current === last || !controls.includes(current))) {
      event.preventDefault();
      first?.focus();
    }
  }
});

render();
