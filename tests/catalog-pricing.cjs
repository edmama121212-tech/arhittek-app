// Tariff boundaries are for the entire area, including enabled basement area.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ctx={};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('catalog-floors.js','utf8'),ctx);const p=ctx.CatalogFloors;
for(const [area,rate,price]of [['58,85',150,8828],['99,99',150,14999],['100',100,10000],['100,01',100,10001],['399,99',100,39999],['400',100,40000],['400,01',80,32001],['414,81',80,33185],['1 234,56',80,98765]]){assert.equal(p.rate(area),rate,area);assert.equal(p.autoPrice(area),price,area);assert.equal(p.price({total_area:area,price:'0'}),price,area);}
for(const area of ['',0,-1,'unknown','1,2,3']){assert.equal(p.autoPrice(area),null);assert.equal(p.rate(area),null);}
assert.equal(p.price({total_area:'400,01',price:'89 000'}),89000,'Explicit manual prices remain possible');
assert.equal(p.price({price:'',total_area:'100'},999),10000,'Obsolete uniform rate cannot change the tariff');
const card={floors:1,tags:['Цокольный этаж'],expl1:[{name:'Дом',area:'90'}],expl_basement:[{name:'Подвал',area:'30'}]};const before=JSON.stringify(card),areas=p.calculateAreas(card);assert.equal(p.autoPrice(areas.patch.total_area),12000,'Basement participates in whole-house total');assert.equal(JSON.stringify(card),before);
const fields={'ce-area':{value:'99,99'},'ce-price':{value:'999'}},document={getElementById:id=>fields[id]};ctx.document=document;ctx.cePreview=()=>{};vm.runInContext(fs.readFileSync('src/features/media/image-upload.js','utf8'),ctx);
for(const [area,expected]of [['99,99','14999'],['100','10000'],['400','40000'],['400,01','32001'],['','']]){fields['ce-area'].value=area;ctx.ceAutoPrice();assert.equal(fields['ce-price'].value,expected,'Editor updates price for '+area);}
console.log('Catalogue tariff: boundaries, decimal rounding, basement area, editor updates, invalid input and manual overrides passed');
