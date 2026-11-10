# DeepHaus adversarial QA report

Date: 10 November 2026  
Reviewed commit: `09b584ea56fb6a2eb1cbe05637874bc2c3f918ea`  
Deliverable: investigation and reproduction material for Claude; application source has not been fixed.

## Assessment

Found **eight reproducible product defects** and **one significant regression-test maintenance defect**. The most serious product issue silently changes imported learning material. Three independent layout defects affect narrow browser windows. Desktop offline recovery loses the current route. Deck creation lacks validation and returns internal errors for malformed requests.

The passing results provide useful evidence for existing scheduling, isolation, persistence and recovery behavior. They do not establish that every feature or platform is bug-free. Native iOS/Android interactive coverage remains incomplete because device tooling failed; mobile browser resizing is not a substitute for native testing.

## Prioritized work list

| ID | Priority | Finding | Observed surface |
|---|---|---|---|
| F01 | P1 | Quizlet import removes literal quotes and can merge separate cards | Local production API; shared web import backend |
| F02 | P2 | Malformed import rows disappear without a warning or rejection | Local production API and import preview logic |
| F03 | P2 | Deck creation accepts blank, oversized and non-string names | Local production API; corrupted values visible in UI |
| F04 | P2 | Invalid JSON/body shapes produce HTTP 500 and expose internal errors | Local production API |
| F05 | P2 | Expanded sidebar consumes nearly the entire narrow viewport | Local production browser, 320px |
| F06 | P2 | Study header clips controls and footer controls overlap counters | Local production and hosted staging browser, 320px |
| F07 | P2 | Easy Days labels overlap neighboring day buttons | Local production browser, 390px, sidebar collapsed |
| F08 | P2 | Desktop Retry returns to startup route rather than interrupted route | Electron desktop on macOS |
| T01 | P2 | Current E2E selectors no longer match Settings, Cards or account navigation | Repository Playwright suite |

P1 means high-impact data integrity work to address first. P2 means a functional/usability defect or an important validation gap. These are proposed engineering priorities, not claims of production incident severity.

## Confirmed product defects

### F01 — Quizlet import changes literal quotes and merges cards

**Impact:** imported questions/answers no longer match the source. A quote in the middle of an otherwise ordinary TSV field can absorb the next card into the current answer. The endpoint reports success, so a student can study corrupted material without realizing it.

**Reproduce:** sign into an isolated account, open the Quizlet importer, and paste the following. Each visible separation between columns below is one literal tab.

```text
1	First
2	A 6" ruler
3	Third
```

Alternatively, authenticated `POST /api/import/quizlet` with JSON:

```json
{"deck_name":"QA import quotes","content":"1\tFirst\n2\tA 6\" ruler\n3\tThird"}
```

**Actual:** HTTP 201, `cardsImported: 2`. The second card's answer becomes `A 6 ruler<br>3\tThird`; the third card has merged into it. Separately, `What is "DNA"?\tA molecule\nSecond\tAnswer` imports two cards but stores `What is DNA?`; `He said "hi".\tGreeting` stores `He said hi.`.

**Expected:** preserve literal quotation marks in Quizlet's raw tab-separated export. A malformed CSV quoting state should be explicitly diagnosed rather than silently consuming subsequent records.

**Source:** `apps/web/src/lib/import/quizlet.ts:14`, especially the unconditional quote-state toggle at line 23. Every quote toggles the parser's quoted state, even inside an unquoted field. `apps/web/src/app/api/import/quizlet/route.ts:52` persists the resulting cards. Native clients using this endpoint inherit the backend defect; native reproduction itself was blocked.

**Acceptance checks:** exact text preservation for quotes inside TSV terms/definitions, inches (`6"`), quotes in the middle of a field, CRLF, Unicode, BOM, trailing newline, valid quoted CSV commas, escaped CSV quotes and valid multiline CSV. Assert both card count and every persisted front/back value. An invalid quoting state must not return a misleading successful partial import.

**Evidence:** [persisted import results](evidence/import-integrity.json), [API responses](evidence/api-probe.json).

### F02 — Partial imports silently discard malformed rows

**Reproduce:** import `1\tFirst\n2\t\n3\tThird`, or `term\tdef\nbroken line\nsecond\tanswer`.

**Actual:** HTTP 201 and two imported cards. The incomplete middle record disappears. Neither the response nor the UI offers rejected-row numbers/reasons. The UI's preview uses the same filtering parser, so its displayed count already hides the loss.

**Expected:** reject incomplete nonblank records with actionable line numbers, or clearly show a partial-import warning and let the user review/accept skipped records. Intentionally blank separator lines can be handled separately.

**Source:** `apps/web/src/lib/import/quizlet.ts:79` filters invalid records; `apps/web/src/components/quizlet-import-view.tsx:35` computes its count from that filtered result; `apps/web/src/app/api/import/quizlet/route.ts:131` reports only the imported count.

**Acceptance checks:** blank term, blank definition, one-column middle row, mixed valid/invalid records, and blank separator lines. A successful import must account for every nonblank input record. Keep this separate from F01's quote interpretation when adding regression cases.

**Evidence:** [import-integrity.json](evidence/import-integrity.json), [api-probe.json](evidence/api-probe.json).

### F03 — Deck creation lacks input validation

**Reproduce:** send authenticated `POST /api/projects` with any of these bodies:

```json
{"name":"","deck_name":""}
{"name":"   ","deck_name":"   "}
{"name":{"bad":true},"deck_name":42}
```

Also try 121-character names.

**Actual:** all returned HTTP 201 and inserted a project. Object/number values were stored as text (`{"bad":true}` and `42`). Blank/whitespace decks subsequently appeared as an untitled or blank entry in the exam deck picker. The 121-character name also persisted.

**Expected:** string names with an explicit length limit, trimming and a clear policy for optional display names. Invalid input should return 400/422 and insert nothing. Align creation, rename and import rules; PATCH currently validates strings with a 1–120 character limit, while its lack of trimming should also be reviewed.

**Source:** `apps/web/src/app/api/projects/route.ts:21` directly consumes `request.json()` and inserts `body.name`/`body.deck_name` at line 42. Compare `apps/web/src/app/api/projects/[id]/route.ts:31`.

**Acceptance checks:** missing, null, whitespace-only, wrong types, 1/120/121 characters, Unicode, and malformed settings. Verify no row exists after rejected requests. Keep valid existing client creation payloads working.

**Evidence:** [API payloads and stored responses](evidence/api-probe.json).

### F04 — Malformed input returns 500 with internal implementation details

**Reproduce:** authenticated `POST /api/projects` with literal body `{`, JSON `null`, and JSON `{}`.

**Actual:** HTTP 500 responses respectively exposed JSON parser syntax details, `Cannot read properties of null (reading 'settings')`, and `null value in column "name" of relation "projects" violates not-null constraint`.

**Expected:** malformed JSON and invalid request shapes are client errors with a stable, understandable 400/422 response. Unexpected server errors should return a generic message while detailed diagnostics remain in server logs.

**Source:** request parsing/validation in `apps/web/src/app/api/projects/route.ts:25`; the catch-all in `apps/web/src/lib/perf/with-api-timing.ts:47` sends arbitrary `Error.message` back to the caller at line 50. Review this shared behavior for other wrapped routes. This proves internal-error disclosure, not a demonstrated secret leak or authorization bypass.

**Acceptance checks:** bad JSON, wrong content shape and simulated unexpected server/database failures; verify status, public error shape, server logging, and absence of raw internal exception messages.

**Evidence:** [API responses](evidence/api-probe.json).

### F05 — Expanded sidebar makes narrow pages effectively unusable

**Reproduce:** use a fresh browser profile (no stored sidebar collapse preference), sign in, set viewport to 320 × 568, open `/dashboard`. The same state affects Settings.

**Actual:** expanded navigation remains 272 CSS pixels wide, leaving a 48px main column. Primary content compresses/clips and controls extend beyond the available area. Manually collapsing the sidebar recovers space, but there is no responsive default/overlay behavior for a fresh narrow session.

**Expected:** a usable main view at narrow widths, with a suitable navigation drawer/overlay or automatic collapse and an accessible reopen control. Preserve the user's desktop preference without letting it break a narrow viewport.

**Source:** `apps/web/src/components/sidebar.tsx:68`, line 254 and the animated width at line 296. The collapsed decision uses stored preference/study-session status, with no viewport decision. The app shell keeps the sidebar alongside a shrinking main region.

**Acceptance checks:** fresh and existing profiles at 320, 375, 390, 768 and desktop widths; switching between them; expanded/collapsed navigation; keyboard navigation; browser zoom. Test dashboard, create, decks, cards, exams and Settings. Make sure main actions remain visible/reachable.

**Evidence:** [320px expanded dashboard](evidence/dashboard-320px-expanded.png).

### F06 — Study controls clip/overlap at 320px even with collapsed navigation

**Reproduce:** open a deck study session at 320 × 568 with the 55px collapsed sidebar. Inspect the header and footer before/after revealing the answer.

**Actual:** the header's More button extends beyond the right edge (observed x=307–339 against a 320px viewport). In the footer, Undo occupied x≈73–123, the center counters x≈112–263, and Redo x≈254–302. Both button labels overlap the center counters. This reproduced on hosted staging and the locally built reviewed code.

**Expected:** all actions remain visible and independently readable/clickable. Use a responsive arrangement for compact headers and session metadata; do not rely solely on shortening the deck title.

**Source:** `apps/web/src/components/study/study.css:21` lays out fixed controls in one flex row. The footer's three-column layout at line 75 combines narrow outer columns with a nonwrapping center at line 78.

**Acceptance checks:** 320px and 390px; long deck names; Hint/Explain states; answer hidden/revealed; enabled/disabled Undo and Redo; larger counts and increased font size. Check actual bounding boxes as well as screenshots.

**Evidence:** [local production 320px](evidence/study-320px-local.png), [hosted staging 320px](evidence/study-320px-hosted.png).

### F07 — Easy Days labels overlap at ordinary mobile width

**Reproduce:** collapse the sidebar, set viewport to 390 × 844, open `/settings/study`, choose Weekend warrior.

**Actual:** each day button is approximately 33px wide, while `Normal` and `Reduced` exceed that width. Labels run directly into neighboring buttons; the final Reduced label spills to the right. This is independent of the expanded-sidebar defect. The setting itself saved successfully and survived navigation/reload.

**Expected:** readable, separated day states at narrow widths. Reflow the controls or provide an intentional compact representation while keeping full accessible labels.

**Source:** `apps/web/src/components/easy-days-settings.css:1` forces seven equal columns with no narrow-layout adjustment; line 2 leaves long text able to overflow.

**Acceptance checks:** 320/375/390px with every state (Normal, Reduced, Minimum), weekend preset, custom state, validation warning and Save bar. Verify 200% text size and touch-target usability.

**Evidence:** [390px screenshot](evidence/easy-days-390px.png).

### F08 — Desktop offline Retry loses the current route

**Reproduce:** launch the desktop app with an isolated user-data directory and a test HTTP origin. Start at `/dashboard`, navigate in-page to `/decks/qa-current?tab=cards`, stop the origin, reload, restart the origin, then click Retry on the bundled offline page.

**Actual:** Retry loads `/dashboard`, rather than `/decks/qa-current?tab=cards`. The app remembers the in-page route in `state.lastPath` but retries the stale `pendingPath` captured at startup.

**Expected:** Retry returns to the interrupted current route, including its query string. Preserve the existing navigation/origin checks and distinguish intentional new navigation from retrying a failed load.

**Source:** `apps/desktop/src/main/window.ts:152` and line 158 update `state.lastPath`; line 163 initializes `pendingPath`; the failure handler at line 166 does not update the retry target; `loadApp` defaults to it at line 173. `apps/desktop/src/main/index.ts` handles retry by calling `loadApp()` without a path.

**Acceptance checks:** initial offline launch, in-page navigation followed by failed reload, full navigation failures, query strings, deep links, and reconnect/retry. Keep desktop bridge isolation tests passing.

**Evidence:** [desktop-adversarial.json](evidence/desktop-adversarial.json), runnable [desktop scenario](regression/desktop-adversarial.mjs). The scenario needs the desktop app built first and runs against its own temporary HTTP server/profile.

## Regression-suite defect

### T01 — UI redesign left important E2E journeys unable to reach their assertions

Repository tests failed against the current app for these independently verified selector mismatches:

- `e2e/web/fixtures.ts:28`: Cards are now `.dh-bench-row` elements, not elements with role `row`. The card is present and its editor is visible while the old locator times out.
- `e2e/web/fixtures.ts:34`: Sign out is under the account menu, rather than an always-visible button.
- `e2e/web/fixtures.ts:40`: Settings is now a full page, rather than a `dialog`. Offline downloads is a navigation link and its library is a labeled `section`/region, not a complementary landmark.
- `e2e/web/easy-days.spec.ts:27`: `/dashboard?settings=study` redirects to `/settings/study`. Weekend warrior still exists, but the expected dialog does not. The day controls are buttons, not sliders.
- `e2e/web/offline-study.spec.ts`: the generated test label appears in both the study header and card content, producing a strict-locator ambiguity after the earlier selector issues are corrected.

Several `finally` blocks then attempt cleanup with a closed request/page context, masking the original timeout. Make cleanup resilient and independent where needed, without swallowing the actual test failure.

**Temporary adaptations, stored only under this report:** updated navigation/selectors and the offline journey's page transitions; no application implementation changes. They preserve the interrupted-save, scheduling, media and cross-account assertions. Four draft/account tests and both media/offline journeys passed after these adaptations. See [regression/README.md](regression/README.md) and [adapted test sources](regression/).

**Acceptance checks for Claude:** update the official fixtures/specs to current product behavior; rerun all original journeys. Add durable accessible list semantics or deliberate test hooks rather than relying indefinitely on CSS classes. Add layout assertions that actually exercise the current full-page Settings UI. Do not declare the old timeout failures to be demonstrated data-loss bugs.

## What was tested and passed

Counts below describe individual commands/suites; some coverage overlaps, so they should not be summed into a unique-test total.

| Check | Result |
|---|---|
| Frozen-lockfile dependency installation | Passed |
| Build all 11 workspace packages under `packages/` | Passed |
| Workspace typecheck | Passed: 28 tasks; 25 cached, 3 executed |
| Web Vitest | 104 files, 602 tests passed |
| Launch Node security/schema/reconciliation tests | 84 passed |
| Launch Vitest, including mobile/shared behavior | 42 files, 267 tests passed |
| Local database tests | 45 passed |
| Desktop shell tests | 12 passed |
| Production staging web build | Passed; 107 static pages generated |
| Unmodified selected web E2E | 5 passed, 1 stale-Settings failure, 1 flag-dependent skip |
| Unmodified production offline/SW selection | 3 passed, 2 stale-Settings failures |
| Unmodified network-only draft selection | 3 stale-card-row failures |
| Temporarily adapted network-only draft/account selection | 4 passed |
| Temporarily adapted PowerSync media journey | 1 passed |
| Temporarily adapted production offline restart/review journey | 1 passed |
| Desktop adversarial recovery | Reproduced F08; external file URL rejection and renderer isolation passed |
| API adversarial sample | 43 requests, plus follow-up import readback requests; findings above |

The 602-test web run and 267-test launch rerun used `--maxWorkers=2`. Initial concurrent runs encountered unresolved workspace builds and PDF/FSRS timeouts while the machine was heavily loaded. After building dependencies and reducing concurrency, these suites passed. Those transient setup/load failures are not reported as product defects.

Live/manual checks included:

- Fresh isolated sign-in; dashboard and navigation at desktop/narrow sizes.
- Quizlet paste import, opening the imported deck, Unicode/emoji rendering and literal script text remaining inert.
- Study reveal/Good grading and Undo/Redo restoring the expected card and new-card count.
- Card browsing, search, editor opening and suspend control.
- Exam creation, deck selection, forecast/detail rendering for a four-card deck.
- Study settings preset/save persistence and invalid settings/exam API payload rejection.
- Missing and forged credentials across eight API routes: all 16 requests returned 401.
- Existing cross-account read/write rejection and draft isolation gates.
- Synthetic library rendering at 1k/10k/50k cards; this is not a real 50k-card backend load test.
- Media cache persistence, quota/eviction recovery, actual staging replica downloads and offline rendering.
- Production service-worker cached pages/fallback, exclusion of API-response caching and in-place reconnect behavior.
- Two-session offline-answer reconciliation/retry/undo, plus cold page restart and exactly-once upload of one offline review.
- Electron bridge/menu/fresh offline fallback checks and the additional failed-reload/retry scenario.

Useful logs: [web unit](evidence/web-unit.txt), [launch unit](evidence/launch-unit.txt), [local database](evidence/local-db.txt), [desktop](evidence/desktop.txt), [original E2E](evidence/e2e-original.txt), [original offline](evidence/offline-original.txt), [original drafts](evidence/drafts-original.txt), [adapted drafts](evidence/drafts-adapted.txt), [adapted media](evidence/media-adapted.txt), [adapted offline](evidence/offline-adapted.txt).

## Environment and coverage limits

The exact reviewed code ran locally in a production Next.js build at port 3100 against the isolated launch-staging Supabase/PowerSync backend. Network-only draft testing used the development configuration at port 3101. Initial live browser exploration also used `deephaus-staging.vercel.app`; findings attributed to reviewed source were reproduced locally. No production customer data was deliberately modified. A disposable QA account/decks were used for adversarial API/import/manual workflows; the repository's existing isolated launch fixtures were used for automated journeys.

**iOS blocker:** the local iPhone simulator and installed staging app were found and the app launch succeeded. The device command's interactive snapshot failed with `daemon_transport_timeout`; retrying once with its advised debug mode also timed out. Native taps, keyboard flows, rotation, safe areas, OS permission prompts and lifecycle recovery therefore were not verified.

**Android blocker:** opening the emulator failed, then the advised refresh/retry reported: `Android emulator video needs working ffmpeg with the libx264 encoder. Install it on the device host's PATH or set SERVE_EMU_FFMPEG there, then retry opening the emulator.` Native Android interactive testing was unavailable. The host needs its video dependency/device service repaired before rerunning those journeys.

Desktop runtime coverage was macOS Electron, not packaged Windows/Linux builds. Browser coverage was the preview Chromium environment and Chromium Playwright, not Safari/Firefox or a physical phone. Viewport checks change CSS dimensions and do not emulate native touch/keyboard behavior.

Not completed end to end: store purchases/restore/refunds, real payment sandbox checkout, push delivery, external OAuth/provider connections, email delivery/password reset, signed desktop updater/installers, large Anki uploads/exports, live AI generation and external extraction workers, physical-device accessibility/screen readers, prolonged load/soak, and real multi-device native sync. Unit/build checks touching these areas do not replace those runtime checks.

## Additional observations for follow-up (not counted as confirmed defects)

1. **Potential account-deletion stall (high-priority verification):** deleting the populated disposable account directly through the staging auth admin API returned 500. The public `DELETE /api/account` correctly returned 202, but its worker was not invoked because other queued work existed. After explicitly removing only this QA account's exams/projects, the same auth deletion succeeded. `apps/web/src/lib/account/deletion.ts` cleans Storage and then calls auth deletion without first removing database content, so repeat the real deletion-worker journey with imported cards, review history and an exam. This may expose a cascade/trigger failure that an empty-account fixture misses; the end-user deletion stall itself was not proven. See [account-deletion-check.json](evidence/account-deletion-check.json) and [cleanup.json](evidence/cleanup.json).
2. **Card-list accessibility:** the keyboard-focusable list is a generic `div` with a label, and focused rows have visual classes but no row/listbox-option semantics or `aria-activedescendant` (`apps/web/src/components/card-browse-view.tsx:660`, `:912`). Arrow-key movement deserves a VoiceOver/NVDA audit to ensure the active card and selection state are announced. A screen-reader session was not performed.
3. **Download pause lifetime:** `apps/web/src/components/offline-library.tsx:66` initializes pause state to false on each full app reload. The adapted media test initially exposed this when its navigation helper used full page loads; the same test passed with current client navigation. Decide whether Pause downloads should persist across reload/restart. No persistent pause promise was established, so this is a product behavior question rather than a counted regression.
4. **Build warnings:** six lint warnings and a missing `metadataBase` warning appeared. Review effect dependencies/cleanup, media captions and social-image URL configuration. The warning alone does not prove a production crash or broken deployed social preview.

## Recommended Claude implementation order

1. Fix import parsing and dropped-row accounting (F01/F02), with persisted-value regression tests before changing parser behavior.
2. Introduce consistent creation/rename validation and safe public error handling (F03/F04).
3. Address the global narrow shell, then study and Easy Days component layouts independently (F05–F07).
4. Correct desktop retry routing and add the interrupted-current-route scenario (F08).
5. Refresh official E2E fixtures, locator specificity and resilient cleanup (T01); use the report's temporary adaptations as a reference, then rerun the official suite.
6. Repair device tooling and complete native verification before treating this as a full cross-platform release sign-off.

The disposable QA account was ultimately removed after scoped manual cleanup; auth lookup returned 404 and its remaining-project count was zero. Known cards/decks created by failed automated tests were also explicitly removed. Test-owned staging cleanup is recorded in [cleanup.json](evidence/cleanup.json). Raw Playwright traces contain session/request data and are deliberately excluded from this handoff. No credentials are required in this report or its reproduction sources.
