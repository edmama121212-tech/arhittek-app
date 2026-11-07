// ============================================================
// ТЗ ДЛЯ КЛИЕНТОВ
// ============================================================
const TZ_FIELD_LABELS = {
  full_name: 'Ваше имя',
  phone: 'Телефон для связи',
  email: 'Email (необязательно)',
  object_address: 'Адрес объекта',
  service_type: 'Какая услуга вам нужна?',
  ar_object_type: 'Тип объекта',
  ar_cadastre: 'Кадастровый номер участка (если есть)',
  ar_gosplan: 'Есть градостроительный план участка?',
  ar_docs: 'Есть правоустанавливающие документы на участок?',
  ar_topo: 'Есть топографическая съёмка участка?',
  ar_geo: 'Есть инженерно-геологические изыскания?',
  ar_power: 'Есть техусловия на подключение электричества (от 15 кВт)?',
  ar_utilities: 'Есть техусловия на воду/канализацию/отопление?',
  ar_living_type: 'Вид проживания',
  ar_residents: 'Сколько человек / семей будет проживать?',
  ar_plot_area: 'Площадь участка, м²',
  ar_house_area: 'Желаемая площадь застройки, м²',
  ar_floors: 'Этажность',
  ar_floor_height: 'Высота каждого этажа, м (если есть предпочтения)',
  ar_basement: 'Нужен подвал / цокольный этаж?',
  ar_attic: 'Нужна мансарда?',
  ar_rooms: 'Состав помещений по этажам',
  ar_bedrooms: 'Сколько спален всего нужно?',
  ar_bathrooms: 'Сколько санузлов всего нужно?',
  ar_garage: 'Гараж',
  ar_pool: 'Бассейн',
  ar_terrace: 'Терраса / входная группа',
  ar_style: 'Стиль фасада',
  ar_facade_materials: 'Отделочные материалы фасада (если есть пожелания)',
  ar_windows: 'Тип окон',
  ar_extras: 'Дополнительно на участке',
  ar_engineering: 'Инженерные предпочтения',
  ar_sections: 'Какие разделы проектной документации нужны?',
  ar_notes: 'Дополнительные пожелания по АР',
  ar_refs: 'Референсы по архитектуре',
  di_rooms: 'Какие помещения нужно оформить?',
  di_budget: 'Ориентировочный бюджет проекта',
  di_collab_style: 'Стиль работы с дизайнером',
  di_beauty_vs_practical: 'Красота или практичность?',
  di_style: 'Предпочитаемый стиль интерьера',
  di_style_description: 'Опишите, как вы представляете выбранный стиль',
  di_colors_like: 'Цвета и оттенки, которые ВАМ НРАВЯТСЯ',
  di_colors_dislike: 'Цвета и оттенки, которые НЕ НРАВЯТСЯ',
  di_want: 'Что ВЫ ХОТИТЕ видеть в интерьере',
  di_dont_want: 'Что вы НЕ хотите видеть в интерьере',
  di_shapes: 'Предпочтительные формы',
  di_fireplace: 'Нужен камин?',
  di_materials: 'Отношение к материалам',
  di_pets: 'Домашние животные',
  di_plants: 'Комнатные растения / вертикальное озеленение',
  di_renovation: 'Нужна перепланировка?',
  di_renovation_details: 'Какие изменения планировки нужны',
  di_windows_doors: 'Замена окон/дверей/радиаторов нужна?',
  di_engineering: 'Инженерные системы в интерьере',
  di_av: 'Аудио/видео системы',
  di_floor: 'Тип пола',
  di_walls: 'Отделка стен',
  di_ceiling: 'Потолок',
  di_doors_style: 'Межкомнатные двери',
  di_furniture: 'Мебель и техника',
  di_kitchen: 'Кухня — пожелания',
  di_living_room: 'Гостиная — пожелания',
  di_bedroom: 'Спальня(и) — пожелания',
  di_kids_room: 'Детская(ие) — пожелания',
  di_bathroom: 'Ванные комнаты — пожелания',
  di_other_rooms: 'Другие помещения (кабинет, прихожая, гардеробная, балкон)',
  di_existing: 'Что нужно сохранить / учесть из существующего',
  di_lifestyle: 'Образ жизни',
  di_notes: 'Другие пожелания по интерьеру',
  di_refs: 'Референсы по интерьеру',
  deadline_pref: 'Желаемые сроки начала/завершения проекта (если есть)',
  other_notes: 'Любая другая важная информация',
};

LandscapeBrief.fields.forEach(f=>TZ_FIELD_LABELS[f.id]=f.label);
TZ_FIELD_LABELS.ld_tariff='Тариф ландшафтного дизайна';
TZ_FIELD_LABELS.ld_scope='Состав выбранного тарифа';

function tzFormUrl(token){
  // Assumes tz.html is hosted alongside the main app
  const base = window.location.href.replace(/[^\/]*$/, '');
  return `${base}tz.html?token=${token}`;
}

function renderKpListForProject(projectId){
  const container = document.getElementById('pf-kp-list');
  if(!container) return;
  const forms = state.kpForms.filter(k=>k.project_id===projectId);

  if(!forms.length){
    container.innerHTML = '<div class="empty-state">КП пока не создано</div>';
    return;
  }

  container.innerHTML = forms.map(kp=>{
    const total = kpRowSummary(kp);
    return `<div class="list-item">
      <div style="cursor:pointer; flex:1;" onclick="loadKpFormById('${kp.id}')">
        <div class="li-name">${escapeHtml(kp.client_name || 'Без имени')}</div>
        <div class="li-meta">${fmtDate(kp.kp_date)} · ${fmtMoney(total)}${kp.payment_method==='card'?' · карта':' · счёт'}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" title="Редактировать" onclick="loadKpFormById('${kp.id}')">✏️</button>
        <button class="icon-btn" title="Открепить от проекта" onclick="detachKpFromProject('${kp.id}','${projectId}')">🔗</button>
      </div>
    </div>`;
  }).join('');
}

function renderTzList(projectId){
  const container = document.getElementById('pf-tz-list');
  const forms = state.tzForms.filter(f=>f.project_id===projectId);

  if(!forms.length){
    container.innerHTML = '<div class="empty-state">ТЗ пока не создано</div>';
    return;
  }

  container.innerHTML = forms.map(f=>{
    const answers = f.answers || {};
    const filledCount = Object.keys(answers).filter(k=>answers[k] && answers[k]!=='').length;
    const hasData = filledCount > 0;
    const statusLabel = hasData ? `Заполняется (${filledCount} полей)` : 'Пусто — ссылка отправлена';
    const statusColor = hasData ? 'var(--green)' : 'var(--gold)';
    const url = tzFormUrl(f.token);
    const lastSaved = f.submitted_at || f.created_at;
    return `<div class="list-item">
      <div>
        <div class="li-name">ТЗ${f.client_name ? ' — '+escapeHtml(f.client_name) : ''}</div>
        <div class="li-meta" style="color:${statusColor}">${statusLabel} · ${fmtDateTime(lastSaved)}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" onclick="viewTzAnswers('${f.id}')" title="Посмотреть / редактировать ответы">👁</button>
        <button class="icon-btn" onclick="copyTzLink('${url}')" title="Скопировать ссылку клиенту">🔗</button>
        <button class="icon-btn danger" onclick="deleteTzForm('${f.id}')" title="Удалить ТЗ">🗑</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteTzForm(tzFormId){
  if(!confirm('Удалить это ТЗ? Действие необратимо, включая загруженные референсы.')) return;
  try{
    await sb.from('tz_references').delete().eq('tz_form_id', tzFormId);
    const {error} = await sb.from('tz_forms').delete().eq('id', tzFormId);
    if(error) throw error;
    showToast('ТЗ удалено');
    await loadAll();
    if(editingProjectId) renderTzList(editingProjectId);
  }catch(e){
    console.error(e);
    showToast('Ошибка удаления ТЗ');
  }
}

function landscapeTzSeed(p){
 const cat=state.categories.find(c=>c.id===p.category_id);
 if(!/ландшафт/i.test(cat?.name||'')) return {};
 const items=LandscapeBrief.catalog(state.kpCatalog);
 return {service_type:[LandscapeBrief.service],_ld_tariffs:items};
}
async function createTzForm(){
  if(!editingProjectId) return;
  const p = state.projects.find(x=>x.id===editingProjectId);
  if(!p) return;

  const token = crypto.randomUUID().replace(/-/g,'').slice(0,16);

  try{
    const {data, error} = await sb.from('tz_forms').insert({
      project_id: editingProjectId,
      token,
      status: 'Отправлено',
      answers: landscapeTzSeed(p),
    }).select().single();
    if(error) throw error;

    await logAudit('project', editingProjectId, p.name, 'update', {tz_created: {old:null, new: token}});

    const url = tzFormUrl(token);
    await loadAll();
    renderTzList(editingProjectId);

    copyTzLink(url);
  }catch(e){
    console.error(e);
    showToast('Ошибка создания ТЗ');
  }
}

function copyTzLink(url){
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(()=>{
      showToast('Ссылка скопирована: можно отправить клиенту');
    }).catch(()=>{
      showToast(url);
    });
  }else{
    showToast(url);
  }
}

function viewTzAnswers(tzFormId){
  const f = state.tzForms.find(x=>x.id===tzFormId);
  if(!f) return;

  const answers = f.answers || {};
  if((answers.service_type||[]).includes(LandscapeBrief.service)) LandscapeBrief.sync(answers,LandscapeBrief.catalog(state.kpCatalog));
  const refs = state.tzReferences ? state.tzReferences.filter(r=>r.tz_form_id===tzFormId) : [];

  if((answers.service_type||[]).includes(LandscapeBrief.service)){
    answers.ld_tariff=answers.ld_tariff||'';
    LandscapeBrief.fields.forEach(field=>{if(field.type!=='refs' && LandscapeBrief.visible(field.id,answers) && answers[field.id]===undefined) answers[field.id]='';});
  }

  let html = `<div class="card">
    <div class="li-meta" style="margin-bottom:8px;">Заполнено ${fmtDateTime(f.submitted_at)}</div>
  `;

  Object.entries(answers).forEach(([key, val])=>{
    if(key.startsWith('_') || !LandscapeBrief.visible(key,answers)) return;
    if(key.endsWith('_files')) return; // handled separately as refs
    if(key!=='ld_tariff' && !key.startsWith('ld_') && (val === '' || val == null || (Array.isArray(val) && !val.length))) return;
    const label = TZ_FIELD_LABELS[key] || key;
    const displayVal = Array.isArray(val) ? val.join(', ') : val;
    if(key==='ld_tariff'){ html += `<div class="field"><label>${escapeHtml(label)}</label><select class="tz-edit-field" data-key="ld_tariff" onchange="changeLandscapeTariff('${f.id}',this.value)"><option value="">Выберите тариф</option>${LandscapeBrief.tariffs(answers).map(t=>`<option ${t.name===val?'selected':''} value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')}</select></div>`; return; }
    html += `<div class="fee-row" style="display:block; padding:8px 0;">
      <div class="fl" style="margin-bottom:3px;">${escapeHtml(label)}</div>
      <textarea class="tz-edit-field" data-key="${escapeHtml(key)}" data-is-array="${Array.isArray(val)?'1':'0'}"
        style="width:100%; background:#FFFFFF; border:1px solid var(--line-strong); border-radius:var(--radius-sm); color:var(--text); font-size:13px; padding:8px 10px; font-family:'Inter',sans-serif; min-height:38px;">${escapeHtml(displayVal)}</textarea>
    </div>`;
  });

  // Reference photos
  Object.entries(answers).forEach(([key, val])=>{
    if(key.startsWith('_') || !LandscapeBrief.visible(key.replace(/_files$/, ''),answers)) return;
    if(!key.endsWith('_files') || !Array.isArray(val) || !val.length) return;
    const baseKey = key.replace('_files','');
    const label = TZ_FIELD_LABELS[baseKey] || baseKey;
    html += `<div style="padding:8px 0;">
      <div class="fl" style="margin-bottom:6px;">${escapeHtml(label)} — референсы</div>
      <div class="photo-grid">
        ${val.map(url=>`<div class="photo-thumb"><img src="${escapeHtml(url)}" loading="lazy"></div>`).join('')}
      </div>
    </div>`;
  });

  html += `</div>`;

  html += `<button class="btn btn-primary" style="margin-top:4px;" onclick="saveTzAnswers('${tzFormId}')">💾 Сохранить изменения</button>`;
  html += `<button class="btn btn-secondary" style="margin-top:8px;" onclick="exportTzAnswersToPdf('${tzFormId}')">📄 Скачать ТЗ в PDF</button>`;

  document.getElementById('tzAnswersContent').innerHTML = html;
  document.getElementById('tzSheetOverlay').classList.add('active');
}

function changeLandscapeTariff(id,value){
 const f=state.tzForms.find(x=>x.id===id); if(!f) return;
 document.querySelectorAll('.tz-edit-field').forEach(el=>{f.answers[el.dataset.key]=el.dataset.isArray==='1'?el.value.split(',').map(v=>v.trim()).filter(Boolean):el.value;});
 LandscapeBrief.setTariff(f.answers,value); viewTzAnswers(id);
}
async function saveTzAnswers(tzFormId){
  const f = state.tzForms.find(x=>x.id===tzFormId);
  if(!f) return;

  const updatedAnswers = {...(f.answers || {})};
  document.querySelectorAll('.tz-edit-field').forEach(el=>{
    const key = el.dataset.key;
    const isArray = el.dataset.isArray === '1';
    const raw = el.value.trim();
    if(isArray){
      updatedAnswers[key] = raw ? raw.split(',').map(s=>s.trim()).filter(Boolean) : [];
    }else{
      updatedAnswers[key] = raw;
    }
  });

  if((updatedAnswers.service_type||[]).includes(LandscapeBrief.service)) LandscapeBrief.setTariff(updatedAnswers,updatedAnswers.ld_tariff||'');
  showToast('Сохранение…');
  try{
    const {error} = await sb.from('tz_forms').update({answers: updatedAnswers}).eq('id', tzFormId);
    if(error) throw error;
    showToast('ТЗ обновлено');
    document.getElementById('tzSheetOverlay').classList.remove('active');
    await loadAll();
  }catch(e){
    console.error(e);
    showToast('Ошибка сохранения');
  }
}

async function exportTzAnswersToPdf(tzFormId){
  const f = state.tzForms.find(x=>x.id===tzFormId);
  if(!f) return;
  const answers = f.answers || {};

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  registerPdfFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  const logoSize = 14;
  doc.addImage(ARHITTEK_LOGO_B64, 'PNG', margin, 10, logoSize, logoSize * (87/100));
  const textX = margin + logoSize + 4;
  doc.setFont('Roboto','bold'); doc.setFontSize(18); doc.setTextColor(0);
  doc.text('ARHIT', textX, 19);
  const arhitWidth = doc.getTextWidth('ARHIT');
  doc.setTextColor(69,134,236);
  doc.text('TEK', textX + arhitWidth, 19);
  doc.setTextColor(0);
  doc.setFont('Roboto','normal'); doc.setFontSize(11);
  doc.text('Техническое задание', textX, 26);
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Дата: ${fmtDate(f.submitted_at || f.created_at)}`, pageWidth - margin, 20, {align:'right'});
  doc.setTextColor(0);

  y = 38;

  Object.entries(answers).forEach(([key, val])=>{
    if(key.startsWith('_') || !LandscapeBrief.visible(key,answers)) return;
    if(key.endsWith('_files')) return;
    if(val === '' || val == null || (Array.isArray(val) && !val.length)) return;
    const label = TZ_FIELD_LABELS[key] || key;
    const valueText = Array.isArray(val) ? val.join(', ') : String(val);

    if(y > 275){ doc.addPage(); y = 20; }

    doc.setFont('Roboto','bold'); doc.setFontSize(9);
    const labelLines = doc.splitTextToSize(label, pageWidth - margin*2);
    labelLines.forEach(line=>{ doc.text(line, margin, y); y += 4.5; });

    doc.setFont('Roboto','normal'); doc.setFontSize(9); doc.setTextColor(60);
    const valueLines = doc.splitTextToSize(valueText, pageWidth - margin*2);
    valueLines.forEach(line=>{
      if(y > 280){ doc.addPage(); y = 20; }
      doc.text(line, margin, y); y += 4.5;
    });
    doc.setTextColor(0);
    y += 2;
  });

      const fileGroups = [];
      Object.entries(answers).forEach(([key, val])=>{
        if(key.endsWith('_files') && Array.isArray(val) && val.length){
          const baseKey = key.replace('_files','');
          const label = TZ_FIELD_LABELS[baseKey] || baseKey;
          fileGroups.push({label, urls: val});
  }
  });

      for(const group of fileGroups){
        if(y > 260){ doc.addPage(); y = 20; }
        doc.setFont('Roboto','bold'); doc.setFontSize(10); doc.setTextColor(0);
        doc.text(group.label + ' — референсы', margin, y); y += 6;
        for(const url of group.urls){
          try{
            const resp = await fetch(url);
            const blob = await resp.blob();
            const dataUrl = await new Promise((resolve, reject)=>{
              const reader = new FileReader();
              reader.onload = ()=>resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
  });
            const imgProps = doc.getImageProperties(dataUrl);
            const maxW = 80, maxH = 60;
            let w = maxW, h = maxW * imgProps.height / imgProps.width;
            if(h > maxH){ h = maxH; w = maxH * imgProps.width / imgProps.height; }
            if(y + h > 285){ doc.addPage(); y = 20; }
            doc.addImage(dataUrl, imgProps.fileType || 'JPEG', margin, y, w, h);
            y += h + 4;
  }catch(e){
            console.error('Не удалось загрузить референс для PDF', url, e);
  }
  }
        y += 2;
  }

  if(y > 270){ doc.addPage(); y = 20; }
  y = Math.max(y, 270);
  doc.setFont('Roboto','normal'); doc.setFontSize(8); doc.setTextColor(140);
  doc.text('ARHITTEK — архитектурное проектирование, дизайн интерьера, ремонт под ключ', margin, y);
  pdfCompanyAddress(doc, margin, y+4, 0);

  const clientName = f.client_name || 'klient';
  const fileName = `TZ-${clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g,'_')}-${financeToday()}.pdf`;
  doc.save(fileName);
}


let kpServices = [];
let kpServiceCounter = 0;

const KP_CATALOG = [
  {group:'Архитектурное проектирование', items:[
    {name:'Архитектурное решение', unit:'м²', rate:400, desc:'Полный пакет: планы фундамента и стен, маркировочные планы, генплан, фасады, разрезы, узлы, план кровли, ведомость окон/дверей, площади помещений, расстановка мебели, экстерьер фасада, благоустройство участка, 3D-визуализация. Срок 3–4 недели.'},
    {name:'Эскизный проект', unit:'м²', rate:200, desc:'Планировочные решения, фасадные эскизы, общая концепция объекта без рабочей документации. Срок 1 неделя.'},
    {name:'Экспресс-проект', unit:'шт', rate:20000, desc:'Базовый план объекта без детализации. Срок 3–4 дня.'},
    {name:'План-схема', unit:'шт', rate:15000, desc:'Простая план-схема помещения/участка без проектной документации. Срок 1–2 дня.'},
  ]},
  {group:'Дизайн интерьера', items:[
    {name:'Дизайн интерьера — Премиум', unit:'м²', rate:2900, desc:'Полный проект под ключ: дизайн-проект с рабочей документацией для строителей, подбор мебели по готовым ссылкам, согласование перепланировки при необходимости. Минимум вопросов на этапе строительства.'},
    {name:'Дизайн интерьера — Стандарт', unit:'м²', rate:1600, desc:'Дизайн-проект с визуализацией и базовой рабочей документацией, без полного пакета чертежей премиум-уровня.'},
    {name:'Дизайн интерьера — Норма', unit:'м²', rate:1100, desc:'Концептуальный дизайн с визуализацией интерьера, без детальной рабочей документации.'},
    {name:'Дизайн интерьера — Экспресс', unit:'м²', rate:400, desc:'Быстрый дизайн-концепт: цветовые решения и расстановка мебели без детальной визуализации.'},
    {name:'Дизайн интерьера — База', unit:'м²', rate:250, desc:'Базовое планировочное решение интерьера без визуализации.'},
  ]},
  {group:'Дизайн мебели', items:[
    {name:'Дизайн мебели — Кухня', unit:'шт', rate:10000, desc:'Индивидуальный дизайн-проект кухонного гарнитура с чертежами для производства.'},
    {name:'Дизайн мебели — Спальня', unit:'шт', rate:5000, desc:'Индивидуальный дизайн-проект мебели для спальни с чертежами для производства.'},
    {name:'Дизайн мебели — Гостиная', unit:'шт', rate:6000, desc:'Индивидуальный дизайн-проект мебели для гостиной с чертежами для производства.'},
  ]},
];

// Тарифы КП теперь редактируются в Настройках (таблица kp_catalog) и хранятся
// в state.kpCatalog. Пока миграция не выполнена или таблица пуста — используем
// встроенный KP_CATALOG как запасной вариант, чтобы КП не ломалось.
function kpCatalogGrouped(){
  const rows = state.kpCatalog || [];
  if(!rows.length) return KP_CATALOG;
  const groups = {};
  const order = [];
  rows.forEach(r=>{
    const g = r.group_name || 'Без направления';
    if(!groups[g]){ groups[g] = []; order.push(g); }
    groups[g].push({ id: r.id, name: r.name, unit: r.unit || 'м²', rate: Number(r.rate)||0, desc: r.description || '' });
  });
  return order.map(g=>({ group: g, items: groups[g] }));
}

function kpFlatCatalog(){
  const flat = [];
  kpCatalogGrouped().forEach(g=>g.items.forEach(it=>flat.push(it)));
  return flat;
}

function kpServiceSnapshot(item){
  if(!item) return null;
  return {id:item.id||null,name:String(item.name||''),unit:String(item.unit||'м²'),rate:Number(item.rate)||0,desc:String(item.desc||'')};
}
function kpServiceItem(service){
  if(service?.snapshot?.name) return service.snapshot;
  const flat=kpFlatCatalog();
  return flat[service?.catalogIndex] || flat[0] || {name:'Услуга',unit:'м²',rate:0,desc:''};
}

function addKpService(){
  const id = 'kpsvc-' + (++kpServiceCounter);
  kpServices.push({ id, catalogIndex: 0, snapshot:kpServiceSnapshot(kpFlatCatalog()[0]), qty: 1, customRate: null, preliminaryArea: false });
  renderKpServices();
}

function removeKpService(id){
  kpServices = kpServices.filter(s=>s.id!==id);
  if(!kpServices.length) addKpService();
  renderKpServices();
}

function renderKpServices(){
  const list = document.getElementById('kpServicesList');
  const groups = kpCatalogGrouped();
  const flat = [];
  groups.forEach(g=>g.items.forEach(it=>flat.push(it)));

  list.innerHTML = kpServices.map((s, idx)=>{
    const item = kpServiceItem(s);
    const effectiveRate = (s.customRate !== null && s.customRate !== undefined) ? s.customRate : item.rate;
    const sum = effectiveRate * (Number(s.qty)||0);
    const isCustom = effectiveRate !== item.rate;
    const selectedIndex=flat.findIndex(it=>it.name===item.name && it.unit===item.unit && Number(it.rate)===Number(item.rate) && (it.desc||'')===(item.desc||'') && (!item.id || it.id===item.id));
    let optionsHtml = selectedIndex<0 ? `<option value="snapshot" selected>Согласовано: ${escapeHtml(item.name)} (${fmt(item.rate)} ₽/${escapeHtml(item.unit)})</option>` : '';
    let flatIdx = 0;
    groups.forEach(g=>{
      optionsHtml += `<optgroup label="${escapeHtml(g.group)}">`;
      g.items.forEach(it=>{
        optionsHtml += `<option value="${flatIdx}" ${flatIdx===selectedIndex?'selected':''}>${escapeHtml(it.name)} (${fmt(it.rate)} ₽/${it.unit})</option>`;
        flatIdx++;
      });
      optionsHtml += `</optgroup>`;
    });

    return `<div class="kp-service">
      <div class="kp-service-head">
        <div class="kp-service-title">Услуга ${idx+1}</div>
        ${kpServices.length>1 ? `<button class="icon-btn danger" onclick="removeKpService('${s.id}')">✕ Удалить</button>` : ''}
      </div>
      <div class="field">
        <label>Тариф</label>
        <select onchange="updateKpService('${s.id}','catalogIndex', this.value)">${optionsHtml}</select>
      </div>
      ${item.desc ? `<div class="note" style="background:var(--bg-soft); border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:10px;">${escapeHtml(item.desc)}</div>` : ''}
      <div class="field-row">
        <div class="field">
          <label>${item.unit === 'м²' ? 'Площадь, м²' : 'Количество, шт'}</label>
          <input type="number" value="${s.qty}" min="0" step="0.1" onchange="updateKpService('${s.id}','qty', this.value)">
        </div>
        <div class="field">
          <label>Договорная цена, ₽/${item.unit}${isCustom ? ` <span style="color:var(--gold); text-transform:none;">(прайс: ${fmt(item.rate)})</span>` : ''}</label>
          <input type="number" value="${effectiveRate}" onchange="updateKpService('${s.id}','customRate', this.value)" style="${isCustom ? 'color:var(--gold); border-color:var(--gold);' : ''}">
        </div>
      </div>
      ${isCustom ? `<button class="icon-btn" style="font-size:11px; color:var(--text-dim); padding:0; margin-bottom:6px;" onclick="updateKpService('${s.id}','customRate','')">↺ Вернуть цену из прайса</button>` : ''}
      ${item.unit === 'м²' ? `<label style="display:flex;gap:10px;align-items:center;margin:10px 0"><input type="checkbox" ${s.preliminaryArea?'checked':''} onchange="updateKpService('${s.id}','preliminaryArea',this.checked)" style="width:auto">Предварительная площадь</label>${s.preliminaryArea?'<div class="note">Площадь и стоимость могут увеличиться или уменьшиться в ходе проектирования. Итоговый расчёт — по уточнённой площади и согласованному тарифу за м².</div>':''}` : ''}
      <div class="kp-service-sum">${s.preliminaryArea&&item.unit==='м²'?'≈ ':''}${fmtMoney(sum)}</div>
    </div>`;
  }).join('');

  updateKpTotals();
}

function updateKpService(id, field, value){
  const s = kpServices.find(x=>x.id===id);
  if(!s) return;
  if(field === 'catalogIndex'){
    const index=Number(value), item=kpFlatCatalog()[index];
    if(!Number.isInteger(index)||!item) return;
    s.catalogIndex = index;
    s.snapshot = kpServiceSnapshot(item);
    s.customRate = null;
  }
  else if(field === 'preliminaryArea') s.preliminaryArea = value === true;
  else if(field === 'qty') s.qty = parseFloat(value) || 0;
  else if(field === 'customRate') s.customRate = value === '' ? null : (parseFloat(value) || 0);
  renderKpServices();
}

function updateKpTotals(){
  const flat = kpFlatCatalog();
  const subtotal = kpServices.reduce((sum,s)=>{
    const item = kpServiceItem(s);
    const rate = (s.customRate !== null && s.customRate !== undefined) ? s.customRate : item.rate;
    return sum + rate * (Number(s.qty)||0);
  }, 0);

  const discType = document.getElementById('kp-discount-type').value;
  const discVal = parseFloat(document.getElementById('kp-discount-value').value) || 0;
  let discountAmount = 0;
  if(discType === 'percent') discountAmount = subtotal * discVal / 100;
  else discountAmount = discVal;
  if(discountAmount > subtotal) discountAmount = subtotal;
  if(discountAmount < 0) discountAmount = 0;

  const total = subtotal - discountAmount;
  const advance = total * 0.5;
  const remainder = total - advance;

  const prefix = kpServices.some(s=>s.preliminaryArea&&kpServiceItem(s).unit==='м²')?'≈ ':'';
  document.getElementById('kp-subtotal').textContent = prefix+fmtMoney(subtotal);
  document.getElementById('kp-discount-amount').textContent = fmtMoney(discountAmount);
  document.getElementById('kp-total').textContent = prefix+fmtMoney(total);
  document.getElementById('kp-advance').textContent = prefix+fmtMoney(advance);
  document.getElementById('kp-remainder').textContent = prefix+fmtMoney(remainder);

  return {subtotal, discountAmount, total, advance, remainder};
}

