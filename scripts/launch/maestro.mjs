import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { root, stagingEnv } from './env.mjs';

export async function runNativeFlow(flow, values, name) {
const directory = mkdtempSync(path.join(tmpdir(), 'deephaus-native-test-'));
const filename = path.join(directory, 'launch.yaml');
if (Object.values(values).some(value => !value)) throw new Error('Run launch:seed first.');
const source = readFileSync(path.join(root, flow), 'utf8');
writeFileSync(filename, source.replace('---', `env:\n${Object.entries(values).map(([key,value]) => `  ${key}: ${JSON.stringify(value)}`).join('\n')}\n---`), {mode: 0o600});
const output = path.join(root, '.maestro/tests', name);
mkdirSync(output, {recursive: true, mode: 0o700});
const command = process.env.MAESTRO_BIN ?? 'maestro';
const child = spawn(command, ['test', '--no-ansi', '--test-output-dir', output, filename], {
  cwd: root, env: {...process.env, MAESTRO_CLI_NO_ANALYTICS: '1'}, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
return await new Promise((resolve, reject) => {
child.on('error', reject);
child.on('close', code => {
  for (const [key, value] of Object.entries(values)) if (/PASSWORD|EMAIL|CALLBACK/.test(key)) logs = logs.replaceAll(value, '[fixture]');
  console.log(logs);
  rmSync(filename, {force: true});
  if (code === 0) resolve(); else reject(new Error(`Native flow ${name} failed (${code}).`));
});
});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = {...stagingEnv({requireSecret: false}), ...parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'))};
  const download = process.argv[2] === 'download';
  if (process.argv[2] && !download) throw new Error('Usage: maestro.mjs [download]');
  await runNativeFlow(download ? ".maestro/offline-download.yaml" : ".maestro/launch.yaml", {APP_ID: "com.deephaus.app.staging", E2E_EMAIL: fixture.E2E_EMAIL, E2E_PASSWORD: fixture.E2E_PASSWORD, E2E_DECK_NAME: fixture.E2E_DECK_NAME, E2E_DECK_ID: fixture.E2E_DECK_ID}, download ? "staging-download" : "staging-smoke");
}
