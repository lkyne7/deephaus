import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { stagingEnv } from './env.mjs';
import { runNativeFlow } from './maestro.mjs';

const env = stagingEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
async function call(route, body, admin = false, method = 'POST') {
  const key = admin ? secret : anon;
  const response = await fetch(`${base}/auth/v1/${route}`, {
    method, headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Staging Auth ${route.split('?')[0]}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const email = `launch-recovery-${randomBytes(6).toString('hex')}@example.test`;
const password = () => randomBytes(32).toString('base64url');
const initial = password(), first = password(), second = password();
const created = await call('admin/users', {email, password: initial, email_confirm: true, user_metadata: {onboarding_completed: true, full_name: 'Recovery fixture'}}, true);
const id = (created.user ?? created).id;
console.log(`Created disposable native recovery fixture ${id}`);
try {
  async function callback() {
    // Generate and consume an actual recovery token without sending email.
    // Native delivery/completion is tested here; email and redirect allowlists are separate gates.
    const link = await call('admin/generate_link', {type: 'recovery', email}, true);
    const session = await call('verify', {type: 'recovery', token_hash: link.hashed_token});
    assert.equal(session.user.id, id);
    const fragment = new URLSearchParams({type: 'recovery', access_token: session.access_token, refresh_token: session.refresh_token});
    return `deephaus-staging://auth/callback#${fragment}`;
  }
  for (const [coldStart, nextPassword] of [['true', first], ['false', second]]) {
    await runNativeFlow('.maestro/recovery.yaml', {
      APP_ID: 'com.deephaus.app.staging', CALLBACK_URL: await callback(),
      NEW_PASSWORD: nextPassword, COLD_START: coldStart,
    }, `staging-recovery-${coldStart === 'true' ? 'cold' : 'warm'}`);
    assert.equal((await call('token?grant_type=password', {email, password: nextPassword})).user.id, id);
  }
  const verified = await call('token?grant_type=password', {email, password: second});
  assert.equal(verified.user.id, id);
  console.log('PASS: terminated and already-open native recovery, password completion, invalid-link handling, and server password verification.');
} finally {
  await call(`admin/users/${id}`, undefined, true, 'DELETE');
  console.log('Disposable recovery account removed.');
}
