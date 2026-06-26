# AGENTS.md

## Cursor Cloud specific instructions

DeepHaus is a pnpm + Turborepo monorepo. Standard commands live in the root
`package.json`, `turbo.json`, and `README.md`; the notes below only cover
non-obvious startup/run caveats for this cloud environment. The update script
already runs `pnpm install` and builds the workspace library packages.

### Services

- `apps/web` — Next.js 15 app (the primary product). Dev server on port 3000.
- Local Supabase — auth/Postgres/storage, started via the Supabase CLI (Docker).
  API `:54321`, Studio `:54323`, Postgres `:54322`.
- `apps/anki-worker` — optional background worker; needs `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`. Not required to run the web app.
- `apps/mobile` — Expo app; cannot be meaningfully run headless in the cloud VM.

### Running the backend (Supabase)

Docker and the Supabase CLI are installed by setup but are NOT auto-started.

1. Start the Docker daemon if it is not running: `sudo dockerd` (run it in a
   persistent tmux session; it must stay up).
2. `sudo supabase start` (run from repo root). This applies all migrations in
   `supabase/migrations` and then `supabase/seed.sql`. Use `sudo supabase status`
   to print the Project URL and the publishable/secret keys.

Critical gotcha: the SQL migrations enable row-level security but rely on
Supabase's historical auto-granting of table privileges. The current CLI's local
Postgres uses a restrictive default ACL, so without explicit grants every API
call fails with `permission denied for table ...`. `supabase/seed.sql` restores
the standard `anon`/`authenticated`/`service_role` grants and runs automatically
during `supabase start` / `supabase db reset`. If you bypass the seed you must
re-apply those grants manually.

### Running the web app

- `apps/web/.env.local` must contain `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key from `supabase status`),
  `SUPABASE_SERVICE_ROLE_KEY` (the secret key), and `DEEPHAUS_USE_MOCK_LLM=true`.
  Copy from `.env.example`.
- With `DEEPHAUS_USE_MOCK_LLM=true` no OpenAI key is needed; card generation
  returns placeholder sample cards (this is expected, not a bug). Set it to
  `false` and add `OPENAI_API_KEY` for real generation.
- Start with `pnpm --filter @deephaus/web dev` (Turbopack). Workspace library
  packages must be built first (`@deephaus/apkg`, `@deephaus/anki-import`,
  `@deephaus/rich-text` are consumed from their `dist/`); the update script does
  this, or run `pnpm dev` which builds them via turbo's `^build`.

### Lint / typecheck / test

- `pnpm turbo lint` does NOT work: no ESLint config is committed, so `next lint`
  drops into an interactive setup prompt. Use `pnpm turbo typecheck` for static
  checking instead.
- Tests: `pnpm --filter @deephaus/rich-text test` (vitest).
- Sample deck export (sanity check for the apkg builder):
  `pnpm --filter @deephaus/apkg export-sample`.
