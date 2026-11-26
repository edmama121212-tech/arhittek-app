'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');
const mock = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const files = ['index.html','employee-access.js'];
const assets = new Map(files.map(f => [f,fs.readFileSync(path.join(root,f))]));
const build = [...assets.values()].map(bytes => createHash('sha256').update(bytes).digest('hex').slice(0,12)).join('/');
const cases = [
  ['primary','Открыть обе очереди основному исполнителю','00','11'],
  ['assistant','Дать соисполнителю доступ к проектам и объектам','00','11'],
  ['member','Разрешить участнику команды работу по двум направлениям','00','11'],
  ['empty','Открыть разделы до первого назначения','00','11'],
  ['site','Перевести проектировщика на площадку с сохранением назначений','10','01'],
  ['office','Вернуть сотрудника со стройки к проектным карточкам','01','10'],
  ['suspend','Приостановить оба направления, сохранить активную учётную запись','11','00'],
  ['docs','Оставить ведущему только документы','11','00'],
  ['cancel','Отменить подготовленную смену рабочих разделов','10','01'],
  ['retry','Повторить назначение после ошибки записи','01','10'],
  ['new','Принять нового сотрудника в стройку','10','01'],
  ['legacy','Указать явные ограничения для старой карточки менеджера','11','00'],
  ['owner','Сохранить карточку владельца со старыми отключёнными флагами','00','00']
];
async function session(browser, init, actor) {
  const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.addInitScript({content:mock+'\n('+((data,actor) => {
    Object.assign(__db,data);
    if(actor)localStorage.setItem('arhittek_session',JSON.stringify({employeeId:actor.id,name:actor.name,token:'qa-'+actor.id,createdAt:Date.now()}));
  }).toString()+')('+JSON.stringify(init)+','+JSON.stringify(actor || null)+');'});
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if(u.origin!=='https://app.test')return route.fulfill({body:''});
    const name=u.pathname==='/'?'index.html':u.pathname.slice(1);
    if(assets.has(name))return route.fulfill({body:assets.get(name),contentType:name.endsWith('.html')?'text/html':'text/javascript'});
    const file=path.join(root,name);
    return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404,body:''});
  });
  const p=await ctx.newPage();
  p.setDefaultTimeout(6000);
  await p.goto('https://app.test/');
  await p.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&!loadAllInFlight);
  return p;
}
function projectFixture(mode, id){
  const projects=[], project_members=[];
  for(const [category,name] of [['arch','Проект'],['build','Объект']]){
    const own={id:'my-'+category,name:name+' участка',employee_id:'visual',status_id:'active',category_id:category};
    if(mode==='assistant')own.co_employee_id=id;
    else if(mode==='member')project_members.push({id:'m-'+category,project_id:own.id,employee_id:id});
    else if(!['empty','new'].includes(mode))own.employee_id=id;
    projects.push(own,{...own,id:'other-'+category,name:name+' чужой бригады',employee_id:'visual',co_employee_id:null});
  }
  return {projects,project_members};
}
async function verifyStaff(view,mode,rights){
  const owner=mode==='owner',docs=owner||mode==='docs';
  const nav=key=>view.locator('.nav-btn[data-view="view-'+key+'"]');
  assert.equal(await nav('cards').isVisible(),owner);
  assert.equal(await nav('finance').isVisible(),owner);
  assert.equal(await nav('more').isVisible(),docs);
  const sections=['projects','construction'];
  for(const [i,key] of sections.entries()){
    const visible=owner||rights[i]==='1';
    assert.equal(await nav(key).isVisible(),visible,key);
    if(!visible)continue;
    await nav(key).click();
    await view.locator('#view-'+key+'.active').waitFor();
    const list=view.locator(i?'#constructionList':'#projectsCard');
    const name=i?'Объект':'Проект';
    assert.equal(await list.getByText(name+' участка',{exact:true}).isVisible(),!['empty','new'].includes(mode));
    assert.equal(await list.getByText(name+' чужой бригады',{exact:true}).isVisible(),owner);
  }
  if(docs){
    await nav('more').click();
    assert.ok(await view.locator('#openContractsBtn').isVisible());
  }
  if(owner){
    await nav('cards').click();
    assert.ok(await view.locator('#cards-pdf-button').isVisible());
  }
  const empty=view.locator('#noEmployeeSections');
  assert.equal(await empty.isVisible(),!docs&&rights==='00');
  if(!docs&&rights==='00'){
    assert.match(await empty.innerText(),/попросите владельца/);
    assert.ok(await view.locator('.bottom-nav').isHidden());
  }
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  const rows=[['Элементы','Сборка index / employee-access','UTC','Сценарий','Шаги','Результат и связь с рабочими разделами','От нажатия до закрытия формы, мс','Вид и удобство','Стенд','Итог']];
  try{
    for(const [mode,title,initial,target] of cases){
      const owner=mode==='owner',id=owner?'admin':'architect';
      const fixture=projectFixture(mode,id);
      const p=await session(browser,fixture);
      try{
        await p.evaluate(async({mode,id,initial})=>{
          const person=__db.employees.find(e=>e.id===id);
          Object.assign(person,{
            can_edit_cards:true,
            can_see_projects:mode==='legacy'?null:initial[0]==='1',
            can_see_construction:mode==='legacy'?null:initial[1]==='1'
          });
          if(mode==='docs')person.role='Ведущий архитектор';
          if(mode==='legacy')person.role='Менеджер';
          await loadAll();
        },{mode,id,initial});
        await p.locator('#settingsBtn').click();
        const name=mode==='new'?'Тестовый инженер':owner?'Мансур':'Адам';
        const card=p.locator('#employeesCard .list-item').filter({hasText:name}).getByRole('button');
        if(mode==='new'){
          await p.locator('#addEmployeeBtn').click();
          await p.locator('#ef-name').fill(name);
          await p.locator('#ef-pin').fill('702813');
        }else await card.click();
        const boxes=[p.locator('#ef-see-projects'),p.locator('#ef-see-construction')];
        assert.equal(await p.locator('#ef-can-edit-cards').isVisible(),false);
        let visual='';
        if(owner){
          assert.ok(await p.locator('#ef-sections-field').isHidden());
          assert.match(await p.locator('#ef-role-access').innerText(),/все разделы/);
          visual='В карточке владельца показано пояснение о полном доступе.';
        }else{
          for(const [i,box] of boxes.entries()){
            assert.equal(await box.isChecked(),initial[i]==='1');
            const label=box.locator('..');
            await label.scrollIntoViewIfNeeded();
            const rect=await label.boundingBox();
            assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=390.5);
            await label.click();
            assert.equal(await box.isChecked(),target[i]==='1');
          }
          const preview=await p.locator('#ef-role-access').innerText();
          assert.equal(preview.includes('свои проекты'),target[0]==='1');
          assert.equal(preview.includes('свои объекты'),target[1]==='1');
          visual='Обе подписи нажимаются и помещаются на 390 px. '+preview;
        }
        if(mode==='retry')await p.evaluate(()=>window.__fail={table:'employees',op:'update',error:{message:'Тестовый отказ'}});
        const start=performance.now();
        if(mode==='cancel')await p.locator('#ef-cancel').click();
        else{
          await p.locator('#ef-save').click();
          if(mode==='retry'){
            await p.locator('#toast').filter({hasText:'Тестовый отказ'}).waitFor();
            assert.deepEqual(await p.evaluate(()=>[__db.employees.at(-1).can_see_projects,__db.employees.at(-1).can_see_construction]),[false,true]);
            await p.evaluate(()=>window.__fail=null);
            await p.locator('#ef-save').click();
          }
        }
        await p.locator('#empSheetOverlay').waitFor({state:'hidden'});
        await p.waitForFunction(()=>!loadAllInFlight);
        const ms=Math.round(performance.now()-start);
        const employees=await p.evaluate(()=>__db.employees);
        const person=employees.find(e=>e.name===name);
        const rights=mode==='cancel'?initial:target;
        assert.deepEqual([person.can_see_projects,person.can_see_construction],[rights[0]==='1',rights[1]==='1']);
        assert.equal(person.can_edit_cards,mode==='new'?undefined:true);
        assert.deepEqual(await p.evaluate(()=>__db.projects),fixture.projects);
        assert.deepEqual(await p.evaluate(()=>__db.project_members),fixture.project_members);
        await card.click();
        if(!owner)for(const [i,box] of boxes.entries())assert.equal(await box.isChecked(),rights[i]==='1');
        const v=await session(browser,{...fixture,employees},person);
        try{
          await verifyStaff(v,mode,rights);
          if(mode==='suspend'&&process.env.SECTIONS_SHOT)await v.screenshot({path:process.env.SECTIONS_SHOT});
        }finally{await v.context().close();}
        const steps=(mode==='new'?'Настройки → Добавить сотрудника → имя и PIN':'Настройки → '+name)
          +(owner?' → проверить пояснение':' → Проектный '+initial[0]+'→'+target[0]+' → Стройка '+initial[1]+'→'+target[1])
          +(mode==='cancel'?' → Отмена':mode==='retry'?' → Сохранить → ошибка → повторить':' → Сохранить')+' → открыть карточку снова → войти отдельно → проверить меню и списки';
        const result=owner?'У владельца доступны проектный раздел, стройка, финансы, документы и каталог.':('Проекты '+(rights[0]==='1'?'открыты':'закрыты')+', стройка '+(rights[1]==='1'?'открыта':'закрыта')+'. '+(mode==='docs'?'КП и договор доступны.':rights==='00'?'После входа показано, как получить доступ.': ['empty','new'].includes(mode)?'Доступные списки пусты.':'В открытых списках видны свои назначения, чужие отсутствуют.')+' Финансы и управление каталогом скрыты.');
        rows.push(['UI-0281 / UI-0282',build,new Date().toISOString(),title,steps,result+' Состав команды и назначения сохранены.',ms,visual,'Локальный Chromium '+browser.version()+'; mock.js; две сессии','Пройдено']);
        console.log(mode,ms);
      }finally{await p.context().close();}
    }
  }finally{await browser.close();}
  if(process.env.SECTIONS_CSV)fs.writeFileSync(process.env.SECTIONS_CSV,'\ufeff'+rows.map(r=>r.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
