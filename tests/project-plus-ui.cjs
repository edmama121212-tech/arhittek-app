'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const cases=[
 ['standard','Открыть объект с готовыми условиями строительства'],
 ['custom','Создать объект категории без слова «строительство»'],
 ['legacy','Создать объект старой категории без отдела'],
 ['other','Выбрать другое строительное направление внутри формы'],
 ['switch','Перейти из черновика стройки к созданию проекта'],
 ['empty','Начать создание при отсутствии строительного направления'],
 ['lookup','Создать объект после поиска без результатов'],
 ['reject','Исправить пустое название перед сохранением'],
 ['repeat','Открыть форму повторно после отмены черновика'],
 ['double','Повторно нажать плюс и сохранить один объект'],
];
(async()=>{
 const bundle=fs.readFileSync(path.join(root,'index.html'));
 const hash=crypto.createHash('sha256').update(bundle).digest('hex').slice(0,16);
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const csv=[['Элемент','Сборка index','Бизнес-сценарий','Шаги','Результат и связи','От кнопки до готовой формы, мс','До результата действия, мс','Визуальная проверка','Удобство','Стенд','Итог']];
 try {
  for(const [i,[mode,task]] of cases.entries()){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',locale:'ru-RU'});
   try{
    await context.addInitScript({path:path.join(__dirname,'mock.js')});
    await context.route('**/*',route=>{
     const u=new URL(route.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
     if(u.hostname==='app.test'&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({path:f});
     return route.fulfill({contentType:'text/javascript',body:''});
    });
    const page=await context.newPage();page.setDefaultTimeout(5000);
    await page.goto('https://app.test/');
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    await page.evaluate(async mode=>{
     const fixture=__db.categories.find(c=>c.id==='build');
     if(mode==='custom')fixture.name='Комплектация объекта';
     if(mode==='legacy'){fixture.name='Монтаж';fixture.department_id=null;}
     if(mode==='empty')__db.categories=__db.categories.filter(c=>c.id!=='build');
     if(mode==='other')__db.categories.push({id:'custom',name:'Отделка',department_id:'b',sort_order:9});
     await loadAll();
    },mode);
    const nav=tab=>page.locator('.nav-btn[data-view="view-'+tab+'"]').click();
    await nav('construction');
    const plus=page.locator('#addProjectFab'),sheet=page.locator('#projectSheetOverlay');
    const name=page.locator('#pf-name'),category=page.locator('#pf-category');
    let steps='Стройка';
    if(mode==='lookup'){await page.locator('#constrSearch').fill('Нет совпадений');steps+=' → поиск без результата';}
    const box=await plus.boundingBox();
    assert.ok(box&&box.x>=0&&box.x+box.width<=391&&box.width>=40&&box.height>=40,'Кнопка доступна для касания');
    assert.equal(await plus.evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
    const start=performance.now();
    await plus.tap();steps+=' → плюс';
    await sheet.waitFor();
    const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await frames();
    const opening=Math.round(performance.now()-start);
    const empty=mode==='empty';
    assert.equal(await category.inputValue(),empty?'':'build',task);
    assert.equal(await name.isEnabled(),!empty,task);
    if(!empty){
      assert.equal(await page.locator('#pf-feepercent').inputValue(),'15',task+' · ставка');
      if(mode!=='legacy')assert.equal(await page.locator('#pf-department').inputValue(),'b',task+' · отдел');
    }
    let result,ux='Направление и условия объекта уже заполнены.';
    const title='Учебный объект '+i;
    const actionStart=performance.now();
    if(empty){
      await category.selectOption('arch');assert.ok(await name.isEnabled());
      await name.fill('Учебное название');await page.locator('#pf-cancel').click();
      assert.equal(await page.evaluate(()=>__db.projects.length),0);
      steps+=' → выбрать Архитектура → ввести название → Отмена';
      result='Можно вручную выбрать направление. После отмены проектов 0.';
      ux='При пустом направлении поле названия включается после выбора.';
    }else if(mode==='switch'||mode==='repeat'){
      await name.fill(title);await page.locator('#pf-cancel').click();
      if(mode==='switch')await nav('projects');
      await plus.tap();
      assert.equal(await name.inputValue(),'');assert.equal(await category.inputValue(),mode==='switch'?'':'build');
      assert.equal(await name.isDisabled(),mode==='switch');
      await page.locator('#pf-cancel').click();assert.equal(await page.evaluate(()=>__db.projects.length),0);
      steps+=' → ввести название → отменить → '+(mode==='switch'?'Проекты':'Стройка')+' → плюс';
      result='Черновик удалён. Новая форма открылась с правильным направлением и пустым названием. Записей 0.';
    }else{
      if(mode==='other'){await category.selectOption('custom');steps+=' → выбрать Отделка';}
      if(mode==='reject'){await page.locator('#pf-save').click();assert.ok(await sheet.isVisible());assert.match(await page.locator('#toast').innerText(),/назван/i);assert.equal(await page.evaluate(()=>__db.projects.length),0);steps+=' → сохранить без названия → исправить';}
      if(mode==='double'){
        // A rapid repeat touch lands on the already-open overlay, not the background action.
        await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        assert.ok(await sheet.isVisible());steps+=' → повторно коснуться того же места';
      }
      await name.fill(title);await page.locator('#pf-save').click();
      await sheet.waitFor({state:'hidden'});await frames();
      const projects=await page.evaluate(()=>__db.projects);
      assert.equal(projects.length,1);
      assert.equal(projects[0].name,title);
      assert.equal(projects[0].category_id,mode==='other'?'custom':'build');
      if(mode==='lookup')await page.locator('#constrSearchClear').click();
      assert.ok(await page.locator('#view-construction').getByText(title,{exact:true}).first().isVisible());
      steps+=' → ввести «'+title+'» → Сохранить'+(mode==='lookup'?' → очистить поиск':'');
      result='В списке стройки один новый объект с выбранным направлением.';
    }
    assert.equal(await page.evaluate(()=>__db.ledger_entries?.length||0),0);
    csv.push(['UI-0006',hash,task,steps,result+' Денежных проводок 0.',opening,Math.round(performance.now()-actionStart),'Касание в центре кнопки попадает в неё. Размер '+Math.round(box.width)+'×'+Math.round(box.height)+' px.',ux,browser.version()+' / 390×844 / '+new Date().toISOString(),'Пройдено']);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 if(process.env.PROJECT_PLUS_CSV)fs.writeFileSync(process.env.PROJECT_PLUS_CSV,'\ufeff'+csv.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('10 project and construction plus journeys passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
