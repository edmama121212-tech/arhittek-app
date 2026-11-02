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

eq(core.floorIn('План 2-го этажа. Стены подвала'),'floor2','Basement note cannot override named second floor');
eq(core.floorIn('Кладочный план. Стены подвала'),null,'Basement wall legend cannot fabricate a level');
eq(core.floorIn('Экспликация подвала'),'basement','Explicit basement explication remains supported');
let skipped=table({caption:'Экспликация 1-го этажа'});skipped.find(w=>w.text==='2').text='7';
result=core.analyze([page(1,[w('Проект №11525',20,20),w('Одноэтажный дом',20,50)]),page(2,[...plan(1),...skipped])]);
eq(result.blocking,[],'Non-contiguous identifiers pass when printed total matches');
let broken=table({caption:'Экспликация 1-го этажа'});broken.find(w=>w.text==='25.00').text='30.00';
result=core.analyze([page(1,[w('Проект №11525',20,20),w('Одноэтажный дом',20,50)]),page(2,[...plan(1),...broken])]);
eq([result.data.total_area,result.data.beds],[undefined,undefined],'Mismatched table cannot fabricate validated totals or room counts');
let split=table({caption:'Экспликация 1-го этажа'});split=split.flatMap(item=>item.text==='20.00'?[w('20,',720,item.y0),w('00',740,item.y0)]:[item]);
result=core.analyze([page(1,[w('Проект №11525',20,20),w('Одноэтажный дом',20,50)]),page(2,[...plan(1),...split])]);
eq([result.data.total_area,result.blocking],['25,00',[]],'Split decimal PDF cells join before arithmetic validation');
console.log(JSON.stringify({passed,failed:[]}));
// Regression cases from heterogeneous Archicad albums (no private files).
eq(core.floorIn('План -1-й этаж'),'basement','Negative first level is basement');
eq(core.floorIn('План 2-этаж'),'floor2','Abbreviated hyphenated floor');
for(const prefix of ['2/','2\\']){
 const r=core.analyze([title(),p1(),page(3,plan(2)),page(5,table({prefix}))]);
 eq(r.sources.floor2.association,'room_numbers','Slash/backslash floor prefix');
}
let duplicate=table();duplicate.find(v=>v.text==='2').text='1';
let r=core.analyze([page(1,[w('Одноэтажный дом',20,20)]),page(2,[...plan(1),...duplicate])]);
eq([r.data.total_area,r.data.project_number,r.warnings.some(v=>v.includes('повторяются'))],['25,00',null,true],'Arithmetic total independent of duplicated identifiers; absent number stays manual');
let aggregate=table({values:[20,5,100,500]});aggregate=aggregate.filter(v=>v.y0!==180);aggregate.push(w('Итого',530,235),w('625.00',720,235));
aggregate.filter(v=>v.text==='С/У').forEach((v,i)=>{if(i===1)v.text='Дом';if(i===2)v.text='Участок';});
r=core.analyze([page(1,[w('Одноэтажный дом',20,20)]),page(2,[...plan(1),...aggregate])]);
eq([r.data.total_area,r.levels.floor1.table.verified,r.levels.floor1.table.rows.length],['25,00',true,2],'Site and building aggregate rows excluded after raw arithmetic validation');
let bedrooms=table();bedrooms.find(v=>v.text==='Спальня').text='СП-1';
r=core.analyze([page(1,[w('Одноэтажный дом',20,20)]),page(2,[...plan(1),...bedrooms])]);eq(r.data.beds,1,'Numbered bedroom abbreviation');
const identity=Array.from({length:4},(_,i)=>page(i+1,[w('Проект №17/ 2022-АР',20,20)]));identity.push(page(5,[w('Проект №99/2022',20,20)]));
eq(core.analyze(identity).data.project_number,'17/2022','Split identifier, discipline suffix and minority typo');
const note=page(2,[w('Пояснительная записка',20,20),...table({caption:'Экспликация 1-го этажа'})]);eq(core.planInfos(note,1),[],'Description table is not a plan');
console.log(JSON.stringify({contextTotal:passed,failed:[]}));
