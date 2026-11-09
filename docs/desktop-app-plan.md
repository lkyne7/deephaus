# Desktop app plan (macOS, Windows, Linux)

Status: first implementation landed 2026-11-02 in `apps/desktop`. See
"Implementation status" at the end for what exists and what is still manual.

## Summary

Ship the desktop app as an Electron shell around the hosted web app
(`www.deephaus.ai`, staging `deephaus-staging.vercel.app`). The web app is
already offline-first: it runs a service worker (Serwist), keeps a local
SQLite replica through PowerSync (`@powersync/web`, wa-sqlite in OPFS), routes
reads and writes locally when offline (`apps/web/src/lib/offline/local-api.ts`),
and caches card media in Cache Storage. The shell adds persistence, native
auth hand-off, deep links, notifications, menus, auto-update, and installers.
No second UI codebase and no new sync layer.

Platforms: macOS, Windows and Linux (decided 2026-11-02). The Expo app
covers iPhone and iPad; the "iPad app on Apple silicon" toggle is not used.

## Why Electron, and why load the hosted site

Options considered:

| Option | Verdict | Reason |
| --- | --- | --- |
| Electron loading the hosted Next.js app | **Chosen** | Same Chromium the Playwright staging journeys already test. Service worker, OPFS, SharedWorker, Cache Storage all behave as in Chrome. UI updates ship with every web deploy; only the shell needs a desktop release. |
| Electron bundling a local Next.js server | Rejected | API routes hold server secrets (LLM keys, Supabase service role, workers). The server stays on Vercel either way. |
| Tauri 2 | Rejected for now | macOS uses WKWebView. PowerSync web's multi-tab mode, OPFS, and service workers on a remote origin behave differently from Chromium and are untested here. Smaller binary is the only gain. |
| Expo for macOS / Windows (`react-native-macos`, `react-native-windows`) | Rejected | Not supported by Expo SDK 57 tooling; expo-router, op-sqlite, PowerSync RN, widgets are iOS/Android only. Would be a third UI surface. |
| "iPhone and iPad apps on Apple silicon Macs" (App Store Connect toggle) | Optional interim, Mac only | Zero code. Touch-first UI, no Windows. Worth enabling while the Electron app is built. |

The PowerSync setup notes (`powersync/README.md`) already list Electron as a
supported client.

## Architecture

```
apps/desktop  (@deephaus/desktop)
├── src/main/        Electron main process (TypeScript)
│   ├── index.ts     app lifecycle, single instance lock, window creation
│   ├── config.ts    APP_VARIANT → origin, scheme, allowed origins (mirrors apps/mobile/app.config.ts)
│   ├── navigation.ts allowed-origin guard, external links → shell.openExternal
│   ├── auth.ts      deephaus-desktop://auth/callback → load <origin>/auth/callback?code=…
│   ├── offline.ts   first-run-offline page, persistent storage grants
│   ├── menu.ts      native menus and accelerators
│   ├── notify.ts    due-count badge, system notifications
│   └── updater.ts   electron-updater (GitHub Releases)
├── src/preload/     contextBridge → window.deephausDesktop
├── resources/       icons, offline-first-run.html
├── electron-builder.yml
└── package.json
packages/desktop-bridge  (@deephaus/desktop-bridge, types only)
    The window.deephausDesktop contract shared by apps/web and apps/desktop.
```

Security defaults: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, `webSecurity: true`. Navigation is allowed only to the app
origin, the Supabase auth origin, and the PowerSync origin. Everything else
opens in the system browser via `setWindowOpenHandler`.

Persistence: one persistent session partition (`persist:deephaus-<variant>`).
Cookies (Supabase SSR session), OPFS (PowerSync replica), Cache Storage
(media, service-worker precache), and localStorage survive restarts. The
permission handler grants `persistent-storage` and `notifications`.

User agent: append `DeepHausDesktop/<version> (<platform>)`. The web app
reads `window.deephausDesktop` first and the UA second.

Variants: `APP_VARIANT=staging|production`, same rule as mobile. Staging uses
`deephaus-desktop-staging://`, production `deephaus-desktop://`. Keep the
scheme distinct from mobile's `deephaus://` so an iPad app installed on a Mac
cannot capture desktop callbacks.

## Auth

- Email and password: unchanged. Server actions and the SSR cookie session
  work inside the Electron window.
- Google and Apple: Google rejects sign-in from embedded web views. On
  desktop the web auth form calls `window.deephausDesktop.openExternal(url)`
  with `redirectTo = deephaus-desktop://auth/callback?next=…`. The system
  browser completes OAuth at Supabase, which redirects to the custom scheme.
  The main process receives it (`open-url` on macOS, `second-instance` on
  Windows) and loads `<origin>/auth/callback?code=…&next=…` in the window. The
  existing callback route exchanges the code using the PKCE verifier cookie
  that the renderer stored when it started the flow. No new callback code.
- Supabase dashboard: add both custom-scheme callback URLs to the redirect
  allowlist. Google and Apple consoles need no change because Supabase's own
  callback URL is unchanged.
- Pre-existing gate from `docs/environment-release-plan.md`: hosted Google
  sign-in had an invalid client-secret issue. Re-verify before desktop QA.

## Offline studying

Inherited from the web app:

- Service worker precaches the PowerSync runtime and `/~offline`, caches
  visited pages network-first, and serves JS/CSS cache-first.
- PowerSync keeps `cards`, `card_reviews`, `review_logs`, exams, study
  settings, and FSRS params local. Grading offline writes locally and uploads
  later; `shouldUseLocalRead` / `shouldUseLocalWrite` gate routing.
- Media downloads are behind `NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED`.

Desktop-specific work:

1. First-run offline. If the window has never completed a successful load
   (flag stored by the main process), and `net.isOnline()` is false, show
   `offline-first-run.html` instead of a failed navigation. Retry on
   `online`.
2. Cold offline start. `loadURL(<origin>/dashboard)` while offline goes
   through the registered service worker exactly as the PWA does. Listen for
   `did-fail-load` as a fallback and show the bundled page.
3. Route warm-up. After sign-in, prefetch `/dashboard`, `/decks`, `/review`,
   `/cards`, `/exams` so a cold offline open never lands on a route that was
   never visited. This is a small web change that also helps the PWA.
4. Offline media on by default under desktop. Make the media flag a runtime
   decision (`desktop || env flag`) instead of build-time only. Desktop has
   disk; download deck media after first sync.
5. Storage. Grant `persistent-storage`; surface replica size in Profile for
   desktop. Account switching already refuses to clear a replica with pending
   uploads; keep that.
6. Verification. Run the existing `e2e/web` offline journeys against the
   Electron shell with Playwright's `_electron` launcher, toggling
   `session.enableNetworkEmulation({ offline: true })`.

Online-only on all clients, unchanged: AI generation, imports, billing,
integrations, community, job queue.

## Mobile integration

Everything below already works for mobile and is inherited by desktop
because both clients sync through the same PowerSync streams:

- Study on one device, continue on the other. Reviews, exams, study
  settings, and FSRS params replicate. The connector discards a stale-version
  grade on conflict rather than wedging the queue.
- Same account, same Supabase project per variant, same RLS.

Desktop additions that make the two feel like one product:

- Deep links. `deephaus-desktop://decks/<id>/study` mirrors mobile's route
  shape. Web links (`https://www.deephaus.ai/decks/<id>`) opened on a
  machine with the desktop app installed: optional later, needs a signed app
  and associated-domain entitlement on macOS.
- Due-count badge on the macOS dock and Windows taskbar, computed from the
  local replica via the bridge. Mobile shows the same number in its Live
  Activity.
- System notifications when a background generation job finishes, driven by
  the same job rows the mobile background-tasks context watches.
- Keyboard-first study. The web already has `keyboard-shortcuts.ts`; expose
  the same bindings in the native menu so they appear in menus and work when
  the window is unfocused.
- Billing. Web billing is RevenueCat Web (Stripe). Direct-download desktop
  apps may use it as-is. A Mac App Store listing would require StoreKit,
  so do not list on the Mac App Store in v1.

## Web changes (small, all behind desktop detection)

| Area | Change |
| --- | --- |
| `apps/web/src/components/auth-form.tsx` | On desktop, send OAuth through the bridge with the custom-scheme redirect. |
| `apps/web/src/lib/offline/media.ts` | Runtime enable under desktop. |
| App shell | Hide PWA install prompts; add a "Desktop" tag in Profile with version and update state. |
| Offline warm-up | Prefetch core routes after sign-in. |
| Bridge consumer | `useDesktopBridge()` hook typed from `@deephaus/desktop-bridge`; push due count and job completions to the main process. |

## Distribution and release

- Packaging: electron-builder. macOS DMG + zip (universal), Windows NSIS
  x64 and arm64.
- Signing: Apple Developer ID + notarization (the existing Apple developer
  account suffices). Windows needs a code-signing certificate; without it
  SmartScreen warns until reputation builds. Decide between Azure Trusted
  Signing and a conventional OV/EV certificate before the first public build.
- Auto-update: electron-updater against GitHub Releases, checked at launch
  and every six hours, applied on quit. Because the UI is the hosted site,
  shell releases should be rare.
- CI: new `desktop-build.yml` with a macOS and a Windows runner, triggered on
  tags `desktop-v*`, publishing draft releases. Add `@deephaus/desktop`
  typecheck to `launch-checks.yml`.
- Dev loop: `pnpm dev:desktop` loads `http://localhost:3000` from the
  existing `dev:web` wrapper. The service worker is disabled in Next dev, so
  offline testing uses `next build && next start` or hosted staging.
- Variants build like mobile: staging artifacts are never promoted.
- Add `docs/desktop-release-checklist.md` modeled on
  `docs/app-store-release-checklist.md`.

## Phases

1. Shell MVP (2 to 3 days). `apps/desktop`, window, persistent partition,
   origin guard, external links, UA suffix, variants, dev script. Manual
   check: sign in with email, study a deck, go offline, keep studying, go
   online, see reviews on mobile.
2. Auth hand-off (1 to 2 days). Bridge package, OAuth via system browser,
   custom scheme registration, Supabase allowlist, single-instance lock.
3. Offline hardening (2 to 3 days). First-run offline page, storage grants,
   route warm-up, media default, Playwright Electron offline journeys.
4. Desktop integration (2 to 3 days). Menus and accelerators, dock and
   taskbar badge, notifications, deep links, window state restore.
5. Distribution (2 to 4 days, plus certificate lead time). electron-builder,
   signing and notarization, auto-update, CI workflow, release checklist,
   staging build to testers.
6. Cross-device acceptance (1 day). Scripted scenario: grade offline on
   desktop and on iPhone simultaneously, reconnect both, confirm no lost
   reviews and identical due counts.

Phases 1 to 3 give a usable offline desktop study app. Phases 4 to 6 make it
shippable.

## Decisions (2026-11-02)

1. macOS, Windows and Linux in the first build.
2. Windows signing through Microsoft Artifact Signing (formerly Azure
   Trusted Signing); Dekki Inc has operated since 2023.
3. Direct download with auto-update only. No Mac App Store.
4. Full desktop app; the App Store Connect "available on Mac" toggle is not
   part of the plan.

## Risks

- Cold offline open only works for routes the service worker has cached;
  warm-up mitigates but a brand-new install must go online once.
- Google OAuth policy changes; the system-browser flow is the supported path.
- Installer size around 100 MB per platform; acceptable for a study app.
- Any web regression in the service worker or PowerSync startup breaks
  desktop offline as well; the staging journeys workflow is the guard, so
  add the Electron offline job to it.

## Implementation status (2026-11-02)

Done:

- `apps/desktop` (`@deephaus/desktop`): main process (variants, persistent
  partition, origin guard, deep links, OAuth return, menu, badge,
  notifications, updater), sandboxed preload installing
  `window.deephausDesktop`, bundled first-run offline page, electron-builder
  config for dmg/zip (universal), NSIS x64/arm64, AppImage/deb, GitHub
  Releases publishing with a `staging` pre-release channel.
- `@deephaus/shared` exports the bridge contract (`desktop-bridge.ts`).
- Web: auth form hands OAuth to the system browser on desktop; offline media
  downloads default on under desktop; `DesktopIntegration` in the app layout
  handles menu/deep-link navigation, the due-count badge and route warm-up
  (`lib/desktop/route-warmup.ts`); `/download` marketing page with links in
  the landing and pricing navigation; `pages` cache raised to 64 entries.
- CI: `desktop-release.yml` (tag `desktop-v*` or manual, three runners);
  launch checks typecheck and smoke-test the shell under xvfb.
- Verified locally: Playwright Electron smoke tests; sign-in, PowerSync
  replica and offline deck browsing inside the shell against hosted staging;
  badge and bridge navigation against a local dev server.

Manual steps before the first public build:

- Supabase redirect allowlist entries for both custom schemes.
- Apple Developer ID certificate and notarization secrets.
- Artifact Signing account, certificate profile and service principal.
- First staging run of the release workflow, then the checklist in
  `docs/desktop-release-checklist.md`.
