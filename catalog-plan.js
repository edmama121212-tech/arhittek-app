/* Deterministic catalogue drawings: source geometry, never invented walls. */
(function(root){
 'use strict';
 const VERSION='arhittek-plan-2',INK='#243447',BLUE='#2877c9',LIGHT='#8495a5';
 const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
 const roomNorm=s=>norm(s).replace(/^сп(?=\d|$)/,'спальня').replace(/^су(?=\d|$)/,'санузел').replace(/^каридор$/,'коридор').replace(/^кательная$/,'котельная');
 const roomName=s=>({сп:'Спальня',мсп:'Мастер-спальня',су:'Санузел',котельная:'Котельная',кательная:'Котельная'}[norm(s)]||String(s).replace(/^СП[-–\s]*(\d+)$/iu,'Спальня $1'));
 const box=points=>({x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))});
 const width=b=>b.x1-b.x0,height=b=>b.y1-b.y0;
 const union=bs=>({x0:Math.min(...bs.map(b=>b.x0)),y0:Math.min(...bs.map(b=>b.y0)),x1:Math.max(...bs.map(b=>b.x1)),y1:Math.max(...bs.map(b=>b.y1))});
 const inside=(x,y,b,pad=0)=>x>=b.x0-pad&&x<=b.x1+pad&&y>=b.y0-pad&&y<=b.y1+pad;
 const contains=(a,b,pad=0)=>inside(b.x0,b.y0,a,pad)&&inside(b.x1,b.y1,a,pad);
 const intersects=(a,b,pad=0)=>a.x0<=b.x1+pad&&a.x1>=b.x0-pad&&a.y0<=b.y1+pad&&a.y1>=b.y0-pad;
 const median=a=>a.length?a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]:1;
 const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const transform=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
 function rgb(value){
  if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
  if(Array.isArray(value)||ArrayBuffer.isView(value)){const a=Array.from(value);return a.slice(0,3).map(n=>n>1?n/255:n);}
  return null;
 }
 function shade(color){const a=rgb(color);return a?{gray:a.reduce((s,n)=>s+n,0)/3,saturation:Math.max(...a)-Math.min(...a)}:null;}
 function unpack(raw,matrix){
  if(!Array.isArray(raw)&&!ArrayBuffer.isView(raw))return [];
  const paths=[];let commands=[],points=[],curved=false,closed=false;
  const flush=()=>{if(points.length){paths.push({commands,bounds:box(points),points,curved,closed});commands=[];points=[];curved=false;closed=false;}};
  for(let i=0;i<raw.length;){
   const op=raw[i++];if(op===0)flush();
   if(op===4){commands.push([4]);closed=true;continue;}
   const count=op===0||op===1?2:op===2?6:op===3?4:0;if(!count)break;
   const coords=[];for(let j=0;j<count;j+=2){const p=transform(matrix,raw[i+j],raw[i+j+1]);coords.push(...p);points.push(p);}i+=count;
   commands.push([op,...coords]);curved ||=op===2||op===3;
  }flush();return paths;
 }
 function vectors(pdfjs,operators,viewport,check=()=>{},optionalContent){
  const O=pdfjs.OPS,stack=[],marked=[],paths=[];let visible=true;let state={matrix:[1,0,0,1,0,0],fill:'#000000',pattern:false,stroke:'#000000',dash:false,lineWidth:1,fillAlpha:1,strokeAlpha:1,clips:[],pendingClip:null};
  for(let i=0;i<operators.fnArray.length;i++){
   if(i%300===0)check();const op=operators.fnArray[i],a=operators.argsArray[i]||[];
   if(op===O.beginMarkedContent||op===O.beginMarkedContentProps){marked.push(visible);if(op===O.beginMarkedContentProps&&a[0]==='OC'&&optionalContent)visible=visible&&optionalContent.isVisible(a[1]);}
   else if(op===O.endMarkedContent)visible=marked.pop()??true;
   else if(op===O.save||op===O.paintFormXObjectBegin){stack.push({...state,matrix:state.matrix.slice()});if(op===O.paintFormXObjectBegin&&a[0])state.matrix=multiply(state.matrix,a[0]);}
   else if(op===O.restore||op===O.paintFormXObjectEnd)state=stack.pop()||state;
   else if(op===O.transform)state.matrix=multiply(state.matrix,a);
   else if(op===O.clip)state.pendingClip='nonzero';
   else if(op===O.eoClip)state.pendingClip='evenodd';
   else if(op===O.setGState){for(const [key,value]of a[0]||[]){if(key==='LW')state.lineWidth=value;else if(key==='D')state.dash=!!value[0]?.length;else if(key==='ca')state.fillAlpha=value;else if(key==='CA')state.strokeAlpha=value;}}
   else if(op===O.setLineWidth)state.lineWidth=a[0];
   else if(op===O.setDash)state.dash=!!a[0]?.length;
   else if(op===O.setFillRGBColor){state.fill=a[0];state.pattern=false;}
   else if(op===O.setStrokeRGBColor)state.stroke=a[0];
   else if(op===O.setFillGray){state.fill=[a[0],a[0],a[0]];state.pattern=false;}
   else if(op===O.setStrokeGray)state.stroke=[a[0],a[0],a[0]];
   else if(op===O.setFillColorN){state.fill=null;state.pattern=true;}
   else if(op===O.setFillTransparent){state.fill=null;state.pattern=false;}
   else if(op===O.setStrokeColorN||op===O.setStrokeTransparent)state.stroke=null;
   else if(op===O.constructPath){
    const paint=a[0],filled=visible&&state.fillAlpha>=.95&&[O.fill,O.eoFill,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke].includes(paint),stroked=visible&&state.strokeAlpha>=.95&&[O.stroke,O.closeStroke,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke].includes(paint);
    const m=multiply(viewport.transform,state.matrix),decoded=unpack(a[1]?.[0],m),evenOdd=[O.eoFill,O.eoFillStroke,O.closeEOFillStroke].includes(paint);
    // Compound filled contours must retain their holes and PDF fill rule.
    const combined=[];
    for(const p of (filled?decoded.slice().sort((x,y)=>width(y.bounds)*height(y.bounds)-width(x.bounds)*height(x.bounds)):decoded)){
     const parent=filled&&combined.find(q=>contains(q.bounds,p.bounds));
     if(parent){parent.commands.push(...p.commands);parent.points.push(...p.points);}else combined.push({...p,commands:p.commands.slice(),points:p.points.slice()});
    }
    if(filled||stroked)for(const p of combined){
     let bounds={...p.bounds};for(const clip of state.clips){if(!clip.paths.length)continue;const b=union(clip.paths.map(q=>q.bounds));bounds={x0:Math.max(bounds.x0,b.x0),y0:Math.max(bounds.y0,b.y0),x1:Math.min(bounds.x1,b.x1),y1:Math.min(bounds.y1,b.y1)};}
     if(bounds.x1<bounds.x0||bounds.y1<bounds.y0)continue;
     paths.push({...p,bounds,uniform:Math.abs(Math.hypot(m[0],m[1])/Math.hypot(m[2],m[3])-1)<.005,evenOdd,clips:state.clips,sequence:i,pattern:state.pattern,closed:p.closed||filled||[O.closeStroke,O.closeFillStroke,O.closeEOFillStroke].includes(paint),filled,stroked,fill:shade(state.fill),stroke:shade(state.stroke),dash:state.dash,lineWidth:Math.abs(state.lineWidth)*(Math.hypot(m[0],m[1])+Math.hypot(m[2],m[3]))/2});
    }
    if(state.pendingClip){state.clips=state.clips.concat([{paths:decoded,rule:state.pendingClip}]);state.pendingClip=null;}
   }
  }return paths;
 }
 function groups(paths,gap){
  const out=[];for(const p of paths.slice().sort((a,b)=>a.bounds.x0-b.bounds.x0)){
   let g=out.at(-1);if(!g||p.bounds.x0>g.bounds.x1+gap){g={paths:[],bounds:p.bounds};out.push(g);}g.paths.push(p);g.bounds=union([g.bounds,p.bounds]);
  }return out;
 }
 function chooseStructure(paths,info,key){
  const headings=CatalogPdfCore.planInfos(info,3),heading=headings.find(h=>h.floor===key);
  let walls=paths.filter(p=>p.filled&&p.fill&&p.fill.saturation<.08&&p.fill.gray<.85&&!info.items.some(w=>p.commands.length<=12&&contains(p.bounds,w,w.h*.25)&&height(p.bounds)<w.h*2.8&&width(p.bounds)<w.x1-w.x0+w.h*4)&&!(width(p.bounds)>info.width*.6&&(p.bounds.y1<info.height*.07||p.bounds.y0>info.height*.9))&&!(p.commands.length<=4&&Math.max(width(p.bounds),height(p.bounds))<Math.min(info.width,info.height)*.02)&&width(p.bounds)*height(p.bounds)>1&&!p.curved&&width(p.bounds)<info.width*.95&&height(p.bounds)<info.height*.9);
  {
   // Uncoloured Archicad walls are white polygons with repeated diagonal hatching.
   // A white window infill has no such hatching and must remain an opening.
   const hatches=[];
   for(const p of paths.filter(p=>p.stroked&&!p.curved&&!p.dash&&p.stroke&&p.stroke.gray<.4)){
    let previous;for(const c of p.commands){if(c[0]===0){previous=[c[1],c[2]];continue;}if(c[0]!==1||!previous)continue;const next=[c[1],c[2]],b=box([previous,next]),ratio=width(b)/height(b);if(width(b)>.3&&height(b)>.3&&ratio>.65&&ratio<1.5)hatches.push({bounds:b,sequence:p.sequence});previous=next;}
   }
   const hatched=paths.filter(p=>p.filled&&p.fill?.gray>.985&&!p.curved&&width(p.bounds)*height(p.bounds)>2&&(Math.min(width(p.bounds),height(p.bounds))<Math.max(info.width,info.height)*.045||p.commands.filter(c=>c[0]===0).length>1)&&hatches.filter(h=>h.sequence>p.sequence&&contains(p.bounds,h.bounds,.15)).length>=2);
   const extent=ps=>ps.reduce((v,p)=>v+Math.max(width(p.bounds),height(p.bounds)),0);if(hatched.length>=3&&extent(hatched)>extent(walls)*1.3)walls=hatched;
  }
  let fallback=false;
  if(walls.length<3&&!walls.some(p=>p.commands.filter(c=>c[0]===0).length>1&&width(p.bounds)>info.width*.12&&height(p.bounds)>info.height*.12)){
   // Stroke-only exports must have an explicit, closed main outline.
   const outlines=paths.filter(p=>p.stroked&&!p.dash&&p.closed&&width(p.bounds)>info.width*.12&&height(p.bounds)>info.height*.12&&width(p.bounds)<info.width*.9&&height(p.bounds)<info.height*.85);
   if(!outlines.length)return null;
   walls=outlines;fallback=true;
  }
  let clusters=groups(walls,info.width*.035).filter(g=>width(g.bounds)>info.width*.1&&height(g.bounds)>info.height*.1);
  // A continuous source floor polygon can join wall groups separated by
  // wide openings. Separate drawings have separate floor footprints.
  const bridges=paths.filter(p=>p.filled&&p.fill&&(p.fill.saturation>.08||p.fill.gray>=.85&&p.fill.gray<.985)&&width(p.bounds)<info.width*.9&&height(p.bounds)<info.height*.85);
  for(const p of bridges){const joined=clusters.filter(g=>intersects(g.bounds,p.bounds));if(joined.length<2)continue;const merged={paths:joined.flatMap(g=>g.paths),bounds:union(joined.map(g=>g.bounds))};clusters=clusters.filter(g=>!joined.includes(g));clusters.push(merged);}
  clusters.sort((a,b)=>a.bounds.x0-b.bounds.x0);
  if(!clusters.length)return null;
  // Match left-to-right drawings to their actual floor headings, not to a whole sheet.
  const ordered=headings.slice().sort((a,b)=>a.cx-b.cx),position=ordered.findIndex(h=>h.floor===key);
  let selected;
  if(clusters.length===ordered.length&&position>=0)selected=clusters[position];
  else if(clusters.length===1&&headings.length<=1)selected=clusters[0];
  else if(heading){const ranked=clusters.map(g=>({g,d:Math.abs((g.bounds.x0+g.bounds.x1)/2-heading.cx)/info.width+Math.abs(g.bounds.y0-heading.cy)/info.height*.2})).sort((a,b)=>a.d-b.d);if(ranked[1]&&ranked[1].d-ranked[0].d<.06)return null;selected=ranked[0].g;}
  if(!selected)return null;
  let bounds=selected.bounds;
  const floors=paths.filter(p=>p.filled&&p.fill&&(p.fill.saturation>.08||p.fill.gray>=.85&&p.fill.gray<.985)&&p.closed&&width(p.bounds)*height(p.bounds)>20&&width(p.bounds)<info.width*.8&&height(p.bounds)<info.height*.8);
  let attached=[];
  for(let round=0;round<3;round++){
   attached=floors.filter(p=>intersects(p.bounds,bounds,1)&&width(p.bounds)<width(selected.bounds)*1.3&&height(p.bounds)<height(selected.bounds)*1.3&&!clusters.some(g=>g!==selected&&intersects(p.bounds,g.bounds)));
   if(attached.length)bounds=union([selected.bounds,...attached.map(p=>p.bounds)]);
  }
  const local=paths.filter(p=>contains(bounds,p.bounds,.7));
  const thickness=median(selected.paths.map(p=>Math.min(width(p.bounds),height(p.bounds))).filter(n=>n>.2&&n<Math.max(width(bounds),height(bounds))*.06));
  return {context:paths,bounds,walls:selected.paths,floors:attached,local,thickness:Math.max(.6,thickness),fallback};
 }
 function labels(info,structure,table){
  const b=structure.bounds,rows=table?.rows||[];
  const words=info.items.filter(w=>inside(w.cx,w.cy,b)&&!info.tables?.some(t=>inside(w.cx,w.cy,{x0:t.left,y0:t.top-4,x1:t.right,y1:t.bottom+4})));
  const results=[],used=new Set();
  for(const w of words){
   const t=roomNorm(w.text),matches=rows.filter(r=>roomNorm(r.name)===t||(t.length>=5&&roomNorm(r.name).startsWith(t)));
   if(!matches.length)continue;
   const source=matches[0];
   if(results.some(r=>r.raw===source.name&&Math.hypot(r.x-w.cx,r.y-w.cy)<w.h*3))continue;
   results.push({name:roomName(source.name),raw:source.name,area:CatalogPdfCore.number(source.area),x:w.cx,y:w.cy});used.add(w);
  }
  // A complete, unique room-number layout must span the building. A compact
  // staircase numbering run cannot establish room positions.
  const idKey=s=>String(s||'').split(/[./:\\-]/).at(-1).replace(/^0+(?=\d)/,'');
  const ids=(table?.roomIds||[]).map(idKey),numberWords=words.filter(w=>/^\d{1,3}$/.test(w.text));
  let consensus=null;
  if(rows.length>=3&&ids.every(Boolean)&&new Set(ids).size===rows.length){
   for(const seed of numberWords.slice().sort((a,b)=>b.h-a.h)){
    const similar=numberWords.filter(w=>Math.abs(w.h/seed.h-1)<.15),matches=ids.map(id=>similar.filter(w=>idKey(w.text)===id));
    if(!matches.every(a=>a.length===1))continue;const found=matches.map(a=>a[0]),xs=found.map(w=>w.cx),ys=found.map(w=>w.cy);
    if(Math.max(...xs)-Math.min(...xs)<width(b)*.4||Math.max(...ys)-Math.min(...ys)<height(b)*.4)continue;
    consensus=found;break;
   }
  }
  // CAD room bubbles may be true curves or dozens of tiny straight edges.
  // Require a closed ring around the number; staircase digits have no ring.
  const edges=[];
  for(const p of structure.local){if(!p.stroked||p.dash)continue;let prev;for(const c of p.commands){if(c[0]===0){prev=[c[1],c[2]];continue;}if(c[0]!==1||!prev)continue;const q=[c[1],c[2]],dx=q[0]-prev[0],dy=q[1]-prev[1],len=Math.hypot(dx,dy);if(len>0)edges.push({x:(prev[0]+q[0])/2,y:(prev[1]+q[1])/2,dx:dx/len,dy:dy/len,len});prev=q;}}
  const ringCache=new Map(),ring=w=>{
   if(ringCache.has(w))return ringCache.get(w);let found=false;
   const curved=structure.local.some(p=>p.curved&&p.closed&&contains(p.bounds,w,w.h*.25)&&width(p.bounds)<w.h*5&&height(p.bounds)<w.h*5&&width(p.bounds)>w.h&&height(p.bounds)>w.h);
   if(curved)found=true;
   const local=edges.filter(e=>e.len<w.h*.8&&Math.abs(e.x-w.cx)<w.h*3&&Math.abs(e.y-w.cy)<w.h*3);
   for(const cy of [w.cy,w.cy+w.h*.2])for(let radius=w.h*.7;!found&&radius<w.h*2.3;radius+=w.h*.2){const sectors=new Set();let count=0;for(const e of local){const x=e.x-w.cx,y=e.y-cy,d=Math.hypot(x,y);if(Math.abs(d-radius)>w.h*.23||Math.abs((x*e.dx+y*e.dy)/d)>.23)continue;count++;sectors.add(Math.floor((Math.atan2(y,x)+Math.PI)/(Math.PI*2)*12)%12);}if(count>=12&&sectors.size>=10)found=true;}
   ringCache.set(w,found);return found;
  };
  // Number-only rooms need a matching, spatially adjacent printed room area.
  if(table?.roomIds)for(let i=0;i<rows.length;i++){
   const id=table.roomIds[i];if(!id)continue;
   const remaining=rows.slice(0,i+1).filter(r=>r.name===rows[i].name).length-results.filter(r=>r.raw===rows[i].name).length;if(remaining<=0)continue;
   const found=words.filter(w=>!used.has(w)&&idKey(w.text)===idKey(id)).filter(w=>consensus?consensus[i]===w:ring(w)||words.some(a=>a!==w&&Math.abs(a.cx-w.cx)<w.h*7&&Math.abs(a.cy-w.cy)<w.h*6&&CatalogPdfCore.number(a.text.replace(/м[²2].*/iu,''))===CatalogPdfCore.number(rows[i].area)));
   if(found.length!==1)continue;const w=found[0];used.add(w);results.push({name:roomName(rows[i].name),raw:rows[i].name,area:CatalogPdfCore.number(rows[i].area),x:w.cx,y:w.cy});
  }
  return {items:results,complete:!!rows.length&&rows.every(r=>results.filter(x=>x.raw===r.name).length===rows.filter(x=>x.name===r.name).length)};
 }
 function stairZones(info,b){
  const numbers=info.items.filter(w=>inside(w.cx,w.cy,b)&&/^\d{1,2}$/.test(w.text)&&Number(w.text)<=40);
  const zones=[];for(const w of numbers){const column=numbers.filter(v=>Math.abs(v.cx-w.cx)<w.h*5&&Math.abs(v.cy-w.cy)<w.h*35);if(new Set(column.map(v=>v.text)).size<7)continue;const r=union(column.map(v=>({x0:v.x0,y0:v.y0,x1:v.x1,y1:v.y1})));const pad=w.h*7;const z={x0:r.x0-pad,y0:r.y0-pad*.3,x1:r.x1+pad,y1:r.y1+pad*.3};if(!zones.some(v=>intersects(v,z)))zones.push(z);}return zones;
 }
 function details(info,s,roomLabels){
  if(s.fallback)return s.local.filter(p=>p.stroked&&!p.dash&&p.stroke&&p.stroke.gray<.85&&p.lineWidth>=.8);
  const t=s.thickness,b=s.bounds,stairs=stairZones(info,b);
  const names=info.items.filter(w=>inside(w.cx,w.cy,b)&&/[а-яё]/iu.test(w.text)&&!/^\d|м[²2]/iu.test(w.text));
  const annotations=names.map(w=>({x0:w.x0-w.h*3,y0:w.y0-w.h*3,x1:w.x1+w.h*3,y1:w.y1+w.h*3}));
  for(const r of roomLabels?.items||[]){const h=median(info.items.filter(w=>Math.hypot(w.cx-r.x,w.cy-r.y)<w.h*2).map(w=>w.h));annotations.push({x0:r.x-h*3,y0:r.y-h*3,x1:r.x+h*3,y1:r.y+h*3});}
  const clean=p=>!annotations.some(a=>contains(a,p.bounds))&&!s.walls.some(w=>contains(w.bounds,p.bounds,.01))&&(!s.floors.length||[...s.floors,...s.walls].some(w=>intersects(w.bounds,p.bounds,t*1.2)));
  const arcs=s.local.filter(p=>p.stroked&&!p.dash&&clean(p)&&p.curved&&width(p.bounds)>t*.8&&height(p.bounds)>t*.8&&Math.max(width(p.bounds),height(p.bounds))<Math.max(width(b),height(b))*.18);
  const nearArc=p=>p.points.some(v=>arcs.some(a=>a.points.some(q=>Math.hypot(v[0]-q[0],v[1]-q[1])<t*.3)));
  const inBand=p=>{
   const r=p.bounds,horizontal=height(r)<t*.7,vertical=width(r)<t*.7;
   if(!horizontal&&!vertical)return false;
   return s.walls.some(w=>{const q=w.bounds;if(!inside((r.x0+r.x1)/2,(r.y0+r.y1)/2,q,t*.45))return false;return horizontal&&height(q)<t*2.2&&(Math.abs(r.y0-q.y0)<t*.7||Math.abs(r.y1-q.y1)<t*.7)&&width(r)<t*20||vertical&&width(q)<t*2.2&&(Math.abs(r.x0-q.x0)<t*.7||Math.abs(r.x1-q.x1)<t*.7)&&height(r)<t*20;});
  };
  return s.local.filter(p=>{if(!p.stroked||p.dash||!p.stroke||p.stroke.gray>=.85||!clean(p))return false;const door=arcs.includes(p)||nearArc(p),stair=stairs.some(z=>contains(z,p.bounds)&&Math.max(width(p.bounds),height(p.bounds))<Math.max(width(z),height(z))*.95);p.detailRole=door||stair?'detail':'window';return door||stair||inBand(p);});
 }
 function contours(p){
  const out=[];let points=[];for(const c of p.commands){if(c[0]===0&&points.length){out.push(points);points=[];}if(c[0]===0||c[0]===1)points.push([c[1],c[2]]);}if(points.length)out.push(points);return out;
 }
 function pointIn(points,x,y){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
 function polygonArea(p){
  const rings=contours(p);const signed=a=>a.reduce((v,q,i)=>{const n=a[(i+1)%a.length];return v+q[0]*n[1]-n[0]*q[1];},0)/2;
  if(!p.evenOdd)return Math.abs(rings.reduce((v,a)=>v+signed(a),0));
  return rings.reduce((v,a,i)=>v+Math.abs(signed(a))*(rings.filter((b,j)=>i!==j&&pointIn(b,a[0][0],a[0][1])).length%2?-1:1),0);
 }
 function areaCalibration(info,s,roomLabels){
  if(!roomLabels||s.fallback)return null;
  const estimates=[];
  for(const r of roomLabels.items){
   const printed=info.items.map(w=>({w,m:w.text.match(/^(\d+(?:[.,]\d{1,2})?)\s*(?:м\s*[²2]?)?$/iu)})).filter(v=>v.m&&(/[.,]|м/iu.test(v.w.text))&&Math.abs(v.w.cx-r.x)<v.w.h*9&&Math.abs(v.w.cy-r.y)<v.w.h*7).sort((a,b)=>Math.hypot(a.w.cx-r.x,a.w.cy-r.y)-Math.hypot(b.w.cx-r.x,b.w.cy-r.y))[0];
   const footprints=[];
   for(const p of s.floors){
    const clipped=(p.clips||[]).flatMap(c=>c.paths).filter(q=>!q.curved&&contours(q).filter(a=>pointIn(a,r.x,r.y)).length%2===1);
    footprints.push(...clipped);
    if(!p.curved&&contours(p).filter(a=>pointIn(a,r.x,r.y)).length%2===1)footprints.push(p);
   }
   const floor=footprints.sort((a,b)=>polygonArea(a)-polygonArea(b))[0];
   if(!floor)continue;const area=printed?CatalogPdfCore.number(printed.m[1]):r.area,geometry=polygonArea(floor);if(!area||area<1||area>1000||geometry<=0)continue;
   estimates.push(Math.sqrt(area*1000000/geometry));
  }
  if(estimates.length<3)return null;const scale=median(estimates),agree=estimates.filter(n=>Math.abs(n/scale-1)<.005);
  if(agree.length<3||agree.length<estimates.length*.7)return null;
  return {widthMm:Math.round(width(s.bounds)*scale/10)*10,heightMm:Math.round(height(s.bounds)*scale/10)*10,derived:['width','height'],basis:'source-room-area-consensus',calibratedRooms:agree.length};
 }
 function dimensions(info,s,roomLabels){
  const b=s.bounds,pad=Math.max(width(b),height(b))*.18;
  const entries=info.items.filter(w=>inside(w.cx,w.cy,b,pad)&&!inside(w.cx,w.cy,b)&&/^\d[\d\s\u00a0]*$/.test(w.text)).map(w=>({...w,n:CatalogPdfCore.number(w.text)})).filter(w=>w.n>=2000&&w.n<=100000);
  // Whole-building values need a spanning dimension line, not merely a
  // nearby roof/room dimension that happens to be the largest on the sheet.
  const witnessed=(w,vertical)=>{
   const start=vertical?b.y0:b.x0,end=vertical?b.y1:b.x1,length=end-start,axis=vertical?w.cx:w.cy,segments=[];
   for(const p of s.context||s.local){
    if(!p.stroked||p.dash||p.curved||p.lineWidth>w.h*.25)continue;
    let prev;for(const c of p.commands){if(c[0]===0){prev=[c[1],c[2]];continue;}if(c[0]!==1||!prev)continue;
     const q=[c[1],c[2]],a=vertical?prev[1]:prev[0],z=vertical?q[1]:q[0],u=vertical?prev[0]:prev[1],v=vertical?q[0]:q[1];
     if(Math.abs(u-v)<.5&&Math.abs(u-axis)<w.h*2.5&&Math.abs(z-a)>length*.05)segments.push({lo:Math.min(a,z),hi:Math.max(a,z),axis:u});prev=q;
    }
   }
   return segments.some(seed=>{const group=segments.filter(v=>Math.abs(v.axis-seed.axis)<1),lo=Math.min(...group.map(v=>v.lo)),hi=Math.max(...group.map(v=>v.hi));return Math.abs(lo-start)<length*.05&&Math.abs(hi-end)<length*.05&&group.reduce((n,v)=>n+v.hi-v.lo,0)>length*.7;});
  };
  const horizontal=entries.filter(w=>!w.vertical&&witnessed(w,false)&&(w.cy<b.y0||w.cy>b.y1)&&w.cx>b.x0&&w.cx<b.x1).sort((a,b)=>b.n-a.n)[0];
  const vertical=entries.filter(w=>w.vertical&&witnessed(w,true)&&(w.cx<b.x0||w.cx>b.x1)&&w.cy>b.y0&&w.cy<b.y1).sort((a,b)=>b.n-a.n)[0];
  const calibration=areaCalibration(info,s,roomLabels);
  let x=horizontal?.n,y=vertical?.n;const derived=[];
  if(calibration&&(x&&Math.abs(x/calibration.widthMm-1)>.025||y&&Math.abs(y/calibration.heightMm-1)>.025))return calibration;
  if(x&&y&&Math.abs((x/y)/(width(b)/height(b))-1)>.05)return null;
  if(x&&!y){y=Math.round(x*height(b)/width(b)/10)*10;derived.push('height');}
  if(y&&!x){x=Math.round(y*width(b)/height(b)/10)*10;derived.push('width');}
  // A declared drawing scale is another exact coordinate reference.
  if(!x&&!y){const scale=info.items.find(w=>/^1\s*:\s*(20|25|50|75|100|150|200)$/.test(w.text)&&Math.abs(w.cy-b.y0)<info.height*.2&&w.cx>=b.x0&&w.cx<=b.x1);if(scale){const ratio=Number(scale.text.split(':')[1])*25.4/72;x=Math.round(width(b)*ratio/10)*10;y=Math.round(height(b)*ratio/10)*10;derived.push('width','height');}}
  const floorArea=(roomLabels?.items||[]).reduce((v,r)=>v+(r.area||0),0);
  if(x&&y&&floorArea&&x*y/1000000<floorArea*.7)return calibration;
  return x&&y?{widthMm:x,heightMm:y,derived,basis:'source-dimensions-or-scale'}:areaCalibration(info,s,roomLabels);
 }
 function path(ctx,p,map,begin=true){
  if(begin)ctx.beginPath();for(const c of p.commands){if(c[0]===4){ctx.closePath();continue;}const v=[];for(let i=1;i<c.length;i+=2)v.push(...map(c[i],c[i+1]));if(c[0]===0)ctx.moveTo(...v);else if(c[0]===1)ctx.lineTo(...v);else if(c[0]===2)ctx.bezierCurveTo(...v);else if(c[0]===3)ctx.quadraticCurveTo(...v);}
 }
 function watermark(ctx,x,y){
  ctx.save();ctx.translate(x,y);ctx.rotate(-Math.PI/4);ctx.globalAlpha=.075;ctx.fillStyle=BLUE;
  ctx.save();ctx.translate(-22,-42);ctx.scale(44/318,44/318);ctx.beginPath();for(const [i,p]of [[0,[0,157]],[1,[157,0]],[1,[318,157]],[1,[318,268]],[1,[84,268]],[1,[84,237]],[1,[278,237]],[1,[278,174]],[1,[158,56]],[1,[40,174]],[1,[40,268]],[1,[0,268]]])i?ctx.lineTo(...p):ctx.moveTo(...p);ctx.closePath();ctx.fill();ctx.restore();
  ctx.font='18px Arial, sans-serif';ctx.textAlign='center';ctx.fillText('+79226593872',0,20);ctx.restore();
 }
 function draw(s,roomLabels,dims,key,info){
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1600;const c=canvas.getContext('2d'),b=s.bounds,scale=Math.min(1400/width(b),1040/height(b));
  const left=(1800-width(b)*scale)/2+30,top=270+(1040-height(b)*scale)/2,map=(x,y)=>[left+(x-b.x0)*scale,top+(y-b.y0)*scale];
  c.fillStyle='#fff';c.fillRect(0,0,1800,1600);c.fillStyle=BLUE;c.font='bold 27px Arial, sans-serif';c.fillText('ARHITTEK',170,84);
  c.fillStyle=INK;c.font='bold 43px Arial, sans-serif';c.fillText(key==='basement'?'План цокольного этажа':'План '+key.slice(5)+'-го этажа',170,190);
  c.strokeStyle='#e8edf3';c.lineWidth=2;c.beginPath();c.moveTo(170,115);c.lineTo(1630,115);c.stroke();
  const selectedDetails=new Set(details(info,s,roomLabels)),wallSet=new Set(s.walls);
  // Respect source paint order: a later opaque floor hides construction marks
  // and lower-storey geometry exactly as in the PDF. It must not be resurrected.
  for(const p of s.local){
   c.save();for(const clip of p.clips||[]){c.beginPath();for(const shape of clip.paths)path(c,shape,map,false);c.clip(clip.rule);}
   if(p.filled&&(p.pattern||p.fill&&p.fill.saturation<.08&&(wallSet.has(p)||p.fill.gray>=.85))){
    path(c,p,map);c.fillStyle=wallSet.has(p)?INK:'#fbfcfd';c.fill(p.evenOdd?'evenodd':'nonzero');if(wallSet.has(p)){c.strokeStyle=INK;c.lineWidth=.45;c.stroke();}
   }
   if(selectedDetails.has(p)){path(c,p,map);c.strokeStyle=p.detailRole==='detail'?LIGHT:BLUE;c.lineWidth=p.detailRole==='detail'?2.1:1.35;c.stroke();}
   c.restore();
  }
  c.save();c.beginPath();
  if(s.floors.length)for(const p of s.floors)path(c,p,map,false);else c.rect(left,top,width(b)*scale,height(b)*scale);
  c.clip();c.globalCompositeOperation='multiply';
  for(let y=top+120;y<top+height(b)*scale;y+=320)for(let x=left+130;x<left+width(b)*scale;x+=360)watermark(c,x,y);
  c.restore();
  for(const r of roomLabels.items){
   let [x,y]=map(r.x,r.y);let l=b.x0,rt=b.x1;
   for(const p of s.walls){const q=p.bounds;if(r.y<q.y0||r.y>q.y1)continue;if(q.x1<=r.x)l=Math.max(l,q.x1);if(q.x0>=r.x)rt=Math.min(rt,q.x0);}
   const max=Math.max(55,(rt-l)*scale*.84);let size=24;while(size>11){c.font='600 '+size+'px Arial, sans-serif';if(c.measureText(r.name).width<=max)break;size--;}
   const lines=c.measureText(r.name).width>max&&r.name.includes('-')?r.name.split('-'):r.name.includes(' ')&&c.measureText(r.name).width>max?r.name.split(' '):[r.name];
   const textWidth=Math.min(max,Math.max(...lines.map(line=>c.measureText(line).width))),lx=map(l,r.y)[0]+textWidth/2+4,rx=map(rt,r.y)[0]-textWidth/2-4;if(lx<=rx)x=Math.max(lx,Math.min(rx,x));
   c.fillStyle=INK;c.textAlign='center';c.textBaseline='middle';lines.forEach((line,i)=>c.fillText(line,x,y+(i-(lines.length-1)/2)*(size+3),max));
  }
  if(dims?.widthMm&&dims?.heightMm){
  c.textBaseline='alphabetic';c.font='26px Arial, sans-serif';c.fillStyle=BLUE;c.strokeStyle=BLUE;c.lineWidth=2;
  const right=left+width(b)*scale,bottom=top+height(b)*scale,dy=bottom+80,dx=left-70,fmt=n=>Math.round(n).toLocaleString('ru-RU');
  c.beginPath();c.moveTo(left,dy);c.lineTo(right,dy);c.moveTo(dx,top);c.lineTo(dx,bottom);c.stroke();
  for(const x of [left,right]){c.strokeStyle='#b6c5d5';c.beginPath();c.moveTo(x,bottom+14);c.lineTo(x,dy+15);c.stroke();c.strokeStyle=BLUE;c.beginPath();c.moveTo(x-8,dy+8);c.lineTo(x+8,dy-8);c.stroke();}
  for(const y of [top,bottom]){c.strokeStyle='#b6c5d5';c.beginPath();c.moveTo(dx-15,y);c.lineTo(left-14,y);c.stroke();c.strokeStyle=BLUE;c.beginPath();c.moveTo(dx-8,y+8);c.lineTo(dx+8,y-8);c.stroke();}
  const label=(dims.derived?.includes('width')?'≈ ':'')+fmt(dims.widthMm),measure=c.measureText(label).width;c.fillStyle='#fff';c.fillRect((left+right)/2-measure/2-12,dy-25,measure+24,40);c.fillStyle=BLUE;c.textAlign='center';c.fillText(label,(left+right)/2,dy+9);
  c.save();c.translate(dx,(top+bottom)/2);c.rotate(-Math.PI/2);const h=(dims.derived?.includes('height')?'≈ ':'')+fmt(dims.heightMm),w=c.measureText(h).width;c.fillStyle='#fff';c.fillRect(-w/2-12,-25,w+24,40);c.fillStyle=BLUE;c.fillText(h,0,9);c.restore();
  c.fillStyle='#8796a6';c.font='16px Arial, sans-serif';c.textAlign='right';c.fillText('Габариты в мм',1630,1538);
  }
  const image=canvas.toDataURL('image/png'),thumb=document.createElement('canvas');thumb.width=270;thumb.height=240;thumb.getContext('2d').drawImage(canvas,0,0,270,240);const thumbnail=thumb.toDataURL('image/jpeg',.85);canvas.width=canvas.height=thumb.width=thumb.height=0;
  return {image,thumbnail};
 }
 function focusBasement(s,info,table){
  if(!table?.verified||table.rows.length!==1||!/подвал|цоколь/iu.test(table.rows[0].name))return s;
  const labels=info.items.filter(w=>/^(?:подвал|цоколь)$/iu.test(w.text.trim())&&inside(w.cx,w.cy,s.bounds)&&!info.tables.some(t=>inside(w.cx,w.cy,{x0:t.left,y0:t.top-4,x1:t.right,y1:t.bottom+4})));
  const targets=s.floors.filter(p=>labels.some(w=>inside(w.cx,w.cy,p.bounds))&&width(p.bounds)*height(p.bounds)<width(s.bounds)*height(s.bounds)*.55);
  if(targets.length!==1)return s;const room=targets[0],t=s.thickness,r={x0:room.bounds.x0-t,y0:room.bounds.y0-t,x1:room.bounds.x1+t,y1:room.bounds.y1+t};
  const clip={rule:'nonzero',paths:[{commands:[[0,r.x0,r.y0],[1,r.x1,r.y0],[1,r.x1,r.y1],[1,r.x0,r.y1],[4]]}]},replacements=new Map();
  for(const p of s.walls.filter(p=>intersects(p.bounds,r))){const b=p.bounds;replacements.set(p,{...p,bounds:{x0:Math.max(b.x0,r.x0),y0:Math.max(b.y0,r.y0),x1:Math.min(b.x1,r.x1),y1:Math.min(b.y1,r.y1)},clips:[...(p.clips||[]),clip]});}
  if(replacements.size<3)return s;
  const walls=[...replacements.values()],bounds=union([room.bounds,...walls.map(p=>p.bounds)]),local=s.local.filter(p=>replacements.has(p)||!s.walls.includes(p)&&contains(bounds,p.bounds,.7)).map(p=>replacements.get(p)||p);
  return {...s,bounds,walls,local,floors:[room],focused:true,context:[]};
 }
 async function prepare({pdfjs,page,info,table,key,knownFootprint,optionalContent,check=()=>{}}){
  check();const operators=await page.getOperatorList();check();const paths=vectors(pdfjs,operators,page.getViewport({scale:1}),check,optionalContent),selected=chooseStructure(paths,info,key),structure=selected&&key==='basement'?focusBasement(selected,info,table):selected;
  if(!structure)return {ok:false,reason:'не удалось однозначно выделить векторные стены и отдельный план этажа'};
  const roomLabels=labels(info,structure,table);let dims=structure.focused?null:dimensions(info,structure,roomLabels);
  if(key==='floor1'&&knownFootprint&&(!dims||dims.basis==='source-room-area-consensus')){const values=String(knownFootprint.value).split(/[×xх]/i).map(v=>CatalogPdfCore.number(v)*1000);if(values.length===2&&values.every(n=>n>0)&&Math.abs((values[0]/values[1])/(width(structure.bounds)/height(structure.bounds))-1)<.015)dims={widthMm:values[0],heightMm:values[1],derived:[],basis:'album-dimension-lines',dimensionPage:knownFootprint.page};}
  if(!roomLabels.complete)return {ok:false,foundRooms:roomLabels.items.length,reason:'не все названия комнат удалось связать с местами на плане'};
  if(!dims)dims={widthMm:null,heightMm:null,derived:[],basis:'unavailable'};
  check();const rendered=draw(structure,roomLabels,dims,key,info);
  return {ok:true,...rendered,report:{style:VERSION,bounds:structure.bounds,...dims,rooms:roomLabels.items.length,wallPaths:structure.walls.length,sourceGeometry:true}};
 }
 async function refreshExisting({id,incoming,client,allowed,actor}){
  const reports=incoming.pdf_import_meta?.sources?.plans;if(!reports||!id)return {updated:false};
  const check=()=>{if(!allowed()||actor!==session?.token)throw Error('Сеанс изменился во время обновления планов');};check();
  const read=await client.from('project_cards').select('*').eq('id',id).is('deleted_at',null).maybeSingle();if(read.error)throw Error(read.error.message);check();const old=read.data;
  if(!old||old.pdf_import_meta?.sha256!==incoming.pdf_import_meta.sha256||String(old.project_number).trim().toLowerCase()!==String(incoming.project_number).trim().toLowerCase())return {updated:false};
  const keys=Object.keys(reports).filter(key=>{const previous=old.pdf_import_meta.sources?.plans?.[key]?.style,n=/^arhittek-plan-(\d+)$/.exec(previous||'');return reports[key].style===VERSION&&(!previous||n&&Number(n[1])<Number(VERSION.split('-').at(-1)));});
  if(!keys.length)return {updated:false};
  const images=Array.from({length:6},(_,i)=>old.images?.[i]||null),thumbnails=Array.from({length:6},(_,i)=>old.thumbnails?.[i]||null),plans={...old.pdf_import_meta.sources?.plans};
  for(const key of keys){const slot=CatalogFloors.definitions.find(f=>f.key===key)?.image;if(slot==null||!incoming.images?.[slot])continue;images[slot]=incoming.images[slot];thumbnails[slot]=incoming.thumbnails?.[slot]||null;plans[key]=reports[key];}
  const patch={images,thumbnails,pdf_import_meta:{...old.pdf_import_meta,sources:{...old.pdf_import_meta.sources,plans}},updated_at:new Date().toISOString()};
  let update=client.from('project_cards').update(patch).eq('id',id).is('deleted_at',null);update=old.updated_at?update.eq('updated_at',old.updated_at):update.is('updated_at',null);check();const saved=await update.select('id').maybeSingle();
  if(saved.error)throw Error(saved.error.message);if(!saved.data)throw Error('Карточка изменилась на другом устройстве. Обновите каталог и повторите загрузку PDF');
  return {updated:true,card:{...old,...patch}};
 }
 root.CatalogPlan=Object.freeze({prepare,refreshExisting,vectors,chooseStructure,labels,dimensions,version:VERSION});
})(window);
