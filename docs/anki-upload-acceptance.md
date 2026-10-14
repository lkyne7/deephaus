# Anki upload and progress acceptance — October 1, 2026

These checks use the isolated `launch-staging` Supabase project
(`cktvxmclcxtymkozciaw`) and the staging web API on port 3100. They do not
certify the production deployment or hosted worker. Synthetic accounts are
created for each run and removed afterward.

## Progress round trip

Build the tested packages with `pnpm --filter @deephaus/anki-worker... build`.
Run `pnpm launch:web`, then `pnpm launch:anki-check`. The check exits nonzero
when required behavior fails and saves a JSON report plus the input and
exported `.apkg` files under `test-results/anki-acceptance-<timestamp>/`.

The fixture contains six notes/seven Anki cards: a new card, learning card,
review card, relearning card, suspended review card, and a two-deletion cloze
note with separate schedules. It includes six historical review events.
Independent assertions verify known due dates, intervals, repetition/lapse
counts, FSRS memory values, and cloze ordinals before exercising the HTTP API.

Observed results:

| Check | Result |
|---|---|
| Parse known fixture schedules | Pass |
| Import current scheduling state | Pass: all six schedules and suspension retained |
| Import historical review events | Pass (October 12): six input events, six `review_logs` rows. Failed October 1 with zero |
| Export card content | Pass: all six notes, text fields, cloze content, types, and tags retained |
| Export current scheduling state | Pass (October 12): six schedules and suspension exported. Failed October 1: all reset to new |
| Export historical review events | Pass (October 12): six events in the exported package. Failed October 1 with zero |
| Import → export → reimport preserves progress | Pass (October 12): six schedules and one suspended card survive. Failed October 1 |
| Import with scheduling explicitly disabled | Pass: six notes imported without schedules |

Latest progress evidence:
`test-results/anki-acceptance-2026-10-12T22-53-07.588Z/report.json`.
The disposable account and its data were removed successfully. Cleanup queues
an `account_deletion_requests` row before deleting the user, as the app does;
a direct delete of an account with review logs fails on the review-count
trigger.

When scheduling is imported, the importer also reads Anki's `revlog` and writes
each graded review (again/hard/good/easy) to `review_logs`; manual reschedules
are skipped. Anki does not record FSRS memory state per review, so those rows
store stability and difficulty as 0. A card's last-review time and elapsed days
come from its latest graded review; without history they are still estimated
from due date and interval, and learning steps are reset. Imported reviews
count toward review totals and the leaderboard.

Export includes the user's schedules and non-undone review history unless the
request sets `include_progress: false`. Each card gets its type, queue, due date,
interval, reps, lapses and suspension, plus FSRS memory (`s`, `d`) in its `data`
JSON; the ease factor is approximated from difficulty. Each graded review becomes
a `revlog` row. Anki does not keep sub-day intervals on learning cards, so a
learning card's interval exports as 0. Export now pages its card, schedule and
history queries, so decks larger than the PostgREST row limit (1,000 by default
on hosted Supabase) are no longer at risk of truncation.

## Full-size upload

The app's “10 GB” ceiling is **10 GiB / 10,737,418,240 bytes**. The staging
bucket has this limit, and the actual TUS endpoint accepted creation of an
upload at exactly that size.

Run `pnpm launch:anki-large-upload <path-to-synthetic-input.apkg>` using the
fixture generated above. This creates an exact-size sparse ZIP64 archive
containing the real small collection plus an unreferenced zero-filled member.
It sends all bytes through the same TUS endpoint and 6 MiB chunk size used by
the app, pauses after 12 MiB is acknowledged, verifies the saved server offset,
resumes, and checks the final byte count. It then enqueues the import through
the app API and executes the actual worker download/import function for only
that fixture job. The local upload file is removed before the worker downloads
its copy to keep scratch-disk usage bounded.

This tests transport size and ZIP64 worker handling. It does not establish
capacity for a 10 GiB SQLite collection, millions of cards, or a library of
10 GiB of referenced media. It exercises the API and storage protocol, not
the browser file-picker/progress UI. A hosted worker's continuous polling and
production configuration require separate deployment verification.

Completed full-size results:

| Check | Result |
|---|---|
| Exact-size local ZIP64 worker parsing | Pass: six notes and six schedules |
| Pause/resume | Pass: server retained the acknowledged 12 MiB offset |
| Full TUS transfer | Pass: server acknowledged all 10,737,418,240 bytes; 3,179.446 seconds (53 minutes) |
| API enqueue selects standalone worker | Pass: `inline: false` |
| Worker download and import | Pass: job `ready`, six notes, six schedules, one suspended card; 1,203.397 seconds (20 minutes) |
| Cleanup | Runner completed without cleanup errors; large local fixture and worker scratch file removed |

Evidence: `test-results/anki-large-upload-2026-10-01T18-03-34.233Z/report.json`.
The full transfer plus worker processing took about 73 minutes on this connection.

Repeated October 13 with the review-history import in place: all four checks
passed again (transfer 2,924.665 seconds, worker download/import 1,198.021
seconds, six review-log rows imported, cleanup clean). Evidence:
`test-results/anki-large-upload-2026-10-13T01-13-38.456Z/report.json`.

The 10 GB upload feature passed this staging acceptance test. Anki progress
import/export passed the round-trip checks above on October 12.

## Export jobs (downloads)

The synchronous `POST /api/export` builds the whole package in memory and
returns it as one response body. Measured locally it needs roughly the
package size again in memory (a 4 GiB package built in 17 seconds on a 16 GB
machine), but production runs on Vercel functions with 2 GB of memory, a
300-second limit and a 4.5 MB cap on non-streamed response bodies, so any
media-bearing deck of more than a few MB is expected to fail there. The web
client also buffered the whole file (`res.blob()`, 180-second abort) and the
mobile client base64-encoded it through a `FileReader`.

Exports now run as jobs (`anki_export_jobs`, `apkg-exports` bucket):

- `POST /api/export/enqueue` records the job. Decks without images (up to
  20,000 cards) are packaged inline in `after()`; decks with media stay
  `pending` for the worker, which handles them when no import is queued.
- The package is written to scratch disk by `@deephaus/anki-export`: each
  image streams from storage straight into a ZIP64 entry, one at a time, and
  the collection is built last. Memory stays constant regardless of media
  volume. The file is then uploaded with a resumable TUS upload.
- `GET /api/export/jobs/[id]` reports phase and progress (loading, media,
  packaging, uploading); `GET /api/export/jobs/[id]/download` mints a signed
  URL with the deck filename, so the browser or the mobile download task
  shows its own progress and nothing passes through a function.
- Finished exports expire after 24 hours; the worker removes the object and
  marks the job `expired`.

Run `pnpm launch:anki-check` for the job path on a small deck, and
`node scripts/launch/anki-large-export.mjs [--media-count N --media-bytes B]`
for a media-heavy trial: it seeds a deck whose cards reference N image objects
in `card-media`, runs the worker's export processor, downloads the signed URL
with progress, validates the archive with Python's `zipfile` (ZIP64), parses it
with the worker's reader, exercises the expiry sweep and removes everything it
created. Results:

10 GiB export trial, October 13, launch-staging: 2,560 incompressible 4 MiB
images (10,737,418,240 bytes) referenced by 2,560 cards.

| Check | Result |
|---|---|
| Seed media | Pass: 2,560 objects in `card-media`, 1,662 seconds |
| Worker export job | Pass: 2,560 of 2,560 images bundled, 0 skipped; 10,737,998,079-byte package; 3,529 seconds (about 10 minutes packaging, 49 minutes resumable upload) |
| Scratch file removed after upload | Pass |
| Signed URL download with progress | Pass: all 10,737,998,079 bytes, `Content-Length` matched, `attachment` disposition with the deck filename; 1,501 seconds |
| Archive integrity | Pass: Python `zipfile` read all 2,562 entries (ZIP64) and verified every CRC |
| Worker reader parses the collection | Pass: 2,560 notes and cards |
| Expired export swept | Pass: job marked `expired`, object removed |
| Cleanup | Pass: media, export and synthetic account removed |

Evidence: `test-results/anki-large-export-2026-10-13T23-24-48.554Z/report.json`.

Bugs this trial found and fixed:

- **Upload limit.** The package for a 10 GiB deck is slightly over 10 GiB,
  and storage rejected it (HTTP 413). The `apkg-exports` bucket allows 11 GiB,
  and the project's **global** Storage file size limit must be at least
  11 GB. It was raised on launch-staging; production needs the same setting
  before release.
- **Images silently dropped (1,332 of 2,560 in the first full run).** Node's
  `fetch` cancels an unlocked response body when its `Response` is
  garbage-collected; prefetched images waited unread and arrived empty. A
  regression test reproduces it with forced GC.
- **Images lost to dropped connections (4 of 2,560 in the second run).**
  Retries only covered failures before a body started. Each image is now
  downloaded whole and checked against `Content-Length` before it is written,
  with four attempts, so a drop anywhere is retried and a truncated image can
  never be packaged. Skipped images are logged with the reason.
