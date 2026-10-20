// Exercise the real background-sync functions without a browser or network.
// A joined WebSocket can remain silent after HTTP-header session RLS is enabled.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const begin=html.indexOf('let realtimeChannel = null;');
const end=html.indexOf('// Запускаем realtime после первой загрузки данных',begin);
assert(begin>=0&&end>begin,'Cannot find the application realtime/polling section');
const source=html.slice(begin,end),results=[];

function app(){
 const dom=new JSDOM('<!doctype html><body><main class="view active"></main></body>',{url:'https://app.test/',pretendToBeVisual:true});
 const timers=new Map(),timeouts=new Map(),channels=[],removed=[],reads=[];
 let counter=0;
 const s={console,document:dom.window.document,navigator:{onLine:true},
  session:{employeeId:'foreman',token:'isolated-http-session'},
  state:{financialDataReady:true,financialDataError:null,stageDataError:null,projectMembersDataError:null},
  loadAllInFlight:false,pendingStageChanges:new Map(),
  getComputedStyle:dom.window.getComputedStyle.bind(dom.window),
  loadAll:async()=>{reads.push({token:s.session?.token});return true;},
  setSyncStatus:()=>{},showToast:()=>{},scheduleStageReload:()=>{},
  setInterval:(fn,delay)=>{const id=++counter;timers.set(id,{fn,delay});return id;},
  clearInterval:id=>timers.delete(id),
  setTimeout:(fn,delay)=>{const id=++counter;timeouts.set(id,{fn,delay});return id;},
  clearTimeout:id=>timeouts.delete(id),
  sb:{removeChannel:channel=>removed.push(channel),channel:name=>{
   const channel={name,state:'joined',handlers:[],on(kind,filter,fn){channel.handlers.push({kind,filter,fn});return channel;},subscribe(fn){channel.status=fn;return channel;}};
   channels.push(channel);return channel;
  }}
 };
 const context=vm.createContext(s);vm.runInContext(source,context,{filename:'index.html:realtime'});
 const start=()=>vm.runInContext('startPollingFallback()',context);
 const setup=()=>vm.runInContext('setupRealtime()',context);
 const tick=async()=>{for(const {fn}of [...timers.values()])fn();await Promise.resolve();};
 const element=(tag='input',attrs={})=>{const el=s.document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));s.document.body.append(el);return el;};
 const overlay=(attrs={})=>{const el=element('div',attrs);el.style.display='block';el.getClientRects=()=>[{}];return el;};
 return{dom,s,timers,timeouts,channels,removed,reads,start,setup,tick,element,overlay,close:()=>dom.window.close()};
}
async function check(name,fn){const a=app();try{await fn(a);results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}finally{a.close();}}
async function skipped(a){a.setup();await a.tick();assert.equal(a.reads.length,0);assert.equal(a.timers.size,1,'A skipped tick must retain the next background refresh');}

(async()=>{
 await check('A joined realtime connection still refreshes through the HTTP session every20seconds',async a=>{
  a.setup();assert.equal(a.channels[0].state,'joined');assert.equal(a.timers.size,1);assert.equal([...a.timers.values()][0].delay,20000);
  await a.tick();await a.tick();assert.equal(a.reads.length,2);assert(a.reads.every(read=>read.token==='isolated-http-session'));assert.equal(a.timers.size,1);
 });
 await check('setupRealtime starts polling even when no realtime error is reported',async a=>{a.setup();assert.equal(a.timers.size,1);assert.equal(a.channels.length,1);await a.tick();assert.equal(a.reads.length,1);});
 await check('Repeated setup replaces its channel and retains only one polling interval',async a=>{a.setup();a.setup();a.start();assert.equal(a.channels.length,2);assert.equal(a.removed[0],a.channels[0]);assert.equal(a.timers.size,1);await a.tick();assert.equal(a.reads.length,1);});
 await check('An unsubscribed realtime channel does not stop HTTP refresh',async a=>{a.setup();a.channels[0].state='errored';await a.tick();assert.equal(a.reads.length,1);});
 await check('A realtime error reuses the polling interval rather than multiplying requests',async a=>{a.setup();a.channels[0].status('CHANNEL_ERROR');a.channels[0].status('TIMED_OUT');assert.equal(a.timers.size,1);await a.tick();assert.equal(a.reads.length,1);});
 await check('A hidden page skips background reads',async a=>{Object.defineProperty(a.s.document,'visibilityState',{value:'hidden',configurable:true});await skipped(a);});
 await check('An offline page skips background reads',async a=>{a.s.navigator.onLine=false;await skipped(a);});
 await check('No session skips an existing polling tick',async a=>{a.start();a.s.session=null;await a.tick();assert.equal(a.reads.length,0);});
 await check('A session without its HTTP token skips an existing polling tick',async a=>{a.start();a.s.session={employeeId:'foreman'};await a.tick();assert.equal(a.reads.length,0);});
 await check('Logged-out realtime setup creates no channel or interval',async a=>{a.s.session=null;a.setup();assert.equal(a.channels.length,0);assert.equal(a.timers.size,0);assert.equal(a.reads.length,0);});
 await check('Logout after a successful background read prevents all later polling reads',async a=>{a.setup();await a.tick();a.s.session=null;await a.tick();await a.tick();assert.equal(a.reads.length,1);});
 await check('A page resuming a new session uses that session rather than a captured old token',async a=>{a.setup();await a.tick();a.s.session={employeeId:'new-foreman',token:'next-http-session'};await a.tick();assert.deepEqual(a.reads.map(read=>read.token),['isolated-http-session','next-http-session']);});
 await check('A running load blocks overlapping background loads',async a=>{a.s.loadAllInFlight=true;await skipped(a);a.s.loadAllInFlight=false;await a.tick();assert.equal(a.reads.length,1);});
 await check('An optimistic stage change is not overwritten by polling',async a=>{a.s.pendingStageChanges.set('stage-a',{done:true});await skipped(a);a.s.pendingStageChanges.clear();await a.tick();assert.equal(a.reads.length,1);});
 await check('An active dirty view keeps its draft through a polling tick',async a=>{a.s.document.querySelector('.view.active').dataset.dirty='1';await skipped(a);});
 await check('An inactive dirty view does not block the currently active clean view',async a=>{a.element('section',{class:'view','data-dirty':'1'});a.setup();await a.tick();assert.equal(a.reads.length,1);});
 for(const tag of ['input','textarea','select'])await check('A focused '+tag+' defers background refresh',async a=>{a.element(tag).focus();assert.equal(a.s.document.activeElement.tagName,tag.toUpperCase());await skipped(a);});
 await check('A focused contenteditable region defers background refresh',async a=>{const el=a.element('div',{contenteditable:'true',tabindex:'0'});el.focus();assert.equal(a.s.document.activeElement,el);await skipped(a);});
 await check('A focused ordinary button does not prevent clean-view synchronization',async a=>{a.element('button').focus();a.setup();await a.tick();assert.equal(a.reads.length,1);});
 for(const [label,attrs]of [['sheet',{class:'sheet-overlay'}],['modal',{class:'modal'}],['modal overlay',{class:'modal-overlay'}],['overlay',{class:'overlay'}],['named Overlay',{id:'invoiceSheetOverlay'}],['dialog role',{role:'dialog'}],['aria modal',{'aria-modal':'true'}]]){
  await check('A visible '+label+' preserves its open editor',async a=>{a.overlay(attrs);await skipped(a);});
 }
 await check('An open native dialog preserves its editor',async a=>{const el=a.element('dialog',{open:''});el.getClientRects=()=>[{}];await skipped(a);});
 await check('A closed display-none modal does not permanently disable synchronization',async a=>{const el=a.overlay({class:'modal'});el.style.display='none';el.getClientRects=()=>[];a.setup();await a.tick();assert.equal(a.reads.length,1);});
 await check('A visibility-hidden overlay does not block a clean active view',async a=>{const el=a.overlay({class:'overlay'});el.style.visibility='hidden';a.setup();await a.tick();assert.equal(a.reads.length,1);});
 await check('A zero-rectangle overlay is not treated as an open editor',async a=>{const el=a.overlay({role:'dialog'});el.getClientRects=()=>[];a.setup();await a.tick();assert.equal(a.reads.length,1);});
 const failed=results.filter(result=>!result.pass);console.log(JSON.stringify({runtime:'node_vm_real_realtime_functions',passed:results.length-failed.length,total:results.length,failed},null,2));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
