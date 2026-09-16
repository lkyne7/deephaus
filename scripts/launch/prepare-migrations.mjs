import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './env.mjs';

// Deliberate allowlist: older local timestamps do not match the production ledger.
const files = [
  '20260910153404_launch_account_deletion_and_limits.sql',
  '20260910153622_launch_review_reconciliation.sql',
  '20260910163605_launch_active_review_metrics.sql',
  '20260910172301_launch_trigger_permissions.sql',
];
const snapshot = JSON.parse(readFileSync(path.join(root, 'docs/migration-history-snapshot.json'), 'utf8'));
const staging = snapshot.projects.cktvxmclcxtymkozciaw;
const production = snapshot.projects.rdfijwmxlyvykcnxfurd;
const manifest = files.map(file => {
  const sql = readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  const name = file.slice(15, -4);
  const applied = staging.find(entry => entry.name === name);
  const md5 = createHash('md5').update(sql).digest('hex');
  if (applied?.checksum !== md5) throw new Error(`${file} differs from the recorded staging validation. Revalidate before preparing release.`);
  if (production.some(entry => entry.name === name)) throw new Error(`${name} is already recorded on production. Refresh the audit before continuing.`);
  return {file, name, stagingVersion: applied.version, sha256: createHash('sha256').update(sql).digest('hex')};
});
const output = path.join(root, 'test-results/release');
mkdirSync(output, {recursive: true});
for (const file of files) writeFileSync(path.join(output, file), readFileSync(path.join(root, 'supabase/migrations', file)));
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  preparedAt: new Date().toISOString(), auditDate: snapshot.checkedAt,
  instruction: 'Review and apply each migration individually through the migration tool, in this order. Refresh the remote ledger immediately before applying. This command does not deploy.',
  excluded: ['20260622180000_topic_source_type.sql: superseded by the current production constraint', '20260816220000_remove_standalone_notes.sql: would delete an existing production source'],
  migrations: manifest,
}, null, 2) + '\n');
console.log(`Prepared four staging-verified migration files and a release manifest at ${output}. No database changed.`);
