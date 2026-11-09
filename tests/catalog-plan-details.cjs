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
console.log(JSON.stringify({cleanArchitecturalDetails:'passed',checks:7}));
