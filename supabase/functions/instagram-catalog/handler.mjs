export const hasProjectKeyword=text=>/^\s*(?:\+{1,5}|🏠|🏡)\s*$/u.test(String(text||''))||/(?:^|[^\p{L}\p{N}_])(?:проект\p{L}*|проэкт\p{L}*|дом\p{L}*|коттедж\p{L}*|вилл\p{L}*|особняк\p{L}*|цен\p{L}*|стоимост\p{L}*|скольк\p{L}*|поч[её]м|прайс\p{L}*|смет\p{L}*|бюджет\p{L}*|куп\p{L}*|покуп\p{L}*|заказ\p{L}*|хочу|хотел\p{L}*|каталог\p{L}*|план\p{L}*|черт[её]ж\p{L}*|размер\p{L}*|габарит\p{L}*|площад\p{L}*|метраж\p{L}*|квадратур\p{L}*|строит\p{L}*|построит\p{L}*|ссыл\p{L}*|скинь\p{L}*|пришл\p{L}*|отправ\p{L}*|подроб\p{L}*|инфо\p{L}*|контакт\p{L}*|телефон\p{L}*|ва[тц]сап\p{L}*|ватсап\p{L}*|whatsapp|direct|директ\p{L}*|личк\p{L}*|price|project|house|plan|cost)(?=$|[^\p{L}\p{N}_])/iu.test(String(text||'').normalize('NFKC'));
const response=(text,status=200)=>new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
export async function validSignature(secret,raw,signature){
  if(!secret||!/^sha256=[a-f0-9]{64}$/i.test(signature||''))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.slice(7).match(/../g).map(v=>parseInt(v,16)));
  return crypto.subtle.verify('HMAC',key,bytes,raw);
}
export function createHandler(env,{fetch:send=fetch,now=()=>Date.now()}={}){
  async function rpc(name,args){
    const r=await send(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
    if(!r.ok)throw new Error('Outbox unavailable');return r.json();
  }
  // One fresh 48-hour access link per qualified comment; no permanent shared URL.
  async function issueCatalogLink(commentId){
    const token=crypto.randomUUID().replace(/-/g,'');
    const issuedAt=now();
    const row={
      label:'Instagram @arhittek.plans · '+commentId,
      token, floors_filter:'all', project_id:null,
      created_at:new Date(issuedAt).toISOString(),
      expires_at:new Date(issuedAt+48*60*60*1000).toISOString(),
    };
    const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=minimal'};
    const result=await send(env.SUPABASE_URL+'/rest/v1/share_links',{method:'POST',headers,body:JSON.stringify(row)});
    if(!result.ok)throw new Error('Failed to issue time-limited catalog access');
    const link=new URL('https://edmama121212-tech.github.io/arhittek-app/catalog.html');
    link.searchParams.set('t',token);
    link.searchParams.set('utm_source','instagram');
    link.searchParams.set('utm_medium','comment');
    link.searchParams.set('utm_campaign','arhittek_plans');
    return link.href;
  }
  return async function handle(req){
    const url=new URL(req.url);
    if(req.method==='GET'){
      if(!env.META_VERIFY_TOKEN)return response('Instagram is not connected',503);
      if(url.searchParams.get('hub.mode')==='subscribe'&&url.searchParams.get('hub.verify_token')===env.META_VERIFY_TOKEN&&url.searchParams.has('hub.challenge'))return response(url.searchParams.get('hub.challenge'));
      return response('Forbidden',403);
    }
    if(req.method!=='POST')return response('Method not allowed',405);
    // Fail closed until the owner connects their professional Instagram account.
    if(!env.META_APP_SECRET||!env.META_ACCESS_TOKEN||!env.META_IG_ACCOUNT_ID||!env.SUPABASE_SERVICE_ROLE_KEY||!/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||''))return response('Instagram is not connected',503);
    const host=env.META_GRAPH_HOST||'graph.facebook.com';
    if(!['graph.instagram.com','graph.facebook.com'].includes(host)||!/^\d+$/.test(env.META_IG_ACCOUNT_ID))return response('Invalid configuration',503);
    if(Number(req.headers.get('content-length')||0)>262144)return response('Payload too large',413);
    const raw=await req.arrayBuffer();if(raw.byteLength>262144)return response('Payload too large',413);
    if(!await validSignature(env.META_APP_SECRET,raw,req.headers.get('x-hub-signature-256')))return response('Invalid signature',401);
    let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch(_){return response('Invalid JSON',400);}
    if(body.object!=='instagram')return response('Ignored');
    try{
      for(const entry of body.entry||[]){
        if(String(entry.id)!==env.META_IG_ACCOUNT_ID)continue;
        for(const change of entry.changes||[]){
          const v=change.value;
          // Unified/Facebook Login emits comment_id; Instagram Login can emit id.
          const commentId=String(v?.comment_id||v?.id||'');
          // Meta can flag deleted or self-authored comments even if from.id uses a different scoped ID.
          if(change.field!=='comments'||!v||v.is_deleted===true||v.is_self===true||!hasProjectKeyword(v.text)||String(v.from?.id)===env.META_IG_ACCOUNT_ID||String(v.from?.username||'').toLowerCase()==='arhittek.plans'||!/^\d{1,100}$/.test(commentId))continue;
          const timestamp=Number(entry.time)*1000;
          if(!Number.isFinite(timestamp)||timestamp<now()-7*86400000||timestamp>now()+300000)continue;
          const job=await rpc('claim_instagram_catalog_reply',{p_comment:commentId,p_account:env.META_IG_ACCOUNT_ID,p_observed:new Date(timestamp).toISOString()});
          if(!job.claimed){if(job.state==='sending')return response('Delivery is in progress',503);continue;}
          const finish=(state,message=null,error=null)=>rpc('finish_instagram_catalog_reply',{p_comment:commentId,p_lease:job.lease,p_state:state,p_message:message,p_error:error});
          let catalog;
          try{catalog=await issueCatalogLink(commentId);}
          catch(_){await finish('pending',null,'Catalog link generation failed');return response('Catalog unavailable',503);}
          let r;
          try{
            r=await send('https://'+host+'/'+env.META_GRAPH_VERSION+'/'+env.META_IG_ACCOUNT_ID+'/messages',{
              method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.META_ACCESS_TOKEN,'Content-Type':'application/json'},
              body:JSON.stringify({recipient:{comment_id:commentId},message:{text:'Здравствуйте! 🏡\n\nКаталог готовых проектов частных домов ARHITTEK: '+catalog+'\n\nСсылка действительна 48 часов. В каталоге доступны фасады, планировки и цены. Выберите понравившийся проект и нажмите «Получить проект», чтобы написать нам в WhatsApp.'}}),
            });
          }catch(_){await finish('uncertain',null,'Network response lost; reconcile before resend');return response('Delivery requires reconciliation',503);}
          const data=await r.json().catch(()=>null);
          if(r.ok&&data?.message_id){await finish('sent',String(data.message_id));continue;}
          // A documented rejection is safe to retry; ambiguous 5xx responses
          // and malformed successes require reconciliation to avoid duplicates.
          const retry=r.status===429;
          await finish(retry?'pending':r.status>=500||r.ok?'uncertain':'failed',null,'Meta status '+r.status+' code '+String(data?.error?.code||'unknown'));
          if(retry||r.status>=500||r.ok)return response('Delivery not confirmed',503);
        }
      }
      return response('EVENT_RECEIVED');
    }catch(_){return response('Delivery service unavailable',503);}
  };
}
