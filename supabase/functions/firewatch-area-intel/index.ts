import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const POSTPASS="https://postpass.geofabrik.de/api/interpreter";
const FUSED="https://www.fused.io/server/v1/realtime-shared/UDF_Overture_Maps_Example/run/tiles";
const WIKIDATA_SPARQL="https://query.wikidata.org/sparql";
const WIKIMEDIA_API="https://uk.wikipedia.org/w/api.php";
const OVERTURE_MIRROR_RELEASE="2026-04-15-0";
const OVERTURE_OFFICIAL_LATEST="2026-09-23.0";
const TIMEOUT_MS=25000;
const CACHE_MS=12*3600_000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
function clampRadius(v:any){const n=Math.round(Number(v??2000));return Math.max(250,Math.min(10000,Number.isFinite(n)?n:2000))}
function qkey(lat:number,lon:number,r:number){return lat.toFixed(5)+":"+lon.toFixed(5)+":"+r}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){const p=Math.PI/180,R=6371000,dlat=(lat2-lat1)*p,dlon=(lon2-lon1)*p;const a=Math.sin(dlat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(a)))}
function tileXY(lat:number,lon:number,z:number){const n=2**z,x=Math.floor((lon+180)/360*n),lr=lat*Math.PI/180,y=Math.floor((1-Math.asinh(Math.tan(lr))/Math.PI)/2*n);return{x,y}}
function labelName(t:any,cat:string){return String(t?.["name:uk"]??t?.["name:ru"]??t?.name??t?.official_name??t?.operator??t?.brand??cat).slice(0,180)}
function category(t:any){
  const amen=String(t?.amenity??""),office=String(t?.office??""),building=String(t?.building??""),land=String(t?.landuse??""),man=String(t?.man_made??""),power=String(t?.power??""),rail=String(t?.railway??""),aero=String(t?.aeroway??""),health=String(t?.healthcare??""),emergency=String(t?.emergency??""),pub=String(t?.public_transport??""),industrial=String(t?.industrial??"");
  if(power)return ["energy",power];
  if(office==="government"||["townhall","courthouse"].includes(amen)||["government","civic","public"].includes(building))return ["government",amen||office||building];
  if(["fire_station","police","ambulance_station"].includes(amen)||emergency)return ["emergency",amen||emergency];
  if(["hospital","clinic","doctors","pharmacy"].includes(amen)||health||["hospital","clinic"].includes(building))return ["healthcare",health||amen||building];
  if(["school","university","college","kindergarten"].includes(amen)||["school","university","college","kindergarten"].includes(building))return ["education",amen||building];
  if(["station","halt","yard","terminal"].includes(rail)||["station","platform"].includes(pub)||["aerodrome","terminal","helipad"].includes(aero)||amen==="bus_station"||t?.harbour==="yes"||t?.["seamark:type"]==="harbour"||man==="pier"||t?.bridge==="yes")return ["transport",rail||pub||aero||amen||"harbour"];
  if(building==="warehouse"||industrial==="warehouse"||industrial==="port"||land==="port")return ["logistics",building||industrial||land];
  if(["water_works","wastewater_plant","pumping_station","water_tower","reservoir_covered"].includes(man)||String(t?.water??"")==="reservoir")return ["water",man||String(t?.water)];
  if(["mast","tower","communications_tower","antenna"].includes(man)||String(t?.["tower:type"]??"")==="communication"||office==="telecommunication"||Boolean(t?.telecom))return ["telecom",String(t?.telecom??t?.["tower:type"]??man??office)];
  if(land==="industrial"||man==="works"||Boolean(industrial)||["industrial","factory"].includes(building))return ["industrial",industrial||land||man||building];
  if(["commercial","retail"].includes(land)||["commercial","retail","supermarket"].includes(building)||Boolean(t?.shop))return ["commercial",String(t?.shop??building??land)];
  if(land==="residential"||["apartments","residential","dormitory"].includes(building))return ["residential",building||land];
  if(["museum","theatre","arts_centre","library","community_centre","place_of_worship"].includes(amen))return ["cultural",amen];
  if(["post_office","social_facility","public_building"].includes(amen))return ["public_service",amen];
  if(man==="storage_tank")return ["storage","storage_tank"];
  return null;
}
function safeTags(t:any){
  const keys=["name","name:uk","name:ru","official_name","amenity","office","building","landuse","industrial","power","man_made","railway","public_transport","aeroway","harbour","seamark:type","healthcare","emergency","telecom","tower:type","shop","operator","brand","wikidata","wikipedia","website","start_date"];
  const o:any={};for(const k of keys)if(t?.[k]!=null)o[k]=String(t[k]).slice(0,220);return o;
}
function postpassSql(lat:number,lon:number,r:number){
  const dLat=r/111320,dLon=r/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
  const minLon=(lon-dLon).toFixed(6),maxLon=(lon+dLon).toFixed(6),minLat=(lat-dLat).toFixed(6),maxLat=(lat+dLat).toFixed(6);
  return `
WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${lon.toFixed(7)},${lat.toFixed(7)}),4326) event_geom),
q AS (
 SELECT osm_id,osm_type,tags,ST_ClosestPoint(geom,p.event_geom) geom,
        ST_Distance(geom::geography,p.event_geom::geography) distance_m
 FROM postpass_pointlinepolygon,p
 WHERE geom && ST_MakeEnvelope(${minLon},${minLat},${maxLon},${maxLat},4326)
 AND (
   tags ? 'power'
   OR tags->>'office' IN ('government','telecommunication')
   OR tags->>'amenity' IN ('townhall','courthouse','fire_station','police','ambulance_station','hospital','clinic','doctors','pharmacy','school','university','college','kindergarten','bus_station','museum','theatre','arts_centre','library','community_centre','place_of_worship','post_office','social_facility','public_building')
   OR tags ? 'healthcare' OR tags ? 'emergency' OR tags ? 'telecom'
   OR tags->>'building' IN ('government','civic','public','hospital','clinic','school','university','college','kindergarten','warehouse','industrial','factory','commercial','retail','supermarket','apartments','residential','dormitory')
   OR tags->>'landuse' IN ('industrial','commercial','retail','residential','port')
   OR tags ? 'industrial' OR tags ? 'shop'
   OR tags->>'man_made' IN ('works','pier','water_works','wastewater_plant','pumping_station','water_tower','reservoir_covered','mast','tower','communications_tower','antenna','storage_tank')
   OR tags->>'railway' IN ('station','halt','yard','terminal')
   OR tags->>'public_transport' IN ('station','platform')
   OR tags->>'aeroway' IN ('aerodrome','terminal','helipad')
   OR tags->>'harbour'='yes' OR tags->>'seamark:type'='harbour' OR tags->>'bridge'='yes'
   OR tags->>'water'='reservoir'
 )
)
SELECT osm_id,osm_type,tags,geom,distance_m FROM q
WHERE distance_m<=${r}
ORDER BY distance_m LIMIT 1800`;
}
function buildingSql(lat:number,lon:number,r:number){
  const dLat=r/111320,dLon=r/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
  const minLon=(lon-dLon).toFixed(6),maxLon=(lon+dLon).toFixed(6),minLat=(lat-dLat).toFixed(6),maxLat=(lat+dLat).toFixed(6);
  return `
WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${lon.toFixed(7)},${lat.toFixed(7)}),4326) event_geom),
b AS (
 SELECT tags,geom,ST_Distance(geom::geography,p.event_geom::geography) distance_m
 FROM postpass_pointlinepolygon,p
 WHERE geom && ST_MakeEnvelope(${minLon},${minLat},${maxLon},${maxLat},4326)
   AND tags ? 'building'
)
SELECT count(*)::int building_count,
       count(*) filter(where tags ? 'name')::int named_count,
       count(*) filter(where tags->>'building' in ('industrial','warehouse','commercial','retail','hospital','school','university','government','civic','public'))::int nonresidential_tagged_count,
       ST_SetSRID(ST_MakePoint(${lon.toFixed(7)},${lat.toFixed(7)}),4326) geom
FROM b WHERE distance_m<=${r}`;
}
async function postpass(sql:string){
  const res=await fetch(POSTPASS,{method:"POST",headers:{"accept":"application/json","content-type":"application/x-www-form-urlencoded","user-agent":"GeoWatch-AreaIntel/1.0"},body:new URLSearchParams([["data",sql]]),signal:AbortSignal.timeout(TIMEOUT_MS)});
  const text=await res.text();if(!res.ok)throw new Error("Postpass HTTP "+res.status+": "+text.slice(0,260));
  try{return JSON.parse(text)}catch{throw new Error("Postpass invalid JSON")}
}
function geoCenter(f:any){
  const p=f?.properties??{},b=p?.bbox;
  if(b&&Number.isFinite(Number(b.xmin))&&Number.isFinite(Number(b.xmax))&&Number.isFinite(Number(b.ymin))&&Number.isFinite(Number(b.ymax)))return[(Number(b.ymin)+Number(b.ymax))/2,(Number(b.xmin)+Number(b.xmax))/2];
  const g=f?.geometry,c=g?.coordinates;
  if(g?.type==="Point"&&Array.isArray(c))return[Number(c[1]),Number(c[0])];
  return null;
}
async function fetchJson(url:string){
  const r=await fetch(url,{headers:{"accept":"application/geo+json,application/json","user-agent":"GeoWatch-AreaIntel/1.0"},signal:AbortSignal.timeout(10000)});
  const t=await r.text();if(!r.ok)throw new Error("HTTP "+r.status+" "+t.slice(0,180));return JSON.parse(t);
}
function normName(v:any){
  return String(v??"").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g,"").replace(/['’\u02bc"]/g,"")
    .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
}
function genericName(v:any){
  const x=normName(v).replace(/_/g," ");
  return new Set(["industrial","residential","energy","education","transport","government","emergency","healthcare","commercial","logistics","telecom","storage","water","cultural","public service","place","infrastructure","parking","bus stop","fence","lift gate","ferry terminal","wikidata entity"]).has(x);
}
function diceName(a:any,b:any){
  const x=normName(a),y=normName(b);if(!x||!y||genericName(x)||genericName(y))return 0;if(x===y)return 1;
  if((x.length>=6&&y.includes(x))||(y.length>=6&&x.includes(y)))return .92;
  const bg=(s:string)=>{const z=s.replace(/\s+/g," ");const m=new Map<string,number>();for(let i=0;i<z.length-1;i++){const q=z.slice(i,i+2);m.set(q,(m.get(q)??0)+1)}return m};
  const A=bg(x),B=bg(y);let inter=0,na=0,nb=0;for(const v of A.values())na+=v;for(const v of B.values())nb+=v;for(const [k,v] of A)inter+=Math.min(v,B.get(k)??0);
  const dice=(na+nb)?2*inter/(na+nb):0;
  const ta=new Set(x.split(" ").filter(z=>z.length>1)),tb=new Set(y.split(" ").filter(z=>z.length>1));
  let ti=0;for(const z of ta)if(tb.has(z))ti++;const jac=(ta.size+tb.size-ti)?ti/(ta.size+tb.size-ti):0;
  return Math.max(dice,jac);
}
function wdCategory(instanceLabels:string[],description:string){
  const s=(instanceLabels.join(" ")+" "+description).toLowerCase();
  const has=(...x:string[])=>x.some(k=>s.includes(k));
  if(has("power station","power plant","substation","electric","електростан","підстан","электростан"))return["energy","wikidata"];
  if(has("factory","industrial","plant","завод","промисл","промышлен"))return["industrial","wikidata"];
  if(has("court","government","administration","city council","рада","адміністра","администра","суд"))return["government","wikidata"];
  if(has("fire station","police","emergency","пожеж","поліц","полици","рятув"))return["emergency","wikidata"];
  if(has("hospital","clinic","pharmacy","лікарн","лікар","больниц","клиник"))return["healthcare","wikidata"];
  if(has("school","university","college","школ","універс","универс","коледж"))return["education","wikidata"];
  if(has("railway","station","airport","port","bridge","terminal","вокзал","станці","станци","аеропорт","аэропорт","порт","міст","мост"))return["transport","wikidata"];
  if(has("warehouse","logistics","склад","логіст","логист"))return["logistics","wikidata"];
  if(has("water tower","waterworks","reservoir","водоканал","водосхов","водохрани"))return["water","wikidata"];
  if(has("telecommunication","tower","mast","телеком","веж","башн"))return["telecom","wikidata"];
  if(has("museum","theatre","library","church","cathedral","monument","музей","театр","бібліот","библиот","церк","собор"))return["cultural","wikidata"];
  if(has("market","shopping","retail","торгов","ринок","рынок"))return["commercial","wikidata"];
  return["wikidata_entity","entity"];
}
function parseWktPoint(v:any){
  const m=String(v??"").match(/Point\(([-+0-9.eE]+)\s+([-+0-9.eE]+)\)/i);if(!m)return null;
  const lon=Number(m[1]),lat=Number(m[2]);return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null;
}
async function wikiApi(params:Record<string,string>){
  const u=new URL(WIKIMEDIA_API);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const res=await fetch(u.toString(),{headers:{"accept":"application/json","user-agent":"GeoWatch-AreaIntel/1.1 (FIRMSGeoTools)"},signal:AbortSignal.timeout(10000)});
  const t=await res.text();if(!res.ok)throw new Error("Wikimedia HTTP "+res.status+": "+t.slice(0,180));
  try{return JSON.parse(t)}catch{throw new Error("Wikimedia invalid JSON")}
}
function skipWikiContext(title:string,description:string){
  const s=(title+" "+description).toLowerCase();
  return ["стаття-список","список ","битва ","битва під","облога ","battle of","siege of","війна ","war of"].some(x=>s.includes(x));
}
async function wikidataContext(lat:number,lon:number,r:number){
  const gs=await wikiApi({
    action:"query",list:"geosearch",gsprimary:"all",gsnamespace:"0",
    gscoord:lat.toFixed(7)+"|"+lon.toFixed(7),gsradius:String(Math.max(250,Math.min(10000,r))),
    gslimit:"100",format:"json",formatversion:"2"
  });
  const points:any[]=Array.isArray(gs?.query?.geosearch)?gs.query.geosearch:[];
  if(!points.length)return{status:"active",transport:"wikimedia_geosearch",count:0,features:[]};
  const detailById=new Map<number,any>();
  for(let i=0;i<points.length;i+=50){
    const ids=points.slice(i,i+50).map(x=>String(x.pageid)).join("|");
    const q=await wikiApi({action:"query",pageids:ids,prop:"pageprops|description",ppprop:"wikibase_item",format:"json",formatversion:"2"});
    for(const p of Array.isArray(q?.query?.pages)?q.query.pages:[])detailById.set(Number(p.pageid),p);
  }
  const rows:any[]=[];
  for(const p of points){
    const d=detailById.get(Number(p.pageid))??{},qid=String(d?.pageprops?.wikibase_item??"");
    if(!/^Q\d+$/.test(qid))continue;
    const title=String(d?.title??p.title??qid),description=String(d?.description??"");
    if(skipWikiContext(title,description))continue;
    const plat=Number(p.lat),plon=Number(p.lon),dist=Number(p.dist);
    if(!Number.isFinite(plat)||!Number.isFinite(plon)||!Number.isFinite(dist)||dist>r)continue;
    const [cat,sub]=wdCategory([],description);
    rows.push({source:"Wikidata",source_id:qid,wikidata_qid:qid,name:title,description,
      distance_m:Math.round(dist),latitude:plat,longitude:plon,instance_labels:[],category:cat,subcategory:sub,
      wikipedia_url:"https://uk.wikipedia.org/?curid="+String(p.pageid)});
  }
  rows.sort((a,b)=>a.distance_m-b.distance_m);
  const unique=new Map<string,any>();for(const x of rows){const q=String(x.wikidata_qid);const old=unique.get(q);if(!old||Number(x.distance_m)<Number(old.distance_m))unique.set(q,x)}
  const out=[...unique.values()].sort((a,b)=>a.distance_m-b.distance_m).slice(0,100);
  return{status:"active",transport:"wikimedia_geosearch",count:out.length,features:out};
}
function sourceRank(s:string){return s==="Wikidata"?3:s==="OpenStreetMap"?2:s==="Overture"?1:0}
function categoryCompatible(a:any,b:any){
  const x=String(a??""),y=String(b??"");if(!x||!y||x==="wikidata_entity"||y==="wikidata_entity"||x==="place"||y==="place"||x==="infrastructure"||y==="infrastructure")return true;
  return x===y;
}
function resolveEntities(osm:any[],overture:any[],wd:any[]){
  const rows:any[]=[
    ...osm.map(x=>({...x,wikidata_qid:/^Q\d+$/.test(String(x?.tags?.wikidata??""))?String(x.tags.wikidata):null})),
    ...wd,
    ...overture.map(x=>({...x,wikidata_qid:null}))
  ];
  rows.sort((a,b)=>(b.wikidata_qid?1:0)-(a.wikidata_qid?1:0)||sourceRank(b.source)-sourceRank(a.source)||Number(a.distance_m??0)-Number(b.distance_m??0));
  const entities:any[]=[];const proposals:any[]=[];
  const qidMap=new Map<string,any>();
  const newEntity=(r:any)=>{
    const e={key:r.wikidata_qid?("wd:"+r.wikidata_qid):(String(r.source)+":"+String(r.source_id)),canonical_name:r.name??r.wikidata_qid??r.source_id,
      category:r.category??"other",subcategory:r.subcategory??null,latitude:r.latitude,longitude:r.longitude,wikidata_qid:r.wikidata_qid??null,
      sources:[] as any[],resolution_status:"single_source",resolution_confidence:100,aliases:new Set<string>()};
    entities.push(e);if(e.wikidata_qid)qidMap.set(e.wikidata_qid,e);return e;
  };
  const add=(e:any,r:any,method:string,confidence:number)=>{
    e.sources.push({...r,match_method:method,match_confidence:confidence});
    if(r.name)e.aliases.add(String(r.name));
    if(!e.wikidata_qid&&r.wikidata_qid){e.wikidata_qid=r.wikidata_qid;qidMap.set(r.wikidata_qid,e);e.key="wd:"+r.wikidata_qid}
    if(sourceRank(r.source)>sourceRank(e.sources?.[0]?.source??"")&&r.name)e.canonical_name=r.name;
    if((e.category==="wikidata_entity"||e.category==="place"||e.category==="infrastructure")&&r.category&&!["wikidata_entity","place","infrastructure"].includes(r.category)){e.category=r.category;e.subcategory=r.subcategory??e.subcategory}
    if(r.source==="OpenStreetMap"&&r.category){e.category=r.category;e.subcategory=r.subcategory??e.subcategory;e.latitude=r.latitude;e.longitude=r.longitude}
    e.resolution_status=e.sources.length>1?(method==="exact_wikidata_qid"?"auto_exact":"auto_probable"):"single_source";
    e.resolution_confidence=Math.min(e.resolution_confidence,confidence);
  };
  for(const r of rows){
    if(r.wikidata_qid&&qidMap.has(r.wikidata_qid)){add(qidMap.get(r.wikidata_qid),r,"exact_wikidata_qid",100);continue}
    let candidates:any[]=[];
    if(!r.wikidata_qid||r.source!=="Wikidata"){
      for(const e of entities){
        if(e.sources.some((s:any)=>s.source===r.source))continue;
        if(!categoryCompatible(e.category,r.category))continue;
        const d=hav(Number(e.latitude),Number(e.longitude),Number(r.latitude),Number(r.longitude));
        if(!Number.isFinite(d)||d>180)continue;
        const sim=diceName(e.canonical_name,r.name);
        let conf=Math.round(sim*75+Math.max(0,1-d/180)*25);
        if(sim>=.88&&d<=120)conf=Math.max(conf,88);
        if(sim>=.78&&d<=40)conf=Math.max(conf,86);
        if(conf>=80)candidates.push({e,d,sim,conf});
      }
      candidates.sort((a,b)=>b.conf-a.conf||a.d-b.d);
    }
    if(candidates.length&&candidates[0].conf>=86&&(!candidates[1]||candidates[0].conf-candidates[1].conf>=6)){
      add(candidates[0].e,r,"name_distance",candidates[0].conf);continue;
    }
    if(candidates.length&&candidates[0].conf>=80){
      const own=newEntity(r);add(own,r,"single_source",100);
      for(const x of candidates.slice(0,2))proposals.push({
        source_a:String(r.source),source_id_a:String(r.source_id),source_b:String(x.e.sources[0]?.source??"entity"),
        source_id_b:String(x.e.sources[0]?.source_id??x.e.key),confidence:x.conf,
        reason:{name_similarity:Number(x.sim.toFixed(3)),distance_m:Math.round(x.d),candidate_name:x.e.canonical_name}
      });
      continue;
    }
    const e=newEntity(r);add(e,r,"single_source",100);
  }
  for(const e of entities){
    const wdsrc=e.sources.find((x:any)=>x.source==="Wikidata"),osmsrc=e.sources.find((x:any)=>x.source==="OpenStreetMap");
    if(wdsrc?.name)e.canonical_name=wdsrc.name;else if(osmsrc?.name)e.canonical_name=osmsrc.name;
    if(osmsrc){e.latitude=osmsrc.latitude;e.longitude=osmsrc.longitude}
    e.source_count=new Set(e.sources.map((x:any)=>x.source)).size;
    if(e.source_count===1)e.resolution_status="single_source";
    e.aliases=[...e.aliases].filter((x:any)=>x&&x!==e.canonical_name).slice(0,12);
  }
  return{entities,proposals};
}
async function persistResolution(sb:any,queryKey:string,res:any){
  await sb.from("area_entity_resolution_proposals").delete().eq("query_key",queryKey);
  await sb.from("area_entities").delete().eq("query_key",queryKey);
  const entityRows=res.entities.map((e:any)=>({
    query_key:queryKey,resolution_key:String(e.key),canonical_name:String(e.canonical_name??"").slice(0,240)||null,
    category:e.category??null,subcategory:e.subcategory??null,latitude:Number.isFinite(Number(e.latitude))?Number(e.latitude):null,
    longitude:Number.isFinite(Number(e.longitude))?Number(e.longitude):null,wikidata_qid:e.wikidata_qid??null,
    source_count:e.source_count,resolution_status:e.resolution_status,resolution_confidence:e.resolution_confidence,
    aliases:e.aliases,provenance:{sources:e.sources.map((x:any)=>({source:x.source,source_id:x.source_id,match_method:x.match_method,match_confidence:x.match_confidence}))}
  }));
  const {data:inserted,error:ie}=await sb.from("area_entities").insert(entityRows).select("id,resolution_key");if(ie)throw new Error("area_entities insert: "+errText(ie));
  const idMap=new Map((inserted??[]).map((x:any)=>[String(x.resolution_key),String(x.id)]));
  const sourceRows:any[]=[];
  for(const e of res.entities){const eid=idMap.get(String(e.key));if(!eid)continue;for(const s of e.sources)sourceRows.push({
    entity_id:eid,query_key:queryKey,source:String(s.source),source_id:String(s.source_id),source_name:s.name??null,
    category:s.category??null,subcategory:s.subcategory??null,latitude:s.latitude??null,longitude:s.longitude??null,
    wikidata_qid:s.wikidata_qid??null,match_method:s.match_method,match_confidence:s.match_confidence,
    provenance:s.source==="OpenStreetMap"?{tags:s.tags??{}}:s.source==="Wikidata"?{description:s.description??null,instance_labels:s.instance_labels??[]}:{distance_m:s.distance_m??null}
  })}
  const sourceMap=new Map<string,any>();for(const x of sourceRows){const k=x.query_key+"|"+x.source+"|"+x.source_id;if(!sourceMap.has(k))sourceMap.set(k,x)}
  const finalSources=[...sourceMap.values()];
  if(finalSources.length){const {error}=await sb.from("area_entity_sources").insert(finalSources);if(error)throw new Error("area_entity_sources insert: "+errText(error))}
  if(res.proposals.length){const {error}=await sb.from("area_entity_resolution_proposals").insert(res.proposals.map((p:any)=>({query_key:queryKey,...p})));if(error)throw new Error("resolution proposals insert: "+errText(error))}
  const multi=res.entities.filter((e:any)=>e.source_count>1).length,exact=res.entities.filter((e:any)=>e.resolution_status==="auto_exact").length,prob=res.entities.filter((e:any)=>e.resolution_status==="auto_probable").length;
  return{entities:res.entities.length,multi_source:multi,exact_qid:exact,probable:prob,pending_proposals:res.proposals.length,
    source_rows:finalSources.length,wikidata_entities:finalSources.filter(x=>x.source==="Wikidata").length,
    osm_entities:finalSources.filter(x=>x.source==="OpenStreetMap").length,overture_entities:finalSources.filter(x=>x.source==="Overture").length};
}

async function overtureContext(lat:number,lon:number,r:number){
  if(r>2500)return{status:"radius_limited",mirror_release:OVERTURE_MIRROR_RELEASE,official_latest:OVERTURE_OFFICIAL_LATEST,mirror_lag:true,features:[]};
  const z=16,c=tileXY(lat,lon,z),types=["infrastructure","place"],out:any[]=[];const errors:string[]=[];
  for(const typ of types){
    const settled=await Promise.allSettled(Array.from({length:9},(_,i)=>{const dx=(i%3)-1,dy=Math.floor(i/3)-1;return fetchJson(FUSED+"/"+z+"/"+(c.x+dx)+"/"+(c.y+dy)+"?dtype_out_vector=geojson&overture_type="+typ+"&release="+OVERTURE_MIRROR_RELEASE)}));
    const seen=new Set<string>();
    for(const s of settled){
      if(s.status==="rejected"){errors.push(s.reason instanceof Error?s.reason.message:String(s.reason));continue}
      for(const f of Array.isArray(s.value?.features)?s.value.features:[]){
        const p=f?.properties??{},ctr=geoCenter(f);if(!ctr||!Number.isFinite(ctr[0])||!Number.isFinite(ctr[1]))continue;
        const d=hav(lat,lon,ctr[0],ctr[1]);if(d>r)continue;
        const id=String(p.id??f.id??(typ+":"+ctr.join(",")));if(seen.has(id))continue;seen.add(id);
        const nm=p?.names?.primary??null;
        const cls=String(p?.class??p?.basic_category??p?.taxonomy?.primary??"");
        const sub=String(p?.subtype??typ);
        if(!nm&&!cls)continue;
        out.push({source:"Overture",source_id:id,category:typ==="infrastructure"?"infrastructure":"place",subcategory:cls||sub,name:(nm??(cls||sub)),distance_m:Math.round(d),latitude:ctr[0],longitude:ctr[1]});
      }
    }
  }
  out.sort((a,b)=>a.distance_m-b.distance_m);
  return{status:errors.length?"partial":"active",mirror_release:OVERTURE_MIRROR_RELEASE,official_latest:OVERTURE_OFFICIAL_LATEST,mirror_lag:true,features:out.slice(0,20),errors:errors.slice(0,5)};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false,error:"missing env"},500);
  const bearer=req.headers.get("authorization")??"",cron=req.headers.get("x-cron-secret")??"";
  const sb=createClient(url,key,{auth:{persistSession:false}});
  let authorized=bearer==="Bearer "+key;
  if(!authorized&&cron){const {data}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cron});authorized=data===true}
  if(!authorized)return json({ok:false,error:"unauthorized"},401);

  const body:any=await req.json().catch(()=>({}));
  let lat=Number(body.lat),lon=Number(body.lon),eventId=String(body.event_id??"").trim();
  const radius=clampRadius(body.radius_m);
  if(eventId){
    const {data:e,error}=await sb.rpc("firewatch_resolve_event_point",{p_query:eventId});
    if(error)throw error;if(!e)return json({ok:false,error:"event not found"},404);
    eventId=String(e.id);lat=Number(e.latitude);lon=Number(e.longitude);
  }
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:"invalid coordinates"},400);
  const keyQ=qkey(lat,lon,radius);
  const {data:prevCache}=await sb.from("area_intel_cache").select("*").eq("query_key",keyQ).maybeSingle();
  if(!body.refresh){
    const cached=prevCache;
    const age=Date.now()-Date.parse(String(cached?.queried_at??""));
    if(cached&&Number.isFinite(age)&&age<CACHE_MS){
      const {data:er}=await sb.rpc("firewatch_area_entities",{p_lat:lat,p_lon:lon,p_radius_m:radius});
      return json({ok:true,cached:true,event_id:eventId||null,...cached,entity_resolution:er??null});
    }
  }

  const errors:string[]=[];let osm:any=null,build:any={status:"not_checked"};let overture:any={status:"unavailable",features:[]};let wikidata:any={status:"unavailable",features:[]};
  try{osm=await postpass(postpassSql(lat,lon,radius))}
  catch(e){errors.push("OSM/Postpass: "+(e instanceof Error?e.message:String(e)))}
  try{
    const b=await postpass(buildingSql(lat,lon,radius));
    const bf=Array.isArray(b?.features)?(b.features[0]?.properties??{}):{};
    build={status:"active",source:"OpenStreetMap/Postpass",building_count:Number(bf.building_count??0),named_count:Number(bf.named_count??0),nonresidential_tagged_count:Number(bf.nonresidential_tagged_count??0)};
  }catch(e){build={status:"error"};errors.push("OSM buildings: "+(e instanceof Error?e.message:String(e)))}
  try{overture=await overtureContext(lat,lon,radius)}catch(e){errors.push("Overture: "+(e instanceof Error?e.message:String(e)))}
  try{wikidata=await wikidataContext(lat,lon,radius)}catch(e){wikidata={status:"error",features:[]};errors.push("Wikidata: "+(e instanceof Error?e.message:String(e)))}

  const features:any[]=[];
  for(const row of Array.isArray(osm?.features)?osm.features:[]){
    const p=row?.properties??{},t=p.tags??{},cat=category(t);if(!cat)continue;
    const coords=row?.geometry?.type==="Point"?row.geometry.coordinates:null;if(!Array.isArray(coords))continue;
    const flon=Number(coords[0]),flat=Number(coords[1]);if(!Number.isFinite(flat)||!Number.isFinite(flon))continue;
    const d=Math.round(Number(p.distance_m??hav(lat,lon,flat,flon)));if(d>radius)continue;
    features.push({source:"OpenStreetMap",source_id:String(p.osm_type??"")+":"+String(p.osm_id??""),category:cat[0],subcategory:cat[1],name:labelName(t,cat[0]),distance_m:d,latitude:flat,longitude:flon,geometry_type:row?.geometry?.type??null,tags:safeTags(t)});
  }
  features.sort((a,b)=>a.distance_m-b.distance_m);
  const dedup=new Map<string,any>();for(const f of features){if(!dedup.has(f.source_id))dedup.set(f.source_id,f)}
  const all=[...dedup.values()];
  const counts:any={};for(const f of all)counts[f.category]=(counts[f.category]??0)+1;
  const nearest:any={};for(const f of all)if(!nearest[f.category])nearest[f.category]={name:f.name,subcategory:f.subcategory,distance_m:f.distance_m,source:f.source,source_id:f.source_id};
  const per=new Map<string,number>(),retained:any[]=[];
  for(const f of all){const n=per.get(f.category)??0;if(n>=8)continue;per.set(f.category,n+1);retained.push(f);if(retained.length>=80)break}

  const status=errors.some(x=>x.startsWith("OSM"))?"degraded":"active";
  const sourceStatus={osm_postpass:osm?"active":"error",overture:overture.status,overture_mirror_release:overture.mirror_release,overture_official_latest:overture.official_latest,overture_mirror_lag:overture.mirror_lag,wikidata:wikidata.status,wikidata_transport:wikidata.transport??"wikimedia_geosearch",wikidata_count:Array.isArray(wikidata.features)?wikidata.features.length:0};
  const baseSummary={total_features:all.length,by_category:counts,overture_context_features:Array.isArray(overture.features)?overture.features.length:0,overture_features:Array.isArray(overture.features)?overture.features:[],wikidata_context_features:Array.isArray(wikidata.features)?wikidata.features.length:0};
  const queriedAt=new Date().toISOString();
  const {error:ue}=await sb.from("area_intel_cache").upsert({query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,queried_at:queriedAt,status,osm_base_at:osm?.osm3s?.timestamp_osm_base??null,source_status:sourceStatus,summary:baseSummary,features:retained,buildings:build,nearest,errors,updated_at:queriedAt},{onConflict:"query_key"});
  if(ue)throw ue;
  let entitySummary:any={status:"not_run"};
  const canReuseWd=wikidata.status==="error"&&Number(prevCache?.entity_summary?.wikidata_entities??0)>0;
  if(canReuseWd){
    entitySummary={...prevCache.entity_summary,status:"active",wikidata_refresh:"degraded_cached"};
    sourceStatus.wikidata="degraded_cached";
    await sb.from("area_intel_cache").update({entity_summary:entitySummary,source_status:sourceStatus,errors,updated_at:new Date().toISOString()}).eq("query_key",keyQ);
  }else{
    try{
      const resolved=resolveEntities(retained,Array.isArray(overture.features)?overture.features:[],Array.isArray(wikidata.features)?wikidata.features:[]);
      entitySummary=await persistResolution(sb,keyQ,resolved);
      entitySummary={status:"active",...entitySummary};
      await sb.from("area_intel_cache").update({entity_summary:entitySummary,source_status:sourceStatus,updated_at:new Date().toISOString()}).eq("query_key",keyQ);
    }catch(e){entitySummary={status:"error",error:e instanceof Error?e.message:String(e)};errors.push("Entity resolution: "+entitySummary.error);await sb.from("area_intel_cache").update({entity_summary:entitySummary,errors,updated_at:new Date().toISOString()}).eq("query_key",keyQ)}
  }
  const {data:entityResolution}=await sb.rpc("firewatch_area_entities",{p_lat:lat,p_lon:lon,p_radius_m:radius});
  const result={query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,queried_at:queriedAt,status,
    osm_base_at:osm?.osm3s?.timestamp_osm_base??null,source_status:sourceStatus,
    summary:baseSummary,features:retained,buildings:build,nearest,errors,entity_summary:entitySummary,entity_resolution:entityResolution};
  return json({ok:true,cached:false,event_id:eventId||null,...result,policy:"Descriptive area context only. Entity resolution is non-destructive; ambiguous same_as candidates remain proposals."});
});