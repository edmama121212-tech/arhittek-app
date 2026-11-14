const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');let checks=0;
const core=require('../catalog-pdf-core');
function cold(name){const sandbox={console,TextDecoder,DOMException,document:{readyState:'loading',addEventListener(){}},CatalogPdfCore:core};sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../catalog-floors.js'),'utf8'),sandbox);vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),sandbox);return sandbox;}
(async()=>{
 for(const file of ['catalog-pdf.js','catalog-plan.js']){const sandbox=cold(file);assert.equal(sandbox.CatalogQuality.version,'catalog-quality-1',file+' initializes its own dependency without a head script');checks++;assert.equal(typeof sandbox.CatalogQuality.reviewCard,'function');checks++;}
 const sandbox=cold('catalog-plan.js'),api=sandbox.CatalogQuality,image='data:image/png;base64,checked';let calls=0,listener;
 const fields={'ce-num':'00157-A','ce-title':'Жилой дом','ce-area':'25,00','ce-price':'89000','ce-beds':'1','ce-baths':'1','ce-area1':'25,00','ce-expl1':'Спальня: 20,00\nСанузел: 5,00'};
 sandbox.document={getElementById:id=>id==='ce-quality-status'?null:{value:fields[id]||''},addEventListener:(name,fn)=>{listener=fn}};
 Object.assign(sandbox,{ceFloorsSelected:1,ceFeatureSelected:[],ceCurrentId:null,cardsData:[],ceImages:['facade',null,image],canEditCards:()=>true,parseExpl:text=>text?text.split('\n').map(line=>{const [name,area]=line.split(':');return {name,area:area.trim()}}):[],saveCard:async()=>{calls++;return {ok:true}},CatalogPdfImport:{}});
 sandbox.cePdfImportMeta={sources:{plans:{floor1:{rooms:2,roomNames:['Спальня','Санузел'],quality:api.reviewPlan({image,wallSamples:1000,wallLost:0,labelsComplete:true,details:{stairs:10,doors:3,windows:4},wallCount:12,dimensions:{widthMm:10000,heightMm:12000}})}}}};
 api.protectSave();assert.equal((await sandbox.saveCard()).awaitingManualSave,true,'Old importer cannot autosave through its old inline function');assert.equal(calls,0);checks++;
 listener({isTrusted:true,target:{closest:()=>({})}});assert.equal((await sandbox.saveCard()).ok,true,'Explicit Save works without newer shell globals or quality UI');assert.equal(calls,1);checks++;
 fields['ce-area']='99';listener({isTrusted:true,target:{closest:()=>({})}});assert.equal((await sandbox.saveCard()).qualityBlocked,true);assert.equal(calls,1,'Legacy Save still enforces quality before persistence');checks++;
 console.log(JSON.stringify({catalogDependencyRecovery:'passed',checks}));
})().catch(e=>{console.error(e);process.exitCode=1});
