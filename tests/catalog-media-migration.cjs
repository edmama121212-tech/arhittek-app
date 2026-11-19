const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {createHash,webcrypto} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const file = p=>readFileSync(require.resolve('../'+p),'utf8');
const sha = s=>createHash('sha256').update(s).digest('hex');
const dataUrl = s=>'data:image/webp;base64,'+Buffer.from(s).toString('base64');
const id='11111111-1111-4111-8111-111111111111';
async function run(){
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.has_admin_session() returns boolean language sql as 'select true';
      create table public.project_cards(id uuid primary key, updated_at timestamptz, deleted_at timestamptz,
        pdf_import_meta jsonb, images jsonb, thumbnails jsonb);`);
    await db.exec(file('supabase/migrations/20261119235500_catalog_media_cas.sql'));
    const revision='generated-render-v2-gray', album='a'.repeat(64);
    const review={revision,album_hash:album,file_sha256:sha('render'),review_sha256:sha('render'),
      thumbnail_file_sha256:sha('thumb'),approved_thumbnail:dataUrl('thumb')};
    const input={id,updated_at:'2026-11-19T12:00:00Z',pdf_import_meta:{sha256:album,render_review_floor1:review},
      images:[null,null,dataUrl('render')],thumbnails:[null,null,dataUrl('thumb')]};
    const clone=x=>JSON.parse(JSON.stringify(x)), objects=new Map();
    const bucket={
      async upload(key,blob,options){
        assert.equal(options.upsert,false); assert.equal(blob.type,'image/webp'); assert.equal(options.contentType,blob.type);
        assert.match(key,/\.webp$/);
        if(objects.has(key))return {error:{statusCode:'409'}};
        objects.set(key,blob); return {};
      },
      getPublicUrl:key=>({data:{publicUrl:'https://storage.test/'+key}})
    };
    let beforeWrite=async()=>{}, corrupt=false, writes=0;
    const get=async()=> (await db.query('select updated_at::text,images,thumbnails from project_cards where id=$1',[id])).rows[0];
    const sb={storage:{from:()=>bucket},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:await get()})}),
      async rpc(name,p){
        assert.equal(name,'migrate_catalog_media');
        await beforeWrite();
        const params=[p.p_id,p.p_version,p.p_album,...[p.p_old_images,p.p_old_thumbs,p.p_images,p.p_thumbs].map(v=>v===null?null:JSON.stringify(v))];
        const r=await db.query('select migrate_catalog_media($1,$2,$3,$4,$5,$6,$7)::text as stamp',params);
        if(r.rows[0].stamp)writes++;
        return {data:r.rows[0].stamp};
      }};
    const app=file('src/features/catalog/editor.js');
    const jobs=app.slice(app.indexOf('async function catalogMediaHash'),app.indexOf('// ── Рендер списка'));
    const context=vm.createContext({crypto:webcrypto,Uint8Array,Blob,sb,renderCardsList(){},canEditCards:()=>true,
      session:{token:1},CatalogFloors:{definitions:[{key:'floor1',image:2}]},cardsData:[],console:{warn(){}},
      dataURLtoBlob:src=>new Blob([Buffer.from(src.split(',')[1],'base64')],{type:'image/webp'}),
      makeThumbFromUrl:()=>{throw Error('Approved thumbnail was regenerated')},
      fetch:async url=>({ok:objects.has(url.slice('https://storage.test/'.length)),
        blob:async()=>corrupt?new Blob(['corrupt']):objects.get(url.slice('https://storage.test/'.length))})});
    vm.runInContext(jobs,context);
    async function reset(){
      await db.exec('delete from project_cards');
      await db.query('insert into project_cards values($1,$2,null,$3,$4,$5)',
        [id,input.updated_at,JSON.stringify(input.pdf_import_meta),JSON.stringify(input.images),JSON.stringify(input.thumbnails)]);
      context.cardsData=[clone(input)]; beforeWrite=async()=>{};corrupt=false;writes=0;
    }
    await reset(); await context.backfillCardThumbnails();
    assert.equal(writes,1); const row=await get();
    assert.ok(row.images[2].includes(sha('render')));assert.ok(row.thumbnails[2].includes(sha('thumb')));
    await context.backfillCardThumbnails();assert.equal(writes,1);
    await reset(); corrupt=true; await context.backfillCardThumbnails();
    assert.equal(writes,0);assert.deepEqual((await get()).images,input.images);
    for(const [column,value] of [['images',['new']],['thumbnails',['edited']],['pdf_import_meta',{sha256:'b'.repeat(64)}]]){
      await reset(); beforeWrite=()=>db.query('update project_cards set '+column+'=$1',[JSON.stringify(value)]);
      await context.backfillCardThumbnails(); assert.equal(writes,0,column+' changed during upload');
    }
    await reset(); context.cardsData[0].pdf_import_meta.render_review_floor1.review_sha256='';
    await context.backfillCardThumbnails(); assert.equal(writes,0);
    console.log('Verified byte transfer, MIME, retry, both slots, album conflict, invalid review and read-back.');
  }finally{await db.close()}
}
run().catch(error=>{console.error(error);process.exitCode=1});
