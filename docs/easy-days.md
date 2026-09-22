# Easy Days

Users can choose Minimum, Reduced, or Normal review load for each weekday under
**Settings → Study → Easy Days** on web, or the global study settings on mobile.
**Weekend warrior** sets Monday–Friday to Normal and Saturday–Sunday to Reduced.
**Normal week** resets all seven days to Normal. At least one Normal day is required.

## Scheduling behavior

- Preferences are personal and apply across all decks, including decks with their
  own retention target or FSRS parameters.
- Newly scheduled regular reviews may move to nearby days with a higher load
  preference. Existing due cards are not hidden or moved retroactively.
- Short learning/relearning steps and cram plans keep their existing scheduling.
- All Normal preserves the original FSRS behavior exactly.
- Adjustments apply to review intervals of at least three days, within ±10% of the
  original interval (minimum radius one day, maximum three). Grade intervals
  cannot cross. FSRS stability, difficulty, and historical review logs are preserved.
- Relative weights are Minimum 0.05, Reduced 0.5, and Normal 1. A deterministic
  fraction of eligible reviews moves to higher-weight neighboring days; these
  weights are not promises of an exact workload reduction or a day off.
- Weekday calculation uses the saved timezone and study-day rollover hour.
  Clients capture timezone when saving settings. Missing/invalid zones use UTC.
- The shared scheduler handles server reviews, local previews, and offline review
  submissions. Preview and committed schedules use the same deterministic policy.

## Storage and release

`user_study_settings.easy_days` is a seven-element, Monday-first JSONB array.
The database and API validate allowed levels and require at least one Normal day.
Missing or malformed legacy values read as all Normal. Legacy API clients can
update other preferences without resetting Easy Days.

Migration: `supabase/migrations/20260921231436_user_easy_days.sql`.
PowerSync: the owner-scoped `user_study_settings` stream includes `easy_days`;
local SQLite stores the JSON string and parses it into the shared type.

On September 21, 2026, the additive migration and updated sync stream were applied
to the isolated staging environment. A live staging stream checkpoint confirmed
that all seven preferences reached the fixture owner's replica. Production has
not been changed for this feature.

For a future production release, apply the additive migration first, deploy the
updated PowerSync stream, then release the web app and mobile binary. Verify
save/reload and synchronized review scheduling against production after release.

## Verification

- Shared package builds, web/mobile type checks, and web production build.
- Web, launch/schema, and local database regression suites.
- Scheduler tests cover default behavior, timezone/rollover/DST, bounded shifts,
  weekday reduction, grade ordering, and preview/commit agreement.
- SQLite integration test submits an actual local review using synchronized
  preferences and checks the persisted due date and undo snapshots.
- Browser test covers authentication, preset and custom-day save/reload, malformed
  input rejection, compatibility with older clients, and desktop/390px layouts.
- Native mobile code is type-checked. The iPhone 17 Pro simulator (iOS 26.5)
  passed the native Easy Days flow: Weekend warrior selects Reduced for both
  weekend days, the preset survives restart, Wednesday can be set to Minimum,
  and all three custom values survive another restart. API readback and the
  simulator's offline SQLite replica both match the saved preferences.
- Native layout was visually inspected in dark mode. Physical-device and
  Android testing are not included in this verification.

### Repeat the native check

Start local web and mobile development against staging, connect the installed
staging iOS app to Metro, and sign in with the native fixture account. Run
`pnpm launch:native-easy-days`, supplying `MAESTRO_BIN` and
`LAUNCH_SIMULATOR_ID` if needed. `E2E_BASE_URL` can select the local API at port
3000 (default) or 3100. The runner restores the fixture's original preferences
and signs out only its temporary API session. Native screenshots and Maestro
reports are saved under the ignored `.maestro/tests/staging-easy-days` directory.

The flow waits for authentication hydration before navigating after a restart,
and scrolls the Wednesday button below the fixed profile header before tapping.
These are test synchronization/positioning requirements, not application changes.
