// Creates a separate, simulator-only Xcode configuration; production schemes stay intact.
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import path from 'node:path';
import {root, nativeStagingEnv} from './env.mjs';
const mobile = path.join(root, 'apps/mobile');
const requireMobile = createRequire(path.join(mobile, 'package.json'));
const requireExpo = createRequire(requireMobile.resolve('expo/package.json'));
const requirePlugins = createRequire(requireExpo.resolve('@expo/config-plugins/package.json'));
const xcode = requirePlugins('xcode');
const ios = path.join(mobile, 'ios');
const filename = path.join(ios, 'DeepHaus.xcodeproj/project.pbxproj');
const project = xcode.project(filename); project.parseSync();
const objects = project.hash.project.objects;
const configName = 'Debug StoreKit';
const env = nativeStagingEnv();
// The public Apple SDK key is configured later in Metro. No server keys enter Xcode.
const publicSettings = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('EXPO_PUBLIC_') || ['APP_VARIANT','EXPO_NO_DOTENV'].includes(key)));
delete publicSettings.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const quote = value => JSON.stringify(String(value));
for (const [id,list] of Object.entries(objects.XCConfigurationList)) {
  if (id.endsWith('_comment')) continue;
  const debug = list.buildConfigurations.find(item => item.comment === 'Debug');
  if (!debug) continue;
  let existing = list.buildConfigurations.find(item => item.comment === configName);
  if (!existing) {
    existing = {value:project.generateUuid(),comment:configName};
    list.buildConfigurations.push(existing);
  }
  const config = structuredClone(objects.XCBuildConfiguration[debug.value]);
  config.name = quote(configName);
  if (config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
    Object.assign(config.buildSettings, Object.fromEntries(Object.entries(publicSettings).map(([k,v]) => [k,quote(v)])), {
      PRODUCT_BUNDLE_IDENTIFIER:'com.deephaus.app.staging',
      SDKROOT:'iphonesimulator', SUPPORTED_PLATFORMS:quote('iphonesimulator'),
      CODE_SIGN_IDENTITY:quote('-'), CODE_SIGNING_ALLOWED:'YES',
      RCT_METRO_PORT:'8083', INFOPLIST_FILE:quote('DeepHausStaging-Info.plist'),
    });
  }
  objects.XCBuildConfiguration[existing.value] = config;
  objects.XCBuildConfiguration[`${existing.value}_comment`] = configName;
}
writeFileSync(filename,project.writeSync());
for (const file of ['DeepHausStaging.storekit','DeepHausStagingCertificate.cer'])
  copyFileSync(path.join(root,'tests/fixtures/billing',file),path.join(ios,file));
// Copy the launch runner's existing staging plist, produced by the prior simulator build.
const {tmpdir} = await import('node:os');
copyFileSync(path.join(tmpdir(),'deephaus-staging-config/Info.plist'),path.join(ios,'DeepHausStaging-Info.plist'));
let scheme = readFileSync(path.join(ios,'DeepHaus.xcodeproj/xcshareddata/xcschemes/DeepHaus.xcscheme'),'utf8');
scheme = scheme.replaceAll('buildConfiguration = "Debug"','buildConfiguration = "Debug StoreKit"');
scheme = scheme.replace('</LaunchAction>','  <StoreKitConfigurationFileReference identifier = "../DeepHausStaging.storekit">\n      </StoreKitConfigurationFileReference>\n   </LaunchAction>');
// This scheme is for simulator testing only; prevent accidental archive use.
scheme = scheme.replace(/\s*<ArchiveAction[\s\S]*?<\/ArchiveAction>/,'');
writeFileSync(path.join(ios,'DeepHaus.xcodeproj/xcshareddata/xcschemes/DeepHaus StoreKit.xcscheme'),scheme);
console.log('Prepared DeepHaus StoreKit scheme and simulator-only Debug StoreKit configuration. Apple SDK key and RevenueCat product mappings are still required before purchase testing.');

// CocoaPods must generate matching configurations and module-map search paths.
const podfile = path.join(ios,'Podfile');
const podSource = readFileSync(podfile,'utf8');
const mapping = "project 'DeepHaus', 'Debug' => :debug, 'Debug StoreKit' => :debug, 'Release' => :release";
if (!podSource.includes(mapping)) writeFileSync(podfile,podSource.replace('prepare_react_native_project!', mapping+'\n\nprepare_react_native_project!'));
console.log('Run pod install after preparing this scheme so dependencies include Debug StoreKit.');
