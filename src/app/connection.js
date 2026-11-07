// ============================================================
// SUPABASE CONNECTION
// ============================================================
const SUPABASE_URL = 'https://chbkkoxwzpaghanofvqk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_fOLaPnbXjzQnJwG__wVzzg_D0nMO-n0';
function createAppClient(token){
  return supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{
    headers:token?{'x-session-token':token,'x-finance-client':'1'}:{},
    fetch:(input,options)=>ARHITTEKJournal.safeFetch(input,options)
  }});
}
let sb = createAppClient(null);
    window.sb = sb;

// После входа сервер выдаёт токен сессии — пересобираем клиент так, чтобы
// каждый запрос нёс его заголовком x-session-token. Без этого заголовка
// доступ к данным (кроме заведомо публичных, вроде каталога) закрыт политиками RLS.
function applySessionToken(token){
  sb = createAppClient(token);
  window.sb = sb;
}

