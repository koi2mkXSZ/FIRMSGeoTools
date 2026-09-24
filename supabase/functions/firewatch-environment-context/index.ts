import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const LI_COLLECTION="EO:EUM:DAT:0691";
const RAINVIEWER_URL="https://api.rainviewer.com/public/weather-maps.json";
const LI_SEARCH="https://api.eumetsat.int/data/search-products/1.0.0/os";
const EVENT_HOURS=72;
const RADAR_MATCH_MIN=20;
const LI_MATCH_MIN=20;
const TIMEOUT_MS=12000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
async function fetchJson(url:string){
  const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"GeoWatch-Environment/1.0"},signal:AbortSignal.timeout(TIMEOUT_MS)});
  const t=await r.text();
  if(!r.ok)throw new Error("HTTP "+r.status+" "+t.slice(0,180));
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,180))}
}
function iso(v:any){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString():null}
function link(p:any,key:string){
  const x=p?.properties?.links?.[key];
  return Array.isArray(x)&&x.length?String(x[0]?.href??"")||null:null;
}
function productInterval(p:any){
  const d=String(p?.properties?.date??"").split("/");
  return {start:iso(d[0]),end:iso(d[1])};
}
function radarUrl(host:string,path:string,lat:number,lon:number){
  return host+path+"/256/7/"+lat.toFixed(5)+"/"+lon.toFixed(5)+"/2/1_1.png";
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const warnings:string[]=[];
  let rvFrames=0;
  let radarFeedStatus="active";

  try{
    const rv=await fetchJson(RAINVIEWER_URL);
    const host=String(rv?.host??"");
    const generated=Number(rv?.generated);
    const rows=(Array.isArray(rv?.radar?.past)?rv.radar.past:[])
      .map((x:any)=>({frame_time:new Date(Number(x.time)*1000).toISOString(),generated_at:Number.isFinite(generated)?new Date(generated*1000).toISOString():null,host,path:String(x.path??""),last_seen_at:new Date().toISOString()}))
      .filter((x:any)=>x.host&&x.path&&x.frame_time);
    if(rows.length){
      const q=await sb.from("rainviewer_frames").upsert(rows,{onConflict:"frame_time"});
      if(q.error)throw q.error;
      rvFrames=rows.length;
    }
  }catch(e){radarFeedStatus="error";warnings.push("RainViewer: "+(e instanceof Error?e.message:String(e)))}

  // EUMETSAT MTG LI intentionally disabled by project decision (2026-09-24).
  // Historical product metadata is preserved in the database for audit, but no new EUMETSAT requests are made.

  await sb.from("rainviewer_frames").delete().lt("frame_time",new Date(Date.now()-14*86400_000).toISOString());
  await sb.from("eumetsat_li_products").delete().lt("sensing_end",new Date(Date.now()-14*86400_000).toISOString());

  const [{data:events,error:ee},{data:frames,error:fe},{data:products,error:pe}]=await Promise.all([
    sb.from("fire_events").select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,priority_score").gte("first_seen",new Date(Date.now()-EVENT_HOURS*3600_000).toISOString()).order("priority_score",{ascending:false,nullsFirst:false}).order("first_seen",{ascending:false}).limit(60),
    sb.from("rainviewer_frames").select("frame_time,host,path").gte("frame_time",new Date(Date.now()-14*86400_000).toISOString()).order("frame_time")
  ]);
  if(ee)throw ee;if(fe)throw fe;

  const frameRows=frames??[];
  const earliestFrame=frameRows.length?Date.parse(String(frameRows[0].frame_time)):NaN;
  let contexts=0,radarMatched=0;

  for(const e of events??[]){
    const t=Date.parse(String(e.first_seen));if(!Number.isFinite(t))continue;
    const lat=Number(e.best_latitude??e.last_latitude),lon=Number(e.best_longitude??e.last_longitude);
    let nearest:any=null,best=Infinity;
    for(const f of frameRows){
      const ft=Date.parse(String(f.frame_time)),d=Math.abs(ft-t)/60000;
      if(Number.isFinite(d)&&d<best){best=d;nearest=f}
    }
    let radarStatus="no_nearby_frame",tile:string|null=null,frameTime:string|null=null,delta:number|null=null;
    if(Number.isFinite(earliestFrame)&&t<earliestFrame-RADAR_MATCH_MIN*60000)radarStatus="history_unavailable";
    else if(nearest&&best<=RADAR_MATCH_MIN){
      radarStatus="frame_available";frameTime=nearest.frame_time;delta=Math.round(best*10)/10;
      if(Number.isFinite(lat)&&Number.isFinite(lon))tile=radarUrl(String(nearest.host),String(nearest.path),lat,lon);
      radarMatched++;
    }
    const lightningStatus="disabled";

    const q=await sb.from("event_environment_context").upsert({
      fire_event_id:e.id,queried_at:new Date().toISOString(),
      radar_status:radarStatus,radar_frame_time:frameTime,radar_time_delta_minutes:delta,radar_tile_url:tile,
      lightning_status:lightningStatus,lightning_product_count:0,
      lightning_products:[],
      lightning_local_signal:"disabled",errors:[],updated_at:new Date().toISOString()
    },{onConflict:"fire_event_id"});
    if(q.error)throw q.error;contexts++;
  }

  const state={
    status:radarFeedStatus==="error"?"error":"active",
    last_check:new Date().toISOString(),
    rainviewer:{status:radarFeedStatus,frames_seen:rvFrames,archive_frames:frameRows.length,history_hours:2},
    eumetsat_li:{status:"disabled",reason:"project_decision",polling:false},
    event_contexts:contexts,events_with_radar_frame:radarMatched,events_with_li_coverage:0,
    warnings:warnings.slice(-12)
  };
  await sb.from("system_state").upsert({key:"monitor_environment_context",value:state,updated_at:new Date().toISOString()});
  return json({ok:state.status!=="error",state},state.status==="error"?502:200);
});