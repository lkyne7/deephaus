// EAS evaluates app.config.ts before fetching its remote environment. Supply the
// public production values locally so the store-build guards remain enabled.
// Builds only: submission to App Store review is a separate, deliberate step.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = parseEnv(readFileSync(new URL('../../.env.launch-production.local', import.meta.url), 'utf8'));
for (const key of ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'EXPO_PUBLIC_POWERSYNC_URL']) {
  if (!config[key]?.trim()) throw new Error(`Missing production ${key}.`);
}
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Commit or stash local changes: the production archive must match a reviewed commit.');
}
// Explicit allowlist: never forward process.env or the complete local config.
const mobile = {
  EXPO_PUBLIC_API_BASE_URL: 'https://www.deephaus.ai',
  EXPO_PUBLIC_SUPABASE_URL: 'https://rdfijwmxlyvykcnxfurd.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: config.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_POWERSYNC_URL: config.EXPO_PUBLIC_POWERSYNC_URL,
  EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED: config.EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED ?? 'false',
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: config.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  EXPO_PUBLIC_RELEASE_ID: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
};
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('EXPO_PUBLIC_') || key.startsWith('LAUNCH_') ||
      key.startsWith('SUPABASE_') || key.startsWith('REVENUECAT_') || key.startsWith('NEXT_PUBLIC_')) delete env[key];
}
Object.assign(env, mobile, { APP_VARIANT: 'production', DEEPHAUS_STORE_BUILD: '1', EXPO_NO_DOTENV: '1' });
const child = spawn('npx', ['--yes', 'eas-cli@latest', 'build', '--platform', 'ios',
  '--profile', 'production', ...(process.argv.includes('--interactive') ? [] : ['--non-interactive']), '--no-wait'], {
  cwd: `${root}apps/mobile`, env, stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
