const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const key = 'clockit-state-v1';
let server, browser, origin;
let serverOffline = false;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

before(async () => {
  server = http.createServer(async (req, res) => {
    if (serverOffline) { req.socket.destroy(); return; }
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('Outside root');
      const content = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function fixture() {
  return {
    projects: [
      { id: 'project_shoot', name: 'Brand shoot', budgetHours: 20, category: 'Client', createdAt: 1792508400000 },
      { id: 'project_album', name: 'Album', budgetHours: 10, category: 'Creative', createdAt: 1792508400000 },
    ],
    sessions: [{ id: 'session_one', projectId: 'project_shoot', startedAt: Date.parse('2026-10-21T14:00:00.123Z'), endedAt: Date.parse('2026-10-21T16:00:00.456Z'), durationSeconds: 7200, earnings: 60, note: 'First edit', createdAt: 1792598400456 }],
    active: null, lastProjectId: 'project_shoot', page: 'now', sheet: null,
  };
}

async function setup(t, data, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', serviceWorkers: 'block', ...options });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught application errors'));
  await page.clock.install({ time: new Date('2026-10-23T18:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-23T18:00:00Z'));
  await page.goto(origin);
  if (data !== undefined) {
    await page.evaluate(({ key, data }) => localStorage.setItem(key, typeof data === 'string' ? data : JSON.stringify(data)), { key, data });
    await page.reload();
  }
  return page;
}

const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function edit(page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: /Edit session for/ }).first().click();
  await page.getByRole('dialog', { name: 'Edit session', exact: true }).waitFor();
}
async function breakWrites(page) {
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Quota full', 'QuotaExceededError'); };
  });
}
async function restoreWrites(page) {
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
}

test('create, start, reload, stop, skip details and quick resume keep real time', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: 'Start working' }).click();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Client launch');
  await page.getByLabel('Time budget').fill('20');
  await page.getByRole('button', { name: 'Create + start' }).click();
  const startedAt = (await saved(page)).active.startedAt;
  await page.clock.fastForward(125000);
  await page.reload();
  assert.equal((await saved(page)).active.startedAt, startedAt);
  assert.match(await page.locator('#live-timer').textContent(), /00:02:0[5-9]/);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  let data = await saved(page);
  assert.equal(data.active, null);
  assert.equal(data.sessions.length, 1);
  assert.ok(data.sessions[0].durationSeconds >= 125);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Continue Client launch' }).click();
  data = await saved(page);
  assert.equal(data.active.projectId, data.projects[0].id);
  assert.equal(data.sessions.length, 1);
});

test('editing updates history, project budgets, earnings, hourly value and CSV', async t => {
  const page = await setup(t, fixture());
  await edit(page);
  await page.getByLabel('Project', { exact: true }).selectOption('project_album');
  await page.getByLabel('Started', { exact: true }).fill('2026-10-21T10:00');
  await page.getByLabel('Ended', { exact: true }).fill('2026-10-21T11:00');
  await page.getByLabel('Money earned').fill('120');
  await page.getByLabel('Quick note').fill('Final mix');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const session = (await saved(page)).sessions[0];
  assert.equal(session.projectId, 'project_album');
  assert.equal(session.durationSeconds, 3600);
  assert.equal(session.earnings, 120);
  assert.equal(session.note, 'Final mix');
  assert.equal(session.startedAt, Date.parse('2026-10-21T15:00:00Z'));
  assert.match(await page.locator('.session-row').textContent(), /Album[\s\S]*1h 0m[\s\S]*Final mix/);
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  assert.match(await page.locator('.project-summary').filter({ hasText: 'Album' }).textContent(), /9h 0m left.*\$120\/hr/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await fs.readFile(await download.path(), 'utf8');
  assert.match(csv, /"Album","Creative".*"1.00","120.00","Final mix"/);
  await page.reload();
  assert.deepEqual((await saved(page)).sessions[0], session);
});

test('cancel, reversed dates and future dates leave a session unchanged', async t => {
  const page = await setup(t, fixture());
  const original = await saved(page);
  await edit(page);
  await page.getByLabel('Quick note').fill('Do not save');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await saved(page), original);
  await edit(page);
  await page.getByLabel('Ended', { exact: true }).fill('2026-10-21T08:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  assert.match(await page.locator('#session-error').textContent(), /after start/);
  assert.deepEqual(await saved(page), original);
  await page.getByLabel('Ended', { exact: true }).fill('2026-10-24T08:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  assert.match(await page.locator('#session-error').textContent(), /future/);
  assert.deepEqual(await saved(page), original);
});

test('notes-only edits preserve exact timestamps and safely render text', async t => {
  const original = fixture();
  const page = await setup(t, original);
  await edit(page);
  await page.getByLabel('Quick note').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const session = (await saved(page)).sessions[0];
  assert.equal(session.startedAt, original.sessions[0].startedAt);
  assert.equal(session.endedAt, original.sessions[0].endedAt);
  assert.equal(await page.locator('.session-row img').count(), 0);
  assert.match(await page.locator('.row-meta').textContent(), /<img/);
});

test('creating a project during a timer preserves the active project', async t => {
  const data = fixture();
  data.active = { projectId: 'project_shoot', startedAt: Date.parse('2026-10-23T17:00:00Z') };
  const page = await setup(t, data);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  assert.equal(await page.locator('.project-row:disabled').count(), 2);
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const result = await saved(page);
  assert.equal(result.projects.length, 3);
  assert.deepEqual(result.active, data.active);
  assert.equal(result.lastProjectId, data.lastProjectId);
  assert.equal(result.sessions.length, 1);
  assert.equal(await page.locator('.active-project').textContent(), 'Brand shoot');
});

test('failed stop retains running timer and retry saves exactly once', async t => {
  const data = fixture();
  data.active = { projectId: 'project_shoot', startedAt: Date.parse('2026-10-23T17:00:00Z') };
  const page = await setup(t, data);
  await breakWrites(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(await saved(page), data);
  assert.match(await page.getByRole('alert').textContent(), /Could not save/);
  await restoreWrites(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal((await saved(page)).sessions.length, 2);
  assert.equal((await saved(page)).active, null);
  assert.equal(await page.locator('#storage-error').count(), 0);
});

test('failed edits preserve saved values and keep form inputs for retry', async t => {
  const page = await setup(t, fixture());
  const original = await saved(page);
  await edit(page);
  await page.getByLabel('Quick note').fill('Keep this draft');
  await breakWrites(page);
  await page.getByRole('button', { name: 'Save changes' }).click();
  assert.deepEqual(await saved(page), original);
  assert.equal(await page.getByLabel('Quick note').inputValue(), 'Keep this draft');
  await restoreWrites(page);
  await page.getByRole('button', { name: 'Save changes' }).click();
  assert.equal((await saved(page)).sessions[0].note, 'Keep this draft');
});

test('failed create does not add a phantom project or start a timer', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: 'Start working' }).click();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  await page.getByLabel('Project name').fill('New work');
  await breakWrites(page);
  await page.getByRole('button', { name: 'Create + start' }).click();
  assert.equal(await saved(page), null);
  assert.equal(await page.getByLabel('Project name').inputValue(), 'New work');
  await restoreWrites(page);
  await page.getByRole('button', { name: 'Create + start' }).click();
  assert.equal((await saved(page)).projects.length, 1);
  assert.ok((await saved(page)).active);
});

test('unreadable data is retained and cannot be silently overwritten', async t => {
  const page = await setup(t, '{broken');
  assert.match(await page.getByRole('alert').textContent(), /will not overwrite/);
  await page.getByRole('button', { name: 'Start working' }).click();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Must not overwrite');
  await page.getByRole('button', { name: 'Create + start' }).click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{broken');
});

test('invalid saved records are protected before rendering', async t => {
  const badStates = ['null', 'false', JSON.stringify({ projects: [null], sessions: [] }), JSON.stringify({ ...fixture(), active: { projectId: 'missing', startedAt: 1000 } })];
  const page = await setup(t);
  for (const raw of badStates) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
    await page.reload();
    assert.match(await page.getByRole('alert').textContent(), /will not overwrite/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), raw);
  }
});

test('optional post-stop details stay available after a failed save', async t => {
  const data = fixture();
  data.active = { projectId: 'project_shoot', startedAt: Date.parse('2026-10-23T17:00:00Z') };
  const page = await setup(t, data);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByLabel('Money earned').fill('42.50');
  await page.getByLabel('Quick note').fill('Client approved');
  await breakWrites(page);
  await page.getByRole('button', { name: 'Save details' }).click();
  assert.equal((await saved(page)).sessions.at(-1).earnings, 0);
  assert.equal(await page.getByLabel('Quick note').inputValue(), 'Client approved');
  await restoreWrites(page);
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.reload();
  assert.equal((await saved(page)).sessions.at(-1).earnings, 42.5);
  assert.equal((await saved(page)).sessions.at(-1).note, 'Client approved');
  assert.equal((await saved(page)).sessions.length, 2);
});

test('dialog focus stays inside, Escape restores focus and narrow screens fit', async t => {
  const page = await setup(t, fixture(), { viewport: { width: 320, height: 640 } });
  await edit(page);
  await page.getByRole('button', { name: 'Save changes' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Close dialog' }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Save changes' }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.sheet').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'No horizontal scrolling inside the dialog');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Edit session for/ }).evaluate(el => el === document.activeElement), true);
});

test('CSV neutralizes formula-like user text and preserves quoted fields', async t => {
  const data = fixture();
  data.projects[0].name = '=HYPERLINK("https://example.com")';
  data.sessions[0].note = '+SUM(1,2)';
  const page = await setup(t, data);
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await fs.readFile(await download.path(), 'utf8');
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"\'+SUM(1,2)"'));
});

test('offline reload works and service worker leaves unrelated caches intact', async t => {
  const page = await setup(t, fixture(), { serviceWorkers: 'allow' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await caches.open('another-app-cache');
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes('another-app-cache')));
  // Also stop server responses: Chromium can leave service worker network
  // requests online when only the page context is put in offline mode.
  serverOffline = true;
  t.after(() => { serverOffline = false; });
  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Continue Brand shoot' }).click();
  assert.ok((await saved(page)).active);
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.equal(await page.evaluate(async () => {
    try { await fetch('./missing-script.js'); return 'unexpected response'; }
    catch { return 'network failure'; }
  }), 'network failure');
});
