
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

  const cutoff=new Date(started.getTime()-24*3600e3).toISOString();
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
    .gte("first_seen",cutoff).order("first_seen",{ascending:false}).limit(300);
  if(ee)return json({ok:false,error:ee.message},502);

  const eventIds=(events??[]).map((e:any)=>e.id);
  const {data:existing}=eventIds.length
    ?await sb.from("event_air_threat_context").select("*").in("fire_event_id",eventIds)
    :{data:[]} as any;
  const existingMap=new Map((existing??[]).map((x:any)=>[`${x.fire_event_id}|${x.track_id}`,x]));

  let historyInserted=0,matches=0,closestUpdated=0;
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

    const mt=Date.parse(m.source_time);
    for(const e of events??[]){
      const elat=num(e.best_latitude??e.last_latitude),elon=num(e.best_longitude??e.last_longitude);
      if(elat==null||elon==null)continue;
      const et=Date.parse(String(e.first_seen));
      if(!Number.isFinite(mt)||!Number.isFinite(et))continue;
      const offset=Math.round((mt-et)/1000);
      if(Math.abs(offset)>MAX_TIME_OFFSET_S)continue;
      const dist=havM(m.latitude,m.longitude,elat,elon);
      if(dist>MAX_DISTANCE_M)continue;
      matches++;
      const key=`${e.id}|${m.track_id}`,old=existingMap.get(key);
      if(old&&Number(old.nearest_distance_m)<=dist)continue;
      const row={
        fire_event_id:e.id,track_id:m.track_id,threat_type:m.threat_type,label:m.label,
        nearest_distance_m:Math.round(dist),nearest_at:m.source_time,event_time_reference:e.first_seen,
        time_offset_seconds:offset,heading_deg:m.heading_deg,group_count:m.group_count,
        confidence_0_100:m.confidence_0_100,place:m.place,description:m.description,
        source_name:"Neptun",source_url:"https://neptun.in.ua/",last_matched_at:startedIso,updated_at:startedIso
      };
      const {error:ue}=await sb.from("event_air_threat_context").upsert(row,{onConflict:"fire_event_id,track_id"});
      if(ue)warnings.push(`match ${String(e.id).slice(0,8)}: ${ue.message}`);
      else{closestUpdated++;existingMap.set(key,row)}
    }
  }

  const {error:staleErr}=await sb.from("neptun_tracks_current").delete().lt("last_seen_at",startedIso);
  if(staleErr)warnings.push("stale cleanup: "+staleErr.message);

  const affected=[...new Set((existingMap.size?[...existingMap.keys()].map(k=>k.split("|")[0]):[]))].slice(0,40);
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
    proximity_candidates:matches,closest_context_updates:closestUpdated,
    match_radius_km:MAX_DISTANCE_M/1000,time_window_hours:MAX_TIME_OFFSET_S/3600,
    warnings:warnings.slice(-20),
    policy:"Public Neptun air-threat tracks are contextual evidence only. Spatial/temporal proximity does not establish causation.",
    source:"https://neptun.in.ua/api/data"
  };
  await sb.from("system_state").upsert({key:"monitor_neptun",value:state,updated_at:startedIso});
  return json({ok:true,state});
});
