import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { diceSimilarity as dice, normalizeRegionQuery as norm, resolveOblastRow, validateOblastAliases } from "./region_aliases.ts";

const POSTPASS="https://postpass.geofabrik.de/api/interpreter";
const FUSED="https://www.fused.io/server/v1/realtime-shared/UDF_Overture_Maps_Example/run/tiles";
const OVERTURE_RELEASE="2026-04-15-0";
const CACHE_MS=12*3600_000;
const RAW_LIMIT=7000;
const OUTPUT_LIMIT=5000;

type Spec={key:string,label:string,aliases:string[],osm:string,overture:string[],overtureTypes:string[]};
const SPECS:Spec[]=[
 {key:"fuel",label:"АЗС",aliases:["азс","заправка","заправки","автозаправка","автозаправки","fuel","gas station","gas stations","petrol station","petrol stations"],osm:"(tags->>'amenity'='fuel' OR tags->>'shop'='fuel')",overture:["gas station","gas_station","fuel","petrol station","petrol_station","service station","service_station"],overtureTypes:["place"]},
 {key:"hospital",label:"Больницы и клиники",aliases:["больница","больницы","лікарня","лікарні","hospital","hospitals","clinic","clinics"],osm:"(tags->>'amenity' IN ('hospital','clinic') OR tags->>'healthcare' IN ('hospital','clinic'))",overture:["hospital","clinic","medical center","medical_center"],overtureTypes:["place"]},
 {key:"pharmacy",label:"Аптеки",aliases:["аптека","аптеки","pharmacy","pharmacies"],osm:"(tags->>'amenity'='pharmacy' OR tags->>'healthcare'='pharmacy')",overture:["pharmacy","drugstore"],overtureTypes:["place"]},
 {key:"school",label:"Учебные заведения",aliases:["школа","школы","школи","school","schools","education"],osm:"(tags->>'amenity' IN ('school','university','college','kindergarten') OR tags->>'building' IN ('school','university','college','kindergarten'))",overture:["school","university","college","kindergarten"],overtureTypes:["place"]},
 {key:"fire_station",label:"Пожарные части",aliases:["пожарная часть","пожарные части","пожежна частина","пожежні частини","fire station","fire stations"],osm:"(tags->>'amenity'='fire_station' OR tags->>'emergency'='fire_station')",overture:["fire station","fire_station"],overtureTypes:["place"]},
 {key:"police",label:"Полиция",aliases:["полиция","поліція","police"],osm:"(tags->>'amenity'='police' OR tags->>'office'='police')",overture:["police","police station","police_station"],overtureTypes:["place"]},
 {key:"energy",label:"Энергообъекты",aliases:["энергетика","энергообъекты","енергетика","energy","power"],osm:"(tags ? 'power')",overture:["power","substation","power plant","power_plant","electric"],overtureTypes:["infrastructure","place"]},
 {key:"industrial",label:"Промышленные объекты",aliases:["промышленность","промышленные","промисловість","industrial","factory","factories"],osm:"(tags->>'landuse'='industrial' OR tags->>'man_made'='works' OR tags ? 'industrial' OR tags->>'building' IN ('industrial','factory'))",overture:["industrial","factory","manufacturing","plant"],overtureTypes:["place","infrastructure"]},
 {key:"warehouse",label:"Склады",aliases:["склад","склады","склади","warehouse","warehouses"],osm:"(tags->>'building'='warehouse' OR tags->>'industrial'='warehouse')",overture:["warehouse","distribution center","distribution_center"],overtureTypes:["place"]},
 {key:"supermarket",label:"Супермаркеты",aliases:["супермаркет","супермаркеты","супермаркети","supermarket","supermarkets"],osm:"(tags->>'shop'='supermarket' OR tags->>'building'='supermarket')",overture:["supermarket","grocery"],overtureTypes:["place"]},
 {key:"telecom",label:"Телеком-инфраструктура",aliases:["телеком","вышки связи","вежі зв'язку","telecom","communications tower"],osm:"(tags ? 'telecom' OR tags->>'office'='telecommunication' OR tags->>'tower:type'='communication' OR tags->>'man_made' IN ('mast','communications_tower','antenna'))",overture:["telecom","communication","communications tower","communications_tower"],overtureTypes:["infrastructure","place"]},
 {key:"transport",label:"Транспортные узлы",aliases:["транспорт","transport","станции","станції"],osm:"(tags->>'railway' IN ('station','halt','yard','terminal') OR tags->>'amenity'='bus_station' OR tags->>'aeroway' IN ('aerodrome','terminal') OR tags->>'harbour'='yes' OR tags->>'seamark:type'='harbour')",overture:["station","terminal","airport","harbour","harbor","transport"],overtureTypes:["place","infrastructure"]}
];

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
function specFor(v:any){const q=norm(v);return SPECS.find(s=>s.key===q||s.aliases.some(a=>norm(a)===q))??null}
function hav(a:number,b:number,c:number,d:number){const p=Math.PI/180,R=6371000,da=(c-a)*p,db=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(db/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)))}
function tileXY(lat:number,lon:number,z:number){const n=2**z,x=Math.floor((lon+180)/360*n),lr=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(lr))/Math.PI)/2*n);return{x,y}}
function pointInRing(lon:number,lat:number,ring:any[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=Number(ring[i]?.[0]),yi=Number(ring[i]?.[1]),xj=Number(ring[j]?.[0]),yj=Number(ring[j]?.[1]);if(![xi,yi,xj,yj].every(Number.isFinite))continue;const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-15)+xi);if(hit)inside=!inside}return inside}
function pointInPolygon(lon:number,lat:number,rings:any[]){if(!Array.isArray(rings)||!rings.length||!pointInRing(lon,lat,rings[0]))return false;for(let i=1;i<rings.length;i++)if(pointInRing(lon,lat,rings[i]))return false;return true}
function insideGeom(lat:number,lon:number,g:any){if(g?.type==="Polygon")return pointInPolygon(lon,lat,g.coordinates);if(g?.type==="MultiPolygon")return (g.coordinates??[]).some((p:any)=>pointInPolygon(lon,lat,p));return false}
function geoCenter(f:any){const p=f?.properties??{},b=p?.bbox;if(b&&[b.xmin,b.xmax,b.ymin,b.ymax].every((x:any)=>Number.isFinite(Number(x))))return[(Number(b.ymin)+Number(b.ymax))/2,(Number(b.xmin)+Number(b.xmax))/2];const g=f?.geometry,c=g?.coordinates;if(g?.type==="Point"&&Array.isArray(c))return[Number(c[1]),Number(c[0])];return null}
function sourceUrl(src:string,id:string,qid?:string|null){if(src==="Wikidata"&&qid)return"https://www.wikidata.org/wiki/"+qid;if(src==="OpenStreetMap"){const m=String(id).match(/^([NWR]):(.+)$/);if(m)return"https://www.openstreetmap.org/"+(m[1]==="N"?"node":m[1]==="W"?"way":"relation")+"/"+m[2]}return null}
function addrFromTags(t:any){const city=t?.["addr:city"]??t?.["addr:town"]??t?.["addr:village"]??t?.["addr:place"]??null,street=t?.["addr:street"]??null,house=t?.["addr:housenumber"]??null;return{settlement:city?String(city):null,address:[street,house].filter(Boolean).join(" ")||null}}
function osmName(t:any,s:Spec){return String(t?.["name:uk"]??t?.["name:ru"]??t?.name??t?.brand??t?.operator??s.label).slice(0,220)}
function safeOsm(t:any){const keys=["name","name:uk","name:ru","brand","operator","wikidata","website","opening_hours","phone","addr:city","addr:town","addr:village","addr:place","addr:street","addr:housenumber","amenity","shop","healthcare","building","landuse","industrial","power","man_made","tower:type","telecom","railway","aeroway","harbour","seamark:type"];const o:any={};for(const k of keys)if(t?.[k]!=null)o[k]=String(t[k]).slice(0,240);return o}
function postpassSql(b:number[],s:Spec){const [minLon,minLat,maxLon,maxLat]=b.map(Number);return `
SELECT osm_id,osm_type,tags,ST_PointOnSurface(geom) geom
FROM postpass_pointlinepolygon
WHERE geom && ST_MakeEnvelope(${minLon.toFixed(7)},${minLat.toFixed(7)},${maxLon.toFixed(7)},${maxLat.toFixed(7)},4326)
  AND ${s.osm}
LIMIT ${RAW_LIMIT}`}
async function postpass(sql:string){const r=await fetch(POSTPASS,{method:"POST",headers:{"accept":"application/json","content-type":"application/x-www-form-urlencoded","user-agent":"GeoWatch-RegionalSearch/1.0"},body:new URLSearchParams([["data",sql]]),signal:AbortSignal.timeout(45000)});const t=await r.text();if(!r.ok)throw new Error("Postpass HTTP "+r.status+": "+t.slice(0,220));try{return JSON.parse(t)}catch{throw new Error("Postpass invalid JSON")}}
async function fetchGeo(url:string){const r=await fetch(url,{headers:{"accept":"application/geo+json,application/json","user-agent":"GeoWatch-RegionalSearch/1.0"},signal:AbortSignal.timeout(15000)});const t=await r.text();if(!r.ok)throw new Error("HTTP "+r.status+": "+t.slice(0,160));return JSON.parse(t)}
function overtureText(p:any){return norm([p?.class,p?.basic_category,p?.subtype,JSON.stringify(p?.categories??{}),JSON.stringify(p?.taxonomy??{})].filter(Boolean).join(" "))}
function overtureMatches(p:any,s:Spec){const q=overtureText(p);return s.overture.some(x=>q.includes(norm(x)))}
function overtureName(p:any,s:Spec){const n=p?.names?.primary??p?.name??p?.brand??null;return String(n??s.label).slice(0,220)}
function overtureAddress(p:any){const a=Array.isArray(p?.addresses)?p.addresses[0]:(p?.addresses??p?.address??{}),settlement=a?.locality??a?.city??a?.region??null,address=[a?.freeform,a?.street,a?.number].filter(Boolean).join(" ")||null;return{settlement:settlement?String(settlement):null,address:address?String(address):null}}
async function overtureRegion(_b:number[],_geom:any,_s:Spec){
  // The public Overture UDF returns partition metadata below the type's min zoom
  // (places use min_zoom=12). Region-wide z12 enumeration is intentionally not
  // performed in one request because an oblast can span ~1000+ tiles.
  return{
    status:"not_applicable",
    reason:"region_wide_v1_requires_server_side_bounds_query",
    release:OVERTURE_RELEASE,
    tiles_total:0,
    tiles_ok:0,
    features:[],
    errors:[]
  };
}
async function wikidataByQids(rows:any[]){const ids=[...new Set(rows.map(x=>x.wikidata_qid).filter((x:any)=>/^Q\d+$/.test(String(x))))] as string[];const out:any[]=[];for(let i=0;i<ids.length;i+=50){const part=ids.slice(i,i+50),u=new URL("https://www.wikidata.org/w/api.php");u.searchParams.set("action","wbgetentities");u.searchParams.set("ids",part.join("|"));u.searchParams.set("props","labels|descriptions");u.searchParams.set("languages","uk|ru|en");u.searchParams.set("format","json");u.searchParams.set("origin","*");const r=await fetch(u.toString(),{headers:{"user-agent":"GeoWatch-RegionalSearch/1.0"},signal:AbortSignal.timeout(15000)});const t=await r.text();if(!r.ok)throw new Error("Wikidata HTTP "+r.status);const d=JSON.parse(t);for(const q of part){const e=d?.entities?.[q],seed=rows.find(x=>x.wikidata_qid===q);if(!e||!seed)continue;const label=e?.labels?.uk?.value??e?.labels?.ru?.value??e?.labels?.en?.value??seed.name;out.push({source:"Wikidata",source_id:q,wikidata_qid:q,name:String(label),latitude:seed.latitude,longitude:seed.longitude,brand:seed.brand??null,operator:seed.operator??null,settlement:seed.settlement??null,address:seed.address??null,tags:{description:e?.descriptions?.uk?.value??e?.descriptions?.ru?.value??e?.descriptions?.en?.value??null}})}}return out}
function generic(v:any,s:Spec){const x=norm(v);return !x||new Set([norm(s.label),"fuel","gas station","petrol station","station","industrial","warehouse","school","hospital","pharmacy"]).has(x)}
function resolve(rows:any[],s:Spec){const rank=(x:string)=>x==="OpenStreetMap"?3:x==="Wikidata"?2:1;rows=[...rows].sort((a,b)=>rank(b.source)-rank(a.source));const entities:any[]=[];const qmap=new Map<string,any>();const add=(e:any,r:any,method:string,confidence:number)=>{e.sources.push({source:r.source,source_id:r.source_id,name:r.name,match_method:method,match_confidence:confidence,url:sourceUrl(r.source,r.source_id,r.wikidata_qid),wikidata_qid:r.wikidata_qid??null});if(!e.wikidata_qid&&r.wikidata_qid){e.wikidata_qid=r.wikidata_qid;qmap.set(r.wikidata_qid,e)}if(!e.address&&r.address)e.address=r.address;if(!e.settlement&&r.settlement)e.settlement=r.settlement;if(!e.brand&&r.brand)e.brand=r.brand;if(!e.operator&&r.operator)e.operator=r.operator;e.resolution_status=e.sources.length>1?(method==="exact_wikidata_qid"?"auto_exact":"auto_probable"):"single_source";e.resolution_confidence=Math.min(e.resolution_confidence,confidence)};for(const r of rows){if(r.wikidata_qid&&qmap.has(r.wikidata_qid)){add(qmap.get(r.wikidata_qid),r,"exact_wikidata_qid",100);continue}let best:any=null;for(const e of entities){if(e.sources.some((x:any)=>x.source===r.source))continue;const d=hav(e.latitude,e.longitude,r.latitude,r.longitude),sim=generic(e.canonical_name,s)||generic(r.name,s)?0:dice(e.canonical_name,r.name);let conf=Math.round(sim*78+Math.max(0,1-d/60)*22);if((sim>=.86&&d<=45)||(sim>=.72&&d<=20))conf=Math.max(conf,87);if(conf>=86&&(!best||conf>best.conf))best={e,conf}}if(best){add(best.e,r,"name_distance",best.conf);continue}const e={canonical_name:r.name,latitude:r.latitude,longitude:r.longitude,wikidata_qid:r.wikidata_qid??null,brand:r.brand??null,operator:r.operator??null,settlement:r.settlement??null,address:r.address??null,resolution_status:"single_source",resolution_confidence:100,sources:[] as any[]};entities.push(e);if(e.wikidata_qid)qmap.set(e.wikidata_qid,e);add(e,r,"single_source",100)}for(const e of entities){const osm=e.sources.find((x:any)=>x.source==="OpenStreetMap"),ot=e.sources.find((x:any)=>x.source==="Overture"),wd=e.sources.find((x:any)=>x.source==="Wikidata");e.canonical_name=osm?.name??ot?.name??wd?.name??e.canonical_name;e.source_count=new Set(e.sources.map((x:any)=>x.source)).size}return entities}
function csvCell(v:any){const s=String(v??"");return /[",\n\r;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function toCsv(objects:any[]){const head=["No","Name","Brand","Operator","Settlement","Address","Latitude","Longitude","Sources","Source count","Resolution status","Confidence","Wikidata QID"];const rows=objects.map((x,i)=>[i+1,x.canonical_name,x.brand,x.operator,x.settlement,x.address,Number(x.latitude).toFixed(6),Number(x.longitude).toFixed(6),x.sources.map((s:any)=>s.source+":"+s.source_id).join(" | "),x.source_count,x.resolution_status,x.resolution_confidence,x.wikidata_qid]);return[head,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n")}
async function oblastRows(sb:any){const {data,error}=await sb.from("oblasts").select("id,code,name_uk,name_en");if(error)throw error;return data??[]}
async function resolveOblast(sb:any,q:any){const rows=await oblastRows(sb),best=resolveOblastRow(rows,q);if(!best)return null;const {data:g,error:ge}=await sb.rpc("firewatch_oblast_geometry",{p_oblast_id:best.id});if(ge)throw ge;return{...best,...g}}

Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!base||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(base,key,{auth:{persistSession:false}}),bearer=req.headers.get("authorization")??"",cron=req.headers.get("x-cron-secret")??"";
  let authorized=bearer==="Bearer "+key;if(!authorized&&cron){const {data}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cron});authorized=data===true}if(!authorized)return json({ok:false,error:"unauthorized"},401);
  const body:any=await req.json().catch(()=>({}));
  if(body.self_test==="oblast_aliases"){const report=validateOblastAliases(await oblastRows(sb)),now=new Date().toISOString(),monitor={status:report.ok?"active":"error",last_check:now,...report};const {error:me}=await sb.from("system_state").upsert({key:"monitor_regional_aliases",value:monitor,updated_at:now});if(me)throw me;return json({self_test:"oblast_aliases",...report},report.ok?200:500)}
  const spec=specFor(body.category);
  if(!spec)return json({ok:false,error:"unsupported category",supported:SPECS.map(x=>({key:x.key,label:x.label}))},400);
  const oblast=await resolveOblast(sb,body.oblast);if(!oblast)return json({ok:false,error:"oblast not found"},404);
  const queryKey=String(oblast.code)+":"+spec.key;
  const {data:cached,error:ce}=await sb.from("regional_object_search_cache").select("*").eq("query_key",queryKey).maybeSingle();if(ce)throw ce;
  const age=Date.now()-Date.parse(String(cached?.queried_at??""));
  if(cached&&!body.refresh&&Number.isFinite(age)&&age<CACHE_MS){
    if(String(body.format??"").toLowerCase()==="csv")return new Response("\uFEFF"+toCsv(cached.objects??[]),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.csv"'}});
    return json({ok:true,cached:true,...cached,category_label:spec.label,oblast:{id:oblast.id,code:oblast.code,name_uk:oblast.name_uk,name_en:oblast.name_en,bbox:oblast.bbox,center:oblast.center}});
  }
  const errors:string[]=[];let osmStatus="active",overture:any={status:"not_checked",features:[],tiles_total:0,tiles_ok:0},wd:any[]=[];
  const bbox=(oblast.bbox??[]).map(Number),geom=oblast.geometry;if(bbox.length!==4||!geom)throw new Error("oblast geometry unavailable");
  const osmRows:any[]=[];
  try{const d=await postpass(postpassSql(bbox,spec));const raw=Array.isArray(d?.features)?d.features:[];if(raw.length>=RAW_LIMIT)errors.push("OSM candidate limit reached; result may be truncated");for(const f of raw){const p=f?.properties??{},t=p.tags??{},ctr=geoCenter(f);if(!ctr||!Number.isFinite(ctr[0])||!Number.isFinite(ctr[1])||!insideGeom(ctr[0],ctr[1],geom))continue;const ad=addrFromTags(t),qid=/^Q\d+$/.test(String(t?.wikidata??""))?String(t.wikidata):null;osmRows.push({source:"OpenStreetMap",source_id:String(p.osm_type??"")+":"+String(p.osm_id??""),name:osmName(t,spec),latitude:ctr[0],longitude:ctr[1],wikidata_qid:qid,brand:t?.brand?String(t.brand):null,operator:t?.operator?String(t.operator):null,settlement:ad.settlement,address:ad.address,tags:safeOsm(t)})}}catch(e){osmStatus="error";errors.push("OSM/Postpass: "+errText(e))}
  try{overture=await overtureRegion(bbox,geom,spec);if(["error","partial","tile_limit"].includes(String(overture.status)))errors.push("Overture: "+overture.status+(overture.errors?.length?" • "+overture.errors[0]:""))}catch(e){overture={status:"error",features:[],tiles_total:0,tiles_ok:0};errors.push("Overture: "+errText(e))}
  try{wd=await wikidataByQids(osmRows)}catch(e){errors.push("Wikidata: "+errText(e))}
  const objects=resolve([...osmRows,...overture.features,...wd],spec).slice(0,OUTPUT_LIMIT);
  const truncated=osmRows.length>=RAW_LIMIT||objects.length>=OUTPUT_LIMIT;
  const sources={osm_postpass:osmStatus,overture:overture.status,overture_reason:overture.reason??null,wikidata:wd.length?"active":"not_applicable",wikidata_mode:"qid_enrichment",overture_release:OVERTURE_RELEASE,overture_tiles_total:overture.tiles_total,overture_tiles_ok:overture.tiles_ok};
  const status=osmStatus!=="active"||["error","partial","tile_limit"].includes(String(overture.status))||truncated?"degraded":"active",now=new Date().toISOString();
  const summary={resolved_objects:objects.length,multi_source:objects.filter((x:any)=>x.source_count>1).length,osm_objects:osmRows.length,overture_objects:overture.features.length,wikidata_objects:wd.length,truncated,cache_ttl_hours:12};
  const row={query_key:queryKey,oblast_id:oblast.id,oblast_code:oblast.code,oblast_name:oblast.name_uk,category_key:spec.key,queried_at:now,status,source_status:sources,summary,objects,errors,updated_at:now};
  const {error:ue}=await sb.from("regional_object_search_cache").upsert(row,{onConflict:"query_key"});if(ue)throw ue;
  if(String(body.format??"").toLowerCase()==="csv")return new Response("\uFEFF"+toCsv(objects),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.csv"'}});
  return json({ok:true,cached:false,...row,category_label:spec.label,oblast:{id:oblast.id,code:oblast.code,name_uk:oblast.name_uk,name_en:oblast.name_en,bbox:oblast.bbox,center:oblast.center},policy:"Objects are public-source inventory candidates. Completeness depends on source coverage and tagging. Cross-source matching is probabilistic unless an exact identifier is shared."});
 }catch(e){console.error("regional search error",errText(e));return json({ok:false,error:errText(e)},500)}
});
