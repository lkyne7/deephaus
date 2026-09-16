import { readFileSync, existsSync, rmSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { developmentEnvironment } from './development.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => existsSync(path.join(root, file)) ? parseEnv(readFileSync(path.join(root, file), 'utf8')) : {};
const mode = process.argv[2];
const commands = {
  web: ['@deephaus/web', 'next', 'dev', '--turbopack', '--port', '3000'],
  'web-clean': ['@deephaus/web', 'next', 'dev', '--turbopack', '--port', '3000'],
  mobile: ['@deephaus/mobile', 'expo', 'start'],
  android: ['@deephaus/mobile', 'expo', 'run:android'],
  ios: ['@deephaus/mobile', 'expo', 'run:ios', '--scheme', 'DeepHaus Staging'],
  'ios-open': ['@deephaus/mobile', 'expo', 'start', '--ios', '--clear'],
  anki: ['@deephaus/anki-worker', 'tsx', 'watch', 'src/index.ts'],
  extraction: ['@deephaus/extraction-worker', 'tsx', 'watch', 'src/index.ts'],
};
if (!commands[mode]) throw new Error(`Choose ${Object.keys(commands).join(', ')}.`);
const dotenvKeys = new Set();
for (const directory of ['', 'apps/web/', 'apps/mobile/', 'apps/anki-worker/', 'apps/extraction-worker/']) {
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    for (const key of Object.keys(read(directory + file))) dotenvKeys.add(key);
  }
}
const mobile = ['mobile', 'ios', 'ios-open', 'android'].includes(mode);
const env = developmentEnvironment(read('.env.launch-staging.local'), process.env, [...dotenvKeys], mobile);
if (mode === 'web-clean') rmSync(path.join(root, 'apps/web/.next'), { recursive: true, force: true });
console.log(`Development: staging Supabase and PowerSync; API http://localhost:3000 (${mode}).`);
const [workspace, ...args] = commands[mode];
const child = spawn('pnpm', ['--filter', workspace, 'exec', ...args, ...process.argv.slice(3)], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
