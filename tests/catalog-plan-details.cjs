global.CatalogQuality=require('../catalog-quality');
// Source-primitive regression: production exports only the public renderer.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={CatalogQuality:global.CatalogQuality,window:{},CatalogPdfCore:require('../catalog-pdf-core')};vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../catalog-plan.js'),'utf8').replace('Object.freeze({prepare,refreshExisting','Object.freeze({architecturalDetails,segmentedDoors,prepare,refreshExisting'),context);
const api=context.window.CatalogPlan,s={bounds:{x0:0,y0:0,x1:400,y1:400},thickness:10};
const line=(x,y,a,b,layer='')=>({stroked:true,filled:false,curved:false,dash:false,layer,commands:[[0,x,y],[1,a,b]],bounds:{x0:Math.min(x,a),y0:Math.min(y,b),x1:Math.max(x,a),y1:Math.max(y,b)}});
const stairs=Array.from({length:6},(_,i)=>line(200,200+i*5,260,200+i*5,'-- Лестницы'));
const hatch=Array.from({length:12},(_,i)=>line(40,50+i*5,90,50+i*5,'--Стены 1-2 этаж'));
const grid=line(30,40,190,40,'--Стены 1-2 этаж');
const selected=api.architecturalDetails([...stairs,...hatch,grid],s,{items:[]},()=>false,new Set());
assert(stairs.every(p=>selected.selected.has(p)),'Named source stair treads survive');
assert(hatch.every(p=>!selected.selected.has(p))&&!selected.selected.has(grid),'Wall hatches and room grids cannot become stairs');
assert.equal(selected.counts.stairs,6,'No broad staircase zone admits thousands of wall/room strokes');
const roomNumbers=Array.from({length:9},(_,i)=>({text:String(i+1),cx:50+i*10,cy:60+i%3*10,h:8}));
const unrelated=line(40,70,150,70),none=api.architecturalDetails([unrelated],s,{items:roomNumbers},()=>false,new Set());
assert(!none.selected.has(unrelated),'Room-number clusters do not establish staircase regions');
const leaf=line(100,100,140,100),arc=[];
for(let i=0;i<6;i++){const a=i*.26,b=a+.15;arc.push(line(100+40*Math.cos(a),100+40*Math.sin(a),100+40*Math.cos(b),100+40*Math.sin(b)));}
const wall=(x,y)=>x>=90&&x<=98&&y>=102&&y<=110;
const doors=api.segmentedDoors([leaf,...arc],s,wall);
assert(doors.has(leaf)&&arc.every(p=>doors.has(p)),'Disconnected CAD door-swing dashes and their actual source leaf survive');
assert.equal(api.segmentedDoors(arc,s,wall).size,0,'An unsupported arc without a source leaf cannot add marks');
assert.equal(api.segmentedDoors([leaf,...hatch],s,wall).size,0,'Repeated hatch strokes cannot masquerade as a door swing');
// Real CAD exports offset a swing centre from the structural mask by a
// finish/jamb thickness. Keep both source parts, not an invented arc.
const swing={...line(140,100,100,140),curved:true,commands:[[0,140,100],[2,140,122.0914,122.0914,140,100,140]]};
const offsetWall=(x,y)=>x>=87&&x<=91&&y>=96&&y<=104;
const offset=api.architecturalDetails([leaf,swing],s,{items:[]},offsetWall,new Set());
assert(offset.selected.has(swing)&&offset.selected.has(leaf),'Finish-face offset must not erase the source door and leaf');
assert(!api.architecturalDetails([swing],s,{items:[]},offsetWall,new Set()).selected.has(swing),'A curve without a radial source leaf is not a door');
const upper=Array.from({length:6},(_,i)=>({...line(200,270+i*5,260,270+i*5),dash:true}));
const flights=api.architecturalDetails([...stairs,...upper,grid,...hatch],s,{items:[]},()=>false,new Set());
assert(upper.every(p=>flights.selected.has(p)),'An unnamed dashed upper flight survives beside a named lower flight');
assert(!flights.selected.has(grid),'Adding an upper flight does not reintroduce the room grid');
// A frame may be one compound PDF path: its first segment is a short jamb,
// later segments carry the glazing. Only those source segments may be drawn.
const aperture={...line(100,30,180,50),filled:true,stroked:false,fill:{gray:1},bounds:{x0:100,y0:30,x1:180,y1:50}};
const frame={...line(100,39,180,41),commands:[[0,100,39],[1,100,41],[1,180,41],[1,180,39],[1,100,39],[0,250,200],[1,350,200]],bounds:{x0:100,y0:39,x1:350,y1:200}};
const jambs=(x,y)=>((x>=85&&x<100)||(x>180&&x<=195))&&y>=30&&y<=50;
const glazing=api.architecturalDetails([aperture,frame],s,{items:[]},jambs,new Set());
assert(glazing.selected.has(frame),'A compound frame is recognised from the full source aperture');
assert(glazing.strokes.get(frame).every(c=>c[1]<=180),'Unrelated segments in a compound path are not copied with the window');
const textBox=api.architecturalDetails([aperture,frame],s,{items:[{text:'Спальня',cx:140,cy:40,h:8}]},jambs,new Set());
assert(!textBox.selected.has(frame),'A room-label table cannot become a window');
const coarse=Array.from({length:6},(_,i)=>line(100+40*Math.cos(i*Math.PI/12),100+40*Math.sin(i*Math.PI/12),100+40*Math.cos((i+1)*Math.PI/12),100+40*Math.sin((i+1)*Math.PI/12)));
assert(coarse.every(p=>api.segmentedDoors([leaf,...coarse],s,(x,y)=>x>=92&&x<=95&&y>=96&&y<=104).has(p)),'Coarse flattened swing chords longer than the partition thickness survive');
console.log(JSON.stringify({cleanArchitecturalDetails:'passed',checks:15}));
