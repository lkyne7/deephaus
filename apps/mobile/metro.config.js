const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so the hoisted expo-router entry and pnpm packages in
// the root node_modules are reachable. The duplicate-React crash that this would
// otherwise cause is prevented by the react/react-native pin + apps/web blockList.
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
// Keep hierarchical lookup ON: pnpm nests transitive deps (e.g. base64-js) inside
// each package's private .pnpm/<pkg>/node_modules, found only by walking parents.

const webAppRoot = path.resolve(monorepoRoot, "apps/web");
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(`${webAppRoot.replace(/[/\\]/g, "[/\\\\]")}[/\\\\].*`),
];

config.resolver.unstable_conditionNames = ["react-native", "require"];

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react") {
    return {
      type: "sourceFile",
      filePath: require.resolve("react", { paths: [projectRoot] }),
    };
  }
  if (moduleName === "react-native") {
    return {
      type: "sourceFile",
      filePath: require.resolve("react-native", { paths: [projectRoot] }),
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
