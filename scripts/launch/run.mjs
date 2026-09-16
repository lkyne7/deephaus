import { spawn } from 'node:child_process';
import { root, stagingEnv } from './env.mjs';

const networkOnly = process.env.LAUNCH_NETWORK_ONLY === '1';
const port = networkOnly ? '3101' : '3100';
const commands = {
  web: ['--filter', '@deephaus/web', 'exec', 'next', 'dev', '--turbopack', '--port', port],
  start: ['--filter', '@deephaus/web', 'exec', 'next', 'start', '--port', port],
  build: ['--filter', '@deephaus/web', 'build'],
  test: ['exec', 'playwright', 'test', ...process.argv.slice(3)],
};
const command = commands[process.argv[2]];
if (!command) throw new Error('Usage: node scripts/launch/run.mjs web|start|build|test [Playwright options]');
const child = spawn('pnpm', command, { cwd: root, env: stagingEnv({requireSecret:process.env.LAUNCH_PUBLIC_ONLY !== '1', networkOnly}), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
