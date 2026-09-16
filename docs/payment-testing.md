# Payment testing

## September 14, 2026

Both clients use RevenueCat. The web currently uses its Stripe integration; the simulator uses RevenueCat Test Store.

### Verified

- Native development build opens successfully with the Test Store key. Release builds intentionally reject this key; the staging launcher now prevents that combination.
- Simulated Plus monthly purchase succeeded for the isolated native fixture. RevenueCat delivered event `5F74D3C0-68C4-4206-BD04-79E512D214AB` to the temporary staging webhook; its response was HTTP 200 with `ignored:false` and `duplicate:false`.
- Staging `billing_accounts` reports `plus`, `active`, `test_store`, `sandbox`. After restore, the iOS screen displays Plus, active renewal, and 3,000 credits.
- The Test Store failed-purchase option returned an error and left the account Basic before the successful purchase. The development console also displays RevenueCat's expected simulated-failure log.
- App restart preserved Plus and 3,000 credits. Cancelling the annual Test Store dialog preserved the existing monthly entitlement.
- Maestro restore journey passed: “Purchases restored.” and active server status.
- Web displays all four enabled plan choices. Actual Stripe checkout is blocked, as detailed below.
- Relay and sandbox-configuration tests: **6 passed**. Earlier web billing tests: **23 passed**; native billing contract tests: **8 passed**; mobile TypeScript passed.

No real payment was charged. Test Store results do **not** validate Apple's purchase sheet or Stripe checkout.

### Web checkout blocker

RevenueCat returns HTTP 422/code 8142. Stripe test request `req_7TKaNW4DlW89y3` confirms that price `price_1TvzuCCszHMOTo2Z2c9Ranj1` exists in live mode, while the request uses a test key. Use separate sandbox products and a dedicated RevenueCat Stripe configuration; preserve the live offering mappings. See [RevenueCat Stripe integration](https://www.revenuecat.com/docs/web/integrations/stripe).

A dedicated payment fixture with an `@example.com` address was created because RevenueCat rejected the existing `@example.test` address (code 7012). Its credentials remain in the ignored `.env.launch-payment-fixtures.local`.

### Webhook isolation

With explicit approval, the production webhook was changed to Production only. A separate temporary webhook, “DeepHaus temporary staging payment tests,” sends Sandbox-only events through a bearer-authenticated local relay. The relay forwards only allowlisted staging fixture identities to localhost:3100, ignores other accounts/environments, and exposes no general proxy. The temporary Cloudflare tunnel and relay must run during provider tests and should be removed from service after testing.

## Staging configuration

Set these in the ignored `.env.launch-staging.local` file, then rebuild the relevant staging client:

```dotenv
LAUNCH_BILLING_ENABLED=true
LAUNCH_REVENUECAT_WEB_SANDBOX_KEY=
LAUNCH_REVENUECAT_TEST_STORE_KEY=
```

The web key must be a Web Billing sandbox key (`rcb_sb_`), a Stripe sandbox key (`strp_sb_`), or a Test Store key (`test_`). The default simulator runner accepts only a Test Store key; the explicit `metro-storekit` runner requires the staging Apple key described below. At least one is required when enabled. Existing developer/live client keys are not inherited. Disabled remains the default. Android billing is unchanged.

RevenueCat Test Store can exercise purchase success, failure and cancellation, customer information and entitlements on both clients. It does **not** validate Stripe checkout or Apple's purchase sheet. See [Test Store documentation](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store).

For Stripe-backed checkout, use separate Stripe sandbox products and a dedicated RevenueCat Stripe configuration. RevenueCat Web Billing is a different integration. Actual iOS StoreKit validation requires a matching StoreKit configuration or an App Store/TestFlight sandbox build and remains a separate gate.

## End-to-end checks still to run

1. Separate Stripe sandbox and RevenueCat product/entitlement/offering mappings are complete; preserve this isolation on subsequent runs.
2. Keep the temporary sandbox webhook relay running for provider tests; verify cleanup when testing ends.
3. Web successful checkout and rejected payment verified against the separate Stripe sandbox; browser-Back cancellation verified with a separate Basic fixture. Confirmed Plus/active/sandbox, 3,000 credits and one non-duplicate purchase webhook.
4. Extend verified native purchase/failure/restore coverage with cross-account isolation. `.maestro/payment-restore.yaml` verifies restore and active server status for the already-purchased staging fixture.
5. Verify renewal, cancellation-through-expiry, duplicate webhook delivery and cross-platform entitlement reconciliation using real sandbox events.
6. Record Stripe checkout and StoreKit sandbox evidence separately from Test Store results. Disable staging billing opt-in when testing is finished.

## Separate sandbox and StoreKit preparation

- Created Stripe sandbox **DeepHaus staging**, account `acct_1UFk7EEKKFLT05yW` (separate from live `acct_1Tb4djCszHMOTo2Z`). Created four CAD products: Plus monthly 9.99 (`prod_VGGjy7exh4y8Wi`), Plus annual 99.99 (`prod_VGGk2zCB7zhbys`), Pro monthly 19.99 (`prod_VGGlizHhhTB589`), Pro annual 199.99 (`prod_VGGm0rkqDDJ2DY`).
- Installed RevenueCat into this sandbox with explicit access and terms approval. Connected RevenueCat app `appe814ae1c34` to this sandbox, imported all four prices, attached Plus/Pro entitlements, and added each price to its matching default offering package. Verified existing live Stripe and Test Store mappings were preserved. Replaced the ignored staging web SDK key and rebuilt/restarted port 3100 successfully. The sandbox checkout now displays Plus Monthly at CA$9.99. The declined-card assertion passed with Basic access retained. A successful test purchase then produced a non-duplicate staging webhook (HTTP 200) and server status Plus/active/sandbox with a 3,000-credit allowance. The initial full journey failed only at the final UI lookup because checkout closed the settings route; persistence/restore are checked separately below.
- Created `tests/fixtures/billing/DeepHausStaging.storekit` and exported its public certificate. Xcode recognizes all four subscriptions with Canada storefront and matching periods/prices. Pro ranks above Plus in the same subscription group.
- `node scripts/launch/prepare-storekit.mjs` creates a separate **DeepHaus StoreKit** scheme and **Debug StoreKit** configuration in the generated native project. It requires the existing staging simulator plist produced by `native.mjs build`. Verified `xcodebuild -showBuildSettings`: bundle `com.deephaus.app.staging`, platform `iphonesimulator`, staging plist. Existing production build configurations remain intact.
- Apple in-app purchase key generated/downloaded by the user. The RevenueCat Apple creation form is prepared for `com.deephaus.app.staging`; user credential upload/submission remains pending. Do not store the `.p8` in source control or conversation output.
- After the Apple app is saved, configure its public SDK key in ignored `.env.launch-staging.local` as `LAUNCH_REVENUECAT_APPLE_KEY`. Stop the existing Metro process, start `node scripts/launch/native.mjs metro-storekit`, and launch **DeepHaus StoreKit** from Xcode to activate the StoreKit configuration. Do not infer StoreKit activation from a plain `simctl launch` or `xcodebuild build`.
- Before running purchases, map the four Apple product IDs to Plus/Pro entitlements and offering packages, and upload the local public StoreKit certificate where required by RevenueCat. Purchase/restore/renewal/expiry with Apple StoreKit remain **unverified** until those steps complete.
- Updated billing-key and relay checks: **7 passed**. The default native runner still uses Test Store; Apple keys require the separate explicit StoreKit runner.

### Stripe purchase test execution

The purchase test requires a Basic dedicated payment fixture and stops before checkout if the fixture is already subscribed. Do not reset billing database rows to bypass this guard: the provider subscription remains authoritative. Use a fresh isolated fixture or cancel/expire the sandbox subscription through the provider before another purchase run. For the already-subscribed fixture, run `node scripts/launch/payment-test.mjs -g "persists after reload"`. This avoids creating another subscription while verifying restore and reload. Web checkout cancellation passed with a separate Basic fixture using browser Back. Subscribed accounts correctly show Manage rather than Choose. E2E TypeScript checks pass.

### Apple credential download blocker

Apple marks IAP key `728D3W9287` as downloaded, but no corresponding file was found in Downloads, Desktop, Documents, Codex local storage, temporary folders or Spotlight filename lookup. The only local `.p8` found has a different Key ID (`5MPPYYW949`); its contents were not opened. Do not pair it with `728D3W9287`. Check browser download history; if the file is unavailable, create/download a replacement through a regular browser and use its matching Key ID. No keys were revoked. User entry/submission in RevenueCat remains required.

Web reload and restore verification passed independently for the purchased payment fixture. A dedicated cancellation fixture is stored in ignored `.env.launch-payment-cancellation-fixtures.local`; use `node scripts/launch/payment-test.mjs --cancel-only` to run only the non-purchasing cancellation journey.

Cancellation journey: **1 passed** using `--cancel-only`; browser Back dismisses checkout, re-enables Choose and retains Basic plan/credits after reload. The unnamed X closes the sandbox banner only, so it is not a checkout-cancellation control. Restore/reload journey: **1 passed**. Final E2E TypeScript and launch script syntax checks passed. Decline/success assertions passed in the initial purchase journey; its later UI-navigation assertion failed and was replaced by the separately passing restore/reload journey. No second purchase was submitted. Apple StoreKit remains unverified.

### Apple StoreKit catalog configured

- User saved RevenueCat app `app7bfff4b454` (display name DeepHaus (App Store)) with staging bundle `com.deephaus.app.staging` and replacement IAP key `5WSDH3YRU7`. Public SDK key configured in ignored staging environment. RevenueCat accepts the key format but still reports key/bundle compatibility validation failure; App Store/TestFlight readiness is not established.
- Verified **Certificate added: DeepHausStagingCertificate.cer** in the StoreKit testing framework section.
- Created Apple products matching the local StoreKit file and attached entitlements: Plus monthly `prode5868e9e3c`, Plus annual `prod7f15cbad29`, Pro monthly `prod845f781528`, Pro annual `prodb4dc79dc3b`. All four are saved in the corresponding default offering packages. Existing Stripe and Test Store mappings remain present.
- Restarted Metro on 8083 with the explicit `metro-storekit` environment. Billing configuration checks: 6 passed.
- Xcode native UI selection did not switch from DeepHaus to DeepHaus StoreKit despite attempted selection. The unintended ordinary build was canceled before launch. Requested user select **DeepHaus StoreKit**, **iPhone 17 Pro**, then Run. No Apple purchase has yet been verified. A plain simulator launch would not prove local StoreKit activation.

### StoreKit launch path correction

User selected the correct DeepHaus StoreKit scheme and started its first full build. Xcode reported the StoreKit file reference resolved one directory too high. Corrected both the generated scheme and prepare-storekit.mjs from ../../DeepHausStaging.storekit to ../DeepHausStaging.storekit, relative to DeepHaus.xcodeproj. Parsed the XML and verified the resolved file exists in apps/mobile/ios. Purchase testing remains pending until this build launches with the corrected configuration.

The first StoreKit build then exposed missing module maps because CocoaPods had no Debug StoreKit configuration. Added an explicit Debug StoreKit => debug project mapping in Podfile and the preparation script, then ran pod install successfully. Verified 444 StoreKit configuration references in Pods.xcodeproj. Dependency lock change is the Podfile checksum only. Retrying Xcode Run with the corrected pods setup; actual purchase validation is still pending.

### Apple StoreKit execution — September 14, 2026 (Toronto)

The corrected DeepHaus StoreKit scheme built and ran successfully on iPhone 17 Pro. All four Apple products loaded. Plus Monthly displayed CAD 9.99 in the Xcode purchase flow; Subscribe completed with Apple's successful purchase confirmation (Environment: Xcode). No real charge occurred. RevenueCat accepted the StoreKit 2 receipt with HTTP 200 and recorded INITIAL_PURCHASE `98a7d164-1c78-4a3d-b994-25c60daa46ae` for staging Apple app `app7bfff4b454`, APP_STORE/SANDBOX, with expiration October 15. Its dashboard shows Plus active. The sandbox webhook was delivered and the relay returned HTTP 200, non-duplicate, not ignored. Restore also posted a receipt successfully (HTTP 200).

**End-to-end access failed:** authenticated staging `/api/billing/status` still returns Basic/expired and 250 credits. RevenueCat's v1 subscriber response for this fixture returns the old, expired Test Store Plus Monthly subscription (expiration September 15 00:35 UTC), while its dashboard also shows the new active Apple subscription with the same product identifier. The server reconciles from that v1 snapshot rather than the purchase event, explaining the incorrect Basic result. Successful receipt submission and webhook delivery must not be counted as successful entitlement reconciliation or restore.

Next: use a separate StoreKit fixture that has never purchased the identically named Test Store product to isolate the overlap, and address ambiguous multi-store subscriber reconciliation before certifying cross-platform access. Do not manually grant Plus or reset billing rows to conceal this failure. The Apple key/bundle compatibility warning and real App Store sandbox/TestFlight release gates remain unresolved. Earlier preparation/pending-build notes above are superseded by this execution evidence; renewal, cancellation/expiry and restart with correct server access are not yet verified for Apple StoreKit.

### September 15 follow-up — sandbox selection fixed

The earlier hypothesis of an unavoidable same-product collision was incomplete. Repeating the v1 subscriber lookup with `X-Is-Sandbox: true` returns the active Apple Plus entitlement expiring October 15; omitting the header (or using false) returns the expired Test Store entry. The installed RevenueCat iOS SDK also sends this header from its sandbox state. The webhook reconciliation request now explicitly selects sandbox/production from the authenticated webhook's normalized environment. No new API credentials or isolated customer were necessary to resolve this mismatch.

Validation: 12 webhook tests passed, including explicit environment-selection regression cases; web TypeScript and staging production build passed. Restarted local staging on port 3100 with the fix. Reconciled the existing native fixture from the verified active APP_STORE sandbox response, conditional on its original purchase event timestamp to avoid overwriting newer events. Preserved the original webhook event and its deduplication record. Authenticated billing status now confirms Plus/active/sandbox and 3,000 credits. Web restore/reload journey passed again (1 test).

The existing account repair is not evidence of a newly delivered webhook passing end-to-end. A fresh native lifecycle event, restore UI and restart still require simulator validation. Developer commands now report an unaccepted Xcode/Apple SDK license; user review/acceptance requested. Simulator is also unavailable in the current computer-use app inventory. No Apple license was accepted by the agent. Production remains unchanged.

### Xcode 27 native restart and restore verified

After the user opened/accepted Xcode setup, Xcode 27.0 built and launched DeepHaus StoreKit on the existing iPhone 17 Pro / iOS 26.5 simulator. Device Hub now hosts the simulator UI. Profile visibly shows Plus, server active/renews automatically, and 3,000 credits after relaunch. Tapping Restore purchases completed with “Purchases restored.” and retained the active plan and credit allowance.

The previously documented sandbox-header source change was absent at the start of this continuation, so it and environment-selection regression coverage were restored. Webhook suite: 14 passed. Staging production build and web restore/reload journey passed; restarted port 3100 with that build.

The old Cloudflare quick tunnel reported “Unauthorized: Tunnel not found.” Stopped that failed process and attempted replacement, but api.trycloudflare.com returns DNS ENOTFOUND on this Mac. Other provider connectivity (RevenueCat) works. No replacement tunnel was created and the RevenueCat temporary sandbox webhook still points to the expired URL. Fresh purchase/renewal webhook validation remains blocked; restart/restore results above verify the already-reconciled account, not a new webhook. Production settings unchanged.

### September 16 — fresh Apple events pass end to end

Diagnosed the tunnel outage as the original network's DNS filtering: its NXDOMAIN response included a `phish.host.dtq` authority, while Cloudflare DNS returned valid records. User switched to a trusted hotspot; no network protection was overridden. Created a replacement quick tunnel at `https://mambo-ins-flash-phrases.trycloudflare.com/revenuecat` and updated only existing sandbox integration `whintgr9f8865d968`, preserving its authorization and Sandbox-only filter. This remains temporary and depends on the local relay/tunnel processes.

Fixed another billing reliability defect: unavailable subscriber reconciliation previously acknowledged and deduplicated the event, losing the update during provider outages. Lookups now have a 10-second deadline; unavailable responses return HTTP 503 without recording completion, allowing RevenueCat retries. Missing/deleted users retain their existing ignored-event behavior. Regression tests cover 429, 503, network failure, malformed response, timeout, recovery with the same event ID, and duplicate delivery. Webhook suite: **19 passed**. Staging production build (including typecheck) passed, and port 3100 was restarted with this build. Web restore/reload: **1 passed**.

Native StoreKit checks:
- Cancelled the Pro upgrade sheet: Plus/active and 3,000 credits remained, purchase controls recovered.
- Completed the no-charge Xcode Pro Monthly upgrade (CAD 19.99): Apple success confirmation, RevenueCat receipt HTTP 200.
- Real `PRODUCT_CHANGE` event `d6df65c1-8177-4cfe-b8dc-6d18104053c3` and `RENEWAL` event `2705D859-DF9C-4D66-B259-0AB6BE0C4BB8` delivered to the replacement relay, HTTP 200, non-duplicate, not ignored.
- Authenticated staging billing API and native UI both show Pro/active/sandbox, `deephaus_pro_monthly`, and 8,000 credits. No manual account repair was used for this upgrade.
- Native Restore purchases completed and preserved Pro access.
- A locally constructed replay carrying the genuine renewal event ID and timestamp through the public relay returned HTTP 200, `duplicate: true`. This validates deduplication; it is not a provider-initiated redelivery.

The renewal event above was generated by an upgrade, not an independently elapsed renewal period. Scheduled renewal, cancellation-through-expiry, TestFlight/physical-device validation, and the Apple key/bundle compatibility warning remain release gates. Production settings unchanged.

### September 16 — accelerated renewal and cancellation through expiry

In Xcode 27, the renewal setting is visible in the active `.storekit` editor under
**Configuration Settings → Purchase Options → Subscription Renewal Rate**. Selected
and saved **Monthly Renewal Every 30 Seconds**. Existing real-time transactions kept
their original expiry, including after relaunch, so a fresh no-charge Pro Monthly
transaction was created through Xcode's transaction manager.

- Local transaction 2: purchased 21:02:24 UTC, expired 21:02:54 UTC.
- Local transaction 3: automatically purchased 21:02:54 UTC, **Reason: Renewal**,
  expired 21:03:24 UTC. Both receipts posted successfully (HTTP 200) and were finished
  by RevenueCat's SDK.
- Real renewal webhook `9669FCA4-33A1-4CA5-8577-1FFD124FEE84` identifies transaction
  suffix `_3`, purchase time `1789592574000`, expiry `1789592604000`, APP_STORE/SANDBOX.
  RevenueCat's delivery screen and relay both confirm HTTP 200, non-duplicate,
  not ignored. The initial fresh transaction's event is
  `a15c07a9-5a75-47f1-9c58-f1920c88cca4`.
- Cancelled through the StoreKit transaction manager before the next expiry.
  Transaction 3 then showed **Expired** and **Subscription will not renew when expired**.
- Authenticated staging `/api/billing/status` returned Basic/expired, inactive,
  `willRenew: false`, the exact `2026-09-16T21:03:24+00:00` expiry and 250 credits.
  No manual billing-row changes were made.
- Reopened the installed staging iOS app: Profile showed Basic, server expired,
  250 credits. Restore completed with “Purchases restored.” and preserved Basic
  rather than reviving the expired subscription.

This verifies an independently elapsed local renewal and server access removal at
its expiry. No cancellation or expiration webhook was observed in this local
StoreKit run; those Apple sandbox/TestFlight delivery paths remain unverified.

Prepared a distinct native TestFlight archive configuration; details and outstanding
Apple/API prerequisites are in [staging-testflight.md](staging-testflight.md).
11 build-config tests, mobile TypeScript and native staging build-settings checks
passed. CocoaPods install succeeded. No signed archive or upload was attempted.
The simulator rebuild initially hit Xcode's PIF/dependency-graph session error
after refreshing the project. Restarting Xcode resolved it; **DeepHaus StoreKit**
then built and ran successfully on iPhone 17 Pro. The 30-second renewal rate is
also saved in the source StoreKit fixture so regeneration preserves it.

### September 16 — hosted staging and Apple sandbox preparation

Published the separate Vercel project **deephaus-staging** after explicit approval
for deployment, staging server credentials and public API access. Canonical origin:
`https://deephaus-staging.vercel.app`; deployment
`dpl_F86HXCtYnjnrzYwat1RJGHZ8xUe5`. The full hosted build passed. Missing/invalid
bearer tokens are rejected with 401 on billing and cards, and unsigned webhook
requests return 401. Authenticated fixtures return native Basic/expired/250 credits
and web Plus/active/3,000 credits. An authenticated replay of the previously recorded
renewal returns 200 with `duplicate: true`. Details are retained in ignored
`test-results/payment/hosted-staging-verification.json`.

The existing RevenueCat Sandbox-only webhook now targets the hosted API, with its
authorization retained. No dependency on the temporary Cloudflare relay remains
for future provider deliveries. Production Vercel, Supabase and Apple apps were
unchanged. The staging host intentionally has no AI-provider or extraction-worker
credentials; it is prepared for auth, study/sync and billing validation.

Created Apple app **DeepHaus Staging** (`6812905977`), bundle
`com.deephaus.app.staging`, subscription group `22390940`, and all four Plus/Pro
monthly/annual products. Canada availability, CAD pricing, English (Canada)
localizations and two service levels are saved. RevenueCat now reports **Valid
credentials**. Configured the staging Apple's Sandbox Server URL to RevenueCat;
confirmed persistence after reload. No app or subscription was submitted for review.

EAS preview has seven public staging settings; its archive inspection found no
environment files, private signing keys or test artifacts. Added a guarded build
wrapper for local Expo config evaluation. The build now reaches signing but stops
because staging credentials are incomplete; Apple login/2FA has been handed to the
user. No signed build or TestFlight upload has completed.

Later inspection also found delayed provider events from the earlier local
StoreKit transaction 3, received at 21:07 UTC:

- `B923C20F-8639-4649-82C2-65063BDFF130`: **CANCELLATION**, reason UNSUBSCRIBE,
  HTTP 200, `duplicate: false`, `stale: true`, `ignored: false`.
- `7D34A7B8-A5A6-4AD4-92BA-85C78E4EF4C0`: **EXPIRATION**, reason UNSUBSCRIBE,
  HTTP 200, `duplicate: false`, `stale: false`, `ignored: false`.

Both reference the StoreKit test transaction suffix `_3` and its 21:03:24 UTC
expiry. This supersedes the earlier observation that no cancellation/expiration
webhook had arrived. These remain Xcode StoreKit receipts; real Apple sandbox and
TestFlight lifecycle tests are still required.
