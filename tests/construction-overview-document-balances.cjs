'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/features/overview/construction-summary.js', 'utf8');
const start = source.indexOf('function renderConstrSummary(){');
const end = source.indexOf('\nfunction renderOverview(){', start);
assert.ok(start >= 0 && end > start, 'construction overview function exists');
const renderSource = source.slice(start, end);

function render(records) {
  const el = {innerHTML:''};
  const scope = {
    document:{getElementById:id=>id==='constrSummaryBlock'?el:null},
    getConstrProjects:()=>records.map(({project})=>project),
    getConstructionFinancials:p=>records.find(({project})=>project.id===p.id).financials,
    getProjectFee:()=>{throw new Error('Construction summary must not use employee commission');},
    findStatus:()=>({name:'В процессе'}),
    isFrozen:()=>false,
    escapeHtml:v=>String(v),
  };
  vm.createContext(scope);
  vm.runInContext(renderSource,scope);
  scope.renderConstrSummary();
  return el.innerHTML;
}

function cells(html, section) {
  const body = html.split('<'+section+'>')[1]?.split('</'+section+'>')[0];
  assert.ok(body, section+' must be rendered');
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row=>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>
      cell[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
    )
  );
}

const noCash = {
  received:0, cashOutgoing:0, balance:0, isOverspent:false, directPaid:0,
  matTotal:1234.56, workTotal:0, otherTotal:0, unpaidInvoices:1234.56
};
const none = {
  received:0, cashOutgoing:0, balance:0, isOverspent:false, directPaid:0,
  matTotal:0, workTotal:0, otherTotal:0, unpaidInvoices:0
};
const html = render([
  {project:{id:'a',name:'Тестовый объект A'},financials:noCash},
  {project:{id:'b',name:'Тестовый объект Б'},financials:none}
]);
assert.match(html, /<th>Накладные<\/th><th>Не оплачено<\/th>/);
assert.doesNotMatch(html, /<th>% исполнителя<\/th>/);
assert.deepEqual(cells(html,'tbody'),[
  ['Тестовый объект A В процессе','0 ₽','0 ₽','0 ₽','1 234,56 ₽','1 234,56 ₽'],
  ['Тестовый объект Б В процессе','0 ₽','0 ₽','0 ₽','0 ₽','0 ₽']
]);
assert.deepEqual(cells(html,'tfoot'),[[
  'Итого','0 ₽','0 ₽','0 ₽','1 234,56 ₽','1 234,56 ₽'
]]);
assert.match(html,/Накладные — стоимость документов, а не подтверждённая выплата/);

const paid = render([{project:{id:'c',name:'Расчётный объект'},financials:{
  received:12000.25, cashOutgoing:5000.10, balance:7000.15,
  directPaid:0, isOverspent:false,
  matTotal:3000.05, workTotal:700.20, otherTotal:0, unpaidInvoices:100.05
}}]);
assert.deepEqual(cells(paid,'tbody'),[[
  'Расчётный объект В процессе','7 000,15 ₽','5 000,1 ₽','12 000,25 ₽','3 700,25 ₽','100,05 ₽'
]]);
assert.deepEqual(cells(paid,'tfoot'),[[
  'Итого','7 000,15 ₽','5 000,1 ₽','12 000,25 ₽','3 700,25 ₽','100,05 ₽'
]]);
assert.match(render([]),/Нет строительных объектов/);
console.log('Construction overview: invoice costs, unpaid amounts, cash and kopeks OK');
