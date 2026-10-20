/* Recover one invoice draft by its server ID after a lost response. */
(() => {
  'use strict';
  const pending = new Map();
  const saving = new Set();
  const fields = ['project_id','number','invoice_date','category','item_type','description','amount','photo_url','paid_by_client'];
  const keyFor = projectId => 'arhittek_invoice_pending_v1:'+session.employeeId+':'+projectId;
  function remember(key, draft) {
    pending.set(key, draft);
    try { sessionStorage.setItem(key,JSON.stringify(draft)); } catch (_) {}
  }
  function readPending(key) {
    let draft=pending.get(key);
    if (!draft) { try { draft=JSON.parse(sessionStorage.getItem(key)||'null'); } catch (_) {} }
    return draft?.version===1 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(draft.id) && draft.payload?.project_id ? draft : null;
  }
  function forget(key) { pending.delete(key);try { sessionStorage.removeItem(key); } catch (_) {} }
  function matches(row,payload) {
    return !!row && fields.every(field=>field==='amount'?Number(row[field])===Number(payload[field]):field==='paid_by_client'?!!row[field]===!!payload[field]:String(row[field]||'')===String(payload[field]||''));
  }
  async function existing(draft) {
    const result=await sb.from('invoices').select('id,'+fields.join(',')).eq('id',draft.id).eq('project_id',draft.payload.project_id).maybeSingle();
    if(result.error)throw new Error('Не удалось проверить сохранение накладной. Повторите после восстановления связи.');
    return result.data;
  }
  async function addInvoice(projectId) {
    if(saving.has(projectId))return;
    if(!canAccessConstructionProject(projectId)){showToast('Нет доступа к этому объекту');return;}
    const actor={employeeId:session.employeeId,token:session.token,isAdmin:!!session.isAdmin};
    const suffix=document.getElementById('inv-num-obj')?'obj':projectId;
    const value=name=>document.getElementById('inv-'+name+'-'+suffix)?.value||'';
    const category=value('cat');
    const rawAmount=Number(value('amount'));
    let payload={project_id:projectId,number:value('num').trim(),invoice_date:value('date')||null,
      category:category==='__other__'?(document.getElementById('inv-cat-'+suffix+'-custom')?.value||'').trim():category.trim(),
      item_type:value('type'),description:value('desc').trim(),amount:Math.round(rawAmount*100)/100,
      photo_url:'',paid_by_client:!!document.getElementById('inv-paid-client-'+suffix)?.checked};
    const file=document.getElementById('inv-photo-'+suffix)?.files?.[0];
    const key=keyFor(projectId);
    let draft=readPending(key);
    if(draft&&!payload.number&&!payload.description&&!value('amount'))payload={...draft.payload};
    if(!payload.description&&!payload.number){showToast('Введите описание или номер накладной');return;}
    if(!Number.isFinite(rawAmount)||payload.amount<=0){showToast('Укажите положительную сумму');return;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.invoice_date||'')||!Number.isFinite(Date.parse(payload.invoice_date+'T00:00:00Z'))||new Date(payload.invoice_date+'T00:00:00Z').toISOString().slice(0,10)!==payload.invoice_date){showToast('Укажите дату накладной');return;}
    let persisted=false;
    let restoredOriginal=false;
    saving.add(projectId);
    showToast('Сохранение…');
    try {
      let row=draft?await existing(draft):null;
      if(row){
        if(!matches(row,draft.payload))throw new Error('Запись с этим номером изменилась. Проверьте накладную в истории.');
        restoredOriginal=!matches(row,{...payload,photo_url:row.photo_url});
      }else{
        const sameFile=draft?.fileName===(file?.name||'')&&draft?.fileSize===(file?.size||0)&&draft?.fileModified===(file?.lastModified||0);
        draft={version:1,id:draft?.id||crypto.randomUUID(),payload:{...payload,photo_url:sameFile?draft?.payload.photo_url||'':''},
          fileName:file?.name||'',fileSize:file?.size||0,fileModified:file?.lastModified||0};
        remember(key,draft);
        if(file&&!draft.payload.photo_url){
          draft.payload.photo_url=await compressAndUpload(file,'construction-documents',projectId+'/'+draft.id+'.jpg',()=>canAccessConstructionProject(projectId,actor));
          remember(key,draft);
        }
        if(!canAccessConstructionProject(projectId,actor))throw new Error('Сеанс или доступ к объекту изменился');
        let result;
        try { result=await sb.from('invoices').insert({id:draft.id,...draft.payload}).select('id,'+fields.join(',')).single(); } catch (error) { result={error}; }
        row=!result.error&&result.data?.id===draft.id?result.data:await existing(draft);
        if(!row)throw new Error('Сохранение пока не подтверждено. Повтор сохранит тот же номер накладной.');
        if(!matches(row,draft.payload))throw new Error('Сервер сохранил первоначальную версию. Проверьте её в истории перед изменением.');
      }
      persisted=true;
      forget(key);
      if(!canAccessConstructionProject(projectId,actor))throw new Error('Накладная сохранена. Сеанс или доступ изменился');
      if(!(state.invoices||[]).some(invoice=>invoice.id===row.id))state.invoices.push(row);
      const project=state.projects.find(item=>item.id===projectId);
      await logAudit('project',projectId,project?.name||'','update',{invoice_added:{old:null,new:row.number+' — '+row.description+' — '+fmtMoney(row.amount)}});
      await loadAll();
      if(currentObjectId===projectId){
        const current=state.projects.find(item=>item.id===projectId);
        if(current)renderObjectSummary(current);
        renderObjTabContent();
        if(restoredOriginal){
          openInvoiceSheet(row.id);
          const edited={number:payload.number,date:payload.invoice_date,type:payload.item_type,amount:payload.amount,category:payload.category,desc:payload.description};
          Object.entries(edited).forEach(([field,value])=>{const input=document.getElementById('invSheet-'+field);if(input)input.value=value||'';});
          const paid=document.getElementById('invSheet-paid-client');if(paid)paid.checked=payload.paid_by_client;
        }
      }
      showToast(restoredOriginal?'Ранее сохранена первоначальная накладная на '+fmtMoney(row.amount)+'. Ваши изменения открыты для редактирования и ещё не сохранены.':'Накладная сохранена');
    }catch(error){
      console.error(error);
      showToast(persisted?'Накладная сохранена. Не удалось обновить объект — обновите страницу':error.message||'Ошибка сохранения');
    }finally{saving.delete(projectId);}
  }

  function restoreInvoiceDraft(){
    if(!session?.employeeId||!currentObjectId)return;
    const draft=readPending(keyFor(currentObjectId));if(!draft)return;
    const suffix=document.getElementById('inv-num-obj')?'obj':currentObjectId;
    const map={num:'number',date:'invoice_date',cat:'category',type:'item_type',desc:'description',amount:'amount'};
    for(const [field,key]of Object.entries(map)){
      const input=document.getElementById('inv-'+field+'-'+suffix);
      if(input&&!input.dataset.invoiceDraftRestored){input.value=draft.payload[key]??'';input.dataset.invoiceDraftRestored='1';}
    }
    const paid=document.getElementById('inv-paid-client-'+suffix);if(paid)paid.checked=!!draft.payload.paid_by_client;
    const anchor=document.getElementById('inv-num-'+suffix);
    if(anchor&&!document.getElementById('invoice-pending-notice')){
      const note=document.createElement('p');note.id='invoice-pending-notice';note.className='note';note.setAttribute('role','status');note.textContent='Предыдущая попытка сохранения не подтверждена. Нажмите «Добавить», чтобы проверить её; повторная накладная не создастся.';anchor.before(note);
    }
  }
  const renderTabs=window.renderObjTabContent;
  window.renderObjTabContent=function(){const result=renderTabs.apply(this,arguments);restoreInvoiceDraft();return result;};

  // The owner publishes the existing card; links never create a second object.
  let portalGeneration=0;
  async function portalRpc(name,args){
    const result=await sb.rpc(name,args);
    if(result.error)throw new Error(result.error.message||'Не удалось изменить доступ заказчика');
    const data=Array.isArray(result.data)?result.data[0]:result.data;
    if(data===null||data===undefined)throw new Error('Не удалось проверить ответ. Обновите доступ перед повтором.');
    return data;
  }
  function mountPortal(project){
    if(!session?.isAdmin||!project?.id||!canAccessConstructionProject(project.id))return;
    const generation=++portalGeneration,token=session.token;
    const panel=document.createElement('section');panel.id='obj-client-access';panel.className='card';
    panel.innerHTML='<h3>Доступ заказчика</h3><p class="note" role="status">Загрузка настроек доступа…</p>';
    document.getElementById('objSummary')?.append(panel);
    const active=()=>generation===portalGeneration&&session?.token===token&&session?.isAdmin&&currentObjectId===project.id&&panel.isConnected;
    let settings=null,busy=false;
    function notice(message){if(!active())return;let node=panel.querySelector('[data-access-status]');if(!node){node=document.createElement('p');node.className='note';node.dataset.accessStatus='';node.setAttribute('role','status');panel.append(node);}node.textContent=message;}
    function draw(){
      if(!active())return;
      const rate=settings.saved_markup_percent??project.fee_percent;
      panel.innerHTML='<h3>Доступ заказчика</h3><p class="note">Заказчик увидит только свой объект: этапы, работы, накладные, расходы, наценку компании и сведения об оплатах. Данные команды и резерв компании скрыты.</p>'+
        (!settings.portal_enabled?'<p class="note">Клиентский доступ ещё не включён. Новые ссылки пока недоступны.</p>':'')+
        '<label style="display:flex;gap:10px;align-items:flex-start;margin:12px 0"><input type="checkbox" data-confirm-markup><span>Расходы по документам и ставка наценки '+escapeHtml(rate===null||rate===undefined?'не указана':rate+'%')+' проверены</span></label>'+
        '<label style="display:flex;gap:10px;align-items:flex-start;margin:12px 0"><input type="checkbox" data-confirm-cash><span>История всех поступлений и выплат объекта сверена. Можно показывать остаток денег.</span></label>'+
        '<p class="note">Без сверки заказчик увидит документы и расчётную наценку; денежный остаток будет обозначен как неподтверждённый. Новые финансовые записи требуют повторной проверки публикации.</p>'+
        '<div class="btn-row"><button type="button" class="btn btn-secondary" data-publish>'+ (settings.published?'Обновить опубликованные данные':'Подготовить доступ')+'</button>'+
        (settings.published?'<button type="button" class="btn btn-secondary" data-issue>Создать ссылку на 30 дней</button><button type="button" class="btn btn-secondary" data-unpublish>Закрыть доступ к объекту</button>':'')+'</div>'+
        '<div data-grants></div><div data-link-result></div><p class="note" data-access-status role="status"></p>';
      panel.querySelector('[data-confirm-cash]').checked=!!settings.cash_history_complete;
      const grants=panel.querySelector('[data-grants]');
      (settings.grants||[]).forEach(grant=>{
        if(grant.revoked_at)return;
        const row=document.createElement('div');row.className='list-item';
        const label=document.createElement('span');label.textContent='Ссылка до '+new Date(grant.expires_at).toLocaleDateString('ru-RU');row.append(label);
        const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent='Отозвать';button.onclick=()=>perform(async()=>{await portalRpc('revoke_construction_client_grant',{p_grant_id:grant.id});await refresh();notice('Ссылка отозвана');});row.append(button);grants.append(row);
      });
      panel.querySelector('[data-publish]').onclick=()=>{
        if(!panel.querySelector('[data-confirm-markup]').checked){notice('Подтвердите проверку расходов и ставки наценки');return;}
        perform(async()=>{
          settings=await portalRpc('configure_construction_client_project',{p_project_id:project.id,p_published:true,p_confirm_history:panel.querySelector('[data-confirm-cash]').checked,p_confirm_markup:true,p_expected_revision:settings.revision});
          draw();notice('Данные объекта подготовлены для заказчика');
        });
      };
      const issue=panel.querySelector('[data-issue]');
      if(issue){issue.disabled=!settings.portal_enabled;issue.onclick=()=>perform(async()=>{
        const grant=await portalRpc('issue_construction_client_grant',{p_project_id:project.id,p_expires_at:new Date(Date.now()+30*86400000).toISOString()});
        if(!active())return;
        await refresh();if(!active())return;
        const url=new URL('client-portal.html',location.href);url.hash='access='+encodeURIComponent(grant.access);
        const result=panel.querySelector('[data-link-result]'),input=document.createElement('textarea');input.readOnly=true;input.value=url.href;input.setAttribute('aria-label','Ссылка для заказчика');input.style.cssText='width:100%;min-height:75px;margin-top:12px';result.append(input);
        const copy=document.createElement('button');copy.type='button';copy.className='btn btn-secondary';copy.textContent='Копировать ссылку';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);notice('Ссылка скопирована');}catch(_){input.select();notice('Выделена ссылка — скопируйте её');}};result.append(copy);notice('Ссылка даёт доступ к этому объекту. Её можно отозвать здесь.');
      });}
      panel.querySelector('[data-unpublish]')?.addEventListener('click',()=>perform(async()=>{
        settings=await portalRpc('configure_construction_client_project',{p_project_id:project.id,p_published:false,p_confirm_history:false,p_confirm_markup:false,p_expected_revision:settings.revision});draw();notice('Доступ к объекту закрыт');
      }));
    }
    async function refresh(){const result=await portalRpc('get_construction_client_settings',{p_project_id:project.id});if(active()){settings=result;draw();}}
    async function perform(operation){if(busy||!active())return;busy=true;panel.querySelectorAll('button').forEach(button=>button.disabled=true);try{await operation();}catch(error){notice(error.message);}finally{busy=false;if(active())panel.querySelectorAll('button').forEach(button=>button.disabled=button.hasAttribute('data-issue')&&!settings?.portal_enabled);}}
    refresh().catch(error=>notice(error.message));
  }
  const renderSummary=window.renderObjectSummary;
  window.renderObjectSummary=function(project){const result=renderSummary.apply(this,arguments);mountPortal(project);return result;};

  // Canonical private paths stay in records; short-lived URLs only reach images.
  const signed=new Map(), signing=new Map();
  function privatePath(value){
    try {
      const url=new URL(value),origin=new URL(SUPABASE_URL).origin;
      if(url.origin!==origin)return null;
      const match=url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated)\/construction-documents\/(.+)$/);
      if(!match)return null;
      const path=decodeURIComponent(match[1]);
      return path&&!path.split('/').some(part=>part==='.'||part==='..')?path:null;
    }catch(_){return null;}
  }
  async function imageUrl(value){
    const path=privatePath(value);if(!path)return value;
    if(!session?.token)throw new Error('Для документа нужен вход');
    const token=session.token,key=token+':'+path,cached=signed.get(key);
    if(cached&&cached.until>Date.now())return cached.url;
    if(signing.has(key))return signing.get(key);
    const request=(async()=>{
      const result=await sb.storage.from('construction-documents').createSignedUrl(path,300);
      if(result.error||!result.data?.signedUrl)throw new Error('Нет доступа к документу');
      if(session?.token!==token)throw new Error('Сеанс изменился');
      signed.set(key,{url:result.data.signedUrl,until:Date.now()+240000});return result.data.signedUrl;
    })().finally(()=>signing.delete(key));
    signing.set(key,request);return request;
  }
  function secureImage(img){
    const src=img.getAttribute('src');if(!privatePath(src))return;
    if(img.dataset.privateSigning===src)return;
    img.dataset.privateSigning=src;
    img.removeAttribute('src');
    imageUrl(src).then(url=>{
      if(img.isConnected&&img.dataset.privateSigning===src){delete img.dataset.privateSigning;img.src=url;}
    }).catch(()=>{if(img.isConnected&&img.dataset.privateSigning===src){delete img.dataset.privateSigning;img.alt='Документ недоступен. Обновите объект после входа.';img.removeAttribute('src');}});
  }
  function scan(node){if(node.nodeType!==1)return;if(node.tagName==='IMG')secureImage(node);node.querySelectorAll?.('img[src]').forEach(secureImage);}
  new MutationObserver(records=>records.forEach(record=>{
    if(record.type==='attributes')secureImage(record.target);else record.addedNodes.forEach(scan);
  })).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  document.querySelectorAll('img[src]').forEach(secureImage);
  window.ARHITTEKConstructionOperations={addInvoice,imageUrl,privatePath,restoreInvoiceDraft};
})();
