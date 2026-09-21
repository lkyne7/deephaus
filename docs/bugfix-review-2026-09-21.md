# Web and mobile bug review — September 21, 2026

Release branch: `codex/web-mobile-bugfixes`, based on the deployed `849b344` release.

## Fixes

- Web and mobile card autosave now saves a return to the original value after an intervening edit, including when an older request is still running. Revision checks prevent older requests from deleting a newer draft or overwriting save status.
- Reconnecting the web app no longer reloads an active form or study session. The offline fallback still retries on reconnect and offers a manual retry button.
- Offline image storage initialization is serialized and retryable. A failed manifest read can no longer replace stored download progress with an empty manifest.
- Mobile image downloads stay paused in the background, including after periodic refreshes and network changes.
- Mobile signup supplies the app callback URL, distinguishes email confirmation from immediate login, and validates display-name length.
- Mobile auth actions recover their busy state after thrown errors. Failed sign-out retains the durable offline identity; a stale startup failure cannot erase a newer auth session.

## Verification

- 282 web unit tests passed.
- 45 launch Node tests and 70 launch Vitest tests passed, including native autosave, signup, sign-out, and background download regressions.
- Web production build, mobile TypeScript, and browser-test TypeScript passed. Web lint has zero errors and seven existing warnings.
- Eight local production-browser scenarios passed across the targeted runs: authorization, account isolation, reconciliation, cold offline study/restart/exactly-once upload, image storage recovery, downloaded image access, service-worker fallback, and reconnect preserving an active form.
- Four network-only browser scenarios passed: account switching, process-crash draft recovery, failed-save recovery, and ordered slow saves.
- The staging iOS development app loaded the updated JavaScript bundle in the simulator. This is startup evidence, not native end-to-end or purchase certification.

## Mobile production gate

The mobile source fixes are ready for the native release process. EAS has no production environment variables configured. The existing local mobile environment points its API to localhost and has no iOS or Android billing key. Production signing/archive, native hardware acceptance, and App Store purchase/restore and review gates remain open. No App Store binary is submitted by this release.

No database migration, worker code change, or production feature-flag expansion is required. Production managed offline media remains disabled.
