import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { diceSimilarity as dice, normalizeRegionQuery as norm, resolveOblastRow, splitRegionObjectQuery, validateOblastAliases } from "./region_aliases.ts";
import { REGIONAL_SPECS as SPECS, type RegionalSpec as Spec, buildFilterPredicate, extractRegionalFilters, mergeFilters, multiKey, normalizeFilters, parseRegionalQuery, resolveCategoryList, splitObjectExpression, validateRegionalCategories } from "./regional_categories.ts";
import { applyObjectFilters, applySettlementTarget, enrichSettlements, resolveSettlementTarget, toGeoJson, type SettlementCandidate } from "./regional_enrichment.ts";
import { applySpatialPlan, buildSpatialPlan, expandBboxM, spatialSummary, type SpatialPlan } from "./regional_spatial.ts";

const POSTPASS="https://postpass.geofabrik.de/api/interpreter";
const FUSED="https://www.fused.io/server/v1/realtime-shared/UDF_Overture_Maps_Example/run/tiles";
const OVERTURE_RELEASE="2026-04-15-0";
const CACHE_MS=12*3600_000;
const RAW_LIMIT=7000;
const OUTPUT_LIMIT=5000;
const SETTLEMENT_LIMIT=20000;
const CACHE_VERSION="r43_1_3";

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
function hav(a:number,b:number,c:number,d:number){const p=Math.PI/180,R=6371000,da=(c-a)*p,db=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(db/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)))}
function tileXY(lat:number,lon:number,z:number){const n=2**z,x=Math.floor((lon+180)/360*n),lr=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(lr))/Math.PI)/2*n);return{x,y}}
function pointInRing(lon:number,lat:number,ring:any[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=Number(ring[i]?.[0]),yi=Number(ring[i]?.[1]),xj=Number(ring[j]?.[0]),yj=Number(ring[j]?.[1]);if(![xi,yi,xj,yj].every(Number.isFinite))continue;const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-15)+xi);if(hit)inside=!inside}return inside}
function pointInPolygon(lon:number,lat:number,rings:any[]){if(!Array.isArray(rings)||!rings.length||!pointInRing(lon,lat,rings[0]))return false;for(let i=1;i<rings.length;i++)if(pointInRing(lon,lat,rings[i]))return false;return true}
function insideGeom(lat:number,lon:number,g:any){if(g?.type==="Polygon")return pointInPolygon(lon,lat,g.coordinates);if(g?.type==="MultiPolygon")return (g.coordinates??[]).some((p:any)=>pointInPolygon(lon,lat,p));return false}
function geoCenter(f:any){const p=f?.properties??{},b=p?.bbox;if(b&&[b.xmin,b.xmax,b.ymin,b.ymax].every((x:any)=>Number.isFinite(Number(x))))return[(Number(b.ymin)+Number(b.ymax))/2,(Number(b.xmin)+Number(b.xmax))/2];const g=f?.geometry,c=g?.coordinates;if(g?.type==="Point"&&Array.isArray(c))return[Number(c[1]),Number(c[0])];return null}
function sourceUrl(src:string,id:string,qid?:string|null){if(src==="Wikidata"&&qid)return"https://www.wikidata.org/wiki/"+qid;if(src==="OpenStreetMap"){const m=String(id).match(/^([NWR]):(.+)$/);if(m)return"https://www.openstreetmap.org/"+(m[1]==="N"?"node":m[1]==="W"?"way":"relation")+"/"+m[2]}return null}
function addrFromTags(t:any){const city=t?.["addr:city"]??t?.["addr:town"]??t?.["addr:village"]??t?.["addr:place"]??null,full=t?.["addr:full"]??null,street=t?.["addr:street"]??null,house=t?.["addr:housenumber"]??null;return{settlement:city?String(city):null,address:full?String(full):([street,house].filter(Boolean).join(" ")||null)}}
function osmName(t:any,s:Spec){return String(t?.["name:uk"]??t?.["name:ru"]??t?.name??t?.brand??t?.operator??s.label).slice(0,220)}
function safeOsm(t:any){const keys=["name","name:uk","name:ru","name:en","brand","operator","wikidata","website","opening_hours","phone","ref","voltage","substance","utility","generator:source","plant:source","pumping_station","addr:city","addr:town","addr:village","addr:place","addr:full","addr:street","addr:housenumber","is_in","brand:uk","brand:ru","operator:uk","operator:ru","amenity","shop","healthcare","building","landuse","industrial","power","man_made","tower:type","telecom","railway","aeroway","water","waterway","bridge","harbour","seamark:type"];const o:any={};for(const k of keys)if(t?.[k]!=null)o[k]=String(t[k]).slice(0,240);return o}
function postpassSql(b:number[],s:Spec){const [minLon,minLat,maxLon,maxLat]=b.map(Number);return `
SELECT osm_id,osm_type,tags,ST_PointOnSurface(geom) geom
FROM postpass_pointlinepolygon
WHERE geom && ST_MakeEnvelope(${minLon.toFixed(7)},${minLat.toFixed(7)},${maxLon.toFixed(7)},${maxLat.toFixed(7)},4326)
  AND ${s.osm}
LIMIT ${RAW_LIMIT}`}
function postpassSettlementSql(b:number[]){const [minLon,minLat,maxLon,maxLat]=b.map(Number);return `
SELECT osm_id,osm_type,tags,ST_PointOnSurface(geom) geom
FROM postpass_pointlinepolygon
WHERE geom && ST_MakeEnvelope(${minLon.toFixed(7)},${minLat.toFixed(7)},${maxLon.toFixed(7)},${maxLat.toFixed(7)},4326)
  AND tags->>'place' IN ('city','town','village','hamlet')
  AND coalesce(tags->>'name:uk',tags->>'name:ru',tags->>'name',tags->>'name:en') IS NOT NULL
LIMIT ${SETTLEMENT_LIMIT}`}
function settlementCandidates(d:any,geom:any){
 const out:SettlementCandidate[]=[];
 for(const f of Array.isArray(d?.features)?d.features:[]){
  const p=f?.properties??{},t=p.tags??{},ctr=geoCenter(f),name=t?.["name:uk"]??t?.["name:ru"]??t?.name??t?.["name:en"];
  if(!ctr||!name||!Number.isFinite(ctr[0])||!Number.isFinite(ctr[1])||!insideGeom(ctr[0],ctr[1],geom))continue;
  out.push({name:String(name).slice(0,220),latitude:ctr[0],longitude:ctr[1],place:t?.place?String(t.place):null,population:Number.isFinite(Number(t?.population))?Number(t.population):null,source_id:String(p.osm_type??"")+":"+String(p.osm_id??"")});
 }
 return out;
}
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
async function wikidataByQids(rows:any[]){const ids=[...new Set(rows.map(x=>x.wikidata_qid).filter((x:any)=>/^Q\d+$/.test(String(x))))] as string[];const out:any[]=[];for(let i=0;i<ids.length;i+=50){const part=ids.slice(i,i+50),u=new URL("https://www.wikidata.org/w/api.php");u.searchParams.set("action","wbgetentities");u.searchParams.set("ids",part.join("|"));u.searchParams.set("props","labels|descriptions");u.searchParams.set("languages","uk|ru|en");u.searchParams.set("format","json");u.searchParams.set("origin","*");const r=await fetch(u.toString(),{headers:{"user-agent":"GeoWatch-RegionalSearch/1.0"},signal:AbortSignal.timeout(15000)});const t=await r.text();if(!r.ok)throw new Error("Wikidata HTTP "+r.status);const d=JSON.parse(t);for(const q of part){const e=d?.entities?.[q],seed=rows.find(x=>x.wikidata_qid===q);if(!e||!seed)continue;const label=e?.labels?.uk?.value??e?.labels?.ru?.value??e?.labels?.en?.value??seed.name;out.push({source:"Wikidata",source_id:q,wikidata_qid:q,name:String(label),latitude:seed.latitude,longitude:seed.longitude,brand:seed.brand??null,operator:seed.operator??null,settlement:seed.settlement??null,address:seed.address??null,category_keys:Array.isArray(seed.category_keys)?[...seed.category_keys]:[],tags:{description:e?.descriptions?.uk?.value??e?.descriptions?.ru?.value??e?.descriptions?.en?.value??null}})}}return out}
function generic(v:any,s:Spec){const x=norm(v);return !x||x===norm(s.label)||new Set(["fuel","gas station","petrol station","station","industrial","warehouse","school","hospital","pharmacy"]).has(x)}
function resolve(rows:any[],s:Spec){
 const rank=(x:string)=>x==="OpenStreetMap"?3:x==="Wikidata"?2:1;rows=[...rows].sort((a,b)=>rank(b.source)-rank(a.source));
 const entities:any[]=[],qmap=new Map<string,any>();
 const cats=(x:any)=>Array.isArray(x?.category_keys)?x.category_keys.map(String):[];
 const shares=(a:any,b:any)=>{const A=new Set(cats(a));return cats(b).some((x:string)=>A.has(x))};
 const add=(e:any,r:any,method:string,confidence:number)=>{
  e.sources.push({source:r.source,source_id:r.source_id,name:r.name,match_method:method,match_confidence:confidence,url:sourceUrl(r.source,r.source_id,r.wikidata_qid),wikidata_qid:r.wikidata_qid??null});
  e.category_keys=[...new Set([...cats(e),...cats(r)])];
  if(!e.wikidata_qid&&r.wikidata_qid){e.wikidata_qid=r.wikidata_qid;qmap.set(r.wikidata_qid,e)}
  if(!e.address&&r.address)e.address=r.address;if(!e.settlement&&r.settlement)e.settlement=r.settlement;if(!e.brand&&r.brand)e.brand=r.brand;if(!e.operator&&r.operator)e.operator=r.operator;
  e.resolution_status=e.sources.length>1?(method==="exact_wikidata_qid"?"auto_exact":"auto_probable"):"single_source";e.resolution_confidence=Math.min(e.resolution_confidence,confidence);
 };
 for(const r of rows){
  if(r.wikidata_qid&&qmap.has(r.wikidata_qid)){add(qmap.get(r.wikidata_qid),r,"exact_wikidata_qid",100);continue}
  let best:any=null;
  for(const e of entities){
   if(e.sources.some((x:any)=>x.source===r.source)||!shares(e,r))continue;
   const d=hav(e.latitude,e.longitude,r.latitude,r.longitude),sim=generic(e.canonical_name,s)||generic(r.name,s)?0:dice(e.canonical_name,r.name);
   let conf=Math.round(sim*78+Math.max(0,1-d/60)*22);if((sim>=.86&&d<=45)||(sim>=.72&&d<=20))conf=Math.max(conf,87);
   if(conf>=86&&(!best||conf>best.conf))best={e,conf};
  }
  if(best){add(best.e,r,"name_distance",best.conf);continue}
  const e={canonical_name:r.name,latitude:r.latitude,longitude:r.longitude,wikidata_qid:r.wikidata_qid??null,brand:r.brand??null,operator:r.operator??null,settlement:r.settlement??null,address:r.address??null,category_keys:cats(r),resolution_status:"single_source",resolution_confidence:100,sources:[] as any[]};
  entities.push(e);if(e.wikidata_qid)qmap.set(e.wikidata_qid,e);add(e,r,"single_source",100);
 }
 for(const e of entities){const osm=e.sources.find((x:any)=>x.source==="OpenStreetMap"),ot=e.sources.find((x:any)=>x.source==="Overture"),wd=e.sources.find((x:any)=>x.source==="Wikidata");e.canonical_name=osm?.name??ot?.name??wd?.name??e.canonical_name;e.source_count=new Set(e.sources.map((x:any)=>x.source)).size}
 return entities;
}
function csvCell(v:any){const s=String(v??"");return /[",\n\r;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function toCsv(objects:any[]){
 const head=["No","Name","Categories","Brand","Operator","Settlement","Settlement method","Settlement distance m","Address","Address quality","Normalized location","Latitude","Longitude","Distance m","Route distance m","Route along m","Route segment","Sources","Source count","Resolution status","Confidence","Wikidata QID"];
 const rows=objects.map((x,i)=>[i+1,x.canonical_name,(x.category_keys??[]).join(" | "),x.brand,x.operator,x.settlement,x.settlement_method,x.settlement_distance_m,x.address,x.address_quality,x.normalized_location,Number(x.latitude).toFixed(6),Number(x.longitude).toFixed(6),x.distance_m,x.route_distance_m,x.route_along_m,x.route_segment,x.sources.map((s:any)=>s.source+":"+s.source_id).join(" | "),x.source_count,x.resolution_status,x.resolution_confidence,x.wikidata_qid]);
 return[head,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n");
}
async function oblastRows(sb:any){const {data,error}=await sb.from("oblasts").select("id,code,name_uk,name_en");if(error)throw error;return data??[]}
async function resolveOblast(sb:any,q:any){const rows=await oblastRows(sb),best=resolveOblastRow(rows,q);if(!best)return null;const {data:g,error:ge}=await sb.rpc("firewatch_oblast_geometry",{p_oblast_id:best.id});if(ge)throw ge;return{...best,...g}}

let oblastMaskPromise:Promise<any[]>|null=null;
function bboxOverlap(a:number[],b:number[]){return a.length===4&&b.length===4&&a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
async function oblastMasks(sb:any){
 if(!oblastMaskPromise)oblastMaskPromise=(async()=>{
  const rows=await oblastRows(sb);
  const xs=await Promise.all(rows.map(async(r:any)=>{const {data,error}=await sb.rpc("firewatch_oblast_geometry",{p_oblast_id:r.id});if(error)throw error;return data}));
  return xs.filter((x:any)=>x?.geometry&&Array.isArray(x?.bbox));
 })().catch(e=>{oblastMaskPromise=null;throw e});
 return await oblastMaskPromise;
}
function masksForBbox(masks:any[],b:number[]){return masks.filter(x=>bboxOverlap((x.bbox??[]).map(Number),b))}
function insideMasks(lat:number,lon:number,masks:any[]){return masks.some(x=>insideGeom(lat,lon,x.geometry))}
function sqlLiteral(v:unknown){return "'"+String(v??"").slice(0,120).replace(/\u0000/g,"").replace(/'/g,"''")+"'"}
function postpassPlaceSql(name:string){
 const q=sqlLiteral(name),b=[21.5,43.5,41.5,53.7];
 return `
SELECT osm_id,osm_type,tags,ST_PointOnSurface(geom) geom
FROM postpass_pointlinepolygon
WHERE geom && ST_MakeEnvelope(${b[0]},${b[1]},${b[2]},${b[3]},4326)
  AND tags->>'place' IN ('city','town','village','hamlet')
  AND (
   lower(coalesce(tags->>'name:uk',''))=lower(${q})
   OR lower(coalesce(tags->>'name:ru',''))=lower(${q})
   OR lower(coalesce(tags->>'name',''))=lower(${q})
   OR lower(coalesce(tags->>'name:en',''))=lower(${q})
  )
LIMIT 50`;
}
function spatialSettlementCandidates(d:any,masks:any[]){
 const out:SettlementCandidate[]=[];
 for(const f of Array.isArray(d?.features)?d.features:[]){
  const p=f?.properties??{},t=p.tags??{},ctr=geoCenter(f),name=t?.["name:uk"]??t?.["name:ru"]??t?.name??t?.["name:en"];
  if(!ctr||!name||!insideMasks(ctr[0],ctr[1],masks))continue;
  out.push({name:String(name).slice(0,220),latitude:ctr[0],longitude:ctr[1],place:t?.place?String(t.place):null,population:Number.isFinite(Number(t?.population))?Number(t.population):null,source_id:String(p.osm_type??"")+":"+String(p.osm_id??"")});
 }
 return out;
}
async function spatialSearch(sb:any,body:any){
 const spatialInput=body?.spatial&&typeof body.spatial==="object"?{...body.spatial}:{...body};
 const requestedMode=String(spatialInput.mode??spatialInput.type??"").toLowerCase();
 const rawObject=String(body.query??"").trim(),extracted=extractRegionalFilters(rawObject),filters=mergeFilters(extracted.filters,normalizeFilters(body.filters));
 let categoryInputs:string[]=[];
 if(Array.isArray(body.categories))categoryInputs=body.categories.map((x:any)=>String(x??"").trim()).filter(Boolean);
 else categoryInputs=splitObjectExpression(extracted.text||body.category||"");
 if(!categoryInputs.length)throw new Error("missing object/category");
 const categoryPlan=resolveCategoryList(categoryInputs);
 if(categoryPlan.ambiguous){const labels=(categoryPlan.ambiguous.suggestions??[]).map(x=>x.label);throw new Error("ambiguous category"+(labels.length?": "+labels.join(" / "):""))}
 if(!categoryPlan.resolutions.length)throw new Error("object/category could not be resolved");
 const specs=categoryPlan.resolutions.map(x=>x.spec!).filter(Boolean),sqlFilters={...filters,settlement:null,source:null,min_confidence:null,has_address:null},filterPredicate=buildFilterPredicate(sqlFilters);
 const querySpecs:Spec[]=specs.map(x=>({...x,osm:"("+x.osm+") AND ("+filterPredicate+")"}));
 const spec:Spec={key:specs.length===1?specs[0].key:"plan_"+multiKey(categoryPlan.resolutions,filters),label:specs.map(x=>x.label).join(" + "),aliases:[],osm:"("+specs.map(x=>"("+x.osm+")").join(" OR ")+") AND ("+filterPredicate+")",overture:[...new Set(specs.flatMap(x=>x.overture))],overtureTypes:[...new Set(specs.flatMap(x=>x.overtureTypes))]};
 const resolution={mode:categoryPlan.resolutions.length>1?"multi":categoryPlan.resolutions[0].mode,input:rawObject||categoryInputs.join(" + "),confidence:Number(Math.min(...categoryPlan.resolutions.map(x=>x.confidence)).toFixed(3)),categories:categoryPlan.resolutions.map(x=>({key:x.spec?.key,label:x.spec?.label,mode:x.mode,input:x.input,confidence:Number(x.confidence.toFixed(3)),qualifier:x.qualifier??null})),filters};
 const masks=await oblastMasks(sb);
 let plan:SpatialPlan,settlementTarget:any=null;
 if(["settlement","city","town"].includes(requestedMode)){
  const name=String(spatialInput.name??spatialInput.settlement??spatialInput.city??"").trim();if(!name)throw new Error("settlement name required");
  const places=spatialSettlementCandidates(await postpass(postpassPlaceSql(name)),masks),target=resolveSettlementTarget(places,name);if(!target)throw new Error("settlement not found in Ukraine");
  const radius=Number(spatialInput.radius_m??(Number(spatialInput.radius_km)*1000)||target.radius_m);
  plan=buildSpatialPlan({mode:"radius",lat:target.latitude,lon:target.longitude,radius_m:radius});
  settlementTarget={name:target.name,place:target.place??null,latitude:target.latitude,longitude:target.longitude,source_id:target.source_id??null,name_score:target.name_score,default_radius_m:target.radius_m,applied_radius_m:radius};
 }else plan=buildSpatialPlan(spatialInput);
 const relevant=masksForBbox(masks,plan.bbox);if(!relevant.length)throw new Error("spatial area is outside Ukraine");
 if(plan.input_vertices.some(([lon,lat])=>!insideMasks(lat,lon,relevant)))throw new Error("spatial input contains point outside Ukraine");
 const ssum={...spatialSummary(plan),settlement_target:settlementTarget,ukraine_gate:"exact_oblast_geometry"};
 if(body.explain===true)return json({ok:true,explain:true,category_label:spec.label,resolution,spatial:ssum,source_plan:{primary:"OpenStreetMap/Postpass",wikidata:"QID enrichment",overture:"not_applicable in Stage 43.2 spatial mode",ukraine_gate:"public.oblasts exact geometry",cache:"disabled for dynamic spatial queries"},limits:{raw_candidates_per_window:RAW_LIMIT,output_objects:OUTPUT_LIMIT,query_windows:plan.query_bboxes.length},policy:"Explain mode does not query object inventory sources; settlement-name mode may resolve the public OSM place."});

 const errors:string[]=[],osmRows:any[]=[],osmMap=new Map<string,any>(),jobs=querySpecs.flatMap(qs=>plan.query_bboxes.map(b=>({qs,b}))),settled=await Promise.allSettled(jobs.map(j=>postpass(postpassSql(j.b,j.qs))));
 let osmOk=0,osmTruncated=false;
 for(let i=0;i<settled.length;i++){
  const q=settled[i],qs=jobs[i].qs;if(q.status==="rejected"){errors.push("OSM/Postpass "+qs.label+": "+errText(q.reason));continue}
  osmOk++;const raw=Array.isArray(q.value?.features)?q.value.features:[];if(raw.length>=RAW_LIMIT){osmTruncated=true;errors.push("OSM "+qs.label+": candidate limit reached")}
  for(const f of raw){
   const p=f?.properties??{},t=p.tags??{},ctr=geoCenter(f);if(!ctr||!insideMasks(ctr[0],ctr[1],relevant))continue;
   const sourceId=String(p.osm_type??"")+":"+String(p.osm_id??""),existing=osmMap.get(sourceId);if(existing){existing.category_keys=[...new Set([...(existing.category_keys??[]),qs.key])];continue}
   const ad=addrFromTags(t),qid=/^Q\d+$/.test(String(t?.wikidata??""))?String(t.wikidata):null,row={source:"OpenStreetMap",source_id:sourceId,name:osmName(t,qs),latitude:ctr[0],longitude:ctr[1],wikidata_qid:qid,brand:t?.brand?String(t.brand):null,operator:t?.operator?String(t.operator):null,settlement:ad.settlement,address:ad.address,category_keys:[qs.key],tags:safeOsm(t)};
   osmMap.set(sourceId,row);osmRows.push(row);if(osmRows.length>=12000){osmTruncated=true;break}
  }
  if(osmRows.length>=12000)break;
 }
 const osmStatus=osmOk===jobs.length?"active":osmOk>0?"partial":"error",needSettlements=body.count_only!==true||Boolean(filters.settlement);
 let settlements:SettlementCandidate[]=[],settlementStatus="skipped";
 if(needSettlements){
  try{const sbbox=expandBboxM(plan.bbox,25000),sd=await postpass(postpassSettlementSql(sbbox));settlements=spatialSettlementCandidates(sd,masksForBbox(masks,sbbox));settlementStatus=(Array.isArray(sd?.features)&&sd.features.length>=SETTLEMENT_LIMIT)?"partial":"active";if(settlementStatus==="partial")errors.push("OSM settlements: candidate limit reached")}
  catch(e){settlementStatus="error";errors.push("Settlement enrichment: "+errText(e))}
 }
 const sourceFilter=norm(filters.source??""),needWikidata=body.count_only!==true||["wikidata","wd"].includes(sourceFilter);let wd:any[]=[];
 if(needWikidata){try{wd=await wikidataByQids(osmRows)}catch(e){errors.push("Wikidata: "+errText(e))}}
 const resolved=resolve([...osmRows,...wd],spec),enriched=enrichSettlements(resolved,settlements),postFiltered=applyObjectFilters(enriched.objects,filters),spatialFiltered=applySpatialPlan(postFiltered,plan),objects=spatialFiltered.slice(0,OUTPUT_LIMIT),truncated=osmTruncated||spatialFiltered.length>OUTPUT_LIMIT;
 const byCategory:any={};for(const x of objects)for(const k of Array.isArray(x.category_keys)?x.category_keys:[])byCategory[k]=(byCategory[k]??0)+1;
 const status=osmStatus!=="active"||settlementStatus==="error"||truncated?"degraded":"active",summary={resolved_objects:objects.length,base_resolved_objects:resolved.length,filtered_out:Math.max(0,resolved.length-objects.length),multi_source:objects.filter((x:any)=>x.source_count>1).length,osm_objects:osmRows.length,wikidata_objects:wd.length,truncated,cache_ttl_hours:0,resolution,filters,category_count:specs.length,by_category:byCategory,addressing:enriched.summary,spatial:ssum};
 const source_status={osm_postpass:osmStatus,osm_queries_total:jobs.length,osm_queries_ok:osmOk,settlement_enrichment:settlementStatus,settlement_candidates:settlements.length,wikidata:needWikidata?(wd.length?"active":"not_applicable"):"skipped_count_only",overture:"not_applicable",overture_reason:"stage43_2_spatial_osm_primary"};
 const payload={ok:true,cached:false,status,category_key:spec.key,category_label:spec.label,resolution,spatial:ssum,oblasts:relevant.map((x:any)=>({id:x.id,code:x.code,name_uk:x.name_uk??x.name,name_en:x.name_en})),source_status,summary,objects,errors,policy:"Spatial candidates are filtered by the requested geometry and exact Ukraine oblast polygons. Route corridors and radius searches are geometric approximations around the supplied line or point. Public-source completeness depends on OSM tagging and source availability."};
 const format=String(body.format??"").toLowerCase();
 if(format==="csv")return new Response("\uFEFF"+toCsv(objects),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="spatial-'+plan.mode+"-"+spec.key+'.csv"'}});
 if(format==="geojson"){const g=toGeoJson(objects,{category_label:spec.label,spatial:ssum,summary});return new Response(JSON.stringify(g),{headers:{"content-type":"application/geo+json; charset=utf-8","cache-control":"no-store","content-disposition":'attachment; filename="spatial-'+plan.mode+"-"+spec.key+'.geojson"'}})}
 if(body.count_only===true)return json({...payload,count_only:true,objects:[]});
 return json(payload);
}

Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!base||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(base,key,{auth:{persistSession:false}}),bearer=req.headers.get("authorization")??"",cron=req.headers.get("x-cron-secret")??"";
  let authorized=bearer==="Bearer "+key;if(!authorized&&cron){const {data}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cron});authorized=data===true}if(!authorized)return json({ok:false,error:"unauthorized"},401);
  const body:any=await req.json().catch(()=>({}));
  if(body.self_test==="oblast_aliases"){
    const report=validateOblastAliases(await oblastRows(sb)),categories=validateRegionalCategories(),ok=report.ok&&categories.ok,now=new Date().toISOString();
    const monitor={status:ok?"active":"error",last_check:now,...report,category_ok:categories.ok,category_count:categories.category_count,category_alias_count:categories.alias_count,generic_hint_count:categories.generic_hint_count,generic_hint_alias_count:categories.generic_hint_alias_count,category_duplicate_aliases:categories.duplicate_aliases,generic_hint_duplicate_aliases:categories.duplicate_hint_aliases};
    const {error:me}=await sb.from("system_state").upsert({key:"monitor_regional_aliases",value:monitor,updated_at:now});if(me)throw me;
    const {ok:_aliasOk,...aliasReport}=report;return json({self_test:"oblast_aliases",ok,...aliasReport,category_validation:categories},ok?200:500);
  }
  if(body.self_test==="regional_categories"){const report=validateRegionalCategories();return json({self_test:"regional_categories",...report},report.ok?200:500)}
  if(body.spatial||["radius","nearest","polygon","route","settlement","city","town"].includes(String(body.mode??"").toLowerCase()))return await spatialSearch(sb,body);

  const rawQuery=String(body.query??"").trim();
  const extracted=extractRegionalFilters(rawQuery);
  const explicitFilters=normalizeFilters(body.filters);
  const filters=mergeFilters(extracted.filters,explicitFilters);

  let oblastInput:any=body.oblast,categoryInputs:string[]=[];
  if(extracted.text){
    const parts=splitObjectExpression(extracted.text);
    const first=String(parts[0]??"").trim();
    const known=first?parseRegionalQuery(first):null,split=first?splitRegionObjectQuery(first):null;
    if(!known&&!split)return json({ok:false,error:"oblast not found in free-form query",hint:"Use <oblast> <object>, e.g. Полтавская область нефтебаза"},404);
    oblastInput=known?.oblast??split?.oblast_code;
    const firstCategory=known?.category??split?.object_query;
    if(firstCategory)categoryInputs.push(String(firstCategory));
    categoryInputs.push(...parts.slice(1));
  }else if(Array.isArray(body.categories)){
    categoryInputs=body.categories.map((x:any)=>String(x??"").trim()).filter(Boolean);
  }else{
    categoryInputs=splitObjectExpression(body.category??"");
  }

  if(!categoryInputs.length)return json({ok:false,error:"missing object/category"},400);
  const plan=resolveCategoryList(categoryInputs);
  if(plan.ambiguous){
    const labels=(plan.ambiguous.suggestions??[]).map(x=>x.label);
    return json({ok:false,error:"ambiguous category"+(labels.length?": "+labels.join(" / "):""),query:plan.ambiguous.input,suggestions:plan.ambiguous.suggestions??[]},409);
  }
  if(!plan.resolutions.length)return json({ok:false,error:"object/category could not be resolved"},400);

  const oblast=await resolveOblast(sb,oblastInput);if(!oblast)return json({ok:false,error:"oblast not found"},404);
  const specs=plan.resolutions.map(x=>x.spec!).filter(Boolean);
  const sqlFilters={...filters,settlement:null,source:null,min_confidence:null,has_address:null};
  const filterPredicate=buildFilterPredicate(sqlFilters);
  const labels=specs.map(x=>x.label);
  const hasFilters=Object.values(filters).some(Boolean);
  const combinedKey=specs.length===1&&!hasFilters?specs[0].key:"plan_"+multiKey(plan.resolutions,filters);
  const querySpecs:Spec[]=specs.map(x=>({...x,osm:"("+x.osm+") AND ("+filterPredicate+")"}));
  const spec:Spec={
    key:combinedKey,
    label:labels.join(" + "),
    aliases:[],
    osm:"("+specs.map(x=>"("+x.osm+")").join(" OR ")+") AND ("+filterPredicate+")",
    overture:[...new Set(specs.flatMap(x=>x.overture))],
    overtureTypes:[...new Set(specs.flatMap(x=>x.overtureTypes))]
  };
  const resolutionInfo={
    mode:plan.resolutions.length>1?"multi":plan.resolutions[0].mode,
    input:rawQuery||categoryInputs.join(" + "),
    confidence:Number(Math.min(...plan.resolutions.map(x=>x.confidence)).toFixed(3)),
    categories:plan.resolutions.map(x=>({key:x.spec?.key,label:x.spec?.label,mode:x.mode,input:x.input,confidence:Number(x.confidence.toFixed(3)),qualifier:x.qualifier??null})),
    filters
  };

  if(body.explain===true){
    return json({
      ok:true,explain:true,
      oblast:{id:oblast.id,code:oblast.code,name_uk:oblast.name_uk,name_en:oblast.name_en,bbox:oblast.bbox,center:oblast.center},
      category_label:spec.label,
      resolution:resolutionInfo,
      source_plan:{primary:"OpenStreetMap/Postpass",wikidata:"QID enrichment",overture:"not_applicable in region-wide mode",polygon_filter:true,cache_ttl_hours:12},
      limits:{raw_candidates:RAW_LIMIT,output_objects:OUTPUT_LIMIT},
      policy:"Explain mode does not query external object sources."
    });
  }

  const queryKey=String(oblast.code)+":"+CACHE_VERSION+":"+spec.key;
  const {data:cached,error:ce}=await sb.from("regional_object_search_cache").select("*").eq("query_key",queryKey).maybeSingle();if(ce)throw ce;
  const age=Date.now()-Date.parse(String(cached?.queried_at??""));
  if(cached&&!body.refresh&&Number.isFinite(age)&&age<CACHE_MS){
    const format=String(body.format??"").toLowerCase(),cachedObjects=Array.isArray(cached.objects)?cached.objects:[];
    if(format==="csv")return new Response("\uFEFF"+toCsv(cachedObjects),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.csv"'}});
    if(format==="geojson"){const g=toGeoJson(cachedObjects,{oblast_code:oblast.code,oblast_name:oblast.name_uk,category_label:spec.label,query_key:queryKey,cached:true});return new Response(JSON.stringify(g),{headers:{"content-type":"application/geo+json; charset=utf-8","cache-control":"no-store","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.geojson"'}})}
    const payload={ok:true,cached:true,...cached,category_label:spec.label,resolution:cached?.summary?.resolution??resolutionInfo,oblast:{id:oblast.id,code:oblast.code,name_uk:oblast.name_uk,name_en:oblast.name_en,bbox:oblast.bbox,center:oblast.center}};
    if(body.count_only===true)return json({...payload,count_only:true,objects:[]});
    return json(payload);
  }

  const errors:string[]=[];let osmStatus="active",osmTruncated=false,overture:any={status:"not_checked",features:[],tiles_total:0,tiles_ok:0},wd:any[]=[],settlementStatus="skipped",settlements: SettlementCandidate[]=[];
  const bbox=(oblast.bbox??[]).map(Number),geom=oblast.geometry;if(bbox.length!==4||!geom)throw new Error("oblast geometry unavailable");
  const osmRows:any[]=[],osmMap=new Map<string,any>(),needSettlements=body.count_only!==true||Boolean(filters.settlement);
  const settlementPromise=needSettlements?postpass(postpassSettlementSql(bbox)):Promise.resolve(null);
  const settled=await Promise.allSettled(querySpecs.map(x=>postpass(postpassSql(bbox,x))));
  let osmOk=0;
  for(let qi=0;qi<settled.length;qi++){
    const q=settled[qi],qs=querySpecs[qi];
    if(q.status==="rejected"){errors.push("OSM/Postpass "+qs.label+": "+errText(q.reason));continue}
    osmOk++;
    const raw=Array.isArray(q.value?.features)?q.value.features:[];
    if(raw.length>=RAW_LIMIT){osmTruncated=true;errors.push("OSM "+qs.label+": candidate limit reached")}
    for(const f of raw){
      const p=f?.properties??{},t=p.tags??{},ctr=geoCenter(f);
      if(!ctr||!Number.isFinite(ctr[0])||!Number.isFinite(ctr[1])||!insideGeom(ctr[0],ctr[1],geom))continue;
      const sourceId=String(p.osm_type??"")+":"+String(p.osm_id??"");
      const existing=osmMap.get(sourceId);if(existing){existing.category_keys=[...new Set([...(existing.category_keys??[]),qs.key])];continue}
      const ad=addrFromTags(t),qid=/^Q\d+$/.test(String(t?.wikidata??""))?String(t.wikidata):null;
      const row={source:"OpenStreetMap",source_id:sourceId,name:osmName(t,qs),latitude:ctr[0],longitude:ctr[1],wikidata_qid:qid,brand:t?.brand?String(t.brand):null,operator:t?.operator?String(t.operator):null,settlement:ad.settlement,address:ad.address,category_keys:[qs.key],tags:safeOsm(t)};
      osmMap.set(sourceId,row);osmRows.push(row);
      if(osmRows.length>=12000){osmTruncated=true;break}
    }
    if(osmRows.length>=12000)break;
  }
  osmStatus=osmOk===querySpecs.length?"active":osmOk>0?"partial":"error";
  if(needSettlements){
    try{const sd=await settlementPromise;settlements=settlementCandidates(sd,geom);settlementStatus=(Array.isArray(sd?.features)&&sd.features.length>=SETTLEMENT_LIMIT)?"partial":"active";if(settlementStatus==="partial")errors.push("OSM settlements: candidate limit reached")}
    catch(e){settlementStatus="error";if(filters.settlement)errors.push("Settlement enrichment: "+errText(e))}
  }
  try{overture=await overtureRegion(bbox,geom,spec);if(["error","partial","tile_limit"].includes(String(overture.status)))errors.push("Overture: "+overture.status+(overture.errors?.length?" • "+overture.errors[0]:""))}catch(e){overture={status:"error",features:[],tiles_total:0,tiles_ok:0};errors.push("Overture: "+errText(e))}
  const sourceFilter=norm(filters.source??""),needWikidata=body.count_only!==true||["wikidata","wd"].includes(sourceFilter);
  if(needWikidata){try{wd=await wikidataByQids(osmRows)}catch(e){errors.push("Wikidata: "+errText(e))}}
  const resolved=resolve([...osmRows,...overture.features,...wd],spec);
  const enriched=enrichSettlements(resolved,settlements);
  const settlementTarget=filters.settlement?resolveSettlementTarget(settlements,filters.settlement):null;
  const settlementScoped=settlementTarget?applySettlementTarget(enriched.objects,settlementTarget):enriched.objects;
  const effectiveFilters=settlementTarget?{...filters,settlement:null}:filters;
  const filtered=applyObjectFilters(settlementScoped,effectiveFilters);
  const objects=filtered.slice(0,OUTPUT_LIMIT);
  const truncated=osmTruncated||filtered.length>OUTPUT_LIMIT;
  const byCategory:any={};for(const x of objects)for(const k of Array.isArray(x.category_keys)?x.category_keys:[])byCategory[k]=(byCategory[k]??0)+1;
  const sources={osm_postpass:osmStatus,osm_query_count:querySpecs.length,osm_queries_ok:osmOk,settlement_enrichment:settlementStatus,settlement_candidates:settlements.length,overture:overture.status,overture_reason:overture.reason??null,wikidata:needWikidata?(wd.length?"active":"not_applicable"):"skipped_count_only",wikidata_mode:"qid_enrichment",overture_release:OVERTURE_RELEASE,overture_tiles_total:overture.tiles_total,overture_tiles_ok:overture.tiles_ok};
  const status=osmStatus!=="active"||["error","partial","tile_limit"].includes(String(overture.status))||(filters.settlement&&settlementStatus!=="active")||truncated?"degraded":"active",now=new Date().toISOString();
  const summary={resolved_objects:objects.length,base_resolved_objects:resolved.length,filtered_out:Math.max(0,resolved.length-filtered.length),multi_source:objects.filter((x:any)=>x.source_count>1).length,osm_objects:osmRows.length,overture_objects:overture.features.length,wikidata_objects:wd.length,truncated,cache_ttl_hours:12,cache_version:CACHE_VERSION,resolution:resolutionInfo,filters,category_count:specs.length,by_category:byCategory,addressing:enriched.summary,settlement_filter:filters.settlement?settlementTarget?{mode:"radius_fallback",query:filters.settlement,target:settlementTarget.name,place:settlementTarget.place??null,radius_m:settlementTarget.radius_m,name_score:settlementTarget.name_score}:{mode:"enriched_name",query:filters.settlement}:null};
  const row={query_key:queryKey,oblast_id:oblast.id,oblast_code:oblast.code,oblast_name:oblast.name_uk,category_key:spec.key,queried_at:now,status,source_status:sources,summary,objects,errors,updated_at:now};

  if(body.count_only!==true){
    const {error:ue}=await sb.from("regional_object_search_cache").upsert(row,{onConflict:"query_key"});if(ue)throw ue;
  }
  const format=String(body.format??"").toLowerCase();
  if(format==="csv")return new Response("\uFEFF"+toCsv(objects),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.csv"'}});
  if(format==="geojson"){const g=toGeoJson(objects,{oblast_code:oblast.code,oblast_name:oblast.name_uk,category_label:spec.label,query_key:queryKey,cached:false,summary});return new Response(JSON.stringify(g),{headers:{"content-type":"application/geo+json; charset=utf-8","cache-control":"no-store","content-disposition":'attachment; filename="'+spec.key+"-"+String(oblast.code)+'.geojson"'}})}
  const payload={ok:true,cached:false,...row,category_label:spec.label,resolution:resolutionInfo,oblast:{id:oblast.id,code:oblast.code,name_uk:oblast.name_uk,name_en:oblast.name_en,bbox:oblast.bbox,center:oblast.center},policy:"Objects are public-source inventory candidates. Missing settlements may be inferred from the nearest public OSM place within 25 km and are marked settlement_method=osm_nearest. An explicit settlement filter may use a documented approximate radius fallback around the matched OSM place when administrative settlement polygons are unavailable. Filters and free-text matching use a safe whitelist of public OSM fields. Completeness depends on public source coverage and tagging."};
  if(body.count_only===true)return json({...payload,count_only:true,objects:[]});
  return json(payload);
 }catch(e){console.error("regional search error",errText(e));return json({ok:false,error:errText(e)},500)}
});
