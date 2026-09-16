// EAS evaluates app.config.ts before fetching its remote environment. Supply the
// same public staging values locally so the store-build guards remain enabled.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hostedStagingEnvironments } from './hosted-staging-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = parseEnv(readFileSync(new URL('../../.env.launch-staging.local', import.meta.url), 'utf8'));
const { mobile } = hostedStagingEnvironments(config, 'https://deephaus-staging.vercel.app');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('EXPO_PUBLIC_') || key.startsWith('LAUNCH_') ||
      key.startsWith('SUPABASE_') || key.startsWith('REVENUECAT_') || key.startsWith('NEXT_PUBLIC_')) delete env[key];
}
Object.assign(env, mobile, { APP_VARIANT: 'staging', DEEPHAUS_STORE_BUILD: '1', EXPO_NO_DOTENV: '1' });
const child = spawn('npx', ['--yes', 'eas-cli@latest', 'build', '--platform', 'ios',
  '--profile', 'staging-testflight', ...(process.argv.includes('--interactive') ? [] : ['--non-interactive']), '--no-wait'], {
  cwd: `${root}apps/mobile`, env, stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
