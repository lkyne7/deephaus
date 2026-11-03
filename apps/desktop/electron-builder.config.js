// electron-builder configuration for @deephaus/desktop.
//
// APP_VARIANT=production (default) or staging selects the product name,
// identifiers, URL scheme and update channel, the same way
// apps/mobile/app.config.ts does. Signing and notarization credentials come
// from the environment (see .github/workflows/desktop-release.yml).
//
// Windows signing uses Microsoft Artifact Signing (formerly Azure Trusted
// Signing). Set the four AZURE_SIGN_* values plus the AZURE_TENANT_ID,
// AZURE_CLIENT_ID and AZURE_CLIENT_SECRET service-principal variables.

const variant = process.env.APP_VARIANT === "staging" ? "staging" : "production";
const staging = variant === "staging";

const productName = staging ? "DeepHaus Staging" : "DeepHaus";
const artifactPrefix = staging ? "DeepHaus-Staging" : "DeepHaus";

const azureSign =
  process.env.AZURE_SIGN_ENDPOINT && process.env.AZURE_SIGN_ACCOUNT && process.env.AZURE_SIGN_PROFILE
    ? {
        endpoint: process.env.AZURE_SIGN_ENDPOINT,
        codeSigningAccountName: process.env.AZURE_SIGN_ACCOUNT,
        certificateProfileName: process.env.AZURE_SIGN_PROFILE,
        publisherName: process.env.AZURE_SIGN_PUBLISHER ?? "Dekki Inc",
      }
    : undefined;

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: staging ? "com.deephaus.desktop.staging" : "com.deephaus.desktop",
  productName,
  copyright: `Copyright © ${new Date().getFullYear()} Dekki Inc`,
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: ["dist/**/*", "resources/**/*", "package.json"],
  asar: true,
  // Version-free names so the website can link to
  // https://github.com/lkyne7/deephaus/releases/latest/download/<asset>.
  artifactName: `${artifactPrefix}-\${os}-\${arch}.\${ext}`,
  extraMetadata: {
    name: staging ? "deephaus-desktop-staging" : "deephaus-desktop",
    deephaus: { variant },
  },
  protocols: [
    {
      name: productName,
      schemes: [staging ? "deephaus-desktop-staging" : "deephaus-desktop"],
    },
  ],
  publish: {
    provider: "github",
    owner: "lkyne7",
    repo: "deephaus",
    releaseType: staging ? "prerelease" : "release",
    ...(staging ? { channel: "staging" } : {}),
  },
  mac: {
    category: "public.app-category.education",
    target: [
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    // Needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.
    notarize: Boolean(process.env.APPLE_ID),
    extendInfo: {
      NSMicrophoneUsageDescription:
        "DeepHaus uses the microphone so you can record audio clips for your flashcards.",
    },
  },
  dmg: {
    contents: [
      { x: 140, y: 190 },
      { x: 400, y: 190, type: "link", path: "/Applications" },
    ],
  },
  win: {
    target: [{ target: "nsis", arch: ["x64", "arm64"] }],
    ...(azureSign ? { azureSignOptions: azureSign } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: `${artifactPrefix}-Setup-\${arch}.\${ext}`,
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Education",
    synopsis: "AI-powered flashcards with adaptive spaced repetition",
    maintainer: "Dekki Inc <info@dekki.ai>",
  },
};

module.exports = config;
