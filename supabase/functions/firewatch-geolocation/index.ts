import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FUSED_BASE="https://www.fused.io/server/v1/realtime-shared/UDF_Overture_Maps_Example/run/tiles";
const OVERTURE_RELEASE="2026-04-15-0";
const ZOOM=16;
const EVENT_LIMIT=4;
const CACHE_MS=7*24*3600_000;
const REQUEST_TIMEOUT_MS=9000;
const RADIUS_M=1400;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function tileXY(lat:number,lon:number,z:number){
  const n=2**z;
  const x=Math.floor((lon+180)/360*n);
  const latRad=lat*Math.PI/180;
  const y=Math.floor((1-Math.asinh(Math.tan(latRad))/Math.PI)/2*n);
  return {x,y};
}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){
  const R=6371000,toRad=(d:number)=>d*Math.PI/180;
  const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lon2-lon1);
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
async function fetchJson(url:string){
  const r=await fetch(url,{headers:{"accept":"application/geo+json, application/json","user-agent":"GeoWatch-Geolocation/1.0"},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  const t=await r.text();
  if(!r.ok)throw new Error("HTTP "+r.status+" "+t.slice(0,220));
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,180))}
}
async function overturePlaces(lat:number,lon:number){
  const c=tileXY(lat,lon,ZOOM);
  const urls:string[]=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    urls.push(FUSED_BASE+"/"+ZOOM+"/"+(c.x+dx)+"/"+(c.y+dy)+"?dtype_out_vector=geojson&overture_type=place&release="+encodeURIComponent(OVERTURE_RELEASE));
  }
  const settled=await Promise.allSettled(urls.map(fetchJson));
  const seen=new Map<string,any>(),errs:string[]=[];
  for(const r of settled){
    if(r.status==="rejected"){errs.push(r.reason instanceof Error?r.reason.message:String(r.reason));continue}
    for(const f of Array.isArray(r.value?.features)?r.value.features:[]){
      const p=f?.properties??{},coords=f?.geometry?.coordinates;
      if(!Array.isArray(coords)||coords.length<2)continue;
      const plat=Number(coords[1]),plon=Number(coords[0]);
      if(!Number.isFinite(plat)||!Number.isFinite(plon))continue;
      const dist=hav(lat,lon,plat,plon);
      if(dist>RADIUS_M)continue;
      const id=String(p.id??f.id??(plon+","+plat));
      if(seen.has(id))continue;
      const sources=Array.isArray(p.sources)?[...new Set(p.sources.map((s:any)=>String(s?.dataset??"")).filter(Boolean))]:[];
      seen.set(id,{
        id,
        name:p?.names?.primary??null,
        category:p?.basic_category??p?.categories?.primary??null,
        confidence:Number.isFinite(Number(p.confidence))?Number(p.confidence):null,
        address:Array.isArray(p.addresses)?p.addresses[0]?.freeform??null:null,
        locality:Array.isArray(p.addresses)?p.addresses[0]?.locality??null:null,
        operating_status:p.operating_status??null,
        distance_m:Math.round(dist),
        lat:plat,lon:plon,
        datasets:sources
      });
    }
  }
  const places=[...seen.values()]
    .filter((x:any)=>x.name||x.category)
    .sort((a:any,b:any)=>a.distance_m-b.distance_m)
    .slice(0,15);
  return {places,errors:errs,tiles_ok:settled.filter(x=>x.status==="fulfilled").length,tiles_total:settled.length};
}
async function geonamesPlaces(lat:number,lon:number,username:string){
  const u=new URL("https://secure.geonames.org/findNearbyPlaceNameJSON");
  u.searchParams.set("lat",String(lat));u.searchParams.set("lng",String(lon));
  u.searchParams.set("radius","15");u.searchParams.set("maxRows","20");u.searchParams.set("username",username);
  const d=await fetchJson(u.toString());
  if(d?.status?.message)throw new Error("GeoNames: "+String(d.status.message));
  const arr=Array.isArray(d?.geonames)?d.geonames:[];
  return arr.map((x:any)=>({
    geoname_id:x.geonameId??null,
    name:x.name??null,
    toponym_name:x.toponymName??null,
    admin1:x.adminName1??null,
    country:x.countryName??null,
    feature_class:x.fcl??null,
    feature_code:x.fcode??null,
    population:Number(x.population??0),
    distance_km:Number(x.distance??NaN),
    lat:Number(x.lat),lon:Number(x.lng)
  })).filter((x:any)=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).slice(0,15);
}
function backoffMin(n:number){return Math.min(720,30*Math.pow(2,Math.max(0,n-1)))}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const geonamesUser=String(Deno.env.get("GEONAMES_USERNAME")??"").trim();
  let officialLatest:string|null=null;
  try{const stac=await fetchJson("https://stac.overturemaps.org/catalog.json");officialLatest=String(stac?.latest??"")||null}catch{}
  const since=new Date(Date.now()-48*3600_000).toISOString();
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,priority_score")
    .gte("last_seen",since)
    .order("priority_score",{ascending:false,nullsFirst:false})
    .order("last_seen",{ascending:false})
    .limit(24);
  if(ee)throw ee;

  const ids=(events??[]).map((e:any)=>e.id);
  let caches:any[]=[];
  if(ids.length){
    const q=await sb.from("event_geolocation_context").select("fire_event_id,queried_at,next_retry_at,failure_count").in("fire_event_id",ids);
    if(q.error)throw q.error;caches=q.data??[];
  }
  const cm=new Map(caches.map((x:any)=>[String(x.fire_event_id),x]));

  let checked=0,skipped=0,active=0,degraded=0,failed=0,overturePlacesCount=0,geonamesPlacesCount=0;
  const runErrors:string[]=[];

  for(const e of events??[]){
    if(checked>=EVENT_LIMIT)break;
    const old:any=cm.get(String(e.id));
    const qa=Date.parse(String(old?.queried_at??"")),nr=Date.parse(String(old?.next_retry_at??""));
    if(Number.isFinite(nr)&&nr>Date.now()){skipped++;continue}
    if(Number.isFinite(qa)&&Date.now()-qa<CACHE_MS){skipped++;continue}
    const lat=Number(e.best_latitude??e.last_latitude),lon=Number(e.best_longitude??e.last_longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){skipped++;continue}
    checked++;

    let overtureStatus="active",geoStatus=geonamesUser?"active":"waiting_username";
    let oPlaces:any[]=[],gPlaces:any[]=[],errs:string[]=[],tilesOk:number|null=null,tilesTotal:number|null=null;
    try{
      const o=await overturePlaces(lat,lon);oPlaces=o.places;tilesOk=o.tiles_ok;tilesTotal=o.tiles_total;
      if(o.errors.length){overtureStatus=o.tiles_ok>0?"partial":"error";errs.push(...o.errors.slice(0,3))}
    }catch(err){overtureStatus="error";errs.push("Overture: "+(err instanceof Error?err.message:String(err)))}
    if(geonamesUser){
      try{gPlaces=await geonamesPlaces(lat,lon,geonamesUser)}
      catch(err){geoStatus="error";errs.push(err instanceof Error?err.message:String(err))}
    }
    overturePlacesCount+=oPlaces.length;geonamesPlacesCount+=gPlaces.length;

    const totalFailure=overtureStatus==="error"&&(geoStatus==="error"||geoStatus==="waiting_username");
    const failureCount=totalFailure?Number(old?.failure_count??0)+1:0;
    const nextRetry=totalFailure?new Date(Date.now()+backoffMin(failureCount)*60000).toISOString():null;
    const status=totalFailure?"error":(geoStatus==="error")?"degraded":"active";
    if(status==="active")active++; else if(status==="degraded")degraded++; else failed++;

    const up=await sb.from("event_geolocation_context").upsert({
      fire_event_id:e.id,queried_at:new Date().toISOString(),status,
      overture_status:overtureStatus,overture_release:OVERTURE_RELEASE,overture_places:oPlaces,
      overture_nearest_distance_m:oPlaces.length?Number(oPlaces[0].distance_m):null,
      overture_tiles_ok:tilesOk,overture_tiles_total:tilesTotal,
      geonames_status:geoStatus,geonames_places:gPlaces,
      geonames_nearest_distance_m:gPlaces.length&&Number.isFinite(Number(gPlaces[0].distance_km))?Math.round(Number(gPlaces[0].distance_km)*1000):null,
      errors:errs,failure_count:failureCount,next_retry_at:nextRetry,updated_at:new Date().toISOString()
    });
    if(up.error)throw up.error;
    runErrors.push(...errs.slice(0,2));
  }

  const state={
    status:failed>0&&active===0&&degraded===0?"error":degraded>0||failed>0?"degraded":"active",
    last_check:new Date().toISOString(),
    checked,skipped,active,degraded,failed,
    overture_places:overturePlacesCount,geonames_places:geonamesPlacesCount,
    overture_release:OVERTURE_RELEASE,
    overture_official_latest:officialLatest,
    overture_mirror_lag:Boolean(officialLatest)&&String(officialLatest).replaceAll(".","-")!==OVERTURE_RELEASE,
    overture_transport:"Fused public UDF mirror",
    geonames_status:geonamesUser?"configured":"waiting_username",
    cache_days:7,
    warnings:runErrors.slice(-10)
  };
  await sb.from("system_state").upsert({key:"monitor_geolocation",value:state,updated_at:new Date().toISOString()});
  return json({ok:state.status!=="error",state},state.status==="error"?502:200);
});