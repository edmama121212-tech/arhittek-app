// Reproduce a basement schedule beside an unrelated ground-floor drawing.
// All PDFs are synthetic. No private albums or production writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {jsPDF}=require('jspdf'),canvas=require('@napi-rs/canvas');
Object.assign(global,{DOMMatrix:canvas.DOMMatrix,Path2D:canvas.Path2D,ImageData:canvas.ImageData});
global.window=global;global.document={createElement:()=>canvas.createCanvas(1,1)};global.CatalogPdfCore=require('../catalog-pdf-core');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../catalog-plan.js'),'utf8'));
const word=(text,x,y)=>({text,x0:x,x1:x+text.length*5,y0:y,y1:y+10,cx:x+text.length*2.5,cy:y+5,h:10});
(async()=>{
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');let checks=0;
 async function prepare({room=false,caption='План 1-го этажа',hatches=false,duplicate=false,ambiguous=false,untitled=false}={}){
  const pdf=new jsPDF({unit:'pt',format:[900,640],orientation:'landscape'});
  pdf.setFillColor(170);pdf.moveTo(70,100).lineTo(490,100).lineTo(490,520).lineTo(70,520).close().moveTo(85,115).lineTo(475,115).lineTo(475,505).lineTo(85,505).close().fillEvenOdd();
  pdf.rect(274,115,12,390,'F');pdf.rect(85,304,390,12,'F');
  if(room){pdf.setFillColor(180,210,190);pdf.rect(286,316,189,189,'F');if(duplicate)pdf.rect(286,316,189,189,'F');if(ambiguous)pdf.rect(306,336,189,169,'F');pdf.setFillColor(255);pdf.rect(475,390,15,40,'F');}
  if(hatches){pdf.saveGraphicsState();pdf.rect(286,316,189,189,null).clip().discardPath();pdf.setLineWidth(0);pdf.setDrawColor(100);for(let x=294;x<470;x+=6)for(let y=324;y<500;y+=6)pdf.line(x,y,x+3,y);for(let y=330;y<=380;y+=10)pdf.line(400,y,465,y);pdf.restoreGraphicsState();}
  const task=pdfjs.getDocument({data:new Uint8Array(pdf.output('arraybuffer'))}),doc=await task.promise,page=await doc.getPage(1),view=page.getViewport({scale:1});
  const table={verified:true,rows:[{name:'Подвал',area:'26,40'}],roomIds:['1'],floor:'basement',label:'Экспликация подвала',left:550,right:820,top:80,bottom:150,cx:685,page:1};
  const info=CatalogPdfCore.pageFromItems([word(caption,70,40),word('Экспликация подвала',550,60),word('Подвал',590,110),...(room?[word('Подвал',330,430)]:[])],view.width,view.height,1);if(untitled)table.label='';info.tables=[table];
  const result=await CatalogPlan.prepare({pdfjs,page,info,table,key:'basement',optionalContent:await doc.getOptionalContentConfig({intent:'display'})});await task.destroy();return result;
 }
 const unrelated=await prepare();assert.equal(unrelated.ok,false,'A basement table cannot turn a ground-floor drawing into a basement');checks++;
 const untitled=await prepare({untitled:true});assert.equal(untitled.ok,false,'An assigned table without a title is still not drawing evidence');checks++;
 const unlabelled=await prepare({room:true});assert(unlabelled.ok,'The labelled basement can be separated from a foundation without a formal floor heading');checks++;
 assert(unlabelled.report.focused&&unlabelled.report.sourceCrop.x0>250&&unlabelled.report.sourceCrop.y0>280,'Only the basement footprint enters the crop');checks++;
 assert.equal(unlabelled.report.widthMm,null,'Whole-foundation dimensions are not assigned to the cropped basement');checks++;
 const duplicate=await prepare({room:true,duplicate:true});assert(duplicate.ok&&duplicate.report.focused,'Coincident floor fills do not create false ambiguity');checks++;
 const ambiguous=await prepare({room:true,ambiguous:true});assert.equal(ambiguous.ok,false,'Overlapping but different footprints require another source instead of guessing');checks++;
 const technical=await prepare({caption:'План фундамента'});assert.equal(technical.ok,false,'A foundation without a basement region cannot be uploaded as the basement');checks++;
 const clean=await prepare({room:true,hatches:true});assert(clean.ok);const image=await canvas.loadImage(clean.image),out=canvas.createCanvas(image.width,image.height),ctx=out.getContext('2d');ctx.drawImage(image,0,0);
 const b=clean.report.sourceCrop,scale=Math.min(1420/(b.x1-b.x0),1290/(b.y1-b.y0)),left=(1800-(b.x1-b.x0)*scale)/2+25,top=65+(1290-(b.y1-b.y0)*scale)/2;
 const pixel=(x,y)=>Array.from(ctx.getImageData(Math.round((left+(x-b.x0)*scale)*2),Math.round((top+(y-b.y0)*scale)*2),1,1).data).slice(0,3);
 assert(pixel(307.5,354).every(n=>n>230),'Repeated floor hatching is removed');checks++;
 const stairInk=[];for(let y=349;y<=351;y+=.1)stairInk.push(...pixel(430,y));assert(Math.min(...stairInk)<210,'Long stair treads in the same clipping region survive hatch removal');checks++;
 assert(pixel(480,410).every(n=>n>220),'The original opening remains open rather than painted as a wall');checks++;
 assert(pixel(280,430).every(n=>n<100),'Wall contour stays dark and visible');checks++;
 console.log(JSON.stringify({basementRecognition:'passed',checks}));
})().catch(e=>{console.error(e);process.exitCode=1});
