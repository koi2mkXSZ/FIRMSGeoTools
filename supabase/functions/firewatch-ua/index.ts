import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FIRMS_BASE="https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const SOURCES=["VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT"] as const;
const UKRAINE_BBOX="21.5,43.5,41.5,53.5",LOOKBACK_DAYS=2,WINDOW_HOURS=24,MATCH_RADIUS_M=750,MATCH_WINDOW_HOURS=24;
const NOMINATIM_REVERSE="https://nominatim.openstreetmap.org/reverse";
const OPEN_METEO="https://api.open-meteo.com/v1/forecast";
const OVERPASS_API="https://overpass-api.de/api/interpreter";
const OSM_RADIUS_M=2000,OSM_REQUERY_MOVE_M=500,OSM_CACHE_DAYS=7;
const OSM_ENRICHMENT_ENABLED=false,TELEGRAM_CAPTION_LIMIT=1024,TELEGRAM_SYNC_LIMIT_PER_RUN=12,TELEGRAM_PACE_MS=1600;

type CsvRow=Record<string,string>;
type FirmsRecord={source:string;satellite:string;instrument:string;acq_datetime:string;latitude:string;longitude:string;scan:string;track:string;confidence:string;frp:string;daynight:string};
type OsmFeature={category:string;label:string;name:string;distance_m:number;osm_type:string;osm_id:number};
type OsmContext={type:string;score:number;nearest_feature:string|null;nearest_feature_distance_m:number|null;features:OsmFeature[]};
type Rollup={observation_count:number;first_seen:string;last_seen:string;first_latitude:number;first_longitude:number;last_latitude:number;last_longitude:number;status:string;lifecycle_status:string;telegram_message_id:number|null;telegram_message_kind:"photo"|"text"|null;telegram_sent:boolean;telegram_last_observation_count:number|null;telegram_last_seen_snapshot:string|null;telegram_last_frp:number|null;telegram_last_status:string|null;telegram_last_update_at:string|null;oblast_name_uk:string|null;oblast_name_en:string|null;latest_frp:number|null;max_frp:number|null;latest_confidence:string|null;satellites:string[];reliability_score:number|null;reliability_level:string|null;nearest_place_name:string|null;nearest_place_type:string|null;nearest_place_distance_km:number|null;weather_observed_at:string|null;weather_temperature_c:number|null;weather_relative_humidity_pct:number|null;weather_precipitation_mm:number|null;weather_wind_speed_ms:number|null;weather_wind_gust_ms:number|null;weather_wind_direction_deg:number|null;enrichment_updated_at:string|null;osm_context_type:string|null;osm_context_score:number|null;osm_nearest_feature:string|null;osm_nearest_feature_distance_m:number|null;osm_features:OsmFeature[]|null;osm_context_latitude:number|null;osm_context_longitude:number|null;osm_context_updated_at:string|null;multisource_count?:number;multisource_sources?:string[];event_confidence_level?:string|null;event_confidence_label?:string|null;best_latitude?:number|null;best_longitude?:number|null;best_location_source?:string|null;best_location_resolution_m?:number|null;cams_observed_at?:string|null;cams_carbon_monoxide_ug_m3?:number|null;cams_pm2_5_ug_m3?:number|null;cams_aerosol_optical_depth?:number|null;cams_pm10_wildfires_ug_m3?:number|null;cams_european_aqi?:number|null;plume_direction_deg?:number|null;s5p_co_observed_at?:string|null;s5p_co_mol_m2?:number|null;s5p_co_qa?:number|null;s5p_co_distance_km?:number|null;s5p_aer_observed_at?:string|null;s5p_aer_ai_340_380?:number|null;s5p_aer_ai_354_388?:number|null;s5p_aer_qa?:number|null;s5p_aer_distance_km?:number|null;atmosphere_signal_level?:string|null;atmosphere_updated_at?:string|null;frp_trend?:string|null;frp_latest_avg?:number|null;frp_previous_avg?:number|null;frp_change_pct?:number|null;cluster_diameter_m?:number|null;cluster_motion_m?:number|null;cluster_motion_bearing_deg?:number|null;plume_forecast?:any;plume_reference_place?:string|null;plume_reference_place_distance_km?:number|null;plume_reference_place_hour?:number|null;event_summary?:string|null;intelligence_updated_at?:string|null};
type Place={name:string;type:string|null;distance_km:number|null};
type Weather={observed_at:string;temperature_c:number|null;relative_humidity_pct:number|null;precipitation_mm:number|null;wind_speed_ms:number|null;wind_gust_ms:number|null;wind_direction_deg:number|null};

const REGION_RU:Record<string,string>={"Вінницька":"Винницкая область","Волинська":"Волынская область","Дніпропетровська":"Днепропетровская область","Донецька":"Донецкая область","Житомирська":"Житомирская область","Закарпатська":"Закарпатская область","Запорізька":"Запорожская область","Івано-Франківська":"Ивано-Франковская область","Київська":"Киевская область","Кіровоградська":"Кировоградская область","Луганська":"Луганская область","Львівська":"Львовская область","Миколаївська":"Николаевская область","Одеська":"Одесская область","Полтавська":"Полтавская область","Рівненська":"Ровненская область","Сумська":"Сумская область","Тернопільська":"Тернопольская область","Харківська":"Харьковская область","Херсонська":"Херсонская область","Хмельницька":"Хмельницкая область","Черкаська":"Черкасская область","Чернівецька":"Черновицкая область","Чернігівська":"Черниговская область","Автономна Республіка Крим":"Автономная Республика Крым","Київ":"Киев","Севастополь":"Севастополь"};
const OSM_LABEL:Record<string,string>={waste:"полигон/отходы",industrial:"промышленная зона",power:"энергетическая инфраструктура",forest:"лесная местность",agriculture:"сельскохозяйственная зона",urban:"застроенная территория",transport:"транспортная инфраструктура"};

function json(data:unknown,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseCsvLine(line:string){const out:string[]=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(ch===","&&!quoted){out.push(value);value=""}else value+=ch}out.push(value);return out}
function parseCsv(csv:string):CsvRow[]{const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim()!=="");if(lines.length<2)return[];const headers=parseCsvLine(lines[0]).map(x=>x.trim());return lines.slice(1).map(line=>{const vals=parseCsvLine(line),row:CsvRow={};headers.forEach((h,i)=>row[h]=vals[i]??"");return row})}
function acquisitionUtc(row:CsvRow){const date=row.acq_date?.trim(),raw=row.acq_time?.trim();if(!date||!raw||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;const hhmm=raw.padStart(4,"0");if(!/^\d{4}$/.test(hhmm))return null;const dt=new Date(`${date}T${hhmm.slice(0,2)}:${hhmm.slice(2,4)}:00Z`);return Number.isNaN(dt.getTime())?null:dt}
async function fetchSource(mapKey:string,source:string,now:Date){const url=`${FIRMS_BASE}/${encodeURIComponent(mapKey)}/${source}/${UKRAINE_BBOX}/${LOOKBACK_DAYS}`;const res=await fetch(url,{headers:{"user-agent":"firewatch-ua/4.0"},signal:AbortSignal.timeout(30000)});const body=await res.text();if(!res.ok)throw new Error(`${source}: FIRMS HTTP ${res.status}: ${body.slice(0,300)}`);const rows=parseCsv(body),cutoff=now.getTime()-WINDOW_HOURS*3600000,future=now.getTime()+600000,records:FirmsRecord[]=[];for(const row of rows){const dt=acquisitionUtc(row);if(!dt)continue;const t=dt.getTime();if(t<cutoff||t>future)continue;const lat=Number(row.latitude),lon=Number(row.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;records.push({source,satellite:row.satellite??"",instrument:row.instrument||"VIIRS",acq_datetime:dt.toISOString(),latitude:String(lat),longitude:String(lon),scan:row.scan??"",track:row.track??"",confidence:row.confidence??"",frp:row.frp??"",daynight:row.daynight??""})}return{records,fetched:rows.length}}
function regionRu(r:Rollup){const uk=r.oblast_name_uk?.trim()??"";return REGION_RU[uk]??r.oblast_name_en??"Регион не определён"}
function normalizeSatellite(s:string){const u=s.toUpperCase().replace(/\s/g,"");if(u.includes("20")||u==="N20")return"NOAA-20";if(u.includes("21")||u==="N21")return"NOAA-21";if(u.includes("NPP"))return"Suomi NPP";return s}
function confidenceRu(v:string|null){if(!v)return"не указана";const u=v.toLowerCase();if(u==="l"||u==="low")return"низкая";if(u==="n"||u==="nominal")return"номинальная";if(u==="h"||u==="high")return"высокая";return v}
function fmtDate(iso:string){const d=new Date(iso);return`${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()}`}
function fmtTime(iso:string){const d=new Date(iso);return`${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`}
function durationText(a:string,b:string){let m=Math.max(0,Math.round((new Date(b).getTime()-new Date(a).getTime())/60000));const h=Math.floor(m/60);m%=60;return h?`${h} ч ${m} мин`:`${m} мин`}
function classify(r:Rollup,reason:string){if(reason==="close"||r.status==="closed")return"closed";const obs=Number(r.observation_count||0),prev=Number(r.telegram_last_frp),latest=Number(r.latest_frp),grew=Number(r.telegram_last_observation_count??0)<obs;if(grew&&prev>0&&latest>0&&latest>=prev*1.3)return"strengthening";if(grew&&prev>0&&latest>0&&latest<=prev*0.7)return"weakening";const dur=(new Date(r.last_seen).getTime()-new Date(r.first_seen).getTime())/60000;if(obs>=3||dur>=60)return"active";if(obs>=2||(r.satellites??[]).length>=2)return"confirmed";return"new"}
function statusRu(s:string){return({new:"🆕 НОВЫЙ",confirmed:"✅ ПОДТВЕРЖДЁН",active:"🔥 АКТИВЕН",strengthening:"📈 УСИЛИВАЕТСЯ",weakening:"📉 ОСЛАБЕВАЕТ",closed:"⚪ БОЛЬШЕ НЕ ФИКСИРУЕТСЯ"} as Record<string,string>)[s]??s}
function reliability(r:Rollup){const c=(r.latest_confidence??"").toLowerCase();let score=c==="h"||c==="high"?70:c==="n"||c==="nominal"?50:c==="l"||c==="low"?25:40;score+=Math.min(15,Math.max(0,(Number(r.observation_count||1)-1)*5));if((r.satellites??[]).length>=2)score+=10;const frp=Number(r.max_frp);if(Number.isFinite(frp)){if(frp>=100)score+=15;else if(frp>=30)score+=10;else if(frp>=10)score+=5}const dur=(new Date(r.last_seen).getTime()-new Date(r.first_seen).getTime())/60000;if(dur>=180)score+=10;else if(dur>=60)score+=5;score=Math.max(0,Math.min(100,Math.round(score)));return{score,level:score>=80?"high":score>=55?"medium":"low"}}
function reliabilityRu(level:string){return level==="high"?"высокая":level==="medium"?"средняя":"низкая"}
function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number){const R=6371,toRad=(x:number)=>x*Math.PI/180,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(a))}
async function reversePlace(lat:number,lon:number):Promise<Place|null>{const u=new URL(NOMINATIM_REVERSE);u.searchParams.set("format","jsonv2");u.searchParams.set("lat",String(lat));u.searchParams.set("lon",String(lon));u.searchParams.set("zoom","13");u.searchParams.set("addressdetails","1");u.searchParams.set("layer","address");u.searchParams.set("accept-language","ru");const res=await fetch(u,{headers:{"user-agent":"NASA-FIRMS-UA/1.0 (Telegram monitoring channel; contact via @NASA_FIRMS)","accept-language":"ru"},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error(`Nominatim HTTP ${res.status}`);const d=await res.json(),a=d?.address??{},name=a.city||a.town||a.village||a.hamlet||a.municipality||a.suburb||d?.name;if(!name)return null;const plat=Number(d?.lat),plon=Number(d?.lon),distance=Number.isFinite(plat)&&Number.isFinite(plon)?haversineKm(lat,lon,plat,plon):null;return{name:String(name),type:String(d?.type??d?.addresstype??"")||null,distance_km:distance}}
async function geoNamesPlace(lat:number,lon:number):Promise<Place|null>{
  const username=String(Deno.env.get("GEONAMES_USERNAME")??"").trim();
  if(!username)return null;
  const u=new URL("https://secure.geonames.org/findNearbyPlaceNameJSON");
  u.searchParams.set("lat",String(lat));u.searchParams.set("lng",String(lon));
  u.searchParams.set("radius","15");u.searchParams.set("maxRows","1");
  u.searchParams.set("lang","ru");u.searchParams.set("style","FULL");u.searchParams.set("localCountry","true");
  u.searchParams.set("username",username);
  const res=await fetch(u.toString(),{headers:{"user-agent":"NASA-FIRMS-UA/1.1"},signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw new Error(`GeoNames HTTP ${res.status}`);
  const d=await res.json();if(d?.status?.message)throw new Error("GeoNames: "+String(d.status.message));
  const x=Array.isArray(d?.geonames)?d.geonames[0]:null;if(!x)return null;
  const name=String(x.name??x.toponymName??"").trim();if(!name)return null;
  const distance=Number(x.distance);
  return{name,type:String(x.fcodeName??x.fcode??"")||null,distance_km:Number.isFinite(distance)?distance:null};
}
async function weatherAt(lat:number,lon:number,iso:string):Promise<Weather|null>{const u=new URL(OPEN_METEO);u.searchParams.set("latitude",String(lat));u.searchParams.set("longitude",String(lon));u.searchParams.set("hourly","temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m");u.searchParams.set("past_days","2");u.searchParams.set("forecast_days","1");u.searchParams.set("timezone","UTC");u.searchParams.set("wind_speed_unit","ms");const res=await fetch(u,{headers:{"user-agent":"firewatch-ua/4.0"},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error(`Open-Meteo HTTP ${res.status}`);const d=await res.json(),h=d?.hourly,times:Array<string>=h?.time??[];if(!times.length)return null;const target=new Date(iso).getTime();let idx=0,best=Infinity;for(let i=0;i<times.length;i++){const ms=new Date(`${times[i]}Z`).getTime(),diff=Math.abs(ms-target);if(diff<best){best=diff;idx=i}}const n=(arr:unknown[])=>{const v=Number(arr?.[idx]);return Number.isFinite(v)?v:null};return{observed_at:`${times[idx]}:00Z`,temperature_c:n(h.temperature_2m),relative_humidity_pct:n(h.relative_humidity_2m),precipitation_mm:n(h.precipitation),wind_speed_ms:n(h.wind_speed_10m),wind_gust_ms:n(h.wind_gusts_10m),wind_direction_deg:n(h.wind_direction_10m)}}
function classifyOsmTags(tags:Record<string,string>){if(tags.amenity==="waste_disposal"||tags.landuse==="landfill")return"waste";if(tags.landuse==="industrial"||tags.man_made==="works"||tags.industrial)return"industrial";if(["plant","generator","substation"].includes(tags.power))return"power";if(tags.natural==="wood"||tags.landuse==="forest")return"forest";if(["farmland","meadow","orchard","vineyard","greenhouse_horticulture"].includes(tags.landuse))return"agriculture";if(["residential","commercial","retail"].includes(tags.landuse))return"urban";if(tags.railway||tags.aeroway)return"transport";return null}
function osmFeatureName(category:string,tags:Record<string,string>){const raw=tags["name:ru"]||tags.name||tags.operator||tags.brand||OSM_LABEL[category]||category;return String(raw).slice(0,80)}
async function osmContextAt(lat:number,lon:number):Promise<OsmContext>{const q=`[out:json][timeout:12];(nwr(around:${OSM_RADIUS_M},${lat},${lon})["landuse"~"^(industrial|forest|farmland|meadow|orchard|vineyard|greenhouse_horticulture|residential|commercial|retail|landfill)$"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["natural"="wood"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["power"~"^(plant|generator|substation)$"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["man_made"="works"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["amenity"="waste_disposal"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["railway"];nwr(around:${OSM_RADIUS_M},${lat},${lon})["aeroway"];);out center tags;`;const res=await fetch(OVERPASS_API,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8","user-agent":"NASA-FIRMS-UA/1.0 (public OSM context; @NASA_FIRMS)"},body:new URLSearchParams({data:q}),signal:AbortSignal.timeout(18000)});if(!res.ok)throw new Error(`Overpass HTTP ${res.status}`);const d=await res.json(),features:OsmFeature[]=[];for(const e of d?.elements??[]){const tags=(e.tags??{}) as Record<string,string>,category=classifyOsmTags(tags);if(!category)continue;const elat=Number(e.lat??e.center?.lat),elon=Number(e.lon??e.center?.lon);if(!Number.isFinite(elat)||!Number.isFinite(elon))continue;const distance_m=Math.round(haversineKm(lat,lon,elat,elon)*1000);features.push({category,label:OSM_LABEL[category]??category,name:osmFeatureName(category,tags),distance_m,osm_type:String(e.type??""),osm_id:Number(e.id??0)})}features.sort((a,b)=>a.distance_m-b.distance_m);const bases:Record<string,number>={waste:100,industrial:95,power:90,forest:85,urban:80,agriculture:75,transport:55},scores:Record<string,number>={};for(const f of features){const proximity=Math.max(0,1-Math.min(f.distance_m,OSM_RADIUS_M)/OSM_RADIUS_M),s=(bases[f.category]??50)*(.55+.45*proximity);scores[f.category]=Math.max(scores[f.category]??0,s)+(scores[f.category]?2:0)}const winner=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];const type=winner?OSM_LABEL[winner[0]]??winner[0]:"не определён",score=winner?Math.max(0,Math.min(100,Math.round(winner[1]))):0,nearest=features[0]??null;return{type,score,nearest_feature:nearest?nearest.name:null,nearest_feature_distance_m:nearest?nearest.distance_m:null,features:features.slice(0,5)}}
function osmCacheFresh(r:Rollup){if(!r.osm_context_updated_at||r.osm_context_latitude==null||r.osm_context_longitude==null)return false;const moved=haversineKm(Number(r.osm_context_latitude),Number(r.osm_context_longitude),Number(r.last_latitude),Number(r.last_longitude))*1000,age=Date.now()-new Date(r.osm_context_updated_at).getTime();return moved<OSM_REQUERY_MOVE_M&&age<OSM_CACHE_DAYS*86400000}
function osmText(r:Rollup){if(!r.osm_context_type)return null;let s=`Контекст OSM: ${r.osm_context_type}`;if(r.osm_context_score!=null)s+=` (${Math.round(Number(r.osm_context_score))}/100)`;return s}
function osmNearbyText(r:Rollup){const fs=(r.osm_features??[]).slice(0,2);if(!fs.length)return null;return`Рядом: ${fs.map(f=>`${f.name} — ${f.distance_m<1000?`${Math.round(f.distance_m)} м`:`${(f.distance_m/1000).toFixed(1)} км`}`).join("; ")}`.slice(0,180)}
function weatherText(r:Rollup){if(r.weather_temperature_c==null&&r.weather_wind_speed_ms==null)return null;const parts:string[]=[];if(r.weather_temperature_c!=null)parts.push(`${Number(r.weather_temperature_c).toFixed(1)} °C`);if(r.weather_relative_humidity_pct!=null)parts.push(`влажность ${Math.round(Number(r.weather_relative_humidity_pct))}%`);if(r.weather_wind_speed_ms!=null){let s=`ветер ${Number(r.weather_wind_speed_ms).toFixed(1)} м/с`;if(r.weather_wind_direction_deg!=null)s+=` (${Math.round(Number(r.weather_wind_direction_deg))}°)`;parts.push(s)}if(r.weather_wind_gust_ms!=null)parts.push(`порывы ${Number(r.weather_wind_gust_ms).toFixed(1)} м/с`);if(r.weather_precipitation_mm!=null)parts.push(`осадки ${Number(r.weather_precipitation_mm).toFixed(1)} мм`);return parts.join(" • ")}
function atmosphereText(r:Rollup){const parts:string[]=[];if(r.atmosphere_signal_level&&r.atmosphere_signal_level!=="insufficient")parts.push("сигнал "+r.atmosphere_signal_level);if(r.s5p_aer_ai_340_380!=null)parts.push("S5P AI "+Number(r.s5p_aer_ai_340_380).toFixed(2));if(r.s5p_co_mol_m2!=null)parts.push("S5P CO "+Number(r.s5p_co_mol_m2).toFixed(3)+" mol/m²");if(r.cams_aerosol_optical_depth!=null)parts.push("CAMS AOD "+Number(r.cams_aerosol_optical_depth).toFixed(2));if(r.cams_pm2_5_ug_m3!=null)parts.push("PM2.5 "+Number(r.cams_pm2_5_ug_m3).toFixed(1)+" мкг/м³");return parts.length?"Атмосфера: "+parts.join(" • "):null}
function intelligenceText(r:Rollup){const p=r.plume_forecast?.hours??[];const p3=Array.isArray(p)?p.find((x:any)=>Number(x.hour)===3):null;const parts:string[]=[];if(r.frp_trend==="rising")parts.push(`FRP ↑${r.frp_change_pct!=null?" "+Number(r.frp_change_pct).toFixed(0)+"%":""}`);else if(r.frp_trend==="falling")parts.push(`FRP ↓${r.frp_change_pct!=null?" "+Math.abs(Number(r.frp_change_pct)).toFixed(0)+"%":""}`);else if(r.frp_trend==="stable")parts.push("FRP стабильно");if(p3?.distance_km!=null)parts.push(`перенос 3ч ~${Number(p3.distance_km).toFixed(0)} км / ${Number(p3.transport_bearing_deg??r.plume_direction_deg??0).toFixed(0)}°`);if(r.plume_reference_place)parts.push(`ориентир: ${r.plume_reference_place}`);return parts.length?"Динамика: "+parts.join(" • "):null}
function fmtApproxInt(v:any){const n=Number(v);return Number.isFinite(n)?Math.round(n).toLocaleString("ru-RU"):null}
function publicEnrichmentLines(r:Rollup){
  const c=(r as any).public_context??{},out:string[]=[];
  const gh=c.ghsl;
  if(gh&&Number.isFinite(Number(gh.population_5km))){
    const pop=fmtApproxInt(gh.population_5km),built=Number(gh.built_fraction_5km_pct);
    let line=`Экспозиция GHSL: ~${pop} чел. в 5 км`;
    if(Number.isFinite(built))line+=` • застройка ~${built.toFixed(2)}%`;
    out.push(line);
  }
  const inf=c.infrastructure?.nearest;
  if(inf&&Number.isFinite(Number(inf.distance_m))){
    const d=Number(inf.distance_m),dist=d<1000?`${Math.round(d)} м`:`${(d/1000).toFixed(1)} км`;
    const label=String(inf.infra_label??inf.infra_type??"объект");
    const name=String(inf.name??"").trim();
    out.push(`Инфраструктура: ${label}${name&&name!==label?": "+name:""} • ${dist}`.slice(0,180));
  }
  const po=c.public_osint??{},tg=Number(po.telegram_count??0),news=Number(po.news_count??0),alerts=Number(po.air_alert_count??0);
  if(tg+news+alerts>0){
    let line=`Public OSINT: TG ${tg} • новости ${news} • тревога ${alerts}`;
    const b=po.best_match;
    if(b?.source)line+=` • ${b.scope==="local"?"локально":b.scope==="regional"?"регионально":"контекст"}: ${String(b.source).slice(0,32)}`;
    out.push(line.slice(0,190));
  }
  const air=c.air_threat;
  if(air&&Number.isFinite(Number(air.nearest_distance_m))){
    const d=Number(air.nearest_distance_m),dist=d<1000?`${Math.round(d)} м`:`${(d/1000).toFixed(1)} км`;
    const off=Number(air.time_offset_seconds??0),mins=Math.round(Math.abs(off)/60);
    const rel=off===0?"одновременно":off<0?`${mins} мин до FIRMS`:`${mins} мин после FIRMS`;
    let line=`Neptun: ${String(air.label??air.type??"air threat")} • ${dist} • ${rel}`;
    if(Number.isFinite(Number(air.heading_deg)))line+=` • курс ${Math.round(Number(air.heading_deg))}°`;
    if(Number.isFinite(Number(air.confidence_0_100)))line+=` • conf ${Math.round(Number(air.confidence_0_100))}/100`;
    out.push(line.slice(0,190));
  }
  const sf=c.surface;
  if(sf?.status==="ready"){
    let line="Sentinel-2: изменение поверхности подтверждено парой до/после";
    if(Number.isFinite(Number(sf.dnbr)))line+=` • dNBR ${Number(sf.dnbr).toFixed(3)}`;
    out.push(line);
  }
  return out;
}
function caption(r:Rollup,lifecycle:string,eventId:string){const sats=(r.satellites??[]).map(normalizeSatellite).filter(Boolean),latest=Number.isFinite(Number(r.latest_frp))?`${Number(r.latest_frp).toFixed(1)} МВт`:"не указана",max=Number.isFinite(Number(r.max_frp))?`${Number(r.max_frp).toFixed(1)} МВт`:"не указана",lat=Number(r.best_latitude??r.last_latitude).toFixed(5),lon=Number(r.best_longitude??r.last_longitude).toFixed(5),score=r.reliability_score==null?reliability(r):{score:Number(r.reliability_score),level:r.reliability_level??"low"};const atm=atmosphereText(r),intel=intelligenceText(r),extra=publicEnrichmentLines(r),geoPlace=(r as any).public_context?.geolocation?.nearest_place??null,placeName=r.nearest_place_name??geoPlace?.name??null,placeDistance=r.nearest_place_distance_km??geoPlace?.distance_km??null,place=placeName?`${placeName}${placeDistance!=null?` (~${Number(placeDistance).toFixed(1)} км)`:""}`:null,w=weatherText(r),hasDeep=extra.some(x=>x.startsWith("Инфраструктура:")),osm=hasDeep?null:osmText(r),near=hasDeep?null:osmNearbyText(r);return["🔥 Тепловая аномалия FIRMS",`Статус: ${statusRu(lifecycle)}`,`Область: ${regionRu(r)}`,`Координаты: ${lat}, ${lon}`,`Первое обнаружение: ${fmtDate(r.first_seen)} ${fmtTime(r.first_seen)} UTC`,`Последнее обнаружение: ${fmtDate(r.last_seen)} ${fmtTime(r.last_seen)} UTC`,`Наблюдений: ${r.observation_count} • Спутники: ${sats.length?sats.join(", "):"не указаны"}`,`FRP: ${latest} • максимум ${max}`,`Достоверность FIRMS: ${confidenceRu(r.latest_confidence)}`,r.event_confidence_label?`Мультисенсорная оценка: ${r.event_confidence_label}`:null,r.multisource_count?`Источники (${r.multisource_count} платформ): ${(r.multisource_sources??[]).slice(0,4).join(", ")}${(r.multisource_sources?.length??0)>4?", …":""}`:null,r.best_location_source?`Лучшая позиция: ${r.best_location_source}${r.best_location_resolution_m?` • ~${r.best_location_resolution_m} м`:""}`:null,`Оценка события: ${reliabilityRu(score.level)} (${score.score}/100)`,place?`Ближайший населённый пункт: ${place}`:null,...extra,osm,near,atm,intel,w?`Погода: ${w}`:null,`Длительность: ${durationText(r.first_seen,r.last_seen)}`,"",`ID события: ${String(eventId).slice(0,8)}`].filter(Boolean).join("\n")}
const CAPTION_FOOTER_PREFIX="ID события: ";
function compactCaption(text:string){
 const rawLength=text.length;
 if(rawLength<=TELEGRAM_CAPTION_LIMIT)return{text,rawLength,finalLength:rawLength,compacted:false};
 let lines=text.split("\n").filter(x=>!x.startsWith("Картографический контекст:")&&!x.includes("не является автоматическим подтверждением")&&!x.includes("не автоматическое подтверждение"));
 const footer=lines.find(x=>x.startsWith(CAPTION_FOOTER_PREFIX))??"";
 lines=lines.filter(x=>!x.startsWith(CAPTION_FOOTER_PREFIX));
 for(const prefix of ["Источники (","Лучшая позиция:","Достоверность FIRMS:","Длительность:","Контекст OSM:","Рядом:","Погода:","Public OSINT:","Sentinel-2:","Neptun:"]){if((lines.join("\n")+"\n"+footer).length<=930)break;lines=lines.filter(x=>!x.startsWith(prefix))}
 let out=lines.join("\n").trimEnd(),budget=TELEGRAM_CAPTION_LIMIT-(footer?footer.length+1:0);
 if(out.length>budget){out=out.slice(0,budget);const cut=out.lastIndexOf("\n");if(cut>Math.max(0,budget-220))out=out.slice(0,cut);out=out.trimEnd()}
 if(footer)out+="\n"+footer;
 if(out.length>TELEGRAM_CAPTION_LIMIT)throw new Error(`caption compaction invariant failed: ${out.length}`);
 return{text:out,rawLength,finalLength:out.length,compacted:true};
}
function captionRegressionCheck(){const probe=["🔥 Тепловая аномалия FIRMS","Статус: 🔥 АКТИВЕН","Динамика: "+("очень-длинное-поле ".repeat(90)),"Картографический контекст: старый текст","Тепловая аномалия FIRMS не является автоматическим подтверждением пожара.","ID события: 0290774e"].join("\n"),r=compactCaption(probe);if(r.finalLength>TELEGRAM_CAPTION_LIMIT||!r.text.includes("ID события: 0290774e")||r.text.includes("Картографический контекст:")||r.text.includes("автоматическим подтверждением"))throw new Error(`caption regression failed: ${r.finalLength}`);return{ok:true,raw_length:r.rawLength,final_length:r.finalLength,limit:TELEGRAM_CAPTION_LIMIT}}
async function tgJson(token:string,method:string,body:unknown){
  for(let attempt=0;attempt<2;attempt++){
    const res=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await res.json();
    if(res.ok&&data?.ok)return data.result;
    if(String(data?.description??"").includes("message is not modified"))return {noop:true};
    const retry=Number(data?.parameters?.retry_after??0);
    if((res.status===429||String(data?.description??"").includes("Too Many Requests"))&&retry>0&&retry<=30&&attempt===0){
      await new Promise(r=>setTimeout(r,(retry+1)*1000));
      continue;
    }
    throw new Error(`Telegram ${method}: ${data?.description??res.status}`);
  }
  throw new Error(`Telegram ${method}: retry exhausted`);
}
async function sendPhoto(token:string,chat:string,photo:Blob,text:string){const f=new FormData();f.set("chat_id",chat);f.set("caption",text);f.set("photo",photo,photo.type==="image/jpeg"?"firms-context.jpg":"firms-context.png");f.set("show_caption_above_media","true");const res=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:"POST",body:f,signal:AbortSignal.timeout(30000)}),d=await res.json();if(!res.ok||!d?.ok)throw new Error(`Telegram sendPhoto: ${d?.description??res.status}`);return d.result.message_id as number}
async function editMedia(token:string,chat:string,id:number,photo:Blob,text:string){const f=new FormData();f.set("chat_id",chat);f.set("message_id",String(id));f.set("media",JSON.stringify({type:"photo",media:"attach://photo",caption:text}));f.set("photo",photo,photo.type==="image/jpeg"?"firms-context.jpg":"firms-context.png");const res=await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`,{method:"POST",body:f,signal:AbortSignal.timeout(30000)}),d=await res.json();if(!res.ok||!d?.ok)throw new Error(`Telegram editMessageMedia: ${d?.description??res.status}`)}
async function mediaWorker(secret:string,action:"send"|"edit",lat:number,lon:number,caption:string,messageId?:number,plumeDirection?:number|null){const base=Deno.env.get("SUPABASE_URL");if(!base)throw new Error("SUPABASE_URL missing");const r=await fetch(base+"/functions/v1/firewatch-media",{method:"POST",headers:{"content-type":"application/json","x-cron-secret":secret},body:JSON.stringify({action,lat,lon,caption,message_id:messageId??null,plume_direction_deg:plumeDirection??null}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(!r.ok||!j?.ok)throw new Error("firewatch-media: "+String(j?.error??r.status));return j}
function distanceM(lat1:number,lon1:number,lat2:number,lon2:number){const p=Math.PI/180,r=6371000,a=Math.sin((lat2-lat1)*p/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(a)))}
async function syncEvent(supabase:any,token:string,chat:string,eventId:string,reason:string,secret:string){let {data:r,error}=await supabase.rpc("fire_event_rollup",{p_event_id:eventId});if(error||!r)throw error??new Error("Не удалось получить данные события");let {data:ms}=await supabase.rpc("fire_event_multisource",{p_event_id:eventId});let {data:atm}=await supabase.rpc("fire_event_atmosphere",{p_event_id:eventId});let {data:intel}=await supabase.rpc("fire_event_intelligence",{p_event_id:eventId});let roll={...(r as Rollup),...(ms??{}),...(atm??{}),...(intel??{})} as Rollup;const score=reliability(roll),contextPatch:any={reliability_score:score.score,reliability_level:score.level,enrichment_updated_at:new Date().toISOString()};const contextWarnings:string[]=[];try{
  if(!roll.nearest_place_name){
    const plat=Number(roll.best_latitude??roll.last_latitude),plon=Number(roll.best_longitude??roll.last_longitude);
    let place:Place|null=null;
    try{place=await reversePlace(plat,plon)}
    catch(e){contextWarnings.push(`Nominatim: ${e instanceof Error?e.message:String(e)}`)}
    if(!place){
      try{place=await geoNamesPlace(plat,plon)}
      catch(e){contextWarnings.push(`GeoNames fallback: ${e instanceof Error?e.message:String(e)}`)}
    }
    if(place){
      contextPatch.nearest_place_name=place.name;
      contextPatch.nearest_place_type=place.type;
      contextPatch.nearest_place_distance_km=place.distance_km==null?null:Number(place.distance_km.toFixed(2));
    }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
}catch(e){contextWarnings.push(`Place enrichment: ${e instanceof Error?e.message:String(e)}`)}try{const w=await weatherAt(Number(roll.best_latitude??roll.last_latitude),Number(roll.best_longitude??roll.last_longitude),roll.last_seen);if(w){contextPatch.weather_observed_at=w.observed_at;contextPatch.weather_temperature_c=w.temperature_c;contextPatch.weather_relative_humidity_pct=w.relative_humidity_pct;contextPatch.weather_precipitation_mm=w.precipitation_mm;contextPatch.weather_wind_speed_ms=w.wind_speed_ms;contextPatch.weather_wind_gust_ms=w.wind_gust_ms;contextPatch.weather_wind_direction_deg=w.wind_direction_deg}}catch(e){contextWarnings.push(`Open-Meteo: ${e instanceof Error?e.message:String(e)}`)}try{if(OSM_ENRICHMENT_ENABLED&&!osmCacheFresh(roll)){const osm=await osmContextAt(Number(roll.best_latitude??roll.last_latitude),Number(roll.best_longitude??roll.last_longitude));contextPatch.osm_context_type=osm.type;contextPatch.osm_context_score=osm.score;contextPatch.osm_nearest_feature=osm.nearest_feature;contextPatch.osm_nearest_feature_distance_m=osm.nearest_feature_distance_m;contextPatch.osm_features=osm.features;contextPatch.osm_context_latitude=roll.last_latitude;contextPatch.osm_context_longitude=roll.last_longitude;contextPatch.osm_context_updated_at=new Date().toISOString()}}catch(e){contextWarnings.push(`Overpass: ${e instanceof Error?e.message:String(e)}`)}const {error:ctxErr}=await supabase.from("fire_events").update(contextPatch).eq("id",eventId);if(ctxErr)throw ctxErr;({data:r,error}=await supabase.rpc("fire_event_rollup",{p_event_id:eventId}));if(error||!r)throw error??new Error("Не удалось обновить данные события");({data:ms}=await supabase.rpc("fire_event_multisource",{p_event_id:eventId}));({data:atm}=await supabase.rpc("fire_event_atmosphere",{p_event_id:eventId}));({data:intel}=await supabase.rpc("fire_event_intelligence",{p_event_id:eventId}));roll={...(r as Rollup),...(ms??{}),...(atm??{}),...(intel??{})} as Rollup;try{const {data:pc,error:pce}=await supabase.rpc("firewatch_public_post_context",{p_event:eventId});if(pce)throw pce;(roll as any).public_context=pc??{}}catch(e){contextWarnings.push(`Public enrichment: ${e instanceof Error?e.message:String(e)}`)}const lifecycle=classify(roll,reason),rawCaption=caption(roll,lifecycle,eventId),captionInfo=compactCaption(rawCaption),text=captionInfo.text;if(captionInfo.finalLength>TELEGRAM_CAPTION_LIMIT)throw new Error(`Telegram caption invariant: ${captionInfo.finalLength}`);let kind=roll.telegram_message_kind,messageId=roll.telegram_message_id,warning:string|null=null,action="edited";const lat=Number(roll.best_latitude??roll.last_latitude),lon=Number(roll.best_longitude??roll.last_longitude);const {data:mediaState}=await supabase.from("fire_events").select("telegram_media_latitude,telegram_media_longitude,telegram_media_span_m,telegram_media_updated_at,telegram_media_plume_direction_deg").eq("id",eventId).maybeSingle();let mediaPatch:any={};if(reason==="new"&&!roll.telegram_sent){try{const m=await mediaWorker(secret,"send",lat,lon,text,undefined,roll.plume_direction_deg??null);messageId=Number(m.message_id);kind="photo";mediaPatch={telegram_media_latitude:lat,telegram_media_longitude:lon,telegram_media_span_m:Number(m.span_m??1000),telegram_media_updated_at:new Date().toISOString(),telegram_media_bytes:Number(m.media_bytes??0),telegram_media_plume_direction_deg:Number.isFinite(Number(roll.plume_direction_deg))?Number(roll.plume_direction_deg):null};await supabase.rpc("firewatch_usage_increment",{p_media_uploads:1,p_media_bytes:Number(m.media_bytes??0),p_caption_only_edits:0})}catch(e){warning=e instanceof Error?e.message:String(e);if(warning.includes("Too Many Requests"))throw e;const m=await tgJson(token,"sendMessage",{chat_id:chat,text,disable_web_page_preview:true});messageId=m.message_id;kind="text"}action="sent"}else{if(!messageId)throw new Error(`У события ${eventId} отсутствует telegram_message_id`);if(kind==="photo"){const oldLat=Number(mediaState?.telegram_media_latitude),oldLon=Number(mediaState?.telegram_media_longitude),oldAt=Date.parse(String(mediaState?.telegram_media_updated_at??""));const moved=Number.isFinite(oldLat)&&Number.isFinite(oldLon)?distanceM(oldLat,oldLon,lat,lon):Infinity;const stale=!Number.isFinite(oldAt)||Date.now()-oldAt>7*86400000;const oldPlume=Number(mediaState?.telegram_media_plume_direction_deg),newPlume=Number(roll.plume_direction_deg),plumeChanged=Number.isFinite(newPlume)&&(!Number.isFinite(oldPlume)||Math.abs(((newPlume-oldPlume+540)%360)-180)>=25);const refreshMedia=moved>=150||stale||plumeChanged;if(refreshMedia){try{const m=await mediaWorker(secret,"edit",lat,lon,text,messageId,roll.plume_direction_deg??null);mediaPatch={telegram_media_latitude:lat,telegram_media_longitude:lon,telegram_media_span_m:Number(m.span_m??1000),telegram_media_updated_at:new Date().toISOString(),telegram_media_bytes:Number(m.media_bytes??0),telegram_media_plume_direction_deg:Number.isFinite(Number(roll.plume_direction_deg))?Number(roll.plume_direction_deg):null};await supabase.rpc("firewatch_usage_increment",{p_media_uploads:1,p_media_bytes:Number(m.media_bytes??0),p_caption_only_edits:0})}catch(e){warning=e instanceof Error?e.message:String(e);if(warning.includes("Too Many Requests"))throw e;await tgJson(token,"editMessageCaption",{chat_id:chat,message_id:messageId,caption:text});await supabase.rpc("firewatch_usage_increment",{p_media_uploads:0,p_media_bytes:0,p_caption_only_edits:1})}}else{await tgJson(token,"editMessageCaption",{chat_id:chat,message_id:messageId,caption:text});await supabase.rpc("firewatch_usage_increment",{p_media_uploads:0,p_media_bytes:0,p_caption_only_edits:1})}}else await tgJson(token,"editMessageText",{chat_id:chat,message_id:messageId,text,disable_web_page_preview:true})}const patch:any={...mediaPatch,lifecycle_status:lifecycle,telegram_last_observation_count:roll.observation_count,telegram_last_seen_snapshot:roll.last_seen,telegram_last_frp:roll.latest_frp,telegram_last_status:lifecycle,telegram_last_update_at:new Date().toISOString()};if(action==="sent"){patch.telegram_sent=true;patch.telegram_sent_at=new Date().toISOString();patch.telegram_message_id=messageId;patch.telegram_message_kind=kind}if(lifecycle==="closed")patch.status="closed";const {error:upErr}=await supabase.from("fire_events").update(patch).eq("id",eventId);if(upErr)throw upErr;return{action,kind,lifecycle,message_id:messageId,snapshot_warning:warning,context_warnings:contextWarnings,reliability_score:roll.reliability_score,nearest_place:roll.nearest_place_name,osm_context:roll.osm_context_type,weather_observed_at:roll.weather_observed_at,caption_raw_length:captionInfo.rawLength,caption_final_length:captionInfo.finalLength,caption_compacted:captionInfo.compacted}}

type TelegramRunStats={
  sent:number;edited:number;closed:number;photo:number;text:number;
  errors:string[];warnings:string[];
  caption_raw_max:number;caption_final_max:number;
  caption_compacted_count:number;caption_limit_violations:number;
  caption_regression:any;queue_before:number;queue_after:number;
};

async function processTelegramQueue(supabase:any,token:string,chat:string,secret:string,bootstrapDone:boolean):Promise<TelegramRunStats>{
  let sent=0,edited=0,closed=0,photo=0,text=0,captionRawMax=0,captionFinalMax=0,captionCompacted=0,captionLimitViolations=0;
  const captionRegression=captionRegressionCheck(),errors:string[]=[],warnings:string[]=[];
  if(!bootstrapDone){
    return{sent,edited,closed,photo,text,errors,warnings,caption_raw_max:0,caption_final_max:0,caption_compacted_count:0,caption_limit_violations:0,caption_regression:captionRegression,queue_before:0,queue_after:0};
  }

  const holder=crypto.randomUUID();
  const {data:lease,error:leaseError}=await supabase.rpc("firewatch_acquire_telegram_lease",{p_holder:holder,p_ttl_seconds:180});
  if(leaseError)throw leaseError;
  if(lease!==true){
    const {data:q}=await supabase.rpc("fire_events_requiring_telegram_sync",{p_limit:100});
    const n=(q??[]).length;
    warnings.push("Telegram delivery skipped: another worker holds the delivery lease.");
    return{sent,edited,closed,photo,text,errors,warnings,caption_raw_max:0,caption_final_max:0,caption_compacted_count:0,caption_limit_violations:0,caption_regression:captionRegression,queue_before:n,queue_after:n};
  }

  try{
    const {data:queue,error:qErr}=await supabase.rpc("fire_events_requiring_telegram_sync",{p_limit:100});
    if(qErr)throw qErr;
    const queueBefore=(queue??[]).length;
    const priority=(queue??[]).sort((a:any,b:any)=>{
      const p=(x:any)=>x.sync_reason==="new"?0:x.sync_reason==="close"?1:2;
      return p(a)-p(b);
    }).slice(0,TELEGRAM_SYNC_LIMIT_PER_RUN);
    let qi=0;
    for(const q of priority){
      try{
        if(qi++>0)await new Promise(r=>setTimeout(r,TELEGRAM_PACE_MS));
        const x=await syncEvent(supabase,token,chat,q.event_id,q.sync_reason,secret);
        if(x.action==="sent")sent++;else edited++;
        if(x.lifecycle==="closed")closed++;
        if(x.kind==="photo")photo++;else text++;
        captionRawMax=Math.max(captionRawMax,Number(x.caption_raw_length??0));
        captionFinalMax=Math.max(captionFinalMax,Number(x.caption_final_length??0));
        if(x.caption_compacted)captionCompacted++;
        if(Number(x.caption_final_length??0)>TELEGRAM_CAPTION_LIMIT)captionLimitViolations++;
        if(x.snapshot_warning)warnings.push(`${q.event_id}: ${x.snapshot_warning}`);
        for(const w of x.context_warnings??[])warnings.push(`${q.event_id}: ${w}`);
      }catch(e){
        errors.push(`${q.event_id}: ${e instanceof Error?e.message:String(e)}`);
      }
    }
    const {data:after}=await supabase.rpc("fire_events_requiring_telegram_sync",{p_limit:100});
    return{
      sent,edited,closed,photo,text,errors,warnings,
      caption_raw_max:captionRawMax,caption_final_max:captionFinalMax,
      caption_compacted_count:captionCompacted,caption_limit_violations:captionLimitViolations,
      caption_regression:captionRegression,queue_before:queueBefore,queue_after:(after??[]).length
    };
  }finally{
    try{await supabase.rpc("firewatch_release_telegram_lease",{p_holder:holder})}catch{}
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"Требуется POST-запрос"},405);
  const mapKey=Deno.env.get("FIRMS_MAP_KEY"),token=Deno.env.get("TELEGRAM_BOT_TOKEN"),chat=Deno.env.get("TELEGRAM_CHAT_ID"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!mapKey||!token||!chat||!url||!key)return json({ok:false,error:"Отсутствует обязательная настройка среды"},500);
  const supabase=createClient(url,key,{auth:{persistSession:false}}),secret=req.headers.get("x-cron-secret")??"";
  const {data:authorized,error:authError}=await supabase.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(authError||authorized!==true)return json({ok:false,error:"Нет доступа"},401);
  const started=new Date();
  let body:any={};try{body=await req.json()}catch{}
  const telegramOnly=body?.mode==="telegram-drain";

  try{
    const {data:bootstrapState,error:stateError}=await supabase.from("system_state").select("value").eq("key","bootstrap").single();
    if(stateError)throw stateError;
    const bootstrapDone=Boolean(bootstrapState?.value?.done);

    if(telegramOnly){
      const tg=await processTelegramQueue(supabase,token,chat,secret,bootstrapDone);
      const state={
        status:tg.errors.length?"degraded":"active",
        last_success_run:new Date().toISOString(),
        queue_before:tg.queue_before,queue_after:tg.queue_after,
        sent:tg.sent,edited:tg.edited,closed:tg.closed,
        errors:tg.errors,warnings:tg.warnings,
        sync_limit_per_run:TELEGRAM_SYNC_LIMIT_PER_RUN,pace_ms:TELEGRAM_PACE_MS
      };
      await supabase.from("system_state").upsert({key:"monitor_telegram_drain",value:state,updated_at:new Date().toISOString()});
      return json({ok:tg.errors.length===0,mode:"telegram-drain",started_at_utc:started.toISOString(),telegram:tg});
    }

    const sourceResults=await Promise.all(SOURCES.map(s=>fetchSource(mapKey,s,started)));
    const records=sourceResults.flatMap(x=>x.records);
    const {data:batch,error:batchError}=await supabase.rpc("ingest_firms_batch",{p_records:records,p_match_radius_m:MATCH_RADIUS_M,p_match_window_hours:MATCH_WINDOW_HOURS});
    if(batchError)throw batchError;
    if(!bootstrapDone){
      const {error:e}=await supabase.rpc("complete_bootstrap");
      if(e)throw e;
    }

    const tg=await processTelegramQueue(supabase,token,chat,secret,bootstrapDone);
    const monitorValue={
      last_success_run:new Date().toISOString(),last_error:tg.errors.length?tg.errors.join(" | "):null,
      fetched_rows:sourceResults.reduce((n,x)=>n+x.fetched,0),recent_rows:records.length,
      source_runs:sourceResults.map((x,i)=>({source:SOURCES[i],fetched_rows:x.fetched,recent_rows:x.records.length})),
      inserted:batch.inserted,duplicates:batch.duplicates,outside_ukraine:batch.outside_ukraine,new_events:batch.new_events,
      telegram_sent:tg.sent,telegram_edited:tg.edited,events_closed:tg.closed,
      telegram_photo_actions:tg.photo,telegram_text_actions:tg.text,snapshot_warnings:tg.warnings,
      caption_raw_max:tg.caption_raw_max,caption_final_max:tg.caption_final_max,
      caption_compacted_count:tg.caption_compacted_count,caption_limit_violations:tg.caption_limit_violations,
      caption_regression:tg.caption_regression,telegram_caption_limit:TELEGRAM_CAPTION_LIMIT,
      telegram_sync_limit_per_run:TELEGRAM_SYNC_LIMIT_PER_RUN,telegram_pace_ms:TELEGRAM_PACE_MS,
      telegram_queue_before:tg.queue_before,telegram_queue_after:tg.queue_after,
      osm_enrichment:"disabled_circuit_breaker",bootstrap_was_done:bootstrapDone,
      enrichment:"score+settlement+weather+osm-cache(read-only)"
    };
    await supabase.from("system_state").upsert({key:"monitor",value:monitorValue,updated_at:new Date().toISOString()});
    return json({
      ok:tg.errors.length===0,mode:bootstrapDone?"monitor":"bootstrap",started_at_utc:started.toISOString(),
      sources:sourceResults.map((x,i)=>({source:SOURCES[i],fetched_rows:x.fetched,recent_rows:x.records.length})),
      batch,telegram:tg
    });
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    try{
      const stateKey=telegramOnly?"monitor_telegram_drain":"monitor";
      await supabase.from("system_state").upsert({key:stateKey,value:{status:"error",last_error:message,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});
    }catch{}
    return json({ok:false,error:message,started_at_utc:started.toISOString()},502);
  }
});
