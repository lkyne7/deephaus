import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {root, stagingEnv} from './env.mjs';

const env = stagingEnv();
const fixture = parseEnv(readFileSync(path.join(root, '.env.launch-native-fixtures.local'), 'utf8'));
if (!/^launch-native-[a-f0-9]+@example\.test$/.test(fixture.E2E_EMAIL ?? '')) throw new Error('An isolated native fixture is required.');
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const headers = {apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
async function request(url, options) {
  const response = await fetch(`${base}${url}`, {...options, headers:{...headers,...options?.headers}, signal:AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`Staging media fixture request failed (${response.status}).`);
  return response;
}
// Verify the recorded card still belongs to this fixture before replacing its content.
const cards = await (await request(`/rest/v1/cards?id=eq.${fixture.E2E_CARD_ID}&select=id,generation_jobs!inner(sources!inner(user_id,project_id))`)).json();
const source = cards[0]?.generation_jobs?.sources;
if (cards.length !== 1 || source?.user_id !== fixture.E2E_USER_ID || source.project_id !== fixture.E2E_DECK_ID) throw new Error('Native fixture ownership mismatch.');
const objectPath = `${fixture.E2E_USER_ID}/launch-offline-card.png`;
await request(`/storage/v1/object/card-media/${objectPath}`, {method:'POST', headers:{'Content-Type':'image/png','x-upsert':'true'}, body:readFileSync(path.join(root,'apps/web/public/icon-192.png'))});
const url = `${base}/storage/v1/object/public/card-media/${objectPath}`;
const image = await fetch(url, {signal:AbortSignal.timeout(15_000)});
if (!image.ok || !(image.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('Fixture media is not readable by the card renderer.');
await request(`/rest/v1/cards?id=eq.${fixture.E2E_CARD_ID}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({front:`Launch native question\n<img src="${url}" alt="Offline study fixture" />`,back:'Fixture answer'})});
console.log('Native fixture now includes one real Storage image for download, rendering and offline study validation.');
