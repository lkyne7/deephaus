# Temporary QA regression adaptations

Run from the repository root after configuring the existing isolated staging launch environment and fixtures. These files use environment-based fixture credentials; do not put credentials in source control. They are references for updating official `e2e/web` tests, not a replacement CI suite.

Network-only server (separate terminal):

```sh
LAUNCH_NETWORK_ONLY=1 node scripts/launch/run.mjs web
```

Recovery/account journeys:

```sh
LAUNCH_NETWORK_ONLY=1 node scripts/launch/run.mjs test --config docs/qa/2026-11-10/regression/playwright.config.ts
```

Production offline/media server (build first, separate terminal):

```sh
pnpm launch:build
pnpm launch:start
```

Then:

```sh
E2E_PRODUCTION_SERVICE_WORKER=1 node scripts/launch/run.mjs test --config docs/qa/2026-11-10/regression/playwright-media.config.ts
```

The two production journeys were executed separately during QA and passed separately. The copies change UI navigation/selectors to match full-page Settings and the current card list, preserving the existing behavioral assertions. `closeSettings` uses browser history to return through two client navigations; official tests should use a deliberate navigation helper suited to the current UI.

Desktop route recovery reproducer:

```sh
pnpm --filter @deephaus/desktop build
node docs/qa/2026-11-10/regression/desktop-adversarial.mjs
```

It launches a test-owned Electron profile and temporary local origin, reproduces the stale Retry route, and cleans up both. It currently records the failing comparison in `evidence/desktop-adversarial.json` rather than exiting nonzero; convert that comparison into a proper assertion in the official desktop regression suite.
