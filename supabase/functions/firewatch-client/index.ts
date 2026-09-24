
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}});
}
async function tg(token:string,method:string,body:unknown){
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(15000)
  });
  const d=await r.json();
  if(!r.ok||!d?.ok)throw new Error(`Telegram ${method}: ${d?.description??r.status}`);
  return d.result;
}
const activeKeyboard={
  keyboard:[
    [{text:"🔥 Последние события"},{text:"🔎 Поиск"}],
    [{text:"📊 Статистика"},{text:"📈 Аналитика"}],
    [{text:"🚦 Приоритет"},{text:"🧠 Deep OSINT"}],
    [{text:"📑 Досье"},{text:"🗺 Гео/инфра"}],
    [{text:"👤 Мой доступ"}]
  ],
  resize_keyboard:true
};
const pendingKeyboard={
  keyboard:[[{text:"ℹ️ Как получить доступ"}]],
  resize_keyboard:true
};
function roleName(_role:string){return "Premium";}
async function access(sb:any,id:number){
  const {data,error}=await sb.rpc("firewatch_client_access",{p_telegram_user_id:id});
  if(error)throw error;
  return data??{registered:false,allowed:false,status:"new",role:null};
}
async function touch(sb:any,u:any){
  const {data,error}=await sb.rpc("firewatch_client_touch_user",{
    p_telegram_user_id:Number(u.id),
    p_username:u.username??null,
    p_first_name:u.first_name??null,
    p_last_name:u.last_name??null
  });
  if(error)throw error;
  return data;
}
async function redeem(sb:any,u:any,code:string){
  const {data,error}=await sb.rpc("firewatch_client_redeem_invite",{
    p_telegram_user_id:Number(u.id),
    p_code:code,
    p_username:u.username??null,
    p_first_name:u.first_name??null,
    p_last_name:u.last_name??null
  });
  if(error)throw error;
  return data;
}

function ageText(v:any){
  const t=Date.parse(String(v??""));
  if(!Number.isFinite(t))return "—";
  const m=Math.max(0,Math.floor((Date.now()-t)/60000));
  if(m<60)return m+" мин назад";
  const h=Math.floor(m/60);
  if(h<48)return h+" ч "+(m%60)+" мин назад";
  return Math.floor(h/24)+" дн назад";
}
function parsePeriod(s:string,def:number){
  const m=String(s??"").trim().toLowerCase().match(/^(\d+)\s*(h|ч|d|д)?$/);
  if(!m)return def;
  const n=Math.max(1,Number(m[1]));
  return Math.min(8760,n*((m[2]==="d"||m[2]==="д")?24:1));
}
function parseCoords(s:string){
  const normalized=String(s??"").trim().replace(/\s*[;,]\s*/g," ").replace(/\s+/g," ");
  const m=normalized.match(/^(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/);
  if(!m)return null;
  const lat=Number(m[1]),lon=Number(m[2]),radius=Number(m[3]??10);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
  return {lat,lon,radiusKm:Math.max(.1,Math.min(100,radius))};
}
async function searchEvents(sb:any,filters:any){
  const {data,error}=await sb.rpc("firewatch_search_events",{p_filters:filters});
  if(error)throw error;
  return data??{count:0,events:[]};
}
async function analytics(sb:any,hours:number){
  const {data,error}=await sb.rpc("firewatch_analytics_summary",{p_hours:hours});
  if(error)throw error;
  return data??{};
}
async function deepOsint(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_deep_osint",{p_query:q})
    .abortSignal(AbortSignal.timeout(7000));
  if(error)throw error;
  return data;
}
function deepOsintText(d:any){
  if(!d)return "🧠 Deep OSINT\n\nСобытие не найдено.";
  const e=d.event??{},s=d.summary??{},eff=d.effis??{},src:any[]=Array.isArray(d.sources)?d.sources:[],tl:any[]=Array.isArray(d.timeline)?d.timeline:[];
  const lines=[
    "🧠 DEEP OSINT #"+String(e.id??"").slice(0,8),
    "Приоритет: "+Number(e.priority_score??0)+"/100 • "+String(e.priority_level??"—"),
    "Уверенность детекции: "+String(e.confidence_level??"—"),
    "Независимые strong providers: "+Number(s.strong_independent_providers??0),
    "Классы источников: "+Number(s.strong_source_classes??0),
    "Corroboration: "+String(s.corroboration_level??"none"),
    "Fusion docs: "+Number(s.fusion_documents??0)+" • public OSINT: "+Number(s.public_osint??0)+" • legacy: "+Number(s.legacy_external??0),
    "🌲 EFFIS: "+String(eff.status??"not_cached")+" • FWI "+(eff.fwi_value==null?"—":Number(eff.fwi_value).toFixed(1))+" • active "+Number(eff.active_fire_count??0)+" • burnt-area "+Number(eff.burnt_area_count??0),
    ""
  ];
  if(src.length){
    lines.push("Источники Fusion:");
    for(const x of src.slice(0,8))lines.push("• "+String(x.label??x.source)+" • "+String(x.source_class??"—")+" • max "+Number(x.max_relevance??0)+"/100 • "+Number(x.evidence_count??0)+" evidence");
    lines.push("");
  }
  lines.push("Timeline:");
  for(const x of tl.slice(0,12)){
    const dist=x.distance_m==null?"":(" • "+(Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км"));
    const when=x.observed_at?String(x.observed_at).slice(0,16).replace("T"," ")+" UTC":"—";
    lines.push("• ["+String(x.source_label??x.source??"source")+"] "+String(x.title??"—").replace(/\s+/g," ").slice(0,180));
    lines.push("  "+when+" • relevance "+Number(x.relevance_score??0)+"/100"+dist);
  }
  if(!tl.length)lines.push("Пока нет связанных OSINT-документов.");
  lines.push("","Корреляция контекстная: близость по времени/месту/тексту не доказывает причинность.");
  return lines.join("\n").slice(0,3900);
}
async function priorityEvents(sb:any,hours=24,minScore=0){
  const {data,error}=await sb.rpc("firewatch_priority_events",{p_hours:hours,p_limit:12,p_min_score:minScore})
    .abortSignal(AbortSignal.timeout(5000));
  if(error)throw error;
  return data??{count:0,events:[]};
}
function priorityText(d:any,hours:number){
  const ev:any[]=Array.isArray(d?.events)?d.events:[];
  const lines=["🚦 Приоритет событий • "+hours+" ч","Показано: "+ev.length,""];
  for(const e of ev){
    const icon=e.priority_level==="high"?"🔴":e.priority_level==="elevated"?"🟠":e.priority_level==="normal"?"🟡":"⚪";
    lines.push(
      icon+" #"+String(e.id??"").slice(0,8)+" • "+String(e.oblast??"—")+" • "+Number(e.priority_score??0)+"/100",
      "FRP "+(e.frp_latest_avg==null?"—":Number(e.frp_latest_avg).toFixed(1)+" МВт")+" • obs "+Number(e.observation_count??0)+" • platforms "+Number(e.multisource_count??0),
      (e.nearest_place_name?String(e.nearest_place_name)+(e.nearest_place_distance_km==null?"":" • "+Number(e.nearest_place_distance_km).toFixed(1)+" км"):"")+"",
      "/dossier "+String(e.id??"").slice(0,8),
      ""
    );
  }
  if(!ev.length)lines.push("Событий в выбранном окне нет.");
  lines.push("Баллы — только для очередности просмотра; не определяют причину или характер события.");
  return lines.join("\n").slice(0,3900);
}
async function geoContext(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_geo_context",{p_query:q});
  if(error)throw error;
  return data;
}
async function dossier(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_dossier",{p_query:q})
    .abortSignal(AbortSignal.timeout(7000));
  if(error)throw error;
  return data;
}
const CLIENT_DOSSIER_FLAG_LABELS:Record<string,string>={
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
  near_petroleum_infrastructure_2km:"нефтегазовая инфраструктура ≤2 км",
  near_industrial_2km:"промышленный объект ≤2 км",
  major_power_5km:"ВН энергетика ≤5 км",
  telecom_infrastructure_1km:"телеком-инфраструктура ≤1 км",
  water_infrastructure_1km:"водная инфраструктура ≤1 км",
  forest_context:"лес ≤500 м",
  agriculture_context:"сельхозземли ≤500 м",
  settlement_near_2km:"населённый пункт ≤2 км",
  sentinel2_before_available:"есть Sentinel-2 до события",
  sentinel2_after_available:"есть Sentinel-2 после события",
  surface_change_pair_ready:"готова пара Sentinel-2 до/после",
  public_news_match:"есть совпадение с публичной новостью",
  public_telegram_match:"есть совпадение с публичным Telegram",
  air_alert_overlap_context:"есть контекст воздушной тревоги",
  neptun_track_proximity:"есть пространственно-временной контекст Neptun"
};
function dossierNumClient(v:any,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—"}
function satelliteSceneLineClient(label:string,x:any){
  if(!x)return label+": —";
  const dt=String(x.datetime??"").slice(0,16).replace("T"," ");
  const cloud=x.cloud_pct==null?"—":Number(x.cloud_pct).toFixed(1)+"%";
  const valid=x.local_valid_fraction==null?"—":(Number(x.local_valid_fraction)*100).toFixed(0)+"%";
  return label+": "+dt+" UTC • cloud "+cloud+" • valid "+valid+" • NBR "+dossierNumClient(x.nbr,3)+" • NDVI "+dossierNumClient(x.ndvi,3);
}
function infraProfileTextClient(x:any){
  const p=x?.profile??{},parts:string[]=[];
  const add=(label:string,v:any)=>{if(v!=null&&String(v)!=="")parts.push(label+" "+String(v).slice(0,80))};
  if(p.voltage){
    const v=Number(String(p.voltage).split(";")[0]);
    add("U:",Number.isFinite(v)?(v>=1000?(v/1000).toFixed(v%1000?1:0)+" кВ":v+" В"):p.voltage);
  }
  add("цепей:",p.circuits);add("f:",p.frequency);add("мощн.:",p.output);add("источник:",p.source);
  add("вещество:",p.substance);add("usage:",p.usage);add("Ø:",p.diameter);add("P:",p.pressure);
  add("оператор:",p.operator);add("ref:",p.ref);
  return parts.join(" • ");
}
function dossierTextClient(d:any){
  if(!d)return "📑 EVENT OSINT DOSSIER\n\nСобытие не найдено или досье ещё не сформировано.";
  const e=d.event??{},sat=d.satellite??{},surf=d.satellite_surface??{},atm=d.atmosphere??{},geo=d.geospatial??{},
        inf=d.infrastructure??{},ground=d.ground??{},ext=d.external_osint??{},pub=d.public_osint??{},
        air=d.air_threat_context??{},hist=d.history??{},pri=d.priority??{};
  const flags:string[]=Array.isArray(d.context_flags)?d.context_flags:[];
  const classes:string[]=Array.isArray(d.evidence_classes)?d.evidence_classes:[];
  const infra:any[]=Array.isArray(inf.features)?inf.features:[];
  const duration=Number(e.duration_minutes??0),durationText=duration>=60?(duration/60).toFixed(1)+" ч":Math.round(duration)+" мин";
  const declared=Array.isArray(sat.declared_sources)?sat.declared_sources.join(", "):"—";
  const lines:string[]=[
    "📑 EVENT OSINT DOSSIER #"+String(e.id??"").slice(0,8),
    "Область: "+String(e.oblast??"—"),
    "Координаты: "+dossierNumClient(e.latitude,5)+", "+dossierNumClient(e.longitude,5),
    "Период: "+String(e.first_seen??"").slice(0,16).replace("T"," ")+" → "+String(e.last_seen??"").slice(0,16).replace("T"," ")+" UTC • "+durationText,
    "Наблюдений: "+Number(e.observation_count??0)+" • спутниковых платформ: "+Number(sat.source_count??0),
    "Источники: "+declared,
    "Уверенность детекции: "+String(e.confidence_label??e.confidence_level??"—"),
    "🚦 Приоритет просмотра: "+Number(pri.score??0)+"/100 • "+String(pri.label??pri.level??"—"),
    "",
    "🔥 FRP max: "+dossierNumClient(sat.frp_max_mw,1)+" МВт • avg: "+dossierNumClient(sat.frp_avg_mw,1)+" МВт • тренд: "+String(sat.frp_trend??"—"),
    "Кластер: "+(sat.cluster_diameter_m==null?"—":Math.round(Number(sat.cluster_diameter_m))+" м"),
    "",
    "🛰 Sentinel-2 Surface: "+String(surf.status??"pending"),
    satelliteSceneLineClient("До",surf.before),
    surf.after?satelliteSceneLineClient("После",surf.after):surf.status==="waiting_after"
      ?"После: ожидается • следующий поиск "+String(surf.next_retry_at??"").slice(0,16).replace("T"," ")+" UTC"
      :satelliteSceneLineClient("После",surf.after)
  ];
  if(surf.dnbr!=null)lines.push("dNBR "+Number(surf.dnbr).toFixed(3)+" • ΔNDVI "+dossierNumClient(surf.dndvi,3)+" • "+String(surf.spectral_change_magnitude??"—"));
  if(surf.visual?.status==="ready")lines.push("Visual evidence: ✅ cached");

  lines.push(
    "",
    "🗺 Контекст: "+String(geo.context_type??"—")+" • ближайший "+String(geo.nearest_feature??"—")+
      (geo.nearest_feature_distance_m==null?"":" ("+Math.round(Number(geo.nearest_feature_distance_m))+" м)"),
    "⚙️ Инфраструктура: "+Number(inf.feature_count??0)+" объектов"
  );
  for(const x of infra.slice(0,4)){
    const dist=Number(x.distance_m)<1000?Math.round(Number(x.distance_m))+" м":(Number(x.distance_m)/1000).toFixed(1)+" км";
    const detail=infraProfileTextClient(x);
    lines.push("• "+String(x.infra_label??x.infra_type)+": "+String(x.name??"—")+" • "+dist+(detail?" • "+detail:""));
  }

  lines.push(
    "",
    "🌫 Атмосфера: "+String(atm.signal_level??"—")+" • CAMS PM2.5 "+dossierNumClient(atm.cams_pm2_5_ug_m3,1)+" µg/m³ • CO "+dossierNumClient(atm.cams_co_ug_m3,0)+" µg/m³"
  );
  if(atm.s5p_co_mol_m2!=null)lines.push("Sentinel-5P CO: "+dossierNumClient(atm.s5p_co_mol_m2,4)+" mol/m²");
  lines.push("Наземные станции: "+Number(ground.station_count??0)+" • внешние OSINT-источники: "+Number(ext.source_count??0));

  const news:any[]=Array.isArray(pub.news)?pub.news:[],alerts:any[]=Array.isArray(pub.air_alert_context)?pub.air_alert_context:[],tg:any[]=Array.isArray(pub.telegram)?pub.telegram:[];
  lines.push("","📰 Public OSINT: новости "+Number(pub.news_count??0)+" • TG "+Number(pub.telegram_count??0)+" • air-alert "+Number(pub.air_alert_context_count??0));
  for(const x of news.slice(0,3)){
    const when=x.published_at?String(x.published_at).slice(0,16).replace("T"," ")+" UTC":"—";
    lines.push("• [NEWS/"+String(x.source??"source")+"] "+String(x.title??"—").slice(0,170)+"\n  "+when+" • relevance "+Number(x.relevance_score??0)+"/100");
  }
  for(const x of tg.slice(0,4)){
    const when=x.published_at?String(x.published_at).slice(0,16).replace("T"," ")+" UTC":"—";
    const scope=x?.match_basis?.location?.kind==="nearest_place"?"local":"regional";
    lines.push("• [TG/"+String(x.source??"channel")+" • "+scope+"] "+String(x.title??"—").replace(/\s+/g," ").slice(0,190)+"\n  "+when+" • relevance "+Number(x.relevance_score??0)+"/100");
  }
  for(const x of alerts.slice(0,2)){
    lines.push("• [AIR ALERT] "+String(x.title??"—").slice(0,180)+" • "+(x.observed_at?String(x.observed_at).slice(0,16).replace("T"," ")+" UTC":"—"));
  }

  const airTracks:any[]=Array.isArray(air.tracks)?air.tracks:[];
  lines.push("","✈️ Neptun air-threat context: "+Number(air.count??0));
  for(const x of airTracks.slice(0,4)){
    const dm=Number(x.nearest_distance_m??0),dist=dm<1000?Math.round(dm)+" м":(dm/1000).toFixed(1)+" км";
    const off=Number(x.time_offset_seconds??0),offm=Math.round(Math.abs(off)/60);
    const when=off===0?"одновременно":off<0?offm+" мин до FIRMS":offm+" мин после FIRMS";
    const conf=Number.isFinite(Number(x.confidence_0_100))?" • confidence "+Math.round(Number(x.confidence_0_100))+"/100":"";
    const head=Number.isFinite(Number(x.heading_deg))?" • курс "+Math.round(Number(x.heading_deg))+"°":"";
    lines.push("• "+String(x.label??x.type??"air threat")+" • "+dist+" • "+when+head+conf);
  }

  lines.push(
    "",
    "🕓 История: 30д "+Number(hist.events_30d??0)+" • 90д "+Number(hist.events_90d??0)+" • 365д "+Number(hist.events_365d??0)+" • класс "+String(hist.hotspot_class??"—"),
    "",
    "Классы доказательств: "+(classes.length?classes.join(", "):"—")
  );
  if(flags.length)lines.push("Контекст-флаги:",...flags.slice(0,12).map((x:string)=>"• "+(CLIENT_DOSSIER_FLAG_LABELS[x]??x)));
  if(inf.openinframap_url)lines.push("","OpenInfraMap: "+String(inf.openinframap_url));
  lines.push(
    "",
    "ℹ️ Досье агрегирует публичные наблюдения. Новости, воздушные тревоги, треки Neptun, географические совпадения, флаги и спектральные метрики являются контекстом и не устанавливают причину тепловой аномалии."
  );
  return lines.join("\n").slice(0,3900);
}
async function countRequest(sb:any,userId:number){
  try{await sb.rpc("firewatch_client_increment_request",{p_telegram_user_id:userId})}catch{}
}
function fmtEvent(e:any,i?:number){
  const id=String(e?.id??"").slice(0,8);
  const p=(i!=null?String(i)+". ":"")+"🔥 #"+id+" • "+String(e?.oblast??"—");
  const dist=e?.distance_km==null?"":" • "+Number(e.distance_km).toFixed(1)+" км";
  const frp=e?.max_frp==null?"":" • FRP "+Number(e.max_frp).toFixed(1)+" МВт";
  const place=e?.nearest_place_name?"\n   Ориентир: "+String(e.nearest_place_name):"";
  return p+dist+"\n   "+Number(e?.latitude).toFixed(5)+", "+Number(e?.longitude).toFixed(5)+frp+
    "\n   "+String(e?.event_confidence_label??e?.event_confidence_level??"—")+
    " • наблюдений "+Number(e?.observation_count??0)+" • "+ageText(e?.last_seen)+place+
    "\n   /event "+id+" • /dossier "+id+" • /geo "+id;
}
function searchText(d:any,title:string){
  const rows=Array.isArray(d?.events)?d.events:[];
  const out=[title,"",rows.length?"Найдено: "+rows.length:"Совпадений не найдено."];
  rows.slice(0,10).forEach((e:any,i:number)=>out.push("",fmtEvent(e,i+1)));
  return out.join("\n").slice(0,3900);
}
function statsText(a:any,hours:number){
  const e=a?.events??{},f=a?.frp??{};
  const period=hours<48?hours+" ч":Math.round(hours/24)+" дн";
  return [
    "📊 Статистика • "+period,"",
    "Событий: "+Number(e.total??0),
    "Активных: "+Number(e.active??0),
    "Закрытых: "+Number(e.closed??0),
    "Мультиспутниковых: "+Number(e.multisource??0),"",
    "Детекций с FRP: "+Number(f.detections??0),
    "Средний FRP: "+(f.avg_mw==null?"—":Number(f.avg_mw).toFixed(2)+" МВт"),
    "Максимальный FRP: "+(f.max_mw==null?"—":Number(f.max_mw).toFixed(2)+" МВт"),"",
    "Данные описывают спутниковые тепловые аномалии и не устанавливают причину события."
  ].join("\n");
}
function analyticsText(a:any,hours:number){
  const period=hours<48?hours+" ч":Math.round(hours/24)+" дн";
  const oblasts=(Array.isArray(a?.by_oblast)?a.by_oblast:[]);
  const sources=(Array.isArray(a?.by_source)?a.by_source:[]);
  const out=["📈 Аналитика • "+period,"","По всем регионам:"];
  if(oblasts.length)oblasts.forEach((x:any,i:number)=>out.push((i+1)+". "+String(x.oblast)+" — "+Number(x.events??0)));
  else out.push("Нет данных.");
  out.push("","По источникам:");
  if(sources.length)sources.forEach((x:any,i:number)=>out.push((i+1)+". "+String(x.source)+" — "+Number(x.detections??0)+" детекций"));
  else out.push("Нет данных.");
  out.push("","Команды: /stats 24h|7d|30d • /analytics 24h|7d|30d");
  return out.join("\n").slice(0,3900);
}
function geoText(g:any){
  if(!g)return "🗺 Гео/инфра\n\nСобытие не найдено или геоконтекст ещё не сформирован.";
  const infra=Array.isArray(g.infrastructure_features)?g.infrastructure_features:[];
  const features=Array.isArray(g.features)?g.features:[];
  const near=features.filter((x:any)=>["settlement","forest","agriculture","water"].includes(String(x?.category))).slice(0,8);
  const out=[
    "🗺 Гео/инфра #"+String(g.id??"").slice(0,8),
    "Регион: "+String(g.oblast??"—"),
    "Координаты: "+Number(g.latitude).toFixed(5)+", "+Number(g.longitude).toFixed(5),
    "Радиус контекста: "+Math.round(Number(g.query_radius_m??5000)/1000)+" км","",
    "Ближайший объект: "+String(g.nearest_feature??"—")+
      (g.nearest_feature_distance_m!=null?" • ~"+Math.round(Number(g.nearest_feature_distance_m))+" м":""),
    "","Окружение:"
  ];
  if(near.length)near.forEach((x:any)=>out.push("• "+String(x.label??x.name??x.category)+" — ~"+Math.round(Number(x.distance_m??0))+" м"));
  else out.push("• значимые объекты в выборке не найдены");
  out.push("","Инфраструктура:");
  if(infra.length)infra.slice(0,8).forEach((x:any)=>out.push("• "+String(x.infra_label??x.label??x.name??x.infra_type??"инфраструктура")+" — ~"+Math.round(Number(x.distance_m??0))+" м"));
  else out.push("• в текущем геокэше не обнаружена");
  out.push("","Картографический контекст является справочным и не устанавливает причину тепловой аномалии.");
  return out.join("\n").slice(0,3900);
}

function historyText(rows:any[],lat:number,lon:number,radiusM:number){
  const out=["🕘 История тепловых аномалий",
    "Точка: "+lat.toFixed(5)+", "+lon.toFixed(5),
    "Радиус: "+(radiusM/1000).toFixed(1)+" км • период до 365 дней",""];
  if(rows.length)rows.forEach((r:any,i:number)=>out.push(
    (i+1)+". "+String(r.day)+" • ~"+Math.round(Number(r.distance_m??0))+" м • детекций "+
    Number(r.detection_count??0)+" • FRP max "+(r.max_frp==null?"—":Number(r.max_frp).toFixed(1)+" МВт")
  ));
  else out.push("Рядом в доступной истории ничего не найдено.");
  out.push("","FIRMS фиксирует тепловые аномалии; запись не является автоматическим подтверждением пожара.");
  return out.join("\n").slice(0,3900);
}

async function bootstrapWebhook(sb:any,token:string,secret:string,url:string){
  const me=await tg(token,"getMe",{});
  await tg(token,"setMyCommands",{commands:[
    {command:"start",description:"Регистрация / открыть меню"},
    {command:"latest",description:"Последние события"},
    {command:"priority",description:"События по приоритету"},
    {command:"search",description:"Поиск по ID или региону"},
    {command:"event",description:"Карточка события"},
    {command:"dossier",description:"OSINT-досье события"},
    {command:"deeposint",description:"Глубокая OSINT-корреляция"},
    {command:"geo",description:"Гео/инфраструктура события"},
    {command:"nearby",description:"События рядом"},
    {command:"history",description:"История вокруг точки"},
    {command:"stats",description:"Статистика 24ч / 7д / 30д"},
    {command:"analytics",description:"Аналитика 24ч / 7д / 30д"},
    {command:"me",description:"Мой доступ"}
  ]});
  await tg(token,"setWebhook",{
    url,
    secret_token:secret,
    allowed_updates:["message"],
    drop_pending_updates:false,
    max_connections:20
  });
  const info=await tg(token,"getWebhookInfo",{});
  return {
    bot_username:me?.username??null,
    bot_id:me?.id??null,
    webhook_enabled:String(info?.url??"")===url,
    webhook_url:String(info?.url??""),
    pending_update_count:Number(info?.pending_update_count??0),
    last_error_message:info?.last_error_message??null,
    max_connections:Number(info?.max_connections??0)
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);

  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token=Deno.env.get("CLIENT_TELEGRAM_BOT_TOKEN");
  const expectedSecret=Deno.env.get("CLIENT_TELEGRAM_WEBHOOK_SECRET");
  if(!url||!key)return json({ok:false,error:"backend unavailable"},500);
  if(!token||!expectedSecret)return json({ok:false,error:"client bot not configured"},503);

  const sb=createClient(url,key,{auth:{persistSession:false}});

  const cronSecret=req.headers.get("x-cron-secret")??"";
  if(cronSecret){
    const {data:auth,error}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cronSecret});
    if(error||auth!==true)return json({ok:false,error:"unauthorized"},401);
    try{
      const webhookUrl=url+"/functions/v1/firewatch-client";
      const state=await bootstrapWebhook(sb,token,expectedSecret,webhookUrl);
      return json({ok:true,mode:"bootstrap",...state});
    }catch(e){
      return json({ok:false,error:e instanceof Error?e.message:String(e)},502);
    }
  }

  const supplied=req.headers.get("x-telegram-bot-api-secret-token")??"";
  if(supplied!==expectedSecret)return json({ok:false,error:"unauthorized"},401);

  try{
    const update=await req.json();
    const m=update?.message;
    if(!m?.from?.id||!m?.chat?.id)return json({ok:true,processed:0});
    if(String(m.chat.type)!=="private")return json({ok:true,processed:0});

    const user=m.from;
    const chatId=String(m.chat.id);
    const raw=String(m.text??"").trim();
    const low=raw.toLowerCase();

    if(low.startsWith("/start")){
      const u=await touch(sb,user);
      if(u?.status==="active"){
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:`GeoWatch Client\n\nДоступ активен. Роль: ${roleName(String(u.role))}.`,
          reply_markup:activeKeyboard
        });
      }else if(u?.status==="blocked"){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Доступ к сервису заблокирован."});
      }else{
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:"GeoWatch Client\n\nДля регистрации отправьте invite-код одним сообщением.",
          reply_markup:pendingKeyboard
        });
      }
      return json({ok:true,processed:1});
    }

    const a=await access(sb,Number(user.id));

    if(a?.status==="blocked"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"Доступ к сервису заблокирован."});
      return json({ok:true,processed:1});
    }

    if(!a?.allowed){
      if(low==="ℹ️ как получить доступ"){
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:"Доступ предоставляется по invite-коду. Полученный код отправьте боту одним сообщением."
        });
        return json({ok:true,processed:1});
      }
      if(!raw||raw.startsWith("/")){
        await touch(sb,user);
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:"Для регистрации отправьте действующий invite-код."
        });
        return json({ok:true,processed:1});
      }
      const r=await redeem(sb,user,raw);
      if(r?.ok){
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:`✅ Регистрация завершена.\nРоль: ${roleName(String(r.role))}.`,
          reply_markup:activeKeyboard
        });
      }else{
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:"Invite-код недействителен, истёк или уже использован."
        });
      }
      return json({ok:true,processed:1});
    }

    await touch(sb,user);

    if(low==="/me"||low==="👤 мой доступ"){
      await tg(token,"sendMessage",{
        chat_id:chatId,
        text:`Доступ: активен\nРоль: ${roleName(String(a.role))}`,
        reply_markup:activeKeyboard
      });
      return json({ok:true,processed:1});
    }

    const userId=Number(user.id);

    if(m.location){
      await tg(token,"sendMessage",{chat_id:chatId,text:["📍 Передача геопозиции отключена.","","Используйте ручной ввод через поиск:","/nearby 50.4501 30.5234 10","","Допустимые варианты:","/nearby 50.4501, 30.5234, 10","/nearby 50.4501; 30.5234; 10","","Для истории: /history 50.4501 30.5234 5"].join("\n"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="⬅️ главное меню"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"Главное меню.",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="/latest"||low==="🔥 последние события"){
      const d=await searchEvents(sb,{limit:8});
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:searchText(d,"🔥 Последние события"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="🚦 приоритет"||low.startsWith("/priority")){
      const parts=raw.split(/\s+/);
      const hours=low==="🚦 приоритет"?24:parsePeriod(parts[1]??"24h",24);
      const minScore=low==="🚦 приоритет"?0:Math.max(0,Math.min(100,Number(parts[2]??0)||0));
      const d=await priorityEvents(sb,hours,minScore);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:priorityText(d,hours),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="🔎 поиск"){
      await tg(token,"sendMessage",{chat_id:chatId,text:["🔎 Поиск","","По ID:","/search aee43b0d","","По региону:","/search Київська","","По координатам и радиусу:","/nearby 50.4501 30.5234 25","/nearby 50.4501, 30.5234, 25","/nearby 50.4501; 30.5234; 25","","История до 365 дней:","/history 50.4501 30.5234 5","","Координаты вводятся вручную. Передача геопозиции Telegram отключена."].join("\n"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/search")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /search <ID события или регион>",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const filters=/^[0-9a-f]{6,36}$/i.test(q)?{id:q,limit:10}:{oblast:q,limit:10};
      const d=await searchEvents(sb,filters);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:searchText(d,"🔎 Результаты поиска"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/event")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /event <ID события>",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const d=await searchEvents(sb,{id:q,limit:1});
      const e=Array.isArray(d?.events)?d.events[0]:null;
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:e?"🧾 Карточка события\n\n"+fmtEvent(e):"Событие не найдено.",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="🧠 deep osint"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"🧠 Deep OSINT\n\nУкажите ID события, например:\n/deeposint aee43b0d",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/deeposint")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /deeposint <ID события>",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const d=await deepOsint(sb,q);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:deepOsintText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});
      return json({ok:true,processed:1});
    }

    if(low==="📑 досье"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"📑 OSINT-досье\n\nУкажите ID события, например:\n/dossier aee43b0d",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/dossier")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /dossier <ID события>",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      try{
        const d=await dossier(sb,q);
        await countRequest(sb,userId);
        await tg(token,"sendMessage",{chat_id:chatId,text:dossierTextClient(d),reply_markup:activeKeyboard,disable_web_page_preview:true});
      }catch(e){
        console.error("client dossier failed:",e instanceof Error?e.message:String(e));
        await tg(token,"sendMessage",{
          chat_id:chatId,
          text:"⚠️ Досье временно не успело сформироваться. Повторите /dossier "+q+" через несколько секунд.",
          reply_markup:activeKeyboard
        });
      }
      return json({ok:true,processed:1});
    }

    if(low==="📊 статистика"||low.startsWith("/stats")){
      const arg=low==="📊 статистика"?"24h":(raw.split(/\s+/)[1]??"24h");
      const hours=parsePeriod(arg,24);
      const a=await analytics(sb,hours);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:statsText(a,hours),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="📈 аналитика"||low.startsWith("/analytics")){
      const arg=low==="📈 аналитика"?"7d":(raw.split(/\s+/)[1]??"7d");
      const hours=parsePeriod(arg,168);
      const a=await analytics(sb,hours);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:analyticsText(a,hours),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="📍 рядом"){
      await tg(token,"sendMessage",{chat_id:chatId,text:["📍 Ручной поиск по координатам","","/nearby 50.4501 30.5234 10","/nearby 50.4501, 30.5234, 10","/nearby 50.4501; 30.5234; 10","","История:","/history 50.4501 30.5234 5"].join("\n"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/nearby")){
      const c=parseCoords(raw.split(/\s+/).slice(1).join(" "));
      if(!c){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Ручной ввод: /nearby <lat> <lon> [радиус_км]\nПримеры:\n/nearby 50.4501 30.5234 10\n/nearby 50.4501, 30.5234, 10\n/nearby 50.4501; 30.5234; 10",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const d=await searchEvents(sb,{lat:c.lat,lon:c.lon,radius_km:c.radiusKm,limit:10});
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:searchText(d,"📍 События рядом • "+c.radiusKm+" км"),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/history")){
      const c=parseCoords(raw.split(/\s+/).slice(1).join(" "));
      if(!c){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Ручной ввод: /history <lat> <lon> [радиус_км]\nПримеры:\n/history 50.4501 30.5234 5\n/history 50.4501, 30.5234, 5\n/history 50.4501; 30.5234; 5",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const radiusM=Math.round(c.radiusKm*1000);
      const rows=await historyNearby(sb,c.lat,c.lon,radiusM);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:historyText(rows,c.lat,c.lon,radiusM),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low==="🗺 гео/инфра"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"🗺 Гео/инфра\n\nУкажите ID события, например:\n/geo aee43b0d",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    if(low.startsWith("/geo")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){
        await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /geo <ID события>",reply_markup:activeKeyboard});
        return json({ok:true,processed:1});
      }
      const g=await geoContext(sb,q);
      await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:geoText(g),reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }

    await tg(token,"sendMessage",{
      chat_id:chatId,
      text:"Выберите раздел в меню.",
      reply_markup:activeKeyboard
    });
    return json({ok:true,processed:1});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    console.error("firewatch-client webhook error:",msg);
    return json({ok:false,processed:0,error:msg},200);
  }
});
