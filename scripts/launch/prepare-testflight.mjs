// Prepare an isolated native archive configuration. Does not create Apple records,
// upload a build, configure credentials, or copy local environment variables.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ios = path.join(root, 'apps/mobile/ios');
const requireMobile = createRequire(path.join(root, 'apps/mobile/package.json'));
const requireExpo = createRequire(requireMobile.resolve('expo/package.json'));
const requirePlugins = createRequire(requireExpo.resolve('@expo/config-plugins/package.json'));
const xcode = requirePlugins('xcode');
const plist = requirePlugins('@expo/plist');
const filename = path.join(ios, 'DeepHaus.xcodeproj/project.pbxproj');
const project = xcode.project(filename);
project.parseSync();
const objects = project.hash.project.objects;
const name = 'Release Staging';
for (const [id, list] of Object.entries(objects.XCConfigurationList)) {
  if (id.endsWith('_comment')) continue;
  const source = list.buildConfigurations.find(item => item.comment === 'Release');
  if (!source) continue;
  let target = list.buildConfigurations.find(item => item.comment === name);
  const previousBase = target && objects.XCBuildConfiguration[target.value].baseConfigurationReference;
  const previousBaseComment = target && objects.XCBuildConfiguration[target.value].baseConfigurationReference_comment;
  if (!target) {
    target = { value: project.generateUuid(), comment: name };
    list.buildConfigurations.push(target);
  }
  const config = structuredClone(objects.XCBuildConfiguration[source.value]);
  config.name = JSON.stringify(name);
  // Preserve CocoaPods' generated staging reference on repeated preparation.
  if (previousBase) {
    config.baseConfigurationReference = previousBase;
    config.baseConfigurationReference_comment = previousBaseComment;
  }
  if (config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
    Object.assign(config.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: 'com.deephaus.app.staging',
      INFOPLIST_FILE: '"DeepHausTestFlight-Info.plist"',
      APP_VARIANT: 'staging', DEEPHAUS_STORE_BUILD: '1', EXPO_NO_DOTENV: '1',
      SDKROOT: 'iphoneos', SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
    });
  }
  objects.XCBuildConfiguration[target.value] = config;
  objects.XCBuildConfiguration[`${target.value}_comment`] = name;
}
writeFileSync(filename, project.writeSync());

const info = plist.default.parse(readFileSync(path.join(ios, 'DeepHaus/Info.plist'), 'utf8'));
info.CFBundleDisplayName = 'DeepHaus Staging';
info.CFBundleURLTypes = [{ CFBundleURLSchemes: ['deephaus-staging', 'com.deephaus.app.staging'] }];
delete info.NSBonjourServices;
delete info.NSLocalNetworkUsageDescription;
delete info.RCTMetroPort;
delete info.NSAppTransportSecurity.NSAllowsLocalNetworking;
writeFileSync(path.join(ios, 'DeepHausTestFlight-Info.plist'), plist.default.build(info));

const schemes = path.join(ios, 'DeepHaus.xcodeproj/xcshareddata/xcschemes');
const scheme = readFileSync(path.join(schemes, 'DeepHaus.xcscheme'), 'utf8')
  .replace(/buildConfiguration = "(?:Debug|Release)"/g, 'buildConfiguration = "Release Staging"');
if (scheme.includes('StoreKitConfigurationFileReference')) throw new Error('Archive scheme must use Apple sandbox, not local StoreKit.');
writeFileSync(path.join(schemes, 'DeepHaus Staging.xcscheme'), scheme);
const podfile = path.join(ios, 'Podfile');
const podSource = readFileSync(podfile, 'utf8');
if (!podSource.includes("'Release Staging' => :release")) {
  writeFileSync(podfile, podSource.replace(/^(project 'DeepHaus'.*)$/m, "$1, 'Release Staging' => :release"));
}
console.log('Prepared DeepHaus Staging archive configuration. Run pod install before building. Public staging API, EAS environment, Apple app record and signing are still required.');
