import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BASE="https://maps.effis.emergency.copernicus.eu/effis";
const EVENT_LIMIT=6, CACHE_MS=7200000, REQUEST_TIMEOUT_MS=8000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function day(v:unknown){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):new Date().toISOString().slice(0,10)}
function safeNum(v:unknown){const n=Number(String(v??"").replace(",",".").trim());return Number.isFinite(n)?n:null}
function htmlCell(html:string,label:string){
  const p=html.toLowerCase().indexOf(label.toLowerCase());
  if(p<0)return null;
  const s=html.slice(p,p+500),m=s.match(/<td>([^<]+)<\/td>/gi);
  if(!m||m.length<2)return null;
  return m[0].replace(/<\/?td>/gi,"").trim();
}
function featureCount(text:string){
  if(!text||/ServiceException/i.test(text))return 0;
  const a=text.match(/Feature\s+\d+\s*:/gi);if(a?.length)return a.length;
  const b=text.match(/<table\b/gi);return b?.length??0;
}
async function wmsFeatureInfo(layer:string,queryLayer:string,lat:number,lon:number,date:string,format="text/plain"){
  const d=0.04,u=new URL(BASE);
  const p:any={SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetFeatureInfo",LAYERS:layer,QUERY_LAYERS:queryLayer,STYLES:"",SRS:"EPSG:4326",BBOX:String(lon-d)+","+String(lat-d)+","+String(lon+d)+","+String(lat+d),WIDTH:"101",HEIGHT:"101",X:"50",Y:"50",INFO_FORMAT:format,FEATURE_COUNT:"20",TIME:date};
  for(const [k,v] of Object.entries(p))u.searchParams.set(k,String(v));
  const started=Date.now();
  const r=await fetch(u.toString(),{headers:{"accept":format,"user-agent":"GeoWatch-EFFIS/1.0"},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  const text=await r.text();
  if(!r.ok)throw new Error("EFFIS "+layer+": HTTP "+r.status+" "+text.slice(0,180));
  if(/ServiceException/i.test(text))throw new Error("EFFIS "+layer+": "+text.replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,220));
  return {text,ms:Date.now()-started};
}
function backoffMinutes(n:number){return Math.min(360,15*Math.pow(2,Math.max(0,n-1)))}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const {data:stateRow}=await sb.from("system_state").select("value").eq("key","monitor_effis").maybeSingle();
  const prev:any=stateRow?.value??{},circuitUntil=Date.parse(String(prev?.circuit_until??""));
  if(Number.isFinite(circuitUntil)&&circuitUntil>Date.now())return json({ok:true,skipped:"circuit_open",circuit_until:new Date(circuitUntil).toISOString(),state:prev});

  const since=new Date(Date.now()-86400000).toISOString();
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,priority_score")
    .gte("last_seen",since).order("priority_score",{ascending:false,nullsFirst:false}).order("last_seen",{ascending:false}).limit(EVENT_LIMIT);
  if(ee)throw ee;
  const ids=(events??[]).map((e:any)=>e.id);
  let caches:any[]=[];
  if(ids.length){const q=await sb.from("effis_event_cache").select("fire_event_id,queried_at,next_retry_at,failure_count").in("fire_event_id",ids);if(q.error)throw q.error;caches=q.data??[]}
  const cacheMap=new Map(caches.map((x:any)=>[String(x.fire_event_id),x]));

  let checked=0,skipped=0,success=0,failed=0,numericFwi=0,activeMatches=0,burntMatches=0;
  const errors:string[]=[];
  for(const e of events??[]){
    const lat=Number(e.best_latitude??e.last_latitude),lon=Number(e.best_longitude??e.last_longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){skipped++;continue}
    const old:any=cacheMap.get(String(e.id)),retryAt=Date.parse(String(old?.next_retry_at??"")),queriedAt=Date.parse(String(old?.queried_at??""));
    if(Number.isFinite(retryAt)&&retryAt>Date.now()){skipped++;continue}
    if(Number.isFinite(queriedAt)&&Date.now()-queriedAt<CACHE_MS){skipped++;continue}

    checked++;
    const date=day(e.last_seen),raw:any={date,lat,lon,layers:{},source:"Copernicus EFFIS/JRC"},errs:string[]=[];
    let fwi:number|null=null,danger:string|null=null,fwiStatus="unavailable",activeCount=0,burntCount=0;

    const settled=await Promise.allSettled([
      wmsFeatureInfo("mf010.fwi","mf010.query",lat,lon,date,"text/html"),
      wmsFeatureInfo("all.hs.query","all.hs.query",lat,lon,date,"text/plain"),
      wmsFeatureInfo("effis.nrt.ba.poly","effis.nrt.ba.poly",lat,lon,date,"text/plain")
    ]);

    const fq=settled[0];
    if(fq.status==="fulfilled"){
      const q=fq.value,fwiRaw=htmlCell(q.text,"Fire Weather Index (FWI)"),dangerRaw=htmlCell(q.text,"Danger Risk (DR)");
      fwi=safeNum(fwiRaw);danger=dangerRaw&&/\[[A-Z_]+\]/.test(dangerRaw)?null:dangerRaw;
      fwiStatus=fwi!=null?"numeric":(/\[FWI\]/i.test(q.text)?"template_placeholder":"no_numeric_value");
      raw.layers.fwi={status:fwiStatus,fwi_raw:fwiRaw,danger_risk:danger,elapsed_ms:q.ms};
      if(fwi!=null)numericFwi++;
    }else{const msg=fq.reason instanceof Error?fq.reason.message:String(fq.reason);errs.push(msg);raw.layers.fwi={status:"error",error:msg}}

    const aq=settled[1];
    if(aq.status==="fulfilled"){
      const q=aq.value;activeCount=featureCount(q.text);raw.layers.active_fire={count:activeCount,elapsed_ms:q.ms,preview:q.text.slice(0,1000)};if(activeCount>0)activeMatches++;
    }else{const msg=aq.reason instanceof Error?aq.reason.message:String(aq.reason);errs.push(msg);raw.layers.active_fire={status:"error",error:msg}}

    const bq=settled[2];
    if(bq.status==="fulfilled"){
      const q=bq.value;burntCount=featureCount(q.text);raw.layers.burnt_area={count:burntCount,elapsed_ms:q.ms,preview:q.text.slice(0,1000)};if(burntCount>0)burntMatches++;
    }else{const msg=bq.reason instanceof Error?bq.reason.message:String(bq.reason);errs.push(msg);raw.layers.burnt_area={status:"error",error:msg}}

    const totalFailure=errs.length>=3,failureCount=totalFailure?Number(old?.failure_count??0)+1:0;
    const nextRetry=totalFailure?new Date(Date.now()+backoffMinutes(failureCount)*60000).toISOString():null;
    const status=totalFailure?"error":errs.length?"degraded":"active";
    const up=await sb.from("effis_event_cache").upsert({
      fire_event_id:e.id,queried_at:new Date().toISOString(),status,fwi_value:fwi,danger_risk:danger,fwi_query_status:fwiStatus,
      active_fire_match:activeCount>0,active_fire_count:activeCount,burnt_area_match:burntCount>0,burnt_area_count:burntCount,
      raw,errors:errs,failure_count:failureCount,next_retry_at:nextRetry,updated_at:new Date().toISOString()
    });
    if(up.error)throw up.error;
    if(totalFailure){failed++;errors.push(...errs.slice(0,2))}else success++;
  }

  const consecutive=failed>0&&success===0?Number(prev?.consecutive_failed_cycles??0)+1:0;
  const circuit=consecutive>=3?new Date(Date.now()+3600000).toISOString():null;
  const state={status:failed>0&&success===0?"error":failed>0?"degraded":"active",last_check:new Date().toISOString(),last_success_run:success>0?new Date().toISOString():prev?.last_success_run??null,checked,skipped,success,failed,numeric_fwi:numericFwi,active_fire_matches:activeMatches,burnt_area_matches:burntMatches,consecutive_failed_cycles:consecutive,circuit_until:circuit,layers:{fwi:"mf010.fwi + mf010.query",active_fire:"all.hs.query",burnt_area:"effis.nrt.ba.poly"},notes:"Cached non-blocking enrichment. EFFIS active-fire/burnt-area products are derived satellite context and are not independent corroboration.",warnings:errors.slice(-10)};
  await sb.from("system_state").upsert({key:"monitor_effis",value:state,updated_at:new Date().toISOString()});
  return json({ok:state.status!=="error",state},state.status==="error"?502:200);
});