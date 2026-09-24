import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const GDACS="https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
const EONET="https://eonet.gsfc.nasa.gov/api/v3/events";
const CEMS="https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/";
const UK={minLon:21.5,maxLon:41.5,minLat:43.5,maxLat:53.5};
const LOOKBACK_DAYS=7;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function isoDay(d:Date){return d.toISOString().slice(0,10)}
function safeDate(v:unknown){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString():null}
function inBbox(lat:number,lon:number){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=UK.minLat&&lat<=UK.maxLat&&lon>=UK.minLon&&lon<=UK.maxLon}
async function getJson(url:string){
  const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"GeoWatch-OSINT/1.0 (@NASA_FIRMS)"},signal:AbortSignal.timeout(25000)});
  const t=await r.text();
  if(!r.ok)throw new Error(`${r.status} ${t.slice(0,240)}`);
  if(!t.trim())return {};
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,160))}
}
function coordPairs(x:any,out:number[][]=[]):number[][]{
  if(!Array.isArray(x))return out;
  if(x.length>=2&&typeof x[0]==="number"&&typeof x[1]==="number"){out.push([Number(x[0]),Number(x[1])]);return out}
  for(const y of x)coordPairs(y,out);
  return out;
}
function geometryCenter(g:any){
  if(!g)return null;
  if(g.type==="Point"&&Array.isArray(g.coordinates)){const lon=Number(g.coordinates[0]),lat=Number(g.coordinates[1]);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null}
  const pts=coordPairs(g.coordinates);
  if(!pts.length)return null;
  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  for(const [lon,lat] of pts){if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat)}
  if(!Number.isFinite(minLon))return null;
  return{lat:(minLat+maxLat)/2,lon:(minLon+maxLon)/2};
}
function wktPoint(v:unknown){
  const m=String(v??"").match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if(!m)return null;
  const lon=Number(m[1]),lat=Number(m[2]);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
}
function countriesText(v:any){
  if(!Array.isArray(v))return String(v??"");
  return v.map((x:any)=>typeof x==="string"?x:String(x?.name??"")).filter(Boolean).join(", ");
}
async function upsert(sb:any,e:any){
  const {data,error}=await sb.rpc("upsert_osint_evidence",{
    p_source:e.source,p_source_event_id:e.source_event_id,p_observed_at:e.observed_at,
    p_lat:e.lat,p_lon:e.lon,p_title:e.title,p_category:e.category??null,
    p_source_url:e.source_url??null,p_country_hint:e.country_hint??null,p_payload:e.payload??{}
  });
  if(error)throw error;

  let fusionLinks=0;
  try{
    const {data:docId,error:de}=await sb.rpc("upsert_osint_document",{
      p_source_key:e.source,
      p_external_id:e.source_event_id,
      p_published_at:e.observed_at,
      p_source_updated_at:null,
      p_title:e.title,
      p_summary:e.payload?.description??e.category??null,
      p_url:e.source_url??null,
      p_language:null,
      p_country_codes:e.country_hint&&/ukraine|ukr|україн/i.test(String(e.country_hint))?["UKR"]:[],
      p_lat:e.lat,p_lon:e.lon,p_payload:e.payload??{}
    });
    if(de)throw de;
    const {data:lr,error:le}=await sb.rpc("firewatch_link_osint_document",{p_document:docId});
    if(le)throw le;
    fusionLinks=Number(lr?.links??0);
  }catch(err){
    console.error("fusion mirror failed:",err instanceof Error?err.message:String(err));
  }

  return {...(data??{}),fusion_links:fusionLinks};
}

async function ingestGdacs(sb:any){
  const to=new Date(),from=new Date(Date.now()-LOOKBACK_DAYS*86400000);
  const u=new URL(GDACS);
  u.searchParams.set("eventlist","WF");
  u.searchParams.set("fromdate",isoDay(from));
  u.searchParams.set("todate",isoDay(to));
  u.searchParams.set("pageSize","100");
  u.searchParams.set("pageNumber","1");
  const d=await getJson(u.toString()),features=Array.isArray(d?.features)?d.features:[];
  let candidates=0,stored=0,inserted=0,matched=0,outside=0;
  for(const f of features){
    const c=geometryCenter(f?.geometry);if(!c||!inBbox(c.lat,c.lon))continue;
    const p=f?.properties??{},eventId=String(p.eventid??p.eventId??p.id??f.id??"").trim();
    if(!eventId)continue;
    const eventType=String(p.eventtype??p.eventType??"WF"),observed=safeDate(p.fromdate??p.fromDate??p.todate??p.toDate??p.date);
    if(!observed)continue;
    candidates++;
    const r=await upsert(sb,{
      source:"GDACS",source_event_id:`${eventType}:${eventId}`,observed_at:observed,
      lat:c.lat,lon:c.lon,title:String(p.name??p.eventname??p.title??`GDACS ${eventType} ${eventId}`),
      category:String(p.alertlevel??p.alertLevel??eventType),
      source_url:`https://www.gdacs.org/report.aspx?eventid=${encodeURIComponent(eventId)}&eventtype=${encodeURIComponent(eventType)}`,
      country_hint:String(p.country??p.countryname??""),
      payload:{eventtype:eventType,eventid:eventId,alertlevel:p.alertlevel??p.alertLevel??null,severity:p.severity??null}
    });
    if(r?.stored){stored++;if(r.inserted)inserted++;if(r.fire_event_id)matched++}else if(r?.outside_ukraine)outside++;
  }
  return{fetched:features.length,candidates,stored,inserted,matched,outside_ukraine:outside};
}

async function ingestEonet(sb:any){
  const u=new URL(EONET);
  u.searchParams.set("bbox",`${UK.minLon},${UK.maxLat},${UK.maxLon},${UK.minLat}`);
  u.searchParams.set("days",String(LOOKBACK_DAYS));
  u.searchParams.set("status","all");
  u.searchParams.set("limit","100");
  const d=await getJson(u.toString()),events=Array.isArray(d?.events)?d.events:[];
  let candidates=0,stored=0,inserted=0,matched=0,outside=0;
  for(const ev of events){
    const geoms=Array.isArray(ev?.geometry)?ev.geometry:[],g=geoms.map((x:any)=>({x,c:geometryCenter(x)})).filter((x:any)=>x.c&&safeDate(x.x?.date)).sort((a:any,b:any)=>Date.parse(String(b.x.date))-Date.parse(String(a.x.date)))[0];
    if(!g?.c)continue;
    const observed=safeDate(g.x.date);if(!observed)continue;
    const id=String(ev?.id??"").trim();if(!id)continue;
    candidates++;
    const cats=(ev?.categories??[]).map((x:any)=>String(x?.title??x?.id??"")).filter(Boolean).join(", ");
    const src=(ev?.sources??[]).map((x:any)=>x?.url).find(Boolean)??ev?.link??null;
    const r=await upsert(sb,{
      source:"NASA_EONET",source_event_id:id,observed_at:observed,lat:g.c.lat,lon:g.c.lon,
      title:String(ev?.title??id),category:cats||null,source_url:src,country_hint:null,
      payload:{closed:ev?.closed??null,description:ev?.description??null,categories:ev?.categories??[],sources:ev?.sources??[]}
    });
    if(r?.stored){stored++;if(r.inserted)inserted++;if(r.fire_event_id)matched++}else if(r?.outside_ukraine)outside++;
  }
  return{fetched:events.length,candidates,stored,inserted,matched,outside_ukraine:outside};
}

async function ingestCems(sb:any){
  const u=new URL(CEMS);u.searchParams.set("limit","100");u.searchParams.set("offset","0");
  const d=await getJson(u.toString()),rows=Array.isArray(d?.results)?d.results:[];
  let candidates=0,stored=0,inserted=0,matched=0,outside=0;
  const cutoff=Date.now()-LOOKBACK_DAYS*86400000;
  for(const x of rows){
    const countries=countriesText(x?.countries),c=wktPoint(x?.centroid),observed=safeDate(x?.eventTime??x?.activationTime);
    if(!c||!observed||Date.parse(observed)<cutoff)continue;
    if(!/ukraine|україн/i.test(countries)&&!inBbox(c.lat,c.lon))continue;
    const code=String(x?.code??"").trim();if(!code)continue;
    candidates++;
    const r=await upsert(sb,{
      source:"COPERNICUS_EMS",source_event_id:code,observed_at:observed,lat:c.lat,lon:c.lon,
      title:String(x?.name??code),category:String(x?.category??"Rapid Mapping"),
      source_url:`https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=${encodeURIComponent(code)}`,
      country_hint:countries,
      payload:{code,countries,eventTime:x?.eventTime??null,activationTime:x?.activationTime??null,category:x?.category??null,closed:x?.closed??null,gdacsId:x?.gdacsId??null,n_aois:x?.n_aois??null,n_products:x?.n_products??null,lastUpdate:x?.lastUpdate??null}
    });
    if(r?.stored){stored++;if(r.inserted)inserted++;if(r.fire_event_id)matched++}else if(r?.outside_ukraine)outside++;
  }
  return{fetched:rows.length,candidates,stored,inserted,matched,outside_ukraine:outside};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const started=new Date().toISOString(),results:any={},warnings:string[]=[];
  let success=0;
  for(const [name,fn] of [["gdacs",ingestGdacs],["eonet",ingestEonet],["cems",ingestCems]] as const){
    try{results[name]=await fn(sb);success++}
    catch(e){const msg=e instanceof Error?e.message:String(e);results[name]={error:msg};warnings.push(name+": "+msg)}
  }
  const totals=Object.values(results).reduce((a:any,x:any)=>({
    stored:a.stored+Number(x?.stored??0),inserted:a.inserted+Number(x?.inserted??0),
    matched:a.matched+Number(x?.matched??0),candidates:a.candidates+Number(x?.candidates??0)
  }),{stored:0,inserted:0,matched:0,candidates:0});
  const state={
    status:success===3?"active":success>0?"degraded":"error",
    source:"GDACS + NASA EONET + Copernicus EMS Rapid Mapping",
    last_success_run:success>0?new Date().toISOString():null,
    failed_at:success===0?new Date().toISOString():null,
    last_error:success===0?warnings.join(" | "):null,
    lookback_days:LOOKBACK_DAYS,sources:results,totals,warnings:warnings.slice(-20),
    correlation_rule:"nearest fire_event within 100 km and ±72 h; contextual only, not causal"
  };
  await sb.from("system_state").upsert({key:"monitor_osint",value:state,updated_at:new Date().toISOString()});
  return json({ok:success>0,started_at_utc:started,state},success>0?200:502);
});