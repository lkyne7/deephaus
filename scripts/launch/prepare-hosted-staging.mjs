// Prepare source only. This script never creates a deployment or uploads secrets.
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = mkdtempSync(path.join(tmpdir(), 'deephaus-hosted-staging-'));
const topLevel = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.base.json']);
const candidates = execFileSync('git', ['ls-files', '-cz', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
const included = [];
for (const file of new Set(candidates)) {
  if (!topLevel.has(file) && !file.startsWith('apps/web/') && !file.startsWith('packages/')) continue;
  // Never package environment files, generated output, local experiments or keys.
  if (file.split('/').some(part => part.startsWith('.env') || ['node_modules', '.vercel', '.git', '.imgtest', '.next', '.next-launch', '.next-launch-network', 'dist', 'test-results', 'playwright-report'].includes(part))) continue;
  if (/\.(p8|p12|pem|key|mobileprovision|log|tsbuildinfo)$/i.test(file)) continue;
  const source = path.join(root, file);
  if (!lstatSync(source).isFile()) throw new Error(`Refusing non-file source: ${file}`);
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), {recursive: true});
  copyFileSync(source, target);
  included.push(file);
}
// No production project link or production domains are copied. The project must
// be explicitly linked to deephaus-staging before using this snapshot.
const config = {
  '$schema': 'https://openapi.vercel.sh/vercel.json',
  buildCommand: 'pnpm turbo build --filter=@deephaus/web --env-mode=loose',
  installCommand: 'pnpm install --frozen-lockfile',
  outputDirectory: '.next', framework: 'nextjs',
};
writeFileSync(path.join(destination, 'apps/web/vercel.json'), JSON.stringify(config, null, 2)+'\n');
writeFileSync(path.join(destination, '.vercelignore'), '.env*\n**/.env*\nnode_modules\n**/node_modules\n');
console.log(JSON.stringify({directory: destination, files: included.length, roots: ['apps/web', 'packages'], secretsIncluded: false}, null, 2));
