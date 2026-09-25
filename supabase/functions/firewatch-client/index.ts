
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
async function tgTextDocument(token:string,chatId:string,text:string,fileName:string,caption:string,mime="text/csv; charset=utf-8"){
  const form=new FormData();
  form.append("chat_id",chatId);
  form.append("document",new Blob([text],{type:mime}),fileName);
  form.append("caption",caption.slice(0,900));
  const r=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:form,signal:AbortSignal.timeout(30000)});
  const d=await r.json();if(!r.ok||!d?.ok)throw new Error(`Telegram sendDocument: ${d?.description??r.status}`);return d.result;
}
const activeKeyboard={
  keyboard:[
    [{text:"🔥 Последние события"},{text:"🔎 Поиск"}],
    [{text:"📊 Статистика"},{text:"📈 Аналитика"}],
    [{text:"🚦 Приоритет"},{text:"🧠 Deep OSINT"}],
    [{text:"📑 Досье"},{text:"🗺 Гео/инфра"}],
    [{text:"🧭 Area OSINT"},{text:"🏭 Объекты области"}],
    [{text:"🛰 Satellite"},{text:"👤 Мой доступ"}]
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
  const e=d.event??{},s=d.summary??{},eff=d.effis??{},air=d.air_context??{},al=air.air_alert??{},th=air.public_air_threat_context??{},geo=d.geolocation??{},ov=geo.overture??{},gn=geo.geonames??{},vis=d.visual_context??{},pano=vis.panoramax??{},oam=vis.openaerialmap??{},env=d.environment_context??{},radar=env.radar??{},li=env.lightning??{},prov=d.provenance??{},sem=d.semantic??{},ss=sem.summary??{},src:any[]=Array.isArray(d.sources)?d.sources:[],tl:any[]=Array.isArray(d.timeline)?d.timeline:[];
  const items=Number(ss.items??0),providers=Number(ss.providers??0),classes=Number(ss.source_classes??0);
  const geoSupported=Number(ss.geo_supported??0),duplicates=Number(ss.duplicate_items??0),divergences=Number(ss.divergences??0);
  const corr=String(s.corroboration_level??"none");
  const lines=[
    "🧠 DEEP OSINT #"+String(e.id??"").slice(0,8),
    "Priority: "+Number(e.priority_score??0)+"/100 • confidence: "+String(e.confidence_level??"—"),
    "",
    "📚 OSINT evidence",
    "Публикаций: "+items,
    "Провайдеров: "+providers+" • классов источников: "+classes,
    "Независимое corroboration: "+corr,
    "Географическое подтверждение: "+geoSupported+"/"+items,
    "Дубликаты/пересказы: "+duplicates+" • расхождения: "+divergences,
    "Provenance: "+Number(prov.statements??0)+" statements • review "+Number(prov.pending_reviews??0),
    ""
  ];
  if(String(eff.status??"not_cached")==="not_cached"){
    lines.push("🌲 EFFIS: not cached • ещё не обработано текущим priority batch","");
  }else{
    lines.push("🌲 EFFIS: "+String(eff.status??"—")+" • FWI "+(eff.fwi_value==null?"—":Number(eff.fwi_value).toFixed(1))+" • active "+Number(eff.active_fire_count??0)+" • burnt-area "+Number(eff.burnt_area_count??0),"");
  }
  const alertLabel:Record<string,string>={
    during_alert:"тревога действовала во время события",
    alert_start_within_30m:"начало тревоги в пределах ±30 мин",
    alert_start_within_2h:"начало тревоги в пределах ±2 ч",
    no_nearby_alert:"близкой тревоги не обнаружено",
    history_unavailable:"история тревог для времени события недоступна"
  };
  lines.push("✈️ Воздушный контекст");
  lines.push("Тревоги: "+String(alertLabel[String(al.relation??"")]??al.relation??"—"));
  if(Boolean(th.present)){
    const types=Array.isArray(th.threat_types)&&th.threat_types.length?th.threat_types.join(", "):"тип не указан";
    lines.push("Публичный air-threat context: есть • "+types+" • "+String(th.time_relation??"—"));
  }else lines.push("Публичный air-threat context: не найден");
  lines.push("");
  lines.push("🌦 Погодный / грозовой контекст");
  if(String(env.status??"not_cached")==="not_cached"){
    lines.push("RainViewer / MTG LI: ещё не закэшировано");
  }else{
    const rs=String(radar.status??"—");
    lines.push("RainViewer: "+(rs==="frame_available"?"radar frame есть"+(radar.time_delta_minutes!=null?" • Δt "+Number(radar.time_delta_minutes).toFixed(1)+" мин":""):rs==="history_unavailable"?"история для времени события недоступна":rs));
    const ls=String(li.status??"—");
    if(ls==="disabled")lines.push("MTG LI: отключен");
    else lines.push("MTG LI: "+(ls==="product_coverage_available"?"NRT product coverage есть • "+Number(li.product_count??0)+" products":"нет product coverage")+" • local flashes: "+String(li.local_signal??"not_extracted"));
  }
  lines.push("");

  const ovPlaces:any[]=Array.isArray(ov.places)?ov.places:[];
  lines.push("🗺 Геоконтекст");
  if(String(ov.status??"not_cached")==="not_cached"){
    lines.push("Overture: ещё не закэшировано");
  }else if(ovPlaces.length){
    lines.push("Overture Places: "+ovPlaces.length+" • snapshot "+String(ov.release??"—"));
    for(const p of ovPlaces.slice(0,3)){
      lines.push("• "+String(p.name??p.category??"объект")+" • "+Number(p.distance_m??0)+" м"+(p.category?" • "+String(p.category):""));
    }
  }else{
    lines.push("Overture: "+String(ov.status??"—")+" • ближайшие POI не найдены");
  }
  if(String(gn.status??"not_cached")==="waiting_username")lines.push("GeoNames: ожидает подключения username");
  else if(Array.isArray(gn.places)&&gn.places.length){
    lines.push("GeoNames:");
    for(const p of gn.places.slice(0,3)){
      const nm=String(p.name??p.toponym_name??"—");
      const canonical=p.toponym_name&&String(p.toponym_name)!==nm?" ("+String(p.toponym_name)+")":"";
      const dist=Number.isFinite(Number(p.distance_km))?(Number(p.distance_km).toFixed(1)+" км"):"—";
      const code=String(p.feature_code??"");
      const type=code==="PPLA"?"административный центр":code==="PPLA2"?"адм. центр уровня 2":code==="PPLA3"?"адм. центр уровня 3":code==="PPLA4"?"адм. центр уровня 4":code==="PPL"?"населённый пункт":String(p.feature_code_name??p.feature_class_name??code??"место");
      lines.push("• "+nm+canonical+" • "+dist+" • "+type);
    }
  }
  lines.push("");
  lines.push("🖼 Визуальный контекст");
  if(String(vis.status??"not_cached")==="not_cached"){
    lines.push("Panoramax/OAM: ещё не закэшировано");
  }else{
    lines.push("Panoramax: "+Number(pano.count??0)+(pano.nearest_distance_m!=null?" • ближайший "+Math.round(Number(pano.nearest_distance_m))+" м":""));
    lines.push("OpenAerialMap: "+Number(oam.count??0)+(oam.latest_datetime?" • последний "+String(oam.latest_datetime).slice(0,10):""));
  }
  lines.push("");

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
function httpsUrl(v:any){
  const s=String(v??"").trim();
  try{const u=new URL(s);return u.protocol==="https:"?u.toString():null}catch{return null}
}
async function sendVisualPreviews(token:string,chatId:string|number,d:any){
  const vis=d?.visual_context??{},pano=vis?.panoramax??{},oam=vis?.openaerialmap??{};
  const candidates:any[]=[];
  const pItems:any[]=Array.isArray(pano?.items)?pano.items:[];
  const p=pItems.find((x:any)=>httpsUrl(x?.thumbnail));
  if(p){
    candidates.push({
      source:"Panoramax",photo:httpsUrl(p.thumbnail),
      original:httpsUrl(p.image_url)??httpsUrl(p.self_url),
      caption:"🖼 Panoramax"+(p.distance_m!=null?" • "+Math.round(Number(p.distance_m))+" м":"")+(p.datetime?" • "+String(p.datetime).slice(0,10):"")+"\nStreet-level visual reference • не является автоматическим подтверждением события."
    });
  }
  const oItems:any[]=Array.isArray(oam?.items)?oam.items:[];
  const o=oItems.find((x:any)=>httpsUrl(x?.thumbnail));
  if(o){
    candidates.push({
      source:"OpenAerialMap",photo:httpsUrl(o.thumbnail),
      original:httpsUrl(o.self_url)??httpsUrl(o.image_href),
      caption:"🛰 OpenAerialMap"+(o.datetime?" • "+String(o.datetime).slice(0,10):"")+(o.platform?" • "+String(o.platform):"")+(o.gsd!=null?" • GSD "+String(o.gsd):"")+"\nAerial visual reference • не является автоматическим подтверждением события."
    });
  }
  for(const x of candidates.slice(0,2)){
    try{
      const body:any={chat_id:chatId,photo:x.photo,caption:String(x.caption).slice(0,900)};
      if(x.original)body.reply_markup={inline_keyboard:[[{text:"Открыть оригинал",url:x.original}]]};
      await tg(token,"sendPhoto",body);
    }catch(e){
      console.error("visual preview failed:",x.source,e instanceof Error?e.message:String(e));
    }
  }
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

async function historyNearby(sb:any,lat:number,lon:number,radiusM:number){
  const {data,error}=await sb.rpc("find_hotspot_history_nearby",{p_lat:lat,p_lon:lon,p_radius_m:radiusM,p_days:365,p_limit:20});
  if(error)throw error;return data??[];
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
    {command:"objects",description:"Объекты по области / фильтры / multi"},
    {command:"objects_count",description:"Количество объектов без списка"},
    {command:"objects_explain",description:"Показать интерпретацию запроса"},
    {command:"objects_csv",description:"CSV объектов области"},
    {command:"objects_geojson",description:"GeoJSON объектов области"},
    {command:"objects_near",description:"Объекты в радиусе точки"},
    {command:"objects_nearest",description:"Ближайшие N объектов"},
    {command:"objects_city",description:"Объекты вокруг города / НП"},
    {command:"objects_polygon",description:"Объекты внутри полигона"},
    {command:"objects_route",description:"Объекты вдоль маршрута"},
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
async function regionalSearchRequest(payload:any){
  const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!k)throw new Error("missing Supabase env");
  const r=await fetch(u+"/functions/v1/firewatch-regional-search",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+k},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error("Regional Search invalid response")}
  if(!r.ok||!d?.ok){let m=String(d?.error??("HTTP "+r.status));if(Array.isArray(d?.suggestions)&&d.suggestions.length)m+="\nВарианты: "+d.suggestions.map((x:any)=>x.label??x.key).join(" / ");throw new Error(m)}return d;
}
function parseRegionalArgs(v:string){const query=String(v??"").trim();return query?{query}:null}
function regionalCsv(d:any){
  const cols=["No","Name","Categories","Brand","Operator","Settlement","Settlement method","Settlement distance m","Address","Address quality","Normalized location","Latitude","Longitude","Distance m","Route distance m","Route along m","Route segment","Sources","Source count","Resolution status","Confidence","Wikidata QID"];
  const cell=(v:any)=>{const s=String(v??"");return /[",\n\r;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const rows=(Array.isArray(d?.objects)?d.objects:[]).map((x:any,i:number)=>[i+1,x.canonical_name,(x.category_keys??[]).join(" | "),x.brand,x.operator,x.settlement,x.settlement_method,x.settlement_distance_m,x.address,x.address_quality,x.normalized_location,Number(x.latitude).toFixed(6),Number(x.longitude).toFixed(6),x.distance_m,x.route_distance_m,x.route_along_m,x.route_segment,(Array.isArray(x.sources)?x.sources:[]).map((s:any)=>s.source+":"+s.source_id).join(" | "),x.source_count,x.resolution_status,x.resolution_confidence,x.wikidata_qid]);
  return "\uFEFF"+[cols,...rows].map(r=>r.map(cell).join(",")).join("\r\n");
}
function regionalGeoJson(d:any){
  return JSON.stringify({type:"FeatureCollection",name:"GeoWatch Regional Object Search",metadata:{oblast_code:d?.oblast?.code??d?.oblast_code??null,oblast_name:d?.oblast?.name_uk??d?.oblast_name??null,category_label:d?.category_label??null,summary:d?.summary??{}},features:(Array.isArray(d?.objects)?d.objects:[]).map((x:any)=>({type:"Feature",geometry:{type:"Point",coordinates:[Number(x.longitude),Number(x.latitude)]},properties:{name:x.canonical_name??null,categories:x.category_keys??[],brand:x.brand??null,operator:x.operator??null,settlement:x.settlement??null,settlement_method:x.settlement_method??null,settlement_distance_m:x.settlement_distance_m??null,address:x.address??null,address_quality:x.address_quality??null,normalized_location:x.normalized_location??null,source_count:x.source_count??0,sources:x.sources??[],resolution_status:x.resolution_status??null,resolution_confidence:x.resolution_confidence??0,distance_m:x.distance_m??null,route_distance_m:x.route_distance_m??null,route_along_m:x.route_along_m??null,route_segment:x.route_segment??null,wikidata_qid:x.wikidata_qid??null}}))},null,2);
}
function parseSpatialPointList(v:string,minPoints:number){
  const pts=String(v??"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const m=x.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);if(!m)return null;
    const lat=Number(m[1]),lon=Number(m[2]);return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180?[lon,lat]:null;
  });
  if(pts.some(x=>!x)||pts.length<minPoints)return null;return pts as [number,number][];
}
function spatialModeText(sp:any){
  const mode=String(sp?.mode??"—"),target=sp?.settlement_target;
  if(target)return "город/НП: "+String(target.name??"—")+" • радиус "+(Number(target.applied_radius_m??sp.radius_m??0)/1000).toFixed(1)+" км • приблизительная зона";
  if(mode==="radius")return "радиус "+(Number(sp?.radius_m??0)/1000).toFixed(1)+" км от "+Number(sp?.center?.lat??0).toFixed(5)+", "+Number(sp?.center?.lon??0).toFixed(5);
  if(mode==="nearest")return "nearest "+Number(sp?.nearest_n??0)+" • поиск до "+(Number(sp?.search_radius_m??0)/1000).toFixed(1)+" км";
  if(mode==="polygon")return "полигон • вершин "+Number(sp?.input_vertices??0);
  if(mode==="route")return "маршрут "+(Number(sp?.route_length_m??0)/1000).toFixed(1)+" км • коридор ±"+(Number(sp?.corridor_m??0)/1000).toFixed(1)+" км";
  return mode;
}
function spatialSearchText(d:any){
  const s=d?.summary??{},sp=d?.spatial??s?.spatial??{},xs:any[]=Array.isArray(d?.objects)?d.objects:[],r=d?.resolution??s?.resolution??{},f=r?.filters??{},oblasts=(Array.isArray(d?.oblasts)?d.oblasts:[]).map((x:any)=>x.name_uk??x.code).filter(Boolean).join(", ");
  const fs=Object.entries(f).filter(([,v])=>v).map(([k,v])=>k+"="+String(v)).join(" • ");
  const lines=["🧭 SPATIAL OBJECT SEARCH",String(d?.category_label??d?.category_key??"—"),"Найдено: "+Number(s.resolved_objects??xs.length)+" • status "+String(d?.status??"—"),"Геометрия: "+spatialModeText(sp),"Области: "+(oblasts||"—")+(fs?"\nФильтры: "+fs:""),"OSM candidates: "+Number(s.osm_objects??0)+" • cache disabled",""];
  xs.slice(0,20).forEach((x:any,i:number)=>{
    const metric=x.distance_m!=null?" • "+Math.round(Number(x.distance_m))+" м от центра":x.route_distance_m!=null?" • "+Math.round(Number(x.route_distance_m))+" м от маршрута • along "+(Number(x.route_along_m??0)/1000).toFixed(1)+" км":"";
    lines.push((i+1)+". "+String(x.canonical_name??"—")+(x.brand&&x.brand!==x.canonical_name?" • "+String(x.brand):"")+(x.settlement?" • "+String(x.settlement):"")+(x.address?" • "+String(x.address):"")+"\n   "+Number(x.latitude).toFixed(5)+", "+Number(x.longitude).toFixed(5)+metric+" • "+Number(x.source_count??0)+" src");
  });
  if(xs.length>20)lines.push("","Показаны первые 20 из "+xs.length+". CSV/GeoJSON доступны в Web Dashboard.");
  if(!xs.length)lines.push("","Совпадений в подключённых публичных данных не найдено.");
  if(Boolean(s.truncated))lines.push("","⚠️ Достигнут лимит источника/выдачи.");
  if(Array.isArray(d?.errors)&&d.errors.length)lines.push("","⚠️ Partial: "+d.errors.slice(0,3).join(" | "));
  lines.push("","Граница Украины проверяется точным PostGIS ST_Covers. Radius/route corridor — геометрическая зона, не административная граница.");
  return lines.join("\n").slice(0,3900);
}
function parseSpatialCommand(raw:string,kind:"near"|"nearest"|"city"|"polygon"|"route"){
  const rest=raw.replace(/^\/objects_(?:near|nearest|city|polygon|route)(?:@\w+)?\s*/i,"").trim();
  if(kind==="near"){
    const m=rest.match(/^(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.+)$/);if(!m)return null;
    const lat=Number(m[1]),lon=Number(m[2]),km=Number(m[3]);if(lat<-90||lat>90||lon<-180||lon>180||km<.1||km>50)return null;
    return{query:m[4].trim(),spatial:{mode:"radius",lat,lon,radius_m:Math.round(km*1000)}};
  }
  if(kind==="nearest"){
    const m=rest.match(/^(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/);if(!m)return null;
    const lat=Number(m[1]),lon=Number(m[2]),n=Number(m[3]),km=Number(m[4]);if(lat<-90||lat>90||lon<-180||lon>180||n<1||n>100||km<.5||km>100)return null;
    return{query:m[5].trim(),spatial:{mode:"nearest",lat,lon,nearest_n:n,search_radius_m:Math.round(km*1000)}};
  }
  const parts=rest.split("|").map(x=>x.trim()).filter(Boolean);
  if(kind==="city"){
    if(parts.length<2||parts.length>3)return null;
    const km=parts.length===3?Number(parts[1]):NaN,query=parts.length===3?parts[2]:parts[1];
    if(parts.length===3&&(!Number.isFinite(km)||km<.1||km>50))return null;
    return{query,spatial:{mode:"city",name:parts[0],...(Number.isFinite(km)?{radius_m:Math.round(km*1000)}:{})}};
  }
  if(kind==="polygon"){
    if(parts.length!==2)return null;const pts=parseSpatialPointList(parts[1],3);if(!pts)return null;
    const ring=[...pts];if(ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1])ring.push([...ring[0]] as [number,number]);
    return{query:parts[0],spatial:{mode:"polygon",geometry:{type:"Polygon",coordinates:[ring]}}};
  }
  if(parts.length!==3)return null;const km=Number(parts[1]),pts=parseSpatialPointList(parts[2],2);if(!pts||!Number.isFinite(km)||km<.1||km>20)return null;
  return{query:parts[0],spatial:{mode:"route",route:pts,corridor_m:Math.round(km*1000)}};
}
function regionalSearchText(d:any){
  const s=d?.summary??{},res=d?.resolution??s?.resolution??{},xs:any[]=Array.isArray(d?.objects)?d.objects:[],filters=res?.filters??s?.filters??{},sf=s?.settlement_filter??null;
  const mode=res?.mode==="multi"?"multi-category":res?.mode==="generic"?"generic OSM":res?.mode==="semantic_hint"?"OSM semantic":res?.mode==="fuzzy"?"fuzzy":res?.mode==="qualified"?"category + filter":"category";
  const filterText=Object.entries(filters).filter(([,v])=>v).map(([k,v])=>k+"="+String(v)).join(" • ");
  const lines=[
    "🏭 REGIONAL OBJECT SEARCH",
    String(d?.oblast?.name_uk??d?.oblast_name??"—")+" • "+String(d?.category_label??d?.category_key??"—"),
    "Найдено: "+Number(s.resolved_objects??xs.length)+" • multi-source "+Number(s.multi_source??0)+" • status "+String(d?.status??"—")+(d?.cached?" • cache":" • fresh"),
    "Режим: "+mode+(res?.input?" • запрос: "+String(res.input):"")+(filterText?"\nФильтры: "+filterText:""),
    "Источники: OSM "+Number(s.osm_objects??0)+" • Overture "+Number(s.overture_objects??0)+" • Wikidata "+Number(s.wikidata_objects??0),
    "Адресация: tagged "+Number(s?.addressing?.settlement_direct??0)+" • inferred "+Number(s?.addressing?.settlement_inferred??0)+" • missing "+Number(s?.addressing?.settlement_missing??0),
    ""
  ];
  if(sf)lines.splice(lines.length-1,0,"Нас. пункт: "+(sf.mode==="radius_fallback"?"≈ "+String(sf.target??sf.query??"—")+" • радиус "+(Number(sf.radius_m??0)/1000).toFixed(1)+" км":"enriched-name "+String(sf.query??"—"))+" • не административная граница");
  xs.slice(0,20).forEach((x:any,i:number)=>lines.push((i+1)+". "+String(x.canonical_name??"—")+(x.brand&&x.brand!==x.canonical_name?" • "+String(x.brand):"")+(x.settlement?" • "+String(x.settlement):"")+(x.address?" • "+String(x.address):"")+"\n   "+Number(x.latitude).toFixed(5)+", "+Number(x.longitude).toFixed(5)+" • "+Number(x.source_count??0)+" src • "+String(x.resolution_status??"—")));
  if(xs.length>20)lines.push("","Показаны первые 20 из "+xs.length+". Полный список: /objects_csv <область> <объект>");
  if(!xs.length)lines.push("","Совпадений в подключённых публичных данных не найдено.");
  if(Boolean(s.truncated))lines.push("","⚠️ Достигнут лимит источника/выдачи: результат может быть неполным.");
  if(Array.isArray(d?.errors)&&d.errors.length)lines.push("","⚠️ Partial: "+d.errors.slice(0,3).join(" | "));
  lines.push("","Данные — инвентаризация публичных источников; полнота зависит от картографирования и актуальности источников.");
  return lines.join("\n").slice(0,3900);
}
function regionalCountText(d:any){
  const s=d?.summary??{},r=d?.resolution??s?.resolution??{},f=r?.filters??s?.filters??{},sf=s?.settlement_filter??null;
  const fs=Object.entries(f).filter(([,v])=>v).map(([k,v])=>k+"="+String(v)).join(" • ");
  return ["🔢 REGIONAL OBJECT COUNT",String(d?.oblast?.name_uk??d?.oblast_name??"—")+" • "+String(d?.category_label??d?.category_key??"—"),"Найдено: "+Number(s.resolved_objects??0)+" • status "+String(d?.status??"—")+(d?.cached?" • cache":" • fresh"),"Режим: "+String(r?.mode??"—")+(fs?"\nФильтры: "+fs:""),sf?"Нас. пункт: "+(sf.mode==="radius_fallback"?"≈ "+String(sf.target??sf.query??"—")+" • радиус "+(Number(sf.radius_m??0)/1000).toFixed(1)+" км":"enriched-name "+String(sf.query??"—"))+" • не административная граница":null,"OSM candidates: "+Number(s.osm_objects??0)+(s.truncated?" • ⚠️ truncated":"")].filter(Boolean).join("\n").slice(0,3900);
}
function regionalExplainText(d:any){
  const r=d?.resolution??{},cats=Array.isArray(r.categories)?r.categories:[],f=r.filters??{},sp=d?.source_plan??{};
  const lines=["🧠 REGIONAL QUERY EXPLAIN",String(d?.oblast?.name_uk??"—")+" • "+String(d?.oblast?.code??"—"),"Режим: "+String(r.mode??"—"),"Интерпретация:"];
  for(const x of cats)lines.push("• "+String(x.label??x.key??"—")+" • "+String(x.mode??"—")+" • confidence "+Math.round(Number(x.confidence??0)*100)+"%");
  const fs=Object.entries(f).filter(([,v])=>v);if(fs.length){lines.push("","Фильтры:");for(const [k,v] of fs)lines.push("• "+k+": "+String(v))}
  lines.push("","План: "+String(sp.primary??"—")+" • polygon "+(sp.polygon_filter?"yes":"no")+" • cache "+Number(sp.cache_ttl_hours??0)+"h");
  return lines.join("\n").slice(0,3900);
}
function regionalErrorText(e:any){
  const m=e instanceof Error?e.message:String(e);
  if(/oblast not found/i.test(m))return "⚠️ Область не распознана.\n\nПример: /objects Киевская область нефтебаза\nТакже поддерживаются украинские и английские названия.";
  if(/ambiguous category/i.test(m))return "⚠️ Запрос неоднозначен. Уточните тип объекта.\n"+m.replace(/^ambiguous category:?\s*/i,"").slice(0,500);
  return "⚠️ Региональный поиск временно не выполнен.\n"+m.slice(0,500);
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
  for(const k of order){const x=near[k];if(!x)continue;lines.push("• "+(labels[k]??k)+": "+String(x.name??"—")+" • "+Math.round(Number(x.distance_m??0))+" м"+(x.subcategory?" • "+String(x.subcategory):""))}
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
async function clientLatencyText(sb:any,eventId?:string){
  if(eventId?.trim()){
    const {data,error}=await sb.rpc("firewatch_event_latency",{p_query:eventId.trim()});if(error)throw error;
    if(!data)return "⏱ Latency\n\nСобытие не найдено.";
    return [
      "⏱ LATENCY #"+String(data.event_id??"").slice(0,8),
      "Source latency: "+Number(data.source_latency_min??0).toFixed(1)+" мин",
      "GeoWatch delivery: "+(data.delivery_latency_min==null?"—":Number(data.delivery_latency_min).toFixed(1)+" мин"),
      "End-to-end: "+(data.end_to_end_latency_min==null?"—":Number(data.end_to_end_latency_min).toFixed(1)+" мин"),
      "Telegram: "+(data.telegram_sent?"sent":"not sent")
    ].join("\n");
  }
  const {data,error}=await sb.rpc("firewatch_latency_health",{p_hours:24});if(error)throw error;
  const d=data?.detections??{},v=data?.delivery??{};
  return [
    "⏱ SOURCE / DELIVERY LATENCY • 24h",
    "Source p95: "+Number(d.p95_min??0).toFixed(1)+" мин • >90м "+Number(d.over_90m??0)+"/"+Number(d.count??0),
    "Delivery p95: "+Number(v.p95_min??0).toFixed(1)+" мин • >10м "+Number(v.over_10m??0),
    "Required unsent: "+Number(v.required_unsent??0)
  ].join("\n");
}
async function clientIntegrityText(sb:any){
  const {data,error}=await sb.rpc("firewatch_notification_integrity_summary");if(error)throw error;
  const st=data?.state??{};
  return [
    "🧪 Notification Integrity",
    "Статус: "+String(st.status??"—"),
    "Notification gaps: "+Number(st.notification_gaps??0),
    "Delivery backlog >45 мин: "+Number(st.delivery_backlog??0),
    "Ошибки: "+Number(st.errors??0)+" • предупреждения: "+Number(st.warnings??0),
    "Проверка: "+ageText(st.last_success_run)
  ].join("\n");
}
async function clientCoverageText(sb:any){
  const [{data,error},{data:base,error:be},{data:geo,error:ge}]=await Promise.all([
    sb.rpc("firewatch_source_coverage_summary"),sb.rpc("firewatch_source_baseline_summary"),sb.rpc("firewatch_geo_integrity_summary")
  ]);if(error)throw error;if(be)throw be;
  const st=data?.state??{},bs=base?.state??{},gs=ge?{}:(geo?.state??{});
  return [
    "📡 Source Coverage",
    "Статус: "+String(st.status??"—"),
    "Источники: active "+Number(st.sources_active??0)+"/"+Number(st.sources_total??0)+" • degraded "+Number(st.sources_degraded??0),
    "Baseline: "+String(bs.status??"—")+" • learning "+Number(bs.sources_learning??0)+" • watch "+Number(bs.sources_watch??0)+" • anomaly "+Number(bs.sources_anomaly??0),
    ge?"Geo integrity: недоступен":"Geo integrity: "+String(gs.status??"—")+" • API "+Number(gs.api_recent??0)+" → DB "+Number(gs.db_matched??0)+" • missing "+Number(gs.missing_in_db??0),
    "Проверка: "+ageText(st.last_success_run)
  ].join("\n");
}
async function clientOsintText(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_osint_event_detail",{p_query:q.trim()});if(error)throw error;if(!data)return "OSINT: событие не найдено.";
  const rows:any[]=Array.isArray(data.evidence)?data.evidence:[];
  const lines=["🔎 OSINT #"+String(data.id??"").slice(0,8),"Область: "+String(data.oblast??"—"),"Независимых источников: "+Number(data.source_count??0)+" • записей: "+Number(data.evidence_count??0),""];
  if(!rows.length)lines.push("Связанных публичных OSINT-событий в текущем окне не найдено.");
  else for(const x of rows.slice(0,8))lines.push("• ["+String(x.source??"source")+"] "+String(x.title??x.category??"").replace(/\s+/g," ").slice(0,180)+(x.distance_km!=null?" • "+Number(x.distance_km).toFixed(1)+" км":""));
  lines.push("","Контекстная корреляция не доказывает причинную связь.");
  return lines.join("\n").slice(0,3900);
}
async function clientGroundText(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_ground_context",{p_query:q.trim()});if(error)throw error;if(!data)return "Ground OSINT: событие не найдено.";
  const rows:any[]=Array.isArray(data.measurements)?data.measurements:[];
  const lines=["🌫 Ground OSINT #"+String(data.id??"").slice(0,8),"Станций: "+Number(data.station_count??0)+" • источников: "+Number(data.source_count??0),""];
  if(!rows.length)lines.push("Подходящих наземных измерений в текущем пространственно-временном окне не найдено.");
  else for(const x of rows.slice(0,10))lines.push("• "+String(x.station_name??x.station_id??"—")+" • "+String(x.parameter??"—")+": "+String(x.value??"—")+(x.unit?" "+String(x.unit):"")+(x.distance_km!=null?" • "+Number(x.distance_km).toFixed(1)+" км":""));
  lines.push("","Наземные измерения — независимый экологический контекст.");
  return lines.join("\n").slice(0,3900);
}
async function clientSatelliteText(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_satellite_evidence",{p_query:q.trim()});if(error)throw error;if(!data)return "Satellite Evidence: событие не найдено.";
  const b=data.before??null,a=data.after??null;
  const scene=(label:string,x:any)=>x?label+": "+String(x.datetime??"").slice(0,16).replace("T"," ")+" UTC • cloud "+Number(x.cloud_pct??0).toFixed(1)+"%":"";
  return [
    "🛰 Satellite Surface Evidence #"+String(data.event_id??"").slice(0,8),
    "Статус: "+String(data.status??"pending"),
    scene("До",b),scene("После",a),
    data.dnbr!=null?"dNBR: "+Number(data.dnbr).toFixed(3):null,
    data.dndvi!=null?"ΔNDVI: "+Number(data.dndvi).toFixed(3):null,
    "Visual: "+String(data.visual?.status??"pending"),
    "",
    "Спектральное изменение поверхности не устанавливает причину события."
  ].filter(Boolean).join("\n").slice(0,3900);
}
async function clientReportText(sb:any,q:string){
  const {data,error}=await sb.rpc("firewatch_report_status",{p_query:q.trim()});if(error)throw error;if(!data)return "Report: событие не найдено.";
  const classes=Array.isArray(data.evidence_classes)?data.evidence_classes.join(", "):"—";
  return [
    "📋 EVENT EVIDENCE REPORT #"+String(data.event_id??"").slice(0,8),
    "Статус: "+(data.available?"готов":"ещё не сформирован"),
    "Coverage: "+Number(data.coverage_available??0)+"/"+Number(data.coverage_expected??0),
    "Классы: "+classes,
    "Generated: "+String(data.generated_at??"—")
  ].join("\n");
}
async function clientSourcesText(sb:any){
  const [{data:s,error},{data:cat,error:ce}]=await Promise.all([
    sb.rpc("firewatch_admin_snapshot"),
    sb.from("osint_source_catalog").select("source_key,label,source_class,enabled").eq("enabled",true).order("source_key")
  ]);
  if(error)throw error;if(ce)throw ce;
  const rows:any[]=cat??[];
  return [
    "📡 Источники GeoWatch",
    "FIRMS NOAA: "+ageText(s?.monitor?.last_success_run),
    "MODIS: "+ageText(s?.monitor_modis?.last_success_run),
    "Suomi NPP: "+ageText(s?.monitor_snpp?.last_success_run),
    "OSINT catalog active: "+rows.length,
    "",
    ...rows.slice(0,24).map((x:any)=>"• "+String(x.label??x.source_key)+" • "+String(x.source_class??"—"))
  ].join("\n").slice(0,3900);
}
async function clientArchiveText(sb:any){
  const {data:s,error}=await sb.rpc("firewatch_admin_snapshot");if(error)throw error;
  const h=s?.history_backfill??{},db=Number(s?.database_size_bytes??0);
  return [
    "🗄 Архив и база",
    "365-дневный backfill: "+(h.done?"✅ завершён":"⏳ выполняется"),
    "Обработано дней: "+Number(h.processed_days??0),
    "Агрегатных ячеек: "+Number(h.upserted_cells??0),
    "Размер базы: "+(db/1024/1024).toFixed(1)+" МБ",
    "Raw detections retention: 90 дней",
    "Compact archive: rolling 365 дней"
  ].join("\n");
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
      await tg(token,"sendMessage",{chat_id:chatId,text:["🔎 Поиск","","По ID:","/search aee43b0d","","По региону:","/search Київська","","По координатам и радиусу:","/nearby 50.4501 30.5234 25","/nearby 50.4501, 30.5234, 25","/nearby 50.4501; 30.5234; 25","","История до 365 дней:","/history 50.4501 30.5234 5","","Area OSINT:","/area 46.61212 31.55511 5000","/area 19be809d 5000","/infra 19be809d 2000","/entity Q30017836","/registry 3717e647","","Объекты по области:","/objects Полтавская область АЗС","/objects Київська аптеки","/objects_csv Полтавская область АЗС","","OSINT layers:","/osint 19be809d","/ground 19be809d","/satellite 19be809d","/latency 19be809d","","System read-only:","/events • /sources • /coverage • /integrity • /archive","","Координаты вводятся вручную. Передача геопозиции Telegram отключена."].join("\n"),reply_markup:activeKeyboard});
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
      await sendVisualPreviews(token,chatId,d);
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

    if(low==="🧭 area osint"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"🧭 Area OSINT\n\nПо событию:\n/infra <event-id> [radius_m]\n\nПо координатам:\n/area <lat> <lon> [radius_m]\n\nПример:\n/area 46.61212 31.55511 2000",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }
    if(low==="🏭 объекты области"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"🏭 Объекты области · Stage 43.1\n\nMulti:\n/objects Полтавская область АЗС + нефтебазы + резервуары\n\nФильтры:\nbrand:WOG city:Полтава operator:... address:... source:OSM confidence:90 has_address:yes\n\nБыстрый count:\n/objects_count Полтавская область АЗС brand:WOG\n\nРазбор запроса:\n/objects_explain Полтавская область трансформаторные подстанции 110 кВ\n\nЭкспорт:\n/objects_csv Полтавская область АЗС\n/objects_geojson Полтавская область АЗС\n\nНаселённый пункт при отсутствии addr:city может быть определён по ближайшему OSM place и помечается как inferred.\n\nSpatial:\n/objects_near 49.5883 34.5514 5 АЗС\n/objects_nearest 49.5883 34.5514 5 20 АЗС\n/objects_city Полтава | 10 | АЗС\n/objects_polygon АЗС | 49.53,34.45;49.53,34.65;49.65,34.65;49.65,34.45\n/objects_route АЗС | 2 | 49.55,34.40;49.62,34.75",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }
    if(low==="🛰 satellite"){
      await tg(token,"sendMessage",{chat_id:chatId,text:"🛰 Satellite Evidence\n\nУкажите ID события:\n/satellite 19be809d",reply_markup:activeKeyboard});
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_explain")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_explain <область> <объект/категория> [фильтры]",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      try{const d=await regionalSearchRequest({query:q,explain:true});await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:regionalExplainText(d),reply_markup:activeKeyboard})}
      catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_count")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_count <область> <объект/категория> [фильтры]",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      try{const d=await regionalSearchRequest({query:q,count_only:true});await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:regionalCountText(d),reply_markup:activeKeyboard})}
      catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_nearest")){
      const p=parseSpatialCommand(raw,"nearest");if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_nearest <lat> <lon> <N> <search_km> <объект>\nПример: /objects_nearest 49.5883 34.5514 5 20 АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1});}
      try{const d=await regionalSearchRequest(p);await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:spatialSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true})}catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_near")){
      const p=parseSpatialCommand(raw,"near");if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_near <lat> <lon> <radius_km> <объект>\nПример: /objects_near 49.5883 34.5514 5 АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1});}
      try{const d=await regionalSearchRequest(p);await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:spatialSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true})}catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_city")){
      const p=parseSpatialCommand(raw,"city");if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_city <город> | [radius_km] | <объект>\nПример: /objects_city Полтава | 10 | АЗС\nИли: /objects_city Полтава | АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1});}
      try{const d=await regionalSearchRequest(p);await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:spatialSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true})}catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_polygon")){
      const p=parseSpatialCommand(raw,"polygon");if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_polygon <объект> | lat,lon;lat,lon;lat,lon...\nПример: /objects_polygon АЗС | 49.53,34.45;49.53,34.65;49.65,34.65;49.65,34.45",reply_markup:activeKeyboard});return json({ok:true,processed:1});}
      try{const d=await regionalSearchRequest(p);await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:spatialSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true})}catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_route")){
      const p=parseSpatialCommand(raw,"route");if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_route <объект> | <corridor_km> | lat,lon;lat,lon...\nПример: /objects_route АЗС | 2 | 49.55,34.40;49.62,34.75",reply_markup:activeKeyboard});return json({ok:true,processed:1});}
      try{const d=await regionalSearchRequest(p);await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:spatialSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true})}catch(e){await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_geojson")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim(),p=parseRegionalArgs(q);
      if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_geojson <область> <объект/категория> [фильтры]\nПример: /objects_geojson Полтавская область АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      try{
        const d=await regionalSearchRequest(p);await countRequest(sb,userId);
        const body=regionalGeoJson(d),name=String(d?.oblast?.code??d?.oblast_code??"region")+"-"+String(d?.category_key??"objects")+".geojson";
        await tgTextDocument(token,chatId,body,name,"GeoWatch GeoJSON • "+String(d?.oblast?.name_uk??d?.oblast_name??q)+" • "+Number(d?.summary?.resolved_objects??0)+" объектов","application/geo+json; charset=utf-8");
      }catch(e){console.error("client regional geojson failed:",e instanceof Error?e.message:String(e));await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects_csv")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim(),p=parseRegionalArgs(q);
      if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects_csv <область> <объект/категория>\nПример: /objects_csv Полтавская область АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      try{
        const d=await regionalSearchRequest(p);await countRequest(sb,userId);
        const csv=regionalCsv(d),name=String(d?.oblast?.code??d?.oblast_code??"region")+"-"+String(d?.category_key??"objects")+".csv";
        await tgTextDocument(token,chatId,csv,name,"GeoWatch • "+String(d?.oblast?.name_uk??d?.oblast_name??q)+" • "+String(d?.category_label??d?.category_key??"objects")+" • "+Number(d?.summary?.resolved_objects??0)+" объектов");
      }catch(e){console.error("client regional csv failed:",e instanceof Error?e.message:String(e));await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/objects")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim(),p=parseRegionalArgs(q);
      if(!p){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /objects <область> <объект/категория>\nПример: /objects Полтавская область АЗС",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      try{
        const d=await regionalSearchRequest(p);await countRequest(sb,userId);
        await tg(token,"sendMessage",{chat_id:chatId,text:regionalSearchText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});
      }catch(e){console.error("client regional search failed:",e instanceof Error?e.message:String(e));await tg(token,"sendMessage",{chat_id:chatId,text:regionalErrorText(e),reply_markup:activeKeyboard})}
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/infra")){
      const p=raw.split(/\s+/),id=String(p[1]??"").trim(),radius=Math.max(250,Math.min(10000,Number(p[2]??2000)||2000));
      if(!id){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /infra <event-id> [radius_m]",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      const d=await areaIntelRequest({event_id:id,radius_m:radius});await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:areaIntelText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});
      return json({ok:true,processed:1});
    }
    if(low.startsWith("/area")){
      const p=raw.split(/\s+/),a=String(p[1]??"").trim();
      let payload:any={};
      if(a&&!Number.isFinite(Number(a))){
        payload={event_id:a,radius_m:Math.max(250,Math.min(10000,Number(p[2]??5000)||5000))};
      }else{
        const lat=Number(p[1]),lon=Number(p[2]),radius=Math.max(250,Math.min(10000,Number(p[3]??5000)||5000));
        if(!Number.isFinite(lat)||!Number.isFinite(lon)){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование:\n/area <lat> <lon> [radius_m]\nили /area <event-id> [radius_m]",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
        payload={lat,lon,radius_m:radius};
      }
      const d=await areaReportRequest(payload);await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:areaReportText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});return json({ok:true,processed:1});
    }
    if(low.startsWith("/registry")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /registry <QID|entity-id>\nПример: /registry 3717e647",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      const d=await registryFusionRequest(q);await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:registryFusionText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});return json({ok:true,processed:1});
    }
    if(low.startsWith("/entity")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();
      if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /entity <QID|entity-id>\nПример: /entity Q30017836",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      const d=await entityProfileRequest(q);await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:entityProfileText(d),reply_markup:activeKeyboard,disable_web_page_preview:true});return json({ok:true,processed:1});
    }
    if(low.startsWith("/latency")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();await countRequest(sb,userId);
      await tg(token,"sendMessage",{chat_id:chatId,text:await clientLatencyText(sb,q||undefined),reply_markup:activeKeyboard});return json({ok:true,processed:1});
    }
    if(low.startsWith("/integrity")){await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientIntegrityText(sb),reply_markup:activeKeyboard});return json({ok:true,processed:1});}
    if(low.startsWith("/coverage")){await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientCoverageText(sb),reply_markup:activeKeyboard});return json({ok:true,processed:1});}
    if(low.startsWith("/osint")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /osint <event-id>",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientOsintText(sb,q),reply_markup:activeKeyboard,disable_web_page_preview:true});return json({ok:true,processed:1});
    }
    if(low.startsWith("/ground")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /ground <event-id>",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientGroundText(sb,q),reply_markup:activeKeyboard});return json({ok:true,processed:1});
    }
    if(low.startsWith("/satellite")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /satellite <event-id>",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientSatelliteText(sb,q),reply_markup:activeKeyboard,disable_web_page_preview:true});return json({ok:true,processed:1});
    }
    if(low.startsWith("/report")){
      const q=raw.split(/\s+/).slice(1).join(" ").trim();if(!q){await tg(token,"sendMessage",{chat_id:chatId,text:"Использование: /report <event-id>",reply_markup:activeKeyboard});return json({ok:true,processed:1})}
      await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientReportText(sb,q),reply_markup:activeKeyboard});return json({ok:true,processed:1});
    }
    if(low==="/events"){const d=await searchEvents(sb,{limit:8});await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:searchText(d,"🔥 Последние события"),reply_markup:activeKeyboard});return json({ok:true,processed:1});}
    if(low==="/sources"){await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientSourcesText(sb),reply_markup:activeKeyboard});return json({ok:true,processed:1});}
    if(low==="/archive"){await countRequest(sb,userId);await tg(token,"sendMessage",{chat_id:chatId,text:await clientArchiveText(sb),reply_markup:activeKeyboard});return json({ok:true,processed:1});}

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
