(function(root){
  'use strict';
  const cp1251=new TextDecoder('windows-1251');
  const number=s=>Number(String(s||'').replace(/\s/g,'').replace(',','.'));
  const area=n=>Number(n).toFixed(2).replace('.',',');
  const clean=s=>String(s||'').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
  // Older Archicad exports map Windows-1251 glyphs to Latin-1 code points.
  function repairText(text){
    return clean(String(text||'').replace(/[\u00c0-\u00ff\u00a8\u00b8]/g,c=>cp1251.decode(new Uint8Array([c.charCodeAt(0)]))).replace(/¹/g,'№'));
  }
  function rows(items){
    const out=[];
    for(const w of items.filter(w=>!w.vertical&&w.text).slice().sort((a,b)=>a.cy-b.cy||a.x0-b.x0)){
      let row=out.find(r=>Math.abs(r.cy-w.cy)<Math.max(1.6,Math.min(r.h,w.h)*.48));
      if(!row){row={cy:w.cy,h:w.h,items:[]};out.push(row);}
      row.items.push(w);
    }
    return out.sort((a,b)=>a.cy-b.cy).map(r=>({...r,items:r.items.sort((a,b)=>a.x0-b.x0),text:r.items.sort((a,b)=>a.x0-b.x0).map(w=>w.text).join(' ')}));
  }
  function pageFromItems(items,width,height,page,ocr=false){
    const words=items.filter(w=>clean(w.text)).map(w=>({...w,text:repairText(w.text),cx:(w.x0+w.x1)/2,cy:(w.y0+w.y1)/2,h:Math.max(1,w.y1-w.y0)}));
    const lines=rows(words),phrases=[];
    for(const line of lines){
      let group=[];
      const flush=()=>{if(!group.length)return;const x0=group[0].x0,x1=group.at(-1).x1,y0=Math.min(...group.map(w=>w.y0)),y1=Math.max(...group.map(w=>w.y1));phrases.push({text:group.map(w=>w.text).join(' '),x0,x1,y0,y1,cx:(x0+x1)/2,cy:(y0+y1)/2,h:y1-y0});group=[];};
      for(const word of line.items){if(group.length&&word.x0-group.at(-1).x1>line.h*3)flush();group.push(word);}flush();
    }
    return {page,width,height,items:words,lines,phrases,text:words.map(w=>w.text).join('\n'),ocr};
  }
  function floorIn(text){
    if(/(?:цокол\w*|подвал\w*)\s*(?:этаж)?/iu.test(text))return 'basement';
    const m=text.match(/(?:этаж[а-я]*\s*([1-9])|([1-9])\s*(?:[-–]?\s*(?:й|ый|ой|го))?\s*этаж)/iu);
    if(m)return 'floor'+(m[1]||m[2]);
    const verbal=text.match(/(перв|втор|трет)[а-яё]*\s+этаж/iu);
    if(verbal)return 'floor'+({перв:1,втор:2,трет:3}[verbal[1].toLowerCase()]);
    const roman=text.match(/(?:^|[\s(])(IV|III|II|I)\s*[-–]?\s*(?:этаж[а-яё]*|эт\.?)(?:\s|$)/iu);return roman?'floor'+({I:1,II:2,III:3,IV:4}[roman[1].toUpperCase()]):null;
  }
  function tables(page){
    const result=[];
    for(const header of page.items.filter(w=>/^наименование(?:\s|$)|^название\s+помещ/iu.test(w.text))){
      const a=page.items.filter(w=>/^площадь(?:\s|,|$)/iu.test(w.text)&&w.x0>header.x0&&Math.abs(w.cy-header.cy)<Math.max(header.h,w.h)*1.5).sort((x,y)=>x.x0-y.x0)[0];
      if(!a)continue;
      const id=page.items.filter(w=>/^(?:№|N|N°|поз\.?)$/iu.test(w.text)&&w.x0<header.x0&&Math.abs(w.cy-header.cy)<header.h*1.5).sort((x,y)=>y.x0-x.x0)[0];
      const left=id?id.x0-header.h*.5:header.x0-header.h*2;
      const right=a.x1+a.h*2, boundary=(header.cx+a.cx)/2;
      const candidates=page.items.filter(w=>!w.vertical&&w.cy>header.cy+header.h*.4&&w.x0>boundary&&w.x0<right&&/^\d+(?:[.,]\d{1,2})?(?:\s*м\s*[²2])?$/iu.test(w.text));
      const entries=[];let total=null,lastY=header.cy,bottom=header.y1;
      for(const cell of candidates.sort((x,y)=>x.cy-y.cy)){
        if(cell.cy-lastY>Math.max(40,header.h*4)&&entries.length)break;
        const value=number(cell.text.replace(/\s*м\s*[²2]/iu,''));
        if(!(value>0&&value<100000))continue;
        const same=page.items.filter(w=>!w.vertical&&Math.abs(w.cy-cell.cy)<Math.max(w.h,cell.h)*.65&&w.x0>=left&&w.x1<cell.x0);
        const index=id?same.find(w=>Math.abs(w.cx-id.cx)<header.h&&/^\d{1,3}(?:[.:-]\d{1,3})?$/.test(w.text)):null;
        const name=clean(same.filter(w=>w!==index&&w.x0>(id?id.x1: left)&&!/^\d+$/.test(w.text)).sort((x,y)=>x.x0-y.x0).map(w=>w.text).join(' '));
        if(!name||/^(итого|всего|общая\s+площадь|сумма)/iu.test(name)){
          if(entries.length){total=value;bottom=cell.y1;break;}continue;
        }
        if(!/[а-яёa-z]/iu.test(name)||/наименование|условные|стадия|экспликац/iu.test(name))break;
        if(id&&!index)break;
        const rawIndex=index?.text||String(entries.length+1),parts=rawIndex.split(/[.:-]/);
        entries.push({name,area:area(value),index:Number(parts.at(-1)),rawIndex});
        lastY=cell.cy;bottom=cell.y1;
      }
      if(!entries.length)continue;
      const sum=Math.round(entries.reduce((s,r)=>s+number(r.area),0)*100)/100;
      const labels=[...(page.phrases||[]),...page.items].filter(w=>/экспликац/iu.test(w.text)&&w.cy<header.cy&&header.cy-w.cy<page.height*.12&&w.cx>left-header.h*4&&w.cx<right+header.h*4).sort((x,y)=>y.cy-x.cy);
      const label=labels[0]?.text||'';
      const sequential=entries.every((r,i)=>r.index===entries[0].index+i),prefixes=entries.map(r=>r.rawIndex.match(/^([1-3])[.:-]/)?.[1]||(/^([1-3])\d{2}$/.exec(r.rawIndex)?.[1]));
      const floorHint=prefixes.every(x=>x&&x===prefixes[0])?'floor'+prefixes[0]:null;
      result.push({rows:entries.map(({name,area})=>({name,area})),total:total??sum,sum,verified:sequential&&(total===null?entries[0].index===1||!!floorHint:Math.abs(total-sum)<.16),hasTotal:total!==null,left,right,top:header.y0,bottom,cx:(left+right)/2,label,floor:floorIn(label),floorHint,page:page.page});
    }
    return result;
  }
  const planPattern=/планировочн.{0,12}решен|план.{0,25}(?:этаж|мебел|помещ)|привязк[аи]\s+мебел|марк[еи]р[оа]вочн.{0,8}план|кладочн.{0,15}план/iu;
  function planInfos(page,declared){
    const headings=[...(page.phrases||[]),...page.items].filter(w=>planPattern.test(w.text));
    if(/содержание|ведомость\s+рабочих\s+чертеж/iu.test(page.text)&&headings.length>3)return [];
    const result=[];
    for(const h of headings){
      const floor=floorIn(h.text)||(declared===1?'floor1':null);
      if(!floor)continue;
      const score=/планировочн/iu.test(h.text)?100:/мебел/iu.test(h.text)?90:/марк[еи]р/iu.test(h.text)?75:40;
      const existing=result.find(x=>x.floor===floor);
      const entry={floor,score,heading:h.text,page:page.page,cx:h.cx,cy:h.cy,h:h.h};
      if(!existing)result.push(entry);
      else if(score>existing.score||score===existing.score&&h.h>existing.h)Object.assign(existing,entry);
    }
    return result;
  }
  function associateTables(pages,plans,declared){
    const all=pages.flatMap(p=>p.tables),distance=(table,plan,page)=>Math.abs(table.cx-plan.cx)/page.width+Math.abs(table.top-plan.cy)/page.height*.25;
    for(const page of pages){
      const local=plans.filter(p=>p.page===page.page),floors=[...new Set(local.map(p=>p.floor))],unknown=page.tables.filter(t=>!t.floor);
      for(const table of unknown){
        if(floors.length===1&&unknown.length===1){table.floor=floors[0];table.association='same_plan';continue;}
        if(floors.length>1){
          const ranked=local.map(plan=>({plan,score:distance(table,plan,page)})).sort((a,b)=>a.score-b.score);
          if(ranked[1].score-ranked[0].score>.12){table.floor=ranked[0].plan.floor;table.association='spatial_plan';continue;}
        }
        if(table.floorHint&&Number(table.floorHint.slice(5))<=declared){table.floor=table.floorHint;table.association='room_numbers';continue;}
        if(declared===1&&!floors.length){table.floor='floor1';table.association='single_floor';}
      }
    }
    // A standalone table may follow its drawing. Equal-distance contradictory
    // neighbours remain ambiguous rather than borrowing an arbitrary floor.
    for(const table of all.filter(t=>!t.floor)){
      const nearby=plans.filter(p=>Math.abs(p.page-table.page)===1),floors=[...new Set(nearby.map(p=>p.floor))];
      if(floors.length===1&&pages.find(p=>p.page===table.page)?.tables.filter(t=>!t.floor).length===1){table.floor=floors[0];table.association='adjacent_plan';}
    }
    // Exact copies inherit a level only when neighbouring plans do not conflict.
    for(const table of all.filter(t=>!t.floor)){
      const nearby=[...new Set(plans.filter(p=>Math.abs(p.page-table.page)<=1).map(p=>p.floor))];
      const matches=[...new Set(all.filter(t=>t!==table&&t.floor&&signature(t)===signature(table)).map(t=>t.floor))];
      if(matches.length===1&&nearby.length<=1&&(!nearby.length||nearby[0]===matches[0])){table.floor=matches[0];table.association='matching_table';}
    }
  }
  const signature=t=>t.rows.map(r=>clean(r.name).toLowerCase()+':'+r.area).join('|');
  function analyze(pages){
    const warnings=[],blocking=[],sources={},data={tags:[]},levels={},plans=[];
    const strong=[],weak=[],counts=[];
    for(const p of pages){
      for(const line of p.lines){
        for(const m of line.text.matchAll(/№\s*([\p{L}\d][\p{L}\d._\/-]{0,39})/gu)){
          const val=m[1].replace(/[.,;]+$/,'');if(!/\d/.test(val)||/док/iu.test(val))continue;
          if(/проект\s*(?:АР|ЭП|РП|КР)?\s*№/iu.test(line.text))strong.push({value:val,page:p.page});
          else if(val.replace(/\D/g,'').length>=3)weak.push({value:val,page:p.page});
        }
      }
      const n=p.text.match(/(?:([1-9])\s*(?:[-–]?\s*[хй])?|(?:^|[^а-яё])(одно|двух|тр[её]х))\s*[-–]?\s*этажн/iu);
      if(n)counts.push({value:n[1]?Number(n[1]):{одно:1,двух:2,трех:3,трёх:3}[n[2].toLowerCase()],page:p.page});
      p.tables=tables(p);
    }
    function vote(candidates,field){
      const grouped=new Map();for(const c of candidates){const v=grouped.get(c.value)||{...c,count:0};v.count++;grouped.set(c.value,v);}
      const ranked=[...grouped.values()].sort((a,b)=>b.count-a.count);
      if(!ranked.length)return null;
      if(ranked.length>1){blocking.push((field==='floors'?'Этажность':'Номер проекта')+': в альбоме разные значения');return null;}
      sources[field]={page:ranked[0].page};return ranked[0].value;
    }
    data.project_number=vote(strong.length?strong:weak,'project_number');
    let declared=vote(counts,'floors');
    for(const p of pages)for(const info of planInfos(p,declared))plans.push({...info,source:p});
    const explicit=plans.map(p=>p.floor).filter(Boolean);
    if(!declared){const nums=explicit.filter(f=>/^floor/.test(f)).map(f=>Number(f.slice(5)));if(nums.length)declared=Math.max(...nums);}
    associateTables(pages,plans,declared);
    data.floors=declared;
    if(declared>3)blocking.push('В альбоме больше трёх надземных этажей');
    if(explicit.some(f=>/^floor/.test(f)&&Number(f.slice(5))>declared))blocking.push('Этажность в описании не совпадает с планами');
    for(const key of ['floor1','floor2','floor3','basement']){
      const candidates=plans.filter(p=>p.floor===key).sort((a,b)=>b.score-a.score);
      const assigned=pages.flatMap(p=>p.tables).filter(t=>t.floor===key);
      const rankTable=t=>(t.verified?100:0)+(t.hasTotal?20:0)+(/экспликац/iu.test(t.label)?10:0)+t.rows.length*.01;
      let chosen=candidates.find(p=>p.source.tables.some(t=>t.floor===key))||candidates[0];
      let table=chosen?.source.tables.filter(t=>t.floor===key).sort((a,b)=>rankTable(b)-rankTable(a))[0]||assigned.slice().sort((a,b)=>rankTable(b)-rankTable(a))[0];
      if(chosen||table)levels[key]={plan:chosen?{page:chosen.page,table,heading:chosen.heading}:null,table};
    }
    if(levels.basement)data.tags.push('Цокольный этаж');
    const activeKeys=[...(levels.basement?['basement']:[]),...Array.from({length:Math.min(declared||0,3)},(_,i)=>'floor'+(i+1))];
    let total=0,complete=!!activeKeys.length;
    for(const key of activeKeys){
      const l=levels[key];
      const label=key==='basement'?'цоколь':key.slice(5)+'-й этаж';
      if(!l?.table){complete=false;blocking.push('Не найдена экспликация: '+label);continue;}
      if(l.table.association==='adjacent_plan')warnings.push('Экспликация '+label+' сопоставлена с соседним планом');
      if(!l.table.verified)blocking.push('Не сходится экспликация: '+label);
      if(!l.plan)blocking.push('Не найден план: '+label);
      total+=l.table.total;sources[key]={page:l.table.page,planPage:l.plan?.page,area:'table',association:l.table.association||'explicit'};
    }
    // Prefer an explicitly named whole-building area; otherwise sum distinct floors once.
    let explicitArea=null;const areaCandidates=[];
    for(const p of pages)for(const l of p.lines){const m=l.text.match(/(?:общая\s+площадь\s+(?:дома|здания)|площадь\s+дома)\s*[:=—-]?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:м[²2])?/iu);if(m&&number(m[1])>0)areaCandidates.push({value:number(m[1]),page:p.page});}
    if(areaCandidates.length){
      explicitArea=areaCandidates[0].value;sources.total_area={page:areaCandidates[0].page,area:'explicit'};
      if(areaCandidates.some(a=>Math.abs(a.value-explicitArea)>.01))blocking.push('Общая площадь: в альбоме разные значения');
    }
    if(explicitArea)data.total_area=area(number(explicitArea));
    else if(complete){data.total_area=area(total);sources.total_area={pages:activeKeys.map(k=>levels[k].table.page),area:'sum_of_floor_tables'};}
    const rooms=activeKeys.flatMap(k=>levels[k]?.table?.rows||[]);
    if(!explicitArea&&complete&&rooms.some(r=>/террас|навес|балкон|лоджи/iu.test(r.name)))warnings.push('Общая площадь взята из экспликаций, включая открытые помещения');
    if(complete){
      data.beds=rooms.filter(r=>/спальн|^сп$|детск/iu.test(r.name)).length;
      data.baths=rooms.filter(r=>/^(?:с\s*[\/.]?\s*у)(?:\s|$)|сануз|ванн|душев|туалет/iu.test(r.name)).length;
    }
    const text=pages.map(p=>p.text).join('\n');
    if(/газ[оа]б{1,2}л{1,2}ок/iu.test(text))data.tags.push('Газоблок');
    if(/фундамент[;:\s\d.)-]{0,30}ленточн|ленточн[а-яё\s]{0,20}фундамент/iu.test(text))data.tags.push('Ленточный фундамент');
    if(/фальц/iu.test(text))data.tags.push('Фальцевая кровля');
    if(/плоск[а-яё]{0,3}\s+(?:кровл|крыш)/iu.test(text))data.tags.push('Плоская кровля');
    if(/классическ[а-яё]*\s+стил/iu.test(text))data.tags.push('Классический');
    else if(/современн[а-яё]*\s+стил/iu.test(text))data.tags.push('Современный');
    if(rooms.some(r=>/террас/iu.test(r.name)))data.tags.push('Терраса');
    data.title=declared?({1:'Одноэтажный дом',2:'Двухэтажный дом',3:'Трёхэтажный дом'}[declared]||'Жилой дом'):'Жилой дом';
    // Overall dimension lines: use explicit dimensions, or matching floor-one drawings.
    const dimensionPages=[];
    for(const p of pages){
      const m=p.text.match(/(?:габариты|размеры\s+(?:дома|здания))\s*[:—-]?\s*(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)/iu);
      if(m){data.footprint=m[1]+' × '+m[2];sources.footprint={page:p.page};break;}
      const match=p.tables.find(t=>levels.floor1?.table&&signature(t)===signature(levels.floor1.table));
      const plan=plans.find(x=>x.page===p.page&&x.floor==='floor1');
      if(!match||/оси|кладочн|разбивочн|фундамент/iu.test(plan?.heading||''))continue;
      const dims=p.items.filter(w=>/^(?:\d{1,2}[ \u00a0])?\d{3,5}$/.test(w.text)&&number(w.text)>=3000&&number(w.text)<=100000&&!(w.cy>p.height*.75&&w.cx>p.width*.52)&&!p.tables.some(t=>w.cx>t.left&&w.cx<t.right&&w.cy>t.top&&w.cy<t.bottom));
      if(dims.length>8)continue;
      const own=dims.filter(w=>!match||p.tables.length<2||p.tables.slice().sort((a,b)=>Math.abs(a.cx-w.cx)-Math.abs(b.cx-w.cx))[0]===match);
      const h=own.filter(w=>!w.vertical).map(w=>number(w.text)),v=own.filter(w=>w.vertical).map(w=>number(w.text));
      if(h.length&&v.length)dimensionPages.push({page:p.page,h:Math.max(...h),v:Math.max(...v),priority:p.tables.length>1?2:1});
    }
    if(!data.footprint&&dimensionPages.length){const d=dimensionPages.sort((a,b)=>b.priority-a.priority||b.h*b.v-a.h*a.v)[0];data.footprint=[d.h/1000,d.v/1000].map(n=>String(Number(n.toFixed(3))).replace('.',',')).join(' × ');sources.footprint={page:d.page,from:'dimension_lines'};}
    if(!data.project_number)blocking.push('Не найден однозначный номер проекта в PDF');
    if(!declared)blocking.push('Не определена этажность');
    if(!data.total_area)blocking.push('Не найдена общая площадь');
    if(!data.footprint)warnings.push('Габариты не найдены');
    if(pages.some(p=>p.ocr))warnings.push('Часть данных распознана со скана');
    return {data,levels,sources,warnings,blocking:[...new Set(blocking)],pages:pages.length};
  }
  root.CatalogPdfCore=Object.freeze({repairText,pageFromItems,tables,analyze,floorIn,area,number});
  if(typeof module!=='undefined')module.exports=root.CatalogPdfCore;
})(typeof window!=='undefined'?window:globalThis);
