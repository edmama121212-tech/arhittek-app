/* Approved semantic catalogue template: separate source walls/openings/stairs/rooms. */
(function(root){
 'use strict';
 const VERSION='arhittek-semantic-1',INK='#34443f',PAPER='#fcfbf8',LINE='#879a8c';
 const wh=b=>[b.x1-b.x0,b.y1-b.y0],inside=(p,b)=>p[0]>=b.x0&&p[0]<=b.x1&&p[1]>=b.y0&&p[1]<=b.y1;
 function drawPath(c,commands,map,begin=true){if(begin)c.beginPath();for(const q of commands){if(q[0]===4){c.closePath();continue;}const v=[];for(let i=1;i<q.length;i+=2)v.push(...map(q[i],q[i+1]));if(q[0]===0)c.moveTo(...v);else if(q[0]===1)c.lineTo(...v);else if(q[0]===2)c.bezierCurveTo(...v);else if(q[0]===3)c.quadraticCurveTo(...v);}}
 const polygon=(c,points,map,begin=true)=>{if(begin)c.beginPath();points.forEach((p,i)=>i?c.lineTo(...map(...p)):c.moveTo(...map(...p)));c.closePath();};
 function simplify(points,tol=.55){
  function open(a){if(a.length<3)return a;const p=a[0],q=a.at(-1),dx=q[0]-p[0],dy=q[1]-p[1],den=dx*dx+dy*dy;let at=0,max=0;for(let i=1;i<a.length-1;i++){const u=den?Math.max(0,Math.min(1,((a[i][0]-p[0])*dx+(a[i][1]-p[1])*dy)/den)):0,d=Math.hypot(a[i][0]-p[0]-u*dx,a[i][1]-p[1]-u*dy);if(d>max){max=d;at=i;}}return max>tol?[...open(a.slice(0,at+1)).slice(0,-1),...open(a.slice(at))]:[p,q];}
  if(points.length<5)return points;const first=points[0];let far=1;for(let i=2;i<points.length;i++)if(Math.hypot(points[i][0]-first[0],points[i][1]-first[1])>Math.hypot(points[far][0]-first[0],points[far][1]-first[1]))far=i;return [...open(points.slice(0,far+1)).slice(0,-1),...open([...points.slice(far),first]).slice(0,-1)];
 }
 function wallContours(canvas,unmap){
  const W=canvas.width,H=canvas.height,p=canvas.getContext('2d').getImageData(0,0,W,H).data,N=W+1,edges=new Map(),ink=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&p[(y*W+x)*4+3]>240;
  const add=(x,y,a,b)=>{const k=y*N+x,list=edges.get(k)||[];list.push(b*N+a);edges.set(k,list);};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(ink(x,y)){if(!ink(x,y-1))add(x,y,x+1,y);if(!ink(x+1,y))add(x+1,y,x+1,y+1);if(!ink(x,y+1))add(x+1,y+1,x,y+1);if(!ink(x-1,y))add(x,y+1,x,y);}
  const result=[];while(edges.size){const start=edges.keys().next().value;let n=start,points=[],count=0;do{points.push([n%N,Math.floor(n/N)]);const list=edges.get(n);if(!list?.length)break;const next=list.pop();if(!list.length)edges.delete(n);n=next;}while(n!==start&&++count<W*H);if(n!==start||points.length<4)continue;const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;if(Math.abs(area)<2)continue;result.push(simplify(points).map(p=>unmap(...p)));}return result;
 }
 function cleanStairStrokes(stairs,t){
  // Merge coincident CAD tread skins, including reversed duplicates. Separate
  // steps and actual gaps remain separate; no replacement stair is invented.
  const lines=[],curves=[],tol=Math.max(.04,t*.1);
  for(const p of stairs){let previous=null;for(const q of p.commands){if(q[0]===0){previous=q.slice(1);continue;}if(q[0]!==1){curves.push(p);break;}if(previous){let a=previous,b=q.slice(1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>=t*.18){if(a[0]>b[0]||a[0]===b[0]&&a[1]>b[1])[a,b]=[b,a];lines.push({a,b,length,dash:p.dash,pattern:p.pattern});}}previous=q.slice(1);}}
  lines.sort((a,b)=>b.length-a.length);const kept=[];
  for(const l of lines){const ux=(l.b[0]-l.a[0])/l.length,uy=(l.b[1]-l.a[1])/l.length;let duplicate=false;for(const k of kept){if(k.dash!==l.dash)continue;const vx=(k.b[0]-k.a[0])/k.length,vy=(k.b[1]-k.a[1])/k.length;if(Math.abs(ux*vy-uy*vx)>.012)continue;const dist=p=>Math.abs((p[0]-k.a[0])*vy-(p[1]-k.a[1])*vx);if(dist(l.a)>tol||dist(l.b)>tol)continue;const a=(l.a[0]-k.a[0])*vx+(l.a[1]-k.a[1])*vy,b=(l.b[0]-k.a[0])*vx+(l.b[1]-k.a[1])*vy;if(a>k.length+tol||b< -tol)continue;const lo=Math.min(0,a),hi=Math.max(k.length,b),origin=k.a;k.a=[origin[0]+vx*lo,origin[1]+vy*lo];k.b=[origin[0]+vx*hi,origin[1]+vy*hi];k.length=hi-lo;duplicate=true;break;}if(!duplicate)kept.push({...l});}
  const seen=new Set(),result=kept.map(l=>({commands:[[0,...l.a],[1,...l.b]],dash:l.dash,pattern:l.pattern}));
  for(const p of curves){const pts=p.commands.flatMap(q=>q[0]===4?[]:Array.from({length:(q.length-1)/2},(_,i)=>[q[i*2+1],q[i*2+2]])),span=Math.max(...[0,1].map(axis=>Math.max(...pts.map(p=>p[axis]))-Math.min(...pts.map(p=>p[axis]))));if(p.closed&&span<t*2)continue;const key=JSON.stringify(p.commands);if(!seen.has(key)){seen.add(key);result.push(p);}}
  return result;
 }
 function presentationContours(walls,t,windows=[],doors=[]){
  const box=p=>({x0:Math.min(...p.map(q=>q[0])),x1:Math.max(...p.map(q=>q[0])),y0:Math.min(...p.map(q=>q[1])),y1:Math.max(...p.map(q=>q[1]))}),area=p=>p.reduce((v,q,i)=>v+q[0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*q[1],0)/2;
  const small=walls.map((p,i)=>({p,i,b:box(p),a:area(p)})).filter(v=>v.a<0&&Math.max(...wh(v.b))<t*.7&&Math.abs(v.a)<t*t*.5&&!windows.some(w=>v.b.x0<w.x1&&v.b.x1>w.x0&&v.b.y0<w.y1&&v.b.y1>w.y0)&&!doors.some(d=>Math.hypot((v.b.x0+v.b.x1)/2-d.hinge[0],(v.b.y0+v.b.y1)/2-d.hinge[1])<t));
  const hidden=new Set();for(const a of small){const [w,h]=wh(a.b),siblings=small.filter(b=>b!==a&&Math.abs(wh(b.b)[0]-w)<t*.08&&Math.abs(wh(b.b)[1]-h)<t*.08&&Math.hypot((b.b.x0+b.b.x1-a.b.x0-a.b.x1)/2,(b.b.y0+b.b.y1-a.b.y0-a.b.y1)/2)<t*2);if(siblings.length)hidden.add(a.i);}
  return {walls:walls.filter((_,i)=>!hidden.has(i)),hiddenEmbeddedVoids:hidden.size};
 }
 function build({mask,map,crop,structure:s,roomLabels,dimensions,details,rescuedDoors,landings=[]}){
  const origin=map(0,0),unit=map(1,0)[0]-origin[0],unmap=(x,y)=>[(x-origin[0])/unit,(y-origin[1])/unit],mc=mask.getContext('2d'),mp=mc.getImageData(0,0,mask.width,mask.height).data;
  const solid=(x,y)=>{const p=map(x,y),ix=Math.round(p[0]),iy=Math.round(p[1]);return ix>=0&&iy>=0&&ix<mask.width&&iy<mask.height&&mp[(iy*mask.width+ix)*4+3]>240;};let materialJoins=0;
  // Composite exterior walls: the PDF may leave white insulation between two
  // parallel structural skins. Join only narrow source wall-material polygons
  // proven to have wall ink on both sides; glazing has air on either side.
  for(const p of s.context||s.local||[]){const r=p.bounds,[w,h]=wh(r),short=Math.min(w,h),long=Math.max(w,h),horizontal=w>h,near=Math.min(Math.abs(r.x0-s.bounds.x0),Math.abs(r.x1-s.bounds.x1),Math.abs(r.y0-s.bounds.y0),Math.abs(r.y1-s.bounds.y1));if(!p.filled||p.curved||p.commands.length>6||p.fill?.gray<.98||!/стен|wall|фундамент/iu.test(p.layer||'')||short>s.thickness*2||long<short*4||near>s.thickness*6||!inside([(r.x0+r.x1)/2,(r.y0+r.y1)/2],crop))continue;let proven=0;for(const f of [.2,.5,.8]){const x=horizontal?r.x0+w*f:(r.x0+r.x1)/2,y=horizontal?(r.y0+r.y1)/2:r.y0+h*f;if([.2,.4,.6,1,1.5,2].some(v=>{const d=short/2+s.thickness*v;return horizontal?solid(x,y-d)&&solid(x,y+d):solid(x-d,y)&&solid(x+d,y);}))proven++;}if(proven===3){drawPath(mc,p.commands,map);mc.fillStyle=INK;mc.fill(p.evenOdd?'evenodd':'nonzero');materialJoins++;}}
  const walls=wallContours(mask,unmap),doors=[];
  const addDoor=d=>{if(!d||!d.hinge||!d.tip||!d.closed)return;if(doors.some(q=>Math.hypot(q.hinge[0]-d.hinge[0],q.hinge[1]-d.hinge[1])<s.thickness*.25&&Math.hypot(q.tip[0]-d.tip[0],q.tip[1]-d.tip[1])<s.thickness*.25))return;doors.push(d);};
  for(const d of details.doorAssemblies||[])addDoor(d);for(const d of rescuedDoors.assemblies||[])addDoor(d);
  const nearestWall=p=>{const a=map(...p),pix=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;let best=null;const radius=Math.ceil(s.thickness*unit*1.4);for(let r=0;r<=radius&&!best;r++)for(let k=0;k<24;k++){const x=Math.round(a[0]+Math.cos(k*Math.PI/12)*r),y=Math.round(a[1]+Math.sin(k*Math.PI/12)*r);if(x>=0&&y>=0&&x<mask.width&&y<mask.height&&pix[(y*mask.width+x)*4+3]>240){best=unmap(x,y);break;}}return best;};
  for(const d of doors){d.jamb=nearestWall(d.hinge);d.radius=Math.hypot(d.tip[0]-d.hinge[0],d.tip[1]-d.hinge[1]);}
  const apertures=[];for(const b of details.apertures||[]){const a=wh(b);if(apertures.some(q=>{const z=wh(q);return Math.abs(q.x0-b.x0)+Math.abs(q.y0-b.y0)+Math.abs(z[0]-a[0])+Math.abs(z[1]-a[1])<s.thickness*.4;}))continue;apertures.push({...b});}
  const stairs=[],seen=new Set();for(const p of details.selected){if(details.roles.get(p)!=='stairs')continue;const commands=details.strokes.get(p)||p.commands,key=JSON.stringify(commands.map(q=>q.map(n=>Math.round(n*20)/20)));if(seen.has(key))continue;seen.add(key);stairs.push({commands,dash:p.dash,pattern:p.dashPattern||[],closed:p.closed,filled:p.filled});}
  const stairSurfaces=(s.context||s.local||[]).filter(p=>p.filled&&!p.curved&&/лест|ступен|stair|step/iu.test(p.layer||'')&&wh(p.bounds).reduce((a,b)=>a*b,1)>s.thickness*s.thickness&&inside([(p.bounds.x0+p.bounds.x1)/2,(p.bounds.y0+p.bounds.y1)/2],crop)).map(p=>({commands:p.commands,evenOdd:p.evenOdd}));
  const presentation=presentationContours(walls,s.thickness,apertures,doors);
  const floors=s.floors.filter(p=>!/мебел|furniture|лест|stair|ступен|step|стен|wall|окон|window|двер|door/iu.test(p.layer||'')&&inside([(p.bounds.x0+p.bounds.x1)/2,(p.bounds.y0+p.bounds.y1)/2],crop)).map(p=>({commands:p.commands,bounds:p.bounds,evenOdd:p.evenOdd}));
  return {schema:'arhittek-semantic-floor/1',materialJoins,template:VERSION,units:'source-pdf-points',bounds:s.bounds,crop,thickness:s.thickness,walls:presentation.walls,hiddenEmbeddedVoids:presentation.hiddenEmbeddedVoids,doors,windows:apertures,stairs:cleanStairStrokes(stairs,s.thickness),stairSurfaces,floors,rooms:roomLabels.items.map(r=>({name:r.name,raw:r.raw,x:r.x,y:r.y})),landings,dimensions,sourceGeometry:true};
 }
 // Presentation furniture uses real millimetres and stays on its own drawing layer.
 const symbols={
  bed:[1600,2000],single:[900,2000],nightstand:[450,420],wardrobe:[1400,580],
  sofa:[2050,850],coffee:[950,450],table:[1450,1500],counter:[2200,600],
  shower:[900,900],basin:[650,480],wc:[420,680],desk:[1200,600]
 };
 function roomKit(name){
  if(/кухн.*гост|гост.*кухн/iu.test(name))return ['counter','sofa','table','coffee'];
  if(/кухн/iu.test(name))return ['counter','table'];
  if(/спальн|мастер.?сп/iu.test(name))return ['bed','nightstand','wardrobe'];
  if(/детск/iu.test(name))return ['single','desk','wardrobe'];
  if(/гостин|^зал$/iu.test(name))return ['sofa','coffee'];
  if(/сануз|ванн|душ|^с\.?\s*у\.?$/iu.test(name))return ['shower','wc','basin'];
  if(/кабинет/iu.test(name))return ['desk'];
  if(/гардероб/iu.test(name))return ['wardrobe'];
  return [];
 }
 function paintSymbol(c,type,x,y,w,h,turned){
  c.save();c.translate(x,y);
  if(turned){c.translate(w,0);c.rotate(Math.PI/2);[w,h]=[h,w];}
  c.scale(w,h);
  c.lineWidth=1.4/Math.min(w,h);c.strokeStyle='#928778';
  const box=(a,b,u,v,color)=>{c.fillStyle=color;c.fillRect(a,b,u,v);c.strokeRect(a,b,u,v);};
  const oval=(a,b,u,v,color)=>{c.beginPath();c.ellipse(a,b,u,v,0,0,Math.PI*2);c.fillStyle=color;c.fill();c.stroke();};
  const oak='#d9c4a5',linen='#eee6da',white='#faf8f3';
  c.shadowColor='rgba(62,48,32,.20)';c.shadowBlur=6;c.shadowOffsetY=4;
  if(type==='table'){
   for(const a of [.13,.58])for(const b of [.02,.75])box(a,b,.28,.22,linen);
   box(.04,.18,.92,.64,oak);
  }else{
   box(.01,.01,.98,.98,/bed|single|sofa/.test(type)?linen:/wc|basin|shower/.test(type)?white:oak);
   c.shadowColor='transparent';
   if(type==='bed'||type==='single'){
    const count=type==='bed'?2:1;
    for(let i=0;i<count;i++)box(.06+i*.47,.05,.88/count,.20,white);
    box(.04,.31,.92,.64,'#e3d6c4');
   }else if(type==='sofa'){
    for(let i=0;i<3;i++)box(.09+i*.275,.18,.265,.72,linen);
   }else if(type==='counter'){
    box(.07,.14,.22,.68,white);box(.69,.12,.24,.76,'#c8c2b8');
    for(const a of [.75,.86])for(const b of [.35,.65])oval(a,b,.036,.10,'#eee9dc');
   }else if(type==='basin'||type==='wc'){oval(.5,.53,.34,.34,white);}
   else if(type==='shower'){oval(.5,.5,.035,.035,'#a89e91');}
   else if(type==='nightstand'){oval(.5,.5,.23,.23,white);}
  }
  c.restore();
 }
 function furnish(model,c,regions,map,inWall){
  const dim=model.dimensions,b=model.bounds;
  const unit=(b.x1-b.x0)/dim?.widthMm,vertical=(b.y1-b.y0)/dim?.heightMm;
  if(!(unit>0&&vertical>0&&Math.abs(unit/vertical-1)<.05))return [];
  const occupied=[],placed=[];
  const overlaps=(a,b,p=0)=>a.x0<b.x1+p&&a.x1>b.x0-p&&a.y0<b.y1+p&&a.y1>b.y0-p;
  const extent=points=>({x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))});
  const paths=[...model.stairs,...(model.stairSurfaces||[])];
  const blocked=[...model.windows,...model.doors.map(d=>extent([d.hinge,d.tip,d.closed,[d.tip[0]+d.closed[0]-d.hinge[0],d.tip[1]+d.closed[1]-d.hinge[1]]])),...model.landings.map(l=>extent(l.polygon))];
  for(const path of paths){const points=[];for(const q of path.commands)for(let i=1;i<q.length;i+=2)points.push([q[i],q[i+1]]);if(points.length)blocked.push(extent(points));}
  for(const [room,floor] of regions){
   if([...regions.values()].filter(f=>f===floor).length!==1)continue;
   const r=floor.bounds,margin=100*unit,mid={x:(r.x0+r.x1)/2,y:(r.y0+r.y1)/2};
   const aisle={x0:mid.x-370*unit,x1:mid.x+370*unit,y0:mid.y-370*unit,y1:mid.y+370*unit};
   for(const type of roomKit(room.name)){
    let chosen;
    for(const turned of [false,true]){
     const [a,b]=symbols[type],w=(turned?b:a)*unit,h=(turned?a:b)*unit;
     const dx=r.x1-r.x0-w-2*margin,dy=r.y1-r.y0-h-2*margin;if(dx<0||dy<0)continue;
     for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[.5,0],[0,.5],[1,.5],[.5,1]]){
      const x=r.x0+margin+dx*u,y=r.y0+margin+dy*v,rect={x0:x,y0:y,x1:x+w,y1:y+h};
      if(overlaps(rect,aisle)||occupied.some(q=>overlaps(q,rect,240*unit))||blocked.some(q=>overlaps(q,rect,350*unit)))continue;
      drawPath(c,floor.commands,(x,y)=>[x,y]);let fits=true;
      for(let i=0;i<=8&&fits;i++)for(let j=0;j<=8&&fits;j++){
       const px=x+w*i/8,py=y+h*j/8;fits=!inWall(px,py)&&c.isPointInPath(px,py,floor.evenOdd?'evenodd':'nonzero');
      }
      if(fits){chosen={...rect,turned};break;}
     }
     if(chosen)break;
    }
    if(!chosen)continue;
    occupied.push(chosen);placed.push({room:room.name,type,...chosen});
    const [x,y]=map(chosen.x0,chosen.y0),[right,bottom]=map(chosen.x1,chosen.y1);
    paintSymbol(c,type,x,y,right-x,bottom-y,chosen.turned);
   }
  }
  return placed;
 }
 function render(model,{wallRepair,check=()=>{}}={}){
  const b=model.crop,[bw,bh]=wh(b),W=2400,H=Math.max(2200,Math.min(3600,Math.round(2100*bh/bw+520))),canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const c=canvas.getContext('2d'),scale=Math.min((W-540)/bw,(H-660)/bh),left=(W-bw*scale)/2,top=230+(H-660-bh*scale)/2,map=(x,y)=>[left+(x-b.x0)*scale,top+(y-b.y0)*scale],t=model.thickness;
  model.output={width:W,height:H,scale,left,top};c.fillStyle=PAPER;c.fillRect(0,0,W,H);c.fillStyle=INK;c.font='bold 39px Arial, sans-serif';c.fillText('ARHITTEK',145,108);c.fillStyle='#838980';c.font='25px Arial, sans-serif';c.fillText('Планировка',145,157);
  const floorTone=name=>/сануз|ванн|душ|^су|^т$/iu.test(name)?'#e3e9e5':/спальн|детск|гостин|кабин|столов|^зал/iu.test(name)?'#eae0d2':'#f0ece3';
  c.fillStyle='#f0ece3';for(const f of model.floors){drawPath(c,f.commands,map);c.fill(f.evenOdd?'evenodd':'nonzero');}
  const regionFor=new Map(),areas=model.floors.slice().sort((a,b)=>wh(a.bounds).reduce((a,b)=>a*b,1)-wh(b.bounds).reduce((a,b)=>a*b,1));
  for(const r of model.rooms){const f=areas.find(f=>{if(!inside([r.x,r.y],f.bounds))return false;drawPath(c,f.commands,(x,y)=>[x,y]);return c.isPointInPath(r.x,r.y,f.evenOdd?'evenodd':'nonzero');});if(f){regionFor.set(r,f);drawPath(c,f.commands,map);c.fillStyle=floorTone(r.name);c.fill(f.evenOdd?'evenodd':'nonzero');}}
  for(const slab of model.stairSurfaces||[]){drawPath(c,slab.commands,map);c.fillStyle='#f2f0e9';c.fill(slab.evenOdd?'evenodd':'nonzero');}
  for(const landing of model.landings){polygon(c,landing.polygon,map);c.fillStyle='#f2f0e9';c.fill();c.strokeStyle='#aeb9ad';c.lineWidth=1.5;c.stroke();}
  const wallLayer=document.createElement('canvas');wallLayer.width=W;wallLayer.height=H;const wc=wallLayer.getContext('2d');wc.beginPath();for(const p of model.walls)polygon(wc,p,map,false);wc.fillStyle=INK;wc.fill('nonzero');for(const w of model.windows){const a=map(w.x0,w.y0),d=map(w.x1,w.y1);wc.clearRect(a[0],a[1],d[0]-a[0],d[1]-a[1]);}c.save();c.shadowColor='rgba(41,58,48,.15)';c.shadowBlur=12;c.shadowOffsetX=5;c.shadowOffsetY=8;c.drawImage(wallLayer,0,0);c.restore();
  const sourceInk=wc.getImageData(0,0,W,H).data,inWall=(x,y)=>{const p=map(x,y),ix=Math.round(p[0]),iy=Math.round(p[1]);return ix>=0&&iy>=0&&ix<W&&iy<H&&sourceInk[(iy*W+ix)*4+3]>240;};
  model.furniture=furnish(model,c,regionFor,map,inWall);
  for(const w of model.windows){const [ww,hh]=wh(w),h=ww>hh,a=map(w.x0,w.y0),d=map(w.x1,w.y1);c.fillStyle='#fafcfb';c.fillRect(a[0],a[1],d[0]-a[0],d[1]-a[1]);c.strokeStyle=LINE;c.lineWidth=1.7;for(const f of [.25,.5,.75]){c.beginPath();if(h){c.moveTo(a[0],a[1]+(d[1]-a[1])*f);c.lineTo(d[0],a[1]+(d[1]-a[1])*f);}else{c.moveTo(a[0]+(d[0]-a[0])*f,a[1]);c.lineTo(a[0]+(d[0]-a[0])*f,d[1]);}c.stroke();}c.strokeRect(a[0],a[1],d[0]-a[0],d[1]-a[1]);}
  const stairBox=model.stairs.map(p=>p.commands.flatMap(q=>q[0]===4?[]:q.slice(1).filter((_,i)=>i%2===0).map((x,i)=>[x,q[i*2+2]]))).flat();
  for(const stair of model.stairs){check();drawPath(c,stair.commands,map);c.strokeStyle='#8c9990';c.lineWidth=1.5;c.setLineDash(stair.dash?stair.pattern.map(n=>n*scale):[]);c.stroke();}c.setLineDash([]);
  for(const d of model.doors){const h=map(...d.hinge),q=map(...d.tip);if(d.jamb){const j=map(...d.jamb);c.beginPath();c.moveTo(...j);c.lineTo(...h);c.strokeStyle='#7e9286';c.lineWidth=Math.max(2.5,t*scale*.14);c.stroke();}c.beginPath();c.moveTo(...h);c.lineTo(...q);c.strokeStyle='#6c8475';c.lineWidth=2.4;c.stroke();const start=Math.atan2(d.tip[1]-d.hinge[1],d.tip[0]-d.hinge[0]),end=Math.atan2(d.closed[1]-d.hinge[1],d.closed[0]-d.hinge[0]),sweep=Math.atan2(Math.sin(end-start),Math.cos(end-start));c.beginPath();c.arc(h[0],h[1],d.radius*scale,start,start+sweep,sweep<0);c.strokeStyle='#9aa99d';c.lineWidth=1.4;c.stroke();}
  c.drawImage(wallLayer,0,0);const labelCollisions=[];
  for(const r of model.rooms){let [x,y]=map(r.x,r.y),lx=r.x,rx=r.x;const step=Math.max(.25,t/5);for(let n=0;n<1000&&lx>b.x0;n++){if(inWall(lx-step,r.y))break;lx-=step;}for(let n=0;n<1000&&rx<b.x1;n++){if(inWall(rx+step,r.y))break;rx+=step;}let uy=r.y,dy=r.y;for(let n=0;n<1000&&uy>b.y0;n++){if(inWall(r.x,uy-step))break;uy-=step;}for(let n=0;n<1000&&dy<b.y1;n++){if(inWall(r.x,dy+step))break;dy+=step;}const max=Math.max(35,Math.min(470,(rx-lx)*scale-22));let size=34;c.font='600 '+size+'px Arial, sans-serif';while(size>23&&c.measureText(r.name).width>max){size--;c.font='600 '+size+'px Arial, sans-serif';}const lines=[];let line='';for(const word of String(r.name).split(/[\s-]+/)){const next=line?line+' '+word:word;if(line&&c.measureText(next).width>max){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);const tw=Math.min(max,Math.max(...lines.map(l=>c.measureText(l).width))),th=lines.length*(size+7),ax=map(lx,r.y)[0]+tw/2+7,bx=map(rx,r.y)[0]-tw/2-7,ay=map(r.x,uy)[1]+th/2+5,by=map(r.x,dy)[1]-th/2-5;if(ax<=bx)x=Math.max(ax,Math.min(bx,x));if(ay<=by)y=Math.max(ay,Math.min(by,y));
   const region=regionFor.get(r),valid=(px,py)=>{for(let yy=-th/2;yy<=th/2;yy+=Math.max(3,th/5))for(let xx=-tw/2;xx<=tw/2;xx+=Math.max(3,tw/10)){const sx=b.x0+(px+xx-left)/scale,sy=b.y0+(py+yy-top)/scale;if(inWall(sx,sy)||model.furniture.some(item=>inside([sx,sy],item)))return false;}return true;};
   if(!valid(x,y)){const candidates=[];for(let yy=-4;yy<=4;yy++)for(let xx=-4;xx<=4;xx++){const sx=r.x+xx*t*.7,sy=r.y+yy*t*.7;if(region){drawPath(c,region.commands,(a,b)=>[a,b]);if(!c.isPointInPath(sx,sy,region.evenOdd?'evenodd':'nonzero'))continue;}const q=map(sx,sy);if(valid(...q))candidates.push({q,d:Math.hypot(q[0]-x,q[1]-y)});}candidates.sort((a,b)=>a.d-b.d);if(candidates.length)[x,y]=candidates[0].q;}
   if(!valid(x,y))labelCollisions.push(r.name);
   c.fillStyle=INK;c.textAlign='center';c.textBaseline='middle';lines.forEach((l,i)=>c.fillText(l,x,y+(i-(lines.length-1)/2)*(size+7),max));}
  const dims=model.dimensions,body=model.bounds;if(dims?.widthMm>0&&dims?.heightMm>0){const a=map(body.x0,body.y0),d=map(body.x1,body.y1),dy=top+bh*scale+80,dx=left-90;c.strokeStyle=LINE;c.lineWidth=1.7;c.beginPath();c.moveTo(a[0],dy);c.lineTo(d[0],dy);c.moveTo(dx,a[1]);c.lineTo(dx,d[1]);c.stroke();c.strokeStyle='#c7cec3';for(const x of [a[0],d[0]]){c.beginPath();c.moveTo(x,d[1]+15);c.lineTo(x,dy+13);c.stroke();c.beginPath();c.moveTo(x-7,dy+7);c.lineTo(x+7,dy-7);c.stroke();}for(const y of [a[1],d[1]]){c.beginPath();c.moveTo(dx-13,y);c.lineTo(a[0]-15,y);c.stroke();c.beginPath();c.moveTo(dx-7,y+7);c.lineTo(dx+7,y-7);c.stroke();}const fmt=(n,k)=>(dims.derived?.includes(k)?'≈ ':'')+(n/1000).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' м';c.font='28px Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';const text=fmt(dims.widthMm,'width'),tw=c.measureText(text).width;c.fillStyle=PAPER;c.fillRect((a[0]+d[0]-tw)/2-15,dy-22,tw+30,44);c.fillStyle=LINE;c.fillText(text,(a[0]+d[0])/2,dy);c.save();c.translate(dx,(a[1]+d[1])/2);c.rotate(-Math.PI/2);const h=fmt(dims.heightMm,'height'),hw=c.measureText(h).width;c.fillStyle=PAPER;c.fillRect(-hw/2-15,-22,hw+30,44);c.fillStyle=LINE;c.fillText(h,0,0);c.restore();}
  let samples=0,lost=0;const out=c.getImageData(0,0,W,H).data;for(let i=0;i<sourceInk.length;i+=64){if(sourceInk[i+3]<245)continue;samples++;if(out[i]>130||out[i+1]>150||out[i+2]>160)lost++;}const image=canvas.toDataURL('image/png'),thumb=document.createElement('canvas');thumb.width=270;thumb.height=Math.round(H/W*270);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);const thumbnail=thumb.toDataURL('image/jpeg',.85);canvas.width=canvas.height=wallLayer.width=wallLayer.height=thumb.width=thumb.height=0;
  return {image,thumbnail,sourceCrop:model.crop,details:{stairs:model.stairs.length,doors:model.doors.length,windows:model.windows.length},wallSamples:samples,wallLost:lost,wallRepair,model,labelCollisions};
 }
 root.CatalogPlanModel=Object.freeze({version:VERSION,build,render,wallContours,cleanStairStrokes,presentationContours});
})(typeof window==='undefined'?globalThis:window);
