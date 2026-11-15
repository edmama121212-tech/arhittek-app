const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.window=global;global.CatalogPdfCore=require('../catalog-pdf-core.js');
vm.runInThisContext(fs.readFileSync(require.resolve('../catalog-plan.js'),'utf8'));
const C=CatalogPdfCore,P=CatalogPlan;
assert.equal(C.folderNumber('E:\\Проекты\\АРХИВ\\Проект №0421 Рустам\\Без номера.pdf'),'0421');
assert.equal(C.folderNumber('Проект №13225 Дом'),'13225');
assert.equal(C.folderNumber('Альбом без номера.pdf'),null);
assert.equal(C.folderNumber('Проект №123456 Неоднозначный'),null);
const word=(text,x,y,extra={})=>({text,x0:x,y0:y,x1:x+5,y1:y+7,...extra});
const info=C.pageFromItems([word('Обмерный план',20,20)],500,500,5);
assert(P.labels&&C.planInfos(info,1).some(p=>p.page===5&&p.floor==='floor1'),'A reversed heading must retain its own plan page');
const structure={bounds:{x0:0,y0:0,x1:200,y1:200},local:[],context:[],floors:[]};
const table={verified:true,roomIds:['1','2','3'],rows:[{name:'Зал',area:'20,00'},{name:'Кухня',area:'15,00'},{name:'Холл',area:'8,00'}]};
const markers=C.pageFromItems([word('1',30,30,{markerVerified:true}),word('2',140,40,{markerVerified:true}),word('3',90,140,{markerVerified:true})],200,200,1);
assert(P.labels(markers,structure,table).complete,'Decoded source circles map IDs to schedule rows');
const printed=C.pageFromItems([word('20,00',30,30),word('15,00',140,40),word('8,00',90,140)],200,200,1);
assert(P.labels(printed,structure,table).complete,'Unique printed areas recover absent IDs');
const ambiguous={rows:[{name:'Зал',area:'20,00'},{name:'Кухня',area:'20,00'}]};
assert.equal(P.labels(printed,structure,ambiguous).complete,false,'Equal areas cannot arbitrarily assign room names');
const rect=(x,y,w,h,layer='Стены 1 этаж')=>({bounds:{x0:x,y0:y,x1:x+w,y1:y+h},commands:[[0,x,y],[1,x+w,y],[1,x+w,y+h],[1,x,y+h],[4]],points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],filled:true,stroked:false,closed:true,curved:false,layer,fill:{gray:.6,saturation:0},pattern:false,clips:[]});
const walls=[rect(100,100,10,300),rect(290,100,10,300),rect(100,100,200,10)],banner=rect(150,35,180,15,'');
const planInfo=C.pageFromItems([word('План 1 этаж',120,20)],600,600,1);
const selected=P.chooseStructure([...walls,banner],planInfo,'floor1');assert(selected);assert.equal(selected.bounds.y0,100,'An isolated unlayered title strip is not a wall');
console.log(JSON.stringify({catalogImportRecovery:'passed',checks:9}));
const schedulePage=C.pageFromItems([
word('Экспликация 2 этажа',20,10,{x1:110}),word('№',5,30),word('Наименование',20,30,{x1:100}),word('Площадь',120,30,{x1:162}),word('Объём',170,30,{x1:205}),
word('1',5,50),word('Кухня',20,50,{x1:70}),word('10,00',130,50,{x1:155}),word('30,00',172,50,{x1:197}),
word('2',5,70),word('Зал',20,70,{x1:70}),word('20,00',130,70,{x1:155}),word('60,00',172,70,{x1:197}),
word('Итого',20,90,{x1:70}),word('30,00',130,90,{x1:155})],400,400,1);
const schedule=C.tables(schedulePage)[0];assert(schedule?.verified);assert.equal(schedule.rows.length,2);assert.equal(schedule.total,30,'Volume cells must never concatenate with room areas');
const foundation=[rect(100,100,10,300,'Фундамент'),rect(290,100,10,300,'Фундамент'),rect(100,100,200,10,'Фундамент')].map(p=>({...p,fill:{gray:1,saturation:0}}));
const foundationPlan=P.chooseStructure(foundation,planInfo,'floor1');assert(foundationPlan&&foundationPlan.walls.length===3,'Explicit narrow foundation contours survive unhatched white exports');
const fragments=[rect(100,100,10,100),rect(100,250,10,100),rect(290,100,10,100),rect(290,250,10,100),rect(100,100,200,10)];
const footprint={...rect(100,100,200,250,'Зона'),fill:{gray:.91,saturation:0}};
const joined=P.chooseStructure([...fragments,footprint],planInfo,'floor1');assert(joined&&joined.walls.length===5,'Floor footprints must join fragments before small groups are discarded');
console.log(JSON.stringify({catalogRecoveryTablesAndWalls:'passed',checks:3}));
