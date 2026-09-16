import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, stagingEnv } from './env.mjs';

export function createBillingRelay({secret, userIds, forward = fetch}) {
  if (!secret || secret.length < 32 || !userIds.length) throw new Error('Configure a relay secret and fixture identities.');
  const digest = value => createHash('sha256').update(value).digest();
  return createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== '/revenuecat') return send(404, {error:'Not found'});
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${secret}`))) return send(401, {error:'Unauthorized'});
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) return send(413, {error:'Too large'});
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(400, {error:'Invalid JSON'}); }
      const event = parsed?.event;
      if (event?.environment !== 'SANDBOX') return send(200, {ignored:true});
      const ids = [event.app_user_id, ...(Array.isArray(event.transferred_from) ? event.transferred_from : []), ...(Array.isArray(event.transferred_to) ? event.transferred_to : [])].filter(Boolean);
      if (!ids.length || ids.some(id => !userIds.includes(id))) return send(200, {ignored:true});
      const response = await forward('http://127.0.0.1:3100/api/billing/revenuecat/webhook', {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`}, body,
        signal:AbortSignal.timeout(15000), redirect:'error',
      });
      const result = await response.json();
      console.log(JSON.stringify({type:event.type, status:response.status, duplicate:result.duplicate, ignored:result.ignored}));
      send(response.status, result);
    } catch { send(503, {error:'Staging webhook temporarily unavailable'}); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = stagingEnv();
  const native = parseEnv(readFileSync(path.join(root,'.env.launch-native-fixtures.local'),'utf8'));
  const paymentFile = path.join(root,'.env.launch-payment-fixtures.local');
  const payment = existsSync(paymentFile) ? parseEnv(readFileSync(paymentFile,'utf8')) : {};
  const server = createBillingRelay({secret:env.REVENUECAT_WEBHOOK_SECRET,userIds:[env.E2E_USER_ID,native.E2E_USER_ID,payment.E2E_USER_ID].filter(Boolean)});
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.listen(3102,'127.0.0.1',()=>console.log('Sandbox fixture webhook relay listening on 127.0.0.1:3102/revenuecat'));
}
