// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-catalog-roof.cjs manifest.json
// Paths in the manifest are relative to the manifest. Run only after the 5 visual reviews.
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');

const endpoint = 'https://chbkkoxwzpaghanofvqk.supabase.co';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function publish(manifest, directory, api) {
  const {card_id:id, previous_plan:previous, expected_updated_at:version, review} = manifest;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
      !Object.hasOwn(manifest,'previous_plan') || !Object.hasOwn(manifest,'expected_updated_at') || !review || review.slot!=='roof' ||
      !Array.isArray(review.observations) || review.observations.length<5 ||
      review.revision!=='generated-render-v2-gray' || review.review_sha256!==review.file_sha256) {
    throw Error('Missing roof review or card snapshot');
  }
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path.resolve(directory, manifest.album_file))) digest.update(bytes);
  if (digest.digest('hex') !== review.album_hash) throw Error('Source album changed');
  const assets = [];
  for (const [file, expected] of [[manifest.image_file,review.file_sha256],[manifest.thumbnail_file,review.thumbnail_file_sha256]]) {
    const bytes = await fs.readFile(path.resolve(directory,file));
    if (bytes.toString('ascii',0,4)!=='RIFF' || bytes.toString('ascii',8,12)!=='WEBP' || hash(bytes)!==expected) throw Error('Reviewed WebP changed');
    assets.push({name:'cards/'+id+'/'+expected+'.webp',bytes,expected});
  }
  const assertRemote = async asset => {
    if (hash(await api.readFile(asset.name))!==asset.expected) throw Error('Storage returned different roof bytes');
  };
  for (const asset of assets) {
    await api.upload(asset.name, asset.bytes);
    await assertRemote(asset);
  }
  const payload = {p_card:id,p_previous_updated_at:version,p_previous:previous,p_review:review};
  await api.attach(payload);
  const card = await api.readCard(id);
  if (!card || card.deleted_at || card.pdf_import_meta?.sha256!==review.album_hash ||
      card.catalog_roof_plan?.album_hash!==review.album_hash || card.catalog_roof_plan?.revision!==review.revision ||
      card.catalog_roof_plan.file_sha256!==review.file_sha256 || card.catalog_roof_plan.thumbnail_file_sha256!==review.thumbnail_file_sha256) {
    throw Error('Catalog roof changed before readback');
  }
  for (const asset of assets) await assertRemote(asset);
  return {card_id:id,slot:'roof',file_sha256:review.file_sha256,thumbnail_file_sha256:review.thumbnail_file_sha256};
}

function supabase(key) {
  if (!key) throw Error('Set SUPABASE_SERVICE_ROLE_KEY for the catalog worker');
  const auth={apikey:key,Authorization:'Bearer '+key};
  async function json(route,options={}) {
    const response=await fetch(endpoint+route,{...options,redirect:'error',cache:'no-store',headers:{...auth,...options.headers}});
    if(!response.ok) throw Error('Supabase '+response.status+': '+(await response.text()).slice(0,500));
    return response.json();
  }
  const object='/storage/v1/object/';
  return {
    async upload(name,bytes){
      const response=await fetch(endpoint+object+'expense-photos/'+name,{method:'POST',redirect:'error',headers:{...auth,'Content-Type':'image/webp','x-upsert':'false'},body:bytes});
      if (response.ok) return;
      const error=await response.json().catch(()=>({}));
      if(response.status!==409 && Number(error.statusCode)!==409 && !['Duplicate','ResourceAlreadyExists'].includes(error.error)) throw Error('Storage upload failed: '+response.status);
    },
    async readFile(name){
      const r=await fetch(endpoint+object+'public/expense-photos/'+name,{cache:'no-store',redirect:'error'});
      if(!r.ok) throw Error('Storage read failed: '+r.status);
      return Buffer.from(await r.arrayBuffer());
    },
    attach:body=>json('/rest/v1/rpc/publish_catalog_roof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    async readCard(id){const rows=await json('/rest/v1/project_cards?id=eq.'+id+'&select=catalog_roof_plan,deleted_at,album:pdf_import_meta->>sha256');return rows[0]&&{...rows[0],pdf_import_meta:{sha256:rows[0].album}};}
  };
}
module.exports={publish};
if(require.main===module){
  (async()=>{
    const filename=path.resolve(process.argv[2]);
    const result=await publish(JSON.parse(await fs.readFile(filename,'utf8')),path.dirname(filename),supabase(process.env.SUPABASE_SERVICE_ROLE_KEY));
    console.log(JSON.stringify(result));
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
