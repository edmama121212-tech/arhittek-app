// Private family tree launch: exercise the real session verifier without real credentials.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('src/features/access/session.js','utf8');
const shell='<html data-access="locked"><body><div class="view active" id="view-more"><button id="openFamilyTreeBtn"></button></div><div class="view" id="view-overview"></div><div class="view" id="view-projects"></div></body></html>';
function fixture({owner=true,verified=true,employee='owner',responseOwner=owner,error=false,policy='owner-only-v1',delayed=false}={}){
 const dom=new JSDOM(shell);const redirects=[],toasts=[],calls=[];let release;
 const context={document:dom.window.document,window:{location:{assign:url=>redirects.push(url)}},state:{trash:{}},Set,Date,console,
  canSeeProjects:()=>true,canSeeConstruction:()=>true,showToast:msg=>toasts.push(msg),
  sb:{rpc:async(name,args)=>{calls.push({name,args});if(delayed)await new Promise(r=>release=r);return error?{error:{message:'Unavailable'},data:null}:{error:null,data:[{employee_id:employee,name:'Мансур',role:'Генеральный директор',is_owner:responseOwner,can_documents:false,access_policy:policy}]}}}};
 vm.createContext(context);vm.runInContext(source,context);
 vm.runInContext(`session={employeeId:${JSON.stringify(employee)},name:'Мансур',isAdmin:true,token:'isolated-session'};verifiedAccess=${verified?`{employeeId:${JSON.stringify(employee)},token:'isolated-session',owner:${owner},documents:false}`:'null'};applyAccessVisibility();`,context);
 return {dom,context,redirects,toasts,calls,run:()=>vm.runInContext('openFamilyTree()',context),release:()=>release(),owner:()=>vm.runInContext('isOwner()',context),button:dom.window.document.getElementById('openFamilyTreeBtn')};
}
(async()=>{
 let count=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);count++};
 const allowed=fixture();check(allowed.button.style.display,'');check(await allowed.run(),true);check(allowed.calls.length,1);check(allowed.calls[0].name,'get_employee_access');
 check(allowed.redirects,['https://zhoba-family-tree.edmama121212.chatgpt.site/']);
 check(new URL(allowed.redirects[0]).search,'');check(allowed.button.disabled,false);
 for(const args of [{owner:false,employee:'staff'},{owner:false,employee:'other-admin'},{verified:false}]){
  const denied=fixture(args);check(denied.button.style.display,'none');check(await denied.run(),false);check(denied.redirects,[]);check(denied.calls,[]);
 }
 for(const args of [{responseOwner:false},{error:true},{policy:'untrusted-policy'}]){
  const denied=fixture(args);check(await denied.run(),false);check(denied.redirects,[]);check(denied.owner(),false);check(denied.button.style.display,'none');check(denied.button.disabled,false);
 }
 const pending=fixture({delayed:true});const first=pending.run();check(pending.button.disabled,true);check(await pending.run(),false);check(pending.calls.length,1);pending.release();check(await first,true);check(pending.redirects.length,1);
 const switched=fixture({delayed:true});const opening=switched.run();vm.runInContext("session={employeeId:'staff',token:'another-session',isAdmin:true,name:'Мансур'};verifiedAccess={employeeId:'staff',token:'another-session',owner:false,documents:false};",switched.context);switched.release();check(await opening,false);check(switched.redirects,[]);check(switched.owner(),false);
 const css=fs.readFileSync('src/app/shell/head-close.html','utf8');assert(css.includes('html:not([data-access="owner"]) #openFamilyTreeBtn'));count++;
 const employeeGuard=fs.readFileSync('employee-access.js','utf8');assert(employeeGuard.includes("openFamilyTreeBtn:'view-family-tree'"));count++;
 const html=fs.readFileSync('index.html','utf8');check((html.match(/id="openFamilyTreeBtn"/g)||[]).length,1);
 assert(!html.includes('Цумхьажи')&&!html.includes('Сайдмахмад'));count++;
 check(vm.runInContext('canAccessView("view-family-tree")',fixture({owner:false}).context),false);
 console.log(count+' family tree access checks passed (owner, forged flags, stale/failed access, account switch, duplicate click, URL, private source separation)');
})().catch(error=>{console.error(error);process.exitCode=1});
