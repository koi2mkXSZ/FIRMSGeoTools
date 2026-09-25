import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "@supabase/supabase-js";
import {buildTemporalProfile,type TemporalItem} from "./temporal_engine.ts";

const PROFILE="stage43.5-temporal-v1";
function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function num(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
async function hash(v:unknown){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(v)));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function push(items:TemporalItem[],x:TemporalItem|null){if(x?.source_time)items.push(x)}
function topByTime<T extends Record<string,any>>(rows:T[],ref:number,timeKey:string,limit:number){
  return rows.slice().sort((a,b)=>Math.abs(Date.parse(String(a[timeKey]??""))-ref)-Math.abs(Date.parse(String(b[timeKey]??""))-ref)).slice(0,limit);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{}
  const hours=Math.max(1,Math.min(168,Math.round(Number(body.hours??168))));
  const limit=Math.max(1,Math.min(500,Math.round(Number(body.limit??250))));
  const eventId=String(body.event_id??"").trim();

  try{
    let q=sb.from("fire_events").select("id,first_seen,last_seen,created_at,cams_observed_at,s5p_co_observed_at,s5p_aer_observed_at,atmosphere_signal_level,priority_score");
    if(eventId)q=q.eq("id",eventId);
    else q=q.gte("first_seen",new Date(Date.now()-hours*3600_000).toISOString()).order("priority_score",{ascending:false,nullsFirst:false}).order("first_seen",{ascending:false}).limit(limit);
    const {data:events,error:ee}=await q;if(ee)throw ee;
    const ids=(events??[]).map((x:any)=>x.id);
    if(!ids.length)return json({ok:true,profile:PROFILE,processed:0,changed:0});

    const [det,nep,osint,sem,env,surf,eum,old]=await Promise.all([
      sb.from("detections").select("event_id,source,satellite,instrument,acq_datetime,received_at,confidence,frp").in("event_id",ids).order("acq_datetime"),
      sb.from("event_air_threat_context").select("fire_event_id,track_id,threat_type,label,nearest_at,time_offset_seconds,confidence_0_100,place,source_name,updated_at").in("fire_event_id",ids).eq("source_name","Neptun"),
      sb.from("event_public_osint").select("fire_event_id,source_kind,source_name,source_item_id,published_at,title,relevance_score,first_seen_at,category").in("fire_event_id",ids).not("published_at","is",null),
      sb.from("osint_semantic_items").select("fire_event_id,source_name,source_class,provider,published_at,title,processed_at,origin_kind").in("fire_event_id",ids).not("published_at","is",null),
      sb.from("event_environment_context").select("fire_event_id,radar_status,radar_frame_time,radar_time_delta_minutes,queried_at").in("fire_event_id",ids),
      sb.from("satellite_surface_evidence").select("fire_event_id,before_datetime,after_datetime,before_cloud_pct,after_cloud_pct,status,updated_at").in("fire_event_id",ids),
      sb.from("eumetsat_frp_detections").select("event_id,source,platform,instrument,acq_datetime,received_at,confidence,frp").in("event_id",ids).order("acq_datetime"),
      sb.from("event_temporal_correlations").select("fire_event_id,profile_hash").in("fire_event_id",ids)
    ]);
    for(const r of [det,nep,osint,sem,env,surf,eum,old])if(r.error)throw r.error;

    const by=<T extends Record<string,any>>(rows:T[]|null|undefined,key:string)=>{
      const m=new Map<string,T[]>();for(const x of rows??[]){const k=String(x[key]??"");if(!k)continue;const a=m.get(k)??[];a.push(x);m.set(k,a)}return m;
    };
    const D=by(det.data,"event_id"),N=by(nep.data,"fire_event_id"),O=by(osint.data,"fire_event_id"),S=by(sem.data,"fire_event_id"),V=by(env.data,"fire_event_id"),U=by(surf.data,"fire_event_id"),E=by(eum.data,"event_id");
    const oldHash=new Map((old.data??[]).map((x:any)=>[String(x.fire_event_id),String(x.profile_hash)]));
    let changed=0;const changedIds:string[]=[];const levels:Record<string,number>={};

    for(const e of events??[]){
      const ref=Date.parse(String(e.first_seen));if(!Number.isFinite(ref))continue;
      const items:TemporalItem[]=[];
      for(const x of topByTime(D.get(e.id)??[],ref,"acq_datetime",8))push(items,{source:String(x.source??x.satellite??"FIRMS"),family:"firms",source_time:String(x.acq_datetime),time_semantics:"satellite_acquisition",label:(String(x.satellite??x.source??"FIRMS")+" "+String(x.instrument??"")).trim(),ingested_at:x.received_at,confidence:num(x.confidence),metadata:{frp_mw:num(x.frp)}});
      for(const x of N.get(e.id)??[])push(items,{source:"Neptun",family:"neptun",source_time:String(x.nearest_at),time_semantics:"observed/source",label:String(x.threat_type??x.label??"Air threat"),ingested_at:x.updated_at,confidence:num(x.confidence_0_100),scale_seconds:21600,metadata:{track_id:x.track_id,place:x.place,time_offset_seconds:x.time_offset_seconds}});
      for(const x of topByTime(O.get(e.id)??[],ref,"published_at",6))push(items,{source:String(x.source_name??x.source_kind??"Public OSINT"),family:"osint",source_time:String(x.published_at),time_semantics:"published",label:String(x.title??x.category??"OSINT"),ingested_at:x.first_seen_at,confidence:num(x.relevance_score),scale_seconds:86400,metadata:{source_kind:x.source_kind,source_item_id:x.source_item_id,category:x.category}});
      for(const x of topByTime(S.get(e.id)??[],ref,"published_at",4))push(items,{source:String(x.source_name??x.provider??"Semantic OSINT"),family:"osint",source_time:String(x.published_at),time_semantics:"published",label:String(x.title??x.origin_kind??"Semantic OSINT"),ingested_at:x.processed_at,scale_seconds:86400,metadata:{source_class:x.source_class,provider:x.provider}});
      for(const x of V.get(e.id)??[])if(x.radar_frame_time)push(items,{source:"RainViewer",family:"atmosphere",source_time:String(x.radar_frame_time),time_semantics:"radar_frame",label:"Radar frame nearest FIRMS",ingested_at:x.queried_at,scale_seconds:1200,metadata:{status:x.radar_status,delta_minutes:x.radar_time_delta_minutes}});
      if(e.cams_observed_at)push(items,{source:"CAMS",family:"atmosphere",source_time:String(e.cams_observed_at),time_semantics:"model_observed",label:"CAMS atmosphere",scale_seconds:21600,metadata:{signal_level:e.atmosphere_signal_level}});
      if(e.s5p_co_observed_at)push(items,{source:"Sentinel-5P CO",family:"atmosphere",source_time:String(e.s5p_co_observed_at),time_semantics:"satellite_observation",label:"S5P CO",scale_seconds:86400});
      if(e.s5p_aer_observed_at)push(items,{source:"Sentinel-5P AER",family:"atmosphere",source_time:String(e.s5p_aer_observed_at),time_semantics:"satellite_observation",label:"S5P aerosol",scale_seconds:86400});
      for(const x of topByTime(E.get(e.id)??[],ref,"acq_datetime",6))push(items,{source:String(x.platform??x.source??"EUMETSAT FRP"),family:"satellite",source_time:String(x.acq_datetime),time_semantics:"satellite_acquisition",label:(String(x.platform??"EUMETSAT")+" "+String(x.instrument??"FRP")).trim(),ingested_at:x.received_at,confidence:num(x.confidence),scale_seconds:7200,metadata:{frp_mw:num(x.frp)}});
      for(const x of U.get(e.id)??[]){
        if(x.before_datetime)push(items,{source:"Sentinel-2",family:"surface",source_time:String(x.before_datetime),time_semantics:"imagery_before",label:"Surface BEFORE",ingested_at:x.updated_at,metadata:{cloud_pct:num(x.before_cloud_pct),status:x.status}});
        if(x.after_datetime)push(items,{source:"Sentinel-2",family:"surface",source_time:String(x.after_datetime),time_semantics:"imagery_after",label:"Surface AFTER",ingested_at:x.updated_at,metadata:{cloud_pct:num(x.after_cloud_pct),status:x.status}});
      }

      const profile=buildTemporalProfile(String(e.first_seen),items);
      const core={...profile,timeline:profile.timeline.map(x=>({...x,metadata:x.metadata??{}}))};
      const profileHash=await hash(core);
      levels[profile.consistency_level]=(levels[profile.consistency_level]??0)+1;
      if(oldHash.get(e.id)===profileHash)continue;
      const now=new Date().toISOString();
      const {error:ue}=await sb.from("event_temporal_correlations").upsert({fire_event_id:e.id,...core,profile_hash:profileHash,generated_at:now,updated_at:now},{onConflict:"fire_event_id"});if(ue)throw ue;
      const {error:fe}=await sb.from("fire_events").update({temporal_correlation_updated_at:now}).eq("id",e.id);if(fe)throw fe;
      changed++;changedIds.push(e.id);
    }

    const state={status:"active",profile:PROFILE,last_success_run:new Date().toISOString(),window_hours:hours,processed:(events??[]).length,changed,unchanged:(events??[]).length-changed,levels,changed_event_ids:changedIds.slice(0,50),policy:"Source/observation/published/ingested times remain distinct. Temporal proximity is contextual only; no causal or attribution inference."};
    await sb.from("system_state").upsert({key:"monitor_temporal_correlation",value:state,updated_at:new Date().toISOString()});
    return json({ok:true,...state});
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    try{await sb.from("system_state").upsert({key:"monitor_temporal_correlation",value:{status:"error",profile:PROFILE,failed_at:new Date().toISOString(),last_error:message},updated_at:new Date().toISOString()})}catch{}
    return json({ok:false,error:message,profile:PROFILE},502);
  }
});
