# AGENTS.md

## Cursor Cloud specific instructions

DeepHaus is a pnpm + Turborepo monorepo (see `README.md` for the product overview and standard commands). This section only captures non-obvious caveats for running it inside a Cursor Cloud VM. Standard scripts live in `package.json` / each workspace `package.json` and the `README.md`.

### Services

| Service | Path | Scope | Run (dev) |
| --- | --- | --- | --- |
| Web app (Next.js 15) | `apps/web` | Primary | `pnpm --filter @deephaus/web dev` (port 3000) |
| Local Supabase (auth + Postgres + storage) | `supabase/` | Required for web | `supabase start` (needs Docker) |
| anki-worker (background import worker) | `apps/anki-worker` | Optional | `pnpm --filter @deephaus/anki-worker dev` (needs `SUPABASE_SERVICE_ROLE_KEY`) |
| Mobile (Expo) | `apps/mobile` | Optional | `pnpm dev:mobile` — needs a device/emulator; not runnable headless in the VM |

### Backend: local Supabase via Docker

The app needs a Supabase backend. In the cloud VM we run it **locally** via the Supabase CLI + Docker (no hosted project / secrets required). Docker and the `supabase` CLI are installed in the VM snapshot but **not auto-started**:

1. Start the Docker daemon (no systemd in this container): `sudo dockerd &` (or start it in a tmux session). Verify with `sudo docker info`.
2. Start the stack from the repo root: `sudo supabase start`. This applies all `supabase/migrations/*` and creates the `pdfs`, `card-media`, and `apkg-imports` storage buckets automatically. Keys/URLs: `sudo supabase status`.

Docker is configured for this VM with `storage-driver: fuse-overlayfs` and `containerd-snapshotter: false` in `/etc/docker/daemon.json`, and iptables is set to `iptables-legacy`. Do not change these or Docker will fail to start.

### CRITICAL gotcha: public-schema grants

The migrations enable Row Level Security and create policies but **never `GRANT`** table privileges — they rely on Supabase's old default behavior of auto-granting `SELECT/INSERT/UPDATE/DELETE` on `public` tables to `anon`/`authenticated`/`service_role`. The current Supabase CLI's local stack only grants `TRUNCATE/REFERENCES/TRIGGER`, so without a fix every authenticated DB write fails with `permission denied for table <name>` (e.g. card generation cannot create a project). The hosted project the repo targets predates this change, which is why it works in production but not on a fresh local stack.

After the **first** `supabase start` (or any `supabase db reset` / fresh DB volume), apply the missing grants once:

```bash
sudo docker exec -i supabase_db_deephaus psql -U postgres -d postgres <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL
```

These grants live in the Postgres data volume, so they persist across VM snapshots and `supabase stop`/`start` — only a fresh DB (`db reset`, or first ever start) needs them re-applied.

### Web app env

`apps/web/.env.local` is gitignored, so recreate it if missing. Get the local Supabase keys from `sudo supabase status` (they are stable local-dev defaults): use the **Publishable** key for `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the **Secret** key for `SUPABASE_SERVICE_ROLE_KEY`. Set `DEEPHAUS_USE_MOCK_LLM=true` to generate sample cards without an `OPENAI_API_KEY`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Publishable key from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<Secret key from `supabase status`>
DEEPHAUS_USE_MOCK_LLM=true
```

### Build / test / lint notes

- **Workspace packages must be built before running the web app or tests.** The web app imports `@deephaus/apkg`, `@deephaus/anki-import`, `@deephaus/rich-text`, and `@deephaus/api-client` from their `dist/` output (only `@deephaus/shared` and `@deephaus/llm` are transpiled from source via `transpilePackages`). Vitest in `@deephaus/rich-text` also resolves `@deephaus/shared` from `dist`. Run `pnpm --filter './packages/*' build` after a clean checkout or after editing package source. Built `dist/` is gitignored but persists in the VM snapshot.
- **Tests:** `pnpm --filter @deephaus/rich-text test` (vitest) is the only automated suite.
- **Typecheck:** `pnpm typecheck` covers all 15 workspace tasks and is the most useful static check.
- **Lint is not configured in this repo.** `pnpm lint` runs `next lint` in `apps/web`, which has no ESLint config and drops into an interactive setup prompt (it hangs/fails non-interactively). Prefer `pnpm typecheck` until an ESLint config is added.
