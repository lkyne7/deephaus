import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { root } from './env.mjs';
import { randomBytes } from 'node:crypto';
import { stagingEnv } from './env.mjs';

const env = stagingEnv();
const useWorker = process.argv.includes('--polling-worker');
const count = Number(process.argv.find(arg => arg.startsWith('--files='))?.split('=')[1] ?? 1001);
assert.ok(Number.isInteger(count) && count > 0 && count <= 1001);
if (!env.EXTRACTION_WORKER_SECRET) throw new Error('Configure a staging EXTRACTION_WORKER_SECRET and restart launch:web.');
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json' };
async function call(path, {method='GET', body, customHeaders=headers}={}) {
  const response = await fetch(`${base}${path}`, {method, headers:customHeaders, body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`${path.split('?')[0]}: HTTP ${response.status}`);
  return response.status===204 ? null : response.json();
}
const email = `launch-deletion-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(32).toString('base64url');
const created = await call('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});
const id = (created.user??created).id;
console.log(`Created disposable staging deletion fixture ${id}`);
const session = await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},customHeaders:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json'}});
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9l8AAAAASUVORK5CYII=','base64');
let next=0;
await Promise.all(Array.from({length:12},async()=>{
  for (;;) {
    const index=next++;
    if(index>=count) return;
    const response=await fetch(`${base}/storage/v1/object/card-media/${id}/large-folder/${index}.png`,{
      method:'POST',headers:{apikey:headers.apikey,Authorization:headers.Authorization,'Content-Type':'image/png'},body:pixel,signal:AbortSignal.timeout(30_000),
    });
    if(!response.ok) throw new Error(`Fixture upload ${index}: HTTP ${response.status}. Fixture retained for inspection: ${id}`);
  }
}));
console.log(`Uploaded ${count} actual Storage objects into one folder.`);
const queued = await fetch(`${env.E2E_BASE_URL}/api/account`,{method:'DELETE',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30_000)});
assert.equal(queued.status,202);
assert.equal((await queued.json()).status,'pending');
// Simulate a worker dying after claiming work. Reclaim the persisted, expired
// lease through the real worker endpoint; no account is deleted prematurely.
const [claimed] = await call('/rest/v1/rpc/claim_account_deletion',{method:'POST',body:{}});
assert.equal(claimed.user_id,id);
await call(`/auth/v1/admin/users/${id}`);
await call(`/rest/v1/account_deletion_requests?user_id=eq.${id}`,{method:'PATCH',body:{lease_until:new Date(Date.now()-60_000).toISOString()}});
const late=await fetch(`${base}/storage/v1/object/card-media/${id}/late.png`,{method:'POST',headers:{apikey:headers.apikey,Authorization:headers.Authorization,'Content-Type':'image/png'},body:pixel});
assert.equal(late.ok,false,'Deletion fence must reject an in-flight account upload');
if (useWorker) {
  const worker = spawn(process.execPath, ['apps/extraction-worker/dist/index.js'], {
    cwd: root, env: {...env, SUPABASE_URL: base}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  worker.stdout.on('data', data => { logs += data; });
  worker.stderr.on('data', data => { logs += data; });
  const stopped = new Promise(resolve => worker.once('close', resolve));
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (worker.exitCode !== null) throw new Error('Polling worker exited before completing cleanup.');
      const [record] = await call(`/rest/v1/account_deletion_requests?user_id=eq.${id}`);
      if (record.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    worker.kill('SIGTERM');
    const force = setTimeout(() => worker.kill('SIGKILL'), 10_000);
    await stopped;
    clearTimeout(force);
    for (const secret of [env.SUPABASE_SERVICE_ROLE_KEY, env.EXTRACTION_WORKER_SECRET]) logs = logs.replaceAll(secret, '[redacted]');
    console.log(logs);
  }
} else {
for(let attempt=0;attempt<5;attempt++) {
  const worker=await fetch(`${env.E2E_BASE_URL}/api/internal/account-deletion`,{method:'POST',headers:{Authorization:`Bearer ${env.EXTRACTION_WORKER_SECRET}`},signal:AbortSignal.timeout(60_000)});
  assert.equal(worker.status,200);
  const result=await worker.json();
  if(result.complete) break;
  await call(`/rest/v1/account_deletion_requests?user_id=eq.${id}`,{method:'PATCH',body:{lease_until:new Date(Date.now()-60_000).toISOString()}});
}
}
const [record]=await call(`/rest/v1/account_deletion_requests?user_id=eq.${id}`);
assert.equal(record.status,'complete');
assert.ok(record.attempts>=2);
const remaining=await call('/storage/v1/object/list/card-media',{method:'POST',body:{prefix:`${id}/large-folder`,limit:1000}});
assert.deepEqual(remaining,[]);
const removed=await fetch(`${base}/auth/v1/admin/users/${id}`,{headers});
assert.equal(removed.status,404);
const stale=await fetch(`${env.E2E_BASE_URL}/api/account`,{headers:{Authorization:`Bearer ${session.access_token}`}});
assert.equal(stale.status,401);
console.log(`PASS: ${count} files removed${useWorker ? ' by the independent worker process' : ''}, expired lease reclaimed, late upload blocked, auth deleted only after cleanup, old credentials rejected.`);
