
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const PROFILE="stage37.3-neptun-v1";
const API="https://neptun.in.ua/api/data";
const MAX_DISTANCE_M=50000;
const MAX_TIME_OFFSET_S=6*3600;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function num(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
function iso(v:any){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString():null}
function havM(a:number,b:number,c:number,d:number){
  const p=Math.PI/180,R=6371000,da=(c-a)*p,db=(d-b)*p;
  const x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(db/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
function meta(type:string,text:string){
  const s=(type+" "+text).toLowerCase();
  if(/shahed|бпла|дрон|\buav\b|герань|geran/.test(s))return"UAV / Shahed";
  if(/розвід|развед|recon/.test(s))return"Recon UAV";
  if(/баліст|балист|ballistic|iskander|іскандер|кинжал|кинджал|kinzhal/.test(s))return"Ballistic missile";
  if(/авіабомб|авиабомб|керована авіа|guided.*bomb|\bkab\b|\bкаб\b/.test(s))return"Guided bomb / KAB";
  if(/крилат|крылат|cruise|калібр|калибр|kalibr|ракет|raket|missile|kh-?\d|х-?\d/.test(s))return"Cruise missile";
  if(/зліт|взлет|launch|takeoff|міг|\bmig\b|ту-?95|tu-?95/.test(s))return"Launch / takeoff";
  return"Air threat";
}
async function sha(s:string){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const surl=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!surl||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(surl,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const started=new Date(),startedIso=started.toISOString(),warnings:string[]=[];
  let data:any;
  try{
    const r=await fetch(API,{headers:{"user-agent":"GeoWatch-Neptun/1.0","accept":"application/json"},signal:AbortSignal.timeout(15000)});
    const t=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,240)}`);
    data=JSON.parse(t);
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    const {data:prior}=await sb.from("system_state").select("value").eq("key","monitor_neptun").maybeSingle();
    const streak=Number(prior?.value?.consecutive_failures??0)+1;
    const state={status:streak>=3?"degraded":"warning",profile_version:PROFILE,last_check:startedIso,
      last_success_run:prior?.value?.last_success_run??null,consecutive_failures:streak,last_error:msg,
      dependency_rule:"Neptun is non-critical context enrichment; failures never block FIRMS ingestion or Telegram."};
    await sb.from("system_state").upsert({key:"monitor_neptun",value:state,updated_at:startedIso});
    return json({ok:false,state},502);
  }

  const markers:any[]=Array.isArray(data?.markers)?data.markers:Array.isArray(data?.tracks)?data.tracks:[];
  const normalized=markers.map((m:any)=>{
    const lat=num(m.lat),lon=num(m.lng??m.lon);
    if(lat==null||lon==null)return null;
    const id=String(m.id??m.track_id??`${lat.toFixed(5)},${lon.toFixed(5)}`);
    const sourceTime=iso(m.date)??startedIso;
    const type=String(m.threat_type??m.type??"unknown");
    const text=String(m.text??"");
    return {
      track_id:id,threat_type:type,label:meta(type,text),latitude:lat,longitude:lon,
      heading_deg:num(m.course_bearing??m.heading),group_count:num(m.count)==null?null:Math.max(1,Math.round(Number(m.count))),
      confidence_0_100:num(m.confidence_0_100??m.confidence),
      place:String(m.place??m.region??"")||null,description:text||null,source_time:sourceTime,
      trail:Array.isArray(m.positions)?m.positions.slice(-50):[],raw:m
    };
  }).filter(Boolean) as any[];

  let historyInserted=0;
  const refreshedIds:string[]=[];
  for(const m of normalized){
    const currentRow={...m,last_seen_at:startedIso,updated_at:startedIso};
    const {error:cu}=await sb.from("neptun_tracks_current").upsert(currentRow,{onConflict:"track_id"});
    if(cu){warnings.push(`current ${m.track_id}: ${cu.message}`);continue}
    refreshedIds.push(m.track_id);

    const snapKey=await sha(`${m.track_id}|${m.source_time}|${m.latitude.toFixed(5)}|${m.longitude.toFixed(5)}`);
    const {error:he}=await sb.from("neptun_track_history").upsert({
      snapshot_key:snapKey,track_id:m.track_id,sampled_at:startedIso,source_time:m.source_time,
      threat_type:m.threat_type,label:m.label,latitude:m.latitude,longitude:m.longitude,
      heading_deg:m.heading_deg,group_count:m.group_count,confidence_0_100:m.confidence_0_100,
      place:m.place,description:m.description,raw:m.raw
    },{onConflict:"snapshot_key",ignoreDuplicates:true});
    if(!he)historyInserted++; else warnings.push(`history ${m.track_id}: ${he.message}`);
  }

  const {error:staleErr}=await sb.from("neptun_tracks_current").delete().lt("last_seen_at",startedIso);
  if(staleErr)warnings.push("stale cleanup: "+staleErr.message);

  let correlation:any={ok:false,error:"not_run"};
  try{
    const {data:cr,error:ce}=await sb.rpc("firewatch_rebuild_neptun_context",{p_hours:24})
      .abortSignal(AbortSignal.timeout(20000));
    if(ce)throw ce;correlation=cr??{ok:true};
  }catch(e){
    correlation={ok:false,error:e instanceof Error?e.message:String(e)};
    warnings.push("correlation rebuild: "+correlation.error);
  }

  const {data:affectedRows}=await sb.from("event_air_threat_context")
    .select("fire_event_id")
    .gte("updated_at",startedIso)
    .limit(300);
  const affected=[...new Set((affectedRows??[]).map((x:any)=>String(x.fire_event_id)))].slice(0,40);
  for(let i=0;i<affected.length;i+=4){
    await Promise.allSettled(affected.slice(i,i+4).map((id:string)=>
      sb.rpc("firewatch_refresh_event_dossier",{p_event:id})
        .abortSignal(AbortSignal.timeout(3000))
    ));
  }

  const state={
    status:"active",profile_version:PROFILE,last_check:startedIso,last_success_run:startedIso,
    consecutive_failures:0,last_error:null,
    markers_received:markers.length,tracks_active:normalized.length,
    ballistic_threat:Boolean(data?.ballistic_threat),history_snapshots_attempted:normalized.length,
    history_snapshots_inserted:historyInserted,
    proximity_candidates:Number(correlation?.context_rows??0),closest_context_updates:Number(correlation?.event_count??0),
    context_before_or_at_firms:Number(correlation?.before_or_at_firms??0),context_after_firms:Number(correlation?.after_firms??0),
    match_radius_km:50,time_window_before_hours:6,time_window_after_minutes:30,correlation_mode:"historical_preferred",
    warnings:warnings.slice(-20),
    policy:"Public Neptun air-threat tracks are contextual evidence only. Historical snapshots are matched around FIRMS acquisition time; pre-FIRMS context is preferred. Spatial/temporal proximity does not establish causation.",
    source:"https://neptun.in.ua/api/data"
  };
  await sb.from("system_state").upsert({key:"monitor_neptun",value:state,updated_at:startedIso});
  return json({ok:true,state});
});
