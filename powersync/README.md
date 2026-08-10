# PowerSync setup

PowerSync replicates the user-owned tables from Supabase Postgres into a local
SQLite database on every client (web WASM/OPFS, React Native, Electron). Reads
and writes happen locally; an upload queue pushes writes back through
`supabase-js` under RLS when online.

Database-side prerequisites (role, scoped publication, grants) are provisioned
by the migration `supabase/migrations/20260810033356_powersync_offline_prep.sql`,
which is already applied to production.

## One-time dashboard setup (manual)

1. Create a PowerSync Cloud account and instance at
   https://dashboard.powersync.com/ (or self-host).
2. Set a real password for the replication role in the Supabase SQL editor:

   ```sql
   alter role powersync_role with password '<strong-password>';
   ```

3. In the PowerSync Dashboard, add a **Database Connection** using the
   Supabase *direct* connection string (project `rdfijwmxlyvykcnxfurd`),
   with username `powersync_role` and the password from step 2.
4. Under **Client Auth**, enable **Use Supabase Auth**.
5. In **Sync Streams**, paste the contents of [sync-streams.yaml](./sync-streams.yaml),
   validate, and deploy.
6. Copy the instance URL (Connect dialog) into the app environments:
   - Web: `NEXT_PUBLIC_POWERSYNC_URL` (Vercel + `.env.local`)
   - Mobile: `EXPO_PUBLIC_POWERSYNC_URL`

## Supabase WAL settings (manual, recommended)

Idle replication slots can grow the WAL on smaller Supabase projects. Cap it:

```bash
supabase --experimental --project-ref rdfijwmxlyvykcnxfurd \
  postgres-config update --config max_wal_size=1GB
supabase --experimental --project-ref rdfijwmxlyvykcnxfurd \
  postgres-config update --config max_slot_wal_keep_size=1GB
```

(Requires `supabase login`; see `pnpm supabase:auth`.)

## What syncs

`projects`, `sources`, `generation_jobs`, `cards`, `card_reviews`,
`review_logs`, `cram_plans`, `cram_plan_deck_profiles`, `cram_plan_items`,
`cram_review_logs`, `user_study_settings`, `user_fsrs_params`,
`user_profiles` (read-only on clients).

Billing/AI-credit, integration (Notion/Drive), community, and job-queue tables
intentionally do not replicate; those features remain online-only.

## Client packages

- `packages/local-db` (`@deephaus/local-db`): PowerSync schema, Supabase
  upload connector, and the shared local query layer used by web and mobile.
- `packages/scheduling` (`@deephaus/scheduling`): FSRS + cram grading used
  both server-side (API routes) and client-side (offline grading).
