/* Shared landscape brief schema; tariff snapshots are stored in answers JSON. */
window.LandscapeBrief = (() => {
 const service = 'Ландшафтный дизайн';
 const defaults = [
 {name:'Концепция',desc:'Зонирование, планировочная схема и стилистическая концепция участка. Без рабочей документации.',profile:'concept'},
 {name:'Полный проект',desc:'Концепция, визуализация и рабочие решения по озеленению, покрытиям, освещению, поливу и водоотведению.',profile:'full'}
 ];
 const fields = [["ld_area", "Площадь участка и площадь проектирования, м²"], ["ld_cadastre", "Кадастровый номер и границы участка"], ["ld_survey", "Топосъёмка, обмеры и имеющиеся документы"], ["ld_relief", "Рельеф, уклоны, грунт и подтопления"], ["ld_existing", "Существующие здания, деревья и сети — что сохранить"], ["ld_users", "Кто пользуется участком: дети, пожилые, питомцы"], ["ld_zones", "Нужные зоны: отдых, барбекю, детская, спорт, огород, парковка"], ["ld_routes", "Входы, въезд, проходы и связь с домом"], ["ld_style", "Стиль участка, цвета и предпочтения"], ["ld_plants", "Растения, газон и нежелательные виды"], ["ld_care", "Готовность к уходу, сезонность и аллергии"], ["ld_budget", "Бюджет реализации и очередность работ"], ["ld_paving", "Покрытия, дорожки, площадки и материалы"], ["ld_lighting", "Освещение участка и управление"], ["ld_irrigation", "Полив, источник воды и автоматизация"], ["ld_drainage", "Дренаж, ливневые воды и вертикальная планировка"], ["ld_structures", "Ограждения, подпорные стены, беседки и водоёмы"], ["ld_visual", "Пожелания к ракурсам визуализации"], ["ld_notes", "Дополнительные пожелания"]].map(([id,label])=>({id,label,type:'textarea',placeholder:'Опишите пожелания или укажите «на усмотрение дизайнера»'}));
 fields.push({id:'ld_refs',type:'refs',label:'Фото участка, планы и референсы'});
 const detail = new Set(['ld_paving','ld_lighting','ld_irrigation','ld_drainage','ld_structures']);
 function tariffs(a){return Array.isArray(a._ld_tariffs)&&a._ld_tariffs.length?a._ld_tariffs:defaults;}
 function selected(a){return tariffs(a).find(t=>t.name===a.ld_tariff);}
 function visible(key,a){
   if(!key.startsWith('ld_') || key==='ld_tariff' || key==='ld_scope') return true;
   if(!(a.service_type||[]).includes(service)) return false;
   const t=selected(a); if(!t) return false;
   const desc=t.desc||'';
   if(key==='ld_visual') return t.profile==='full'||(/визуализ|3d/i.test(desc)&&! /без[^.]*визуализ/i.test(desc));
   if(detail.has(key)) return t.profile==='full'||(/рабоч|чертеж|документац/i.test(desc)&&! /без[^.]*документац/i.test(desc));
   return true;
 }
 function sections(a){return [{id:'landscape',icon:'🌿',title:'Ландшафтный дизайн',sub:'Состав анкеты зависит от тарифа',requiresService:service,fields:fields.filter(f=>visible(f.id,a))}];}
 function setTariff(a,name){a.ld_tariff=name; a.ld_scope=selected(a)?.desc||'';}
 return {service,defaults,fields,tariffs,selected,visible,sections,setTariff};
})();
