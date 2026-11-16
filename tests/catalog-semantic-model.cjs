// Independent geometry invariants for the approved semantic template.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),canvas=require('@napi-rs/canvas');
global.document={createElement:()=>canvas.createCanvas(1,1)};
vm.runInThisContext(fs.readFileSync('catalog-plan-model.js','utf8'));
const c=canvas.createCanvas(120,100),ctx=c.getContext('2d');ctx.fillRect(10,10,100,80);ctx.clearRect(20,20,80,60);ctx.clearRect(45,5,20,20);
const contours=CatalogPlanModel.wallContours(c,(x,y)=>[x,y]);
const out=canvas.createCanvas(120,100),oc=out.getContext('2d');oc.beginPath();for(const ring of contours){ring.forEach((p,i)=>i?oc.lineTo(...p):oc.moveTo(...p));oc.closePath();}oc.fill();
for(const [x,y,ink]of [[15,50,true],[60,50,false],[55,15,false],[90,15,true],[60,85,true]])assert.equal(oc.getImageData(x,y,1,1).data[3]>240,ink,'Wall topology and real opening remain unchanged');
const stroke=(a,b)=>({commands:[[0,...a],[1,...b]],dash:false,pattern:[]});
const stairs=CatalogPlanModel.cleanStairStrokes([stroke([10,10],[60,10]),stroke([60,10],[10,10]),stroke([10,10.4],[60,10.4]),stroke([10,20],[60,20]),stroke([70,10],[90,10])],8);
assert.equal(stairs.length,3,'Coincident reversed tread skins collapse; separate steps and gaps survive');
assert(stairs.some(s=>s.commands[0][2]===20),'Second actual tread is preserved');
assert(stairs.some(s=>s.commands[0][1]===70),'Gap in source is never joined');
console.log(JSON.stringify({semanticModel:'passed',checks:8}));

// A repeated small service-symbol kit inside a wall is presentation clutter;
// real room voids and identified glazing must stay open.
const ring=(x,y,w,h,negative=false)=>{const p=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];return negative?p.reverse():p;};
const raw=[ring(0,0,100,30),ring(10,5,3,6,true),ring(17,5,3,6,true),ring(40,5,30,20,true)];
const plain=CatalogPlanModel.presentationContours(raw,10);assert.equal(plain.hiddenEmbeddedVoids,2);assert(plain.walls.includes(raw[3]),'Actual room-size opening is retained');
const glazed=CatalogPlanModel.presentationContours(raw,10,[{x0:9,y0:4,x1:21,y1:12}]);assert.equal(glazed.hiddenEmbeddedVoids,0,'Identified glazing is never filled');
console.log(JSON.stringify({embeddedServiceSymbols:'passed',checks:3}));
