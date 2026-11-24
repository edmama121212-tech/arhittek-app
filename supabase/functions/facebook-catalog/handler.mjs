// ARHITTEK Facebook Page private replies. Disabled until explicit Page-token configuration.
// Independent from Instagram; no account transfer, cross-posting, or ownership changes.
import {hasProjectKeyword} from './keywords.mjs';
const response=(text,status=200)=>new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
async function validSignature(secret,bytes,signature){
  if(!secret||!/^sha256=[a-f0-9]{64}$/i.test(signature||''))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const hex=signature.slice(7).match(/../g);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(hex.map(v=>parseInt(v,16))),bytes);
}
export function createHandler(env,{send=fetch,now=()=>Date.now()}={}){
  const pageId=String(env.FACEBOOK_PAGE_ID||'');
  const host='graph.facebook.com';
  const version=String(env.META_GRAPH_VERSION||'');
  const token=String(env.FACEBOOK_PAGE_ACCESS_TOKEN||'');
  async function rpc(method,args){
    const result=await send(env.SUPABASE_URL+'/rest/v1/rpc/'+method,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},
      body:JSON.stringify(args)
    });
    if(!result.ok)throw new Error('Private outbox unavailable');
    return result.json();
  }
  async function catalog(commentId){
    const created=now();
    const code=crypto.randomUUID().replace(/-/g,'');
    const item={label:'Facebook Arhitter.plans · '+commentId,token:code,floors_filter:'all',
      project_id:null,created_at:new Date(created).toISOString(),
      expires_at:new Date(created+48*3600*1000).toISOString()};
    const r=await send(env.SUPABASE_URL+'/rest/v1/share_links',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,
       Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,Prefer:'return=minimal'},
      body:JSON.stringify(item)
    });
    if(!r.ok)throw new Error('Catalog link unavailable');
    const link=new URL('https://edmama121212-tech.github.io/arhittek-app/catalog.html');
    link.searchParams.set('t',code);
    link.searchParams.set('utm_source','facebook');
    link.searchParams.set('utm_medium','comment');
    return link.toString();
  }
  return async req=>{
    const url=new URL(req.url);
    if(req.method==='GET'){
      if(!env.FACEBOOK_WEBHOOK_VERIFY_TOKEN)return response('Facebook is not connected',503);
      if(url.searchParams.get('hub.mode')==='subscribe'
        &&url.searchParams.get('hub.verify_token')===env.FACEBOOK_WEBHOOK_VERIFY_TOKEN
        &&url.searchParams.has('hub.challenge'))return response(url.searchParams.get('hub.challenge'));
      return response('Forbidden',403);
    }
    if(req.method!=='POST')return response('Method not allowed',405);
    if(!env.META_APP_SECRET||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY
      ||!token||!/^[0-9]{1,50}$/.test(pageId)||!/^v\d+\.\d+$/.test(version))
      return response('Facebook is not connected',503);
    if(Number(req.headers.get('content-length')||0)>262144)return response('Payload too large',413);
    const raw=await req.arrayBuffer();if(raw.byteLength>262144)return response('Payload too large',413);
    if(!await validSignature(env.META_APP_SECRET,raw,req.headers.get('x-hub-signature-256')))
      return response('Invalid signature',401);
    let body;try{body=JSON.parse(new TextDecoder().decode(raw));}
    catch(_){return response('Invalid JSON',400);}
    if(body.object!=='page')return response('Ignored');
    try{
      for(const entry of body.entry||[]){
        if(String(entry.id)!==pageId)continue;
        for(const change of entry.changes||[]){
          const v=change.value;
          const commentId=String(v?.comment_id||'');
          if(change.field!=='feed'||v?.item!=='comment'||v?.verb!=='add'
            ||!v?.post_id||!hasProjectKeyword(v.message)
            ||String(v.from?.id||'')===pageId
            ||!/^[0-9_]{1,100}$/.test(commentId))continue;
          const eventTime=Number(v.created_time||entry.time)*1000;
          if(!Number.isFinite(eventTime)||eventTime<now()-3*86400000||eventTime>now()+300000)continue;
          const job=await rpc('claim_facebook_catalog_reply',{
            p_comment:commentId,p_page:pageId,p_observed:new Date(eventTime).toISOString()});
          if(!job?.claimed){if(job?.state==='sending')return response('Delivery in progress',503);continue;}
          const finish=(state,message=null,error=null)=>
            rpc('finish_facebook_catalog_reply',{
              p_comment:commentId,p_lease:job.lease,p_state:state,p_message:message,p_error:error,
              p_sender:String(v.from?.name||'').slice(0,100),p_text:String(v.message||'').slice(0,500)
            });
          let link;try{link=await catalog(commentId);}
          catch(_){await finish('pending',null,'Catalog unavailable');return response('Catalog unavailable',503);}
          // The official Facebook Page private_replies edge accepts a plain text message.
          const friendly='Здравствуйте! 🏡\n\nСпасибо за интерес к ARHITTEK. Здесь готовые проекты частных домов с фасадами, планировками и ценами:\n'+link+'\n\nСсылка действует 48 часов.';
          let sent;
          try{
            sent=await send('https://'+host+'/'+version+'/'+commentId+'/private_replies',{
              method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
              headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},
              body:new URLSearchParams({message:friendly}).toString()
            });
          }catch(_){await finish('uncertain',null,'Ambiguous network response');return response('Reconciliation required',503);}
          const data=await sent.json().catch(()=>null);
          if(sent.ok&&data?.id){await finish('sent',String(data.id));continue;}
          const pending=sent.status===429;
          await finish(pending?'pending':sent.status>=500||sent.ok?'uncertain':'failed',
            null,'Meta status '+sent.status+' code '+String(data?.error?.code||'unknown'));
          if(pending||sent.status>=500||sent.ok)return response('Delivery not confirmed',503);
        }
      }
      return response('EVENT_RECEIVED');
    }catch(_){return response('Delivery service unavailable',503);}
  };
}
