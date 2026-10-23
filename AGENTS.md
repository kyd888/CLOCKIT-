# CLOCKIT project workspace

This repository is the primary project workspace for CLOCKIT. Continue the existing MVP; do not replace it with a new framework or a separate prototype.

## Product constraints

- Start fast, stop fast, reflect later.
- Keep timer start/stop to one or two taps. Notes and earnings remain optional after saving time.
- Preserve the simple mobile layout, dark palette, large touch targets, and Now / History / Insights navigation.
- Validate real daily use before adding accounts, teams, invoicing, AI, or calendar integrations. See issue #1 and README.md.
- Keep existing `clockit-state-v1` data compatible. Never discard user data to handle an error.
- Do not claim cloud sync or restorable backups exist. Use one tab/device during validation.

## Implementation and verification

- Runtime: plain HTML, CSS, and JavaScript; static hosting; no build step.
- `app.js`: state, timer, rendering, session editing, CSV export.
- `sw.js`: offline app cache; changes must stay within this app's scope.
- Run `npm run check` and `npm test` for behavioral changes. Install test dependencies with `npm ci` and Chromium with `npx playwright install chromium`.
- Test existing timer flows and saved-data compatibility when changing state. Test offline behavior when changing the service worker.
- Inspect mobile layouts when editing UI. Do not commit browser downloads, node_modules, or screenshots from test runs.
- Keep work on a reviewable branch and describe what was tested in the pull request. Do not merge or publish unless requested.
