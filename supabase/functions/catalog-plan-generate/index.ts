import {createHandler} from './handler.js';
const modern=(name:string)=>{try{return JSON.parse(Deno.env.get(name)||'{}').default||'';}catch{return '';}};
const handler=createHandler({
 url:Deno.env.get('SUPABASE_URL')||'',
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||modern('SUPABASE_SECRET_KEYS'),
 anonKey:Deno.env.get('SUPABASE_ANON_KEY')||modern('SUPABASE_PUBLISHABLE_KEYS'),
 openaiKey:Deno.env.get('OPENAI_API_KEY')||'',
 imageModel:Deno.env.get('CATALOG_IMAGE_MODEL')||'gpt-image-2.5-sunburst',
 reviewModel:Deno.env.get('CATALOG_REVIEW_MODEL')||'gpt-5.4',
 waitUntil:(task:Promise<unknown>)=>EdgeRuntime.waitUntil(task),
});
Deno.serve(handler);
