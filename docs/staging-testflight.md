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
interactive option to finish Apple login/signing. EAS uses the project's existing
local app-version source, now explicitly recorded in `eas.json`.

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

Outstanding external prerequisites:

- Complete EAS signing for the staging bundle. The build reached remote credential
  setup and stopped because credentials are missing. Apple login/2FA is a user
  handoff; no signed archive or TestFlight upload has completed.
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
