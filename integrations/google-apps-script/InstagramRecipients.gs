/**
 * @OnlyCurrentDoc
 * ARHITTEK — самостоятельная синхронизация получателей ссылок Instagram.
 * Привязать к таблице «ARHITTEK — Получатели каталога Instagram».
 * Только Google OIDC (краткоживущий токен), без ключей Meta/Supabase в коде.
 */
const ARHITTEK_SYNC_CONFIG = Object.freeze({
  spreadsheetId: '1ZtoRdi5O9coUHX2sR9zh4WsdBOC8exY6qUIsbEW9c-o',
  sheetName: 'Получили ссылку',
  instagramAccountId: '17841422845904072',
  endpoint: 'https://chbkkoxwzpaghanofvqk.supabase.co/functions/v1/instagram-recipients-export',
});

/** Выполнить ОДИН раз владельцу таблицы, подтвердить права Google. */
function installInstagramRecipientSync() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== ARHITTEK_SYNC_CONFIG.spreadsheetId) {
    throw new Error('Откройте Apps Script именно из таблицы ARHITTEK — Получатели каталога Instagram.');
  }
  const token = ScriptApp.getIdentityToken();
  if (!token) throw new Error('Добавьте scope openid в appsscript.json и пройдите авторизацию.');
  // A failed first export must not create a silently broken background trigger.
  syncInstagramRecipients();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncInstagramRecipients')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncInstagramRecipients').timeBased().everyMinutes(5).create();
}

/** Запускается Google, без ChatGPT. Повторный запуск безопасен (дедупликация). */
function syncInstagramRecipients() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  try {
    const file = SpreadsheetApp.getActiveSpreadsheet();
    if (!file || file.getId() !== ARHITTEK_SYNC_CONFIG.spreadsheetId)
      throw new Error('Некорректная таблица получателей ARHITTEK');
    const sheet = file.getSheetByName(ARHITTEK_SYNC_CONFIG.sheetName);
    if (!sheet) throw new Error('Не найдена вкладка «Получили ссылку»');

    const token = ScriptApp.getIdentityToken();
    if (!token) throw new Error('Требуется авторизация Google OIDC');
    const response = UrlFetchApp.fetch(ARHITTEK_SYNC_CONFIG.endpoint, {
      method: 'get',
      headers: {'Authorization': 'Bearer ' + token},
      followRedirects: false,
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200)
      throw new Error('Supabase не подтвердил доступ или источник недоступен (HTTP ' + response.getResponseCode() + ')');

    const result = JSON.parse(response.getContentText());
    if (!result || !Array.isArray(result.rows)) throw new Error('Неверный формат ответа Supabase');

    const headers = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0].map(x => String(x).trim());
    const needed = [
      'Дата отправки (UTC)', 'Instagram клиента', 'ID комментария', 'Доставка',
      'Создание ссылки (UTC)', 'Действует до (UTC)', 'Аккаунт ARHITTEK', 'Что написал'
    ];
    if (headers.some((header,index) => header !== needed[index]))
      throw new Error('Колонки таблицы отличаются от утверждённой структуры A:H, исправления не внесены');

    const seen = new Map();
    const count = Math.max(0, sheet.getLastRow() - 1);
    if (count) {
      const ids = sheet.getRange(2, 3, count, 1).getDisplayValues();
      for (let i = 0; i < ids.length; ++i) {
        const id = String(ids[i][0] || '').trim();
        if (id && !seen.has(id)) seen.set(id, i + 2);
      }
    }

    const incoming = new Map();
    for (const row of result.rows) {
      if (!row || String(row.account_id) !== ARHITTEK_SYNC_CONFIG.instagramAccountId) continue;
      const id = String(row.comment_id || '').trim();
      if (!/^\d{1,100}$/.test(id)) continue;
      // The export's protected SQL contains only successful sends with Meta message_id.
      if (!row.sent_at) continue;
      incoming.set(id, row);
    }

    const additions = [];
    for (const [id, row] of incoming) {
      const username = /^@?[A-Za-z0-9._]{1,30}$/.test(String(row.username || ''))
        ? '@' + String(row.username).replace(/^@/, '') : '';
      const text = safeSheetText(row.comment_text);
      if (seen.has(id)) {
        const targetRow = seen.get(id);
        // Enrich existing rows without changing manually added information.
        if (username && !sheet.getRange(targetRow, 2).getDisplayValue().trim()) {
          const cell = sheet.getRange(targetRow, 2);
          cell.setNumberFormat('@');
          cell.setValue(username);
        }
        if (text && !sheet.getRange(targetRow, 8).getDisplayValue().trim()) {
          const cell = sheet.getRange(targetRow, 8);
          cell.setNumberFormat('@');
          cell.setValue(text);
        }
        continue;
      }
      additions.push([
        utc(row.sent_at), username, id, 'Отправлено',
        utc(row.link_created_at), utc(row.expires_at), '@arhittek.plans', text,
      ]);
      seen.set(id, count + additions.length + 1);
    }
    if (additions.length) {
      const target = sheet.getRange(sheet.getLastRow() + 1, 1, additions.length, 8);
      // Prevent long comment IDs from being rounded as floating-point numbers.
      target.setNumberFormat('@');
      target.setValues(additions);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}
function utc(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? Utilities.formatDate(date, 'Etc/UTC', 'yyyy-MM-dd HH:mm:ss') : '';
}
function safeSheetText(value) {
  let text = String(value || '').slice(0, 500);
  // Google Sheets may treat an untrusted comment starting with = as a formula.
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return text;
}
