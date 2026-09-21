# App Store release checklist

Working checklist started September 16, 2026. Production web/backend source is
`0e1d4da`; native submission is a separate release. Older chronological notes in
launch-readiness.md are superseded by later dated evidence.

## 1. Finish offline settings UI

- [x] Remove the persistent banner on web and mobile; retain app-scoped downloads.
- [x] Web visual check, build, typechecks, media download and cold offline review tests.
- [x] Rebuild and verify mobile Profile controls, clean dashboard, and restart persistence.
- [ ] Record final source commit and release the web UI update.

## 2. Signing and staging TestFlight

- [x] Complete staging Apple signing (distribution certificate and provisioning profile created).
- [x] Build and upload staging app: version 1.0.0 build 2; EAS submission finished.
- [x] Confirm Apple processing, tester access and installation (user reported running the TestFlight app).
- [x] Verify archive identity, public hosted staging endpoints and absence of env/private-key files.

## 3. Apple sandbox acceptance

- [ ] Fresh purchase, restore, upgrade, scheduled renewal, cancellation/expiry and billing retry.
- [ ] Verify Apple notifications through RevenueCat to hosted webhook and server entitlements.
- [ ] Verify restart/account isolation without manual entitlement changes.

Xcode StoreKit lifecycle tests have passed; they do not complete this TestFlight gate.

## 4. Native release acceptance

- [ ] Hardware sign-in/onboarding, create/import/study, account deletion and recovery email flow.
- [ ] Offline restart, exactly-once upload, expiry/reauthentication and two-device reconciliation.
- [ ] Wi-Fi/cellular policy, storage pressure and media-heavy performance.
- [ ] VoiceOver focus/speech, software keyboard, large text and iPad layout.
- [ ] Decide rollout flags from evidence; downloads and global reconciliation currently remain off in production.

## 5. Official production archive

- [ ] Audit production EAS/native configuration, signing and `com.deephaus.app` identity.
- [ ] Verify production endpoints, Apple RevenueCat configuration and release identifier.
- [ ] Build official archive and run production-configured TestFlight smoke checks.

## 6. App Store Connect package

- [ ] Audit official app record, subscription products, availability and agreements.
- [ ] Screenshots, description, support/privacy URLs, age rating and export compliance.
- [ ] Privacy disclosures and native manifests aligned with actual SDK/data usage.
- [ ] Review account, notes, subscription review screenshots and submission attachments.
- [ ] Submit the reviewed official build and record submission status.

## Separate infrastructure follow-ups

- Dedicated staging workers: not provisioned; paid-service approval remains outstanding.
- Release automation and historical migration cleanup: preserve existing production data/queues.

Evidence: [production rollout](environment-release-plan.md),
[TestFlight preparation](staging-testflight.md), [payments](payment-testing.md),
[native accessibility](native-editor-accessibility.md).

## September 16 follow-through evidence

- Xcode Debug staging build succeeded on iPhone 17 Pro / iOS 26.5. The local
  RevenueCat Test Store configuration requires Debug; this is not a signed store archive.
- Maestro sign-in/library/restart passed. Download settings journey passed: no
  dashboard banner, pause state retained while navigating, resume/check controls,
  downloaded image readiness after termination/relaunch, and fixture study rendering.
- Read-only native storage acceptance passed: owned SQLite rows, empty upload
  queue, account-scoped manifest and exact downloaded image bytes.
- Corrected test scrolling and waited for restored library before post-restart
  navigation. Latest evidence is under ignored `.maestro/tests/staging-download`.
- Retried non-interactive staging TestFlight build. EAS still reports credentials
  are not set up; no archive/upload completed. Next user handoff is the existing
  interactive wrapper, which handles Apple login/signing without putting secrets
  in source or chat:

  ```sh
  cd /Users/lukekyne/Projects/deephaus
  node scripts/launch/build-testflight.mjs --interactive
  ```

### Signing handoff completed

Apple login/signing succeeded. Fixed dynamic-config auto-increment by selecting
remote EAS version management, and added the mobile workspace dependency build
hook. All four shared packages compiled locally and in EAS; 11 store-config tests
passed. Build `91a97490-7c0d-4f9f-8023-d2c76ff82ba4` and upload submission
`912dedc3-9312-4693-a124-e1fbe28041ca` completed. IPA identity and bundled environment
checks passed. An APP_MANAGER submission key is stored in EAS for the staging app.

Apple processed build 2 (`VALID`). The encryption declaration is complete;
App Store Connect shows `Ready to Test` for internal testing. Created the
`Staging QA` internal group with automatic distribution disabled and assigned
version `1.0.0 (2)`. Luke is the sole tester and has status `Invited`.
Physical installation is confirmed by the user's sign-in attempt; device acceptance remains pending. Follow
[TestFlight acceptance](testflight-acceptance.md) after installation.

The UI changes are included in the uploaded staging binary, but remain
uncommitted locally. Production web deployment and official App Store review
submission have not occurred in this follow-through.

## September 17 physical-device acceptance

- User installed the staging TestFlight app and attempted Google sign-in.
- Fixed the missing staging native callback in Supabase's redirect allowlist.
- User confirmed that a fresh Google sign-in returns to onboarding/dashboard
  inside the TestFlight app. Google callback acceptance passed on the physical device.
- Next: create a disposable text/image deck, study/edit/restart, then offline
  restart and reconnect. Record actual device results before advancing to billing.
- Apple sandbox billing and production-configured TestFlight remain separate,
  incomplete gates.
