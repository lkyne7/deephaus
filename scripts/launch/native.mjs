import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, nativeStagingEnv } from './env.mjs';

const mode = process.argv[2];
const env = nativeStagingEnv({storekit: mode === 'metro-storekit'});
const mobile = path.join(root, 'apps/mobile');
const device = process.env.LAUNCH_SIMULATOR_ID ?? 'booted';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: mobile, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout;
}

if (mode === 'metro' || mode === 'metro-storekit') {
  const child = spawn('pnpm', ['exec', 'expo', 'start', '--dev-client', '--host', 'lan', '--port', '8083'], { cwd: mobile, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else if (mode === 'build' || mode === 'build-release') {
  if (mode === 'build-release' && env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.startsWith('test_'))
    throw new Error('RevenueCat Test Store requires a Debug development build. Use build, metro, and open; disable staging billing before a Release build.');
  const configuration = mode === 'build-release' ? 'Release' : 'Debug';
  const directory = path.join(tmpdir(), 'deephaus-staging-config');
  mkdirSync(directory, {recursive: true});
  const source = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', 'ios/DeepHaus/Info.plist'], { stdio: 'pipe', encoding: 'utf8' }));
  source.CFBundleDisplayName = 'DeepHaus Staging';
  source.CFBundleURLTypes = [{ CFBundleURLSchemes: ['deephaus-staging', 'com.deephaus.app.staging'] }];
  const plist = path.join(directory, 'Info.plist');
  const encoded = run('plutil', ['-convert', 'xml1', '-o', '-', '--', '-'], { input: JSON.stringify(source), stdio: 'pipe', encoding: 'utf8' });
  // A new global plist path invalidates every pod's Xcode build settings.
  // Keep a stable staging-only path and avoid changing it for identical builds.
  if (!existsSync(plist) || readFileSync(plist, 'utf8') !== encoded) writeFileSync(plist, encoded);
  run('plutil', ['-lint', plist]);
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { stdio: 'pipe', encoding: 'utf8' }));
  const destination = device === 'booted' ? Object.values(devices.devices).flat().find(item => item.state === 'Booted')?.udid : device;
  if (!destination) throw new Error('Boot an iPhone simulator first.');
  run('xcodebuild', ['-workspace', 'ios/DeepHaus.xcworkspace', '-scheme', 'DeepHaus', '-configuration', configuration, '-sdk', 'iphonesimulator', '-destination', `platform=iOS Simulator,id=${destination}`, '-derivedDataPath', path.join(tmpdir(), 'deephaus-launch-ios'), 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'ONLY_ACTIVE_ARCH=YES', 'PRODUCT_BUNDLE_IDENTIFIER=com.deephaus.app.staging', `INFOPLIST_FILE=${plist}`, 'RCT_METRO_PORT=8083', 'build']);
  const app = path.join(tmpdir(), `deephaus-launch-ios/Build/Products/${configuration}-iphonesimulator/DeepHaus.app`);
  run('xcrun', ['simctl', 'install', destination, app]);
  console.log(configuration === 'Release' ? 'Installed bundled DeepHaus Staging. No Metro server is required.' : 'Installed DeepHaus Staging. Start launch:mobile, then launch:ios:open.');
} else if (mode === 'open-release') {
  run('xcrun', ['simctl', 'launch', device, 'com.deephaus.app.staging']);
} else if (mode === 'open') {
  run('xcrun', ['simctl', 'openurl', device, 'deephaus-staging://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083']);
} else {
  throw new Error('Usage: node scripts/launch/native.mjs metro|metro-storekit|build|build-release|open|open-release');
}
