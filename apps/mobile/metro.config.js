const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
// Prefer Hermes-safe CJS for packages like @supabase/supabase-js. Do not include
// "import" here — it breaks Babel helper resolution (_interopRequireDefault).
config.resolver.unstable_conditionNames = ["react-native", "require"];

module.exports = config;
