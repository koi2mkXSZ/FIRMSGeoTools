import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const EVENT_LIMIT=4;
const CACHE_MS=14*24*3600_000;
const TIMEOUT_MS=8000;
const PANORAMAX=[
  {name:"panoramax.xyz",base:"https://api.panoramax.xyz/api"},
  {name:"panoramax.openstreetmap.fr",base:"https://panoramax.openstreetmap.fr/api"}
];
const OAM="https://api.imagery.hotosm.org/stac/search";

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){
  const R=6371000,r=(x:number)=>x*Math.PI/180;
  const a=Math.sin(r(lat2-lat1)/2)**2+Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(r(lon2-lon1)/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
async function fetchJson(url:string){
  const r=await fetch(url,{headers:{"accept":"application/geo+json, application/json","user-agent":"GeoWatch-Visual/1.0"},signal:AbortSignal.timeout(TIMEOUT_MS)});
  const t=await r.text();
  if(!r.ok)throw new Error("HTTP "+r.status+" "+t.slice(0,180));
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,160))}
}
function pickLink(x:any,rel:string){
  return (Array.isArray(x?.links)?x.links:[]).find((l:any)=>l?.rel===rel)?.href??null;
}
function pickThumb(x:any){
  return x?.assets?.thumbnail?.href??x?.properties?.["geovisio:thumbnail"]??pickLink(x,"thumbnail")??null;
}
async function panoramax(lat:number,lon:number){
  const d=0.008;
  const urls=PANORAMAX.map(x=>({name:x.name,url:x.base+"/search?bbox="+[lon-d,lat-d,lon+d,lat+d].join(",")+"&limit=20"}));
  const settled=await Promise.allSettled(urls.map(x=>fetchJson(x.url)));
  const items:any[]=[],errors:string[]=[];
  for(let i=0;i<settled.length;i++){
    const r=settled[i],inst=urls[i].name;
    if(r.status==="rejected"){errors.push(inst+": "+(r.reason instanceof Error?r.reason.message:String(r.reason)));continue}
    for(const f of Array.isArray(r.value?.features)?r.value.features:[]){
      const c=f?.geometry?.coordinates;if(!Array.isArray(c)||c.length<2)continue;
      const plat=Number(c[1]),plon=Number(c[0]);if(!Number.isFinite(plat)||!Number.isFinite(plon))continue;
      items.push({
        instance:inst,
        item_id:f?.id??null,
        collection_id:f?.collection??null,
        datetime:f?.properties?.datetime??f?.properties?.datetimetz??null,
        distance_m:Math.round(hav(lat,lon,plat,plon)),
        lat:plat,lon:plon,
        producer:f?.properties?.["geovisio:producer"]??null,
        horizontal_accuracy_m:f?.properties?.["quality:horizontal_accuracy"]??null,
        thumbnail:pickThumb(f),
        self_url:pickLink(f,"self")
      });
    }
  }
  items.sort((a,b)=>a.distance_m-b.distance_m);
  return {items:items.slice(0,12),errors,instances_ok:settled.filter(x=>x.status==="fulfilled").length};
}
async function oam(lat:number,lon:number){
  const d=0.03,u=new URL(OAM);
  u.searchParams.set("collections","openaerialmap");
  u.searchParams.set("bbox",[lon-d,lat-d,lon+d,lat+d].join(","));
  u.searchParams.set("limit","15");
  const j=await fetchJson(u.toString());
  const items=(Array.isArray(j?.features)?j.features:[]).map((f:any)=>{
    const p=f?.properties??{},b=Array.isArray(f?.bbox)?f.bbox:null;
    return {
      item_id:f?.id??null,
      datetime:p.datetime??p.start_datetime??null,
      platform:p.platform??null,
      gsd:p.gsd??null,
      provider:p.provider??p.providers??null,
      bbox:b,
      contains_event:b&&b.length>=4?lon>=Number(b[0])&&lon<=Number(b[2])&&lat>=Number(b[1])&&lat<=Number(b[3]):null,
      thumbnail:f?.assets?.thumbnail?.href??null,
      image_href:f?.assets?.image?.href??null,
      self_url:pickLink(f,"self")
    };
  });
  items.sort((a:any,b:any)=>Date.parse(String(b.datetime??0))-Date.parse(String(a.datetime??0)));
  return items.slice(0,12);
}
function backoffMin(n:number){return Math.min(720,30*Math.pow(2,Math.max(0,n-1)))}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const since=new Date(Date.now()-72*3600_000).toISOString();
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,priority_score")
    .gte("last_seen",since).order("priority_score",{ascending:false,nullsFirst:false}).order("last_seen",{ascending:false}).limit(30);
  if(ee)throw ee;
  const ids=(events??[]).map((x:any)=>x.id);
  let cache:any[]=[];
  if(ids.length){const q=await sb.from("event_visual_context").select("fire_event_id,queried_at,next_retry_at,failure_count").in("fire_event_id",ids);if(q.error)throw q.error;cache=q.data??[]}
  const cm=new Map(cache.map((x:any)=>[String(x.fire_event_id),x]));

  let checked=0,skipped=0,active=0,degraded=0,failed=0,panoCount=0,oamCount=0;
  const warnings:string[]=[];
  for(const e of events??[]){
    if(checked>=EVENT_LIMIT)break;
    const old:any=cm.get(String(e.id)),qa=Date.parse(String(old?.queried_at??"")),nr=Date.parse(String(old?.next_retry_at??""));
    if(Number.isFinite(nr)&&nr>Date.now()){skipped++;continue}
    if(Number.isFinite(qa)&&Date.now()-qa<CACHE_MS){skipped++;continue}
    const lat=Number(e.best_latitude??e.last_latitude),lon=Number(e.best_longitude??e.last_longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){skipped++;continue}
    checked++;
    let panoStatus="active",oamStatus="active",panoItems:any[]=[],oamItems:any[]=[],errs:string[]=[];
    try{const p=await panoramax(lat,lon);panoItems=p.items;if(p.errors.length){panoStatus=p.instances_ok>0?"partial":"error";errs.push(...p.errors)}}catch(err){panoStatus="error";errs.push("Panoramax: "+(err instanceof Error?err.message:String(err)))}
    try{oamItems=await oam(lat,lon)}catch(err){oamStatus="error";errs.push("OAM: "+(err instanceof Error?err.message:String(err)))}

    const totalFailure=panoStatus==="error"&&oamStatus==="error";
    const failureCount=totalFailure?Number(old?.failure_count??0)+1:0;
    const nextRetry=totalFailure?new Date(Date.now()+backoffMin(failureCount)*60000).toISOString():null;
    const status=totalFailure?"error":(panoStatus==="error"||oamStatus==="error")?"degraded":"active";
    if(status==="active")active++;else if(status==="degraded")degraded++;else failed++;
    panoCount+=panoItems.length;oamCount+=oamItems.length;
    const dates=oamItems.map((x:any)=>Date.parse(String(x.datetime??""))).filter(Number.isFinite);
    const up=await sb.from("event_visual_context").upsert({
      fire_event_id:e.id,queried_at:new Date().toISOString(),status,
      panoramax_status:panoStatus,panoramax_items:panoItems,
      panoramax_nearest_distance_m:panoItems.length?Number(panoItems[0].distance_m):null,
      oam_status:oamStatus,oam_items:oamItems,
      oam_latest_datetime:dates.length?new Date(Math.max(...dates)).toISOString():null,
      errors:errs,failure_count:failureCount,next_retry_at:nextRetry,updated_at:new Date().toISOString()
    });
    if(up.error)throw up.error;
    warnings.push(...errs.slice(0,3));
  }

  const state={status:failed>0&&active===0&&degraded===0?"error":degraded>0||failed>0?"degraded":"active",last_check:new Date().toISOString(),checked,skipped,active,degraded,failed,panoramax_items:panoCount,oam_items:oamCount,cache_days:14,warnings:warnings.slice(-10)};
  await sb.from("system_state").upsert({key:"monitor_visual_context",value:state,updated_at:new Date().toISOString()});
  return json({ok:state.status!=="error",state},state.status==="error"?502:200);
});