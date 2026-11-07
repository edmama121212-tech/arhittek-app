// ============================================================
// INIT
// ============================================================
document.getElementById('loginSubmitBtn').addEventListener('click', attemptLogin);
document.getElementById('loginPin').addEventListener('input', (e)=>{
  e.target.value = e.target.value.replace(/\D/g,'').slice(0,6);
});
document.getElementById('loginPin').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') attemptLogin();
});
document.getElementById('loginBackBtn').addEventListener('click', ()=>{
  loginSelectedEmployee = null;
  document.getElementById('loginStep1').style.display = '';
  document.getElementById('loginStep2').style.display = 'none';
});
document.getElementById('userPill').addEventListener('click', ()=>{
  if(confirm('Выйти из аккаунта?')) clearSession();
});


