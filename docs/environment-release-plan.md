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
