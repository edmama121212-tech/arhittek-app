const assert=require('node:assert/strict'),q=require('../catalog-quality');let checks=0;
const image='data:image/png;base64,checked-source',report=q.reviewPlan({image,wallSamples:1000,wallLost:0,labelsComplete:true,details:{stairs:20,doors:4,windows:6},wallCount:12,dimensions:{widthMm:10000,heightMm:12000}});
assert(report.passed);checks++;
const params={image,wallSamples:1000,wallLost:0,labelsComplete:true,details:{stairs:20,doors:4,windows:6},wallCount:12};
for(const patch of [{wallLost:20},{labelsComplete:false},{details:{stairs:5000}},{details:{furniture:1}},{wallCount:0}]){assert(!q.reviewPlan({...params,...patch}).passed);checks++;}
const meta={sources:{plans:{floor1:{quality:report,rooms:2,roomNames:['Спальня','Санузел']}}}},card={project_number:'00157-A',title:'Жилой дом',floors:1,total_area:'25,00',floor1_area:'25,00',expl1:[{name:'Спальня',area:'20,00'},{name:'Санузел',area:'5,00'}],beds:1,baths:1,price:'89000',tags:[],images:['facade',null,image]};
assert(q.reviewCard(card,meta).passed);checks++;
for(const patch of [{total_area:'250'},{floor1_area:'20'},{beds:0},{baths:2},{project_number:'Проект №1122 файл'},{images:['facade',null,image+'modified']},{images:[]},{expl1:[{name:'Спальня',area:'-1'}]}]){assert(!q.reviewCard({...card,...patch},meta).passed);checks++;}
assert(!q.reviewCard(card,{sources:{plans:{floor1:{quality:{...report,dimensionsConfirmed:false}}}}}).passed);checks++;
assert(!q.reviewCard(card,{sources:{plans:{floor1:{style:'manual-screenshot'}}}}).passed);checks++;
assert(!q.reviewCard(card,{sources:{plans:{floor1:{quality:{...report,passed:false}}}}}).passed);checks++;
console.log(JSON.stringify({publicationQuality:'passed',checks}));
