# Staging TestFlight preparation

The `staging-testflight` EAS profile uses the **DeepHaus Staging** scheme and
**Release Staging** native configuration. The native iOS project is checked in,
so changing only `app.config.ts` does not change its archive bundle identifier.
This separate configuration archives `com.deephaus.app.staging`, has staging-only
callback schemes and a separate Info.plist, and contains no local StoreKit file
reference. The existing production scheme and Release identity are unchanged.

To regenerate this configuration after native project changes, from the repo root:

```sh
node scripts/launch/prepare-testflight.mjs
cd apps/mobile/ios
pod install
```

The helper does not load environment files, register Apple identifiers, create
signing credentials, archive, or upload. Simulator tests continue to use the
separate **DeepHaus StoreKit** scheme.

Before building, configure the EAS `preview` environment with the public staging
client values: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POWERSYNC_URL`, and
`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`. Include the rollout flags required by the
offline validation matrix. Never copy Supabase service-role keys or webhook
authorization into the mobile environment.

The API must be a reachable HTTPS staging deployment with sandbox billing enabled.
The temporary payment relay exposes only `/revenuecat`; it is not an app API.
The app config rejects local API URLs, the production Supabase project, and
non-Apple billing SDK keys for this profile. Local dotenv loading is disabled.

Completed external preparation, verified September 16, 2026:

- Registered `com.deephaus.app.staging` with In-App Purchase on Apple team
  `NVNN9G49JA`. Created **DeepHaus Staging**, Apple app ID `6812905977`.
  Production DeepHaus (`6805631471`, `com.deephaus.app`) is unchanged.
- Created subscription group **DeepHaus Plans** (`22390940`) with English (Canada)
  localization and four Apple product records:

  | Product | Apple ID | CAD price | Service level |
  | --- | --- | --- | --- |
  | `deephaus_pro_monthly` | `6812906791` | 19.99/month | 1 |
  | `deephaus_pro_annual` | `6812908195` | 199.99/year upfront | 1 |
  | `deephaus_plus_monthly` | `6812908648` | 9.99/month | 2 |
  | `deephaus_plus_annual` | `6812909080` | 99.99/year upfront | 2 |

  All have English (Canada) names/descriptions, prices, and Canada availability.
  Annual plans use upfront billing. Review screenshots and public-release metadata
  remain outstanding; nothing was submitted for review.
- RevenueCat Apple app `app7bfff4b454` now reports **Valid credentials** for the
  staging bundle. The earlier key/bundle compatibility warning is resolved.
  The staging Apple app's Sandbox Server URL points to that RevenueCat app's
  Apple notification endpoint and remains saved after reload. Its Production
  Server URL was not configured.
- Deployed the isolated API at `https://deephaus-staging.vercel.app` in Vercel
  project `prj_eyfS5xkndOZRaXsWkGSpWlXsuZ5I`. Its Supabase project is exclusively
  `cktvxmclcxtymkozciaw`. Vercel protection was removed with user approval; app
  authentication remains required. Server credentials use sensitive variables.
  No paid-plan upgrade or production project change was made.
- Configured seven public client settings in the EAS `preview` environment.
  No service-role, webhook, or RevenueCat server key is included in the mobile
  environment. The staging submit profile targets Apple app `6812905977`.
- Updated the existing Sandbox-only RevenueCat webhook `whintgr9f8865d968` to
  `/api/billing/revenuecat/webhook` on the hosted staging origin, preserving its
  authorization. The temporary Cloudflare relay is no longer its destination.

Build and upload:

```sh
# From the repository root. Loads only public staging values for Expo config.
node scripts/launch/build-testflight.mjs --interactive
```

The wrapper is needed because EAS evaluates the guarded Expo config before it
loads remote environment variables. Default operation is non-interactive; use the
interactive option to finish Apple login/signing. EAS now manages build numbers
remotely (`cli.appVersionSource: remote`), allowing auto-increment with the dynamic
Expo configuration. The previous local setting failed after signing completed.

Browser sign-in verification:

- Browser Google sign-in exposed a callback configuration gap after deployment:
  Google client `304289587979-mhnbe92m43ehhl9tc5fmlp7mtqtf5fk3.apps.googleusercontent.com`
  now registers both the original production callback and
  `https://cktvxmclcxtymkozciaw.supabase.co/auth/v1/callback`. Saved staging
  Supabase Site URL `https://deephaus-staging.vercel.app` and redirect allowance
  `https://deephaus-staging.vercel.app/**`. The callback mismatch is resolved.
  Retesting exposed an invalid Google client secret in staging Supabase. The user
  corrected that credential through the dashboard. Google sign-in now completes
  on the hosted staging origin and opens authenticated onboarding for the new
  staging account. Reload preserves the session. Onboarding choices remain for
  the user; reaching the study dashboard is not yet part of this verification.

Outstanding external prerequisites (updated after signing):

- Signing is configured after the user completed Apple login/2FA and created a
  distribution certificate and active staging provisioning profile. Cloud archive
  and TestFlight upload remain in progress; see the build record below.
- Confirm Apple sandbox notifications arrive at RevenueCat and reach the hosted
  staging webhook with a fresh real sandbox purchase.
- Validate on TestFlight: purchase, scheduled renewal, cancellation/expiry, restore,
  app restart and server reconciliation. Local StoreKit success does not certify
  Apple's sandbox notification lifecycle.

Verification so far: 11 app-config tests and 4 hosted-environment tests passed;
CocoaPods install succeeded;
`xcodebuild -showBuildSettings` resolves the staging bundle, Release Staging,
staging Info.plist and store-build guards. EAS upload archive inspection found
1,089 files (8.6 MB), with no environment files, private signing keys, Vercel
configuration, or test-result artifacts. The hosted web build passed. Missing and
invalid bearer tokens return 401 for billing/cards; unsigned webhooks return 401.
Both isolated fixture accounts return 200 with expected billing plans. An
authenticated replay of an existing renewal returned 200 and `duplicate: true`.
This replay is not evidence of a fresh provider-originated delivery.

### Signing and first cloud archive — September 16

- User completed Apple authentication for team `NVNN9G49JA`; EAS verified the
  `com.deephaus.app.staging` certificate/profile configuration.
- Changed build numbering to EAS remote management after local auto-increment
  failed with dynamic Expo configuration. No production binary was uploaded.
- Added `eas-build-post-install` to compile the four mobile workspace dependencies
  from source. Generated `dist` directories are intentionally not uploaded.
  Local compilation and all 11 store-config tests passed.
- Canceled build `473aa949-0ce8-47a4-987d-f89510a0ba6e` before archiving to include
  the missing dependency build hook.
- Replacement staging build `91a97490-7c0d-4f9f-8023-d2c76ff82ba4`, app version
  `1.0.0`, build `2`, passed cloud dependency installation, package compilation,
  JS bundling and Xcode configuration. Signed archive completed successfully.
- Downloaded and inspected the IPA: staging bundle/display name, version `1.0.0`
  build `2`, hosted staging API, staging Supabase and staging PowerSync all match.
  No environment/private-key files were bundled, and the JS bundle contains no
  production Supabase reference.
- Created an App Store Connect submission key with `APP_MANAGER` scope (the
  lower-privilege role offered by EAS), stored on EAS and assigned to the staging
  bundle. Reused the user's authenticated Apple session.
- EAS submission `912dedc3-9312-4693-a124-e1fbe28041ca` to staging Apple app
  `6812905977` finished successfully. Initial Apple status query returned no
  TestFlight builds yet; Apple subsequently processed build 2 successfully. This is not a
  public App Store review submission.
- Completed the encryption declaration for build 2 after checking the app's
  OS-provided transport/keychain usage and absence of custom encryption or
  enabled SQLCipher. Internal build status is `Ready to Test`.
- Created internal group `Staging QA` (automatic distribution disabled), assigned
  `1.0.0 (2)`, and added Luke as its sole tester. App Store Connect confirms
  `1 Tester`, `1 Build`, and tester status `Invited`. Physical iPhone installation
  and the acceptance checklist remain pending.

### Physical-device authentication follow-up (2026-09-17)

- User reported successful browser sign-in did not return to the TestFlight app.
- Staging Supabase's redirect allowlist contained only web URLs. Added the exact
  `deephaus-staging://auth/callback` used by the staging binary; verified it is
  saved in the dashboard. This server-side correction applies to existing build 2.
- A public Google OAuth initiation request with that redirect returns HTTP 302
  to `accounts.google.com`. Full provider completion and return to the physical
  iPhone still require the user's retry; do not mark this acceptance check passed.
- Separate follow-up: email/password signup currently omits `emailRedirectTo`;
  confirmation-email navigation needs explicit coverage before release.
