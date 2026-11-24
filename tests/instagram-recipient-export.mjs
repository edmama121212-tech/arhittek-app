import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createHandler,verifyGoogleIdentityToken} from '../supabase/functions/instagram-recipients-export/handler.mjs';

const fixed=Date.parse('2026-11-24T12:00:00.000Z');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pub=publicKey.export({format:'jwk'});
const jwk={...pub,kid:'local-kid',use:'sig',alg:'RS256'};
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
function jwt(overrides={},signed=true){
  const head=b64({alg:'RS256',kid:'local-kid',typ:'JWT'});
  const payload=b64({
    iss:'https://accounts.google.com',
    sub:'112911052923277506640',
    aud:'123456-example.apps.googleusercontent.com',
    iat:Math.floor(fixed/1000)-5,
    exp:Math.floor(fixed/1000)+3600,
    ...overrides,
  });
  const message=head+'.'+payload;
  const signature=createSign('RSA-SHA256').update(message).sign(privateKey).toString('base64url');
  return message+'.'+(signed?signature:Buffer.from('tampered').toString('base64url'));
}
const env={
 SUPABASE_URL:'https://example.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'mock-service-secret',
 META_ACCESS_TOKEN:'mock-meta-secret',
 META_GRAPH_HOST:'graph.facebook.com',
 META_GRAPH_VERSION:'v27.0',
};
function fakeFetch(){
  const calls=[];
  let store=[{
    comment_id:'18176950642457925',
    account_id:'17841422845904072',
    sent_at:'2026-11-24T08:50:21Z',
    username:null,
    comment_text:null,
    link_created_at:'2026-11-24T08:50:18Z',
    expires_at:'2026-11-26T08:50:18Z',
  }];
  return {calls,send:async(url,options={})=>{
    const s=String(url);calls.push({url:s,headers:options.headers,body:options.body});
    if(s.includes('googleapis.com/oauth2/v3/certs'))return Response.json({keys:[jwk]});
    if(s.endsWith('/rpc/instagram_sheet_confirmed_rows'))return Response.json(store);
    if(s.endsWith('/rpc/backfill_instagram_confirmed_identity')){
      const data=JSON.parse(options.body);
      store=store.map(x=>({...x,username:data.p_username,comment_text:data.p_text}));
      return Response.json(true);
    }
    if(s.includes('?fields=username%2Ctext'))return Response.json({
      id:'18176950642457925',username:'client_verified',text:'Хочу проект',
    });
    throw new Error('Unexpected mock URL');
  }};
}
test('Google RS256 signature and account identity validated, rejects tampered and other sub',async()=>{
 const api=fakeFetch();
 const opts={send:api.send,now:()=>fixed};
 assert.equal(await verifyGoogleIdentityToken(jwt(),opts),true);
 assert.equal(await verifyGoogleIdentityToken(jwt({sub:'123456789'}),opts),false);
 assert.equal(await verifyGoogleIdentityToken(jwt({},false),opts),false);
 assert.equal(await verifyGoogleIdentityToken(jwt({exp:Math.floor(fixed/1000)-1}),opts),false);
 assert.equal(await verifyGoogleIdentityToken(jwt({aud:'malicious.example.org'}),opts),false);
});
test('unauthenticated API never reads private recipients',async()=>{
 const m=fakeFetch();
 const handler=createHandler(env,{send:m.send,verifyGoogle:t=>verifyGoogleIdentityToken(t,{send:m.send,now:()=>fixed})});
 const res=await handler(new Request('https://example.supabase.co/functions/v1/instagram-recipients-export'));
 assert.equal(res.status,401);
 assert.equal(m.calls.length,0);
});
test('valid owner identity returns confirmed recipients and safely backfills old comment',async()=>{
 const m=fakeFetch();
 const handler=createHandler(env,{send:m.send,verifyGoogle:t=>verifyGoogleIdentityToken(t,{send:m.send,now:()=>fixed})});
 const res=await handler(new Request('https://example.supabase.co/functions/v1/instagram-recipients-export',{
   headers:{Authorization:'Bearer '+jwt()},
 }));
 assert.equal(res.status,200);
 assert.equal(res.headers.get('cache-control'),'no-store');
 const body=await res.json();
 assert.equal(body.rows.length,1);
 assert.equal(body.rows[0].username,'client_verified');
 assert.equal(body.rows[0].comment_text,'Хочу проект');
 assert.equal(JSON.stringify(body).includes('mock-service-secret'),false);
 assert.equal(JSON.stringify(body).includes('mock-meta-secret'),false);
 assert(m.calls.some(x=>x.url.includes('?fields=username%2Ctext')));
});
