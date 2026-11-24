const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('integrations/google-apps-script/InstagramRecipients.gs','utf8');
const header = ['Дата отправки (UTC)','Instagram клиента','ID комментария','Доставка',
  'Создание ссылки (UTC)','Действует до (UTC)','Аккаунт ARHITTEK','Что написал'];
const data = [header,[
  '2026-11-24 08:30:22','','17945332326391809','Отправлено',
  '2026-11-24 08:30:18','2026-11-26 08:30:18','@arhittek.plans',''
]];
const sheet = {
  getLastRow:()=>data.length,
  getRange(row,col,height=1,width=1){
    return {
      getDisplayValues:()=>Array.from({length:height},(_,i)=>
        Array.from({length:width},(_,j)=>String(data[row-1+i]?.[col-1+j]||''))),
      getDisplayValue:()=>String(data[row-1]?.[col-1]||''),
      setNumberFormat(){return this},
      setValue(v){data[row-1][col-1]=v;return this},
      setValues(matrix){for(let i=0;i<matrix.length;i++){const cells=matrix[i];if(!data[row-1+i])data[row-1+i]=Array(8).fill('');for(let j=0;j<cells.length;j++)data[row-1+i][col-1+j]=cells[j]}return this},
    }
  }
};
const file={getId:()=> '1ZtoRdi5O9coUHX2sR9zh4WsdBOC8exY6qUIsbEW9c-o',getSheetByName:n=>n==='Получили ссылку'?sheet:null};
const rows=[{
  account_id:'17841422845904072',comment_id:'17945332326391809',
  sent_at:'2026-11-24T08:30:22Z',username:'real_account',
  comment_text:'Хочу проект',link_created_at:'2026-11-24T08:30:18Z',expires_at:'2026-11-26T08:30:18Z',
},{
  account_id:'17841422845904072',comment_id:'18176950642457925',
  sent_at:'2026-11-24T08:50:21Z',username:'other_verified',
  comment_text:'=IMPORTXML("evil")',link_created_at:'2026-11-24T08:50:18Z',expires_at:'2026-11-26T08:50:18Z',
}];
const ctx={
  SpreadsheetApp:{getActiveSpreadsheet:()=>file,flush:()=>{}},
  ScriptApp:{getIdentityToken:()=> 'fake-google-id-token',getProjectTriggers:()=>[],
    newTrigger:()=>({timeBased:()=>({everyMinutes:n=>({create:()=>assert.equal(n,5)})})})},
  UrlFetchApp:{fetch:(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer fake-google-id-token');return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({rows})}}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{formatDate:d=>d.toISOString().replace('T',' ').slice(0,19)}
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
ctx.installInstagramRecipientSync();
assert.equal(data.length,3);
assert.equal(data[1][1],'@real_account');
assert.equal(data[1][7],'Хочу проект');
assert.equal(data[2][2],'18176950642457925');
assert.equal(data[2][7].startsWith("'="),true,'formula injection must be escaped');
ctx.syncInstagramRecipients();
assert.equal(data.length,3,'repeated sync must not duplicate recipients');
console.log('Independent Google Sheets sync: owner auth, 5-minute trigger, enrichment, deduplication and formula safety passed');
