// Explicit production reviewer setup and transport check. Uses only its own
// synthetic Pro account. Does not replace host sign-in/consent testing.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const require = createRequire(new URL('../../apps/mcp-server/package.json', import.meta.url));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const env = parseEnv(readFileSync(new URL('../../apps/web/.env.local', import.meta.url),'utf8'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'https://rdfijwmxlyvykcnxfurd.supabase.co');
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY);
const origin = 'https://www.deephaus.ai';
const resource = `${origin}/api/mcp`;
const file = new URL('../../.env.mcp-reviewer-fixtures.local', import.meta.url);
const dbHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'return=representation' };
async function db(path, data) {
 const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL+path, {method:'POST',headers:dbHeaders,body:JSON.stringify(data)});
 if(!r.ok) throw new Error(`Fixture ${path}: ${r.status}`);
 return r.json();
}
let fixture;
if(existsSync(file)) fixture=JSON.parse(readFileSync(file,'utf8'));
else {
 const email=`mcp-review-${randomBytes(6).toString('hex')}@example.test`;
 const password=randomBytes(32).toString('base64url');
 const user=await db('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{onboarding_completed:true}});
 fixture={userId:(user.user??user).id,email,password};writeFileSync(file,JSON.stringify(fixture),{mode:0o600});
 await db('/rest/v1/billing_accounts?on_conflict=user_id',{user_id:fixture.userId,plan:'pro',status:'active',expires_at:'2027-09-17T00:00:00Z'});
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const registration=await fetch(`${origin}/api/oauth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'MCP publication check',redirect_uris:['http://127.0.0.1:9876/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
assert.equal(registration.status,201);const registered=await registration.json();
const verifier=randomBytes(32).toString('base64url'),code=randomBytes(32).toString('base64url');
await db('/rest/v1/oauth_codes',{code_hash:hash(code),client_id:registered.client_id,user_id:fixture.userId,redirect_uri:'http://127.0.0.1:9876/callback',scopes:['study','write'],code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource,expires_at:new Date(Date.now()+60000).toISOString()});
async function token(fields){const r=await fetch(`${origin}/api/oauth/token`,{method:'POST',body:new URLSearchParams({...fields,client_id:registered.client_id,resource})});return {status:r.status,body:await r.json()};}
const exchange=await token({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:'http://127.0.0.1:9876/callback'});assert.equal(exchange.status,200);
async function connect(access){const client=new Client({name:'publication-check',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:`Bearer ${access}`}}}));return client;}
const client=await connect(exchange.body.access_token);
const listed=await client.listTools();assert.equal(listed.tools.length,12);
for(const t of listed.tools)for(const k of ['readOnlyHint','destructiveHint','openWorldHint'])assert.equal(typeof t.annotations[k],'boolean');
async function call(name,args={}){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name}: ${JSON.stringify(r.content)}`);console.log(`PASS ${name}`);return JSON.parse(r.content.find(c=>c.type==='text').text);}
const deck=await call('create_deck',{name:'MCP reviewer sample'});const deckId=deck.id??deck.project?.id;assert.ok(deckId);
const created=await call('create_cards',{deck_id:deckId,cards:[{type:'basic',front:'What is 2 + 2?',back:'4'},{type:'cloze',cloze_text:'The sum of 2 + 2 is {{c1::4}}.'}]});assert.equal(created.created_count,2);const cardId=created.created[0].id;
await call('list_decks');await call('get_study_queue',{deck_id:deckId});await call('get_card',{card_id:cardId});await call('browse_cards',{deck_id:deckId});await call('rename_deck',{deck_id:deckId,name:'MCP reviewer sample verified'});await call('update_card',{card_id:cardId,back:'Four (4)'});await call('submit_review',{card_id:cardId,grade:'good'});await call('get_deck_stats',{deck_id:deckId});await call('get_study_stats');await call('delete_card',{card_id:cardId});
await client.close();
const refreshed=await token({grant_type:'refresh_token',refresh_token:exchange.body.refresh_token,scope:'study'});assert.equal(refreshed.status,200);assert.equal(refreshed.body.scope,'study');
const study=await connect(refreshed.body.access_token);const denied=await study.callTool({name:'create_deck',arguments:{name:'must not create'}});assert.equal(denied.isError,true);await study.close();
const replay=await token({grant_type:'refresh_token',refresh_token:exchange.body.refresh_token});assert.equal(replay.status,400);
const revoked=await fetch(resource,{headers:{Authorization:`Bearer ${refreshed.body.access_token}`}});assert.equal(revoked.status,401);
console.log('PASS scope narrowing, denied write, refresh replay and access revocation');
