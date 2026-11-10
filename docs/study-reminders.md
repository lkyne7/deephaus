# Study reminders

How DeepHaus decides when to nudge a student, and how the nudge reaches them.

Status (10 November 2026): released to production with PR #69 for browsers and the desktop app; the migration is on staging and production. Two things are still missing there. No VAPID keys are configured on either Vercel project, so browser push is off until they are. The production extraction worker has not been redeployed, so nothing calls the dispatcher and no reminder is sent yet. The phone is not covered; see "Not built yet". What has and has not been tried is under "What was tested".

## The idea

Nothing is scheduled ahead of time. Once a minute a dispatcher asks, for each student who is due a look, "what reminder is due right now?" from their current state. A session finished on another device, an exam that moved, or cards already studied are therefore always taken into account, and there is nothing to cancel.

The rules are one pure function, `chooseReminder` in `packages/scheduling/src/reminders.ts`, with its tests beside it in `packages/scheduling/test/reminders.test.ts`.

## What gets sent

| Reminder | When | Opens |
|---|---|---|
| Exam session | At one of the exam's study times (or the daily time, if it has none), when exam cards are ready | The exam's session |
| Behind | Instead of the exam session reminder, when the plan is heading more than 5 points under its target | The exam's session |
| Next pass | With an exam inside 48 hours: cards are ready again, the student has studied today, and it is 90 minutes since their last review | The exam's session |
| Lock-in | The evening before an exam (from 17:00, within 30 hours of it), once | The exam's session |
| Warm-up | Between 3 hours and 20 minutes before an exam, once | The exam's session |
| Daily reviews | At the daily time, when regular cards are due and nothing has been studied today | The combined session |

## What holds a reminder back

- **Quiet hours:** 22:00 to 08:00 by default, in the student's own timezone.
- **Just studied:** nothing within 10 minutes of a review.
- **Spacing:** at least an hour between reminders.
- **Daily cap:** two a day, four when an exam is within two days. The day is the study day, not midnight to midnight.
- **Once per occasion:** each reminder has a key for its occasion (for example `exam_session:<exam>:2026-11-09:1140`) and the log is unique on it, so two dispatcher runs that agree send it once.
- **Ignored reminders:** after three in a row of one kind go unopened, that kind is sent half as often until one is opened. The evening-before and warm-up reminders are exempt.

## How it runs

- **Trigger:** a loop in the extraction worker (`apps/extraction-worker/src/reminder-dispatch-worker.ts`) POSTs to `/api/internal/notifications/dispatch` once a minute with the worker secret, like the account-deletion loop. Hosted staging has no Render workers, so reminders only run there while `node scripts/environments/dev.mjs extraction --hosted` is running on a Mac.
- **Who is looked at:** `claim_reminder_checks` returns students who have a device switched on and whose `notification_state.next_check_at` has passed, and marks each as taken for five minutes. After looking, the dispatcher sets the next time: five minutes on, or the end of quiet hours, or the next study day once the cap is spent.
- **Delivery:**
  - Browser: Web Push, signed with a VAPID key pair, shown by the service worker (`apps/web/src/app/sw.ts`). A subscription the push service reports as gone is deleted, unless it was registered in the last two minutes (see "What was tested"), and each rejection is logged with its status and the push service's host (never the endpoint, which is a secret).
  - Desktop app: the shell has no push service, so while it is open the page asks `/api/notifications/pending` once a minute and shows what it gets through the native `notify` bridge. A test reminder sent from Settings is collected at once.
- **Keeping devices in step:** once per app load, a device with reminders on registers itself again (`ReminderDeviceSync`). That keeps its time zone current, picks up a subscription the browser renewed, and restores a row the server deleted.
- **One tag per reminder:** each notification gets its own tag. With one shared tag, Chrome on macOS did not show every other notification after the previous one had been closed, and a clicked reminder is always closed. The cost is that unread reminders can sit side by side instead of replacing each other; the daily cap keeps that to a few.
- **Opened:** clicking a reminder marks it opened (`PATCH /api/notifications/{id}`), which is what the ignored-reminder rule reads.

## Tables (`20261109150000_study_reminders.sql`)

| Table | Holds |
|---|---|
| `push_devices` | Where a student can be reached. One row per browser or app, whoever is signed in on it. |
| `notification_prefs` | What a student allows, the daily time, quiet hours and the timezone their devices report. No row means the defaults. |
| `notification_log` | Every reminder sent. Students can read their own and mark them opened or shown, nothing else. |
| `notification_state` | When each student is next worth evaluating. Dispatcher only. |

## Setting it up

Browser push needs a VAPID key pair, generated once per environment:

```bash
npx web-push generate-vapid-keys
```

Set these where the web app runs (Vercel for staging and production, `.env.launch-staging.local` for local development):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The public key |
| `VAPID_PRIVATE_KEY` | The private key |
| `VAPID_SUBJECT` | `mailto:` address the push service can contact (optional; defaults to support@deephaus.ai) |

Without them browser push is off and the Reminders settings say this browser can't show reminders; the desktop path still works. The service worker is disabled in development builds, so browser push can only be tried in a production build.

The worker needs no new settings, only a redeploy to pick up the new loop.

## Asking for permission

The browser's permission prompt appears only after the student chooses "Turn on reminders", either in Settings → Reminders or in the note on an active exam's page. It is never shown on page load. "Not now" on the exam page hides the note for good on that browser.

## What was tested

On staging, 9 November 2026, from a local build of this branch:

- **Desktop app path, in a browser with the desktop bridge stubbed:** turning reminders on from the exam page, the settings page, a test reminder shown once and marked shown, a click recorded as opened and taken to the right page, turning the device off.
- **Dispatcher:** a real pass sent an exam reminder ("E2E Psychology midterm is in 7 days · Ready now: 1 card · about 1 min"), the open app showed it and the click opened the exam session. Looked at again, nothing was sent. Nothing is sent, and the student is skipped, with reminders off or no device; in quiet hours the next look is set to when they end. A wrong secret gets 401.
- **Permissions:** as a signed-in student, inserting, rewriting or deleting a reminder, reading the dispatcher's state and calling `claim_reminder_checks` are all refused; marking your own reminder opened works; another account sees nothing.
- **Browser push, production build with a throwaway key pair:** in real Chrome (headless), Settings → Turn on subscribed with Google's push service, a test reminder arrived and was shown about a second after it was sent, and Turn off unsubscribed and removed the device. Against a stand-in push service the request was checked directly: signed, encrypted, one hour to live, and the decrypted payload was the reminder. A subscription answered with 410 was removed (this was before new devices were given two minutes' grace; that rule is covered by a unit test only).

Not tried: a click on a browser notification (it cannot be produced by a script), Firefox and Safari, the installed desktop app itself, the worker loop running against a deployed site, and anything on the phone.

Two things seen with a brand-new subscription, both in the first couple of seconds after the browser subscribes, while its connection to Google's push service is still coming up:

- A reminder that was accepted can arrive late or not at all. Settings cannot know about that; send the test again.
- The push service sometimes answered "gone" (410) and then accepted the same subscription seconds later. That is why a device registered in the last two minutes is not deleted on "gone", why Settings says when a test did not get through, and why the device registers itself again on the next load.

After those first seconds, every reminder sent to a subscribed Chrome arrived within about a second (five of five, twice).

## Not built yet

- **Phone push.** It needs the push capability on the App ID, an APNs key in EAS, the `aps-environment` entitlement in the checked-in iOS project and the `expo-notifications` native module, then a new build. The tables already accept an `ios` device, and the dispatcher reports such a device as unsupported rather than failing.
- **An exam-day Live Activity**, and an email fallback.
