import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {createHandler} from '../supabase/functions/facebook-catalog/handler.mjs';
import {hasProjectKeyword,INSTAGRAM_CATALOG_KEYWORDS} from '../supabase/functions/facebook-catalog/keywords.mjs';

const time=Date.parse('2026-11-24T09:00:00Z');
const secret='mock-only-not-real-secret';
const page='1234567890123';
const comment='1234567890123_9876543210';
const env={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'mock-only-service',
  META_APP_SECRET:secret,
  META_GRAPH_VERSION:'v27.0',
  FACEBOOK_PAGE_ID:page,
  FACEBOOK_PAGE_ACCESS_TOKEN:'mock-only-page-token',
  FACEBOOK_WEBHOOK_VERIFY_TOKEN:'mock-only-verify'
};
const event=(value={})=>({object:'page',entry:[{id:page,time:time/1000,changes:[{
  field:'feed',value:{item:'comment',verb:'add',comment_id:comment,post_id:page+'_222',
    created_time:time/1000,from:{id:'300',name:'Test client'},message:'Хочу проект',...value}
}]}]});
function req(body=event(),signed=true){
  const raw=JSON.stringify(body);
  const mac=createHmac('sha256',signed?secret:'bad-secret').update(raw).digest('hex');
  return new Request('https://example.supabase.co/functions/v1/facebook-catalog',{
    method:'POST',headers:{'x-hub-signature-256':'sha256='+mac,'Content-Type':'application/json'},body:raw
  });
}
const service=({claim={claimed:true,lease:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'},status=200,payload={message_id:'mock-message'}}={})=>{
  const calls=[];return{calls,fetch:async(url,opts={})=>{
    const name=String(url);const data=opts.body ? (
      opts.headers?.['Content-Type']==='application/json'?JSON.parse(opts.body):opts.body
    ):null;
    calls.push({name,data,headers:opts.headers});
    if(name.endsWith('/rpc/claim_facebook_catalog_reply'))return Response.json(claim);
    if(name.endsWith('/rpc/finish_facebook_catalog_reply'))return Response.json(true);
    if(name.endsWith('/rpc/confirm_facebook_report_delivery'))return Response.json(true);
    if(name.endsWith('/rest/v1/share_links'))return new Response(null,{status:201});
    if(name.endsWith('/messages'))return Response.json(payload,{status});
    throw new Error('Unexpected mock request '+name);
  }};
};
test('same 27 keywords as Instagram (and no unapproved keywords)',()=>{
  assert.equal(INSTAGRAM_CATALOG_KEYWORDS.length,27);
  for(const term of INSTAGRAM_CATALOG_KEYWORDS)assert.equal(hasProjectKeyword(term),true,term);
  for(const term of ['строительство','смета','++','🏡','контакт','красивый фасад'])assert.equal(hasProjectKeyword(term),false,term);
});
test('verifies Facebook webhook GET challenge, not wrong token',async()=>{
  const handler=createHandler(env);
  const base='https://example.supabase.co/functions/v1/facebook-catalog?hub.mode=subscribe&hub.challenge=CHALLENGE&hub.verify_token=';
  assert.equal(await(await handler(new Request(base+'mock-only-verify'))).text(),'CHALLENGE');
  assert.equal((await handler(new Request(base+'incorrect'))).status,403);
});
test('never processes payload without page token or HMAC',async()=>{
  const missing=createHandler({...env,FACEBOOK_PAGE_ACCESS_TOKEN:''});
  assert.equal((await missing(req())).status,503);
  const h=createHandler(env);
  assert.equal((await h(req(event(),false))).status,401);
});
test('one approved comment issues a 48h link and single Messenger button',async()=>{
  const mock=service();const handle=createHandler(env,{send:mock.fetch,now:()=>time});
  const r=await handle(req());assert.equal(r.status,200);
  assert.deepEqual(mock.calls.map(x=>x.name.split('/').at(-1)),[
    'claim_facebook_catalog_reply','share_links','messages','confirm_facebook_report_delivery'
  ]);
  const link=mock.calls[1].data;
  assert.equal(Date.parse(link.expires_at)-Date.parse(link.created_at),48*3600000);
  const sent=mock.calls[2].data;
  assert.equal(sent.recipient.comment_id,comment);
  assert.equal(sent.message.attachment.payload.template_type,'button');
  assert.equal(sent.message.attachment.payload.text.includes('\n'),true);
  assert.equal(sent.message.attachment.payload.text.includes('\\n'),false);
  const button=sent.message.attachment.payload.buttons[0];
  assert.equal(button.title,'Открыть каталог');
  assert.equal(new URL(button.url).searchParams.get('t'),link.token);
  assert.equal(new URL(button.url).searchParams.get('utm_source'),'facebook');
  assert.equal(sent.message.attachment.payload.text.includes('https://'),false);
  assert.equal(mock.calls[3].data.p_channel,'comment');
  assert.equal(mock.calls[3].data.p_expires_at,link.expires_at);
  assert.equal(mock.calls[3].data.p_message,'mock-message');
  assert.equal(mock.calls[3].data.p_sender,'Test client');
});
test('duplicate, unrelated, non-keyword and self comments never send',async()=>{
  const dup=service({claim:{claimed:false,state:'sent'}});
  assert.equal((await createHandler(env,{send:dup.fetch,now:()=>time})(req())).status,200);
  assert.equal(dup.calls.length,1);
  for(const e of [event({message:'Спасибо'}),event({item:'post'}),event({verb:'edit'}),
    event({from:{id:page,name:'ARHITTEK'}}),event({post_id:''})]){
    const m=service();assert.equal((await createHandler(env,{send:m.fetch,now:()=>time})(req(e))).status,200);assert.equal(m.calls.length,0);
  }
});
test('Meta refusal records failed without fabricating delivery',async()=>{
  const m=service({status:400,payload:{error:{code:200}}});
  const r=await createHandler(env,{send:m.fetch,now:()=>time})(req());
  assert.equal(r.status,200);
  assert.equal(m.calls.at(-1).data.p_state,'failed');
});
