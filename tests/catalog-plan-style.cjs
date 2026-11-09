// Real PDF.js painting, isolated synthetic drawings; no production data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {jsPDF}=require('jspdf'),canvas=require('@napi-rs/canvas');
Object.assign(global,{DOMMatrix:canvas.DOMMatrix,Path2D:canvas.Path2D,ImageData:canvas.ImageData});
global.window=global;global.requestAnimationFrame=f=>setTimeout(f,0);global.cancelAnimationFrame=clearTimeout;
const printed=[];global.document={createElement:()=>{const c=canvas.createCanvas(1,1),ctx=c.getContext('2d'),fill=ctx.fillText.bind(ctx);ctx.fillText=(text,...args)=>{printed.push(String(text));return fill(text,...args)};return c;}};
global.CatalogPdfCore=require('../catalog-pdf-core');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../catalog-plan.js'),'utf8'));
(async()=>{
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const pdf=new jsPDF({unit:'pt',format:[900,640],orientation:'landscape'});
 // A compound wall with a hole, thin unnumbered treads, dashed overhead
 // flight, winding treads, and outside entrance steps on a light landing.
 pdf.setFillColor(191);pdf.moveTo(70,100).lineTo(490,100).lineTo(490,520).lineTo(70,520).close().moveTo(85,115).lineTo(475,115).lineTo(475,505).lineTo(85,505).close().fillEvenOdd();
 pdf.rect(274,115,12,390,'F');pdf.rect(85,304,390,12,'F');
 pdf.setDrawColor(0);pdf.setLineWidth(.25);
 for(let i=0;i<9;i++)pdf.line(320,350+i*5,390,350+i*5);
 pdf.setLineDashPattern([2,2],0);pdf.line(320,345,390,345);pdf.setLineDashPattern([],0);
 for(let i=0;i<=6;i++){const a=i*Math.PI/6;pdf.line(425,440,425+35*Math.cos(a),440+35*Math.sin(a));}
 pdf.setFillColor(230);pdf.rect(140,520,85,30,'F');
 for(const y of [525,533,541,549])pdf.line(140,y,225,y);
 // A nearby three-row sheet table is not an exterior staircase.
 for(const y of [580,600,620])pdf.line(140,y,225,y);
 // This later opaque floor deliberately hides a construction line.
 pdf.line(100,260,250,260);pdf.setFillColor(255);pdf.rect(100,255,150,10,'F');
 // Source furniture is omitted; a narrow window opening stays neutral.
 pdf.setFillColor(180,215,245);pdf.rect(160,180,55,30,'F');pdf.rect(300,103,60,5,'F');
 // A wall miter is exported as two small triangles, not a dimension arrow.
 pdf.setFillColor(255);pdf.rect(274,200,12,12,'F');pdf.setFillColor(191);
 pdf.moveTo(274,200).lineTo(286,200).lineTo(286,212).close().fill();
 pdf.moveTo(274,200).lineTo(286,212).lineTo(274,212).close().fill();
 // Generic clutter must not leak into the room interior.
 pdf.setDrawColor(120);pdf.line(100,170,250,170);pdf.setFillColor(180,215,245);pdf.rect(110,150,30,15,'F');
 // A shallow 20-degree door arc and its leaf must survive, not only 90-degree arcs.
 pdf.setDrawColor(0);pdf.setLineWidth(.3);pdf.lines([[0,4.66,-.82,9.28,-2.41,13.68]],326,240,[1,1],'S',false);pdf.line(286,240,323.59,253.68);
 // A source column marker is a white square with reinforcement hatch,
 // not a doorway. It must merge into the same solid wall cut.
 pdf.setFillColor(255);pdf.rect(274,304,12,12,'F');pdf.setDrawColor(160,100,0);pdf.setLineWidth(.2);
 pdf.line(274,308,278,304);pdf.line(274,314,284,304);pdf.line(278,316,286,308);
 pdf.setDrawColor(170,20,0);pdf.line(274,304,286,304);
 const task=pdfjs.getDocument({data:new Uint8Array(pdf.output('arraybuffer'))});const doc=await task.promise,page=await doc.getPage(1),viewport=page.getViewport({scale:1}),optionalContent=await doc.getOptionalContentConfig({intent:'display'});
 const items=[['Спальня',135,200],['С/У',350,200],['Кухня гостиная',130,420]].map(([text,x,y])=>({text,x0:x,y0:y,x1:x+text.length*5,y1:y+10,cx:x+text.length*2.5,cy:y+5,h:10}));
 const info={width:viewport.width,height:viewport.height,items,tables:[],phrases:[],text:''},table={rows:items.map(w=>({name:w.text,area:'20,00'}))};
 const result=await CatalogPlan.prepare({pdfjs,page,info,table,key:'floor1',optionalContent});assert(result.ok,result.reason);
 assert.equal(result.report.renderer,'source-vector-relief');assert.equal(result.report.template,'3.1');assert.equal(result.report.windows,'neutral');
 assert(result.report.sourceCrop.y1>550,'Exterior landing and all steps fit inside the crop');
 assert(result.report.sourceCrop.y1<610,'Sheet table rows cannot expand the crop as steps');
 const image=await canvas.loadImage(result.image),out=canvas.createCanvas(image.width,image.height),ctx=out.getContext('2d');ctx.drawImage(image,0,0);
 const b=result.report.sourceCrop,scale=Math.min(1420/(b.x1-b.x0),1290/(b.y1-b.y0)),left=(1800-(b.x1-b.x0)*scale)/2+25,top=65+(1290-(b.y1-b.y0)*scale)/2;
 const reference=canvas.createCanvas(Math.ceil((b.x1-b.x0)*scale*2),Math.ceil((b.y1-b.y0)*scale*2));
 await page.render({canvasContext:reference.getContext('2d'),viewport:page.getViewport({scale:scale*2}),transform:[1,0,0,1,-b.x0*scale*2,-b.y0*scale*2],background:'#fff',optionalContentConfigPromise:Promise.resolve(optionalContent)}).promise;
 const pixel=(x,y)=>Array.from(ctx.getImageData(Math.round((left+(x-b.x0)*scale)*2),Math.round((top+(y-b.y0)*scale)*2),1,1).data).slice(0,3);
 assert(result.report.details.doors>=2,'Shallow door arc and its leaf are retained');
 assert(pixel(280,206).every(n=>n<110),'Both triangular halves of a wall junction remain solid');
 assert(pixel(170,170).every(n=>n>220),'Unrelated room-interior construction line is omitted');
 assert(pixel(280,310).every(n=>n<110),'Reinforcement column is a solid continuation of the wall');
 assert(result.report.columns>=1,'Column evidence is recorded');
 assert.equal(result.report.roomNames.length,3,'Room names are positioned from the source');
 assert(printed.includes('Спальня')&&printed.includes('Санузел'),'Room names reach the actual text renderer');
 assert(!printed.some(text=>/20[,.]00|м²/.test(text)),'Room areas are not printed in the plan');
 assert(pixel(75,200).every(n=>n<210)&&pixel(150,150).every(n=>n>220),'Compound wall keeps its hole');
 assert(pixel(150,260).every(n=>n>220),'Covered construction marks stay covered');
 const furniture=pixel(180,190),window=pixel(330,105);
 assert(furniture.every(n=>n>220),'Furniture is omitted from the restricted clean plan');
 assert(window.every(n=>n>210),'A genuine window opening is not filled with wall');
 assert(Math.max(...window)-Math.min(...window)<8,'Windows are neutral despite blue source fills');
 assert(pixel(86,200)[0]<pixel(240,200)[0],'Soft wall contact shadows are visible');
 for(const [name,region] of [['straight and dashed flight',[315,340,395,397]],['winding flight',[385,400,465,480]],['outside steps',[135,520,230,552]]]){
  const [x0,y0,x1,y1]=region,x=Math.round((x0-b.x0)*scale*2),y=Math.round((y0-b.y0)*scale*2),w=Math.round((x1-x0)*scale*2),h=Math.round((y1-y0)*scale*2);
  const expected=reference.getContext('2d').getImageData(x,y,w,h).data;
  const actual=ctx.getImageData(Math.round(left*2)+x,Math.round(top*2)+y,w,h).data;
  let ink=0,lost=0;for(let i=0;i<expected.length;i+=4)if(expected[i]<150&&expected[i+1]<150&&expected[i+2]<150){ink++;if(Math.min(actual[i],actual[i+1],actual[i+2])>215)lost++;}
  assert(ink>100,name+' contains actual source strokes');assert(lost/ink<.06,name+' preserves source strokes ('+lost+'/'+ink+' lost)');
 }
 // Pattern-only balcony outside the wall footprint must expand the plan.
 const paths=CatalogPlan.vectors(pdfjs,await page.getOperatorList(),viewport,()=>{},optionalContent);
 assert.equal(CatalogPlan.chooseStructure(paths.map(p=>({...p,layer:'Конструктив - Крыши'})),info,'floor1'),null,'Roof layers cannot become walls');
 const balcony={...paths.find(p=>p.filled),bounds:{x0:20,y0:150,x1:70,y1:480},filled:true,pattern:true,fill:null,closed:true};
 const expanded=CatalogPlan.chooseStructure([...paths,balcony],info,'floor1');assert(expanded.bounds.x0<=20,'Pattern-only balcony is included');

 await task.destroy();console.log(JSON.stringify({planStyle31:'passed',checks:25}));
})().catch(e=>{console.error(e);process.exitCode=1});

