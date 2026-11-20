'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
const old={id:'tariff-a',group_name:'Архитектура',name:'План дома',unit:'м²',rate:120,description:'План и разрез',sort_order:0,updated_at:'2026-01-01T00:00:00Z'};
const other={...old,id:'tariff-b',group_name:'Дополнения',name:'Выезд инженера',rate:70,unit:'шт',description:'Один выезд',sort_order:1};
const snap={id:old.id,name:old.name,unit:old.unit,rate:old.rate,desc:old.description};
const spec={
  create:['Добавить комплексный тариф на обмер с копейками','Обмер','Обмер помещений','м²',94.45,'Съёмка и план'],
  piece:['Добавить штучную услугу с описанием материалов','Стройка','Спецификация','шт',530,'Таблица материалов'],
  gratis:['Оформить бесплатную консультацию явным нулём','Встречи','Вводная встреча','шт',0,'30 минут'],
  preset:['Создать свой прайс из предложенного встроенного тарифа','Дизайн','Эскиз интерьера','м²',300,'Эскиз и подбор'],
  revise:['Согласовать новую редакцию пакета без пересчёта выданного КП','Интерьер','Новый альбом','шт',612.49,'Изменённая комплектация'],
  move:['Перенести услугу в другое направление и дать новое название','Жилые проекты','План здания','м²',125,'План с мебелью'],
  unit:['Заменить расчёт пакета с квадратного метра на штуки','Альбомы','Альбом планов','шт',1200,'Два плана в комплекте'],
  terms:['Отредактировать состав и ставку услуги с переносами строк','Чертежи','Чертёж фасада','м²',145.55,'Чертёж фасада\nВедомость материалов'],
  historic:['Редактировать старую строку без даты изменения','Эскизы','Эскиз дома','м²',801,'Концепция фасадов'],
  double:['Дважды подтвердить добавление одной платной услуги','Консалтинг','Проверка сметы','шт',44,'Один отчёт'],
  retry:['Довести создание услуги до результата после отказа сервера','Проектирование','Проект гаража','м²',150.5,'План кровли'],
  lost:['Повторить сохранение тарифа при потере ответа после записи','Обследование','Обмер лестницы','шт',175.75,'Контрольный замер'],
  stale:['Защитить изменение коллеги при сохранении открытого черновика','Комплекты','Пакет клиента','шт',490,'Предложения клиента'],
  removed:['Сохранить черновик после перемещения тарифа в корзину коллегой','Конструкции','Опора','шт',840,'Узел крепления'],
  missing:['Сохранить черновик исчезнувшей строки','Инженерия','Сети','м²',315,'Разводка'],
  negative:['Отклонить отрицательную ставку и сохранить черновик','Проверка','Расчёт','шт',-80,'Отчёт по проекту'],
  noName:['Отклонить услугу без названия','Перечни','','шт',55,'Перечень'],
  noGroup:['Отклонить услугу без направления','','Выезд','шт',60,'Осмотр'],
};
const archive={
  decline:'Отказаться от отправки тарифа в корзину',normal:'Убрать только одну услугу из смешанного прайса',
  historic:'Архивировать старый тариф без даты изменения',snapshot:'Снять с продажи тариф ранее выданного КП',
  dirty:'Убрать сохранённую услугу, отбросив черновую ставку',restore:'Восстановить ошибочно удалённый тариф из корзины',
  stale:'Сверить новую ставку коллеги перед удалением открытой редакции',removed:'Удаление тарифа, который уже в корзине у коллеги',
  missing:'Обработать исчезновение тарифа перед подтверждением',retry:'Повторить удаление после отказа сервера',
};
const cancel={
  clean:'Закрыть пустую форму создания',draft:'Отказаться от новой заполненной услуги',stay:'Оставить черновик для продолжения правки',
  rate:'Отбросить изменение ставки выданного КП',name:'Отказаться от переименования услуги',
  group:'Отменить перенос между направлениями',unit:'Отказаться от смены единицы расчёта',
  desc:'Отменить изменение состава работ',invalid:'Отменить черновик после отказа в отрицательной ставке',
  error:'Отменить черновик после серверной ошибки',preset:'Отменить настройку встроенного тарифа',
};
const controls=['group','name','unit','rate','desc'];
const dbKeys=['group_name','name','unit','rate','description'];
const ids=Object.fromEntries([...controls,'save','delete','cancel'].map((s,i)=>[s,'UI-'+String(156+i).padStart(4,'0')]));
const modes=[...Object.keys(spec).map(k=>['save',k]),...Object.keys(archive).map(k=>['delete',k]),...Object.keys(cancel).map(k=>['cancel',k])];
const modeFilter=process.env.TARIFF_MODE;
const selected=modes.filter(([type,mode])=>!modeFilter||modeFilter.split(',').includes(type+'/'+mode));
const truth=p=>p.evaluate(()=>structuredClone(__db.kp_catalog));
const shot=async(p)=>{if(process.env.TARIFF_SHOT)await p.screenshot({path:process.env.TARIFF_SHOT});};

async function run(p,type,mode){
  const field=k=>p.locator('#tf-'+k);
  const sheet=p.locator('#tariffSheetOverlay');
  const quoteTariff=type==='delete'&&mode==='normal'?other:old;
  const quoteRate=type==='save'&&mode==='revise'?80:quoteTariff.rate;
  const toast=msg=>p.locator('#toast.show').filter({hasText:msg}).waitFor({timeout:1500});
  const more=p.locator('.nav-btn[data-view="view-more"]');
  const dbRows=await truth(p);
  const beforeQuote=await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.ledger_entries,__db.projects]));
  const fresh=type==='save'?['create','piece','gratis','preset','double','retry','lost','negative','noName','noGroup'].includes(mode):type==='cancel'&&['clean','draft','stay','preset'].includes(mode);
  await p.locator('#settingsBtn').click();
  const list=p.locator('#tariffsCard');
  if(mode==='preset')await list.getByRole('button').first().click();
  else if(fresh)await p.locator('#addTariffBtn').click();
  else await list.locator('.list-item').filter({hasText:old.name}).getByRole('button').click();
  const measurements=[];
  const steps=[];
  const measure=async(k,action,expected)=>{
    const el=field(k);await el.scrollIntoViewIfNeeded();
    const rect=await el.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=391&&rect.height>=35,k);
    const start=performance.now();await action(el);await expected();measurements.push({k,ms:Math.round(performance.now()-start),height:Math.round(rect.height)});
  };
  const edit=async(k,v)=>{
    await measure(k,el=>k==='unit'?el.selectOption(v):el.fill(String(v)),async()=>assert.equal(await field(k).inputValue(),String(v)));
    steps.push(k+'='+String(v).replaceAll('\n',' / '));
  };
  const lookup=(key,rec)=>rec[dbKeys[controls.indexOf(key)]];
  const mutateOther=()=>p.evaluate(m=>{
    const x=__db.kp_catalog.find(t=>t.id==='tariff-a');
    if(m==='missing')__db.kp_catalog=__db.kp_catalog.filter(t=>t.id!==x.id);
    if(m==='stale')Object.assign(x,{rate:999,updated_at:'2026-09-01T10:00:00Z'});
    if(m==='removed')x.deleted_at='2026-09-01T10:00:00Z';
  },mode);
  const rejected=['stale','missing','removed'].includes(mode);
  const actualQuote=async()=>{
    await more.click();await p.locator('#openKpBtn').click();
    await p.locator('#kpSavedList').getByText('Клиент Лист',{exact:true}).click();
    const s=p.locator('.kp-service').first();
    assert.ok((await s.locator('option:checked').innerText()).includes(quoteTariff.name));
    assert.equal(await s.locator('input[type=number]').nth(1).inputValue(),String(quoteRate));
    assert.ok((await s.innerText()).includes(quoteTariff.description));
    assert.equal(Number((await p.locator('#kp-total').innerText()).replace(/[^0-9]/g,'')),2*quoteRate);
    return s;
  };
  let result='',task='';
  if(type==='save'){
    const [title,...values]=spec[mode];task=title;
    const desired=Object.fromEntries(dbKeys.map((k,i)=>[k,values[i]]));
    for(const [i,k] of controls.entries())await edit(k,values[i]);
    if(rejected){await mutateOther();steps.push('изменение второй сессии: '+mode);}
    if(mode==='double'||mode==='lost'){
      await p.evaluate(mode=>{
        const from=sb.from.bind(sb);
        let lost=mode==='lost';
        sb.from=table=>{
          const query=from(table);
          if(table==='kp_catalog'){
            const insert=query.insert.bind(query);
            query.insert=row=>{
              insert(row);
              const finish=query.then.bind(query);
              query.then=(resolve,reject)=>{
                if(__db.kp_catalog.some(t=>t.id===row.id)){
                  return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);
                }
                return finish(async response=>{
                  await new Promise(r=>setTimeout(r,150));
                  if(lost){lost=false;resolve({error:{message:'Соединение оборвалось после записи'}});}
                  else resolve(response);
                },reject);
              };
              return query;
            };
          }
          return query;
        };
      },mode);
    }
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'kp_catalog',op:'insert'};});
    const blocked=['negative','noName','noGroup'].includes(mode);
    await measure('save',async el=>{
      if(mode==='double'){
        const box=await el.boundingBox();await p.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);
      }
      else await el.click();
      if(mode==='retry'||mode==='lost'){
        await toast(/ошибк|не удалось/i);assert.equal((await truth(p)).length,dbRows.length+(mode==='lost'?1:0));
        await p.evaluate(()=>{__fail=null;});await el.click();steps.push('повтор после отказа записи');
      }
    },async()=>{
      if(blocked)await toast(mode==='negative'?/отрицат/i:/направление|название/i);
      else if(rejected)await toast(/измен|недоступ|устар|корзин/iu);
      else await sheet.waitFor({state:'hidden',timeout:3500});
    });
    steps.push('Сохранить');
    const after=await truth(p);
    if(blocked||rejected){
      assert.ok(await sheet.isVisible());
      for(const k of controls)assert.equal(await field(k).inputValue(),String(lookup(k,desired)));
      if(blocked)assert.deepEqual(after,dbRows);
      if(mode==='missing')assert.deepEqual(after,[other]);
      if(mode==='removed')assert.deepEqual(after[0],{...old,deleted_at:'2026-09-01T10:00:00Z'});
      if(mode==='stale')assert.deepEqual(after[0],{...old,rate:999,updated_at:'2026-09-01T10:00:00Z'});
      result='Черновик и все введённые поля сохранены на экране; ошибочная запись и перезапись чужой редакции исключены.';
      if(mode==='stale')await shot(p);
    }else{
      assert.equal(after.length,dbRows.length+(fresh?1:0),'число тарифов');
      const saved=after.find(x=>x.name===desired.name);
      for(const k of dbKeys)assert.equal(saved[k],desired[k]);
      await p.waitForFunction(()=>!loadAllInFlight);
      const li=list.locator('.list-item').filter({hasText:desired.name});
      assert.ok((await li.innerText()).replace(/\s/g,'').includes(String(desired.rate).replace('.',',')),'прайс показывает другую ставку');
      const service=await actualQuote();
      await p.locator('#kpNewBtn').click();
      const opts=service.locator('select').first();const op=opts.locator('option').filter({hasText:desired.name}).first();
      assert.equal(await op.locator('..').getAttribute('label'),desired.group_name);
      assert.ok((await op.innerText()).replace(/\s/g,'').includes(String(desired.rate).replace('.',',')),'КП показывает другую ставку в списке');
      await opts.selectOption(await op.getAttribute('value'));
      assert.equal(await service.locator('input[type=number]').nth(1).inputValue(),String(desired.rate));
      assert.ok((await service.innerText()).replace(/\s+/g,' ').includes(desired.description.replace(/\s+/g,' ')), 'Состав не виден: '+await service.innerText());
      assert.ok((await service.innerText()).toLowerCase().includes(desired.unit==='шт'?'количество, шт':'площадь, м²'),'Единица в форме: '+await service.innerText());
      result='В новом КП группа «'+desired.group_name+'», услуга «'+desired.name+'», ставка '+desired.rate+' ₽/'+desired.unit+', состав «'+desired.description+'». Выданное КП — прежние '+(2*quoteRate)+' ₽ и состав.';
      steps.push('открыть сохранённое КП → новое КП → выбрать сохранённую услугу');
    }
  }else if(type==='delete'){
    task=archive[mode];
    if(mode==='decline')await p.evaluate(()=>{window.confirm=()=>false;});
    if(mode==='dirty')await edit('rate',666);
    if(rejected)await mutateOther();
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'kp_catalog',op:'update'};});
    await measure('delete',async el=>{
      await el.click();
      if(mode==='retry'){
        await toast(/ошибк|не удалось/i);assert.deepEqual(await truth(p),dbRows);
        await p.evaluate(()=>{__fail=null;});await el.click();
      }
    },async()=>{
      if(mode==='decline')assert.ok(await sheet.isVisible());
      else if(rejected)await toast(/измен|недоступ|устар|корзин/i);
      else await sheet.waitFor({state:'hidden',timeout:3000});
    });
    steps.push(task+' → Удалить → '+(mode==='decline'?'отклонить':'подтвердить'));
    const after=await truth(p);
    if(rejected||mode==='decline'){
      assert.ok(await sheet.isVisible());
      if(mode==='decline')assert.deepEqual(after,dbRows);
      if(mode==='stale')assert.deepEqual(after[0],{...old,rate:999,updated_at:'2026-09-01T10:00:00Z'});
      if(mode==='removed')assert.deepEqual(after[0],{...old,deleted_at:'2026-09-01T10:00:00Z'});
      if(mode==='missing')assert.deepEqual(after,[other]);
      result='Окно осталось открытым. Состояние сохранённого или уже снятого с продажи тарифа подтверждено в хранилище.';
    }else{
      assert.ok(after[0].deleted_at);assert.equal(after[0].rate,120);assert.deepEqual(after[1],other);
      await p.waitForFunction(()=>!loadAllInFlight);
      assert.equal(await list.locator('.li-name').filter({hasText:old.name}).count(),0);
      if(mode==='restore'){
        await more.click();await p.locator('#trashCard').locator('.trash-item').filter({hasText:old.name}).getByRole('button').click();
        await p.waitForFunction(()=>!__db.kp_catalog[0].deleted_at&&!loadAllInFlight);
        await p.locator('#settingsBtn').click();await list.getByText(old.name,{exact:true}).waitFor();
      }
      await actualQuote();await p.locator('#kpNewBtn').click();
      const newOption=p.locator('.kp-service select option').filter({hasText:old.name});
      assert.equal(await newOption.count(),mode==='restore'?1:0);
      result='В ранее выданном КП услуга «'+quoteTariff.name+'» и прежние '+(2*quoteRate)+' ₽. '+(mode==='restore'?'Восстановленная услуга вновь доступна в новом КП.':'В новом КП снятая услуга отсутствует, второй тариф сохранён.');
      steps.push('сверить прайс → прежнее и новое КП');
    }
  }else{
    task=cancel[mode];
    const changes={draft:['name','Новая услуга'],stay:['name','Услуга в работе'],rate:['rate','999'],name:['name','Переименование'],group:['group','Другое направление'],unit:['unit','шт'],desc:['desc','Изменённое описание'],invalid:['rate','-8'],error:['desc','Черновое описание'],preset:['desc','Изменить стандартный состав']};
    if(changes[mode])await edit(...changes[mode]);
    if(mode==='invalid'||mode==='error'){
      if(mode==='error')await p.evaluate(()=>{__fail={table:'kp_catalog',op:'update'};});
      await field('save').click();await toast(mode==='error'?/ошибк|не удалось/i:/отрицат/i);
    }
    await p.evaluate(keep=>{window.__tariffPrompts=[];window.confirm=t=>{__tariffPrompts.push(t);return !keep;};},mode==='stay');
    await measure('cancel',el=>el.click(),async()=>{
      if(mode==='stay'){assert.ok(await sheet.isVisible());assert.equal(await field('name').inputValue(),changes.stay[1]);}
      else await sheet.waitFor({state:'hidden'});
    });
    assert.deepEqual(await truth(p),dbRows);
    const prompts=await p.evaluate(()=>__tariffPrompts);assert.equal(prompts.length,mode==='clean'?0:1);
    if(mode!=='stay'){
      if(mode==='preset')await list.getByRole('button').first().click();
      else if(fresh)await p.locator('#addTariffBtn').click();
      else await list.locator('.list-item').filter({hasText:old.name}).getByRole('button').click();
      if(fresh&&mode!=='preset')assert.equal(await field('name').inputValue(),'');
      if(!fresh)for(const k of controls)assert.equal(await field(k).inputValue(),String(lookup(k,old)));
      if(mode==='preset')assert.notEqual(await field('desc').inputValue(),changes.preset[1]);
    }
    steps.push('Отмена → '+(mode==='stay'?'остаться':'открыть исходный тариф снова'));
    result=mode==='stay'?'Черновое название осталось в открытом окне; прайс сохранён.':'После повторного открытия показаны исходные значения; прайс и сохранённое предложение остались прежними.';
  }
  assert.equal(await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.ledger_entries,__db.projects])),beforeQuote);
  return {task,result,steps,measurements};
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
  const rows=[['Сценарий','Сборка SHA256 index','Дата UTC','Chromium','Основное действие','Бизнес-задача','Шаги','Результат и последствия','Элементы и время действия, мс','Визуальная проверка','Удобство','Статус']];
  const errors=[];
  try{
    for(const [type,mode] of selected){
      const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
      try{
        await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
        await ctx.route('**/*',r=>{
          const u=new URL(r.request().url());if(u.href==='https://app.test/')return r.fulfill({body:html,contentType:'text/html'});
          const f=u.hostname==='app.test'&&path.join(root,u.pathname.slice(1));return f&&fs.existsSync(f)?r.fulfill({path:f}):r.fulfill({body:'',contentType:'text/javascript'});
        });
        const p=await ctx.newPage();p.setDefaultTimeout(3500);await p.goto('https://app.test/');
        await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
        const seed=mode==='preset'?[]:[{...old},other];
        if(mode==='historic')delete seed[0].updated_at;
        const previous=(type==='delete'&&mode==='normal')?{id:other.id,name:other.name,unit:other.unit,rate:other.rate,desc:other.description}:snap;
        const customRate=type==='save'&&mode==='revise'?80:null;
        await p.evaluate(async({seed,previous,customRate})=>{
          __db.kp_catalog=seed;
          __db.kp_forms=[{id:'agreed',client_name:'Клиент Лист',services:[{qty:2,snapshot:previous,customRate}]}];await loadAll();
        },{seed,previous,customRate});
        const {task,result,steps,measurements}=await run(p,type,mode);
        rows.push([type+'/'+mode,build,new Date().toISOString(),browser.version(),ids[type],task,'Настройки → тарифы → '+steps.join(' → '),result+' Записей в КП, проекты и денежный журнал: 0.',
          measurements.map(m=>ids[m.k]+' '+m.ms).join(', '),measurements.map(m=>ids[m.k]+' '+m.height+' px').join(', ')+'; полностью в окне 390 px.',
          type==='cancel'?'Отказ подтверждается только для изменённого черновика.':type==='delete'?'Удаление требует подтверждения.':'Поля читаются в форме, исход сохранения проверен.', 'Пройдено']);
      }catch(e){const failure=type+'/'+mode+' '+e.message.split('\n').slice(0,2).join(' ');errors.push(failure);console.error(failure);}
      finally{await ctx.close();}
    }
  }finally{await browser.close();}
  assert.deepEqual(errors,[]);
  if(process.env.TARIFF_CSV)fs.writeFileSync(process.env.TARIFF_CSV,'\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log((rows.length-1)+' tariff editor scenarios passed '+build);
})().catch(e=>{console.error(e);process.exitCode=1;});
