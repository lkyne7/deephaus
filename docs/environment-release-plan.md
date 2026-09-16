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

## Current gates

- Live read-only inspection on September 16 confirmed production still lacks the four launch migrations. Staging has them. Historical ledger drift remains.
- Supabase staging database is healthy, but branch orchestration still reports `MIGRATIONS_FAILED` from historical replay; it is not a clean branch promotion path.
- Hosted Google sign-in has a documented invalid client-secret issue. Recheck before declaring auth validated.
- Verify separately hosted staging workers and production worker rollout.
- TestFlight signing and fresh Apple sandbox lifecycle validation are separate mobile release gates.
- Both live Render workers now have Auto-Deploy set to Off, verified after saving. The repository Blueprint preserves that setting. Vercel Git deployments are disabled in the new root and web configurations; the release branch is not yet published. Existing Vercel preview settings still share production values, so do not create production-project previews.

No live production release is certified by this document.

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
