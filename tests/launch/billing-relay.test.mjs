import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBillingRelay} from '../../scripts/launch/billing-relay.mjs';

test('relay forwards only authenticated sandbox fixture events to the fixed local webhook',async()=>{
  const secret='fixture-only-secret-with-at-least-32-characters';const calls=[];
  const server=createBillingRelay({secret,userIds:['fixture-user'],forward:async(...args)=>{calls.push(args);return Response.json({ok:true});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url+'/anything')).status,404);
    assert.equal((await fetch(url+'/revenuecat',{method:'POST'})).status,401);
    const send=event=>fetch(url+'/revenuecat',{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({event})});
    for(const event of [{environment:'PRODUCTION',app_user_id:'fixture-user'},{environment:'SANDBOX',app_user_id:'someone-else'},{environment:'SANDBOX',app_user_id:'fixture-user',transferred_to:['someone-else']}])assert.equal((await (await send(event)).json()).ignored,true);
    assert.equal(calls.length,0);
    assert.equal((await send({environment:'SANDBOX',app_user_id:'fixture-user',type:'INITIAL_PURCHASE'})).status,200);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],'http://127.0.0.1:3100/api/billing/revenuecat/webhook');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
