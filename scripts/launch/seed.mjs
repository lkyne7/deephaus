import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, stagingEnv } from './env.mjs';

const env = stagingEnv();
const native = process.argv.includes('--native');
const cancellation = process.argv.includes('--payment-cancellation');
const payment = process.argv.includes('--payment') || cancellation;
if (native && payment) throw new Error('Select one fixture type.');
const file = path.join(root, cancellation ? '.env.launch-payment-cancellation-fixtures.local' : payment ? '.env.launch-payment-fixtures.local' : native ? '.env.launch-native-fixtures.local' : '.env.launch-fixtures.local');
if (existsSync(file)) throw new Error('Fixture configuration already exists. Reuse it; this script never replaces accounts or passwords.');
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
async function api(endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Staging fixture setup ${endpoint}: HTTP ${response.status}`);
  return response.json();
}
const values = {};
// Save after each successful step so an interruption leaves recoverable IDs,
// never a set of untracked accounts. Only the newly created staging branch is allowed.
const save = () => writeFileSync(file, Object.entries(values).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n')+'\n', { mode: 0o600 });
for (const [prefix, role] of (payment ? [['E2E','payment']] : native ? [['E2E','native']] : [['E2E','owner'],['E2E_OTHER','other']])) {
  const email = `launch-${role}-${randomBytes(5).toString('hex')}@${payment ? 'example.com' : 'example.test'}`;
  const password = randomBytes(32).toString('base64url');
  const result = await api('/auth/v1/admin/users', {
    email, password, email_confirm: true,
    user_metadata: { onboarding_completed: true, full_name: `Launch ${role}` },
  });
  const user = result.user ?? result;
  values[`${prefix}_EMAIL`] = email;
  values[`${prefix}_PASSWORD`] = password;
  values[`${prefix}_USER_ID`] = user.id;
  save();
  const [deck] = await api('/rest/v1/projects', { user_id: user.id, name: `Launch ${role} library`, deck_name: `Launch ${role} library` });
  values[`${prefix}_DECK_ID`] = deck.id;
  values[`${prefix}_DECK_NAME`] = deck.name;
  save();
  const [source] = await api('/rest/v1/sources', { project_id: deck.id, user_id: user.id, type: 'text', raw_text: 'Isolated launch fixture.' });
  const [job] = await api('/rest/v1/generation_jobs', { source_id: source.id, status: 'ready', progress: 100 });
  const [card] = await api('/rest/v1/cards', { job_id: job.id, type: 'basic', front: `Launch ${role} question`, back: 'Fixture answer' });
  values[`${prefix}_CARD_ID`] = card.id;
  save();
}
await api('/rest/v1/launch_feature_users', { name: 'review_reconciliation', user_id: values.E2E_USER_ID });
console.log(`Isolated ${payment ? 'payment' : native ? 'native' : 'owner and other-account'} fixtures created. Credentials saved in ${file} (mode 0600).`);
