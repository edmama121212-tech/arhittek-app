const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage();await page.goto('about:blank');
await page.addScriptTag({path:require.resolve('jspdf/dist/jspdf.umd.min.js')});await page.addScriptTag({path:require.resolve('jspdf-autotable/dist/jspdf.plugin.autotable.min.js')});
for(const file of ['catalog-floors.js','src/features/catalog/card-pdf-export.js'])await page.addScriptTag({path:path.resolve(file)});
const fonts=fs.readFileSync('index.html','utf8'),regular=fonts.match(/const ROBOTO_REGULAR_B64\s*=\s*"([^"]+)"/),bold=fonts.match(/const ROBOTO_BOLD_B64\s*=\s*"([^"]+)"/);
assert(regular&&bold,'Production Cyrillic font data exists');
await page.evaluate(({regular,bold})=>{window.registerPdfFonts=doc=>{for(const [style,data]of [['normal',regular],['bold',bold]]){doc.addFileToVFS(style+'.ttf',data);doc.addFont(style+'.ttf','Roboto',style);}doc.setFont('Roboto');};},{regular:regular[1],bold:bold[1]});
const result=await page.evaluate(async()=>{
const c=document.createElement('canvas');c.width=600;c.height=400;c.getContext('2d').fillRect(20,20,500,300);const img=c.toDataURL();
const card={id:'unchanged',project_number:'0017',title:'Семейный дом',floors:3,total_area:'200,25',price:'24030',tags:['Цокольный этаж'],images:[img,img,img,img,img,img],expl1:Array.from({length:45},(_,i)=>({name:'Комната '+i,area:'5,00'})),expl2:[{name:'Спальня',area:'20'}],expl3:[],expl_basement:[]};const before=JSON.stringify(card),{doc}=await createCatalogCardPdf(card);return {before,after:JSON.stringify(card),pages:doc.internal.getNumberOfPages(),bytes:Array.from(new Uint8Array(doc.output('arraybuffer'))),prices:[CatalogFloors.price({total_area:'1 234,56',price:'0'},120),CatalogFloors.price({total_area:'200',price:'89 000'},120),CatalogFloors.price({total_area:'?',price:''},120),CatalogFloors.priceText({price:0})]};});
assert.equal(result.before,result.after);assert(result.pages>=6,'All four levels and overflow schedule exported');assert.deepEqual(result.prices,[148147,89000,null,'Цена по запросу']);assert.equal(Buffer.from(result.bytes).subarray(0,4).toString(),'%PDF');
// Parse the produced PDF independently to verify Cyrillic text and floor inclusion.
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await pdfjs.getDocument({data:Uint8Array.from(result.bytes),useSystemFonts:true}).promise;let text='';for(let i=1;i<=pdf.numPages;i++)text+=(await (await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');
for(const label of ['Семейный дом','Спальня','Цокольный этаж','3-й этаж','Комната 44','24 030'])assert(text.replace(/\s+/g,' ').includes(label),label);
await page.evaluate(()=>{window.fetch=async()=>{throw Error('offline');};});await assert.rejects(()=>page.evaluate(()=>createCatalogCardPdf({floors:1,images:['https://broken.test/image.png']})),/PDF не сохранён/);
console.log('Card PDF: Cyrillic, all floors, multi-page schedules, price parsing, immutable data and failed image handling passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
