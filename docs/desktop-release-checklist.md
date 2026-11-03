# Desktop release checklist

The desktop app (`apps/desktop`) is an Electron shell around the hosted web
app, so most product changes ship with the web deploy. Cut a desktop release
only when the shell itself changes (Electron upgrade, menu, auth hand-off,
updater, packaging) or when a new platform is added.

## One-time setup

- [x] **Supabase redirect allowlist.** `deephaus-desktop://auth/callback` and
      `deephaus-desktop-staging://auth/callback` are on the single `deephaus`
      project (Authentication → URL Configuration; staging shares it). Done
      2026-11-02. Without
      this, Google and Apple sign-in on desktop fails after the browser step.
- [x] **macOS signing.** Done 2026-11-02 with "Developer ID Application:
      LUKE THOMAS KYNE (NVNN9G49JA)" (individual Apple account; expires
      2027-12-02). Key, CSR and .p12 live in `~/.deephaus-signing/` on Luke's
      Mac. Export the Developer ID Application certificate as
      a base64 `.p12` into `MAC_CSC_LINK`, its password into
      `MAC_CSC_KEY_PASSWORD`, and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
      `APPLE_TEAM_ID` as repository secrets for notarization.
- [ ] **Windows signing** (account `deephaus-signing`, resource group
      `deephaus-signing`, East US, Basic; service principal
      `deephaus-desktop-signing`, secret expires 2027-11-02. Identity
      validation for Dekki Inc / dekki.ai submitted 2026-11-02; once approved,
      create a Public Trust certificate profile and set `AZURE_SIGN_PROFILE`
      and `AZURE_SIGN_PUBLISHER`.) **Windows signing (Microsoft Artifact Signing, formerly Azure Trusted
      Signing).** Dekki Inc has operated since 2023, which meets the
      three-year organisation requirement. Create the account and certificate
      profile, then a service principal with the Artifact Signing Certificate
      Profile Signer role. Secrets: `AZURE_SIGN_ENDPOINT`,
      `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER`
      (the subject name, exactly as on the certificate), `AZURE_TENANT_ID`,
      `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. Builds without these secrets
      are unsigned and trigger SmartScreen warnings; use them for internal
      testing only.
- [ ] **Linux.** No signing. AppImage auto-updates; `.deb` installs do not.

## Each release

1. Bump `version` in `apps/desktop/package.json`.
2. Run `pnpm --filter @deephaus/desktop typecheck` and
   `pnpm --filter @deephaus/desktop test`.
3. Staging first: run the "Desktop release" workflow manually with
   `variant: staging`, `publish: true`. It publishes a GitHub pre-release on
   the `staging` update channel. Install it on each platform and check:
   - email/password sign-in, then Google sign-in through the browser hand-off;
   - study a deck, disconnect, keep grading, reconnect, confirm the reviews on
     the iOS staging app;
   - quit and relaunch offline: the app opens on the last page from cache;
   - `⌘1`–`⌘5` and `⌘R` navigate; the dock badge matches "due now";
   - "Check for Updates…" reports the current version.
4. Production: commit the version bump, tag `desktop-v<version>`, push the
   tag. The workflow builds all three platforms with production config and
   publishes a GitHub release. Asset names are version-free so the website's
   download links (`/download`) keep working.
5. Confirm `https://www.deephaus.ai/download` links resolve, and that an
   installed previous version offers the update within fifteen seconds of
   launch.

## Rollback

Delete or unpublish the GitHub release. electron-updater only moves forward,
so to force users back, publish the previous build again under a higher
version number.
