import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {createHandler} from '../supabase/functions/facebook-catalog/handler.mjs';

const time=Date.parse('2026-11-24T11:30:00Z');
const secret='fake-webhook-secret';
const page='1384422664746307';
const sender='12345678901234';
const env={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-role-fake',
  META_APP_SECRET:secret,
  META_GRAPH_VERSION:'v27.0',
  FACEBOOK_PAGE_ID:page,
  FACEBOOK_PAGE_ACCESS_TOKEN:'fake-page-token',
  FACEBOOK_WEBHOOK_VERIFY_TOKEN:'fake-verify'
};
const event=(options={})=>({object:'page',entry:[{
  id:page,time:time/1000,messaging:[{sender:{id:sender},recipient:{id:page},timestamp:time,
    message:{mid:'m_test_123',text:'Здравствуйте',...options.message},...options
  }]
}]});
function req(body=event(),sign=true){
  const raw=JSON.stringify(body);
  const mac=createHmac('sha256',sign?secret:'not-secret').update(raw).digest('hex');
  return new Request('https://example.supabase.co/functions/v1/facebook-catalog',{
    method:'POST',headers:{'x-hub-signature-256':'sha256='+mac,'Content-Type':'application/json'},body:raw
  });
}
function mock({claim={claimed:true,lease:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'},status=200,payload={message_id:'m_sent'}}={}){
  const calls=[];
  return {calls,fetch:async(url,opts={})=>{
    const u=String(url);
    const data=opts.body && opts.headers?.['Content-Type']==='application/json'?JSON.parse(opts.body):null;
    calls.push({u,data});
    if(u.endsWith('/rpc/claim_facebook_message_catalog_reply'))return Response.json(claim);
    if(u.endsWith('/rpc/finish_facebook_message_catalog_reply'))return Response.json(true);
    if(u.endsWith('/rpc/confirm_facebook_report_delivery'))return Response.json(true);
    if(u.endsWith('/rest/v1/share_links'))return new Response(null,{status:201});
    if(u.endsWith('/messages'))return Response.json(payload,{status});
    throw new Error('Unexpected request '+u);
  }};
}
test('incoming Messenger message sends a button and 48 hour catalog, confirms message id',async()=>{
  const m=mock();const r=await createHandler(env,{send:m.fetch,now:()=>time})(req());
  assert.equal(r.status,200);
  assert.deepEqual(m.calls.map(c=>c.u.split('/').at(-1)),[
    'claim_facebook_message_catalog_reply','share_links','messages','confirm_facebook_report_delivery'
  ]);
  const link=m.calls[1].data;
  assert.equal(Date.parse(link.expires_at)-Date.parse(link.created_at),48*3600000);
  const msg=m.calls[2].data;
  assert.equal(msg.recipient.id,sender);
  assert.equal(msg.messaging_type,'RESPONSE');
  assert.equal(msg.message.attachment.payload.template_type,'button');
  const button=msg.message.attachment.payload.buttons[0];
  assert.equal(button.title,'Открыть каталог');
  const url=new URL(button.url);
  assert.equal(url.searchParams.get('utm_source'),'facebook');
  assert.equal(url.searchParams.get('utm_medium'),'message');
  assert.equal(url.searchParams.get('t'),link.token);
  assert.equal(m.calls[3].data.p_channel,'messenger');
  assert.equal(m.calls[3].data.p_expires_at,link.expires_at);
  assert.equal(m.calls[3].data.p_message,'m_sent');
});
test('already sent recipient does not receive another catalog',async()=>{
  const m=mock({claim:{claimed:false,state:'sent'}});
  const r=await createHandler(env,{send:m.fetch,now:()=>time})(req());
  assert.equal(r.status,200);
  assert.equal(m.calls.length,1);
});
test('echo, deleted, non-page, stale, receipt events and unsigned payload do not send',async()=>{
  const cases=[
    event({message:{is_echo:true}}),event({message:{is_deleted:true}}),
    event({message:{mid:''}}),event({message:{text:'',attachments:undefined}}),
    event({sender:{id:page}}),event({recipient:{id:'999'}}),
    event({timestamp:time-2*86400000}),
    {object:'page',entry:[{id:'999',time:time/1000,messaging:event().entry[0].messaging}]},
    {object:'page',entry:[{id:page,time:time/1000,messaging:[{sender:{id:sender},recipient:{id:page},delivery:{mids:['test']},timestamp:time}]}]}
  ];
  for(const e of cases){const m=mock();const r=await createHandler(env,{send:m.fetch,now:()=>time})(req(e));
    assert.equal(r.status,200);assert.equal(m.calls.length,0,JSON.stringify(e));}
  const m=mock();const r=await createHandler(env,{send:m.fetch,now:()=>time})(req(event(),false));
  assert.equal(r.status,401);assert.equal(m.calls.length,0);
});
test('Meta denied permission is recorded as failed not sent',async()=>{
  const m=mock({status:403,payload:{error:{code:200}}});
  const r=await createHandler(env,{send:m.fetch,now:()=>time})(req());
  assert.equal(r.status,200);
  assert.equal(m.calls.at(-1).data.p_state,'failed');
  assert.equal(m.calls.at(-1).data.p_sent_mid,null);
});
test('no page token means fail closed',async()=>{
  const m=mock();
  const r=await createHandler({...env,FACEBOOK_PAGE_ACCESS_TOKEN:''},{send:m.fetch,now:()=>time})(req());
  assert.equal(r.status,503);assert.equal(m.calls.length,0);
});
