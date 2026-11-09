/* Deterministic catalogue drawings: source geometry, never invented walls. */
(function(root){
 'use strict';
 const VERSION='arhittek-plan-7',INK='#283a46',BLUE='#2877c9';
 const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
 const roomNorm=s=>norm(s).replace(/^сп(?=\d|$)/,'спальня').replace(/^су(?=\d|$)/,'санузел').replace(/^каридор$/,'коридор').replace(/^кательная$/,'котельная');
 const roomName=s=>({сп:'Спальня',мсп:'Мастер-спальня',су:'Санузел',котельная:'Котельная',кательная:'Котельная',каридор:'Коридор',призожая:'Прихожая',кл:'Кладовая'}[norm(s)]||String(s).replace(/^СП[-–\s]*(\d+)$/iu,'Спальня $1').replace(/^С[\/.]?У\s*[-–]?\s*\d*\s*этаж.*$/iu,'Санузел'));
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
 function shade(color){const a=rgb(color);return a?{rgb:a,gray:a.reduce((s,n)=>s+n,0)/3,saturation:Math.max(...a)-Math.min(...a)}:null;}
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
  const O=pdfjs.OPS,stack=[],marked=[],paths=[];let visible=true,layer='';let state={matrix:[1,0,0,1,0,0],fill:'#000000',pattern:false,stroke:'#000000',dash:false,dashPattern:[],lineWidth:1,fillAlpha:1,strokeAlpha:1,clips:[],pendingClip:null};
  for(let i=0;i<operators.fnArray.length;i++){
   if(i%300===0)check();const op=operators.fnArray[i],a=operators.argsArray[i]||[];
   if(op===O.beginMarkedContent||op===O.beginMarkedContentProps){marked.push({visible,layer});if(op===O.beginMarkedContentProps&&a[0]==='OC'&&optionalContent){visible=visible&&optionalContent.isVisible(a[1]);layer=CatalogPdfCore.repairText(optionalContent.getGroup?.(a[1]?.id)?.name||layer);}}
   else if(op===O.endMarkedContent){const m=marked.pop();visible=m?.visible??true;layer=m?.layer||'';}
   else if(op===O.save||op===O.paintFormXObjectBegin){stack.push({...state,matrix:state.matrix.slice()});if(op===O.paintFormXObjectBegin&&a[0])state.matrix=multiply(state.matrix,a[0]);}
   else if(op===O.restore||op===O.paintFormXObjectEnd)state=stack.pop()||state;
   else if(op===O.transform)state.matrix=multiply(state.matrix,a);
   else if(op===O.clip)state.pendingClip='nonzero';
   else if(op===O.eoClip)state.pendingClip='evenodd';
   else if(op===O.setGState){for(const [key,value]of a[0]||[]){if(key==='LW')state.lineWidth=value;else if(key==='D'){state.dash=!!value[0]?.length;state.dashPattern=Array.from(value[0]||[]);}else if(key==='ca')state.fillAlpha=value;else if(key==='CA')state.strokeAlpha=value;}}
   else if(op===O.setLineWidth)state.lineWidth=a[0];
   else if(op===O.setDash){state.dash=!!a[0]?.length;state.dashPattern=Array.from(a[0]||[]);}
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
     paths.push({...p,bounds,layer,uniform:Math.abs(Math.hypot(m[0],m[1])/Math.hypot(m[2],m[3])-1)<.005,evenOdd,clips:state.clips,sequence:i,pattern:state.pattern,closed:p.closed||filled||[O.closeStroke,O.closeFillStroke,O.closeEOFillStroke].includes(paint),filled,stroked,fill:shade(state.fill),stroke:shade(state.stroke),dash:state.dash,dashPattern:state.dashPattern.map(n=>n*(Math.hypot(m[0],m[1])+Math.hypot(m[2],m[3]))/2),lineWidth:Math.abs(state.lineWidth)*(Math.hypot(m[0],m[1])+Math.hypot(m[2],m[3]))/2});
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
 function drawingLayer(p,key){
  const layer=p.layer||'';if(!layer)return true;
  if(/лест|ступен|stair|step|колонн|column/iu.test(layer))return true;
  if(/зон[аы]?|zone|козыр|крыш|roof|размет|размкт|полы|пола|floor finish|мебел|furniture|рельеф|оси|axis|размер|dimension|маркер/iu.test(layer))return false;
  const floor=CatalogPdfCore.floorIn(layer);return !floor||floor===key;
 }
 function chooseStructure(paths,info,key){
  const headings=CatalogPdfCore.planInfos(info,3),heading=headings.find(h=>h.floor===key);
  let extraWalls=[];let walls=paths.filter(p=>drawingLayer(p,key)&&p.filled&&p.fill&&p.fill.saturation<.08&&p.fill.gray<.85&&!info.items.some(w=>p.commands.length<=12&&contains(p.bounds,w,w.h*.25)&&height(p.bounds)<w.h*2.8&&width(p.bounds)<w.x1-w.x0+w.h*4)&&!(width(p.bounds)>info.width*.6&&(p.bounds.y1<info.height*.07||p.bounds.y0>info.height*.9))&&!(p.commands.length<=4&&p.fill.gray<.1&&!/стен|wall|перегор/iu.test(p.layer||'')&&Math.max(width(p.bounds),height(p.bounds))<Math.min(info.width,info.height)*.02)&&width(p.bounds)*height(p.bounds)>1&&!p.curved&&width(p.bounds)<info.width*.95&&height(p.bounds)<info.height*.9);
  {
   // Uncoloured Archicad walls are white polygons with repeated diagonal hatching.
   // A white window infill has no such hatching and must remain an opening.
   const hatches=[];
   for(const p of paths.filter(p=>p.stroked&&!p.curved&&!p.dash&&p.stroke&&p.stroke.gray<.4)){
    let previous;for(const c of p.commands){if(c[0]===0){previous=[c[1],c[2]];continue;}if(c[0]!==1||!previous)continue;const next=[c[1],c[2]],b=box([previous,next]),ratio=width(b)/height(b);if(width(b)>.3&&height(b)>.3&&ratio>.65&&ratio<1.5)hatches.push({bounds:b,sequence:p.sequence});previous=next;}
   }
   const hatched=paths.filter(p=>drawingLayer(p,key)&&p.filled&&p.fill?.gray>.985&&!p.curved&&width(p.bounds)*height(p.bounds)>2&&(Math.min(width(p.bounds),height(p.bounds))<Math.max(info.width,info.height)*.045||p.commands.filter(c=>c[0]===0).length>1)&&hatches.filter(h=>h.sequence>p.sequence&&contains(p.bounds,h.bounds,.15)).length>=2);
   const extent=ps=>ps.reduce((v,p)=>v+Math.max(width(p.bounds),height(p.bounds)),0);if(hatched.length>=3&&extent(hatched)>extent(walls)*1.3)walls=hatched;else extraWalls=hatched;
  }
  let fallback=false;
  if(walls.length<3&&!walls.some(p=>p.commands.filter(c=>c[0]===0).length>1&&width(p.bounds)>info.width*.12&&height(p.bounds)>info.height*.12)){
   // Stroke-only exports must have an explicit, closed main outline.
   const outlines=paths.filter(p=>drawingLayer(p,key)&&p.stroked&&!p.dash&&p.closed&&width(p.bounds)>info.width*.12&&height(p.bounds)>info.height*.12&&width(p.bounds)<info.width*.9&&height(p.bounds)<info.height*.85);
   if(!outlines.length)return null;
   walls=outlines;fallback=true;
  }
  let clusters=groups(walls,info.width*.035).filter(g=>width(g.bounds)>info.width*.1&&height(g.bounds)>info.height*.1);
  // A continuous source floor polygon can join wall groups separated by
  // wide openings. Separate drawings have separate floor footprints.
  const bridges=paths.filter(p=>p.filled&&(p.pattern||p.fill&&(p.fill.saturation>.08||p.fill.gray>=.85&&p.fill.gray<.985))&&width(p.bounds)<info.width*.9&&height(p.bounds)<info.height*.85);
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
  const floors=paths.filter(p=>p.filled&&(p.pattern||p.fill&&(p.fill.saturation>.08||p.fill.gray>=.85&&p.fill.gray<.985))&&p.closed&&width(p.bounds)*height(p.bounds)>20&&width(p.bounds)<info.width*.8&&height(p.bounds)<info.height*.8);
  let attached=[];
  for(let round=0;round<3;round++){
   attached=floors.filter(p=>intersects(p.bounds,bounds,1)&&width(p.bounds)<width(selected.bounds)*1.3&&height(p.bounds)<height(selected.bounds)*1.3&&!clusters.some(g=>g!==selected&&intersects(p.bounds,g.bounds)));
   if(attached.length)bounds=union([selected.bounds,...attached.map(p=>p.bounds)]);
  }
  const local=paths.filter(p=>contains(bounds,p.bounds,.7));
  const thickness=median(selected.paths.map(p=>Math.min(width(p.bounds),height(p.bounds))).filter(n=>n>.2&&n<Math.max(width(bounds),height(bounds))*.06));
  return {context:paths,bounds,walls:selected.paths,extraWalls:extraWalls.filter(p=>contains(bounds,p.bounds,2)),floors:attached,local,thickness:Math.max(.6,thickness),fallback};
 }
 function structuralColumns(s){
  const paths=s.context||s.local,t=s.thickness,columns=[];
  for(const p of paths){
   const b=p.bounds,w=width(b),h=height(b);
   // CAD exporters can split one named structural column into rectangular fills.
   if(/колонн|column/iu.test(p.layer||'')&&p.filled&&!p.curved&&p.fill?.gray>.9&&p.fill.saturation<.08&&Math.min(w,h)>t*.2&&Math.max(w,h)<t*2.3&&contains(s.bounds,b,t)&&s.walls.some(q=>intersects(q.bounds,b,t*.3))){columns.push(p);continue;}
   if(!p.filled||p.curved||p.fill?.gray<.9||!p.fill||p.fill.saturation>.08||w/h<.65||w/h>1.55||Math.min(w,h)<t*.4||Math.max(w,h)>t*2.3||!contains(s.bounds,b,t))continue;
   const marks=paths.filter(q=>q.stroked&&!q.curved&&q.stroke?.saturation>.2&&q.sequence>p.sequence&&q.sequence-p.sequence<250&&contains(b,q.bounds,Math.max(.3,t*.2)));
   const diagonals=marks.filter(q=>q.commands.length===2&&width(q.bounds)>.1&&height(q.bounds)>.1&&q.stroke.rgb?.[0]>.4&&q.stroke.rgb[1]>.3&&q.stroke.rgb[2]<q.stroke.rgb[1]*.75),sides=marks.filter(q=>Math.min(width(q.bounds),height(q.bounds))<.2&&Math.max(width(q.bounds),height(q.bounds))>Math.min(w,h)*.75);
   const joined=s.walls.some(q=>intersects(q.bounds,b,t*.3));
   const centre=marks.some(q=>q.stroke.rgb?.[0]>.9&&q.stroke.rgb[1]<.1&&q.stroke.rgb[2]<.1&&Math.max(width(q.bounds),height(q.bounds))<.2);
   if((diagonals.length>=3||diagonals.length>=2&&(sides.length>=1||centre))&&marks.length>=4&&joined)columns.push(p);
  }return paths.filter(p=>p.filled&&p.fill?.gray>.9&&p.fill.saturation<.08&&columns.some(q=>contains(q.bounds,p.bounds,.75)));
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
    const spreadX=(Math.max(...xs)-Math.min(...xs))/width(b),spreadY=(Math.max(...ys)-Math.min(...ys))/height(b);if(spreadX<.2||spreadY<.2||spreadX*spreadY<.1)continue;
    consensus=found;break;
   }
  }
  // CAD room bubbles may be true curves or dozens of tiny straight edges.
  // Require a closed ring around the number; staircase digits have no ring.
  const edges=[];
  for(const p of structure.local){if(!p.stroked||p.dash)continue;let prev;for(const c of p.commands){if(c[0]===0){prev=[c[1],c[2]];continue;}if(c[0]!==1||!prev)continue;const q=[c[1],c[2]],dx=q[0]-prev[0],dy=q[1]-prev[1],len=Math.hypot(dx,dy);if(len>0)edges.push({x:(prev[0]+q[0])/2,y:(prev[1]+q[1])/2,dx:dx/len,dy:dy/len,len});prev=q;}}
  const ringCache=new Map(),ring=w=>{
   if(ringCache.has(w))return ringCache.get(w);let found=false;
   const curved=structure.local.some(p=>p.curved&&(p.closed||Math.hypot(p.commands[0][1]-p.commands.at(-1).at(-2),p.commands[0][2]-p.commands.at(-1).at(-1))<.5)&&contains(p.bounds,w,w.h*.25)&&width(p.bounds)<w.h*5&&height(p.bounds)<w.h*5&&width(p.bounds)>w.h&&height(p.bounds)>w.h);
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
 // PDF.js paints the source itself. Classifying individual strokes loses
 // unnumbered/winding stairs, thin wall outlines and clipped compound paths.
 function cropBounds(s,info){
  const b=s.bounds,pad=s.focused?0:Math.max(s.thickness*3,Math.min(width(b),height(b))*.025);
  const visual=union([b,...outsideSteps(s,info)]);
  return {x0:Math.max(0,visual.x0-pad),y0:Math.max(0,visual.y0-pad),x1:Math.min(info.width,visual.x1+pad),y1:Math.min(info.height,visual.y1+pad)};
 }
 function outsideSteps(s,info){
  if(s.focused)return [];
  const b=s.bounds,t=s.thickness,span=Math.max(width(b),height(b)),lines=[];
  for(const p of s.context||s.local){
   if(!p.stroked||p.curved||p.commands.length!==2||p.commands[1][0]!==1||!contains({x0:b.x0-span*.25,y0:b.y0-span*.25,x1:b.x1+span*.25,y1:b.y1+span*.25},p.bounds))continue;
   const r=p.bounds,horizontal=height(r)<.15,vertical=width(r)<.15,length=Math.max(width(r),height(r));
   if((horizontal||vertical)&&length>t*3&&length<span*.35)lines.push({p,horizontal,lo:horizontal?r.x0:r.y0,hi:horizontal?r.x1:r.y1,axis:horizontal?r.y0:r.x0});
  }
  const zones=[];
  for(const seed of lines){
   const run=lines.filter(l=>l.horizontal===seed.horizontal&&Math.abs(l.lo-seed.lo)<t*.2&&Math.abs(l.hi-seed.hi)<t*.2&&Math.abs(l.axis-seed.axis)<t*8).sort((a,b)=>a.axis-b.axis);
   const unique=run.filter((l,i)=>!i||l.axis-run[i-1].axis>.2);if(unique.length<3)continue;
   const gaps=unique.slice(1).map((l,i)=>l.axis-unique[i].axis);
   if(gaps.some(g=>g<t*.12||g>t*1.2)||Math.max(...gaps)/Math.min(...gaps)>1.35||unique.at(-1).axis-unique[0].axis>t*6)continue;
   const r=union(unique.map(l=>l.p.bounds));
   if(contains(b,r)||!intersects(b,r,t*4)||info.items.some(w=>inside(w.cx,w.cy,r)&&! /^(?:\d{1,2}|UP|DOWN)$/i.test(w.text.trim())))continue;
   if(!zones.some(z=>contains(z,r)))zones.push(r);
  }return zones;
 }
 // Material hatches repeat tiny strokes across a clipped two-dimensional
 // region. Stair treads form longer runs and must remain source geometry.
 function materialHatches(paths,structure){
  const groups=new Map(),hidden=new Set();
  for(const p of paths){const clip=p.clips?.at(-1);if(!clip||!p.stroked||p.filled||p.curved||p.dash||p.commands.length!==2||p.commands[1][0]!==1)continue;const group=groups.get(clip)||[];group.push(p);groups.set(clip,group);}
  for(const [clip,group]of groups){
   if(group.length<80||!clip.paths?.length)continue;const b=union(clip.paths.map(q=>q.bounds)),unit=Math.min(Math.min(width(b),height(b))*.3,structure.thickness*1.7);
   if(width(b)>width(structure.bounds)*1.3||height(b)>height(structure.bounds)*1.3)continue;
   const small=group.filter(p=>Math.max(width(p.bounds),height(p.bounds))>0&&Math.max(width(p.bounds),height(p.bounds))<unit);
   if(small.length<80||small.length<group.length*.8)continue;
   const xs=new Set(small.map(p=>Math.round((p.bounds.x0+p.bounds.x1)/2))),ys=new Set(small.map(p=>Math.round((p.bounds.y0+p.bounds.y1)/2)));
   if(xs.size<8||ys.size<8)continue;for(const p of small)hidden.add(p);
  }return hidden;
 }
 // Only architectural primitives may reach the final plan. Unknown strokes
 // are omitted rather than copied from a drawing sheet as visual clutter.
 function architecturalDetails(paths,s,info,inWall){
  const t=s.thickness,span=Math.max(width(s.bounds),height(s.bounds)),lines=[],zones=[];
  const addZone=b=>{if(width(b)>0&&height(b)>0&&!zones.some(z=>contains(z,b)))zones.push(b);};
  for(const p of paths){if(!p.stroked||p.curved)continue;let previous;for(const c of p.commands){if(c[0]===0){previous=c.slice(1);continue;}if(c[0]!==1||!previous)continue;const a=previous,b=c.slice(1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>t*.7&&length<span*.4)lines.push({p,a,b,length,horizontal:Math.abs(b[1]-a[1])<.2,vertical:Math.abs(b[0]-a[0])<.2});previous=b;}}
  const numbered=info.items.filter(w=>/^\d{1,2}$/.test(w.text)&&Number(w.text)<=40&&inside(w.cx,w.cy,s.bounds)&&!info.tables?.some(q=>inside(w.cx,w.cy,{x0:q.left,y0:q.top,x1:q.right,y1:q.bottom})));
  for(const seed of numbered){const nearby=numbered.filter(w=>Math.abs(w.h/seed.h-1)<.45&&Math.hypot(w.cx-seed.cx,w.cy-seed.cy)<seed.h*27);if(new Set(nearby.map(w=>w.text)).size<7)continue;const b=union(nearby);if(width(b)>span*.4||height(b)>span*.4)continue;const pad=seed.h*5;addZone({x0:b.x0-pad,y0:b.y0-pad,x1:b.x1+pad,y1:b.y1+pad});}
  for(const seed of lines.filter(l=>!l.p.dash&&(l.horizontal||l.vertical))){
   const axis=l=>l.horizontal?l.a[1]:l.a[0],lo=l=>l.horizontal?Math.min(l.a[0],l.b[0]):Math.min(l.a[1],l.b[1]),hi=l=>lo(l)+l.length;
   const run=lines.filter(l=>!l.p.dash&&l.horizontal===seed.horizontal&&l.vertical===seed.vertical&&Math.abs(lo(l)-lo(seed))<t*.2&&Math.abs(hi(l)-hi(seed))<t*.2&&Math.abs(axis(l)-axis(seed))<t*7).sort((a,b)=>axis(a)-axis(b));
   const unique=run.filter((l,i)=>!i||axis(l)-axis(run[i-1])>.2);if(unique.length<3)continue;const gaps=unique.slice(1).map((l,i)=>axis(l)-axis(unique[i]));if(gaps.some(v=>v<t*.12||v>t*1.6)||Math.max(...gaps)/Math.min(...gaps)>1.4)continue;
   const b=union(unique.map(l=>l.p.bounds));if(Math.max(width(b),height(b))/Math.max(1,Math.min(width(b),height(b)))>4.5)continue;addZone({x0:b.x0-t,y0:b.y0-t,x1:b.x1+t,y1:b.y1+t});
  }
  // Winder stairs share an actual pivot, unlike grids and dimension chains.
  for(const seed of lines.filter(l=>l.length>t*1.5&&l.length<t*10))for(const pivot of [seed.a,seed.b]){
   const fan=lines.filter(l=>l.length>t*1.5&&l.length<t*10&&(Math.hypot(l.a[0]-pivot[0],l.a[1]-pivot[1])<t*.2||Math.hypot(l.b[0]-pivot[0],l.b[1]-pivot[1])<t*.2));if(fan.length<4)continue;
   const angles=fan.map(l=>{const q=Math.hypot(l.a[0]-pivot[0],l.a[1]-pivot[1])<t*.2?l.b:l.a;return Math.atan2(q[1]-pivot[1],q[0]-pivot[0]);}).sort((a,b)=>a-b);if(angles.at(-1)-angles[0]<.7)continue;
   const b=union(fan.map(l=>l.p.bounds));if(width(b)>span*.3||height(b)>span*.3)continue;addZone({x0:b.x0-t,y0:b.y0-t,x1:b.x1+t,y1:b.y1+t});
  }
  const wallAt=(x,y)=>[0,t*.2,-t*.2].some(d=>inWall(x+d,y)||inWall(x,y+d));
  const arcs=paths.filter(p=>p.stroked&&p.curved&&!p.closed&&Math.max(width(p.bounds),height(p.bounds))>t*.5&&Math.max(width(p.bounds),height(p.bounds))<span*.23&&Math.hypot(p.commands[0][1]-p.commands.at(-1).at(-2),p.commands[0][2]-p.commands.at(-1).at(-1))>t*.4);
  const doors=[];
  for(const p of arcs){
   const a=p.commands[0].slice(1),last=p.commands.at(-1),b=last.slice(-2),first=p.commands.find(c=>c[0]===2),hinges=[];
   if(first&&last[0]===2){const v=[-(b[1]-last[4]),b[0]-last[3]];
    // Endpoint normals meet at the source circular arc centre. This also
    // recognises doors drawn at 20 degrees rather than only quarter circles.
    const us=[-(first[2]-a[1]),first[1]-a[0]],den=us[0]*v[1]-us[1]*v[0];if(Math.abs(den)>.00001){const k=((b[0]-a[0])*v[1]-(b[1]-a[1])*v[0])/den,h=[a[0]+us[0]*k,a[1]+us[1]*k],radius=Math.hypot(a[0]-h[0],a[1]-h[1]);if(radius>t*1.5&&radius<span*.25&&(wallAt(h[0],h[1])||/стен|двер|wall|door/iu.test(p.layer||'')))hinges.push(h);}}
   for(const h of [[a[0],b[1]],[b[0],a[1]]])if(wallAt(h[0],h[1]))hinges.push(h);
   if(hinges.length)doors.push({p,a,b,hinges});
  }
  const selected=new Set(),roles=new Map(),counts={stairs:0,doors:0,windows:0};
  for(const p of paths){
   if(!p.stroked)continue;
   if(/лест|ступен|stair|step/iu.test(p.layer||'')||zones.some(z=>contains(z,p.bounds,t*.1))){selected.add(p);roles.set(p,'stairs');counts.stairs++;continue;}
   if(doors.some(d=>d.p===p)){selected.add(p);roles.set(p,'doors');counts.doors++;continue;}
   const line=lines.find(l=>l.p===p);if(!line)continue;
   if(doors.some(d=>d.hinges.some(h=>[d.a,d.b].some(q=>(Math.hypot(line.a[0]-h[0],line.a[1]-h[1])<t*.3&&Math.hypot(line.b[0]-q[0],line.b[1]-q[1])<t*.3)||(Math.hypot(line.b[0]-h[0],line.b[1]-h[1])<t*.3&&Math.hypot(line.a[0]-q[0],line.a[1]-q[1])<t*.3))))){selected.add(p);roles.set(p,'doors');counts.doors++;continue;}
   const mid=[(line.a[0]+line.b[0])/2,(line.a[1]+line.b[1])/2],ux=(line.b[0]-line.a[0])/line.length,uy=(line.b[1]-line.a[1])/line.length;
   // Glazing runs bridge a real opening between wall ends. Interior room grids
   // do not terminate against two ends of the same wall band.
   if(!p.dash&&line.length>t*1.5&&!inWall(...mid)&&wallAt(line.a[0]-ux*t*2,line.a[1]-uy*t*2)&&wallAt(line.b[0]+ux*t*2,line.b[1]+uy*t*2)&&!wallAt(line.a[0]-ux*t*2-uy*t*2,line.a[1]-uy*t*2+ux*t*2)&&!wallAt(line.b[0]+ux*t*2-uy*t*2,line.b[1]+uy*t*2+ux*t*2)&&!wallAt(mid[0]-uy*t*.8,mid[1]+ux*t*.8)&&!wallAt(mid[0]+uy*t*.8,mid[1]-ux*t*.8)){selected.add(p);roles.set(p,'windows');counts.windows++;}
  }
  return {selected,counts,zones,roles};
 }
 // Template 3.1 is drawn from source paths, never a generated replacement layout.
 async function draw(s,roomLabels,dims,key,info,page,optionalContent,check){
  const canvas=document.createElement('canvas');canvas.width=3600;canvas.height=3200;
  const c=canvas.getContext('2d'),b=s.bounds,crop=cropBounds(s,info),scale=Math.min(1420/width(crop),1290/height(crop));
  const cropLeft=(1800-width(crop)*scale)/2+25,cropTop=65+(1290-height(crop)*scale)/2;
  const left=cropLeft+(b.x0-crop.x0)*scale,top=cropTop+(b.y0-crop.y0)*scale,map=(x,y)=>[cropLeft+(x-crop.x0)*scale,cropTop+(y-crop.y0)*scale];
  c.scale(2,2);c.fillStyle='#fff';c.fillRect(0,0,1800,1600);
  const mask=document.createElement('canvas');mask.width=1800;mask.height=1600;
  const m=mask.getContext('2d');
  const columns=structuralColumns(s),wallSet=new Set([...s.walls,...(s.extraWalls||[]),...columns]),t=s.thickness;
  const tables=(info.tables||[]).map(v=>({x0:v.left-4,y0:v.top-10,x1:v.right+4,y1:v.bottom+8})).filter(r=>!s.walls.some(p=>intersects(p.bounds,r)));
  const steps=outsideSteps(s,info),supports=[...s.walls,...columns,...s.floors,...steps.map(bounds=>({bounds}))];
  const local=(s.context||s.local).filter(p=>drawingLayer(p,key)&&(wallSet.has(p)||contains(b,p.bounds,.7)||steps.some(r=>contains(r,p.bounds,t))||p.curved&&Math.max(width(p.bounds),height(p.bounds))>t&&Math.max(width(p.bounds),height(p.bounds))<Math.max(width(b),height(b))*.18)&&contains(crop,p.bounds,.7)&&!tables.some(r=>contains(r,p.bounds))&&supports.some(q=>intersects(q.bounds,p.bounds,t*.5)));
  const materialMarks=materialHatches(local,s);
  const notes=info.items.filter(w=>inside(w.cx,w.cy,crop)&&(/[а-яё]/iu.test(w.text)||/^(?:UP|DOWN)$/i.test(w.text))).map(w=>({x0:w.x0-w.h*2,y0:w.y0-w.h*2,x1:w.x1+w.h*2,y1:w.y1+w.h*3}));
  const words=info.items.filter(w=>inside(w.cx,w.cy,crop));
  const annotation=p=>!wallSet.has(p)&&(p.stroke?.saturation>.2&&columns.some(q=>contains(q.bounds,p.bounds,t*.4))||!p.curved&&notes.some(a=>contains(a,p.bounds))||p.curved&&(p.closed||p.points.length>2&&Math.hypot(p.points[0][0]-p.points.at(-1)[0],p.points[0][1]-p.points.at(-1)[1])<.2)&&Math.max(width(p.bounds),height(p.bounds))<t*5&&words.some(w=>/^\d{1,3}$/.test(w.text)&&contains(p.bounds,w,.3)));
  const wallHatch=p=>!p.filled&&!p.curved&&p.lineWidth===0&&p.commands.length===2&&width(p.bounds)>.1&&height(p.bounds)>.1&&Math.max(width(p.bounds),height(p.bounds))<t*2&&width(p.bounds)/height(p.bounds)>.65&&width(p.bounds)/height(p.bounds)<1.5;
  const clipped=(ctx,p,fn)=>{ctx.save();for(const clip of p.clips||[]){ctx.beginPath();for(const q of clip.paths)path(ctx,q,map,false);ctx.clip(clip.rule);}fn();ctx.restore();};
  // Build only the visible wall silhouette in source paint order; opaque later
  // fills erase hidden/lower-storey walls. Compound holes keep their fill rule.
  for(const p of local){
   if(!p.filled||annotation(p))continue;
   clipped(m,p,()=>{path(m,p,map);m.globalCompositeOperation=wallSet.has(p)?'source-over':'destination-out';m.fillStyle=INK;m.fill(p.evenOdd?'evenodd':'nonzero');});
  }
  const pixels=m.getImageData(0,0,mask.width,mask.height).data;
  const inWall=(x,y)=>{const q=map(x,y),ix=Math.round(q[0]),iy=Math.round(q[1]);return ix>=0&&iy>=0&&ix<mask.width&&iy<mask.height&&pixels[(iy*mask.width+ix)*4+3]>240;};
  const details=architecturalDetails(local.filter(p=>!materialMarks.has(p)&&!annotation(p)&&!wallHatch(p)),s,info,inWall);
  for(let i=0;i<local.length;i++){
   if(i%300===0)check();const p=local[i];if(annotation(p)||wallHatch(p)||materialMarks.has(p))continue;
   clipped(c,p,()=>{
    if(p.filled){path(c,p,map);c.fillStyle=wallSet.has(p)?INK:'#ffffff';c.fill(p.evenOdd?'evenodd':'nonzero');if(wallSet.has(p)){c.strokeStyle='#20333f';c.lineWidth=.65;c.stroke();}}
    if(p.stroked&&p.stroke&&p.stroke.gray<.96&&details.selected.has(p)){
     // Wall hatching is hidden by the solid cut; hairline stairs outside walls survive.
     const points=p.points;if(!wallSet.has(p)&&points.length&&points.every(q=>inWall(q[0],q[1])))return;
     path(c,p,map);c.strokeStyle=wallSet.has(p)?'#20333f':'#667680';c.lineWidth=wallSet.has(p)?.65:Math.max(details.roles.get(p)==='windows'?1.05:1,Math.min(1.65,p.lineWidth*scale));
     // Dashed upper flights retain their exact source geometry and neutral treatment.
     if(p.dash)c.setLineDash(p.dashPattern.map(n=>n*scale));c.stroke();
    }
   });
  }
  for(const region of s.activeRegions||[]){clipped(c,region,()=>{path(c,region,map);c.save();c.globalCompositeOperation='multiply';c.fillStyle='#e6eff3';c.fill(region.evenOdd?'evenodd':'nonzero');c.restore();});}
  const shadow=document.createElement('canvas');shadow.width=1800;shadow.height=1600;
  const sh=shadow.getContext('2d');sh.shadowColor='rgba(20,35,49,0.24)';sh.shadowBlur=9;sh.shadowOffsetX=shadow.width+5;sh.shadowOffsetY=8;sh.drawImage(mask,-shadow.width,0);sh.globalCompositeOperation='destination-out';sh.drawImage(mask,0,0);sh.globalCompositeOperation='source-over';
  c.save();c.globalCompositeOperation='multiply';c.drawImage(shadow,0,0,1800,1600);c.restore();
  for(const r of roomLabels.items){
   let [x,y]=map(r.x,r.y),lx=r.x,rx=r.x,uy=r.y,dy=r.y;const step=Math.max(.3,t/5);
   for(let i=0;i<width(b)/step&&lx>b.x0;i++){if(inWall(lx-step,r.y))break;lx-=step;}
   for(let i=0;i<width(b)/step&&rx<b.x1;i++){if(inWall(rx+step,r.y))break;rx+=step;}
   for(let i=0;i<height(b)/step&&uy>b.y0;i++){if(inWall(r.x,uy-step))break;uy-=step;}
   for(let i=0;i<height(b)/step&&dy<b.y1;i++){if(inWall(r.x,dy+step))break;dy+=step;}
   const max=Math.max(38,Math.min(300,(rx-lx)*scale*.8));let size=24;
   while(size>13){c.font='600 '+size+'px Arial, sans-serif';if(c.measureText(r.name).width<=max)break;size--;}
   const parts=r.name.split(/\s+/),lines=[];let line='';for(const part of parts){const next=line?line+' '+part:part;if(line&&c.measureText(next).width>max){lines.push(line);line=part;}else line=next;}if(line)lines.push(line);
   const tw=Math.min(max,Math.max(...lines.map(v=>c.measureText(v).width))),th=lines.length*(size+4);
   const leftEdge=map(lx,r.y)[0]+tw/2+6,rightEdge=map(rx,r.y)[0]-tw/2-6,topEdge=map(r.x,uy)[1]+th/2+4,bottomEdge=map(r.x,dy)[1]-th/2-4;
   if(leftEdge<=rightEdge)x=Math.max(leftEdge,Math.min(rightEdge,x));if(topEdge<=bottomEdge)y=Math.max(topEdge,Math.min(bottomEdge,y));
   c.save();c.fillStyle='rgba(255,255,255,.88)';c.fillRect(x-tw/2-5,y-th/2-3,tw+10,th+6);c.fillStyle='#30434f';c.textAlign='center';c.textBaseline='middle';lines.forEach((line,i)=>c.fillText(line,x,y+(i-(lines.length-1)/2)*(size+4),max));c.restore();
  }
  mask.width=mask.height=shadow.width=shadow.height=0;
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
  return {image,thumbnail,sourceCrop:crop,details:details.counts};
 }
 // A schedule describes a level; it does not prove that the neighbouring
 // drawing depicts that level. Require drawing evidence before accepting it.
 function focusBasement(s,info,table){
  const explicit=CatalogPdfCore.planInfos(info,3).some(h=>h.floor==='basement'&&!h.inferredFromTable&&!/экспликац/iu.test(h.heading));
  const mapped=labels(info,s,table),basementLabel=mapped.items.some(r=>/подвал|цоколь/iu.test(r.raw));
  if(!explicit&&!basementLabel)return null;
  if(!table?.verified)return explicit?{...s,fullLevel:true,activeRegions:[]}:null;
  const regions=[];
  for(const r of mapped.items){
   const candidates=s.floors.filter(p=>inside(r.x,r.y,p.bounds)&&width(p.bounds)*height(p.bounds)<width(s.bounds)*height(s.bounds)*.99).sort((a,b)=>width(a.bounds)*height(a.bounds)-width(b.bounds)*height(b.bounds));
   const distinct=[];for(const p of candidates)if(!distinct.some(q=>['x0','y0','x1','y1'].every(k=>Math.abs(p.bounds[k]-q.bounds[k])<.75)))distinct.push(p);
   if(!distinct.length)continue;const room=distinct[0];
   // Competing overlapping regions for the same room are ambiguous; separate
   // named rooms are handled independently and may all be usable.
   if(distinct.some(p=>!contains(p.bounds,room.bounds,.75)))return null;
   if(!regions.some(p=>['x0','y0','x1','y1'].every(k=>Math.abs(p.bounds[k]-room.bounds[k])<.75)))regions.push(room);
  }
  if(!regions.length&&!explicit)return null;
  return {...s,activeRegions:regions,fullLevel:true,focused:false,recognition:'full-level-with-usable-rooms'};
 }
 async function prepare({pdfjs,page,info,table,key,knownFootprint,reference,optionalContent,check=()=>{}}){
  check();const operators=await page.getOperatorList();check();const paths=vectors(pdfjs,operators,page.getViewport({scale:1}),check,optionalContent),selected=chooseStructure(paths,info,key),structure=selected&&key==='basement'?focusBasement(selected,info,table):selected;
  if(!structure)return {ok:false,reason:key==='basement'?'таблица цоколя не подтверждена отдельным планом или границами подвального помещения':'не удалось однозначно выделить векторные стены и отдельный план этажа'};
  const roomLabels=labels(info,structure,table);let dims=dimensions(info,structure,roomLabels);
  if(key==='floor1'&&knownFootprint&&(!dims||dims.basis==='source-room-area-consensus')){const values=String(knownFootprint.value).split(/[×xх]/i).map(v=>CatalogPdfCore.number(v)*1000);if(values.length===2&&values.every(n=>n>0)&&Math.abs((values[0]/values[1])/(width(structure.bounds)/height(structure.bounds))-1)<.015)dims={widthMm:values[0],heightMm:values[1],derived:[],basis:'album-dimension-lines',dimensionPage:knownFootprint.page};}
  const scales=info.items.filter(w=>/^1\s*:\s*(20|25|50|75|100|150|200)$/.test(w.text)&&w.cx>=structure.bounds.x0&&w.cx<=structure.bounds.x1).sort((a,b)=>Math.abs(a.cy-structure.bounds.y0)-Math.abs(b.cy-structure.bounds.y0)),drawingScale=scales.length?Number(scales[0].text.split(':')[1]):null;
  if(!dims&&reference?.widthMm>0&&reference.heightMm>0&&drawingScale&&reference.drawingScale===drawingScale&&Math.abs(width(structure.bounds)/width(reference.bounds)-1)<.005&&Math.abs(height(structure.bounds)/height(reference.bounds)-1)<.005)dims={widthMm:reference.widthMm,heightMm:reference.heightMm,derived:['width','height'],basis:'matching-scale-and-footprint',referenceFloor:'floor1'};
  if(table?.verified&&!roomLabels.complete)return {ok:false,reason:'не все помещения удалось достоверно подписать на плане',foundRooms:roomLabels.items.length};
  // Missing positions are reported; an incomplete plan cannot silently publish.
  if(!dims)dims={widthMm:null,heightMm:null,derived:[],basis:'unavailable'};
  check();const rendered=await draw(structure,roomLabels,dims,key,info,page,optionalContent,check);
  if(paths.filter(p=>/лест|ступен|stair|step/iu.test(p.layer||'')&&p.stroked).length>=3&&!rendered.details.stairs)return {ok:false,reason:'не удалось подтвердить сохранность лестницы на чистом плане'};
  return {ok:true,...rendered,report:{style:VERSION,template:'3.1',renderer:'source-vector-relief',detailPolicy:'walls-openings-stairs-room-names-overall-dimensions',windows:'neutral',shadows:'soft',sourceCrop:rendered.sourceCrop,details:rendered.details,recognition:structure.recognition||'level-drawing',focused:!!structure.focused,fullLevel:key==='basement',highlightedRooms:structure.activeRegions?.length||0,columns:structuralColumns(structure).length,roomNames:roomLabels.items.map(r=>r.name),drawingScale,bounds:structure.bounds,...dims,rooms:roomLabels.items.length,wallPaths:structure.walls.length,sourceGeometry:true}};
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
