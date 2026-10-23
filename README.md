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
- Weekly time, earnings, and effective hourly value
- Per-project effective hourly value
- CSV export for bookkeeping and tax organization
- Offline-capable progressive web app
- Local-first storage, so no account is required for the prototype

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

The current prototype stores data in browser `localStorage`. Clearing site data will clear CLOCKIT data, so use the CSV export for backups during testing.

A future production version should add authenticated cloud sync, encrypted storage, reliable backups, editable sessions, and a proper data export/import flow.
