import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(data:unknown,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function ageText(iso:unknown){const t=Date.parse(String(iso??""));if(!Number.isFinite(t))return "нет данных";const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<60?`${m} мин назад`:`${Math.floor(m/60)} ч ${m%60} мин назад`}
async function dashboardUrl(sb:any){
  const {data:secret,error}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"firewatch_cron_secret"});
  if(error||!secret)throw new Error("dashboard signing secret unavailable");
  const base=Deno.env.get("SUPABASE_URL");if(!base)throw new Error("SUPABASE_URL unavailable");
  const exp=Math.floor(Date.now()/1000)+4*3600;
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(String(secret)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const raw=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode("dashboard:"+String(exp))));
  let bin="";for(const b of raw)bin+=String.fromCharCode(b);
  const sig=btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  return "https://koi2mkxsz.github.io/GeoWatch-Dashboard/?exp="+exp+"&sig="+encodeURIComponent(sig);
}
async function tg(token:string,method:string,body:unknown){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||!d?.ok)throw new Error(`Telegram ${method}: ${d?.description??r.status}`);return d.result}
async function tgDocument(token:string,chatId:string,bytes:Uint8Array,fileName:string,caption:string,replyMarkup:any){
  const form=new FormData();
  form.append("chat_id",chatId);
  form.append("document",new Blob([bytes],{type:"text/html"}),fileName);
  form.append("caption",caption);
  form.append("reply_markup",JSON.stringify(replyMarkup));
  const r=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:form,signal:AbortSignal.timeout(30000)});
  const d=await r.json();
  if(!r.ok||!d?.ok)throw new Error(`Telegram sendDocument: ${d?.description??r.status}`);
  return d.result;
}

const panelKeyboard={inline_keyboard:[[{text:"🌐 Web Dashboard",callback_data:"admin:dashboard"}],[{text:"📊 Статус",callback_data:"admin:status"},{text:"🛰 Источники",callback_data:"admin:sources"}],[{text:"🔥 Последние события",callback_data:"admin:events"},{text:"📋 Отчёт события",callback_data:"admin:report"}],[{text:"📑 Досье события",callback_data:"admin:dossier"},{text:"🛰 Поверхность",callback_data:"admin:satellite"}],[{text:"🧠 Последнее событие",callback_data:"admin:event"},{text:"🧪 Integrity",callback_data:"admin:integrity"}],[{text:"📡 Coverage",callback_data:"admin:coverage"},{text:"⏱ Latency",callback_data:"admin:latency"}],[{text:"🧾 Review Queue",callback_data:"admin:review"}],[{text:"🔎 OSINT",callback_data:"admin:osint"},{text:"🗺 Гео/инфра",callback_data:"admin:geo"}],[{text:"🌫 Наземные датчики",callback_data:"admin:ground"}],[{text:"🔎 Поиск",callback_data:"admin:search"},{text:"📈 Аналитика",callback_data:"admin:analytics"}],[{text:"👥 Клиенты",callback_data:"admin:clients"}],[{text:"🗄 Архив",callback_data:"admin:archive"},{text:"🔄 Обновить",callback_data:"admin:status"}]]};
const searchKeyboard={inline_keyboard:[
  [{text:"📍 По координате и радиусу",callback_data:"admin:search_geo"}],
  [{text:"🧩 Все фильтры поиска",callback_data:"admin:search_help"}],
  [{text:"⬅️ Назад в панель",callback_data:"admin:status"}]
]};
function statusText(s:any){const q=Number(s.telegram_queue_count??0),db=Number(s.database_size_bytes??0);const issues:string[]=[];for(const [name,m] of [["NOAA/Telegram",s.monitor],["MODIS",s.monitor_modis],["Suomi NPP",s.monitor_snpp]] as any[]){const t=Date.parse(String(m?.last_success_run??""));const age=Number.isFinite(t)?Date.now()-t:Infinity;if(age>45*60000)issues.push(`${name}: нет успешного цикла >45 мин`);if(m?.last_error)issues.push(`${name}: ${String(m.last_error).slice(0,120)}`)}const oldest=Date.parse(String(s.oldest_telegram_queue_item??""));if(q>0&&Number.isFinite(oldest)&&Date.now()-oldest>30*60000)issues.push(`Telegram очередь задержана >30 мин: ${q}`);const dbPct=Number(s.quota?.database_pct??0);if(dbPct>=85)issues.push(`База критично заполнена: ${dbPct.toFixed(1)}%`);else if(dbPct>=75)issues.push(`База заполнена: ${dbPct.toFixed(1)}%`);if(Number(s.quota?.edge_invocation_pct??0)>=75)issues.push(`Edge invocations >75% прогноза квоты`);return [`🛠 NASA FIRMS — админ-панель`,``,`Система: ${issues.length?"⚠️ есть замечания":"✅ штатно"}`,`NOAA/Telegram: ${ageText(s.monitor?.last_success_run)}`,`MODIS: ${ageText(s.monitor_modis?.last_success_run)}`,`Suomi NPP: ${ageText(s.monitor_snpp?.last_success_run)}`,`OSINT Fusion: ${ageText(s.monitor_osint?.last_success_run)} • ${s.monitor_osint?.status??"нет данных"}`,`Ground OSINT: ${ageText(s.monitor_ground_osint?.last_check)} • ${s.monitor_ground_osint?.status??"нет данных"}`,`Geo OSINT: ${ageText(s.monitor_geo_osint?.last_check)} • ${s.monitor_geo_osint?.status??"нет данных"}`,`Dossier: ${ageText(s.monitor_dossier?.last_success_run)} • ${s.monitor_dossier?.status??"нет данных"}`,`Satellite Surface: ${ageText(s.monitor_satellite_evidence?.last_success_run)} • ${s.monitor_satellite_evidence?.status??"нет данных"}`,`Event Report: ${s.event_report_policy?.status??"нет данных"} • ${s.event_report_policy?.version??"—"}`,`Notification Integrity: ${s.monitor_notification_integrity?.status??"нет данных"} • gaps ${Number(s.monitor_notification_integrity?.notification_gaps??0)} • backlog ${Number(s.monitor_notification_integrity?.delivery_backlog??0)}`,`Source Coverage: ${s.monitor_source_coverage?.status??"нет данных"} • active ${Number(s.monitor_source_coverage?.sources_active??0)}/${Number(s.monitor_source_coverage?.sources_total??0)} • degraded ${Number(s.monitor_source_coverage?.sources_degraded??0)}`,`Coverage Baseline: ${s.monitor_source_baseline?.status??"нет данных"} • learning ${Number(s.monitor_source_baseline?.sources_learning??0)} • watch ${Number(s.monitor_source_baseline?.sources_watch??0)} • anomaly ${Number(s.monitor_source_baseline?.sources_anomaly??0)}`,`Админ-доставка: ${s.admin_bot_state?.delivery_mode==="webhook"&&s.admin_bot_state?.webhook_enabled?"⚡ webhook":"⚠️ "+String(s.admin_bot_state?.delivery_mode??"не настроено")} • pending ${Number(s.admin_bot_state?.webhook_pending_update_count??0)}`,`Telegram: новые ${Number(s.telegram_queue_new_count??0)} • обновления ${Number(s.telegram_queue_update_count??0)} • закрытия ${Number(s.telegram_queue_close_count??0)}`,`База: ${(db/1024/1024).toFixed(1)} МБ / 500 МБ (${Number(s.quota?.database_pct??0).toFixed(1)}%)`,`Edge прогноз: ${Number(s.quota?.estimated_cron_edge_invocations_30d??0).toLocaleString("ru-RU")} / 500 000`,`Media proxy 30д: ${(Number(s.quota?.tracked_media_bytes_30d??0)/1024/1024).toFixed(1)} МБ`,issues.length?`\nПроблемы:\n${issues.map(x=>`• ${x}`).join("\n")}`:""].filter(Boolean).join("\n")}
function sourcesText(s:any){const m=s.monitor??{},mo=s.monitor_modis??{},sn=s.monitor_snpp??{};return [`🛰 Источники`,``,`NOAA-20/21 • VIIRS ~375 м`,`Последний цикл: ${ageText(m.last_success_run)}`,`Последний проход: ${m.inserted??0} новых / ${m.duplicates??0} дублей`,``,`Suomi NPP • VIIRS ~375 м`,`Последний цикл: ${ageText(sn.last_success_run)}`,`Последний проход: ${sn.inserted??0} новых / ${sn.duplicates??0} дублей`,``,`Terra/Aqua • MODIS ~1 км`,`Последний цикл: ${ageText(mo.last_success_run)}`,`Последний проход: ${mo.inserted??0} новых / ${mo.duplicates??0} дублей`].join("\n")}
function archiveText(s:any){const h=s.history_backfill??{};const db=Number(s.database_size_bytes??0);return [`🗄 Архив и база`,``,`365-дневный backfill: ${h.done?"✅ завершён":"⏳ выполняется"}`,`Обработано дней: ${h.processed_days??0}`,`Курсор: ${h.cursor??"—"}`,`Принято строк: ${h.accepted_rows??0}`,`Агрегатных ячеек: ${h.upserted_cells??0}`,`API-вызовов: ${h.api_calls??0}`,`Последняя ошибка: ${h.last_error??"нет"}`,``,`Размер базы: ${(db/1024/1024).toFixed(1)} МБ / 500 МБ (${Number(s.quota?.database_pct??0).toFixed(1)}%)`,`Raw detections retention: 90 дней`,`Compact archive retention: rolling 365 дней`,`Cron/HTTP logs retention: 7 дней`].join("\n")}
async function latestEvents(sb:any){const {data,error}=await sb.from("fire_events").select("id,last_seen,observation_count,lifecycle_status,last_latitude,last_longitude,best_latitude,best_longitude,multisource_count,event_confidence_level,best_location_resolution_m,telegram_message_id,oblasts(name_uk)").order("last_seen",{ascending:false}).limit(5);if(error)throw error;const lines=(data??[]).map((e:any,i:number)=>`${i+1}. #${String(e.id).slice(0,8)} • ${e.oblasts?.name_uk??"Регион?"} • ${new Date(e.last_seen).toISOString().slice(0,16).replace("T"," ")} UTC\n   ${Number(e.best_latitude??e.last_latitude).toFixed(4)}, ${Number(e.best_longitude??e.last_longitude).toFixed(4)} • ~${e.best_location_resolution_m??"?"} м\n   платформ ${e.multisource_count??0} • ${e.event_confidence_level??"unknown"} • наблюдений ${e.observation_count} • ${e.lifecycle_status}\n   /event ${String(e.id).slice(0,8)}`);return `🔥 Последние события\n\n${lines.join("\n\n")||"Нет данных"}`}
function compass(deg:any){const n=Number(deg);if(!Number.isFinite(n))return"—";const names=["С","СВ","В","ЮВ","Ю","ЮЗ","З","СЗ"];return names[Math.round((((n%360)+360)%360)/45)%8]+" ("+Math.round(n)+"°)"}
async function eventDetailText(sb:any,q?:string){const {data,error}=await sb.rpc("firewatch_event_detail",{p_query:q?.trim()||null});if(error)throw error;if(!data)return"Событие не найдено.";const e:any=data,p=e.plume_forecast?.hours??[],p1=p.find((x:any)=>Number(x.hour)===1),p3=p.find((x:any)=>Number(x.hour)===3),p6=p.find((x:any)=>Number(x.hour)===6);const frp=e.frp_change_pct==null?"—":(Number(e.frp_change_pct)>=0?"+":"")+Number(e.frp_change_pct).toFixed(0)+"%";const line=(x:any)=>x?("~"+Number(x.distance_km??0).toFixed(0)+" км • "+compass(x.transport_bearing_deg)):"—";return [`🧠 Событие #${String(e.id).slice(0,8)}`,`Область: ${e.oblast??"—"}`,`Статус: ${e.lifecycle_status??"—"}`,`Координаты: ${Number(e.best_latitude).toFixed(5)}, ${Number(e.best_longitude).toFixed(5)} • ~${e.best_location_resolution_m??"?"} м`,`Наблюдений: ${e.observation_count??0} • платформ: ${e.multisource_count??0}`,`Уверенность: ${e.event_confidence_label??e.event_confidence_level??"—"}`,"",`FRP: ${e.frp_trend??"—"} • изменение ${frp}`,`Кластер: ~${e.cluster_diameter_m==null?"—":Math.round(Number(e.cluster_diameter_m))+" м"}`,`Смещение центра: ${e.cluster_motion_m==null?"—":Math.round(Number(e.cluster_motion_m))+" м"} • ${compass(e.cluster_motion_bearing_deg)}`,"",`Расчётный перенос: ${compass(e.plume_direction_deg)}`,`1 ч: ${line(p1)}`,`3 ч: ${line(p3)}`,`6 ч: ${line(p6)}`,`Ориентир по 3-часовой траектории: ${e.plume_reference_place??"—"}${e.plume_reference_place_distance_km!=null?" (~"+Number(e.plume_reference_place_distance_km).toFixed(1)+" км от расчётной точки)":""}`,"",`Атмосферный сигнал: ${e.atmosphere_signal_level??"—"}`,e.s5p_aer_ai_340_380!=null?`Sentinel-5P AI: ${Number(e.s5p_aer_ai_340_380).toFixed(2)}`:null,e.cams_aerosol_optical_depth!=null?`CAMS AOD: ${Number(e.cams_aerosol_optical_depth).toFixed(2)}`:null,"",e.event_summary?`Сводка: ${e.event_summary}`:null,"⚠️ Сектор переноса — расчёт по ветру 10 м, а не подтверждённый прогноз концентрации дыма."].filter(Boolean).join("\n").slice(0,3900)}
async function snapshot(sb:any){const {data,error}=await sb.rpc("firewatch_admin_snapshot");if(error)throw error;return data??{}}
const DOSSIER_FLAG_LABELS:Record<string,string>={
  multi_satellite_confirmed:"подтверждение ≥2 спутниковыми платформами",
  repeat_hotspot_30d:"повторные аномалии за 30 дней",
  repeat_hotspot_365d:"повторные аномалии за 365 дней",
  persistent_gt_3h:"длительность ≥3 ч",
  frp_ge_50mw:"FRP max ≥50 МВт",
  cluster_ge_1km:"кластер ≥1 км",
  wind_transport_context:"есть расчёт переноса ветром",
  atmospheric_signal_above_background:"атмосферный сигнал выше фонового",
  ground_sensor_context:"есть наземные измерения",
  external_osint_match:"есть внешний OSINT match",
  infrastructure_context:"рядом картографированная инфраструктура",
  near_power_line_500m:"ЛЭП ≤500 м",
  near_power_infrastructure_2km:"энергоинфраструктура ≤2 км",
  near_pipeline_1km:"трубопровод ≤1 км",
  near_industrial_2km:"промышленный объект ≤2 км",
  forest_context:"лес ≤500 м",
  agriculture_context:"сельхозземли ≤500 м",
  settlement_near_2km:"населённый пункт ≤2 км",
  sentinel2_before_available:"есть Sentinel-2 до события",
  sentinel2_after_available:"есть Sentinel-2 после события",
  surface_change_pair_ready:"готова пара Sentinel-2 до/после"
};
function dossierNum(v:any,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—"}
function satelliteSceneLine(label:string,x:any){
  if(!x)return `${label}: —`;
  const dt=String(x.datetime??"").slice(0,16).replace("T"," ");
  const cloud=x.cloud_pct==null?"—":Number(x.cloud_pct).toFixed(1)+"%";
  const valid=x.local_valid_fraction==null?"—":(Number(x.local_valid_fraction)*100).toFixed(0)+"%";
  return `${label}: ${dt} UTC • cloud ${cloud} • valid ${valid} • NBR ${dossierNum(x.nbr,3)} • NDVI ${dossierNum(x.ndvi,3)}`;
}
async function satelliteText(sb:any,q?:string){
  const {data,error}=await sb.rpc("firewatch_satellite_evidence",{p_query:q?.trim()||null});if(error)throw error;if(!data)return"Satellite Evidence: событие не найдено.";
  const e:any=data,b=e.before??null,a=e.after??null;
  const lines=[`🛰 Satellite Surface Evidence #${String(e.event_id).slice(0,8)}`,`Область: ${e.oblast??"—"}`,`Координаты: ${dossierNum(e.latitude,5)}, ${dossierNum(e.longitude,5)}`,`Статус: ${e.status??"pending"} • ROI ${e.roi_radius_m??500} м`,`Источник: ${e.provider??"Element84 Earth Search"} / ${e.collection??"sentinel-2-l2a"}`,"",satelliteSceneLine("До",b),satelliteSceneLine("После",a)];
  if(e.status==="waiting_after"){const nr=String(e.next_retry_at??"").slice(0,16).replace("T"," ");lines.push(`После: ожидается; следующий поиск ${nr||"после +24 ч"} UTC.`)}
  if(e.status==="pending")lines.push("Surface Evidence ещё не запрашивался для этого события.");
  if(e.dnbr!=null)lines.push("",`dNBR (до − после): ${Number(e.dnbr).toFixed(3)}`,`ΔNDVI (после − до): ${dossierNum(e.dndvi,3)}`,`Модуль спектрального изменения: ${e.spectral_change_magnitude??"—"}`);
  lines.push(`Визуализация: ${e.visual?.status==="ready"?"✅ готова":e.status==="ready"?"🟡 будет сформирована при запросе":"—"}`);
  if(b?.stac_url)lines.push("",`STAC до: ${b.stac_url}`);
  if(a?.stac_url)lines.push(`STAC после: ${a.stac_url}`);
  if(b?.thumbnail_url)lines.push(`Preview до: ${b.thumbnail_url}`);
  if(a?.thumbnail_url)lines.push(`Preview после: ${a.thumbnail_url}`);
  if(e.last_error)lines.push("",`Последняя ошибка: ${String(e.last_error).slice(0,500)}`);
  lines.push("","ℹ️ NBR/NDVI рассчитаны по локальной зоне с маской Sentinel-2 SCL. Это подтверждение изменения спектрального отклика поверхности, а не установление причины события.");
  return lines.join("\n").slice(0,3900);
}
async function ensureSatelliteEvidence(sb:any,q?:string){
  try{
    const {data:e,error}=await sb.rpc("firewatch_satellite_evidence",{p_query:q?.trim()||null});
    if(error||!e)return null;
    if(e.available&&e.status&&e.status!=="pending")return e;
    const {data:cronSecret,error:ce}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"firewatch_cron_secret"});
    if(ce||!cronSecret)return e;
    const base=Deno.env.get("SUPABASE_URL");if(!base)return e;
    const r=await fetch(base+"/functions/v1/firewatch-satellite-evidence",{
      method:"POST",
      headers:{"content-type":"application/json","x-cron-secret":String(cronSecret)},
      body:JSON.stringify({mode:"event",event_id:String(e.event_id)}),
      signal:AbortSignal.timeout(120000)
    });
    if(!r.ok)return e;
    return (await sb.rpc("firewatch_satellite_evidence",{p_query:String(e.event_id).slice(0,8)})).data??e;
  }catch{return null}
}
async function generateEventReport(sb:any,q?:string){
  const {data:e,error}=await sb.rpc("firewatch_dossier",{p_query:q?.trim()||null});
  if(error||!e?.event?.id)return null;
  const {data:cronSecret,error:ce}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"firewatch_cron_secret"});
  if(ce||!cronSecret)return null;
  const base=Deno.env.get("SUPABASE_URL");if(!base)return null;
  const r=await fetch(base+"/functions/v1/firewatch-event-report",{
    method:"POST",
    headers:{"content-type":"application/json","x-cron-secret":String(cronSecret)},
    body:JSON.stringify({event_id:String(e.event.id).slice(0,8)}),
    signal:AbortSignal.timeout(120000)
  });
  const j=await r.json();return r.ok&&j?.ok?j:null;
}
async function sendEventReport(sb:any,token:string,adminId:string,q?:string){
  await ensureSatelliteEvidence(sb,q);
  const r=await generateEventReport(sb,q);
  if(!r){await tg(token,"sendMessage",{chat_id:adminId,text:"📋 Не удалось сформировать отчёт события.",reply_markup:panelKeyboard});return false}
  const classes=Array.isArray(r.evidence_classes)?r.evidence_classes.join(", "):"—";
  const missing=Array.isArray(r.missing_classes)&&r.missing_classes.length?r.missing_classes.join(", "):"нет";
  const text=[
    `📋 EVENT EVIDENCE REPORT #${String(r.event_id).slice(0,8)}`,
    `Coverage: ${r.coverage_available}/${r.coverage_expected} классов данных`,
    `Доступно: ${classes}`,
    `Пока нет: ${missing}`,
    `Sentinel-2 Surface: ${r.surface_status??"pending"} • visual ${r.visual_status??"pending"}`,
    "",
    "Coverage показывает наличие классов данных, а не уверенность, опасность или причинную связь.",
    "Ссылки действуют 6 часов."
  ].join("\n");
  const kb={inline_keyboard:[
    [{text:"{} JSON",url:r.json_url}],
    [{text:"↩️ Админ-панель",callback_data:"admin:status"}]
  ]};
  if(r.html_download_url){
    const fr=await fetch(r.html_download_url,{signal:AbortSignal.timeout(20000)});
    if(!fr.ok)throw new Error(`report download HTTP ${fr.status}`);
    const bytes=new Uint8Array(await fr.arrayBuffer());
    await tgDocument(token,adminId,bytes,`event-report-${String(r.event_id).slice(0,8)}.html`,text,kb);
  }else{
    await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:kb,disable_web_page_preview:true});
  }
  return true;
}
async function sendSatelliteVisual(sb:any,token:string,adminId:string,q?:string){
  try{
    const {data:e,error}=await sb.rpc("firewatch_satellite_evidence",{p_query:q?.trim()||null});
    if(error||!e||e.status!=="ready")return false;
    const {data:cronSecret,error:ce}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"firewatch_cron_secret"});
    if(ce||!cronSecret)return false;
    const base=Deno.env.get("SUPABASE_URL");if(!base)return false;
    const r=await fetch(base+"/functions/v1/firewatch-satellite-visual",{
      method:"POST",
      headers:{"content-type":"application/json","x-cron-secret":String(cronSecret)},
      body:JSON.stringify({event_id:String(e.event_id)}),
      signal:AbortSignal.timeout(120000)
    });
    const j=await r.json();if(!r.ok||!j?.ok||!j?.signed_url)return false;
    const caption=`🛰 Sentinel-2 Surface Evidence • ID ${String(e.event_id).slice(0,8)}\nBEFORE / AFTER / SWIR / dNBR • ROI ~1×1 км\nСпектральное изменение поверхности; не причинная атрибуция.`;
    await tg(token,"sendPhoto",{chat_id:adminId,photo:j.signed_url,caption});
    return true;
  }catch{return false}
}
async function dossierText(sb:any,q?:string){
  const {data,error}=await sb.rpc("firewatch_dossier",{p_query:q?.trim()||null})
    .abortSignal(AbortSignal.timeout(7000));if(error)throw error;if(!data)return"Досье: событие не найдено.";
  const d:any=data,e=d.event??{},sat=d.satellite??{},surf=d.satellite_surface??{},atm=d.atmosphere??{},geo=d.geospatial??{},inf=d.infrastructure??{},ground=d.ground??{},ext=d.external_osint??{},pub=d.public_osint??{},air=d.air_threat_context??{},hist=d.history??{},pri=d.priority??{};
  const flags:string[]=Array.isArray(d.context_flags)?d.context_flags:[],classes:string[]=Array.isArray(d.evidence_classes)?d.evidence_classes:[],infra:any[]=Array.isArray(inf.features)?inf.features:[];
  const duration=Number(e.duration_minutes??0),durationText=duration>=60?(duration/60).toFixed(1)+" ч":Math.round(duration)+" мин";
  const declared=Array.isArray(sat.declared_sources)?sat.declared_sources.join(", "):"—";
  const lines:string[]=[
    `📑 EVENT OSINT DOSSIER #${String(e.id).slice(0,8)}`,
    `Область: ${e.oblast??"—"}`,
    `Координаты: ${dossierNum(e.latitude,5)}, ${dossierNum(e.longitude,5)}`,
    `Период: ${String(e.first_seen??"").slice(0,16).replace("T"," ")} → ${String(e.last_seen??"").slice(0,16).replace("T"," ")} UTC • ${durationText}`,
    `Наблюдений: ${e.observation_count??0} • спутниковых платформ: ${sat.source_count??0}`,
    `Источники: ${declared}`,
    `Уверенность детекции: ${e.confidence_label??e.confidence_level??"—"}`,
    `🚦 Приоритет просмотра: ${Number(pri.score??0)}/100 • ${pri.label??pri.level??"—"}`,
    "",
    `🔥 FRP max: ${dossierNum(sat.frp_max_mw,1)} МВт • avg: ${dossierNum(sat.frp_avg_mw,1)} МВт • тренд: ${sat.frp_trend??"—"}`,
    `Кластер: ${sat.cluster_diameter_m==null?"—":Math.round(Number(sat.cluster_diameter_m))+" м"}`,
    "",
    `🛰 Sentinel-2 Surface: ${surf.status??"pending"}`,
    satelliteSceneLine("До",surf.before),
    surf.after?satelliteSceneLine("После",surf.after):surf.status==="waiting_after"?`После: ожидается • следующий поиск ${String(surf.next_retry_at??"").slice(0,16).replace("T"," ")} UTC`:satelliteSceneLine("После",surf.after)
  ];
  if(surf.dnbr!=null)lines.push(`dNBR ${Number(surf.dnbr).toFixed(3)} • ΔNDVI ${dossierNum(surf.dndvi,3)} • ${surf.spectral_change_magnitude??"—"}`);
  if(surf.visual?.status==="ready")lines.push("Visual evidence: ✅ cached");
  lines.push("",`🗺 Контекст: ${geo.context_type??"—"} • ближайший ${geo.nearest_feature??"—"} ${geo.nearest_feature_distance_m==null?"":("("+Math.round(Number(geo.nearest_feature_distance_m))+" м)")}`,`⚙️ Инфраструктура: ${inf.feature_count??0} объектов`);
  for(const x of infra.slice(0,4)){const dist=Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км",detail=infraProfileText(x);lines.push(`• ${x.infra_label??x.infra_type}: ${x.name??"—"} • ${dist}${detail?" • "+detail:""}`)}
  lines.push("",`🌫 Атмосфера: ${atm.signal_level??"—"} • CAMS PM2.5 ${dossierNum(atm.cams_pm2_5_ug_m3,1)} µg/m³ • CO ${dossierNum(atm.cams_co_ug_m3,0)} µg/m³`);
  if(atm.s5p_co_mol_m2!=null)lines.push(`Sentinel-5P CO: ${dossierNum(atm.s5p_co_mol_m2,4)} mol/m²`);
  lines.push(`Наземные станции: ${ground.station_count??0} • внешние OSINT-источники: ${ext.source_count??0}`);
  const news:any[]=Array.isArray(pub.news)?pub.news:[],alerts:any[]=Array.isArray(pub.air_alert_context)?pub.air_alert_context:[],tg:any[]=Array.isArray(pub.telegram)?pub.telegram:[];
  lines.push("",`📰 Public OSINT: новости ${pub.news_count??0} • TG ${pub.telegram_count??0} • air-alert ${pub.air_alert_context_count??0}`);
  for(const x of news.slice(0,3)){
    const when=x.published_at?String(x.published_at).slice(0,16).replace("T"," ")+" UTC":"—";
    lines.push(`• [NEWS/${x.source??"source"}] ${String(x.title??"—").slice(0,170)}\n  ${when} • relevance ${Number(x.relevance_score??0)}/100`);
  }
  for(const x of tg.slice(0,4)){
    const when=x.published_at?String(x.published_at).slice(0,16).replace("T"," ")+" UTC":"—";
    const scope=x?.match_basis?.location?.kind==="nearest_place"?"local":"regional";
    lines.push(`• [TG/${x.source??"channel"} • ${scope}] ${String(x.title??"—").replace(/\s+/g," ").slice(0,190)}\n  ${when} • relevance ${Number(x.relevance_score??0)}/100`);
  }
  for(const x of alerts.slice(0,2)){
    lines.push(`• [AIR ALERT] ${String(x.title??"—").slice(0,180)} • ${x.observed_at?String(x.observed_at).slice(0,16).replace("T"," ")+" UTC":"—"}`);
  }
  const airTracks:any[]=Array.isArray(air.tracks)?air.tracks:[];
  lines.push("",`✈️ Neptun air-threat context: ${air.count??0}`);
  for(const x of airTracks.slice(0,4)){
    const d=Number(x.nearest_distance_m??0),dist=d<1000?Math.round(d)+" м":(d/1000).toFixed(1)+" км";
    const off=Number(x.time_offset_seconds??0),offm=Math.round(Math.abs(off)/60),when=off===0?"одновременно":off<0?`${offm} мин до FIRMS`:`${offm} мин после FIRMS`;
    const conf=Number.isFinite(Number(x.confidence_0_100))?` • confidence ${Math.round(Number(x.confidence_0_100))}/100`:"";
    const head=Number.isFinite(Number(x.heading_deg))?` • курс ${Math.round(Number(x.heading_deg))}°`:"";
    lines.push(`• ${x.label??x.type??"air threat"} • ${dist} • ${when}${head}${conf}`);
  }
  lines.push("",`🕓 История: 30д ${hist.events_30d??0} • 90д ${hist.events_90d??0} • 365д ${hist.events_365d??0} • класс ${hist.hotspot_class??"—"}`);
  lines.push("",`Классы доказательств: ${classes.length?classes.join(", "):"—"}`);
  if(flags.length){lines.push("Контекст-флаги:",...flags.slice(0,12).map(x=>"• "+(DOSSIER_FLAG_LABELS[x]??x)))}
  if(inf.openinframap_url)lines.push("",`OpenInfraMap: ${inf.openinframap_url}`);
  lines.push("","ℹ️ Досье агрегирует публичные наблюдения. Новости, воздушные тревоги, треки Neptun, географические совпадения, флаги и спектральные метрики являются контекстом и не устанавливают причину тепловой аномалии.");
  return lines.join("\n").slice(0,3900);
}
function infraProfileText(x:any){const p=x?.profile??{},parts:string[]=[];const add=(label:string,v:any)=>{if(v!=null&&String(v)!=="")parts.push(label+" "+String(v).slice(0,80))};if(p.voltage){const v=Number(String(p.voltage).split(";")[0]);add("U:",Number.isFinite(v)?(v>=1000?(v/1000).toFixed(v%1000?1:0)+" кВ":v+" В"):p.voltage)}add("цепей:",p.circuits);add("f:",p.frequency);add("мощн.:",p.output);add("источник:",p.source);add("вещество:",p.substance);add("usage:",p.usage);add("Ø:",p.diameter);add("P:",p.pressure);add("оператор:",p.operator);add("ref:",p.ref);return parts.join(" • ")}
async function geoText(sb:any,q?:string){
  const [{data,error},{data:stRow},{data:ghRow}]=await Promise.all([
    sb.rpc("firewatch_geo_context",{p_query:q?.trim()||null}),
    sb.from("system_state").select("value").eq("key","monitor_geo_osint").maybeSingle(),
    sb.from("system_state").select("value").eq("key","monitor_ghsl").maybeSingle()
  ]);
  if(error)throw error;
  const st=stRow?.value??{},ghst=ghRow?.value??{};
  if(!data)return"Геоконтекст: событие не найдено.";
  const e:any=data,rows:any[]=Array.isArray(e.features)?e.features:[],infra:any[]=Array.isArray(e.infrastructure_features)?e.infrastructure_features:[],cats=e.categories??{},infraCounts=e.infrastructure_counts??{},rings=e.infrastructure_rings??{},flags:any[]=Array.isArray(e.infrastructure_context_flags)?e.infrastructure_context_flags:[],gh=e.ghsl??null;
  const catText=Object.entries(cats).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).slice(0,8).map(([k,v])=>`${k}: ${v}`).join(" • ");
  const infraNames=new Map(infra.map((x:any)=>[String(x.infra_type),String(x.infra_label??x.infra_type)]));
  const infraCountText=Object.entries(infraCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).slice(0,8).map(([k,v])=>`${infraNames.get(String(k))??k}: ${v}`).join(" • ");
  const ringText=[500,1000,2000,5000,10000].map(r=>`${r<1000?r+"м":r/1000+"км"} ${Number(rings?.[String(r)]?.total??0)}`).join(" • ");
  const flagMap:Record<string,string>={
    near_power_line_500m:"ЛЭП ≤500 м",near_power_infrastructure_2km:"энергоинфра ≤2 км",
    near_pipeline_1km:"трубопровод ≤1 км",near_petroleum_infrastructure_2km:"нефтегаз ≤2 км",
    near_industrial_2km:"промзона ≤2 км",major_power_5km:"ВН энергетика ≤5 км",
    telecom_infrastructure_1km:"телеком ≤1 км",water_infrastructure_1km:"водная инфра ≤1 км"
  };
  const head=[
    `🗺 Geo / Infrastructure OSINT #${String(e.id).slice(0,8)}`,
    `Область: ${e.oblast??"—"}`,
    `Координаты: ${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`,
    `Geo worker: ${st.status??"—"} • ${ageText(st.last_check)}`,
    `GHSL: ${ghst.status??"—"} • ${ageText(ghst.last_check)}`,
    `Кэш OSM: ${e.cache_available?"✅ есть":"—"} • радиус ${Math.round(Number(e.query_radius_m??10000)/1000)} км • ${e.queried_at?ageText(e.queried_at):"нет снимка"}`,
    e.endpoint?`Источник OSM: ${String(e.endpoint).replace("https://","")} • ${e.endpoint_method??"—"}`:null,
    `OSM-объектов: ${e.feature_count??0} • общий контекст: ${e.context_type??"не определён"}`,
    e.nearest_feature?`Ближайший объект: ${e.nearest_feature} • ${Math.round(Number(e.nearest_feature_distance_m??0))} м`:null,
    e.infra_profile_version?`Инфраструктура: ${e.infra_profile_version}`:null,
    infraCountText?`Инфра-классы: ${infraCountText}`:null,
    ringText?`Инфра по радиусам: ${ringText}`:null
  ].filter(Boolean);
  if(flags.length)head.push(`Контекст-флаги: ${flags.map((x:any)=>flagMap[String(x)]??String(x)).join(" • ")}`);
  if(gh){
    const n=(x:any)=>Number.isFinite(Number(x))?Math.round(Number(x)).toLocaleString("ru-RU"):"—";
    const p=(x:any)=>Number.isFinite(Number(x))?Number(x).toFixed(2)+"%":"—";
    head.push("","👥 GHSL — население и застройка:",`Эпоха: ${gh.epoch??2025} • ${gh.resolution??"~1 км"}`,`Население ≈ 1 км: ${n(gh.population_1km)} • 5 км: ${n(gh.population_5km)} • 10 км: ${n(gh.population_10km)}`,`Застройка ≈ 1 км: ${p(gh.built_fraction_1km_pct)} • 5 км: ${p(gh.built_fraction_5km_pct)} • 10 км: ${p(gh.built_fraction_10km_pct)}`,`Ячейка события: население ~${n(gh.population_cell)} • built-up ${n(gh.built_surface_cell_m2)} м²`);
    if(gh.last_error)head.push(`GHSL ошибка: ${String(gh.last_error).slice(0,300)}`);
  }
  if(e.last_error)head.push("",`Последняя ошибка OSM: ${String(e.last_error).slice(0,500)}`);
  head.push("","⚙️ Инфраструктурный профиль:");
  if(!infra.length)head.push("В радиусе не найдено объектов инфраструктуры из текущей OpenInfraMap-совместимой таксономии.");
  else{
    for(const [i,x] of infra.slice(0,10).entries()){
      const dist=Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км",detail=infraProfileText(x);
      head.push(`${i+1}. [${x.infra_label??x.infra_type}] ${x.name??"—"} • ${dist}${detail?"\n   "+detail:""}`);
    }
  }
  const general=rows.filter((x:any)=>!x.infra_type);
  if(general.length){
    head.push("","🧭 Прочий геоконтекст:");
    for(const [i,x] of general.slice(0,5).entries())head.push(`${i+1}. [${x.label??x.category}] ${x.name??"—"} • ${Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км"}`);
  }
  if(catText)head.push("",`Все категории: ${catText}`);
  head.push("","ℹ️ GHSL: European Commission JRC, GHS-POP/GHS-BUILT-S. Инфраструктура: © OpenStreetMap contributors через Geofabrik Postpass, таксономия адаптирована по OpenInfraMap. Значения GHSL в радиусах приблизительные из-за разрешения ~1 км. Близость инфраструктуры не доказывает причинную связь.");
  return head.join("\n").slice(0,3900);
}
async function groundText(sb:any,q?:string){const [{data,error},{data:stRow}]=await Promise.all([sb.rpc("firewatch_ground_context",{p_query:q?.trim()||null}),sb.from("system_state").select("value").eq("key","monitor_ground_osint").maybeSingle()]);if(error)throw error;const st=stRow?.value??{};if(!data)return"Наземные датчики: событие не найдено.";const e:any=data,rows:any[]=Array.isArray(e.measurements)?e.measurements:[];const head=[`🌫 Ground OSINT #${String(e.id).slice(0,8)}`,`Область: ${e.oblast??"—"}`,`Координаты: ${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`,`Станций в контексте: ${e.station_count??0} • источников: ${e.source_count??0}`,`Worker: ${st.status??"—"} • проверка ${ageText(st.last_check)}`,`Sensor.Community: ${st.sensor_community?.error?"⚠️ ошибка":"✅ live"} • OpenAQ: ${st.openaq?.configured?"✅ configured":"🟡 нужен API key"} • SaveEcoBot allow-list: ${st.saveecobot?.registry_sources??0}`];if(!rows.length)head.push("","Подходящих наземных измерений в радиусе 25 км и окне ±12 ч не найдено.");else{head.push("");for(const [i,x] of rows.entries()){const dist=x.distance_km==null?"—":Number(x.distance_km).toFixed(1)+" км",dt=x.time_delta_h==null?"—":Number(x.time_delta_h).toFixed(1)+" ч",val=Number.isFinite(Number(x.value))?Number(x.value).toFixed(2):String(x.value??"—");head.push(`${i+1}. [${x.source}] ${x.station_name??x.station_id}\n   ${x.parameter}: ${val}${x.unit?" "+x.unit:""} • ${dist} • Δt ${dt}\n   ${String(x.observed_at??"").slice(0,16).replace("T"," ")} UTC${x.is_old?" • устаревшее":""}`)}}head.push("","ℹ️ Наземные измерения — независимый экологический контекст и не доказывают связь загрязнения с конкретной тепловой аномалией.");return head.join("\n").slice(0,3900)}
async function osintText(sb:any,q?:string){const [{data,error},{data:stRow}]=await Promise.all([sb.rpc("firewatch_osint_event_detail",{p_query:q?.trim()||null}),sb.from("system_state").select("value").eq("key","monitor_osint").maybeSingle()]);if(error)throw error;const st=stRow?.value??{};if(!data)return"OSINT: событие не найдено.";const e:any=data,rows:any[]=Array.isArray(e.evidence)?e.evidence:[];const head=[`🔎 OSINT #${String(e.id).slice(0,8)}`,`Область: ${e.oblast??"—"}`,`Координаты: ${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`,`Независимых OSINT-источников: ${e.source_count??0} • записей: ${e.evidence_count??0}`,`Worker: ${st.status??"—"} • ${ageText(st.last_success_run)}`];if(!rows.length)head.push("","Связанных публичных OSINT-событий в текущем пространственно-временном окне не найдено.");else{head.push("");for(const [i,x] of rows.entries()){const dist=x.distance_km==null?"—":Number(x.distance_km).toFixed(1)+" км",dt=x.time_delta_h==null?"—":Number(x.time_delta_h).toFixed(1)+" ч";head.push(`${i+1}. [${x.source}] ${String(x.title??"").slice(0,180)}\n   ${String(x.observed_at??"").slice(0,16).replace("T"," ")} UTC • ${dist} • Δt ${dt}\n   ${x.category??"—"} • ${x.correlation_class??"unmatched"}${x.source_url?`\n   Источник: ${String(x.source_url).slice(0,900)}`:""}`)}}head.push("","ℹ️ Пространственно-временная корреляция — контекст OSINT, а не доказательство причинной связи.");return head.join("\n").slice(0,3900)}
async function integrityText(sb:any){
  const {data,error}=await sb.rpc("firewatch_notification_integrity_summary");if(error)throw error;
  const state:any=data?.state??{},findings:any[]=Array.isArray(data?.findings)?data.findings:[];
  const lines=[
    "🧪 Notification Integrity / Stage 30.2",
    `Статус: ${state.status??"—"}`,
    `Проверка: ${ageText(state.last_success_run)}`,
    `Ошибки: ${Number(state.errors??0)} • предупреждения: ${Number(state.warnings??0)} • info: ${Number(state.info??0)}`,
    "",
    `Notification gaps: ${Number(state.notification_gaps??0)}`,
    `Delivery backlog >45 мин: ${Number(state.delivery_backlog??0)}`,
    `MTG support-only: ${Number(state.support_only_mtg??0)}`,
    `Sentinel-3 support-only: ${Number(state.support_only_sentinel3??0)}`,
    `MTG + Sentinel-3 support-only: ${Number(state.support_only_multi_sensor??0)}`,
    `Historical suppressed: ${Number(state.historical_suppressed??0)}`
  ];
  const important=findings.filter((x:any)=>x.severity==="error"||x.severity==="warning").slice(0,10);
  if(important.length){
    lines.push("","Требуют внимания:");
    for(const x of important){
      lines.push(`• #${String(x.event_id).slice(0,8)} • ${x.class} • ${String(x.last_detection??"").slice(0,16).replace("T"," ")} UTC`);
    }
  }else lines.push("","✅ Пропусков/зависшей доставки по правилам Stage 30.2 не обнаружено.");
  lines.push("","ℹ️ support-only и historical — информационные категории, а не ошибки. Они не публикуются автоматически без действующего правила подтверждения.");
  return lines.join("\n").slice(0,3900);
}
function parseSearchArgs(raw:string){
  const out:any={};
  for(const token of raw.trim().split(/\s+/).filter(Boolean)){
    const i=token.indexOf("=");if(i<1)continue;
    const k=token.slice(0,i).toLowerCase(),v=token.slice(i+1).trim();if(!v)continue;
    if(["id","oblast","status","source","surface","flag","from","to"].includes(k))out[k]=v;
    else if(k==="min_frp")out.min_frp=Number(v);
    else if(k==="min_obs"||k==="obs")out.min_obs=Number(v);
    else if(k==="min_platforms"||k==="platforms")out.min_platforms=Number(v);
    else if(k==="limit")out.limit=Math.min(50,Math.max(1,Number(v)));
    else if(k==="sent")out.sent=["1","true","yes","да"].includes(v.toLowerCase());
    else if(k==="radius"||k==="radius_km"||k==="r")out.radius_km=Number(v.replace(",","."));
    else if(k==="coord"||k==="coords"||k==="center"){
      const m=v.replace(";",",").split(",");
      if(m.length===2){out.lat=Number(m[0]);out.lon=Number(m[1])}
    }
    else if(k==="lat")out.lat=Number(v.replace(",","."));
    else if(k==="lon"||k==="lng")out.lon=Number(v.replace(",","."));
  }
  if(out.lat!=null&&out.lon!=null&&out.radius_km==null)out.radius_km=10;
  return out;
}
async function searchText(sb:any,arg:string){
  const filters=parseSearchArgs(arg);
  if(!Object.keys(filters).length)return [
    "🔎 Поиск событий",
    "",
    "📍 По координате — ручной ввод:",
    "/search coord=47.87557,37.67172 radius=10",
    "",
    "Дополнительно история FIRMS:",
    "/nearby 47.87557 37.67172",
    "",
    "Радиус поиска задаётся в километрах: 0.1–500 км.",
    "Если radius не указан, используется 10 км.",
    "",
    "🧩 Комбинированный пример:",
    "/search coord=47.87557,37.67172 radius=25 min_frp=20 platforms=2 limit=20",
    "",
    "Доступные фильтры: id, oblast, status, from, to, min_frp, min_obs, platforms, source, surface, flag, sent, coord, radius, limit"
  ].join("\n");
  if(("lat" in filters)!==("lon" in filters))return "⚠️ Координата должна содержать широту и долготу. Пример:\n/search coord=47.87557,37.67172 radius=10";
  if(filters.lat!=null&&(!Number.isFinite(filters.lat)||!Number.isFinite(filters.lon)))return "⚠️ Не удалось распознать координату. Используйте точку как десятичный разделитель:\n/search coord=47.87557,37.67172 radius=10";
  if(filters.radius_km!=null&&(!Number.isFinite(filters.radius_km)||filters.radius_km<0.1||filters.radius_km>500))return "⚠️ Радиус должен быть от 0.1 до 500 км.";
  const {data,error}=await sb.rpc("firewatch_search_events",{p_filters:filters});if(error)throw error;
  const ev:any[]=Array.isArray(data?.events)?data.events:[];
  const geo:any=data?.geo??null;
  const lines=[geo
    ? `📍 Поиск вокруг ${Number(geo.lat).toFixed(5)}, ${Number(geo.lon).toFixed(5)} • R=${Number(geo.radius_km)} км • найдено ${Number(data?.count??0)}`
    : `🔎 Поиск событий • найдено ${Number(data?.count??0)}`];
  for(const e of ev.slice(0,20)){
    const dist=e.distance_km==null?"":` • 📏 ${Number(e.distance_km).toFixed(Number(e.distance_km)<10?2:1)} км`;
    lines.push("",
      `#${String(e.id).slice(0,8)} • ${e.oblast??"—"}${dist}`,
      `${String(e.last_seen??"").slice(0,16).replace("T"," ")} UTC • FRP max ${e.max_frp==null?"—":Number(e.max_frp).toFixed(1)+" MW"}`,
      `obs ${Number(e.observation_count??0)} • platforms ${Number(e.multisource_count??0)} • ${e.lifecycle_status??e.status??"—"}`,
      `Surface ${e.surface_status??"pending"} • Telegram ${e.telegram_sent?"yes":"no"}`,
      `/event ${String(e.id).slice(0,8)} • /dossier ${String(e.id).slice(0,8)}`
    );
  }
  if(!ev.length)lines.push("","Совпадений в заданном радиусе нет.");
  return lines.join("\n").slice(0,3900);
}
async function analyticsText(sb:any,hours=24){
  const h=Math.max(1,Math.min(8760,Number(hours)||24));
  const {data,error}=await sb.rpc("firewatch_analytics_summary",{p_hours:h});if(error)throw error;
  const e:any=data?.events??{},frp:any=data?.frp??{},oblasts:any[]=Array.isArray(data?.by_oblast)?data.by_oblast:[],src:any[]=Array.isArray(data?.by_source)?data.by_source:[];
  const q:any=data?.quality??{},ni=q.notification_integrity??{},sc=q.source_coverage??{},bl=q.source_baseline??{},gi=q.geo_integrity??{};
  const lines=[
    `📈 Analytics / Stage 31 • ${h} ч`,
    `Новые события: ${Number(e.new??e.total??0)} • active ${Number(e.active??0)} • closed ${Number(e.closed??0)}`,
    `Обновлялись в окне: ${Number(e.touched??0)} • active ${Number(e.touched_active??0)} • closed ${Number(e.touched_closed??0)}`,
    `Telegram отправлено в окне: ${Number(e.telegram_sent??0)} • multisource новых: ${Number(e.multisource??0)} • surface ready новых: ${Number(e.surface_ready??0)}`,
    `FRP детекций окна: max ${frp.max_mw==null?"—":Number(frp.max_mw).toFixed(1)+" MW"} • avg ${frp.avg_mw==null?"—":Number(frp.avg_mw).toFixed(1)+" MW"} • detections ${Number(frp.detections??0)}`,
    "",
    "Все области по новым событиям:"
  ];
  for(const x of oblasts)lines.push(`• ${x.oblast}: ${x.events}`);
  lines.push("","Источники по детекциям:");
  for(const x of src.slice(0,8))lines.push(`• ${x.source}: ${x.detections}`);
  lines.push("",
    `Integrity: gaps ${Number(ni.notification_gaps??0)} • backlog ${Number(ni.delivery_backlog??0)}`,
    `Coverage: active ${Number(sc.sources_active??0)}/${Number(sc.sources_total??0)} • degraded ${Number(sc.sources_degraded??0)}`,
    `Geo integrity: ${gi.status??"—"} • missing ${Number(gi.missing_in_db??0)}`,
    `Baseline: ${bl.status??"—"} • watch ${Number(bl.sources_watch??0)} • anomaly ${Number(bl.sources_anomaly??0)}`
  );
  return lines.join("\n").slice(0,3900);
}


async function deepOsintText(sb:any,q?:string){
  const {data,error}=await sb.rpc("firewatch_deep_osint",{p_query:q?.trim()||null})
    .abortSignal(AbortSignal.timeout(7000));
  if(error)throw error;
  if(!data)return "🧠 Deep OSINT: событие не найдено.";
  const e:any=data.event??{},s:any=data.summary??{},eff:any=data.effis??{},air:any=data.air_context??{},al:any=air.air_alert??{},th:any=air.public_air_threat_context??{},geo:any=data.geolocation??{},ov:any=geo.overture??{},gn:any=geo.geonames??{},vis:any=data.visual_context??{},pano:any=vis.panoramax??{},oam:any=vis.openaerialmap??{},env:any=data.environment_context??{},radar:any=env.radar??{},li:any=env.lightning??{},prov:any=data.provenance??{},sem:any=data.semantic??{},ss:any=sem.summary??{},src:any[]=Array.isArray(data.sources)?data.sources:[],tl:any[]=Array.isArray(data.timeline)?data.timeline:[];
  const items=Number(ss.items??0),providers=Number(ss.providers??0),classes=Number(ss.source_classes??0);
  const geoSupported=Number(ss.geo_supported??0),duplicates=Number(ss.duplicate_items??0),divergences=Number(ss.divergences??0);
  const lines=[
    `🧠 Deep OSINT / Stage 40 #${String(e.id??"").slice(0,8)}`,
    `Priority ${Number(e.priority_score??0)}/100 • confidence ${e.confidence_level??"—"}`,
    "",
    "📚 Evidence summary",
    `Items ${items} • providers ${providers} • source classes ${classes}`,
    `Independent corroboration: ${s.corroboration_level??"none"}`,
    `Geo supported ${geoSupported}/${items} • duplicates ${duplicates} • divergences ${divergences}`,
    `Technical: Fusion ${Number(s.fusion_documents??0)} • public ${Number(s.public_osint??0)} • legacy ${Number(s.legacy_external??0)}`,
    String(eff.status??"not_cached")==="not_cached"
      ?"EFFIS not cached • not yet processed in current priority batch"
      :`EFFIS ${eff.status??"—"} • FWI ${eff.fwi_value==null?"—":Number(eff.fwi_value).toFixed(1)} • active ${Number(eff.active_fire_count??0)} • burnt-area ${Number(eff.burnt_area_count??0)}`,
    `Air alert: ${al.relation??"—"} • history ${al.history_available===false?"unavailable":"available"}`,
    `Public air-threat: ${th.present?"present":"none"} • ${Array.isArray(th.threat_types)?th.threat_types.join(", "):"—"} • ${th.time_relation??"—"}`,
    `Geolocation: Overture ${ov.status??"not_cached"} • release ${ov.release??"—"} • tiles ${Number(ov.tiles_ok??0)}/${Number(ov.tiles_total??0)} • places ${Array.isArray(ov.places)?ov.places.length:0}`,
    `GeoNames: ${gn.status??"not_cached"} • places ${Array.isArray(gn.places)?gn.places.length:0}`,
    ...(Array.isArray(gn.places)?gn.places.slice(0,5).map((p:any)=>{const code=String(p.feature_code??"");const type=code==="PPLA"?"административный центр":code==="PPLA2"?"адм. центр уровня 2":code==="PPLA3"?"адм. центр уровня 3":code==="PPLA4"?"адм. центр уровня 4":code==="PPL"?"населённый пункт":String(p.feature_code_name??p.feature_class_name??code??"место");return `• ${p.name??p.toponym_name??"—"}${p.toponym_name&&p.toponym_name!==p.name?" ("+p.toponym_name+")":""} • ${Number.isFinite(Number(p.distance_km))?Number(p.distance_km).toFixed(1)+" км":"—"} • ${type}`;}):[]),
    `Visual: Panoramax ${Number(pano.count??0)} • OAM ${Number(oam.count??0)} • latest OAM ${oam.latest_datetime?String(oam.latest_datetime).slice(0,10):"—"}`,
    `Environment: RainViewer ${radar.status??"not_cached"}${radar.time_delta_minutes!=null?" • Δt "+Number(radar.time_delta_minutes).toFixed(1)+" min":""} • MTG LI ${li.status==="disabled"?"disabled":(li.status??"not_cached")}`,
    `Provenance: statements ${Number(prov.statements??0)} • independent ${Number(prov.independent_statements??0)} • reviewed ${Number(prov.reviewed??0)} • pending ${Number(prov.pending_reviews??0)} • high ${Number(prov.high_priority_reviews??0)}`,
    ""
  ];
  if(src.length){
    lines.push("Fusion sources:");
    for(const x of src.slice(0,10))lines.push(`• ${x.label??x.source} • ${x.source_class??"—"} • max ${Number(x.max_relevance??0)}/100 • evidence ${Number(x.evidence_count??0)}`);
    lines.push("");
  }
  lines.push("Timeline:");
  for(const x of tl.slice(0,16)){
    const dist=x.distance_m==null?"":` • ${Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км"}`;
    const when=x.observed_at?String(x.observed_at).slice(0,16).replace("T"," ")+" UTC":"—";
    lines.push(`• [${x.source_label??x.source??"source"}] ${String(x.title??"—").replace(/\s+/g," ").slice(0,170)}`);
    lines.push(`  ${when} • relevance ${Number(x.relevance_score??0)}/100${dist}`);
  }
  if(!tl.length)lines.push("Пока нет связанных OSINT-документов.");
  lines.push("","Корреляция контекстная и не устанавливает причинность или атрибуцию.");
  return lines.join("\n").slice(0,3900);
}
async function deepOsintData(sb:any,q?:string){
  const {data,error}=await sb.rpc("firewatch_deep_osint",{p_query:q?.trim()||null})
    .abortSignal(AbortSignal.timeout(7000));
  if(error)throw error;
  return data;
}
function httpsUrl(v:any){
  const s=String(v??"").trim();
  try{const u=new URL(s);return u.protocol==="https:"?u.toString():null}catch{return null}
}
async function sendVisualPreviews(token:string,chatId:number,d:any){
  const vis=d?.visual_context??{},pano=vis?.panoramax??{},oam=vis?.openaerialmap??{};
  const rows:any[]=[];
  const p=(Array.isArray(pano?.items)?pano.items:[]).find((x:any)=>httpsUrl(x?.thumbnail));
  if(p)rows.push({source:"Panoramax",photo:httpsUrl(p.thumbnail),original:httpsUrl(p.image_url)??httpsUrl(p.self_url),caption:`🖼 Panoramax${p.distance_m!=null?" • "+Math.round(Number(p.distance_m))+" м":""}${p.datetime?" • "+String(p.datetime).slice(0,10):""}\nStreet-level visual reference`});
  const o=(Array.isArray(oam?.items)?oam.items:[]).find((x:any)=>httpsUrl(x?.thumbnail));
  if(o)rows.push({source:"OpenAerialMap",photo:httpsUrl(o.thumbnail),original:httpsUrl(o.self_url)??httpsUrl(o.image_href),caption:`🛰 OpenAerialMap${o.datetime?" • "+String(o.datetime).slice(0,10):""}${o.platform?" • "+String(o.platform):""}${o.gsd!=null?" • GSD "+String(o.gsd):""}\nAerial visual reference`});
  for(const x of rows.slice(0,2)){
    try{
      const body:any={chat_id:chatId,photo:x.photo,caption:String(x.caption).slice(0,900)};
      if(x.original)body.reply_markup={inline_keyboard:[[{text:"Открыть оригинал",url:x.original}]]};
      await tg(token,"sendPhoto",body);
    }catch(e){console.error("admin visual preview failed:",x.source,e instanceof Error?e.message:String(e))}
  }
}

async function priorityText(sb:any,hours=24,minScore=0){
  const h=Math.max(1,Math.min(8760,Number(hours)||24));
  const min=Math.max(0,Math.min(100,Number(minScore)||0));
  const {data,error}=await sb.rpc("firewatch_priority_events",{p_hours:h,p_limit:20,p_min_score:min})
    .abortSignal(AbortSignal.timeout(5000));
  if(error)throw error;
  const ev:any[]=Array.isArray(data?.events)?data.events:[];
  const lines=[`🚦 Event Priority / Stage 39 • ${h} ч • min ${min}`,`Событий: ${ev.length}`];
  for(const e of ev){
    const icon=e.priority_level==="high"?"🔴":e.priority_level==="elevated"?"🟠":e.priority_level==="normal"?"🟡":"⚪";
    lines.push("",
      `${icon} #${String(e.id??"").slice(0,8)} • ${e.oblast??"—"} • ${Number(e.priority_score??0)}/100`,
      `FRP ${e.frp_latest_avg==null?"—":Number(e.frp_latest_avg).toFixed(1)+" MW"} • obs ${Number(e.observation_count??0)} • platforms ${Number(e.multisource_count??0)} • ${e.frp_trend??"—"}`,
      e.nearest_place_name?`${e.nearest_place_name}${e.nearest_place_distance_km==null?"":" • "+Number(e.nearest_place_distance_km).toFixed(1)+" км"}`:"",
      `/dossier ${String(e.id??"").slice(0,8)}`
    );
  }
  if(!ev.length)lines.push("","Событий по фильтру нет.");
  lines.push("","Priority — очередь просмотра оператора. Не является оценкой причины, намерения или военной значимости.");
  return lines.join("\n").slice(0,3900);
}

async function coverageText(sb:any){
  const [{data,error},{data:base,error:be},{data:geo,error:ge}]=await Promise.all([
    sb.rpc("firewatch_source_coverage_summary"),
    sb.rpc("firewatch_source_baseline_summary"),
    sb.rpc("firewatch_geo_integrity_summary")
  ]);
  if(error)throw error;if(be)throw be;
  const state:any=data?.state??{},sources:any[]=Array.isArray(data?.sources)?data.sources:[],baseState:any=base?.state??{},baseSources:any[]=Array.isArray(base?.sources)?base.sources:[],baseBy=new Map(baseSources.map((x:any)=>[x.source_id,x]));
  const gs:any=ge?{}:(geo?.state??{}),go:any[]=ge?[]:(Array.isArray(geo?.oblasts)?geo.oblasts:[]);
  const lines=[
    "📡 Source Coverage / Stage 30.3 + Geo Integrity / Stage 33.4",
    `Статус: ${state.status??"—"}`,
    `Проверка: ${ageText(state.last_success_run)}`,
    `Источники: active ${Number(state.sources_active??0)}/${Number(state.sources_total??0)} • degraded ${Number(state.sources_degraded??0)}`,
    `FIRMS registry: ${state.registry_status??"—"}`,
    `Baseline: ${baseState.status??"—"} • learning ${Number(baseState.sources_learning??0)} • watch ${Number(baseState.sources_watch??0)} • anomaly ${Number(baseState.sources_anomaly??0)}`,
    ge?"Geo integrity: недоступен":`Geo integrity: ${gs.status??"—"} • API ${Number(gs.api_recent??0)} → inside ${Number(gs.inside_ukraine??0)} → DB ${Number(gs.db_matched??0)} • missing ${Number(gs.missing_in_db??0)}`,
    ""
  ];
  for(const x of sources){
    const bx:any=baseBy.get(x.source_id)??{};
    const icon=x.status!=="active"?"⚠️":bx.status==="anomaly"?"🔴":bx.status==="watch"?"🟡":bx.status==="normal"?"✅":"🧪";
    const fetch=x.fetched_last_run==null?"—":String(x.fetched_last_run);
    const recent=x.recent_last_run==null?"—":String(x.recent_last_run);
    const upstream=x.upstream_age_minutes==null?"—":Number(x.upstream_age_minutes).toFixed(0)+" мин";
    lines.push(`${icon} ${x.label} • ${x.status} • baseline ${bx.status??"—"}`);
    lines.push(`   worker ${x.worker_age_minutes==null?"—":Number(x.worker_age_minutes).toFixed(0)+" мин"} • upstream ${upstream} • fetch ${fetch}/recent ${recent}`);
    lines.push(`   detections: 1ч ${Number(x.detections_1h??0)} • 6ч ${Number(x.detections_6h??0)} • 24ч ${Number(x.detections_24h??0)} • activity ${x.activity??"—"}`);
    if(Array.isArray(bx.reasons)&&bx.reasons.length){const rr=bx.reasons.slice(0,2).map((r:any)=>`${r.metric}:${r.kind}`).join(", ");lines.push(`   baseline alert: ${rr} • streak ${Number(bx.streak??0)}`)}
    if(x.last_error)lines.push(`   error: ${String(x.last_error).slice(0,220)}`);
  }
  if(!ge){
    const watchNames=new Set(["Київська","Київ","Одеська","Закарпатська","Львівська","Волинська","Рівненська","Тернопільська","Івано-Франківська","Чернівецька"]);
    const rows=go.filter((x:any)=>x.status==="degraded"||watchNames.has(x.oblast_name)).filter((x:any)=>Number(x.api_detections??0)>0||x.status==="degraded");
    lines.push("","🗺 FIRMS → DB → events → Telegram:");
    for(const x of rows.slice(0,12)){
      const icon=x.status==="degraded"?"⚠️":"✅";
      lines.push(`${icon} ${x.oblast_name}: ${Number(x.api_detections??0)} → ${Number(x.db_matched??0)} → ${Number(x.distinct_events??0)} → ${Number(x.telegram_events??0)}${Number(x.missing_in_db??0)>0?" • missing "+Number(x.missing_in_db):""}`);
    }
  }
  lines.push("","ℹ️ Geo Integrity сравнивает live FIRMS Area API за 24ч с ST_Covers(ADM1), detection_hash в БД, event aggregation и Telegram delivery. Baseline: 30 дней, 6-часовые UTC-слоты.");
  return lines.join("\n").slice(0,3900);
}


async function renderAction(sb:any,action:string){if(action==="dossier")return await dossierText(sb);if(action==="satellite")return await satelliteText(sb);if(action==="integrity")return await integrityText(sb);if(action==="coverage")return await coverageText(sb);if(action==="search"||action==="search_help")return await searchText(sb,"");if(action==="search_geo")return ["📍 Ручной поиск по координатам","","Вариант 1:","/search coord=47.87557,37.67172 radius=10","","Вариант 2 — с фильтрами:","/search coord=47.87557,37.67172 radius=25 min_frp=20 platforms=2 limit=20","","История FIRMS до 365 дней:","/nearby 47.87557 37.67172","","Для /nearby допустимы разделители: пробел, запятая или точка с запятой.","Радиус /search: 0.1–500 км.","Передача геопозиции Telegram отключена."].join("\n");if(action==="analytics")return await analyticsText(sb,24);if(action==="osint")return await osintText(sb);if(action==="geo")return await geoText(sb);if(action==="ground")return await groundText(sb);const s=await snapshot(sb);if(action==="sources"){const base=sourcesText(s);const mtg=s.eumetsat_lsa_saf??{},msg=s.monitor_eumetsat??{},s3=s.monitor_sentinel3_slstr??{};const st=(e:any)=>e.status==="active"?"✅ активно":(e.status==="waiting_credentials"||e.status==="awaiting_credentials")?"🟡 ожидает учётные данные":"⚠️ "+String(e.status??"нет данных");return base+"\n\nMTG / FCI • LSA-509 ~1 км / 10 мин\nСтатус: "+st(mtg)+"\nПоследний доступный слот: "+String(mtg.latest_public_slot??"—")+"\nРежим: 2 слота или подтверждение полярным спутником\n\nMSG / SEVIRI • LSA-502 ~3 км / 15 мин\nСтатус: "+st(msg)+"\nПоследний доступный слот: "+String(msg.latest_public_slot??"—")+"\nРежим: подтверждающий источник\n\nSentinel-3 / SLSTR • SL_2_FRP\nСтатус: "+st(s3)+"\nПоследний продукт: "+String(s3.latest_product??"—")+"\nAcquisition: "+String(s3.latest_acquisition??"—")+"\nMWIR ~1 км: "+String(s3.mwir?.inserted??0)+" новых / "+String(s3.mwir?.duplicates??0)+" дублей\nSWIR ~500 м: "+String(s3.swir?.inserted??0)+" новых / "+String(s3.swir?.duplicates??0)+" дублей\nSWIR-only: "+String(s3.swir?.new_events_suppressed??0)+" подавлено до подтверждения"+"\n\nCAMS • атмосферный контекст ~11 км\nСтатус: "+st(s.monitor_cams??{})+"\nОбновлено событий: "+String(s.monitor_cams?.events_updated??0)+"\n\nSentinel-5P / TROPOMI • CO + AER_AI\nСтатус: "+st(s.monitor_sentinel5p??{})+"\nОбновлено событий: "+String(s.monitor_sentinel5p?.events_updated??0)+"\nПродукты: CO + UV Aerosol Index"+"\n\nStage 24 • Event Intelligence\nСтатус: "+st(s.monitor_intelligence??{})+"\nОбновлено событий: "+String(s.monitor_intelligence?.events_updated??0)+"\nМодель: 1/3/6 ч • кольца 10/25/50/100 км"+"\n\nStage 25 • OSINT Fusion\nСтатус: "+st(s.monitor_osint??{})+"\nПоследний цикл: "+ageText(s.monitor_osint?.last_success_run)+"\nИсточники: GDACS + NASA EONET + Copernicus EMS\nКандидатов: "+String(s.monitor_osint?.totals?.candidates??0)+" • сохранено: "+String(s.monitor_osint?.totals?.stored??0)+" • связанных: "+String(s.monitor_osint?.totals?.matched??0)+"\n\nStage 26 • Ground Environmental OSINT\nСтатус: "+st(s.monitor_ground_osint??{})+"\nПоследняя проверка: "+ageText(s.monitor_ground_osint?.last_check)+"\nSensor.Community: "+(s.monitor_ground_osint?.sensor_community?.error?"ошибка":"live")+" • запросов: "+String(s.monitor_ground_osint?.sensor_community?.queries??0)+" • readings: "+String(s.monitor_ground_osint?.sensor_community?.stored??0)+"\nOpenAQ: "+(s.monitor_ground_osint?.openaq?.configured?"configured":"ожидает API key")+"\nSaveEcoBot allow-list: "+String(s.monitor_ground_osint?.saveecobot?.registry_sources??0)+" источников"+"\n\nStage 27 • Event Geo OSINT\nСтатус: "+st(s.monitor_geo_osint??{})+"\nПоследняя проверка: "+ageText(s.monitor_geo_osint?.last_check)+"\nКэш hits: "+String(s.monitor_geo_osint?.cache_hits??0)+" • запросов: "+String(s.monitor_geo_osint?.queries_attempted??0)+" • refreshed: "+String(s.monitor_geo_osint?.refreshed??0)+" • failed: "+String(s.monitor_geo_osint?.failed??0)+"\nGeo source: Geofabrik Postpass (OSM/PostGIS), без GitHub Actions"+"\nStage 27.1 • Overpass probes: автоматические fallback отключены; Private.coffee timeout, VK Maps HTTP 504 из текущего Supabase Edge runtime"+"\nStage 27.2 • OpenInfraMap taxonomy: "+String(s.monitor_geo_osint?.infra_profile_version??"—")+" • событий с инфраструктурой: "+String(s.monitor_geo_osint?.events_with_infrastructure_total??0)+" • retained: "+String(s.monitor_geo_osint?.infrastructure_features_retained_total??0)+"\n\nStage 28 • Event OSINT Dossier\nСтатус: "+st(s.monitor_dossier??{})+"\nПоследний refresh: "+ageText(s.monitor_dossier?.last_success_run)+"\nОбновлено досье: "+String(s.monitor_dossier?.events_refreshed??0)+" • "+String(s.monitor_dossier?.schema_version??"—")+"\n\nStage 29 • Sentinel-2 Surface Evidence\nСтатус: "+st(s.monitor_satellite_evidence??{})+"\nПоследний цикл: "+ageText(s.monitor_satellite_evidence?.last_success_run)+"\nОбработано: "+String(s.monitor_satellite_evidence?.processed??0)+" • ready: "+String(s.monitor_satellite_evidence?.ready??0)+" • waiting-after: "+String(s.monitor_satellite_evidence?.waiting_after??0)+" • failed: "+String(s.monitor_satellite_evidence?.failed??0)+"\n\nStage 29.1 • Visual Surface Evidence\nСтатус: "+String(s.satellite_visual_policy?.status??"—")+" • "+String(s.satellite_visual_policy?.version??"—")+"\nПанели: BEFORE / AFTER / SWIR / dNBR • private cache"+"\n\nStage 30 • Event Evidence Report\nСтатус: "+String(s.event_report_policy?.status??"—")+" • "+String(s.event_report_policy?.version??"—")+"\nФорматы: HTML + JSON • private signed links • on-demand";}if(action==="archive")return archiveText(s);if(action==="events")return await latestEvents(sb);if(action==="event")return await eventDetailText(sb);return statusText(s)}
function parseCoords(text:string){const s=text.trim().replace(/;/g," ");const m=s.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);if(!m)return null;const lat=Number(m[1]),lon=Number(m[2]);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;return{lat,lon}}
function sensorLabel(v:string){const u=v.toUpperCase();if(u.includes("VIIRS"))return "VIIRS";if(u.includes("MODIS"))return "MODIS";return v}
async function historyNearbyAdmin(sb:any,lat:number,lon:number,radiusM:number){
  const {data,error}=await sb.rpc("find_hotspot_history_nearby",{p_lat:lat,p_lon:lon,p_radius_m:radiusM,p_days:365,p_limit:20});
  if(error)throw error;return data??[];
}
function historyTextAdmin(rows:any[],lat:number,lon:number,radiusM:number){
  const out=["🕘 История тепловых аномалий","Точка: "+lat.toFixed(5)+", "+lon.toFixed(5),"Радиус: "+(radiusM/1000).toFixed(1)+" км • период до 365 дней",""];
  if(rows.length)rows.forEach((r:any,i:number)=>out.push((i+1)+". "+String(r.day)+" • ~"+Math.round(Number(r.distance_m??0))+" м • детекций "+Number(r.detection_count??0)+" • FRP max "+(r.max_frp==null?"—":Number(r.max_frp).toFixed(1)+" МВт")));
  else out.push("Рядом в доступной истории ничего не найдено.");
  out.push("","FIRMS фиксирует тепловые аномалии; запись не является автоматическим подтверждением пожара.");
  return out.join("\n").slice(0,3900);
}
async function nearbyText(sb:any,lat:number,lon:number){const {data,error}=await sb.rpc("find_hotspot_history_nearby",{p_lat:lat,p_lon:lon,p_radius_m:1000,p_days:365,p_limit:15});if(error)throw error;const {data:hist}=await sb.from("system_state").select("value").eq("key","history_backfill_365d").maybeSingle();const h=hist?.value??{};const rows=data??[];const head=[`📍 История FIRMS в радиусе 1 км`,`Точка: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,`Период: до 365 дней`,`Найдено записей: ${rows.length}${rows.length>=15?" (показаны 15 последних)":""}`];if(!rows.length)head.push("","В доступной истории тепловых аномалий FIRMS рядом с этой точкой ничего не найдено.");else{const lines=rows.map((r:any,i:number)=>{const dist=Number(r.distance_m??0),frp=Number(r.max_frp),sensors=(r.sensors??[]).map((x:string)=>sensorLabel(String(x))).join("+")||"FIRMS",frpText=Number.isFinite(frp)?`${frp.toFixed(1)} МВт`:"—";return `${i+1}. ${r.day} • ${Math.round(dist)} м\n   ${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)} • ${sensors} • FRP max ${frpText} • детекций ${r.detection_count}`});head.push("",...lines)}if(!h.done){head.push("",`ℹ️ Годовой архив ещё заполняется: обработано ${h.processed_days??0} дней, текущая дата архива ${h.cursor??"—"}. Текущие live-детекции уже учитываются.`)}head.push("","FIRMS фиксирует тепловые аномалии; результат не является автоматическим подтверждением пожара.");return head.join("\n").slice(0,3900)}
async function askLocation(token:string,chatId:string){await tg(token,"sendMessage",{chat_id:chatId,text:["📍 Ручной поиск по координатам","","Текущие события:","/search coord=50.4501,30.5234 radius=10","","История FIRMS до 365 дней:","/nearby 50.4501 30.5234","","Варианты координат для /nearby:","50.4501 30.5234","50.4501, 30.5234","50.4501; 30.5234","","Передача геопозиции Telegram отключена."].join("\n"),reply_markup:searchKeyboard})}


async function clientUsers(sb:any){
  const {data,error}=await sb.from("client_users")
    .select("telegram_user_id,username,first_name,last_name,status,role,activated_at,last_seen_at,created_at")
    .order("created_at",{ascending:false})
    .limit(20);
  if(error)throw error;
  return data??[];
}
function clientDisplayName(u:any){
  const full=[u.first_name,u.last_name].filter(Boolean).join(" ").trim();
  if(full)return full;
  if(u.username)return "@"+String(u.username).replace(/^@/,"");
  return "ID "+String(u.telegram_user_id);
}
function clientUsersText(rows:any[]){
  const active=rows.filter(x=>x.status==="active").length;
  const blocked=rows.filter(x=>x.status==="blocked").length;
  const pending=rows.filter(x=>x.status==="pending").length;
  const lines=rows.map((u:any,i:number)=>{
    const icon=u.status==="active"?"✅":u.status==="blocked"?"⛔":"⏳";
    const user=u.username?"@"+String(u.username).replace(/^@/,""):String(u.telegram_user_id);
    return `${i+1}. ${icon} ${clientDisplayName(u)}\n   ${user} • ID ${u.telegram_user_id} • ${u.role??"premium"}\n   последний вход: ${ageText(u.last_seen_at)}`;
  });
  return [
    "👥 Клиенты гостевого бота",
    "",
    `Всего: ${rows.length} • active ${active} • blocked ${blocked} • pending ${pending}`,
    "",
    ...(lines.length?lines:["Пользователей пока нет."]),
    "",
    "Invite: одноразовый, Premium, срок действия 24 часа."
  ].join("\n").slice(0,3900);
}
function clientUsersKeyboard(_rows:any[]){
  return {inline_keyboard:[
    [{text:"➕ Создать invite",callback_data:"admin:clientinvite"}],
    [{text:"👤 Управление пользователями",callback_data:"admin:clientmanage"}],
    [{text:"🔄 Обновить список",callback_data:"admin:clients"}],
    [{text:"⬅️ В панель",callback_data:"admin:status"}]
  ]};
}
function clientManageKeyboard(rows:any[]){
  const userButtons=rows.slice(0,20).map((u:any)=>{
    const id=String(u.telegram_user_id);
    const icon=u.status==="active"?"✅":u.status==="blocked"?"⛔":"⏳";
    const label=(u.username?"@"+String(u.username).replace(/^@/,""):clientDisplayName(u)).slice(0,28);
    return [{text:icon+" "+label,callback_data:"admin:clientcard:"+id}];
  });
  return {inline_keyboard:[
    ...userButtons,
    [{text:"⬅️ К списку клиентов",callback_data:"admin:clients"}]
  ]};
}
function clientCardText(u:any){
  const user=u.username?"@"+String(u.username).replace(/^@/,""):"—";
  const status=u.status==="active"?"✅ active":u.status==="blocked"?"⛔ blocked":"⏳ pending";
  return [
    "👤 Пользователь",
    "",
    `Имя: ${clientDisplayName(u)}`,
    `Username: ${user}`,
    `Telegram ID: ${u.telegram_user_id}`,
    `Роль: ${u.role??"premium"}`,
    `Статус: ${status}`,
    `Создан: ${ageText(u.created_at)}`,
    `Активирован: ${u.activated_at?ageText(u.activated_at):"—"}`,
    `Последний вход: ${ageText(u.last_seen_at)}`
  ].join("\n");
}
function clientCardKeyboard(u:any){
  const id=String(u.telegram_user_id);
  const action=u.status==="blocked"?"unblock":"block";
  const label=u.status==="blocked"?"✅ Разблокировать":"⛔ Заблокировать";
  return {inline_keyboard:[
    [{text:label,callback_data:"admin:client:"+action+":"+id}],
    [{text:"⬅️ К пользователям",callback_data:"admin:clientmanage"}]
  ]};
}
async function createClientInvite(sb:any){
  const code="GW-"+crypto.randomUUID().replace(/-/g,"");
  const expiresAt=new Date(Date.now()+24*3600_000).toISOString();
  const {data,error}=await sb.rpc("firewatch_client_create_invite",{
    p_code:code,
    p_role:"premium",
    p_max_uses:1,
    p_expires_at:expiresAt,
    p_label:"admin-bot"
  });
  if(error)throw error;
  return {code,expiresAt,result:data};
}
async function setClientStatus(sb:any,id:string,status:"active"|"blocked"){
  const n=Number(id);
  if(!Number.isSafeInteger(n)||n<=0)throw new Error("invalid Telegram user id");
  const {data,error}=await sb.from("client_users")
    .update({status,updated_at:new Date().toISOString()})
    .eq("telegram_user_id",n)
    .select("telegram_user_id,username,first_name,last_name,status")
    .maybeSingle();
  if(error)throw error;
  if(!data)throw new Error("client user not found");
  await sb.from("client_audit_log").insert({
    telegram_user_id:n,
    action:"admin_status_change",
    result:status,
    meta:{source:"firewatch-admin"}
  });
  return data;
}

async function areaReportRequest(payload:any){
  const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!u||!k)throw new Error("missing Supabase env");
  const r=await fetch(u+"/functions/v1/firewatch-area-report",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+k},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)
  });
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error("Area Report invalid response")}
  if(!r.ok||!d?.ok)throw new Error(String(d?.error??("HTTP "+r.status)));return d;
}
function areaReportText(d:any){
  const r=d?.report??{},inf=r.infrastructure??{},sum=inf.summary??{},counts=sum.by_category??{},gh=r.ghsl??{},ent=r.entities??{},es=ent.summary??{},reg=r.official_registry??{},os=r.osint??{},cov=r.coverage??{};
  const labels:any={energy:"энергетика",industrial:"промышленность",government:"административные",emergency:"экстренные службы",healthcare:"медицина",education:"образование",transport:"транспорт",logistics:"логистика",water:"вода",telecom:"телеком",commercial:"коммерция",residential:"жилые",cultural:"культура",public_service:"общественные службы",storage:"хранение"};
  const order=["energy","industrial","government","emergency","healthcare","education","transport","logistics","water","telecom","commercial","residential","cultural","public_service","storage"];
  const lines=[
    "🧭 AREA OSINT REPORT",
    "Центр: "+Number(d.latitude).toFixed(5)+", "+Number(d.longitude).toFixed(5)+" • радиус "+Number(d.radius_m)+" м"+(d.event_id?" • event #"+String(d.event_id).slice(0,8):""),
    "Coverage: "+Number(cov.active??0)+"/"+Number(cov.total??0)+" sources • status "+String(d.status??"—"),
    "",
    "🏗 Инфраструктура"
  ];
  for(const k of order)if(Number(counts[k]??0)>0)lines.push("• "+(labels[k]??k)+": "+Number(counts[k]));
  const b=inf.buildings??{};lines.push("• building footprints: "+Number(b.building_count??0)+" • non-residential tagged "+Number(b.nonresidential_tagged_count??0));
  if(r.ghsl){
    lines.push("","👥 GHSL exposure • epoch "+String(gh.epoch??2025));
    lines.push("• population: 1 км ~"+Math.round(Number(gh.population_1km??0)).toLocaleString("ru-RU")+" • 5 км ~"+Math.round(Number(gh.population_5km??0)).toLocaleString("ru-RU")+" • 10 км ~"+Math.round(Number(gh.population_10km??0)).toLocaleString("ru-RU"));
    lines.push("• built fraction: 1 км "+Number(gh.built_fraction_1km_pct??0).toFixed(2)+"% • 5 км "+Number(gh.built_fraction_5km_pct??0).toFixed(2)+"% • 10 км "+Number(gh.built_fraction_10km_pct??0).toFixed(2)+"%");
  }
  lines.push("","🔗 Entity graph");
  lines.push("• entities "+Number(es.entities??0)+" • multi-source "+Number(es.multi_source??0)+" • Wikidata "+Number(es.wikidata_entities??0)+" • review "+Number(es.pending_proposals??0));
  const tops:any[]=Array.isArray(ent.top)?ent.top:[];
  for(const x of tops.slice(0,6))lines.push("• #"+String(x.id??"").slice(0,8)+" "+String(x.canonical_name??"—")+" • "+String(x.category??"—")+" • "+Number(x.source_count??0)+" src"+(x.wikidata_qid?" • "+String(x.wikidata_qid):""));
  lines.push("","🏛 Official / registry");
  lines.push("• hits "+Number(reg.hit_count??0)+" • confirmed "+Number(reg.confirmed??0)+" • probable "+Number(reg.probable??0));
  const rh:any[]=Array.isArray(reg.hits)?reg.hits:[];
  for(const x of rh.slice(0,4))lines.push("• "+String(x.entity_name??"—")+" • "+String(x.source_key??"—")+" • "+Number(x.confidence??0)+"/100");
  lines.push("","📰 OSINT по району");
  lines.push("• публикаций/сигналов: "+Number(os.count??0)+" • providers "+(Array.isArray(os.providers)?os.providers.length:0));
  const oi:any[]=Array.isArray(os.items)?os.items:[];
  for(const x of oi.slice(0,4))lines.push("• ["+String(x.source??"source")+"] "+String(x.title??"").replace(/\s+/g," ").slice(0,160)+(x.distance_m!=null?" • "+Math.round(Number(x.distance_m))+" м":""));
  if(Array.isArray(d.errors)&&d.errors.length)lines.push("","⚠️ Partial: "+d.errors.slice(0,3).join(" | "));
  lines.push("","/entity <ID|QID> — карточка объекта","/registry <ID|QID> — официальный/реестровый контекст","Пространственная близость не доказывает причинную связь или operational significance.");
  return lines.join("\n").slice(0,3900);
}
async function areaIntelRequest(payload:any){
  const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!u||!k)throw new Error("missing Supabase env");
  const r=await fetch(u+"/functions/v1/firewatch-area-intel",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+k},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)
  });
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error("Area Intel invalid response")}
  if(!r.ok||!d?.ok)throw new Error(String(d?.error??("HTTP "+r.status)));return d;
}
function areaIntelText(d:any){
  const s=d?.summary??{},counts=s.by_category??{},b=d?.buildings??{},near=d?.nearest??{},src=d?.source_status??{},er=d?.entity_summary??{},erc=d?.entity_resolution??{},entities:any[]=Array.isArray(erc.entities)?erc.entities:[];
  const labels:any={energy:"энергетика",industrial:"промышленность",government:"административные",emergency:"экстренные службы",healthcare:"медицина",education:"образование",transport:"транспорт",logistics:"логистика",water:"вода",telecom:"телеком",commercial:"коммерция",residential:"жилые",cultural:"культура",public_service:"общественные службы",storage:"хранение"};
  const order=["energy","industrial","government","emergency","healthcare","education","transport","logistics","water","telecom","commercial","residential","cultural","public_service","storage"];
  const lines=[
    "🧭 AREA OSINT",
    "Центр: "+Number(d.latitude).toFixed(5)+", "+Number(d.longitude).toFixed(5)+" • радиус "+Number(d.radius_m)+" м",
    "OSM/Postpass: "+String(src.osm_postpass??"—")+" • Overture: "+String(src.overture??"—")+(src.overture_mirror_lag?" • mirror lag":""),
    "",
    "🏗 Инфраструктурный профиль"
  ];
  for(const k of order)if(Number(counts[k]??0)>0)lines.push("• "+(labels[k]??k)+": "+Number(counts[k]));
  lines.push("• building footprints: "+Number(b.building_count??0)+" • именованных "+Number(b.named_count??0)+" • non-residential tagged "+Number(b.nonresidential_tagged_count??0));
  lines.push("","🔗 Entity resolution");
  lines.push("• entities: "+Number(er.entities??0)+" • multi-source "+Number(er.multi_source??0)+" • Wikidata "+Number(er.wikidata_entities??0));
  lines.push("• exact QID: "+Number(er.exact_qid??0)+" • probable "+Number(er.probable??0)+" • review "+Number(er.pending_proposals??0));
  if(src.wikidata)lines.push("• Wikidata: "+String(src.wikidata)+" • "+String(src.wikidata_transport??"—"));
  const multi=entities.filter((x:any)=>Number(x.source_count??0)>1).slice(0,6);
  for(const x of multi)lines.push("  ↳ "+String(x.canonical_name??"—")+" • #"+String(x.id??"").slice(0,8)+" • "+Number(x.source_count??0)+" sources"+(x.wikidata_qid?" • "+String(x.wikidata_qid):"")+" • "+String(x.resolution_status??""));
  lines.push("","📍 Ближайшие объекты");
  for(const k of order){
    const x=near[k];if(!x)continue;
    lines.push("• "+(labels[k]??k)+": "+String(x.name??"—")+" • "+Math.round(Number(x.distance_m??0))+" м"+(x.subcategory?" • "+String(x.subcategory):""));
  }
  const ov:any[]=Array.isArray(s.overture_features)?s.overture_features:[];
  if(ov.length){
    lines.push("","🗺 Overture cross-source:");
    for(const x of ov.slice(0,5))lines.push("• "+String(x.name??x.subcategory??"—")+" • "+Math.round(Number(x.distance_m??0))+" м • "+String(x.subcategory??x.category??""));
    lines.push("snapshot "+String(src.overture_mirror_release??"—")+" • official latest "+String(src.overture_official_latest??"—"));
  }
  lines.push("","Контекст описательный: без vulnerability/target/access-route scoring.");
  return lines.join("\n").slice(0,3900);
}

async function registryFusionRequest(query:string){
  const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!u||!k)throw new Error("missing Supabase env");
  const r=await fetch(u+"/functions/v1/firewatch-registry-fusion",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+k},
    body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)
  });
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error("Registry Fusion invalid response")}
  if(!r.ok||!d?.ok)throw new Error(String(d?.error??("HTTP "+r.status)));return d;
}
function registryFusionText(d:any){
  const e=d?.entity??{},hits:any[]=Array.isArray(d?.hits)?d.hits:[],lines=[
    "🏛 OFFICIAL / REGISTRY #"+String(e.id??"").slice(0,8),
    String(e.canonical_name??"—"),
    "Источниковых совпадений: "+hits.length
  ];
  if(!hits.length)lines.push("","Подтверждённых или достаточно сильных официальных registry hits не найдено.");
  else{
    lines.push("");
    for(const h of hits.slice(0,10)){
      lines.push("• "+String(h.source_key??"—")+" • "+String(h.match_status??"candidate")+" • "+Number(h.match_confidence??0)+"/100");
      if(h.title)lines.push("  "+String(h.title).replace(/\s+/g," ").slice(0,220));
      if(h.publisher)lines.push("  publisher: "+String(h.publisher).slice(0,160));
      if(h.landing_url)lines.push("  "+String(h.landing_url));
    }
  }
  lines.push("","Registry hit — это ссылка на официальный источник, а не автоматическое доказательство связи с событием.");
  return lines.join("\n").slice(0,3900);
}
async function entityProfileRequest(query:string){
  const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!u||!k)throw new Error("missing Supabase env");
  const r=await fetch(u+"/functions/v1/firewatch-entity-profile",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+k},
    body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)
  });
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error("Entity Profile invalid response")}
  if(!r.ok||!d?.ok)throw new Error(String(d?.error??("HTTP "+r.status)));return d;
}
function entityProfileText(d:any){
  const e=d?.entity??{},p=d?.profile??{},fp=d?.field_provenance??{},src=d?.source_status??{};
  const arr=(x:any)=>Array.isArray(x)?x:[];
  const one=(x:any)=>Array.isArray(x)?x.join(", "):String(x??"");
  const lines=[
    "🏷 ENTITY PROFILE #"+String(e.id??"").slice(0,8),
    String(p.canonical_name??e.canonical_name??"—"),
    "Категория: "+String(p.category??e.category??"—")+(p.subcategory?" • "+String(p.subcategory):""),
    "Координаты: "+Number(p.latitude??e.latitude).toFixed(5)+", "+Number(p.longitude??e.longitude).toFixed(5),
    "Identity: "+String(p.identity?.resolution_status??e.resolution_status??"—")+" • confidence "+String(p.identity?.resolution_confidence??e.resolution_confidence??"—")+" • sources "+Number(p.identity?.source_count??e.source_count??0)
  ];
  if(p.wikidata_qid)lines.push("Wikidata: "+String(p.wikidata_qid));
  if(p.description)lines.push("Описание: "+String(p.description).slice(0,500));
  if(arr(p.instance_of).length)lines.push("Тип: "+one(p.instance_of));
  if(arr(p.country).length)lines.push("Страна: "+one(p.country));
  if(arr(p.administrative_entity).length)lines.push("Адм. принадлежность: "+one(p.administrative_entity));
  if(arr(p.operator).length||typeof p.operator==="string")lines.push("Оператор: "+one(p.operator));
  if(arr(p.owner).length||typeof p.owner==="string")lines.push("Владелец: "+one(p.owner));
  if(p.brand)lines.push("Бренд: "+one(p.brand));
  if(p.inception)lines.push("Основан/введён: "+String(p.inception));
  if(arr(p.aliases).length)lines.push("Альтернативные названия: "+arr(p.aliases).slice(0,8).join("; "));
  if(p.official_website)lines.push("Официальный сайт: "+String(p.official_website));
  const sources:any[]=Array.isArray(p.sources)?p.sources:[];
  if(sources.length){
    lines.push("","🔎 Provenance:");
    for(const x of sources.slice(0,8))lines.push("• "+String(x.source)+" • "+String(x.source_id)+" • "+String(x.match_method)+" • "+Number(x.match_confidence??0));
  }
  const fieldNames=["canonical_name","description","instance_of","country","administrative_entity","operator","owner","official_website"];
  const provRows=fieldNames.filter(k=>fp?.[k]);
  if(provRows.length){
    lines.push("","📚 Поля:");
    for(const k of provRows.slice(0,8)){const x=fp[k];lines.push("• "+k+": "+String(x.source)+" • "+Number(x.confidence??0)+"/100")}
  }
  lines.push("","Источник статуса: Wikidata "+String(src.wikidata??"—")+" • OSM "+String(src.osm??"—")+" • Overture "+String(src.overture??"—"));
  lines.push("Профиль описательный: без оценки уязвимости, доступа или operational capability.");
  return lines.join("\n").slice(0,3900);
}
async function latencyText(sb:any,eventId?:string){
  if(eventId?.trim()){
    const {data,error}=await sb.rpc("firewatch_event_latency",{p_query:eventId.trim()});
    if(error)throw error;
    if(!data)return "⏱ Latency\n\nСобытие не найдено.";
    const ds:any[]=Array.isArray(data.detections)?data.detections:[];
    const lines=[
      "⏱ LATENCY #"+String(data.event_id??"").slice(0,8),
      "",
      "Source latency: "+Number(data.source_latency_min??0).toFixed(1)+" мин",
      "GeoWatch delivery: "+(data.delivery_latency_min==null?"—":Number(data.delivery_latency_min).toFixed(1)+" мин"),
      "End-to-end: "+(data.end_to_end_latency_min==null?"—":Number(data.end_to_end_latency_min).toFixed(1)+" мин"),
      "Telegram: "+(data.telegram_sent?"sent":"not sent")+" • required "+String(Boolean(data.notification_required)),
      ""
    ];
    for(const d of ds.slice(0,8))lines.push("• "+String(d.source??"—")+" • "+Number(d.source_latency_min??0).toFixed(1)+" мин • "+String(d.acq_datetime??"").slice(0,16)+" → "+String(d.received_at??"").slice(0,16));
    return lines.join("\n").slice(0,3900);
  }
  const {data,error}=await sb.rpc("firewatch_latency_health",{p_hours:24});
  if(error)throw error;
  const x=data??{},d=x.detections??{},v=x.delivery??{},src:any[]=Array.isArray(x.by_source)?x.by_source:[];
  const lines=[
    "⏱ SOURCE / DELIVERY LATENCY • 24h",
    "",
    "Source: p50 "+Number(d.p50_min??0).toFixed(1)+" мин • p95 "+Number(d.p95_min??0).toFixed(1)+" мин • max "+Number(d.max_min??0).toFixed(1)+" мин",
    ">90 мин: "+Number(d.over_90m??0)+" / "+Number(d.count??0),
    "Delivery: p50 "+Number(v.p50_min??0).toFixed(1)+" мин • p95 "+Number(v.p95_min??0).toFixed(1)+" мин • max "+Number(v.max_min??0).toFixed(1)+" мин",
    ">10 мин: "+Number(v.over_10m??0)+" • required unsent: "+Number(v.required_unsent??0),
    "",
    "По источникам:"
  ];
  for(const s of src.slice(0,8))lines.push("• "+String(s.source??"—")+" • p95 "+Number(s.p95_min??0).toFixed(1)+" мин • >90м "+Number(s.over_90m??0)+"/"+Number(s.detections??0));
  lines.push("","Пороги: source >90 мин • delivery >10 мин.");
  return lines.join("\n").slice(0,3900);
}

async function reviewQueueData(sb:any,eventId?:string){
  const {data,error}=await sb.rpc("firewatch_review_queue",{p_limit:12,p_event:eventId?.trim()||null});
  if(error)throw error;return data??{pending:0,items:[]};
}
function reviewQueueText(d:any){
  const items:any[]=Array.isArray(d?.items)?d.items:[];
  const lines=["🧾 OSINT Review Queue","Pending: "+Number(d?.pending??0),""];
  for(const x of items.slice(0,12)){
    const sev=x.severity==="high"?"🔴":x.severity==="medium"?"🟠":"🟡";
    lines.push(sev+" #"+String(x.id)+" • "+String(x.reason_code??"review")+" • event #"+String(x.fire_event_id??"").slice(0,8));
    lines.push(String(x.title??x.target_kind??"—").replace(/\s+/g," ").slice(0,180));
    const gs=x?.context?.geo_status,score=x?.context?.geo_score;
    if(gs)lines.push("geo "+String(gs)+(score!=null?" • "+String(score)+"/100":""));
    lines.push("");
  }
  if(!items.length)lines.push("Очередь пуста.");
  lines.push("Review — операторская проверка связи/извлечения, а не автоматическая оценка истинности.");
  return lines.join("\n").slice(0,3900);
}
function reviewQueueKeyboard(d:any){
  const items:any[]=Array.isArray(d?.items)?d.items:[];
  const rows:any[]=[];
  for(const x of items.slice(0,6)){
    const id=String(x.id);
    rows.push([{text:"✅ "+id,callback_data:"admin:review_accept:"+id},{text:"❌ "+id,callback_data:"admin:review_reject:"+id},{text:"⏳ "+id,callback_data:"admin:review_more:"+id}]);
  }
  rows.push([{text:"🔄 Обновить",callback_data:"admin:review"},{text:"⬅️ Панель",callback_data:"admin:status"}]);
  return {inline_keyboard:rows};
}
async function reviewAction(sb:any,id:string,status:string,reviewer:string,note?:string){
  const n=Number(id);if(!Number.isSafeInteger(n)||n<=0)throw new Error("invalid review id");
  const {data,error}=await sb.rpc("firewatch_review_action",{p_review_id:n,p_status:status,p_reviewer:reviewer,p_note:note??null});
  if(error)throw error;return data;
}

async function processAdminUpdate(sb:any,token:string,adminId:string,u:any){
  if(u?.callback_query){
    const q=u.callback_query;
    if(String(q?.message?.chat?.id)!==adminId)return false;
    const action=String(q.data??"").replace("admin:","");
    if(action==="latency"){try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}await tg(token,"sendMessage",{chat_id:adminId,text:await latencyText(sb),reply_markup:panelKeyboard});return true}
    if(action==="review"||action.startsWith("review_accept:")||action.startsWith("review_reject:")||action.startsWith("review_more:")){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      if(action!=="review"){
        const [kind,id]=action.split(":");
        const st=kind==="review_accept"?"accepted":kind==="review_reject"?"rejected":"needs_more_evidence";
        await reviewAction(sb,id,st,"telegram:"+adminId);
      }
      const rd=await reviewQueueData(sb);
      const text=reviewQueueText(rd),kb=reviewQueueKeyboard(rd);
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text,reply_markup:kb})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:kb})}
      return true;
    }
    if(action==="clients"){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      const rows=await clientUsers(sb);
      const text=clientUsersText(rows);
      const kb=clientUsersKeyboard(rows);
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text,reply_markup:kb})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:kb})}
      return true;
    }
    if(action==="clientinvite"){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      const inv=await createClientInvite(sb);
      await tg(token,"sendMessage",{
        chat_id:adminId,
        text:`🎟 Premium invite\n\n${inv.code}\n\nОдноразовый • действует 24 часа.\nПередайте код пользователю гостевого бота.`
      });
      const rows=await clientUsers(sb);
      await tg(token,"sendMessage",{chat_id:adminId,text:clientUsersText(rows),reply_markup:clientUsersKeyboard(rows)});
      return true;
    }
    if(action==="clientmanage"){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      const rows=await clientUsers(sb);
      const text="👤 Управление пользователями\n\nВыберите пользователя:";
      const kb=clientManageKeyboard(rows);
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text,reply_markup:kb})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:kb})}
      return true;
    }
    if(action.startsWith("clientcard:")){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      const id=action.split(":")[1];
      const rows=await clientUsers(sb);
      const user=rows.find((x:any)=>String(x.telegram_user_id)===id);
      if(!user)throw new Error("client user not found");
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text:clientCardText(user),reply_markup:clientCardKeyboard(user)})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text:clientCardText(user),reply_markup:clientCardKeyboard(user)})}
      return true;
    }
    if(action.startsWith("client:block:")||action.startsWith("client:unblock:")){
      try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
      const parts=action.split(":");
      const newStatus=parts[1]==="block"?"blocked":"active";
      await setClientStatus(sb,parts[2],newStatus);
      const rows=await clientUsers(sb);
      const user=rows.find((x:any)=>String(x.telegram_user_id)===parts[2]);
      if(!user)throw new Error("client user not found");
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text:clientCardText(user),reply_markup:clientCardKeyboard(user)})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text:clientCardText(user),reply_markup:clientCardKeyboard(user)})}
      return true;
    }
    try{await tg(token,"answerCallbackQuery",{callback_query_id:q.id})}catch{}
    if(action==="dashboard"){
      const link=await dashboardUrl(sb);
      await tg(token,"sendMessage",{chat_id:adminId,text:"🌐 GeoWatch Web Dashboard\n\nСсылка действует 4 часа. Доступ read-only.",reply_markup:{inline_keyboard:[[{text:"🌐 Открыть Dashboard",url:link}],[{text:"🔄 Новая ссылка",callback_data:"admin:dashboard"}]]}});
      return true;
    }
    if(action==="nearby"){await askLocation(token,adminId);return true}
    if(action==="search"||action==="search_geo"||action==="search_help"){
      const text=await renderAction(sb,action);
      try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text,reply_markup:searchKeyboard})}
      catch{await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:searchKeyboard})}
      return true;
    }
    if(action==="report"){await sendEventReport(sb,token,adminId);return true}
    if(action==="satellite"||action==="dossier")await ensureSatelliteEvidence(sb);
    const text=await renderAction(sb,action);
    try{await tg(token,"editMessageText",{chat_id:adminId,message_id:q.message.message_id,text,reply_markup:panelKeyboard})}
    catch{await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:panelKeyboard})}
    if(action==="satellite")await sendSatelliteVisual(sb,token,adminId);
    return true;
  }

  const m=u?.message;
  if(!m||String(m.chat?.id)!==adminId)return false;

  if(m.location){
    await tg(token,"sendMessage",{chat_id:adminId,text:["📍 Передача геопозиции отключена.","","Используйте ручной поиск:","/search coord=50.4501,30.5234 radius=10","","или историю:","/nearby 50.4501 30.5234"].join("\n"),reply_markup:searchKeyboard});
    return true;
  }

  const raw=String(m.text??"").trim();
  const coords=parseCoords(raw);
  if(coords){
    const text=await nearbyText(sb,coords.lat,coords.lon);
    await tg(token,"sendMessage",{chat_id:adminId,text,reply_markup:panelKeyboard});
    return true;
  }

  const low=raw.toLowerCase();
  if(low==="/clients"){
    const rows=await clientUsers(sb);
    await tg(token,"sendMessage",{chat_id:adminId,text:clientUsersText(rows),reply_markup:clientUsersKeyboard(rows)});
    return true;
  }
  if(low==="/clientinvite"){
    const inv=await createClientInvite(sb);
    await tg(token,"sendMessage",{
      chat_id:adminId,
      text:`🎟 Premium invite\n\n${inv.code}\n\nОдноразовый • действует 24 часа.`,
      reply_markup:panelKeyboard
    });
    return true;
  }
    if(low==="/latest"){await tg(token,"sendMessage",{chat_id:adminId,text:await latestEvents(sb),reply_markup:panelKeyboard});return true}
  if(low.startsWith("/stats")){
    const arg=raw.split(/\s+/)[1]??"24";
    const hours=Math.max(1,Math.min(8760,Number(arg.replace(/[^0-9.]/g,""))||24));
    await tg(token,"sendMessage",{chat_id:adminId,text:await analyticsText(sb,hours),reply_markup:panelKeyboard});return true
  }
  if(low.startsWith("/history")){
    const p=raw.split(/\s+/),lat=Number(p[1]),lon=Number(p[2]),radiusKm=Math.max(.1,Math.min(100,Number(p[3]??5)||5));
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование: /history <lat> <lon> [radius_km]\nПример: /history 50.4501 30.5234 5",reply_markup:panelKeyboard});return true}
    const radiusM=Math.round(radiusKm*1000),rows=await historyNearbyAdmin(sb,lat,lon,radiusM);
    await tg(token,"sendMessage",{chat_id:adminId,text:historyTextAdmin(rows,lat,lon,radiusM),reply_markup:panelKeyboard});return true
  }
  if(low.startsWith("/report")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await sendEventReport(sb,token,adminId,arg);
    return true;
  }
  if(low.startsWith("/integrity")){
    await tg(token,"sendMessage",{chat_id:adminId,text:await integrityText(sb),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/coverage")){
    await tg(token,"sendMessage",{chat_id:adminId,text:await coverageText(sb),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/search")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await searchText(sb,arg),reply_markup:searchKeyboard});
    return true;
  }
  if(low.startsWith("/analytics")){
    const arg=raw.split(/\s+/)[1]??"24";
    await tg(token,"sendMessage",{chat_id:adminId,text:await analyticsText(sb,Number(arg)),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/registry")){
    const q=raw.split(/\s+/).slice(1).join(" ").trim();
    if(!q){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование: /registry <QID|entity-id>\nПример: /registry 3717e647",reply_markup:panelKeyboard});return true}
    const d=await registryFusionRequest(q);
    await tg(token,"sendMessage",{chat_id:adminId,text:registryFusionText(d),reply_markup:panelKeyboard,disable_web_page_preview:true});return true
  }
  if(low.startsWith("/entity")){
    const q=raw.split(/\s+/).slice(1).join(" ").trim();
    if(!q){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование: /entity <QID|entity-id>\nПример: /entity Q30017836",reply_markup:panelKeyboard});return true}
    const d=await entityProfileRequest(q);
    await tg(token,"sendMessage",{chat_id:adminId,text:entityProfileText(d),reply_markup:panelKeyboard,disable_web_page_preview:true});return true
  }
  if(low.startsWith("/infra")){
    const p=raw.split(/\s+/),id=String(p[1]??"").trim(),radius=Math.max(250,Math.min(10000,Number(p[2]??2000)||2000));
    if(!id){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование: /infra <event-id> [radius_m]\nПример: /infra 19be809d 2000",reply_markup:panelKeyboard});return true}
    const d=await areaIntelRequest({event_id:id,radius_m:radius});
    await tg(token,"sendMessage",{chat_id:adminId,text:areaIntelText(d),reply_markup:panelKeyboard,disable_web_page_preview:true});return true
  }
  if(low.startsWith("/area")){
    const p=raw.split(/\s+/),a=String(p[1]??"").trim();
    let payload:any={};
    if(a&&!Number.isFinite(Number(a))){
      payload={event_id:a,radius_m:Math.max(250,Math.min(10000,Number(p[2]??5000)||5000))};
    }else{
      const lat=Number(p[1]),lon=Number(p[2]),radius=Math.max(250,Math.min(10000,Number(p[3]??5000)||5000));
      if(!Number.isFinite(lat)||!Number.isFinite(lon)){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование:\n/area <lat> <lon> [radius_m]\nили /area <event-id> [radius_m]",reply_markup:panelKeyboard});return true}
      payload={lat,lon,radius_m:radius};
    }
    const d=await areaReportRequest(payload);
    await tg(token,"sendMessage",{chat_id:adminId,text:areaReportText(d),reply_markup:panelKeyboard,disable_web_page_preview:true});return true
  }
  if(low.startsWith("/latency")){const arg=raw.split(/\s+/).slice(1).join(" ").trim();await tg(token,"sendMessage",{chat_id:adminId,text:await latencyText(sb,arg||undefined),reply_markup:panelKeyboard});return true}
  if(low.startsWith("/review_accept")||low.startsWith("/review_reject")||low.startsWith("/review_more")){
    const parts=raw.split(/\s+/),id=parts[1],note=parts.slice(2).join(" ").trim()||undefined;
    if(!id){await tg(token,"sendMessage",{chat_id:adminId,text:"Использование: /review_accept <ID> [note] | /review_reject <ID> [note] | /review_more <ID> [note]",reply_markup:panelKeyboard});return true}
    const st=low.startsWith("/review_accept")?"accepted":low.startsWith("/review_reject")?"rejected":"needs_more_evidence";
    const res=await reviewAction(sb,id,st,"telegram:"+adminId,note);
    await tg(token,"sendMessage",{chat_id:adminId,text:"Review #"+id+": "+String(res?.status??st),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/review")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    const rd=await reviewQueueData(sb,arg||undefined);
    await tg(token,"sendMessage",{chat_id:adminId,text:reviewQueueText(rd),reply_markup:reviewQueueKeyboard(rd)});
    return true;
  }
  if(low.startsWith("/deeposint")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await deepOsintText(sb,arg),reply_markup:panelKeyboard});
    try{await sendVisualPreviews(token,adminId,await deepOsintData(sb,arg))}catch(e){console.error("admin deep visual failed:",e instanceof Error?e.message:String(e))}
    return true;
  }
  if(low.startsWith("/priority")){
    const parts=raw.split(/\s+/);
    const hours=Number(parts[1]??24);
    const minScore=Number(parts[2]??0);
    await tg(token,"sendMessage",{chat_id:adminId,text:await priorityText(sb,hours,minScore),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/dossier")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await ensureSatelliteEvidence(sb,arg);
    await tg(token,"sendMessage",{chat_id:adminId,text:await dossierText(sb,arg),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/satellite")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await ensureSatelliteEvidence(sb,arg);
    await tg(token,"sendMessage",{chat_id:adminId,text:await satelliteText(sb,arg),reply_markup:panelKeyboard});
    await sendSatelliteVisual(sb,token,adminId,arg);
    return true;
  }
  if(low.startsWith("/event")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await eventDetailText(sb,arg),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/osint")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await osintText(sb,arg),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/ground")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await groundText(sb,arg),reply_markup:panelKeyboard});
    return true;
  }
  if(low.startsWith("/geo")){
    const arg=raw.split(/\s+/).slice(1).join(" ").trim();
    await tg(token,"sendMessage",{chat_id:adminId,text:await geoText(sb,arg),reply_markup:panelKeyboard});
    return true;
  }

  const cmd=low.split("@")[0];
  if(cmd==="/nearby"){await askLocation(token,adminId);return true}
  let action="status";
  if(cmd==="/sources")action="sources";
  else if(cmd==="/events")action="events";
  else if(cmd==="/archive")action="archive";
  else if(cmd==="/start"||cmd==="/panel")action="status";
  else if(cmd!=="/status")return false;

  await tg(token,"sendMessage",{chat_id:adminId,text:await renderAction(sb,action),reply_markup:panelKeyboard});
  return true;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);

  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  if(!url||!key||!token)return json({ok:false,error:"missing env"},500);

  const sb=createClient(url,key,{auth:{persistSession:false}});
  const cronSecret=req.headers.get("x-cron-secret")??"";
  const telegramSecret=req.headers.get("x-telegram-bot-api-secret-token")??"";
  let mode:"cron"|"webhook";

  if(cronSecret){
    const {data:auth,error}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cronSecret});
    if(error||auth!==true)return json({ok:false,error:"unauthorized"},401);
    mode="cron";
  }else if(telegramSecret){
    const {data:expected,error}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"telegram_admin_webhook_secret"});
    if(error||!expected||String(expected)!==telegramSecret)return json({ok:false,error:"unauthorized"},401);
    mode="webhook";
  }else{
    return json({ok:false,error:"unauthorized"},401);
  }

  try{
    const [{data:pairRow},{data:stateRow}]=await Promise.all([
      sb.from("system_state").select("value").eq("key","watchdog_pairing").single(),
      sb.from("system_state").select("value").eq("key","admin_bot_state").maybeSingle()
    ]);
    const adminId=pairRow?.value?.admin_chat_id?String(pairRow.value.admin_chat_id):null;
    if(!adminId)return json({ok:true,paired:false,mode});

    let state=stateRow?.value??{};

    if(!state.commands_v17){
      await tg(token,"setMyCommands",{commands:[
        {command:"start",description:"Открыть админ-панель"},
        {command:"status",description:"Статус мониторинга"},
        {command:"panel",description:"Админ-панель"},
        {command:"event",description:"Детали последнего/указанного события"},
        {command:"dossier",description:"Полное OSINT-досье события"},
        {command:"report",description:"HTML/JSON Evidence Report события"},
        {command:"integrity",description:"Аудит пропусков и доставки"},
        {command:"coverage",description:"Аудит покрытия спутниковых источников"},
        {command:"search",description:"Поиск событий по фильтрам"},
        {command:"analytics",description:"Сводная аналитика 24/168/720 ч"},
        {command:"priority",description:"События по приоритету"},
        {command:"deeposint",description:"Глубокая OSINT-корреляция"},
        {command:"satellite",description:"Sentinel-2 до/после и NBR/NDVI"},
        {command:"osint",description:"Внешний OSINT по событию"},
        {command:"geo",description:"Гео- и инфраструктурный OSINT"},
        {command:"ground",description:"Наземные экологические датчики"},
        {command:"nearby",description:"История FIRMS в радиусе 1 км"},
        {command:"sources",description:"Состояние спутников и OSINT"},
        {command:"events",description:"Последние события"},
        {command:"archive",description:"Архив и база"}
      ]});
      state.commands_configured=true;
      state.commands_v9=true;
      state.commands_v10=true;
      state.commands_v11=true;
      state.commands_v12=true;
      state.commands_v13=true;
      state.commands_v14=true;
      state.commands_v15=true;
      state.commands_v16=true;
      state.commands_v17=true;
    }

    if(mode==="cron"){
      const {data:webhookSecret,error:we}=await sb.rpc("firewatch_optional_vault_secret",{p_name:"telegram_admin_webhook_secret"});
      if(we||!webhookSecret)throw new Error("telegram webhook secret unavailable");

      const webhookUrl=`${url}/functions/v1/firewatch-admin`;
      const lastCheck=Date.parse(String(state.webhook_last_check??""));
      const checkDue=!Number.isFinite(lastCheck)||Date.now()-lastCheck>6*3600_000||!state.webhook_enabled;

      if(checkDue){
        let info:any=await tg(token,"getWebhookInfo",{});
        if(String(info?.url??"")!==webhookUrl){
          await tg(token,"setWebhook",{
            url:webhookUrl,
            secret_token:String(webhookSecret),
            allowed_updates:["message","callback_query"],
            drop_pending_updates:false,
            max_connections:10
          });
          info=await tg(token,"getWebhookInfo",{});
        }

        state.delivery_mode="webhook";
        state.polling_disabled=true;
        state.webhook_enabled=String(info?.url??"")===webhookUrl;
        state.webhook_url=String(info?.url??"");
        state.webhook_last_check=new Date().toISOString();
        state.webhook_pending_update_count=Number(info?.pending_update_count??0);
        state.webhook_last_error_observed=info?.last_error_message??null;
        state.webhook_last_error=Number(info?.pending_update_count??0)>0?(info?.last_error_message??null):null;
        state.webhook_max_connections=Number(info?.max_connections??0);
      }

      state.last_health_check=new Date().toISOString();
      await sb.from("system_state").upsert({key:"admin_bot_state",value:state,updated_at:new Date().toISOString()});
      return json({
        ok:true,paired:true,mode:"webhook-health",
        webhook_enabled:Boolean(state.webhook_enabled),
        pending_updates:Number(state.webhook_pending_update_count??0),
        last_error:state.webhook_last_error??null
      });
    }

    const update=await req.json();
    const started=performance.now();
    const processed=await processAdminUpdate(sb,token,adminId,update);
    const processingMs=Math.round(performance.now()-started);
    state.delivery_mode="webhook";
    state.polling_disabled=true;
    state.webhook_enabled=true;
    state.last_webhook_update=new Date().toISOString();
    state.last_webhook_update_id=Number(update?.update_id??0);
    state.last_webhook_processing_ms=processingMs;
    state.webhook_last_error=null;
    await sb.from("system_state").upsert({key:"admin_bot_state",value:state,updated_at:new Date().toISOString()});
    return json({ok:true,paired:true,mode:"webhook",processed:processed?1:0,processing_ms:processingMs});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    console.error("firewatch-admin error:",msg);
    return json({ok:false,error:msg},mode==="webhook"?200:502);
  }
});

