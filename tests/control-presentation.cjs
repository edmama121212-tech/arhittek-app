'use strict';

// Input modalities and constraints are varied independently of the business fixture.
const profiles = [
  {id:'phone-small',width:320,height:568,touch:true},
  {id:'phone-landscape',width:667,height:375,touch:true},
  {id:'phone-large-text',width:390,height:844,touch:true,text:1.35},
  {id:'phone-reduced-motion',width:393,height:852,touch:true,motion:'reduce'},
  {id:'phone-high-density',width:412,height:915,touch:true,dpr:3},
  {id:'tablet-portrait',width:768,height:1024,touch:true},
  {id:'tablet-landscape',width:1024,height:768,touch:true},
  {id:'laptop-short',width:1280,height:600},
  {id:'desktop-forced-colors',width:1366,height:768,contrast:true},
  {id:'desktop-keyboard',width:1440,height:900}
];

function inspectControls() {
  const selector='button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=checkbox],[tabindex],[onclick],label[for]';
  const activeSheet=[...document.querySelectorAll('.sheet-overlay.active,[role=dialog],#financeWorkspaceModal')].filter(e=>e.checkVisibility()).at(-1);
  const region=activeSheet||document;
  const candidates=[...region.querySelectorAll(selector)].filter(e=>{
    const box=e.getBoundingClientRect();
    return box.width>0 && box.height>0 && e.checkVisibility({checkVisibilityCSS:true}) && !e.closest('[inert],[aria-hidden=true]');
  });
  const counters=new Map(),records=[];
  const parents=new Map();
  const saveScroll=e=>{
    for(let node=e.parentElement;node;node=node.parentElement)
      if(!parents.has(node))parents.set(node,[node.scrollLeft,node.scrollTop]);
  };
  const savedFocus=document.activeElement;
  for(const e of candidates){
    const started=performance.now();
    const text=value=>(value||'').trim().replace(/\s+/g,' ').slice(0,100);
    const label=text(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')?.split(' ').map(id=>document.getElementById(id)?.textContent).join(' ')||
      [...(e.labels||[])].map(x=>x.innerText).join(' ')||e.innerText||e.title||e.placeholder||(['button','submit'].includes(e.type)?e.value:''));
    const identity=e.id||e.getAttribute('name')||e.dataset.fw||e.dataset.fwTab||e.dataset.view||label||e.className?.toString()||e.tagName;
    const rootKey=e.tagName.toLowerCase()+' '+text(identity);
    const nth=(counters.get(rootKey)||0)+1;counters.set(rootKey,nth);
    saveScroll(e);
    e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const rect=e.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    const disabled=e.matches(':disabled,[aria-disabled=true]')||!!e.closest('fieldset:disabled');
    const forControl=e.control;
    const hitTarget=!!hit&&(hit===e||e.contains(hit)||hit===forControl||
      !!(e.labels&&[...e.labels].some(l=>l.contains(hit))));
    const scrolled=rect.bottom>0&&rect.right>0&&rect.left<innerWidth&&rect.top<innerHeight;
    const focusTarget=e.tabIndex>=0?e:(forControl||e);
    const sequential=focusTarget.tabIndex>=0 && !disabled;
    if(sequential)focusTarget.focus({preventScroll:true});
    const focusable=sequential && focusTarget===document.activeElement;
    const rounded=n=>Math.round(n*10)/10;
    records.push({key:rootKey+(nth>1?' #'+nth:''),label,tag:e.tagName.toLowerCase(),disabled,
      width:rounded(rect.width),height:rounded(rect.height),scrolled,hit:hitTarget,focusable,sequential,
      ownTextOverflow:e.clientWidth>0&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX==='hidden',
      probeMs:rounded(performance.now()-started)});
  }
  if(savedFocus?.isConnected)savedFocus.focus({preventScroll:true});
  for(const [parent,[x,y]] of parents)if(parent.scrollLeft!==x||parent.scrollTop!==y)parent.scrollTo({left:x,top:y,behavior:'instant'});
  return records;
}
// Timing is measured on a real user click, before other click handlers run.
function recordActions(){
  const state=window.__controlAuditActions=[];
  const selector='button,a[href],input,select,textarea,summary,[role=button],[role=tab],[onclick],.nav-btn,.proj-row,.obj-card';
  document.addEventListener('click',event=>{
    const control=event.target.closest(selector);
    if(!event.isTrusted||!control)return;
    const view=()=>document.querySelector('.view.active')?.id||'';
    const text=(control.getAttribute('aria-label')||control.innerText||control.title||'').trim().replace(/\s+/g,' ').slice(0,80);
    const row={id:control.id||control.dataset.view||control.dataset.fwTab||control.dataset.fw||text,text,viewBefore:view()};
    const started=performance.now();
    state.push(row);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      row.paintMs=Math.round((performance.now()-started)*10)/10;
      row.viewAfter=view();
    }));
  },true);
}
module.exports={profiles,inspectControls,recordActions};
