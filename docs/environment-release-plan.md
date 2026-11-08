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
- **iOS staging TestFlight.** First blocked on the Live Activities widget's provisioning profile, which EAS creates only in interactive mode. Those attempts consumed build numbers 6–9. Build 10 (`32763b90-e9e7-4d99-bf6e-a62cd23fef76`, source `7049056`) then succeeded from a clean checkout on November 4 using saved Keychain credentials, and submission `b8e6b3c8-5800-423a-ad14-af54402fa5f9` finished at about 18:39 UTC, uploading it to App Store Connect. Apple's processing and on-device testing were not confirmed.

Rollback reference: web `dpl_1jYzupYVB54Z48DhhZFsgZN3RibH` (source `8859465`). Both migrations keep the same function signatures as that build; keep them during an application rollback. Desktop: unpublish release `v1.0.0`.

## Desktop release — November 4, 2026: 1.0.1

Release source: `d71d1c2` (PR #43 plus the version bump), tag `desktop-v1.0.1`, GitHub release `v1.0.1`, workflow run 41868827797, published 17:35 UTC.

- **Why.** Restores the Windows download removed from `v1.0.0` and keeps the Apple certificate off Windows builds. Windows 1.0.0 installs still pin the Apple certificate name for updates and need a manual reinstall.
- **Process.** A draft `v1.0.1` was created first so builds could upload without moving `releases/latest`, and it was published only after every asset was inspected. The first macOS attempt was cancelled after 15 minutes during a GitHub Actions outage (no workflow timeout is set; the cause is not proven) and was re-run.
- Checked on the release files: the Windows x64 installer has no signature and its `app-update.yml` has no `publisherName`; the app in the macOS `.zip` and `.dmg` is 1.0.1, stapled, and accepted as Notarized Developer ID. Only the x64 Windows installer was inspected. All six download links return 200 and all three update feeds report 1.0.1. Nothing was installed on any platform, and Windows builds stay unsigned until Artifact Signing is approved, so SmartScreen may warn.

Rollback reference: unpublish `v1.0.1`; `v1.0.0` then has no Windows installers.

## Staging validation — November 4, 2026: scanned PDFs and PDF images

- **Scanned PDF.** A two-page image-only PDF ran through hosted staging (`e27ec6e`) with the local staging extraction worker: both pages routed to OCR, 8 cards generated, 8/8 source quotes verbatim, throwaway account deleted. Not repeated through the production worker.
- **PDF image extraction was failing on Vercel.** A labelled-diagram PDF returned `scanned: 0` from `/api/sources/occlusion-scan`: `require.resolve` became a numeric webpack ID, then PDF.js could not resolve `@napi-rs/canvas`, and both errors were swallowed. `runtime.ts` is unchanged since July 21, so this predates the November releases. Production uses the same bundling but was not tested directly. PR #45 fixes both; staging `dpl_8sELpxHCD8t33xGHeDQXweqwyNdd` (release ID `aa593be`) returns `scanned: 1, qualified: 1`, 4 regions. **Hosted staging is therefore ahead of `main` until #45 merges.**
- **Flaky OCR test.** Failures matched runner image `20261101.186.1` and passes matched `20261025.179.1`. The test drew labels in Arial; #44 uses a bundled font. Its CI run landed on the older image, so the fix is not yet proven on the newer one.

## Production release — November 6, 2026: chat Create page and FSRS-7

Release source: `2ed9ff6` on `main` (PR #48 on top of #46 and #47).

- **#48: Create page.** The opening popup becomes a text composer that takes every source type plus direct instructions. Generation skips near-duplicates on a re-run, saves cards as each section finishes and can be stopped. Each deck keeps its conversation, and card deletes offer Undo.
- **#48: FSRS-7.** `ts-fsrs` 6.0.0 and `@open-spaced-repetition/binding` 0.6.0, both of which need Node 24 (`deephaus-web` and `deephaus-staging` run 24.x). New cards start on FSRS-7; existing cards move over at their next review by replaying their complete history. Cards without complete history stay on FSRS-6 and each row records its model. With default weights a new card rated Good goes to about 5 days, not a 10-minute step (`FSRS7_ALLOW_MODEL_OVERRIDE`). FSRS-6 weights can't be converted, so users are on FSRS-7 defaults until they re-run the optimizer.
- **#46: upload backoff** and **#47: PostHog text masking and signup counting** ship in this build too.
- Database: `create_conversations_and_generation_stop` and `fsrs7_memory_state` applied individually to `rdfijwmxlyvykcnxfurd` before the deploy (versions `20261106024003`, `20261106024050`), after staging. The five redefined functions were md5-identical to the repository before the change and match staging after it. All 1,460 `card_reviews` and 5,454 `cram_plan_items` read as FSRS-6 afterwards, as intended.
- **Migration drift, not from this release.** Production also has `20261106001649 revenuecat_revenue_events`, applied earlier the same night. It is in no branch or worktree of this repository. It does not touch anything here, and it was left in place.
- Validation: CI green on `92c0d3c`, whose tree matches the merge. Locally: web 367/367, launch schema 63/63, launch vitest 158/159 (the failure is the cram test that fails during the first hour of the UTC day, because its fixture's `last_review` lands on the previous day), web production build, mobile `expo export`.
- Hosted staging: `dpl_Fm7WcshdEyC2QMv3esmBuGTe8z9S`, release ID `2ed9ff6`. Served scripts carry the release ID and the staging database reference only. Authenticated smoke with the textbook test account: study decks, decks, browse, cram plans, dashboard, heatmap, advanced stats and settings 200; a review stored FSRS-7 memory and undo restored the new card; `/api/fsrs/optimize` returned 34 weights in 1.2 s, the first run of binding 0.6.0 on Vercel's Linux runtime; simulator and conversation 200; Create composer rendered with no page errors. A local build against staging also covered replay, FSRS-6 to FSRS-7 rebuild, 162 backdated reviews, cram plans and a browser study session.
- Web/API: `dpl_5m7VoZYpP3HUjffTWayrTERkDtuB`, release ID `2ed9ff6`, offline media disabled, promoted to https://www.deephaus.ai. Homepage, login, pricing, download and service worker return 200; dashboard and create redirect unauthenticated; study, cram, settings and optimize APIs return 401 unauthenticated; served scripts carry `2ed9ff6` and the production database reference only. Production has no test account, so no authenticated request was made there.
- **PowerSync not updated.** `powersync/sync-streams.yaml` adds the `fsrs7_*` columns to `user_fsrs_params` and still has to be deployed from the dashboard for staging and production. Until then browsers and phones grade with default FSRS-7 weights even after a user optimizes, while server-built button labels use the personal ones.
- **Render Anki worker not redeployed.** Its background exports still write FSRS-7 memory into `data` as `s`/`d`. The web `/api/export` path is correct.
- **Mobile unchanged.** Installed builds keep grading with FSRS-6 and are repaired at the next up-to-date review. The next TestFlight build picks up FSRS-7; its Metro start needs `--clear` once. The mobile app has not been run on a device with this code.

Rollback reference: web `dpl_Fe2DEzqWEqFYUBx9STWZnd9uSwHK` (source `19c5914`). Both migrations are additive and compatible with that build, so keep them during an application rollback. Cards already on FSRS-7 would then be graded as FSRS-6 and rebuilt after a roll-forward.

## Production release — November 6, 2026: redesign, own-plan card generation, desktop 1.0.2

Release source: `be7bf27` on `main` (PR #50 on top of #49).

- **#50: own-plan generation.** The desktop app can generate cards through the Claude Code or Codex CLI a user is signed in to, on every plan including Basic. Local jobs reserve no credits. It is desktop-only because of provider terms; see `docs/local-ai-engines.md`. The privacy policy gained a disclosure paragraph and is now effective November 6, 2026.
- **#49: redesign.** First production release of the web redesign, which had merged but not been deployed. It has no migrations, new environment variables, worker or PowerSync changes, and removes no routes.
- Database: `local_generation_engine` applied individually to staging (ledger `20261106221500`, through the dashboard because the CLI token has expired) and `rdfijwmxlyvykcnxfurd` (`20261106222810`) before the deploy. Two nullable columns on `generation_jobs`; all 260 production jobs unchanged.
- Validation: CI green on `0341561`, whose tree matches the merge. Locally: web 507/507, desktop 12/12, launch 172/172, web typecheck, lint with no errors.
- Hosted staging: `dpl_Hy7hg7N5Cd7Dc6GZXjqMYrJtZVLu`, release ID `be7bf27`. On throwaway Basic accounts, in Electron: a three-chunk `.docx` on Claude made 25 cards, all linked and quoted in source order; Stop on Codex kept 5 cards and closed in about 1.5 seconds; credits stayed 250/250. The credits path still works (15 cards, 15 credits settled). The notarized packaged 1.0.2 staging build, launched with a Finder-style PATH, found both CLIs and generated on both. Password reset passed end to end on the redesigned page: the redirect was honoured, the new password worked, the old one was rejected, and a visitor without a link saw no form. Authenticated smoke with the textbook test account: all app and settings routes 200, `/profile` redirects, study shows a card and four grade buttons, no page errors or failed API calls.
- Web/API: `dpl_FyDtGi66zUWVMLrbg4Th65v1Ne9s`, release ID `be7bf27`, offline media disabled, promoted to https://www.deephaus.ai. Public pages and service worker return 200; dashboard, create and settings redirect unauthenticated; APIs including `/api/jobs/:id/local` return 401; served scripts carry `be7bf27` and the production database reference only. No error logs in the hour to 23:12 UTC. Production has no test account, so no authenticated request was made there and password reset was not run there; its allowlist has the same `/**` form as staging.
- **Desktop 1.0.2:** tag `desktop-v1.0.2`, GitHub release `v1.0.2`, workflow run 42308817473, published 23:12 UTC. The draft was created 11 seconds after the tag because the first attempt was rejected; the build was still queued, so `latest` never moved early. Checked on the release files: 15 assets; the macOS app is 1.0.2, notarized, stapled and contains the local AI runner; the Windows x64 installer carries no Apple certificate. All six download links return 200 and all three update feeds report 1.0.2. The packaged staging build ran on a Mac; production builds were inspected, not installed. Windows and Linux were built but not run, and Windows stays unsigned.
- **Not done for mobile.** Production's auth allowlist has no `deephaus://auth/callback` entry, and staging's `deephaus-staging://auth/callback` has no trailing `**`, so phone password reset would fall back to the Site URL. Both need fixing before the next phone release.
- **Possible account deletion bug.** `auth.admin.deleteUser` failed with "Database error deleting user" on a staging account with cards and a settled credit transaction, and succeeded once its projects were deleted. `processAccountDeletions` makes the same call. Cause not confirmed; production had no deletion requests.
- **Web at narrow widths.** The sidebar doesn't collapse by itself: at 390px wide it stays 272px and leaves the page 118px.

Rollback reference: web `dpl_5m7VoZYpP3HUjffTWayrTERkDtuB` (source `2ed9ff6`). The migration is additive and compatible with that build, so keep it during an application rollback. Desktop: unpublish `v1.0.2`; 1.0.1 stays compatible.

## Production release — November 7, 2026: motion and loading consistency

Release source: `1b47b25` on `main` (PR #51).

- **#51: motion and loading.** One set of motion tokens (100/160/220ms) shared by CSS and Framer, guarded by a test. Sidebar icons stay in place while labels expand, and the collapsed profile button has a hover tag. Skeletons for page content, a spinner for actions, and the animated mark or equalizer bars while AI works. The greeting logo lines up with the heading and animates on hover on Home and Create. Opening a deck loads its cards with its settings, which removes a false "This deck is empty" state. Web only: no migrations, environment variables, worker, PowerSync, desktop or phone changes.
- Validation: CI green on `ef5cf98`, whose tree matches the merge. Locally: web 509/509, web typecheck, lint with no errors. The launch suite was not run locally.
- Hosted staging: `dpl_GxDLUPtkL3KZxaocoqKqVGM2hqU4`, release ID `1b47b25`. Served scripts carry the release ID and the staging database reference only. Authenticated smoke with the textbook test account: 15 app routes 200, study shows a card and four grade buttons, the Home mark animates on hover, tokens read 0.1s/0.16s/0.22s. `/onboarding-preview` returns 404 because it is dev-only. `/api/stats/advanced` returned 402 for this account, as it did on the previous smoke run; this release changes no API code.
- Web/API: `dpl_B2GZzGAHEYEQhqnfTXihD9iePUGe`, release ID `1b47b25`, offline media disabled, promoted to https://www.deephaus.ai. Public pages and service worker return 200; dashboard and create redirect unauthenticated; dashboard stats, projects and cram plans APIs return 401 unauthenticated; served scripts carry `1b47b25` and the production database reference only; served CSS has the new tokens. Production has no test account, so no authenticated request was made there.
- **Runtime logs not checked.** `vercel logs` returned no records after promotion, for the deployment or the project, even though the checks above had just hit production, so this says nothing about errors.
- **Not tested live:** the equalizer during a real generation, and toasts.

Rollback reference: web `dpl_FyDtGi66zUWVMLrbg4Th65v1Ne9s` (source `be7bf27`). No schema or data changes, so a rollback needs nothing else.

## Production release — November 8, 2026: deck picker, neutral grades, remembered card settings

Release source: `5d2f851` on `main` (PR #54).

- **#54.** Home's review card picks one deck: "Choose a deck" lists decks most due first (filter at 8+), the count, bar and legend animate to that deck, and Start review or Enter open its review. Study and cram no longer shade Good before grading; Good's tooltip names Space/Enter. Create saves detail, card types, focus, tags and hints to the open deck as they change (the deck PATCH accepts those fields), and new decks start from the last settings chosen for a new deck in that browser. Generation runs no longer overwrite a deck's retention, daily new cards, FSRS weights or global-settings flag with defaults. Web only: no migrations, environment variables, worker, PowerSync, desktop or phone changes. `main` since the last web release (#52) changed only the phone app, Maestro flows and the phone's lockfile entries.
- Validation: CI (Launch checks) green on `266277a`, whose tree matches the merge. Locally: web 510/510 including a new test that fails on the old generation code, web typecheck, lint with no errors. Checked against staging data on the local dev server signed in as Luke: deck picker scope and review targets, grade buttons after reveal, per-deck save across deck switches, new-deck settings after reload; test settings were put back. The launch suite was not run locally.
- Hosted staging: `dpl_9u9vXRDRMGe25urqV6q2ZT3VqxkD`, release source `266277a`. Public pages and service worker 200; dashboard, create and decks redirect unauthenticated; dashboard stats, projects and the new project PATCH return 401 unauthenticated. **No authenticated hosted smoke this time**, and served bundles were not scanned for the release ID or database reference.
- Web/API: `dpl_7oCrVhw6qXk7KRb5pBcztJTxzj1T`, release ID `5d2f851`, offline media disabled, aliased to https://www.deephaus.ai and https://deephaus.ai. Public pages and service worker 200; dashboard, create and decks redirect unauthenticated; dashboard stats, projects, cram plans and project PATCH return 401 unauthenticated; pages are served by the new deployment. Production has no test account, so no authenticated request was made there.
- **Runtime logs not checked.** `vercel logs --deployment` returned zero records right after promotion, as on the previous release, so this says nothing about errors.
- **Not tested live:** a real card generation (to avoid spending credits).
- Decks whose own retention or daily limit were reset by earlier generations stay reset; this release only stops it happening again.
- **Merged but not released:** #53 (`09e124f`, atomic flashcards and card-type passes) landed on `main` after `5d2f851` was deployed. Production does not include it.

Rollback reference: web `dpl_B2GZzGAHEYEQhqnfTXihD9iePUGe` (source `1b47b25`). No schema or data changes, so a rollback needs nothing else.

## Production release — November 8, 2026: atomic flashcards and no repeated facts (with #54)

Release source: `09e124f` on `main`, the #53 merge on top of #54.

**Correction to the order of events.** Two sessions released at the same time:

1. #54 went live at about 06:59 UTC as `dpl_7oCrVhw6qXk7KRb5pBcztJTxzj1T` (`5d2f851`).
2. About four minutes later this session deployed `4253d3b`, the head of PR #53, which does not contain #54, as `dpl_C5BMfq2TNReJ3wZWqWG8KHr1US1o`. That removed #54 from production for about 15 minutes.
3. `09e124f`, which contains both, then replaced it.

The "Merged but not released: #53" note in the #54 record no longer applies.

- **#53: card-writing rules.** Generation prompts add rules from the spaced-repetition literature: one idea per card, short answers, no list or yes/no questions, cards that stand alone, and at most three cloze deletions (preferably one or two, down from seven). They apply to source and topic generation, including desktop local engines, because those prompts are built on the server.
- **#53: no repeated facts.** In a basic + cloze run, the cloze call now receives the basic call's questions, and topic runs chain the same way. Desktop local engines send both calls at once, so they don't have this yet.
- Web only: no migrations, environment variables, worker, PowerSync, desktop or phone changes. The new `packages/llm/scripts` are dev-only.
- **Evidence:** blind two-judge grading (Claude Opus 5.5 and GPT-6.1 Sol, κ 0.65) of 2,691 cards from two OpenStax textbooks:
  - The old prompt left 33–56% of cards broken for every model; the new rules cut that to 6–19%.
  - A re-grade of the shipped pipeline: production's `gpt-5.4-mini` went from 76.7 to 77.3, and repeated cloze cards fell from 23–58% to about 1–9% for most models.
  - Reports are in `test-results/grading/` on the release machine.
- **Validation:** CI green on `4253d3b` and on `09e124f`. Locally on `4253d3b`: launch suite 188/188 (two new tests), web 509/509, web and `@deephaus/llm` typecheck. #53 and #54 touch different files.
- **Hosted staging:** each build got one real basic + cloze generation on a throwaway Basic account. The accounts and projects were deleted.
  - `4253d3b` (`dpl_BeMMmZ9kYpY9CuAJHd7aTaty7iU3`), Psychology 2e page 207: ready in about 7 seconds with 11 cards (8 basic, 3 cloze). Every cloze had one deletion, and no cloze repeated a basic question. One basic card still said "according to the passage".
  - `09e124f` (`dpl_pfdBaWCWJspQmdHzxLJSkjcHAnrC`), Anatomy & Physiology 2e page 853: ready with 14 cards (8 basic, 6 cloze), every cloze with one deletion. Served scripts carry `09e124f`, and the project PATCH returns 401 unauthenticated.
- **Web/API:** `dpl_5MnwdfQbmEqbuUEDAyWQCYTgr9xg`, release ID `09e124f`, offline media disabled, promoted to https://www.deephaus.ai (the apex redirects there).
  - Public pages and service worker return 200; dashboard, create and decks redirect to login.
  - `/api/generate/text` and the project PATCH return 401 unauthenticated.
  - Served scripts carry `09e124f`, with neither `4253d3b` nor a staging database reference.
  - No authenticated request was made in production.
- **Runtime logs not checked:** `vercel logs --deployment` returned no records, as after the last two releases.

Rollback reference: web `dpl_7oCrVhw6qXk7KRb5pBcztJTxzj1T` (source `5d2f851`, #54 without #53). No schema or data changes.

## Production release — November 8, 2026: card quality levels

Release source: `d42c4ab` on `main` (PR #56), on top of the previous release `09e124f` plus phone-only #55.

- **#56: quality levels.** Create's settings gain Quality: Low, Medium or High. The model behind each level is server-side (`packages/llm/src/generation-models.ts`):
  - Low: Claude Haiku 5.5, low effort, 0.5 credits per card.
  - Medium (default for every existing deck): GPT-6.1 Terra, medium effort, 1 credit per card. It replaces `gpt-5.4-mini`.
  - High: Claude Opus 5.5, low effort, 10 credits per card.

  The quoted level is stored on the run's credit hold (`metadata.quality_level`) and decides both model and charge. The pricing page notes the per-level cost. `OPENAI_GENERATION_MODEL` is no longer read; `GENERATION_MODEL_<LEVEL>` can override a level.
- **New environment variable:** `ANTHROPIC_API_KEY` (sensitive) added to Production and Preview on `deephaus-staging` and `deephaus-web` before the deploy. Without it, Low and High fall back to OpenAI stand-ins. No migrations, worker, PowerSync, desktop or phone changes; the phone app has no Quality picker yet, so phone runs use the deck's saved level.
- **Evidence:** blind two-judge grading of 2,886 cards across 19 model and effort settings, reports under `test-results/grading/report-tiers/` on the release machine.
  - Opus at low effort scored best (86.3).
  - More Opus effort, Claude Fable 5.1 and GPT-6 Astra scored no higher.
  - Terra scored 84.4 at about a quarter of Opus's cost per card.
- **Validation:** CI green on `686472c`, the PR head. Locally: web 511/511, launch suite (the new quality-level tests pass; Easy Days failed once and then passed 3 of 3 reruns), web typecheck, lint with no errors.
- **Hosted staging:** `dpl_28NZpLJ341NkMq81BeoeWcfqwjjr`, release ID `d42c4ab`. Throwaway Basic accounts each generated basic + cloze cards from Psychology 2e page 207, and the accounts and projects were deleted:

  | Level | Cards | Credits charged | Notes |
  |---|---|---|---|
  | Low | 10 | 2 | every cloze had one deletion |
  | Medium | 5 | 4 | |
  | High | 9 | 40 | clozes had 1–2 deletions |

  Every hold recorded its `quality_level`. The cards don't show which model served each level.
- **Web/API:** `dpl_8k574zMLsGQueZ18bxug3SmyUBiW`, release ID `d42c4ab`, offline media disabled, promoted to https://www.deephaus.ai.
  - Public pages and service worker return 200; dashboard, create and decks redirect to login.
  - `/api/generate/text` and the project PATCH return 401 unauthenticated.
  - The pricing page shows the new credits note, and served scripts carry `d42c4ab`.
  - No authenticated request was made in production.
- **Runtime logs not checked:** `vercel logs --deployment` returned no records for 08:05–08:35 UTC, as after the previous releases.

Rollback reference: web `dpl_5MnwdfQbmEqbuUEDAyWQCYTgr9xg` (source `09e124f`). No schema changes. Rolling back sends every level to `gpt-5.4-mini`; decks keep a stored `qualityLevel` that the older build ignores.

## Production release — November 8, 2026: Claude-style card settings menu

Release source: `ae07450` on `main` (PR #59), on top of the previous release `d42c4ab` plus phone-only #57 and #58.

- **#59: card settings menu.** The pill under the Create composer reads **Haus 5.5 · Medium**: the card model's product name (`CARD_MODEL_NAME` in `packages/shared/src/card-labels.ts`) and the effort level. The name is display-only; the models behind each level are unchanged (`packages/llm/src/generation-models.ts`).
  - The menu lists Effort, Detail, Focus and Card types with their current values. Hovering a row opens its choices in a side panel; where there's no room it drills down in place.
  - Auto tags and Hints on blanks are switches.
  - "Quality" is renamed Effort on the Create page and in the pricing note. The menu no longer shows credits per card.
  - Web only. No migrations, environment variables, worker, PowerSync, desktop or phone changes; the phone still says Quality.
- **Validation:** CI green on `a7be697`, the PR head. Locally: typecheck for all packages, web 511/511, launch suite (63 node + 205 vitest), local-db, extraction worker, desktop, e2e typecheck, and web lint with no errors.
- **Hosted staging:** `dpl_GDWcYwUXi4Q2d3uXfZUS2c4ab2cn`, release ID `ae07450`. Signed in as the staging test account: the pill reads "Haus 5.5 · Medium", hovering Detail opens its panel, served scripts carry `ae07450`, no page errors. No generation run, since generation code is unchanged.
- **Web/API:** `dpl_55HnmtSR5mPMTs1Ko8sfSaDMVP2o`, release ID `ae07450`, offline media disabled, promoted to https://www.deephaus.ai.
  - Public pages and service worker return 200; dashboard, create and decks redirect to login.
  - `/api/generate/text` returns 401 unauthenticated.
  - The pricing page says "1 credit at Medium effort", and served scripts carry `ae07450` with no staging database reference.
  - No authenticated request was made in production.
- **Runtime logs not checked:** `vercel logs --deployment` returned no records for 17:38–18:08 UTC, as after the previous releases.

Rollback reference: web `dpl_8k574zMLsGQueZ18bxug3SmyUBiW` (source `d42c4ab`). No schema or data changes.
