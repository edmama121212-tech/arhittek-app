const assert=require('node:assert/strict'),core=require('../catalog-pdf-core');
let passed=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);passed++};
const w=(text,x,y)=>({text,x0:x,x1:x+text.length*6,y0:y,y1:y+10});
const page=(n,items)=>core.pageFromItems(items,1000,700,n);
const title=()=>page(1,[w('Проект №11525',20,20),w('Двухэтажный дом',20,50)]);
const plan=(floor,x=20)=>[w('План',x,30),w(String(floor)+'-го',x+32,30),w('этажа',x+65,30)];
function table({x=500,prefix='',caption='',values=[20,5]}={}){
 return [...(caption?[w(caption,x,70)]:[]),w('№',x,100),w('Наименование',x+30,100),w('Площадь',x+220,100),...values.flatMap((a,i)=>[w(prefix+(i+1),x,125+i*22),w(i?'С/У':'Спальня',x+30,125+i*22),w(a.toFixed(2),x+220,125+i*22)]),w('Итого',x+30,180),w(values.reduce((a,b)=>a+b,0).toFixed(2),x+220,180)];
}
const p1=()=>page(2,[...plan(1),...table({caption:'Экспликация 1-го этажа'})]);
let result=core.analyze([title(),p1(),page(3,[...plan(2),...table()])]);
eq([result.data.total_area,result.sources.floor2.association,result.blocking],['50,00','same_plan',[]],'Unlabelled second-floor table follows fragmented native plan heading');
result=core.analyze([title(),p1(),page(3,plan(2)),page(4,table())]);
eq([result.data.total_area,result.sources.floor2.association,result.blocking],['50,00','adjacent_plan',[]],'Standalone explication follows adjacent second-floor plan');
result=core.analyze([title(),page(2,[...plan(1),...table({x:20}),...plan(2,550),...table({x:550})])]);
eq([result.data.total_area,result.sources.floor1.association,result.sources.floor2.association],['50,00','spatial_plan','spatial_plan'],'Identical legitimate floors counted separately on shared sheet');
for(const prefix of ['2.','20']){
 result=core.analyze([title(),p1(),page(3,plan(2)),page(5,table({prefix}))]);
 eq([result.data.total_area,result.sources.floor2.association,result.blocking],['50,00','room_numbers',[]],'Room prefix '+prefix+' infers floor');
}
result=core.analyze([title(),p1(),page(3,[...plan(2),...table()]),page(4,[...plan(2),...table()])]);
eq(result.data.total_area,'50,00','Repeated plan and table do not double area');
result=core.analyze([title(),p1(),page(3,table({values:[40,10]})),page(4,plan(2))]);
eq(result.data.total_area,undefined,'Conflicting neighbouring floors leave unlabelled table ambiguous');
assert(result.blocking.some(s=>s.includes('2-й этаж')));passed++;
result=core.analyze([title(),p1(),page(3,[...plan(2),...table()]),page(4,[w('Общая площадь дома: 45,00 м²',20,20)])]);
eq(result.data.total_area,'45,00','Explicit whole-house area takes priority');
eq(core.floorIn('План II этажа'),'floor2','Roman floor heading');
console.log(JSON.stringify({passed,failed:[]}));
