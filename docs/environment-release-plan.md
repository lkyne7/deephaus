# Environment setup and release plan

## Target

- Development: local web/API on 3000 and a staging-identity Expo app, using the existing isolated staging Supabase and PowerSync services. Test accounts only. This deliberately shares staging data; freeze development writes while validating a release.
- Staging: hosted `deephaus-staging.vercel.app`, isolated Supabase `cktvxmclcxtymkozciaw`, Launch Staging PowerSync, sandbox billing, and staging workers.
- Production: `www.deephaus.ai`, Supabase `rdfijwmxlyvykcnxfurd`, production PowerSync and Render workers, real billing.

## Development commands

`pnpm dev:web`, `pnpm dev:mobile`, `pnpm mobile:ios`, `pnpm dev:anki`, and `pnpm dev:extraction` load the ignored `.env.launch-staging.local`. Web/API runs on 3000. The existing `launch:*` acceptance runners retain ports 3100/3101 and separate build directories.

The development wrapper drops inherited application credentials, suppresses legacy dotenv fallback, enforces the staging project, and supplies only public values to Expo. AI generation uses mock mode unless a key is explicitly configured in the staging file. Production secrets in old ignored environment files are not used by these commands. Direct `next dev` or `expo start` bypasses these wrappers; use the package scripts.

The staging iOS native scheme is required for native builds. Existing production-app sessions are not migrated into staging. Use staging test accounts.

For another checkout, use `config/development.env.example` as the template for the ignored staging file; never overwrite an existing configured file. Run `pnpm install` and `pnpm --filter './packages/**' -r build` before starting development. Rebuild shared packages after changes to their compiled exports.

## Release sequence

1. Capture existing work on `codex/release-environment-setup` and audit files before publishing.
2. Run launch regression tests, web/mobile/worker checks, and a staging production build.
3. Deploy the exact release commit to hosted staging. Validate auth, authenticated study/sync, jobs, and billing paths relevant to the release. Check worker credentials and continuous polling.
4. Refresh the live database ledger. Prepare only the four reviewed launch migrations. Do not blindly push the historical migration directory, merge the Supabase branch, or rewrite the production ledger.
5. Release compatible database, API, and workers in order, recording commit and deployment IDs. Existing installed mobile apps must remain compatible. A TestFlight/App Store release is separate.
6. Configure repeatable release automation only after the initial validated rollout.

The staging build contains staging public configuration: never promote that artifact to the production project. Build the same reviewed commit with production configuration.

## Gates recorded before production rollout

- Live read-only inspection on September 16 confirmed production still lacks the four launch migrations. Staging has them. Historical ledger drift remains.
- Supabase staging database is healthy, but branch orchestration still reports `MIGRATIONS_FAILED` from historical replay; it is not a clean branch promotion path.
- Hosted Google sign-in has a documented invalid client-secret issue. Recheck before declaring auth validated.
- Verify separately hosted staging workers and production worker rollout.
- TestFlight signing and fresh Apple sandbox lifecycle validation are separate mobile release gates.
- Both live Render workers now have Auto-Deploy set to Off, verified after saving. The repository Blueprint preserves that setting. Vercel Git deployments are disabled in the new root and web configurations; the release branch is not yet published. Existing Vercel preview settings still share production values, so do not create production-project previews.

The production rollout and verification are recorded below. Mobile/App Store certification remains separate.

## September 16 implementation status

- Current work was captured in commit `09f10e5`; development isolation and the offline navigation fix are in `e890ba0`. The refreshed migration audit and staging Blueprint are in `70e2f42`.
- The normal web development server was started on 3000. Its staging credential passed a read-only API check; unauthenticated local and hosted APIs return 401. Expo config resolves DeepHaus Staging, its separate bundle identifier, staging Supabase, and the local API, without server secrets.
- 101 launch tests, 234 web tests, 6 extraction-worker tests, and 37 local-database tests passed. Web, mobile, both workers, and browser tests passed TypeScript checks. Web lint has 0 errors and 7 existing warnings.
- Hosted staging was rebuilt and deployed from the reviewed source snapshot. A failed cold offline navigation exposed a split between the `pages` and `others` caches; document navigation now reads the same HTML cache used by prefetching.
- `render.staging.yaml` prepares two separately named workers with staging Supabase/API targets, manual deploys, and independently supplied secrets. It has not provisioned services. Matching the current 2 GB plans and 20 GB disks would cost approximately US$60/month before usage/taxes; approval is pending.
- GitHub rejected the branch push because the CLI OAuth login lacks `workflow` scope. Run `gh auth refresh -h github.com -s workflow`, then retry `git push -u origin codex/release-environment-setup`. No workflow files were stripped to bypass the permission requirement.
- The four launch migration files still exactly match staging and are absent from production. The reviewed bundle was regenerated in ignored `test-results/release`; no production SQL was applied.

The generic `pnpm supabase:push` shortcut now fails closed because replaying the historical directory could alter production data. Explicit production linking/auth commands remain administrative tools; development needs neither.

Validation continued on September 16:

- All four network-only browser journeys passed against the isolated local staging API: account switching, browser-process crash recovery, reopening unsaved drafts, and ordered slow saves.
- Live staging SQL acceptance passed and rolled back its fixtures. A separate extraction-worker process removed 10 test storage objects, recovered an expired deletion lease, rejected late uploads, deleted the disposable auth account, and rejected its old credentials. An earlier attempt hit a transient DNS failure; its unused disposable account was cleaned up.
- Staging security advisors reported informational server-only tables with RLS and no client policies, three intentionally callable review RPCs for further release review, and disabled leaked-password protection. See [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Hosted offline testing exposed a second issue beyond page caching: the explicit fallback precache list replaced automatic public-file scanning. Versioned PowerSync runtime assets are now explicitly listed for precaching. Hosted validation of the final fix is recorded below once complete.

Final hosted verification:

- Deployment `dpl_GFLp7YJqGeRsTLBFvFpWJeWmRAAk` is READY at https://deephaus-staging.vercel.app, with release source commit `5a54826` recorded in metadata. It is the production target of the separate **staging Vercel project**, not the real production project.
- The deployed manifest explicitly contains 16 versioned PowerSync JS/WASM assets. Cold offline study now preserves a review across reload and app reopening, then uploads it exactly once on reconnection.
- All six selected hosted journeys passed: authorization, authenticated browsing/isolation, cold offline restart, media downloads, reconciliation, and service-worker fallback/API exclusion. Four network-only journeys passed separately. Payment journeys were intentionally skipped because they require their dedicated sandbox runner and fixtures; this is not payment or App Store certification.
- No new production code, production migration, or paid staging service was deployed. Only the existing production workers' auto-deploy setting was changed to manual. GitHub publishing and staging-worker provisioning remain pending the user handoffs above.
- The temporary network-only server was stopped after testing. Normal development remains available on http://localhost:3000 with staging services. The pre-existing staging server on 3100 was preserved.

## Production rollout — September 16, 2026

The user explicitly authorized production deployment after GitHub publishing succeeded. Release source: `0e1d4dae7caa665b4be6066ef07119b3e03dd1f0` on `codex/release-environment-setup`. No merge to main was needed: both workers were manually deployed by exact SHA, and Vercel received an isolated source snapshot with production project configuration.

- Web/API: `dpl_BUXeeoCZSh95pXQC7zhyfkvnRwcr`, READY and promoted to https://www.deephaus.ai. Built with production variables, `NEXT_PUBLIC_RELEASE_ID=0e1d4da`, and `NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED=false`. Build completed successfully with the existing lint warnings.
- Extraction worker: `dep-dali0ov40ujc73e40go0`, live on `srv-d9eomddaeets73bkpk0g` at the release SHA.
- Anki worker: `dep-dali17qjnfac739l83s0`, live on `srv-d8i35pnlk1mc73fnuqig` at the release SHA; startup logs confirm the production Supabase endpoint and 5-second polling.
- Four reviewed migrations applied individually with matching staging checksums. Production versions: `20260916230307`, `20260916230313`, `20260916230318`, `20260916230323`, respectively. The historical migration directory was not replayed. The refreshed ledger is in `migration-history-snapshot.json`.
- Database acceptance passed with random, transaction-scoped fixtures and full rollback: ownership, storage permissions, reconciliation, duplicate reviews, undo, dashboard metrics, and deletion fences. Counts before/after remained 215 sources (including the standalone source), 1,434 review logs, and 8 users.
- Live homepage/login return 200; login renders in the browser. Unauthenticated deck and internal cleanup requests return 401. Browser bundles contain the production Supabase reference and release ID, without the staging reference. All 16 versioned offline JS/WASM assets return 200 with immutable caching.
- After promotion, repeated authenticated extraction-worker cleanup calls return 200 in Vercel logs, confirming matching worker credentials and continuous polling. The expected 404s during the brief worker-before-API transition stopped after promotion. No application error/fatal logs were found in the initial deployment scan.

The reconciliation database flag remains false and managed offline media remains disabled. No new paid staging workers were created. This rollout does not publish an iOS binary or certify App Store purchases, restores, or native offline behavior. The earlier staging Google-auth issue and separate staging-worker provisioning remain follow-up work.

Security advisors report the same reviewed categories as staging: server-only RLS tables without client policies, three intentionally authenticated ownership-checking review RPCs ([advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)), and [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No unrelated auth settings were changed.

Rollback reference: previous web deployment `dpl_GP5aRfz6tN75JP9sj5GAx7Z6sgy4`; previous worker source `90ef5bff0df6f8f91b338b90d2544abd7f053008`. Keep additive database migrations and review data intact during any application rollback; do not drop tables or clear queues. Keep an updated extraction worker running for durable cleanup if rolling back the frontend alone.

## Production rollout — October 16, 2026

Release source: `d425af4` on `card-audio` (stacked on `anki-export-jobs` and `anki-review-history`, PRs #28–#30). Contents: Easy Days, Anki review-history import and schedule export, asynchronous export jobs, and audio clips with text-to-speech.

- Hosted staging caught two defects before release, both fixed: the speech route exported a helper (rejected by the Next production build), and audio uploads above Vercel's 4.5 MB request body cap failed with a platform error. Clips are now capped at 4 MiB with a client-side check, and recordings stop at 3 minutes.
- Hosted staging (`582ae56`, web-identical to `d425af4`): audio API smoke 7/7 (upload, rejection, mock TTS, export job with `[sound:]`, re-import) and 8 browser journeys passed. Three PowerSync/network-only journeys skip without their fixtures; the media-storage journey uses a launch-only page.
- Database: migrations `user_easy_days`, `anki_export_jobs` and `card_audio` applied individually to `rdfijwmxlyvykcnxfurd`; verified the column default, export table RLS, service-role-only claim RPC, and both bucket configurations.
- Anki worker: `d425af4` deployed manually on `srv-d8i35pnlk1mc73fnuqig`; startup logs show the production Supabase endpoint and 5-second polling. The extraction worker source is unchanged and was not redeployed.
- Web/API: `dpl_DvBab8nxACiSR2mj34uW9JEhmLod`, release ID `d425af4`, offline media disabled, promoted to https://www.deephaus.ai. Public pages and the service worker return 200; unauthenticated deck, export, speech and media APIs return 401; served JavaScript contains the production Supabase reference and the release ID, without the staging reference.
- PowerSync: dashboard follow-up completed October 16 at 15:29 EDT. The production-connected **Development** instance (`6a79589ef16f90678440ee99`, database `rdfijwmxlyvykcnxfurd`) now runs Sync Streams version 5 (`8799`), matching `powersync/sync-streams.yaml` exactly. Validation passed, deployment completed, status is Active, and Health reports “All clear! No issues to address.” The three alias/wildcard warnings are resolved; per-user ownership predicates remain unchanged. Previous configuration: version 2 (`45cf`).
- Storage: the production dashboard already had the global upload limit saved at 11 GB when checked during the follow-up. Verified the private `apkg-exports` bucket allows 11 GiB and `apkg-imports` allows 10 GiB; no storage setting change was needed.
- No production iOS binary exists; staging TestFlight builds carry the mobile changes.

Follow-up verification: `www.deephaus.ai` still points to `dpl_DvBab8nxACiSR2mj34uW9JEhmLod` (READY). Homepage, login, and service worker return 200; unauthenticated deck, export enqueue, speech, and media requests return 401. Served scripts contain release ID `d425af4` and the production database reference, without the staging reference. Vercel's runtime-error scan for the preceding hour found no errors. This follow-up did not repeat authenticated feature journeys or the 10 GiB export trial; those staging results are recorded above and in `anki-upload-acceptance.md`.

Rollback reference: previous web deployment `dpl_5BWY5LpUaiQuq8G23FZ6jKuykBXD` (source `0822b7a`); previous worker source `0e1d4da`. Migrations are additive; keep them during any application rollback.

## Production hotfix — October 25, 2026: occlusion auto-detect SSRF

Release source: `e5ce38e` on `main` (PR #31 merged onto the October 16 release `3df61e3`; no other code changes). `POST /api/cards/[id]/occlusion/auto-detect` fetched any `occlusion_data.imageUrl` sent by the client. It now fetches only `card-media` URLs on the project's own Supabase origin (checked after URL normalisation), does not follow redirects, times out after 15 seconds, and no longer echoes the upstream status. The route is Plus-gated, so exposure was limited to Plus accounts.

- Hosted staging (`e5ce38e`): with a throwaway sandbox-Plus account, the route rejected the cloud metadata address, localhost, a look-alike host with a card-media path, a dot-segment path leaving the bucket, and another bucket (all 400), and accepted a freshly uploaded card image (200). The account, its media and billing row were deleted afterwards.
- Production: `dpl_8TqN5WQyrraxGRJZAepZkcynN133`, release ID `e5ce38e`, offline media disabled, promoted to https://www.deephaus.ai. Public pages and the service worker return 200; unauthenticated deck, auto-detect, export and speech APIs return 401; served scripts carry `e5ce38e` and the production database reference only. No runtime errors in the retained log window.
- No migrations, worker deploys or PowerSync changes.

Rollback reference: `dpl_DvBab8nxACiSR2mj34uW9JEhmLod` (source `d425af4`).

## Production release — October 25, 2026: study queue, documents, community decks

Release source: `2210484` on `main` (PRs #32–#36 on top of the SSRF hotfix `e5ce38e`).

- **#32 + #36 — per-ordinal new cards.** Studying c1 of a cloze note (or C1 of an image occlusion) no longer removes the card from the new queue, new image-occlusion cards return `occlusion_data`, and multi-ordinal cards are no longer duplicated. Migration `per_ordinal_new_study_cards` replaces `count_new_study_cards` and `fetch_new_study_cards`; the offline SQLite queries mirror it. Staging validation of #32's first version found it called per-card helper functions that cannot be inlined: 10.9 s on a 20,000-card deck, past the 8 s statement timeout. #36 inlined the predicate (≈0.1 s on the same deck, same rows; offline 27 ms) before anything reached production.
- **#33 — auto-occlude ordinals.** OCR-detected regions get C1–C9 instead of all becoming C1 (regions beyond nine are dropped, matching document generation).
- **#34 — source documents.** Saves are compare-and-set on `content_edited_at`: a stale tab gets 409 and must reload; a save without a version gets 428. Offline saves compare instants after normalising PowerSync's timestamp form (Safari-safe).
- **#35 — community decks.** Publishing, subscribing and follow-syncs keep `occlusion_data`.
- Hosted staging (`2210484`): two throwaway accounts confirmed the review queue returns c2, C2 and the basic card after c1/C1 were studied (new = 3); document saves 200 / stale 409 / missing version 428 / next save kept; a published image-occlusion card reached a follower with all 3 rects. SSRF regression 7/7. Browser journeys 6 passed, 3 skipped (fixture-dependent). Accounts deleted.
- Database: migration applied to `rdfijwmxlyvykcnxfurd` after launch-staging; the largest production deck (1,000 cards) counts in ≈0.13 s and fetches 50 in ≈0.02 s. No failed requests or Postgres errors afterwards.
- Web/API: `dpl_8c31NxKLkJqaShheJjcq9Yu9xppY`, release ID `2210484`, promoted to https://www.deephaus.ai. Pages and service worker 200; review, document, publish and auto-detect APIs 401 unauthenticated; scripts carry `2210484` and the production database reference only; no runtime errors in the retained window.
- No worker or PowerSync changes. The offline study-queue fix reaches iOS with the next staging TestFlight build.

Rollback reference: web `dpl_8TqN5WQyrraxGRJZAepZkcynN133` (source `e5ce38e`). The migration is backward compatible with that build (callers read RPC columns by name); keep it during an application rollback.

## Production release — November 2, 2026: Cram Plan fixes

Release source: `80ff4d6` (PR #39, merged into `main` as `ce08b96`; `main` had not moved since the base `b852511`, so the merge carries no other code).

- **Plans past their deadline.** Active and paused plans stayed active forever (10 of the 11 active plans in production were past their deadline) and could still be studied and graded. They are now closed as *completed* on read; the queue and review endpoints return 409 ("This Cram Plan's deadline has passed"); unarchiving past the deadline restores as completed; the offline replica presents and enforces the same status. Existing overdue plans self-correct on each user's next load.
- **Suspended cards.** Never excluded at plan creation or in the queue (45 items in live plans). Now skipped when building a plan, in every queue, count and forecast online and offline, and in the picker's counts.
- **Same-day re-queuing.** A not-yet-due card below the retention target was re-queued right after being reviewed. The eligibility rule now lives in `@deephaus/scheduling` (`isCramItemEligible`): due and unseen items always qualify; an at-risk item is pulled forward at most once per study day.
- Validation on the clean release checkout: web 322/322, launch suite (3 new offline cram tests), local-db 37/37; web and mobile TypeScript clean; eslint clean.
- Hosted staging (`dpl_7JmDYdTQ1mShCFUX3ErswqDLBrGV`, release ID `80ff4d6`): authenticated smoke with the textbook test account passed 15/15 — picker count excludes the suspended card, active queue excludes it (379 items), a plan with a 75-second deadline auto-completed and both endpoints returned 409 afterwards.
- Web/API: `dpl_GKZpve8AYi1JPTvs9kJhwhu2dk5A`, release ID `80ff4d6`, offline media disabled, promoted to https://www.deephaus.ai. Homepage, login and service worker 200; cram list, options and queue APIs 401 unauthenticated; served scripts carry `80ff4d6` and the production database reference only; no errors in the runtime-log window scanned after promotion.
- No migrations, worker or PowerSync changes. iOS picks up the shared package changes with its next build.

Deploy mechanics (recorded for repeatability): `node scripts/launch/prepare-hosted-staging.mjs` from the release checkout, then in the snapshot directory `vercel link --yes --project <deephaus-staging|deephaus-web>` and `vercel deploy --prod --yes --meta releaseSource=<sha> --build-env NEXT_PUBLIC_RELEASE_ID=<sha>` (production adds `--build-env NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED=false`; the other variables are project environment variables).

Rollback reference: web `dpl_8c31NxKLkJqaShheJjcq9Yu9xppY` (source `2210484`).

## Production release — November 3, 2026: desktop app support

Release source: `9104c23` (PR #40, merged into `main`; the only other change since `80ff4d6` is the release record `2e24109`).

- **Desktop sign-in.** Inside the desktop app, Google and Apple sign-in now open the system browser and return on `deephaus-desktop://auth/callback` (staging: `deephaus-desktop-staging://…`), and the shell finishes the PKCE exchange on `/auth/callback`. Browsers and the mobile app are unchanged.
- **Desktop-only web behaviour.** Behind the `window.deephausDesktop` bridge: offline media downloads are on even though production builds keep `NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED=false`, menu shortcuts navigate client-side, the dock badge mirrors cards due now, and core routes plus deck study pages are warmed once per session for cold offline launches. The service worker's pages cache grows from 32 to 64 entries for every client.
- **`/download` page.** Links to version-free assets on the latest GitHub release. They return 404 until the first `desktop-v*` tag is published.
- **Supabase redirect allowlists.** The redirect carries `?next=…`, and an exact allowlist entry does not match a URL with a query string, so Supabase silently fell back to the Site URL and sign-in finished in the browser instead of the app. Fixed with wildcard entries: `deephaus-desktop://auth/callback**` on `rdfijwmxlyvykcnxfurd`, and `deephaus-desktop-staging://auth/callback**` on the staging project `cktvxmclcxtymkozciaw`. A magic link generated with the desktop redirect now returns to the app scheme on staging.
- Hosted staging: `dpl_6NuvekqnrGUELHDvVa6t9tXcGt1u`, release ID `9104c23`. The installed DeepHaus Staging app (CI run 41569593554, notarized) loads the new sign-in code; a simulated deep link reaches `/auth/callback` inside the app.
- Web/API: `dpl_Cx7AyUEUq83FWiJtFN2gLgjMquEv`, release ID `9104c23`, offline media disabled, promoted to https://www.deephaus.ai. Homepage, login, pricing and download return 200, dashboard redirects unauthenticated, and the served login chunk contains the desktop hand-off.
- No migrations, worker or PowerSync changes.

Rollback reference: web `dpl_GKZpve8AYi1JPTvs9kJhwhu2dk5A` (source `80ff4d6`).

## Production release — November 3, 2026: smooth card reviews

Release source: `8859465` (PR #41, merged into `main`; the only other change since `9104c23` is the release record `077b156`).

- **Card swap.** The reviewer (regular and cram) no longer waits for the graded card to finish fading out before the next one appears: the old card leaves in about 90 ms while the next slides in, and the show-answer/grade buttons swap the same way. Reduced motion swaps instantly. Measured in the desktop shell on staging: the card area is dimmed for one frame (~15–20 ms, previously ~240 ms per review) and the next card settles in ~140 ms (previously ~355 ms).
- **Card images.** Object URLs for cached media are shared across mounts, so a card renders its offline copy from the first frame instead of the network URL followed by a swap (desktop app). Images of the current card and the next three, including image-occlusion images, are decoded ahead from the cache when available, and these loads are no longer cancelled on every card change. Study images load eagerly.
- **Queue refill.** The regular reviewer fetches the next page three cards before the end, excluding remaining and in-flight cards, so a 50-card page boundary no longer shows the loading skeleton. If the prefetch comes back empty it falls back to the previous end-of-page refill.
- Hosted staging: `dpl_Do7wEZx4DDfSNPsNNmoo8VFg81WG`, release ID `8859465`. Served scripts carry the release ID and the staging database reference only. Before merge, a 10-card session on the staging test account completed in the desktop shell with no errors or repeated cards.
- Web/API: `dpl_1jYzupYVB54Z48DhhZFsgZN3RibH`, release ID `8859465`, offline media disabled, promoted to https://www.deephaus.ai. Homepage, login, pricing, download and service worker return 200, dashboard redirects unauthenticated, served scripts carry `8859465` and the production database reference only, and no error logs in the 15 minutes after promotion.
- No migrations, worker or PowerSync changes.

Rollback reference: web `dpl_Cx7AyUEUq83FWiJtFN2gLgjMquEv` (source `9104c23`).

## Production release — November 3, 2026: review undo/history fixes, textbook generation, desktop 1.0.0

Release source: `e27ec6e` on `main` (PR #37 merged as `26eb704`, PR #42 merged on top). The desktop version bump `b67bf05` follows it and changes only `apps/desktop/package.json`.

- **#37: review history and undo.** `apply_card_review` now records review events and schedule snapshots for accounts outside the `review_reconciliation` rollout, which is every production account. Before this, undo could never restore a schedule for them. Undo of an older review that has no snapshot is now history-only and bumps the row version, so the device's next review passes the version check. It no longer raises a retryable 40001: devices retried that forever and exhausted the PostgREST pool on staging. Also in #37: the Browse cards redesign, hosted generation failing clearly without an AI key, Expo 57.0.31 for Xcode 27, the production EAS profile, the mobile card editor redesign and Live Activities (the mobile parts ship with the next iOS build).
- **#42: textbook extraction and generation.** PDF generation skips navigation pages. Chunks generate four at a time with the card budget scaled to the job cap, and cards are chosen across the whole book. Persisted chunks are paged past 1,000 rows. Occlusion OCR upscales small images. PDF extraction moves to `mistral-ocr-4-1` (pdf-v2.2.1). The extraction worker part is **not deployed**, see below.
- Database: `restore_review_without_snapshot` and `record_legacy_review_history` were applied to `rdfijwmxlyvykcnxfurd`. The deployed `apply_card_review`/`restore_card_review` bodies match the repository files (md5). Both were already on staging, which was confirmed by behaviour: snapshot-less undo returns `history_only` and bumps the version.
- Validation on the release tree: build; web, mobile, desktop and worker typecheck; lint; web 336/336; worker; local-db; launch suite; e2e typecheck; pdf-extraction 31/31. CI green on #37 and #42.
- Hosted staging: `dpl_J5QSAikhSY9vjCFEkwnwjKFL47XN`, release ID `e27ec6e`. Served scripts carry the release ID and the staging database reference only. Authenticated smoke with the textbook test account: study decks, decks, browse (with filters), cram plans, dashboard and heatmap all 200. A review through `/api/cards/{id}/review` recorded a `review_events` row with `next_state`, and undo restored the prior due/reps exactly.
- Web/API: `dpl_F8vvn9we4B2PfRvHE6HaaajxtkdX`, release ID `e27ec6e`, offline media disabled, promoted to https://www.deephaus.ai. Homepage, login, pricing, download and service worker return 200, dashboard redirects unauthenticated, study/cram APIs return 401 unauthenticated, served scripts carry `e27ec6e` and the production database reference only, and no error logs from deployment creation (19:50:55 UTC) until 19:58:54 UTC, about eight minutes. A later 30-minute window (15:41–16:11 UTC on November 4) was also clean. The hours between are outside Hobby-plan log retention and were not checked. Generation, PDF and occlusion paths from #42 were not exercised on hosted staging or production.
- **Desktop 1.0.0**, the first public desktop release: tag `desktop-v1.0.0` (electron-builder also created `v1.0.0` at the same commit), GitHub release `v1.0.0`, workflow run 41707963327. macOS: the app in both the `.zip` and `.dmg` is notarized and stapled and passes `spctl` (the `.dmg` container itself is unsigned; the first attempt failed stapling on an Apple network error and was re-run). Linux AppImage/deb. All six download links return 200. Installers were inspected but not installed on any platform, and the checklist's staging pre-release step was skipped.
- **Windows defect in 1.0.0.** The workflow passed `CSC_LINK` to every OS, so the Windows installers are signed with the Apple Developer ID certificate rather than left unsigned, and the signature shows Luke's legal name. `resources/app-update.yml` in the installer pins `publisherName` to `Developer ID Application: LUKE THOMAS KYNE (NVNN9G49JA)`, so electron-updater on an installed 1.0.0 will reject updates signed by anyone else, including Dekki Inc. Those installs will need a manual reinstall. Artifact Signing identity validation is still pending. The Windows installers and blockmaps were removed from release `v1.0.0` on November 4; `latest.yml` stays so installed apps get no update errors. `/download` Windows links return 404 until a new release is published.
- **Render extraction worker (correction).** This record first said the worker was not deployed. It was: merging `render.yaml` in #42 triggered a Blueprint sync that deployed `e27ec6e` with `mistral-ocr-4-1` at 19:46 UTC on November 3, even though Auto-Deploy is off. The worker ran without `MISTRAL_API_KEY` until November 4, so scanned PDFs would have failed, but no extraction jobs were created in that window. `MISTRAL_API_KEY` was added and `dep-dbllo9om7kps73btt020` (`e27ec6e`) went live at about 16:24 UTC on November 4. A direct call with the production key to `mistral-ocr-4-1`, using the worker's request options, returned correct text. A real scanned PDF has not been run through the production worker.
- **Not built: iOS staging TestFlight.** The Live Activities widget extension (`com.deephaus.app.staging.DeepHausWidgets`) needs a new App Store provisioning profile, which EAS creates only after an interactive Apple Developer login. EAS consumed build numbers 6–9 on the failed attempts, so the next build is 10. The main target's profile was regenerated during the attempts (`99MYD9KM4A` became `VRHJ334BXM`).

Rollback reference: web `dpl_1jYzupYVB54Z48DhhZFsgZN3RibH` (source `8859465`). Both migrations keep the same function signatures as that build; keep them during an application rollback. Desktop: unpublish release `v1.0.0`.

## Desktop release — November 4, 2026: 1.0.1

Release source: `d71d1c2` (PR #43 plus the version bump), tag `desktop-v1.0.1`, GitHub release `v1.0.1`, workflow run 41868827797, published 17:35 UTC.

- **Why.** Restores the Windows download removed from `v1.0.0` and keeps the Apple certificate off Windows builds. Windows 1.0.0 installs still pin the Apple certificate name for updates and need a manual reinstall.
- **Process.** A draft `v1.0.1` was created first so builds could upload without moving `releases/latest`, and it was published only after every asset was inspected. The first macOS attempt was cancelled after 15 minutes during a GitHub Actions outage (no workflow timeout is set; the cause is not proven) and was re-run.
- Checked on the release files: the Windows x64 installer has no signature and its `app-update.yml` has no `publisherName`; the app in the macOS `.zip` and `.dmg` is 1.0.1, stapled, and accepted as Notarized Developer ID. Only the x64 Windows installer was inspected. All six download links return 200 and all three update feeds report 1.0.1. Nothing was installed on any platform, and Windows builds stay unsigned until Artifact Signing is approved, so SmartScreen may warn.

Rollback reference: unpublish `v1.0.1`; `v1.0.0` then has no Windows installers.
