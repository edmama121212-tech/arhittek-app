// Dedicated read-only export for the owner's Google Apps Script time trigger.
// Authenticated using a Google-issued OIDC ID token, not a shared/long-lived key.
// Do not expose Meta tokens, catalog access tokens, or message IDs to Sheets.
const OWNER_SUB_HASH = '24d0338823f00f46af09fcac1076c9de6fce3344bceb47194fc1a76a6869351d';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const bad=(status,message)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function bytesFromBase64Url(data){
  const safe=data.replace(/-/g,'+').replace(/_/g,'/');
  const decoded=atob(safe.padEnd(Math.ceil(safe.length/4)*4,'='));
  return Uint8Array.from(decoded,character=>character.charCodeAt(0));
}
const parse64=data=>JSON.parse(new TextDecoder().decode(bytesFromBase64Url(data)));
const toHex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
export async function verifyGoogleIdentityToken(token, {send=fetch, now=()=>Date.now(), ownerHash=OWNER_SUB_HASH}={}){
  if(typeof token!=='string'||token.length>5000||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))return false;
  try{
    const [h,p,s]=token.split('.');
    const header=parse64(h),claims=parse64(p),current=Math.floor(now()/1000);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>150) return false;
    if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss))return false;
    if(typeof claims.aud!=='string'||!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(claims.aud))return false;
    if(!Number.isInteger(claims.exp)||claims.exp<=current||!Number.isInteger(claims.iat)||claims.iat>current+120||claims.iat<current-7200)return false;
    if(typeof claims.sub!=='string'||!/^[0-9]{5,30}$/.test(claims.sub))return false;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(claims.sub));
    if(toHex(new Uint8Array(digest))!==ownerHash)return false;
    const response=await send(GOOGLE_JWKS_URL,{method:'GET',signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)return false;
    const jwks=await response.json();
    if(!Array.isArray(jwks.keys))return false;
    const jwk=jwks.keys.find(key=>key.kid===header.kid&&key.kty==='RSA'&&key.use==='sig');
    if(!jwk)return false;
    const imported=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,bytesFromBase64Url(s),new TextEncoder().encode(h+'.'+p));
  }catch(_){return false;}
}
export function createHandler(env,{send=fetch,verifyGoogle=verifyGoogleIdentityToken}={}){
  async function rpc(name,args={}){
    const url=new URL('/rest/v1/rpc/'+name,env.SUPABASE_URL);
    const res=await send(url.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{
      apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type':'application/json'
    },body:JSON.stringify(args)});
    if(!res.ok)throw new Error('Recipient export database unavailable');
    return res.json();
  }
  return async req=>{
    if(req.method!=='GET')return bad(405,'Method not allowed');
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return bad(503,'Export unavailable');
    const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]||'';
    if(!await verifyGoogle(token,{send}))return bad(401,'Unauthorized');
    let rows;
    try{rows=await rpc('instagram_sheet_confirmed_rows');}
    catch(_){return bad(503,'Recipient export unavailable');}
    if(!Array.isArray(rows))return bad(503,'Invalid export data');
    const host=env.META_GRAPH_HOST||'graph.facebook.com';
    const canEnrich=['graph.facebook.com','graph.instagram.com'].includes(host)&&
      /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||'')&&!!env.META_ACCESS_TOKEN;
    if(canEnrich){
      // Only previously confirmed recipients; best-effort, read-only Graph lookup.
      for(const item of rows.filter(r=>(!r.username||!r.comment_text)&&/^\d{1,100}$/.test(String(r.comment_id))).slice(0,8)){
        try{
          const url=new URL('https://'+host+'/'+env.META_GRAPH_VERSION+'/'+item.comment_id);
          url.searchParams.set('fields','username,text');
          const resp=await send(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(2500),headers:{Authorization:'Bearer '+env.META_ACCESS_TOKEN}});
          if(!resp.ok)continue;
          const detail=await resp.json();
          if(String(detail?.id||'')!==String(item.comment_id))continue;
          const username=String(detail.username||'').slice(0,30);
          const comment=String(detail.text||'').slice(0,500);
          if(!username&&!comment)continue;
          await rpc('backfill_instagram_confirmed_identity',{p_comment:item.comment_id,p_username:username,p_text:comment});
        }catch(_){/* A failed lookup must never expose data or block confirmed recipients. */}
      }
      try{rows=await rpc('instagram_sheet_confirmed_rows');}catch(_){return bad(503,'Recipient export unavailable');}
    }
    return json({rows,source:'ARHITTEK Instagram confirmed Direct'});
  };
}
