import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const POSTPASS="https://postpass.geofabrik.de/api/interpreter";
const FUSED="https://www.fused.io/server/v1/realtime-shared/UDF_Overture_Maps_Example/run/tiles";
const OVERTURE_MIRROR_RELEASE="2026-04-15-0";
const OVERTURE_OFFICIAL_LATEST="2026-09-23.0";
const TIMEOUT_MS=25000;
const CACHE_MS=12*3600_000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
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
  if(!body.refresh){
    const {data:cached}=await sb.from("area_intel_cache").select("*").eq("query_key",keyQ).maybeSingle();
    const age=Date.now()-Date.parse(String(cached?.queried_at??""));
    if(cached&&Number.isFinite(age)&&age<CACHE_MS)return json({ok:true,cached:true,event_id:eventId||null,...cached});
  }

  const errors:string[]=[];let osm:any=null,build:any={status:"not_checked"};let overture:any={status:"unavailable",features:[]};
  try{osm=await postpass(postpassSql(lat,lon,radius))}
  catch(e){errors.push("OSM/Postpass: "+(e instanceof Error?e.message:String(e)))}
  try{
    const b=await postpass(buildingSql(lat,lon,radius));
    const bf=Array.isArray(b?.features)?(b.features[0]?.properties??{}):{};
    build={status:"active",source:"OpenStreetMap/Postpass",building_count:Number(bf.building_count??0),named_count:Number(bf.named_count??0),nonresidential_tagged_count:Number(bf.nonresidential_tagged_count??0)};
  }catch(e){build={status:"error"};errors.push("OSM buildings: "+(e instanceof Error?e.message:String(e)))}
  try{overture=await overtureContext(lat,lon,radius)}catch(e){errors.push("Overture: "+(e instanceof Error?e.message:String(e)))}

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
  const result={query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,queried_at:new Date().toISOString(),status,
    osm_base_at:osm?.osm3s?.timestamp_osm_base??null,
    source_status:{osm_postpass:osm?"active":"error",overture:overture.status,overture_mirror_release:overture.mirror_release,overture_official_latest:overture.official_latest,overture_mirror_lag:overture.mirror_lag},
    summary:{total_features:all.length,by_category:counts,overture_context_features:Array.isArray(overture.features)?overture.features.length:0,overture_features:Array.isArray(overture.features)?overture.features:[]},
    features:retained,buildings:build,nearest,errors
  };
  const {error:ue}=await sb.from("area_intel_cache").upsert({query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,queried_at:result.queried_at,status,osm_base_at:result.osm_base_at,source_status:result.source_status,summary:result.summary,features:retained,buildings:build,nearest,errors,updated_at:new Date().toISOString()},{onConflict:"query_key"});
  if(ue)throw ue;
  return json({ok:true,cached:false,event_id:eventId||null,...result,policy:"Descriptive area context only; no vulnerability, target-value, access-route or suitability scoring."});
});