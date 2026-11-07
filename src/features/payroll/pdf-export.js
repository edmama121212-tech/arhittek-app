// ============================================================
// ТАБЕЛЬ КАК ОТДЕЛЬНЫЙ ДОКУМЕНТ — PDF на одного сотрудника за один месяц
// ============================================================
function exportTimesheetToPdf(employeeId, monthStr){
  if(!session||(!session.isAdmin&&session.employeeId!==employeeId)){showToast('Нет доступа к табелю сотрудника');return;}
  if(!state.salaryHistory){showToast('История окладов недоступна. Обновите данные.');return;}
  const emp = payrollEmployee(employeeId);
  if(!emp){ showToast('Сотрудник не найден'); return; }
  const {from, to} = timesheetMonthRange(monthStr);
  const {employees: earnedMap} = completedProjectEarningsForRange(from, to);
  const {result: payrollByEmp} = splitPayrollByEmployee(earnedMap);
  const e = earnedMap[employeeId];
  const p = payrollByEmp[employeeId] || {earned:0, payout:0, retained:0, isSalaried:false, salary:0};
  const items = e ? e.items : [];
  const paid = isTimesheetPaid(employeeId, monthStr);
  const payState = (typeof salaryPaymentState==='function') ? salaryPaymentState(employeeId, monthStr, p.payout) : {paid:paid?p.payout:0,remaining:paid?0:p.payout,overdue:false};
  const c = state.companyInfo || {};

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  registerPdfFonts(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin*2;
  const BLUE = [69,134,236];
  let y = 15;

  function newPage(){ doc.addPage(); y = 24; }

  // ---- Брендированная шапка ----
  const logoSize = 14;
  doc.addImage(ARHITTEK_LOGO_B64, 'PNG', margin, 12, logoSize, logoSize*(87/100));
  doc.setFont('Roboto','bold'); doc.setFontSize(17); doc.setTextColor(0);
  doc.text('ARHIT', margin+logoSize+4, 21);
  const arhitW = doc.getTextWidth('ARHIT');
  doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.text('TEK', margin+logoSize+4+arhitW, 21);
  doc.setTextColor(120); doc.setFont('Roboto','normal'); doc.setFontSize(8);
  doc.text(c.short_name || c.full_name || '', pageWidth-margin, 15, {align:'right'});
  doc.setDrawColor(BLUE[0],BLUE[1],BLUE[2]); doc.setLineWidth(0.6);
  doc.line(margin, 28, pageWidth-margin, 28);
  doc.setLineWidth(0.2); doc.setDrawColor(0); doc.setTextColor(0);
  y = 38;

  doc.setFont('Roboto','bold'); doc.setFontSize(15);
  doc.text('ТАБЕЛЬ НАЧИСЛЕНИЙ', margin, y);
  y += 8;
  doc.setFont('Roboto','normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text('за ' + ruMonthLabel(monthStr), margin, y);
  doc.setTextColor(0);
  y += 10;

  doc.setFont('Roboto','bold'); doc.setFontSize(11);
  doc.text('Сотрудник: ' + (emp.name||''), margin, y); y += 6;
  doc.setFont('Roboto','normal'); doc.setFontSize(10);
  if(emp.role){ doc.text('Должность: ' + emp.role, margin, y); y += 6; }
  if(p.isSalaried){ doc.text('Фиксированный оклад: ' + fmtMoney(p.salary), margin, y); y += 6; }
  if(salaryDetailsForRange(emp,from,to).uncertain){
    const note=doc.splitTextToSize('История до установки восстановлена по начальной записи и доступному журналу. Проверьте старые начисления.',contentWidth);
    doc.setFontSize(8);doc.text(note,margin,y);y+=4*note.length;doc.setFontSize(10);
  }
  y += 4;

  // ---- Таблица начислений ----
  doc.setFillColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.rect(margin, y-4.5, contentWidth, 7.5, 'F');
  doc.setFont('Roboto','bold'); doc.setFontSize(9); doc.setTextColor(255);
  doc.text('Проект / начисление', margin+3, y);
  doc.text('Сумма, ₽', margin+contentWidth-3, y, {align:'right'});
  doc.setTextColor(0);
  y += 8;

  doc.setFont('Roboto','normal'); doc.setFontSize(9.5);
  if(!items.length){
    doc.setTextColor(140);
    doc.text('Нет начислений за этот месяц', margin+3, y);
    doc.setTextColor(0);
    y += 7;
  } else {
    items.forEach((it, i)=>{
      if(y > 265){ newPage(); }
      if(i%2===1){ doc.setFillColor(246,248,251); doc.rect(margin, y-4.5, contentWidth, 7, 'F'); }
      const label = (it.role==='соисполнитель'?'(соисп.) ':'') + (it.name||'');
      const lines = doc.splitTextToSize(label, contentWidth-40);
      doc.text(lines, margin+3, y);
      doc.text(fmtMoney(it.amount), margin+contentWidth-3, y, {align:'right'});
      y += 7*Math.max(1,lines.length);
    });
  }

  y += 3;
  if(y > 265) newPage();
  doc.setDrawColor(200); doc.line(margin, y, margin+contentWidth, y); y += 7;

  doc.setFont('Roboto','bold'); doc.setFontSize(11);
  doc.text('Заработано за месяц:', margin, y);
  doc.text(fmtMoney(p.earned), margin+contentWidth, y, {align:'right'});
  y += 7;
  if(p.isSalaried && p.retained > 0){
    doc.setFont('Roboto','normal'); doc.setFontSize(9.5); doc.setTextColor(90);
    doc.text('осталось в прибыли компании (сверх оклада):', margin, y);
    doc.text(fmtMoney(p.retained), margin+contentWidth, y, {align:'right'});
    doc.setTextColor(0);
    y += 7;
  }
  y += 3;
  doc.setFont('Roboto','bold'); doc.setFontSize(13); doc.setTextColor(BLUE[0],BLUE[1],BLUE[2]);
  doc.text('К ВЫПЛАТЕ: ' + fmtMoney(p.payout), margin, y);
  doc.setTextColor(0);
  y += 7;
  doc.setFont('Roboto','normal'); doc.setFontSize(9.5);
  doc.setTextColor(payState.remaining<=0 ? 46 : payState.overdue ? 192 : 180, payState.remaining<=0 ? 125 : payState.overdue ? 82 : 125, payState.remaining<=0 ? 91 : 47);
  doc.text('Выплачено: ' + fmtMoney(payState.paid) + ' · Осталось: ' + fmtMoney(payState.remaining) + (payState.overdue ? ' · ПРОСРОЧЕНО' : ''), margin, y);
  doc.setTextColor(0);

  y += 20;
  if(y > 270) newPage();
  doc.setFont('Roboto','normal'); doc.setFontSize(9.5);
  doc.text('Составил: _________________________', margin, y);
  doc.text('Дата: __________', margin+contentWidth-45, y);
  y += 14;
  doc.text('Подпись сотрудника: _________________________', margin, y);

  doc.save('Табель — ' + (emp.name||'сотрудник') + ' — ' + monthStr + '.pdf');
}
