# @deephaus/anki-worker

Standalone worker that imports **large** Anki (`.apkg` / `.colpkg`) packages
out-of-band. It exists because multi-GB exports (e.g. the AnKing deck _with
review history_) cannot be processed inside a serverless request — they blow past
Vercel's 500 MB `/tmp` cap, the WASM memory ceiling, and the 300 s timeout.

## How it fits together

```
Browser ──TUS resumable upload──▶ Supabase Storage (apkg-imports)
   │
   └─ POST /api/import/anki/enqueue ──▶ inserts a row in `anki_import_jobs`
                                          │
            small package (≤ ANKI_INLINE_MAX_MB) ──▶ imported inline by Vercel (after())
                                          │
            large package ──────────────▶ left "pending" for THIS worker
                                          │
Browser ◀── GET /api/import/anki/jobs/:id (polled) ◀── job progress/result
```

The worker:

1. Atomically claims the oldest `pending` job (`claim_anki_import_job()` RPC,
   `FOR UPDATE SKIP LOCKED` — safe to run multiple replicas).
2. Streams the package from Storage to local disk via a signed URL (constant
   memory).
3. Reads it with `yauzl` (random access over the zip central directory), pulling
   out only the SQLite collection + referenced images. The `revlog` table is
   never read, so review history doesn't inflate memory.
4. Parses the collection with `sql.js` and imports cards + media, writing
   progress back to the job row.

## Running locally

```bash
cp apps/anki-worker/.env.example apps/anki-worker/.env   # fill in values
pnpm --filter @deephaus/anki-worker dev
```

## Deploying (any container host)

The worker is a plain long-running Node process with **no native addons**, so it
runs anywhere that runs a container (Fly.io, Railway, Render, ECS, a VM, …).

```bash
# from the repo root
docker build -f apps/anki-worker/Dockerfile -t deephaus-anki-worker .
docker run --rm \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  deephaus-anki-worker
```

Give it enough ephemeral disk to hold the largest package you expect (the full
archive is streamed to disk, e.g. ~6 GB for a 5 GB import) and ~1 GB RAM.

## Required environment

| Variable                    | Required | Notes                                            |
| --------------------------- | -------- | ------------------------------------------------ |
| `SUPABASE_URL`              | yes\*    | Falls back to `NEXT_PUBLIC_SUPABASE_URL`.        |
| `SUPABASE_SERVICE_ROLE_KEY` | yes      | Service role; bypasses RLS. Keep server-side.    |
| `ANKI_WORKER_POLL_MS`       | no       | Queue poll interval in ms (default `5000`).      |
| `ANKI_WORKER_TMPDIR`        | no       | Scratch dir for streaming (default OS tmp). Set to a mounted volume if `/tmp` is small. |

> Without this worker running, packages larger than `ANKI_INLINE_MAX_MB` (default
> 80 MB, set on the web app) stay queued until a worker picks them up. Smaller
> packages still import inline on Vercel.
