// ARHITTEK document workflow v1
(()=>{
'use strict';
const $=id=>document.getElementById(id);
let editingContractId=null;
let contractHistoryRows=[];
let contractSearchQuery='';
let documentReturnContext=null;
let linkedDocumentProjectId=null;

function currentDocumentOrigin(projectId){
  const objectOpen = $('view-object')?.classList.contains('active') && typeof currentObjectId!=='undefined' && currentObjectId===projectId;
  return {kind:objectOpen?'object':'project', projectId, scrollY:window.scrollY||0};
}
function showWorkspaceView(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  $(viewId)?.classList.add('active');
  const nav=document.querySelector('.nav-btn[data-view="'+viewId+'"]');
  if(nav) nav.classList.add('active');
}
function returnFromDocumentView(){
  const ctx=documentReturnContext;
  documentReturnContext=null;
  linkedDocumentProjectId=null;
  if(!ctx){
    showWorkspaceView('view-more');
    document.querySelector('.nav-btn[data-view="view-more"]')?.classList.add('active');
    window.scrollTo(0,0);
    return;
  }
  if(ctx.kind==='object'){
    if(typeof openObjectView==='function') openObjectView(ctx.projectId);
  }else{
    showWorkspaceView('view-projects');
    if(typeof openProjectSheet==='function') openProjectSheet(ctx.projectId);
  }
  setTimeout(()=>window.scrollTo(0,ctx.scrollY||0),0);
}

function escDoc(v){
  return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function contractSnapshotFromForm(){
  return {
    contract_type: typeof contractType!=='undefined' ? contractType : 'ar',
    project_id: $('ct-project')?.value || null,
    ...contractCustomerSnapshot(),
    number: $('ct-number')?.value.trim() || '',
    date: $('ct-date')?.value || financeToday(),
    object: $('ct-object')?.value.trim() || '',
    scope: $('ct-scope')?.value || '',
    price: Number($('ct-price')?.value)||0,
    pricing: contractPricingSnapshot(),
    advance_pct: Number($('ct-advance-pct')?.value)||0,
    start_date: $('ct-start')?.value || '',
    end_date: $('ct-end')?.value || '',
  };
}
function contractLabel(type){
  return (typeof CONTRACT_TYPES!=='undefined' && CONTRACT_TYPES[type]?.label) || ({ar:'Архитектурный проект',di:'Дизайн интерьера',st:'Строительство'})[type] || 'Договор';
}
function contractProjectName(projectId){
  const p=(typeof state!=='undefined' && state.projects||[]).find(x=>x.id===projectId);
  return p?.name || '';
}
function applyContractSnapshot(s){
  if(!s) return;
  contractType=s.contract_type||'ar';
  document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.toggle('selected',b.dataset.value===contractType));
  const map={
    'ct-project':s.project_id||'','ct-client-name':s.client_name||'','ct-passport':s.passport||'',
    'ct-birthdate':s.birthdate||'','ct-passport-issuer':s.passport_issuer||'','ct-passport-date':s.passport_date||'',
    'ct-address':s.address||'','ct-phone':s.phone||'','ct-number':s.number||'','ct-date':s.date||'',
    'ct-object':s.object||'','ct-scope':s.scope||'','ct-price':s.price||'','ct-advance-pct':s.advance_pct??50,
    'ct-start':s.start_date||'','ct-end':s.end_date||''
  };
  Object.entries(map).forEach(([id,v])=>{const el=$(id); if(el) el.value=v;});
  applyContractPricing(s.pricing);
  applyContractCustomer(s);
  syncContractProjectPicker();
}
function contractRowSnapshot(row){ return row?.changes?.snapshot?.new || row?.changes?.snapshot || null; }

async function queryContractHistory(){
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('audit_log').select('*',{count:'exact'}).eq('entity_type','contract').order('created_at',{ascending:false}));
    if(error) throw error;
    contractHistoryRows=data||[];
  }catch(e){
    console.error('contract history load error',e);
    contractHistoryRows=[];
  }
  return contractHistoryRows;
}
function latestContractRowsForProject(projectId){
  return latestUniqueContracts(contractHistoryRows.filter(r=>{
    const s=contractRowSnapshot(r);
    return s && s.project_id===projectId;
  }));
}
function contractIdentity(s){
  return [s?.project_id||'', String(s?.number||'').trim().toLowerCase(), String(s?.object||'').trim().toLowerCase()].join('|');
}
function latestUniqueContracts(rows){
  const seen=new Set(), out=[];
  for(const r of rows){
    const s=contractRowSnapshot(r)||{};
    const key=contractIdentity(s) || r.entity_id;
    if(seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}
async function renderContractHistory(){
  const list=$('ct-history-list'); if(!list) return;
  await queryContractHistory();
  if(!contractHistoryRows.length){
    list.innerHTML='<div class="empty-state">Сохранённых договоров пока нет</div>'; return;
  }
  let rows=latestUniqueContracts(contractHistoryRows);
  if(contractSearchQuery.trim()){
    const q=contractSearchQuery.trim().toLowerCase();
    rows=rows.filter(r=>{
      const s=contractRowSnapshot(r)||{};
      return [s.number,s.client_name,s.object,contractProjectName(s.project_id),contractLabel(s.contract_type)]
        .some(v=>String(v||'').toLowerCase().includes(q));
    });
  }
  if(!rows.length){
    list.innerHTML='<div class="empty-state">По вашему поиску договоры не найдены</div>';
    return;
  }
  list.innerHTML=rows.map(r=>{
    const s=contractRowSnapshot(r)||{}, p=contractProjectName(s.project_id);
    return `<div class="list-item">
      <div style="cursor:pointer;flex:1" data-contract-history-id="${escDoc(r.id)}">
        <div class="li-name">Договор № ${escDoc(s.number||'без номера')} · ${escDoc(contractLabel(s.contract_type))}</div>
        <div class="li-meta">${p?escDoc(p)+' · ':''}${escDoc(s.client_name||'Без заказчика')} · ${escDoc(typeof fmtDateTime==='function'?fmtDateTime(r.created_at):r.created_at||'')}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" type="button" data-contract-history-id="${escDoc(r.id)}" title="Редактировать договор">✏️</button>
        <button class="icon-btn danger" type="button" data-delete-contract-row="${escDoc(r.id)}" title="Удалить договор">🗑</button>
      </div>
    </div>`;
  }).join('');
}
async function loadContractVersion(rowId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){
    const {data}=await sb.from('audit_log').select('*').eq('id',rowId).maybeSingle();
    row=data;
  }
  const s=contractRowSnapshot(row); if(!s) return;
  editingContractId=row.entity_id;
  applyContractSnapshot(s);
  showToast('Договор открыт для редактирования');
  window.scrollTo({top:0,behavior:'smooth'});
}

async function deleteSavedContract(rowId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){
    const {data}=await sb.from('audit_log').select('*').eq('id',rowId).maybeSingle();
    row=data;
  }
  if(!row) return;
  const s=contractRowSnapshot(row)||{};
  const label='Договор № '+(s.number||'без номера');
  if(!confirm('Удалить '+label+'? Восстановить его из приложения будет нельзя.')) return;

  try{
    // Удаляем все записи этого договора, чтобы не осталось старых дублей.
    const entityId=row.entity_id;
    if(entityId){
      const {error}=await sb.from('audit_log').delete().eq('entity_type','contract').eq('entity_id',entityId);
      if(error) throw error;
    }else{
      const {error}=await sb.from('audit_log').delete().eq('id',row.id);
      if(error) throw error;
    }

    editingContractId=null;
    await queryContractHistory();
    await renderContractHistory();

    if(s.project_id){
      await renderProjectContractList(s.project_id);
      if(typeof currentObjectId!=='undefined' && currentObjectId===s.project_id){
        await renderObjectDocuments(s.project_id);
      }
    }

    showToast('Договор удалён');
    newContractDraft();
  }catch(e){
    console.error(e);
    showToast('Не удалось удалить договор');
  }
}
async function saveContractVersion(){
  if(!validateContractPricing()) return;
  const s=contractSnapshotFromForm();
  if(!s.client_name && !s.object && !s.number){showToast('Заполните хотя бы заказчика, объект или номер договора');return;}
  await queryContractHistory();

  // Один номер/объект в одном проекте = один договор.
  const same=contractHistoryRows.find(r=>contractIdentity(contractRowSnapshot(r)||{})===contractIdentity(s));
  if(!editingContractId && same) editingContractId=same.entity_id;
  if(!editingContractId) editingContractId=(crypto?.randomUUID?.() || ('contract-'+Date.now()+'-'+Math.random().toString(16).slice(2)));

  const projectName=contractProjectName(s.project_id);
  const actor=(typeof session!=='undefined'&&session?.name)?session.name:'';
  const payloadChanges={
    snapshot:{old:null,new:s},
    project_id:{old:null,new:s.project_id||null}
  };
  if(actor) payloadChanges._actor=actor;

  try{
    const currentRows=contractHistoryRows.filter(r=>r.entity_id===editingContractId);
    if(currentRows.length){
      const keep=currentRows[0];
      const {error}=await sb.from('audit_log').update({
        entity_name:`Договор № ${s.number||'без номера'}${projectName?' · '+projectName:''}`,
        action:'update',
        changes:payloadChanges,
        created_at:new Date().toISOString()
      }).eq('id',keep.id);
      if(error) throw error;

      // Старые версии этого же договора больше не нужны.
      const extra=currentRows.slice(1).map(r=>r.id);
      for(const id of extra){
        const {error:delErr}=await sb.from('audit_log').delete().eq('id',id);
        if(delErr) console.warn('contract duplicate cleanup',delErr);
      }
    }else{
      const {error}=await sb.from('audit_log').insert({
        entity_type:'contract', entity_id:editingContractId,
        entity_name:`Договор № ${s.number||'без номера'}${projectName?' · '+projectName:''}`,
        action:'create', changes:payloadChanges
      });
      if(error) throw error;
    }

    // Также убираем старые дубли с тем же номером/объектом.
    await queryContractHistory();
    const duplicates=contractHistoryRows.filter(r=>r.entity_id!==editingContractId && contractIdentity(contractRowSnapshot(r)||{})===contractIdentity(s));
    for(const r of duplicates){
      const {error:delErr}=await sb.from('audit_log').delete().eq('id',r.id);
      if(delErr) console.warn('contract identity duplicate cleanup',delErr);
    }

    await saveContractFields?.();
    showToast('Договор сохранён');
    if(contractView) contractView.dataset.dirty='0';
    await renderContractHistory();
    if(s.project_id) await renderProjectContractList(s.project_id);
    if(typeof currentObjectId!=='undefined' && currentObjectId===s.project_id) await renderObjectDocuments(s.project_id);
  }catch(e){ console.error(e); showToast('Не удалось сохранить договор'); }
}
function newContractDraft(){
  editingContractId=null;
  const keepProjectId=linkedDocumentProjectId||null;
  const ids=['ct-client-name','ct-passport','ct-birthdate','ct-passport-issuer','ct-passport-date','ct-address','ct-phone','ct-number','ct-object','ct-price','ct-start','ct-end'];
  ids.forEach(id=>{if($(id))$(id).value='';});
  if($('ct-project')) $('ct-project').value='';
  if($('ct-date')) $('ct-date').value=financeToday();
  if($('ct-advance-pct')) $('ct-advance-pct').value=50;
  resetContractPricing();
  resetContractCustomer();
  syncContractProjectPicker();
  contractType='ar';
  document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.toggle('selected',b.dataset.value==='ar'));
  if(typeof fillContractDefaults==='function') fillContractDefaults();
  if(keepProjectId && $('ct-project')){
    $('ct-project').value=keepProjectId;
    $('ct-project').dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(contractView) contractView.dataset.dirty='0';
  showToast('Новый договор');
}

function wordContractHtml(s){
  const c=(typeof state!=='undefined'&&state.companyInfo)||{};
  const scope=String(s.scope||'').split(/\n+/).filter(Boolean).map(x=>`<li>${escDoc(x.replace(/^[-—]\s*/,''))}</li>`).join('');
  const price=ctNumber(s.price)+' ₽';
  const advance=ctRound((Number(s.price)||0)*(Number(s.advance_pct)||0)/100);
  const dateFmt=v=>(typeof fmtDate==='function'?fmtDate(v):v)||'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Договор</title>
  <style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.45;color:#111;margin:32px}h1{text-align:center;font-size:16pt}h2{font-size:12pt;margin-top:22px}table{width:100%;border-collapse:collapse;margin:10px 0}td{vertical-align:top;padding:5px;border:1px solid #bbb}.muted{color:#555}</style></head><body>
  <h1>ДОГОВОР № ${escDoc(s.number||'____')}</h1>
  <p style="text-align:center">${escDoc(contractLabel(s.contract_type))} · ${escDoc(dateFmt(s.date))}</p>
  <p><b>Исполнитель:</b> ${escDoc(c.full_name||c.short_name||'ARHITTEK')}, в лице ${escDoc(c.director||'руководителя')}.</p>
  <p><b>Заказчик:</b> ${escDoc(contractCustomerIntro(s))}.</p>
  <h2>1. Предмет договора</h2>
  <p>Исполнитель обязуется выполнить работы по объекту: <b>${escDoc(s.object||'________________')}</b>, а Заказчик обязуется принять и оплатить результат работ.</p>
  <ul>${scope||'<li>Состав работ определяется сторонами.</li>'}</ul>
  <h2>2. Стоимость и порядок оплаты</h2>
  ${contractPricingLines(s.pricing).map(line=>`<p>${escDoc(line)}</p>`).join('')}
  <p>Стоимость работ: <b>${escDoc(price)}</b>. Аванс: <b>${escDoc(String(s.advance_pct||0))}% (${escDoc(ctNumber(advance)+' ₽')})</b>.</p>
  <h2>3. Сроки</h2>
  <p>Начало работ: ${escDoc(dateFmt(s.start_date)||'по согласованию')}. Завершение: ${escDoc(dateFmt(s.end_date)||'по согласованию')}.</p>
  <h2>4. Права, обязанности и приёмка</h2>
  <p>Исполнитель выполняет согласованный объём работ и передаёт результат Заказчику. Заказчик своевременно предоставляет исходные данные, согласовывает решения и производит оплату в согласованные сроки.</p>
  <h2>5. Ответственность и изменения</h2>
  <p>Изменения объёма, стоимости и сроков фиксируются сторонами дополнительно. Стороны несут ответственность в соответствии с условиями договора и применимым законодательством.</p>
  <h2>6. Реквизиты и подписи</h2>
  <table><tr><td><b>Исполнитель</b><br>${escDoc(c.full_name||c.short_name||'ARHITTEK')}<br>ИНН: ${escDoc(c.inn||'')}<br>ОГРН: ${escDoc(c.ogrn||'')}<br>${escDoc(c.legal_address||'')}<br>${escDoc(c.phone||'')}</td>
  <td><b>Заказчик</b><br>${contractCustomerLines(s).map(escDoc).join('<br>')}</td></tr></table>
  <p style="margin-top:40px">Исполнитель ____________________ &nbsp;&nbsp;&nbsp; Заказчик ____________________</p>
  <p class="muted">Документ сформирован в ARHITTEK. Файл можно редактировать в Microsoft Word.</p>
  </body></html>`;
}
function exportContractToWord(){
  if(!validateContractPricing()) return;
  const s=contractSnapshotFromForm();
  const blob=new Blob(['\ufeff',wordContractHtml(s)],{type:'application/msword;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  const safe=(s.number||'bez-nomera').replace(/[^a-zA-Zа-яА-Я0-9_-]/g,'_');
  a.download=`Dogovor-${safe}-${s.date||financeToday()}.doc`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  showToast('Word-файл скачивается...');
}

async function detachContractFromProject(rowId,projectId){
  let row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  if(!row){await queryContractHistory();row=contractHistoryRows.find(r=>String(r.id)===String(rowId));}
  if(!row)return;
  const s=contractRowSnapshot(row)||{};
  if(!confirm('Открепить договор № '+(s.number||'без номера')+' от проекта? Сам договор останется сохранённым.'))return;
  try{
    const next={...s,project_id:null};
    const changesObj={...(row.changes||{}),snapshot:{old:s,new:next},project_id:{old:projectId||s.project_id||null,new:null}};
    const actor=(typeof session!=='undefined'&&session?.name)?session.name:'';
    if(actor)changesObj._actor=actor;
    const {error}=await sb.from('audit_log').update({
      entity_name:'Договор № '+(s.number||'без номера'),
      action:'update',
      changes:changesObj,
      created_at:new Date().toISOString()
    }).eq('id',row.id);
    if(error)throw error;
    showToast('Договор откреплён. Он остался в сохранённых договорах.');
    await queryContractHistory();
    if(projectId)await renderProjectContractList(projectId);
    if(typeof currentObjectId!=='undefined'&&currentObjectId===projectId)await renderObjectDocuments(projectId);
  }catch(e){console.error(e);showToast('Не удалось открепить договор');}
}
async function detachKpFromProject(kpId,projectId){
  const kp=(state?.kpForms||[]).find(k=>k.id===kpId);
  if(!kp)return;
  if(!confirm('Открепить это КП от проекта? Само КП останется в сохранённых.'))return;
  try{
    const {error}=await sb.from('kp_forms').update({project_id:null,updated_at:new Date().toISOString()}).eq('id',kpId);
    if(error)throw error;
    showToast('КП откреплено. Оно осталось в сохранённых КП.');
    await loadAll();
    if(projectId){
      renderKpListForProject(projectId);
      refreshProjectKpAttachSelect(projectId);
      if(typeof currentObjectId!=='undefined'&&currentObjectId===projectId)await renderObjectDocuments(projectId);
    }
  }catch(e){console.error(e);showToast('Не удалось открепить КП');}
}
window.detachKpFromProject=detachKpFromProject;
window.detachContractFromProject=detachContractFromProject;

async function renderProjectContractList(projectId){
  const list=$('pf-contract-list'); if(!list) return;
  await queryContractHistory();
  const rows=latestContractRowsForProject(projectId);
  if(!rows.length){list.innerHTML='<div class="empty-state">Договор пока не прикреплён</div>';return;}
  list.innerHTML=rows.map(r=>{const s=contractRowSnapshot(r)||{};return `<div class="list-item"><div style="flex:1"><div class="li-name">Договор № ${escDoc(s.number||'без номера')}</div><div class="li-meta">${escDoc(contractLabel(s.contract_type))} · ${escDoc(s.client_name||'Без заказчика')}</div></div><div class="li-actions"><button type="button" class="icon-btn" data-open-contract-id="${escDoc(r.id)}" title="Открыть">✏️</button><button type="button" class="icon-btn" data-detach-project-contract-id="${escDoc(r.id)}" title="Открепить от проекта">🔗</button></div></div>`;}).join('');
}
function openContractsForProject(projectId){
  documentReturnContext=currentDocumentOrigin(projectId);
  linkedDocumentProjectId=projectId;
  if($('projectSheetOverlay')?.classList.contains('active') && typeof closeProjectSheet==='function') closeProjectSheet();
  openContractsView();
  setTimeout(()=>{
    const sel=$('ct-project'); if(sel){sel.value=projectId;sel.dispatchEvent(new Event('change',{bubbles:true}));}
    editingContractId=null;
    if(contractView) contractView.dataset.dirty='0';
  },0);
}
function openContractHistoryFromAnywhere(rowId){
  const row=contractHistoryRows.find(r=>String(r.id)===String(rowId));
  const snap=contractRowSnapshot(row)||{};
  const sourceProject=(typeof editingProjectId!=='undefined'&&editingProjectId) || (typeof currentObjectId!=='undefined'&&currentObjectId) || snap.project_id || null;
  if(sourceProject){
    documentReturnContext=currentDocumentOrigin(sourceProject);
    linkedDocumentProjectId=sourceProject;
  }
  if($('projectSheetOverlay')?.classList.contains('active') && typeof closeProjectSheet==='function') closeProjectSheet();
  openContractsView();
  setTimeout(()=>loadContractVersion(rowId),0);
}

function refreshKpProjectSelect(){
  const sel=$('kp-project-link'); if(!sel) return;
  const current=(typeof editingKpProjectId!=='undefined'&&editingKpProjectId)||'';
  sel.innerHTML='<option value="">— без привязки —</option>'+((state?.projects||[]).filter(p=>!p.deleted_at).map(p=>`<option value="${escDoc(p.id)}">${escDoc(p.name)}</option>`).join(''));
  sel.value=current||'';
}
async function attachKpToCurrentProject(){
  const select=$('pf-kp-attach-select'); if(!select||!editingProjectId||!select.value) return;
  try{
    const {error}=await sb.from('kp_forms').update({project_id:editingProjectId,updated_at:new Date().toISOString()}).eq('id',select.value);
    if(error)throw error;
    showToast('КП прикреплено к проекту');
    await loadAll();
    renderKpListForProject(editingProjectId);
    refreshProjectKpAttachSelect(editingProjectId);
  }catch(e){console.error(e);showToast('Не удалось прикрепить КП');}
}
function refreshProjectKpAttachSelect(projectId){
  const sel=$('pf-kp-attach-select');if(!sel)return;
  const free=(state?.kpForms||[]).filter(k=>!k.project_id);
  sel.innerHTML='<option value="">— выбрать сохранённое КП —</option>'+free.map(k=>`<option value="${escDoc(k.id)}">${escDoc(k.client_name||k.object||'КП')} · ${escDoc(typeof fmtDate==='function'?fmtDate(k.kp_date):k.kp_date||'')}</option>`).join('');
}
async function renderObjectDocuments(projectId){
  const box=$('objDocumentsContent'); if(!box) return;
  await queryContractHistory();
  const contracts=latestContractRowsForProject(projectId);
  const kps=(state?.kpForms||[]).filter(k=>k.project_id===projectId);
  const cHtml=contracts.length?contracts.map(r=>{const s=contractRowSnapshot(r)||{};return `<div class="list-item"><div style="flex:1"><div class="li-name">Договор № ${escDoc(s.number||'без номера')}</div><div class="li-meta">${escDoc(s.client_name||'Без заказчика')}</div></div><div class="li-actions"><button class="icon-btn" type="button" data-object-contract-id="${escDoc(r.id)}" title="Открыть">✏️</button><button class="icon-btn" type="button" data-object-detach-contract-id="${escDoc(r.id)}" title="Открепить">🔗</button></div></div>`;}).join(''):'<div class="empty-state">Договоров нет</div>';
  const kHtml=kps.length?kps.map(k=>`<div class="list-item"><div style="flex:1"><div class="li-name">КП · ${escDoc(k.client_name||'Без имени')}</div><div class="li-meta">${escDoc(typeof fmtDate==='function'?fmtDate(k.kp_date):k.kp_date||'')} · ${escDoc(typeof fmtMoney==='function'?fmtMoney(kpRowSummary(k)):kpRowSummary(k))}</div></div><div class="li-actions"><button class="icon-btn" type="button" data-object-kp-id="${escDoc(k.id)}" title="Открыть">✏️</button><button class="icon-btn" type="button" data-object-detach-kp-id="${escDoc(k.id)}" title="Открепить">🔗</button></div></div>`).join(''):'<div class="empty-state">КП нет</div>';
  box.innerHTML=`<div class="project-eyebrow">Договоры</div>${cHtml}<div class="project-eyebrow" style="margin-top:12px">Коммерческие предложения</div>${kHtml}<div class="btn-row" style="margin-top:10px"><button class="btn btn-secondary" type="button" id="objNewContractBtn">+ Договор</button><button class="btn btn-secondary" type="button" id="objNewKpBtn">+ КП</button></div><button class="btn btn-secondary" type="button" id="objDownloadPriceBtn" style="margin-top:8px">Скачать прайс по направлению</button>`;
  $('objNewContractBtn')?.addEventListener('click',()=>openContractsForProject(projectId));
  $('objNewKpBtn')?.addEventListener('click',()=>openKpViewForProject(projectId));
  $('objDownloadPriceBtn')?.addEventListener('click',()=>window.openPriceListSheet?.(projectId));
}

// Inject contract history/actions.
const contractView=$('view-contracts');
if(contractView){
  const typeLabel=contractView.querySelector('.section-label');
  if(typeLabel){
    const historyLabel=document.createElement('div');historyLabel.className='section-label';historyLabel.innerHTML='<span class="lbl-text">Сохранённые договоры</span><span class="section-label-line"></span>';
    const search=document.createElement('div');search.className='search-box';search.innerHTML='<input type="text" id="ct-history-search" placeholder="Поиск по номеру, клиенту, объекту или проекту"><button class="search-clear" id="ct-history-searchClear" type="button">✕</button>';
    const historyCard=document.createElement('div');historyCard.id='ct-history-list';historyCard.className='card';historyCard.style.marginBottom='8px';
    const newBtn=document.createElement('button');newBtn.type='button';newBtn.id='ct-new';newBtn.className='btn btn-secondary';newBtn.style.marginBottom='12px';newBtn.textContent='+ Новый договор';
    contractView.insertBefore(historyLabel,typeLabel);contractView.insertBefore(search,typeLabel);contractView.insertBefore(historyCard,typeLabel);contractView.insertBefore(newBtn,typeLabel);
    const searchInput=$('ct-history-search'), searchClear=$('ct-history-searchClear');
    const syncSearch=()=>{contractSearchQuery=searchInput?.value||'';search?.classList.toggle('has-value',!!contractSearchQuery);renderContractHistory();};
    searchInput?.addEventListener('input',syncSearch);
    searchClear?.addEventListener('click',()=>{searchInput.value='';syncSearch();searchInput.focus();});
  }
  const pdf=$('ct-export-pdf');
  if(pdf){
    pdf.textContent='Скачать PDF';
    const save=document.createElement('button');save.type='button';save.id='ct-save-history';save.className='btn btn-primary';save.style.marginBottom='8px';save.textContent='Сохранить договор';
    const word=document.createElement('button');word.type='button';word.id='ct-export-word';word.className='btn btn-secondary';word.style.marginBottom='8px';word.textContent='Скачать Word';
    const del=document.createElement('button');del.type='button';del.id='ct-delete-contract';del.className='btn btn-danger';del.style.marginTop='8px';del.textContent='Удалить договор';
    pdf.parentNode.insertBefore(save,pdf);pdf.parentNode.insertBefore(word,pdf);pdf.parentNode.insertBefore(del,pdf.nextSibling);
    del.addEventListener('click',async()=>{
      if(!editingContractId){showToast('Сначала откройте сохранённый договор');return;}
      await queryContractHistory();
      const row=contractHistoryRows.find(r=>r.entity_id===editingContractId);
      if(!row){showToast('Сохранённый договор не найден');return;}
      deleteSavedContract(row.id);
    });
  }
  $('ct-history-list')?.addEventListener('click',e=>{
    const del=e.target.closest('[data-delete-contract-row]');
    if(del){ e.stopPropagation(); deleteSavedContract(del.dataset.deleteContractRow); return; }
    const b=e.target.closest('[data-contract-history-id]');
    if(b) loadContractVersion(b.dataset.contractHistoryId);
  });
  $('ct-new')?.addEventListener('click',newContractDraft);
  $('ct-save-history')?.addEventListener('click',saveContractVersion);
  $('ct-export-word')?.addEventListener('click',exportContractToWord);
}

// Inject contracts + existing-KP attachment into the project Documents tab.
const kpList=$('pf-kp-list');
if(kpList && !$('pf-contract-list')){
  const kpBtn=$('pf-create-kp');
  const attach=document.createElement('div');attach.className='card';attach.style.margin='8px 0 0';
  attach.innerHTML='<div class="field" style="margin-bottom:8px"><label>Прикрепить сохранённое КП</label><select id="pf-kp-attach-select"><option value="">— выбрать сохранённое КП —</option></select></div><button type="button" class="btn btn-secondary" id="pf-kp-attach-btn">Прикрепить КП</button>';
  kpBtn?.after(attach);
  const label=document.createElement('div');label.className='section-label';label.style.margin='18px 0 10px';label.innerHTML='<span class="lbl-text">Договоры</span><span class="section-label-line"></span>';
  const list=document.createElement('div');list.id='pf-contract-list';list.className='card';list.style.marginBottom='8px';
  const btn=document.createElement('button');btn.type='button';btn.id='pf-create-contract';btn.className='btn btn-secondary';btn.textContent='+ Создать / прикрепить договор';
  attach.after(label,list,btn);
  $('pf-kp-attach-btn')?.addEventListener('click',attachKpToCurrentProject);
  list.addEventListener('click',e=>{
    const detach=e.target.closest('[data-detach-project-contract-id]');
    if(detach){detachContractFromProject(detach.dataset.detachProjectContractId,editingProjectId);return;}
    const b=e.target.closest('[data-open-contract-id]');
    if(b)openContractHistoryFromAnywhere(b.dataset.openContractId);
  });
  btn.addEventListener('click',()=>{if(editingProjectId)openContractsForProject(editingProjectId);});
}

// Inject project linkage into KP editor.
const kpNew=$('kpNewBtn');
if(kpNew && !$('kp-saved-search')){
  const kpSaved=$('kpSavedList');
  if(kpSaved){
    const kpSearch=document.createElement('div');
    kpSearch.className='search-box';
    kpSearch.innerHTML='<input type="text" id="kp-saved-search" placeholder="Поиск КП по клиенту, объекту или проекту"><button class="search-clear" id="kp-saved-searchClear" type="button">✕</button>';
    kpSaved.before(kpSearch);
    const applyKpSearch=()=>{
      const q=($('kp-saved-search')?.value||'').trim().toLowerCase();
      kpSearch.classList.toggle('has-value',!!q);
      kpSaved.querySelectorAll('.list-item').forEach(row=>{row.style.display=!q||row.textContent.toLowerCase().includes(q)?'':'none';});
    };
    $('kp-saved-search')?.addEventListener('input',applyKpSearch);
    $('kp-saved-searchClear')?.addEventListener('click',()=>{$('kp-saved-search').value='';applyKpSearch();$('kp-saved-search').focus();});
    window.__applyKpSavedSearch=applyKpSearch;
  }
}
if(kpNew && !$('kp-project-link')){
  const label=document.createElement('div');label.className='section-label';label.innerHTML='<span class="lbl-text">Привязка к проекту / объекту</span><span class="section-label-line"></span>';
  const card=document.createElement('div');card.className='card';card.innerHTML='<div class="field" style="margin-bottom:0"><label>Карточка проекта или объекта</label><select id="kp-project-link"><option value="">— без привязки —</option></select><div class="hint" style="margin-top:6px">После сохранения КП появится в разделе «Документы» выбранной карточки.</div></div>';
  kpNew.after(label,card);
  $('kp-project-link').addEventListener('change',e=>{editingKpProjectId=e.target.value||null;});
}

// Inject documents into construction object card.
const objSummary=$('objSummary');
if(objSummary && !$('objDocumentsContent')){
  const label=document.createElement('div');label.className='section-label';label.style.marginTop='14px';label.innerHTML='<span class="lbl-text">Документы</span><span class="section-label-line"></span>';
  const box=document.createElement('div');box.id='objDocumentsContent';box.className='card';
  objSummary.after(label,box);
  box.addEventListener('click',e=>{
    const dc=e.target.closest('[data-object-detach-contract-id]');
    if(dc){detachContractFromProject(dc.dataset.objectDetachContractId,typeof currentObjectId!=='undefined'?currentObjectId:null);return;}
    const dk=e.target.closest('[data-object-detach-kp-id]');
    if(dk){detachKpFromProject(dk.dataset.objectDetachKpId,typeof currentObjectId!=='undefined'?currentObjectId:null);return;}
    const c=e.target.closest('[data-object-contract-id]');if(c){openContractHistoryFromAnywhere(c.dataset.objectContractId);return;}
    const k=e.target.closest('[data-object-kp-id]');if(k){loadKpFormById(k.dataset.objectKpId);}
  });
}

// Wrap existing flows so the new document UI stays in sync.
if(typeof openContractsView==='function'){
  const old=openContractsView;
  openContractsView=function(){
    const r=old.apply(this,arguments);
    editingContractId=null;
    if(!linkedDocumentProjectId) newContractDraft();
    renderContractHistory();
    if(contractView) contractView.dataset.dirty='0';
    return r;
  };
}
if(typeof openProjectSheet==='function'){
  const old=openProjectSheet;
  openProjectSheet=function(id){old.apply(this,arguments);if(id){renderProjectContractList(id);refreshProjectKpAttachSelect(id);}else{if($('pf-contract-list'))$('pf-contract-list').innerHTML='<div class="empty-state">Сохраните проект, чтобы прикреплять договоры</div>';refreshProjectKpAttachSelect('');}};
}
if(typeof openObjectView==='function'){
  const old=openObjectView;
  openObjectView=function(id){const r=old.apply(this,arguments);setTimeout(()=>renderObjectDocuments(id),0);return r;};
}
if(typeof openKpView==='function'){
  const old=openKpView;
  openKpView=function(){const r=old.apply(this,arguments);refreshKpProjectSelect();if($('view-kp'))$('view-kp').dataset.dirty='0';setTimeout(()=>window.__applyKpSavedSearch?.(),0);return r;};
}
if(typeof loadKpForm==='function'){
  const old=loadKpForm;
  loadKpForm=function(kp){const r=old.apply(this,arguments);refreshKpProjectSelect();if($('kp-project-link'))$('kp-project-link').value=kp?.project_id||'';return r;};
}
if(typeof resetKpForm==='function'){
  const old=resetKpForm;
  resetKpForm=function(){
    const keep=linkedDocumentProjectId||null;
    const r=old.apply(this,arguments);
    if(keep) editingKpProjectId=keep;
    refreshKpProjectSelect();
    if($('kp-project-link'))$('kp-project-link').value=keep||'';
    if(keep){
      const p=(state?.projects||[]).find(x=>x.id===keep);
      if(p){
        if($('kp-client-name'))$('kp-client-name').value=p.client_name||'';
        if($('kp-client-phone'))$('kp-client-phone').value=p.phone||'';
        if($('kp-object'))$('kp-object').value=p.address||p.name||'';
      }
    }
    if($('view-kp'))$('view-kp').dataset.dirty='0';
    return r;
  };
}
if(typeof saveKpForm==='function'){
  const old=saveKpForm;
  saveKpForm=async function(){
    if($('kp-project-link'))editingKpProjectId=$('kp-project-link').value||null;
    const r=await old.apply(this,arguments);
    if(r===true && $('view-kp'))$('view-kp').dataset.dirty='0';
    if(r===true && editingKpProjectId){renderKpListForProject(editingKpProjectId);if(typeof currentObjectId!=='undefined'&&currentObjectId===editingKpProjectId)renderObjectDocuments(editingKpProjectId);}
    setTimeout(()=>window.__applyKpSavedSearch?.(),0);
    return r;
  };
}

// Existing addEventListener bindings in index.html keep the original function reference,
 // so refresh the enhanced UI explicitly after those legacy handlers run.
 $('openContractsBtn')?.addEventListener('click',()=>{documentReturnContext=null;linkedDocumentProjectId=null;setTimeout(()=>{newContractDraft();renderContractHistory();},0);});
 $('kpNewBtn')?.addEventListener('click',()=>setTimeout(()=>{const keep=linkedDocumentProjectId||null;if(keep)editingKpProjectId=keep;refreshKpProjectSelect();if($('kp-project-link'))$('kp-project-link').value=keep||'';},0));
 $('openKpBtn')?.addEventListener('click',()=>{documentReturnContext=null;linkedDocumentProjectId=null;setTimeout(()=>{resetKpForm();refreshKpProjectSelect();},0);});

 // Existing index.html back handlers always go to «Ещё». Capture the click first
 // so documents opened from a project/object return to the same place.
 ['contractsBack','kpBack'].forEach(id=>{
   $(id)?.addEventListener('click',e=>{
     if(documentReturnContext){
       e.preventDefault();e.stopImmediatePropagation();
       returnFromDocumentView();
     }
   },true);
 });

 // Remember where KP was opened from, including the construction object view.
 if(typeof openKpViewForProject==='function'){
   const originalOpenKpForProject=openKpViewForProject;
   openKpViewForProject=function(projectId){
     documentReturnContext=currentDocumentOrigin(projectId);
     linkedDocumentProjectId=projectId;
     return originalOpenKpForProject.apply(this,arguments);
   };
 }
 if(typeof loadKpFormById==='function'){
   const originalLoadKpById=loadKpFormById;
   loadKpFormById=function(id){
     const kp=(state?.kpForms||[]).find(k=>k.id===id);
     const sourceProject=(typeof editingProjectId!=='undefined'&&editingProjectId) || (typeof currentObjectId!=='undefined'&&currentObjectId) || kp?.project_id || null;
     if(sourceProject){documentReturnContext=currentDocumentOrigin(sourceProject);linkedDocumentProjectId=sourceProject;}
     return originalLoadKpById.apply(this,arguments);
   };
 }

 window.openContractsForProject=openContractsForProject;
 window.renderProjectContractList=renderProjectContractList;
 window.exportContractToWord=exportContractToWord;
})();


