import type { ExpoConfig } from "expo/config";

export default (): ExpoConfig => {
  const staging = process.env.APP_VARIANT === "staging";
  const scheme = staging ? "deephaus-staging" : "deephaus";
  if (staging && (process.env.EXPO_PUBLIC_SUPABASE_URL !== "https://cktvxmclcxtymkozciaw.supabase.co" || !process.env.EXPO_PUBLIC_API_BASE_URL)) {
    throw new Error("Staging builds require the staging Supabase project and an explicit API URL.");
  }
  if (process.env.DEEPHAUS_STORE_BUILD === "1") {
    const api = new URL(process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost");
    if (!staging || api.protocol !== "https:" || api.username || api.password ||
      api.hostname === "localhost" || api.hostname.endsWith(".localhost") ||
      api.hostname.endsWith(".local") || api.hostname.includes(":") ||
      /^\d+(\.\d+){3}$/.test(api.hostname)) {
      throw new Error("Staging TestFlight requires a public HTTPS API hostname and APP_VARIANT=staging.");
    }
    if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      !process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.startsWith("appl_")) {
      throw new Error("Staging TestFlight requires a Supabase publishable key and an Apple RevenueCat SDK key.");
    }
  }
  return ({
  name: staging ? "DeepHaus Staging" : "DeepHaus",
  slug: "deephaus",
  version: "1.0.0",
  orientation: "portrait",
  scheme,
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: staging ? "com.deephaus.app.staging" : "com.deephaus.app",
    infoPlist: {
      UIDesignRequiresCompatibility: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#101828",
    },
    package: staging ? "com.deephaus.app.staging" : "com.deephaus.app",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme,
            host: "auth",
            pathPrefix: "/callback",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-localization",
    "expo-web-browser",
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appVariant: staging ? "staging" : "production",
    authScheme: scheme,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
    powersyncUrl: process.env.EXPO_PUBLIC_POWERSYNC_URL,
    revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    revenueCatAndroidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    eas: {
      projectId: "85078ca9-c5a7-47eb-a167-1e2a4ee3b9ce",
    },
  },
  });
};
