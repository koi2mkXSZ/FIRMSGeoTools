import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CACHE_MS=6*3600_000;
function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function clampRadius(v:any){const n=Math.round(Number(v??5000));return Math.max(250,Math.min(10000,Number.isFinite(n)?n:5000))}
function qkey(lat:number,lon:number,r:number){return lat.toFixed(5)+":"+lon.toFixed(5)+":"+r}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
async function callFn(base:string,key:string,slug:string,body:any,timeout=60000){
  const r=await fetch(base+"/functions/v1/"+slug,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+key},
    body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{throw new Error(slug+" invalid JSON")}
  if(!r.ok||d?.ok===false)throw new Error(slug+": "+String(d?.error??("HTTP "+r.status)));return d;
}
function topEntities(area:any){
  const xs:any[]=Array.isArray(area?.entity_resolution?.entities)?area.entity_resolution.entities:[];
  return [...xs].sort((a,b)=>Number(b.source_count??0)-Number(a.source_count??0)||Number(b.resolution_confidence??0)-Number(a.resolution_confidence??0))
    .slice(0,10).map(x=>({id:x.id,canonical_name:x.canonical_name,category:x.category,subcategory:x.subcategory,
      latitude:x.latitude,longitude:x.longitude,wikidata_qid:x.wikidata_qid,source_count:x.source_count,
      resolution_status:x.resolution_status,resolution_confidence:x.resolution_confidence,aliases:x.aliases,sources:x.sources}));
}
function coverage(sourceStatus:any,ghsl:any,osint:any,registry:any,profiles:any[]){
  const sources=[
    {key:"osm_postpass",status:sourceStatus?.osm_postpass??"unknown"},
    {key:"overture",status:sourceStatus?.overture??"unknown"},
    {key:"wikidata",status:sourceStatus?.wikidata??"unknown"},
    {key:"ghsl",status:ghsl?.ok?"active":"error"},
    {key:"local_osint",status:"active"},
    {key:"official_registry",status:"active"}
  ];
  const applicable=sources.filter(x=>!["radius_limited","not_applicable"].includes(String(x.status)));
  return {sources,active:applicable.filter(x=>x.status==="active").length,total:applicable.length,
    not_applicable:sources.filter(x=>["radius_limited","not_applicable"].includes(String(x.status))).map(x=>x.key),
    profiles_cached:profiles.length,osint_items:Number(osint?.count??0),registry_hits:Number(registry?.hit_count??0)};
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!base||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(base,key,{auth:{persistSession:false}});
  const bearer=req.headers.get("authorization")??"",cron=req.headers.get("x-cron-secret")??"";
  let authorized=bearer==="Bearer "+key;
  if(!authorized&&cron){const {data}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cron});authorized=data===true}
  if(!authorized)return json({ok:false,error:"unauthorized"},401);

  const body:any=await req.json().catch(()=>({}));
  let lat=Number(body.lat),lon=Number(body.lon),eventId=String(body.event_id??"").trim();
  const radius=clampRadius(body.radius_m);
  if(eventId){
    const {data:e,error}=await sb.rpc("firewatch_resolve_event_point",{p_query:eventId});if(error)throw error;if(!e)return json({ok:false,error:"event not found"},404);
    eventId=String(e.id);lat=Number(e.latitude);lon=Number(e.longitude);
  }
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:"invalid coordinates"},400);
  const keyQ=qkey(lat,lon,radius);
  const {data:cached}=await sb.from("area_osint_reports").select("*").eq("query_key",keyQ).maybeSingle();
  const age=Date.now()-Date.parse(String(cached?.generated_at??""));
  if(cached&&!body.refresh&&Number.isFinite(age)&&age<CACHE_MS)return json({ok:true,cached:true,event_id:eventId||null,...cached});

  const errors:string[]=[];let area:any=null,ghsl:any=null,osint:any={count:0,providers:[],items:[]},registry:any={hit_count:0,hits:[]};
  try{area=await callFn(base,key,"firewatch-area-intel",{lat,lon,radius_m:radius},65000)}catch(e){errors.push(errText(e))}
  try{ghsl=await callFn(base,key,"firewatch-ghsl",{mode:"probe",lat,lon},70000)}catch(e){errors.push(errText(e))}
  try{const {data,error}=await sb.rpc("firewatch_area_osint_nearby",{p_lat:lat,p_lon:lon,p_radius_m:radius,p_hours:Number(body.osint_hours??168),p_limit:30});if(error)throw error;osint=data??osint}catch(e){errors.push("area osint: "+errText(e))}

  const entities=topEntities(area);
  const enrichTargets=entities.filter(x=>Number(x.source_count??0)>1||x.wikidata_qid).slice(0,5);
  const profiles:any[]=[];
  await Promise.all(enrichTargets.map(async(e:any)=>{
    try{
      const p=await callFn(base,key,"firewatch-entity-profile",{query:String(e.wikidata_qid??e.id)},30000);
      profiles.push({entity_id:e.id,canonical_name:e.canonical_name,status:p.profile_status,profile:p.profile,source_status:p.source_status});
    }catch(x){errors.push("profile "+String(e.id).slice(0,8)+": "+errText(x))}
  }));
  await Promise.all(enrichTargets.slice(0,3).map(async(e:any)=>{
    try{await callFn(base,key,"firewatch-registry-fusion",{query:String(e.wikidata_qid??e.id)},35000)}
    catch(x){errors.push("registry "+String(e.id).slice(0,8)+": "+errText(x))}
  }));
  try{const {data,error}=await sb.rpc("firewatch_area_registry_summary",{p_query_key:keyQ});if(error)throw error;registry=data??registry}catch(e){errors.push("registry summary: "+errText(e))}

  const metrics=ghsl?.metrics??null;
  const sourceStatus={area:area?.status??"error",osm_postpass:area?.source_status?.osm_postpass??"unknown",
    overture:area?.source_status?.overture??"unknown",overture_mirror_lag:area?.source_status?.overture_mirror_lag??null,
    wikidata:area?.source_status?.wikidata??"unknown",ghsl:ghsl?.ok?"active":"error",local_osint:"active",official_registry:"active"};
  const report={
    center:{latitude:lat,longitude:lon,radius_m:radius,event_id:eventId||null},
    infrastructure:{summary:area?.summary??{},buildings:area?.buildings??{},nearest:area?.nearest??{},source_status:area?.source_status??{}},
    ghsl:metrics?{epoch:2025,resolution:"30 arcsec (~1 km)",population_1km:metrics.population_1km,population_5km:metrics.population_5km,population_10km:metrics.population_10km,
      built_fraction_1km_pct:metrics.built_fraction_1km_pct,built_fraction_5km_pct:metrics.built_fraction_5km_pct,built_fraction_10km_pct:metrics.built_fraction_10km_pct}:null,
    entities:{summary:area?.entity_summary??{},top:entities,profiles},
    official_registry:registry,
    osint:osint,
    coverage:coverage(sourceStatus,ghsl,osint,registry,profiles),
    policy:"Area report is descriptive public-source context. Spatial proximity or registry presence does not establish event causation, vulnerability, access or operational significance."
  };
  const status=errors.some(x=>x.startsWith("firewatch-area-intel"))?"degraded":"active",now=new Date().toISOString();
  const {error:up}=await sb.from("area_osint_reports").upsert({query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,generated_at:now,status,report,source_status:sourceStatus,errors,updated_at:now},{onConflict:"query_key"});
  if(up)throw new Error("report upsert: "+errText(up));
  return json({ok:true,cached:false,query_key:keyQ,latitude:lat,longitude:lon,radius_m:radius,event_id:eventId||null,generated_at:now,status,report,source_status:sourceStatus,errors});
});