# Staging TestFlight acceptance

Use **DeepHaus Staging** (`com.deephaus.app.staging`), backed by
`https://deephaus-staging.vercel.app`. Record the installed version/build and device
model/iOS version. Use a dedicated staging account; never use another person's
library or change production entitlements to make a test pass.

## Installation and basic use

1. Install the processed staging build through TestFlight. Open it without Metro
   or the local API running; hosted services must be sufficient.
2. Complete sign-in/onboarding and create a small deck containing text and an image.
3. Study a card, edit it, reopen the editor and restart the app. Verify saved text,
   library ownership and review counts.
4. Open Profile → Offline downloads. Verify image readiness and pause/resume/check
   controls; the dashboard must have no persistent offline bar.

## Offline and identity

1. Complete initial sync/downloads, enable airplane mode and terminate/reopen the app.
2. Open the image card and grade once. Verify the pending changes survive another restart.
3. Reconnect. Verify the queue drains and the backend records exactly one review.
4. Exercise expired credentials and reauthentication without losing pending work.
5. Test a second account only after pending writes have synced. It must not expose
   the first account's cards, drafts or media. Verify two-device reconciliation
   using the internal account flag before considering global rollout.
6. Check Wi-Fi/cellular policy, low-storage behavior and large image libraries.

## Apple sandbox billing

Record transaction/event IDs and timestamps privately, not account passwords.
For each transition, compare the app, RevenueCat and authenticated server billing
status. Confirm the hosted webhook accepted the corresponding provider event.

1. Fresh subscription: correct product/price, entitlement and credit allowance.
2. Restore and restart: entitlement remains correct without a manual database edit.
3. Upgrade: correct service level; no duplicate credit grant on repeated delivery.
4. Scheduled renewal: fresh transaction and correct expiry/credits.
5. Cancel: access remains until the paid period ends; expiry returns to Basic.
6. Restore after expiry: must not revive the expired subscription.
7. Billing retry/grace and recovery: server and app agree with provider state.
8. Account switching: purchases do not grant unintended access to another account.

## Remaining device/review checks

- Recovery email delivery, cold/warm callback and invalid link handling.
- Google and Apple sign-in, where offered in the submitted app.
- Account deletion using a disposable account; confirm durable backend cleanup.
- VoiceOver focus/speech, keyboard dismissal, large text and iPad layout.
- Capture final screenshots from the official production build after acceptance.

This is a procedure, not a record of completed TestFlight tests. Record results
in [the release checklist](app-store-release-checklist.md) with evidence.
