# @deephaus/desktop

Electron shell for macOS, Windows and Linux. It loads the hosted web app
(`www.deephaus.ai`, or `deephaus-staging.vercel.app` for staging builds) in a
persistent session, so offline study comes from the web app's service worker
and PowerSync replica. See `docs/desktop-app-plan.md` for the design.

## Layout

- `src/main` — Electron main process: config/variants, window and session,
  deep links and OAuth return, menu, auto-update.
- `src/preload` — installs `window.deephausDesktop` (contract in
  `@deephaus/shared`, `desktop-bridge.ts`) on app pages.
- `resources/offline.html` — shown when a fresh install starts offline.
- `electron-builder.config.js` — packaging, signing, publishing.

## Develop

```sh
pnpm --filter @deephaus/shared build
pnpm dev:web                               # in another terminal
pnpm --filter @deephaus/desktop dev        # loads http://localhost:3000
DEEPHAUS_DESKTOP_ORIGIN=https://deephaus-staging.vercel.app pnpm --filter @deephaus/desktop dev
```

Next dev disables the service worker, so test offline behaviour against a
production web build or hosted staging.

## Package locally

```sh
pnpm --filter @deephaus/desktop pack            # unpacked app in release/
pnpm --filter @deephaus/desktop dist            # installers for this OS
APP_VARIANT=staging pnpm --filter @deephaus/desktop dist
```

## Release

Tag `desktop-v<version>` (matching `package.json`) and push, or run the
"Desktop release" workflow manually. See `docs/desktop-release-checklist.md`.

## Sign-in on desktop

Google and Apple sign-in open the system browser. Supabase redirects to
`deephaus-desktop://auth/callback` (staging: `deephaus-desktop-staging://`),
which must be on the Supabase redirect allowlist. The shell then loads
`/auth/callback?code=…` so the existing route exchanges the PKCE code.
