// ============================================================
// ДОГОВОРЫ
// ============================================================
const CONTRACT_TYPES = {
  ar: {
    label: 'Архитектурное проектирование',
    workName: 'Архитектурный проект',
    defaultScope: [
      'Планы фундамента, стен 1 и 2 этажа с маркировкой',
      'Генеральный план (схема расположения дома на участке)',
      'Фасады с 4 сторон',
      'Разрезы',
      'Схема кровли',
      'Ведомость окон и дверей',
      'Экспликация и площади помещений',
      'Расстановка мебели',
      '3D-визуализация экстерьера',
    ],
  },
  di: {
    label: 'Дизайн интерьера',
    workName: 'Дизайн-проект интерьера',
    defaultScope: [
      'Планировочное решение с расстановкой мебели',
      'Развёртки стен по каждому помещению',
      'Ведомость отделочных материалов (пол, стены, потолок)',
      'План освещения и расстановки электроточек',
      'Подбор мебели, сантехники и декора (по согласованному уровню)',
      '3D-визуализация ключевых помещений',
    ],
  },
  st: {
    label: 'Строительство / ремонт под ключ',
    workName: 'Строительно-монтажные и отделочные работы',
    defaultScope: [
      'Выполнение работ в соответствии с утверждённым проектом и сметой',
      'Закупка и доставка материалов (по отдельной смете / бюджету заказчика)',
      'Контроль качества выполняемых работ на всех этапах',
      'Фотоотчёты о ходе работ',
      'Передача объекта по акту приёма-передачи выполненных работ',
    ],
  },
};

let contractType = 'ar';

function fillContractDefaults(){
  const t = CONTRACT_TYPES[contractType];
  document.getElementById('ct-scope').value = t.defaultScope.map(s=>'— '+s).join('\n');
}

function openContractsView(){
  if(!canUseDocuments())return;
  const sel = document.getElementById('ct-project');
  sel.innerHTML = '<option value="">— не выбран —</option>' +
    state.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  sel.value = '';

  document.getElementById('ct-date').value = financeToday();
  if(!document.getElementById('ct-scope').value.trim()) fillContractDefaults();

  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-contracts').classList.add('active');
  renderContractTariffs();
  syncContractProjectPicker();
  window.scrollTo(0,0);
}

document.querySelectorAll('#contract-type .yn-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    contractType = btn.dataset.value;
    fillContractDefaults();
  });
});

document.getElementById('ct-project').addEventListener('change', (e)=>{
  syncContractProjectPicker();
  resetContractCustomer();
  const p = state.projects.find(x=>x.id===e.target.value);
  if(!p){ resetContractPricing(); return; }

  // Тип договора определяем по направлению проекта.
  const cat = findCategory(p.category_id);
  const catName = (cat?.name||'').toLowerCase();
  let suggestedType = 'ar';
  if(isConstructionCategory(p.category_id)) suggestedType = 'st';
  else if(catName.includes('дизайн') && !catName.includes('ландшафт')) suggestedType = 'di';
  else suggestedType = 'ar';
  contractType = suggestedType;
  document.querySelectorAll('#contract-type .yn-btn').forEach(b=>b.classList.toggle('selected',b.dataset.value===contractType));

  document.getElementById('ct-object').value = p.address || p.name || '';
  resetContractPricing(p.area);
  document.getElementById('ct-price').value = p.price ?? '';
  if(p.start_date) document.getElementById('ct-start').value = p.start_date;
  if(p.end_date) document.getElementById('ct-end').value = p.end_date;
  if(p.phone) document.getElementById('ct-phone').value = p.phone;
  if(p.client_name && !p.contract_client_name) document.getElementById('ct-client-name').value = p.client_name;
  if(!p.contract_scope) fillContractDefaults();
  // Restore saved contract data for this project
  if(p.contract_client_name) document.getElementById('ct-client-name').value = p.contract_client_name;
  if(p.contract_passport) document.getElementById('ct-passport').value = p.contract_passport;
  if(p.contract_birthdate) document.getElementById('ct-birthdate').value = p.contract_birthdate;
  if(p.contract_passport_issuer) document.getElementById('ct-passport-issuer').value = p.contract_passport_issuer;
  if(p.contract_passport_date) document.getElementById('ct-passport-date').value = p.contract_passport_date;
  if(p.contract_address) document.getElementById('ct-address').value = p.contract_address;
  if(p.contract_scope) document.getElementById('ct-scope').value = p.contract_scope;
  if(p.contract_advance_pct) document.getElementById('ct-advance-pct').value = p.contract_advance_pct;
  if(p.contract_number) document.getElementById('ct-number').value = p.contract_number;
});

// Auto-save contract fields to project when user edits
let contractSaveTimer = null;
async function saveContractFields(){
  const projectId = document.getElementById('ct-project').value;
  if(!projectId) return;
  const fields = {
    contract_client_name: document.getElementById('ct-client-name').value,
    contract_passport: document.getElementById('ct-passport').value,
    contract_birthdate: document.getElementById('ct-birthdate').value,
    contract_passport_issuer: document.getElementById('ct-passport-issuer').value,
    contract_passport_date: document.getElementById('ct-passport-date').value,
    contract_address: document.getElementById('ct-address').value,
    contract_scope: document.getElementById('ct-scope').value,
    contract_advance_pct: document.getElementById('ct-advance-pct').value,
    contract_number: document.getElementById('ct-number').value,
  };
  if(document.getElementById('ct-customer-type').value==='legal'){
    for(const key of ['contract_client_name','contract_passport','contract_birthdate','contract_passport_issuer','contract_passport_date','contract_address']) delete fields[key];
  }
  await sb.from('projects').update(fields).eq('id', projectId);
}
function scheduleContractSave(){
  // Намеренно отключено: договор сохраняется только по явной кнопке «Сохранить договор».
  // Так пользователь не получает частично сохранённый документ после случайного выхода.
}

function numToWordsRub(n){
  return ctNumber(n) + ' руб.';
}

function exportContractToPdf(){
  if(!validateContractPricing()) return;
  const t = CONTRACT_TYPES[contractType];
  const c = state.companyInfo || {};

  const customer = contractCustomerSnapshot();
  const clientName = customer.client_name || '_____________________';
  const passport = document.getElementById('ct-passport').value.trim();
  const birthdate = document.getElementById('ct-birthdate').value;
  const passportIssuer = document.getElementById('ct-passport-issuer').value.trim();
  const passportDate = document.getElementById('ct-passport-date').value;
  const address = document.getElementById('ct-address').value.trim();
  const phone = document.getElementById('ct-phone').value.trim();

  const number = document.getElementById('ct-number').value.trim() || '____';
  const date = document.getElementById('ct-date').value || financeToday();
  const object = document.getElementById('ct-object').value.trim();
  const scope = document.getElementById('ct-scope').value.trim();
  const price = parseFloat(document.getElementById('ct-price').value) || 0;
  const advancePct = Number(document.getElementById('ct-advance-pct').value);
  const start = document.getElementById('ct-start').value;
  const end = document.getElementById('ct-end').value;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  registerPdfFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin*2;
  const BLUE = [69,134,236];
  let y = 0;

  // ---- Continuation header (drawn at top of every page after the first) ----
  function drawContinuationHeader(){
    const logoSize = 9;
    doc.addImage(ARHITTEK_LOGO_B64, 'PNG', margin, 10, logoSize, logoSize * (87/100));
    const textX = margin + logoSize + 3;
    doc.setFont('Roboto','bold'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text('ARHIT', textX, 16);
    const w = doc.getTextWidth('ARHIT');
    doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
    doc.text('TEK', textX + w, 16);
    doc.setTextColor(120); doc.setFont('Roboto','normal'); doc.setFontSize(8);
    doc.text('Договор № ' + number + ' от ' + (fmtDate(date) || 'дата'), pageWidth - margin, 14, {align:'right'});
    doc.setDrawColor(BLUE[0],BLUE[1],BLUE[2]); doc.setLineWidth(0.6);
    doc.line(margin, 19, pageWidth - margin, 19);
    doc.setLineWidth(0.2); doc.setDrawColor(0); doc.setTextColor(0);
  }

  function newPage(){
    doc.addPage();
    drawContinuationHeader();
    y = 27;
  }

  function addLine(text, opts={}){
    const bold = opts.bold || false;
    const size = opts.size || 10;
    const gap = opts.gap || 5;
    const indent = opts.indent || 0;
    const align = opts.align || 'left';
    doc.setFont('Roboto', bold?'bold':'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    lines.forEach(function(line){
      if(y > 280){ newPage(); }
      doc.text(line, margin + indent, y, {align: align});
      y += gap;
    });
  }
  function addSpacer(h){ y += (h || 3); }
  function checkPage(threshold){ if(y > (threshold || 270)){ newPage(); } }

  function sectionHeader(text){
    checkPage(265);
    doc.setFillColor(BLUE[0],BLUE[1],BLUE[2]);
    doc.rect(margin, y-4.5, contentWidth, 7.5, 'F');
    doc.setFont('Roboto','bold'); doc.setFontSize(11); doc.setTextColor(255);
    doc.text(text, margin+3, y);
    doc.setTextColor(0);
    y += 9;
  }

  // ============================================================
  // PAGE 1 — BRANDED HEADER
  // ============================================================
  const logoSize = 16;
  doc.addImage(ARHITTEK_LOGO_B64, 'PNG', margin, 14, logoSize, logoSize * (87/100));
  const textX = margin + logoSize + 4;
  doc.setFont('Roboto','bold'); doc.setFontSize(20); doc.setTextColor(0);
  doc.text('ARHIT', textX, 24);
  const arhitWidth = doc.getTextWidth('ARHIT');
  doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.text('TEK', textX + arhitWidth, 24);
  doc.setTextColor(120); doc.setFont('Roboto','normal'); doc.setFontSize(9);
  doc.text('Архитектурное проектирование · Дизайн интерьера · Строительство', textX, 30);

  // Thick blue accent line under header
  doc.setFillColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.rect(margin, 36, contentWidth, 1.2, 'F');

  // Title block — bordered box with contract number/date/type
  y = 46;
  doc.setDrawColor(220); doc.setFillColor(248,250,253);
  doc.roundedRect(margin, y, contentWidth, 22, 2, 2, 'FD');
  doc.setFont('Roboto','bold'); doc.setFontSize(15); doc.setTextColor(0);
  doc.text('ДОГОВОР № ' + number, margin + contentWidth/2, y + 9, {align:'center'});
  doc.setFont('Roboto','normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text('от ' + (fmtDate(date) || '____'), margin + contentWidth/2, y + 15, {align:'center'});
  doc.setFont('Roboto','bold'); doc.setFontSize(9); doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.text(t.label.toUpperCase(), margin + contentWidth/2, y + 20, {align:'center'});
  doc.setTextColor(0);
  y += 30;

  const companyShort = c.short_name || c.full_name || 'Исполнитель';
  const intro = companyShort + ', именуемое в дальнейшем «Исполнитель», в лице ' + (c.director || 'Генерального директора') + ', действующего на основании Устава, с одной стороны, и ' + contractCustomerIntro(customer) + ', именуемый(ая) в дальнейшем «Заказчик», с другой стороны, далее совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:';
  addLine(intro, {gap:5.5});
  addSpacer(3);

  // ============================================================
  // SECTIONS
  // ============================================================
  sectionHeader('1. ПРЕДМЕТ ДОГОВОРА');
  addLine('1.1. Исполнитель обязуется на основании Технического задания (ТЗ), предоставленного Заказчиком, выполнить ' + t.workName.toLowerCase() + ' (далее — «Работа»)' + (object ? ' по объекту: ' + object : '') + ', а Заказчик обязуется принять и оплатить Работу.', {gap:5.5});
  addLine('1.2. Работа включает в себя следующие разделы / этапы:', {gap:5.5});
  scope.split('\n').forEach(function(line){
    if(line.trim()) addLine(line.trim(), {indent:5, gap:5.5});
  });
  addLine('1.3. Техническое задание предоставляется Заказчиком после подписания настоящего Договора.', {gap:5.5});
  addLine('1.4. Передача и приём выполненных по настоящему Договору работ производится по Акту приёма-передачи выполненных работ.', {gap:5.5});
  addSpacer(3);

  sectionHeader('2. СТОИМОСТЬ РАБОТ И ПОРЯДОК ОПЛАТЫ');
  addLine('2.1. Стоимость работ по настоящему Договору составляет ' + numToWordsRub(price) + ', НДС не облагается в связи с применением Исполнителем упрощённой системы налогообложения.', {gap:5.5});
  contractPricingLines(contractPricingSnapshot()).forEach(line=>addLine(line,{gap:5.5}));
  addLine('2.2. Стоимость работ может быть увеличена при внесении изменений в Техническое задание Заказчиком.', {gap:5.5});
  addLine('2.3. Заказчик оплачивает Исполнителю аванс в размере ' + advancePct + '% от стоимости работ, указанной в п.2.1 настоящего Договора, перед началом выполнения работ. Оставшаяся сумма оплачивается после завершения работ согласно Акту приёма-передачи.', {gap:5.5});
  if(contractType === 'st'){
    addLine('2.4. Денежные средства, переданные Заказчиком на закупку строительных материалов, учитываются Исполнителем отдельно от стоимости работ по настоящему Договору и расходуются исключительно на нужды объекта Заказчика.', {gap:5.5});
  }
  addLine('2.5. Оплата производится в рублях РФ.', {gap:5.5});
  addSpacer(3);

  sectionHeader('3. ГРАФИК ВЫПОЛНЕНИЯ РАБОТ');
  addLine('3.1. Исполнитель приступает к выполнению работ' + (start ? ' с ' + fmtDate(start) : ' в течение 5 рабочих дней') + ' при условии оплаты Заказчиком авансового платежа.', {gap:5.5});
  addLine('3.2. Работы по Договору должны быть завершены ' + (end ? 'до ' + fmtDate(end) : 'в срок, согласованный Сторонами') + '. Срок может быть продлён при внесении изменений в ТЗ со стороны Заказчика.', {gap:5.5});
  addSpacer(3);

  sectionHeader('4. ОБЯЗАННОСТИ СТОРОН');
  addLine('4.1. Исполнитель обязан:', {bold:true, gap:6});
  addLine('4.1.1. Выполнить работы добросовестно и качественно в соответствии с ТЗ;', {indent:5, gap:5.5});
  addLine('4.1.2. В ходе выполнения работ согласовывать с Заказчиком принимаемые решения и учитывать его мнение;', {indent:5, gap:5.5});
  addLine('4.1.3. Передать Заказчику результаты работы в электронном виде (PDF); по завершении работ направить Заказчику на подпись Акт выполненных работ;', {indent:5, gap:5.5});
  addLine('4.1.4. Оказывать Заказчику консультации по вопросам, касающимся предмета настоящего Договора;', {indent:5, gap:5.5});
  addLine('4.1.5. Не передавать результаты работы по настоящему Договору третьим лицам без согласия Заказчика.', {indent:5, gap:5.5});
  addSpacer(2);
  addLine('4.2. Заказчик обязан:', {bold:true, gap:6});
  addLine('4.2.1. Передать Исполнителю Техническое задание и иную документацию, необходимую для выполнения работ;', {indent:5, gap:5.5});
  addLine('4.2.2. Оплатить Исполнителю стоимость работ на условиях настоящего Договора;', {indent:5, gap:5.5});
  addLine('4.2.3. Оказывать Исполнителю содействие, отвечать на запросы Исполнителя в срок не более 2 рабочих дней;', {indent:5, gap:5.5});
  addLine('4.2.4. В течение 3 календарных дней с момента получения Акта подписать и направить его Исполнителю либо направить мотивированные возражения. Если в указанный срок Заказчик не подпишет Акт и не направит возражений, Акт считается принятым в редакции Исполнителя.', {indent:5, gap:5.5});
  addSpacer(3);

  sectionHeader('5. ОТВЕТСТВЕННОСТЬ СТОРОН');
  addLine('5.1. Стороны несут ответственность по настоящему Договору в пределах, предусмотренных законодательством РФ.', {gap:5.5});
  addSpacer(3);

  sectionHeader('6. ОБСТОЯТЕЛЬСТВА НЕПРЕОДОЛИМОЙ СИЛЫ');
  addLine('6.1. Стороны освобождаются от ответственности за частичное или полное неисполнение обязательств по настоящему Договору, если оно явилось следствием обстоятельств непреодолимой силы.', {gap:5.5});
  addSpacer(3);

  sectionHeader('7. ПОРЯДОК РАЗРЕШЕНИЯ СПОРОВ');
  addLine('7.1. Все споры и разногласия по настоящему Договору решаются Сторонами путём переговоров. При недостижении согласия споры рассматриваются в порядке, предусмотренном законодательством РФ.', {gap:5.5});
  addSpacer(3);

  sectionHeader('8. ПРОЧИЕ УСЛОВИЯ');
  addLine('8.1. Настоящий Договор вступает в силу с момента подписания и действует до полного исполнения Сторонами своих обязательств.', {gap:5.5});
  addLine('8.2. При изменении реквизитов, адресов или контактных данных Сторона обязана в течение 3 дней письменно известить об этом другую Сторону.', {gap:5.5});
  addLine('8.3. Все изменения и дополнения к настоящему Договору действительны при условии письменной формы и подписания Сторонами.', {gap:5.5});
  addLine('8.4. При досрочном расторжении Договора по инициативе Заказчика, Заказчику возвращаются уплаченные суммы за исключением стоимости фактически выполненных Исполнителем работ.', {gap:5.5});
  addLine('8.5. Исполнитель может использовать результаты Работы в рекламных целях по своему усмотрению при условии сохранения конфиденциальности персональных данных Заказчика.', {gap:5.5});
  addLine('8.6. Стороны признают переписку по электронной почте, указанной в настоящем Договоре, официальной корреспонденцией, имеющей доказательственную силу.', {gap:5.5});
  addSpacer(3);

  // ============================================================
  // 9. REQUISITES — two-column card layout
  // ============================================================
  sectionHeader('9. АДРЕСА И РЕКВИЗИТЫ СТОРОН');

  const colGap = 6;
  const colWidth = (contentWidth - colGap) / 2;
  const boxTopY = y;
  const customerLines = contractCustomerLines(customer);

  const executorLines = [];
  if(c.full_name) executorLines.push(c.full_name);
  if(c.inn) executorLines.push('ИНН ' + c.inn + (c.kpp ? ', КПП ' + c.kpp : ''));
  if(c.ogrn) executorLines.push('ОГРН ' + c.ogrn);
  if(companyDocumentAddress()) executorLines.push('Юр. адрес: ' + companyDocumentAddress());
  if(c.bank_name) executorLines.push('Банк: ' + c.bank_name);
  if(c.bank_account) executorLines.push('Р/с: ' + c.bank_account);
  if(c.bik) executorLines.push('БИК: ' + c.bik + (c.corr_account ? ', К/с: ' + c.corr_account : ''));
  if(c.phone) executorLines.push('Тел.: ' + c.phone);
  if(c.director) executorLines.push('Ген. директор: ' + c.director);

  // Measure heights first (without drawing) to size the boxes equally
  function measureLines(lines, width){
    let h = 8; // top padding + title
    doc.setFont('Roboto','normal'); doc.setFontSize(9);
    lines.forEach(line=>{
      const wrapped = doc.splitTextToSize(line, width - 6);
      h += wrapped.length * 4.6;
    });
    return h + 10;
  }
  const custH = measureLines(customerLines, colWidth);
  const execH = measureLines(executorLines, colWidth);
  const boxH = Math.max(custH, execH, 26);

  if(y + boxH > 285){ newPage(); }
  const finalBoxTopY = y;

  function drawPartyBox(title, lines, x){
    doc.setDrawColor(225); doc.setFillColor(250,251,253);
    doc.roundedRect(x, finalBoxTopY, colWidth, boxH, 2, 2, 'FD');
    let ly = finalBoxTopY + 7;
    doc.setFont('Roboto','bold'); doc.setFontSize(10); doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
    doc.text(title, x + 4, ly);
    doc.setTextColor(0);
    ly += 6;
    doc.setFont('Roboto','normal'); doc.setFontSize(9);
    lines.forEach((line, i)=>{
      const wrapped = doc.splitTextToSize(line, colWidth - 6);
      wrapped.forEach((wl, wi)=>{
        if(i===0 && wi===0) doc.setFont('Roboto','bold'); else doc.setFont('Roboto','normal');
        doc.text(wl, x + 4, ly);
        ly += 4.6;
      });
    });
  }

  if(boxH>230){
    addLine('ЗАКАЗЧИК',{bold:true});customerLines.forEach(line=>addLine(line));
    addSpacer(4);addLine('ИСПОЛНИТЕЛЬ',{bold:true});executorLines.forEach(line=>addLine(line));
    addSpacer(14);
  }else{
    drawPartyBox('ЗАКАЗЧИК', customerLines, margin);
    drawPartyBox('ИСПОЛНИТЕЛЬ', executorLines, margin + colWidth + colGap);
    y = finalBoxTopY + boxH + 14;
  }
  checkPage(265);

  // Signatures
  doc.setDrawColor(0);
  doc.line(margin, y, margin + 70, y);
  doc.line(margin + colWidth + colGap, y, margin + colWidth + colGap + 70, y);
  y += 5;
  doc.setFont('Roboto','normal'); doc.setFontSize(9);
  const signatureName=customer.customer_type==='legal'?(customer.legal_entity.representative||'____________'):clientName;
  const signatureLines=doc.splitTextToSize('Заказчик / '+signatureName,colWidth);
  if(y+signatureLines.length*4>pageHeight-22){newPage();}
  doc.text(signatureLines, margin, y);
  doc.text('Исполнитель / ' + (c.director || '____________'), margin + colWidth + colGap, y);

  // ============================================================
  // FOOTER on every page
  // ============================================================
  const totalPages = doc.internal.getNumberOfPages();
  for(let i=1; i<=totalPages; i++){
    doc.setPage(i);
    doc.setDrawColor(230); doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
    doc.setFont('Roboto','normal'); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text('ARHITTEK — архитектурное проектирование, дизайн интерьера, ремонт под ключ', margin, pageHeight - 14);
    pdfCompanyAddress(doc, margin, pageHeight - 6, 35);
    doc.text('Стр. ' + i + ' из ' + totalPages, pageWidth - margin, pageHeight - 6, {align:'right'});
    doc.setTextColor(0);
  }

  const fileName = 'Dogovor-' + t.label.replace(/[^a-zA-Zа-яА-Я0-9]/g,'_') + '-' + (clientName||'klient').replace(/[^a-zA-Zа-яА-Я0-9]/g,'_').slice(0,30) + '-' + date + '.pdf';
  doc.save(fileName);
  showToast('Договор скачивается...');
}


document.getElementById('openContractsBtn').addEventListener('click', openContractsView);
document.getElementById('contractsBack').addEventListener('click', function(){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('view-more').classList.add('active');
  document.querySelector('.nav-btn[data-view="view-more"]').classList.add('active');
  window.scrollTo(0,0);
});
document.getElementById('ct-export-pdf').addEventListener('click', exportContractToPdf);


