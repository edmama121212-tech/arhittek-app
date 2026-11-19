/* Complete, consistently ordered reads. Never return a partial dataset as success. */
(() => {
  'use strict';
  async function fetchAllRows(createQuery, options = {}) {
    const pageSize = options.pageSize || 500;
    const maxRows = options.maxRows ?? Infinity;
    const rows = [], seen = new Set();
    let offset = 0, expectedCount = null;
    try {
      while (offset < maxRows) {
        const size = Math.min(pageSize, maxRows - offset);
        const result = await createQuery().order('id', {ascending: true}).range(offset, offset + size - 1);
        if (result.error) return {data: null, error: result.error};
        if (!Array.isArray(result.data)) throw new Error('Не удалось получить полный список записей');
        if (Number.isInteger(result.count)) {
          if (expectedCount !== null && expectedCount !== result.count) {
            throw new Error('Список изменился во время загрузки. Обновите данные ещё раз.');
          }
          expectedCount = result.count;
        }
        for (const row of result.data) {
          if (row.id != null) {
            if (seen.has(row.id)) throw new Error('Записи изменились во время загрузки. Обновите данные ещё раз.');
            seen.add(row.id);
          }
          rows.push(row);
        }
        offset += result.data.length;
        if (expectedCount !== null && offset >= expectedCount) break;
        if (!result.data.length) {
          if (expectedCount !== null && offset < expectedCount) throw new Error('Получена только часть записей. Повторите загрузку.');
          break;
        }
        if (expectedCount === null && result.data.length < size) break;
      }
      return {data: rows, error: null, count: expectedCount, truncated: expectedCount !== null && rows.length < expectedCount};
    } catch (error) {
      return {data: null, error};
    }
  }
  window.ARHITTEKData = {fetchAllRows};
  window.fetchAllRows = fetchAllRows;
})();
// Share the named PDF attachment. iOS may require a fresh tap after generation.
async function deliverDocumentPdf(doc,name){
  if(typeof navigator.canShare!=='function'||typeof navigator.share!=='function'){
    doc.save(name);
    return;
  }
  const file=new File([doc.output('blob')],name,{type:'application/pdf'});
  const attachment={files:[file]};
  if(!navigator.canShare(attachment)){doc.save(name);return;}
  try{await navigator.share(attachment);return;}
  catch(error){if(error.name==='AbortError')return;}
  const dialog=document.createElement('dialog');
  dialog.style.cssText='max-width:90vw;padding:20px;border:0;border-radius:16px';
  const label=document.createElement('p');
  label.textContent=file.name;
  const close=document.createElement('button');
  close.textContent='Закрыть';
  close.onclick=()=>dialog.close();
  const send=document.createElement('button');
  send.className='btn btn-primary';
  send.textContent='Отправить PDF';
  send.onclick=async()=>{
    try{await navigator.share(attachment);dialog.close();}
    catch(error){if(error.name!=='AbortError')label.textContent='Отправка недоступна. Можно сохранить PDF в файлы.';}
  };
  const save=document.createElement('button');
  save.textContent='Сохранить файл';
  save.onclick=()=>{doc.save(name);dialog.close();};
  dialog.append(label,send,save,close);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);dialog.showModal();
}
