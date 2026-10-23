# CLOCKIT

CLOCKIT is a deliberately simple time operating system for entrepreneurs, creators, freelancers, performers, and people juggling several kinds of work.

The product rule is simple: **start fast, stop fast, reflect later.**

## Current MVP

- One-tap start and stop timer
- Quick resume for your last project
- Project time budgets and remaining time
- Timer persistence through refreshes and app closes
- Optional earnings and notes after a work session
- Session history
- Edit a past session's project, start/end times, earnings, and notes
- Weekly time, earnings, and effective hourly value
- Per-project effective hourly value
- CSV export for bookkeeping and tax organization
- Offline-capable progressive web app
- Local-first storage, so no account is required for the prototype
- Save-failure warnings that preserve the previous saved state

## Current development workspace

Continue the existing MVP in this repository. CLOCKIT remains a static, mobile-first app with no runtime dependencies or build step. Development conventions are in [AGENTS.md](AGENTS.md).

The current iteration makes the MVP easier to validate in daily use:

- **History → Edit session** corrects a forgotten stop or adds details later. Project budgets, earnings, and exports use the corrected session immediately.
- Adding a project while a timer is running creates the project without interrupting the timer. Stop the current session before starting another.
- A failed save leaves the previous state intact. If stopping fails, the timer continues and can be stopped again once storage is available. Unreadable saved data is never silently replaced.
- Dialogs support keyboard focus, Escape, and explicit close buttons. Offline caching is limited to this app's scope.

## Use it locally

No build tools are required.

1. Clone the repository.
2. Serve the folder with any static web server.
3. Open it on desktop or mobile.

Example with Python:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Development checks

Node.js 20+ is used only for tests. The app itself still runs without Node or npm.

```bash
npm ci
npx playwright install chromium
npm run check
npm test
```

The browser suite starts its own local server and uses isolated browser data. It checks timer persistence, session corrections and totals, save failures, keyboard navigation, mobile width, CSV output, and offline loading. On Linux CI, use `npx playwright install --with-deps chromium` if browser system libraries are missing.

## Publish with GitHub Pages

This project is static and can be hosted directly from the `main` branch. In the repository settings, enable GitHub Pages and choose the root of `main` as the source.

Once hosted over HTTPS, supported mobile browsers can install CLOCKIT to the home screen as a standalone PWA.

## MVP product philosophy

CLOCKIT should never punish the user for tracking their time. Starting a timer should take one or two taps. Stopping should save immediately. Details like earnings and notes are optional and appear only after the work is already recorded.

The app should answer three questions without turning into project-management software:

1. What am I working on right now?
2. How much of my time budget is left?
3. What is this work actually worth per hour?

## Next validation targets

Before adding accounts, teams, invoicing, AI, accounting integrations, or calendar features, test the MVP with real entrepreneurs and creators.

Important questions:

- Do people actually remember to clock in?
- Is one-tap quick resume enough for people on the move?
- Are time budgets useful enough to change decisions?
- Do users log earnings after sessions?
- Does effective hourly value change how they price work?
- What information do users actually want at tax time?

## Data

The current prototype stores data in browser `localStorage`. Clearing site data will clear CLOCKIT data. CSV export provides a readable record for testing and bookkeeping; it is not a restorable app backup. Use one browser tab and one device during MVP validation: cross-tab coordination and cloud sync are not implemented.

A future production version should add authenticated cloud sync, encrypted storage, reliable backups, and a proper data export/import flow. Mobile home-screen installation still needs testing on actual devices, especially iOS.
