import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FIRMS_BASE="https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const LOOKBACK_DAYS=2;
const WINDOW_HOURS=24;
type Row=Record<string,string>;

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseLine(s:string){const out:string[]=[];let v="",q=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){v+='"';i++}else q=!q}else if(c===","&&!q){out.push(v);v=""}else v+=c}out.push(v);return out}
function parseCsv(s:string):Row[]{const lines=s.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const h=parseLine(lines[0]).map(x=>x.trim());return lines.slice(1).map(line=>{const a=parseLine(line),r:Row={};h.forEach((k,i)=>r[k]=a[i]??"");return r})}
function acq(r:Row){const d=r.acq_date?.trim(),t=r.acq_time?.trim().padStart(4,"0");if(!d||!t)return null;const x=new Date(`${d}T${t.slice(0,2)}:${t.slice(2,4)}:00Z`);return Number.isNaN(x.getTime())?null:x}
function modisConfidence(v:string){const n=Number(v);return !Number.isFinite(n)?v:n>=80?"h":n>=30?"n":"l"}

async function fetchSource(mapKey:string,source:any,bbox:string,now:Date){
  const url=`${FIRMS_BASE}/${encodeURIComponent(mapKey)}/${source.source_id}/${bbox}/${LOOKBACK_DAYS}`;
  const res=await fetch(url,{headers:{"user-agent":"FIRMSGeoTools/0.1"},signal:AbortSignal.timeout(30000)});
  const body=await res.text();
  if(!res.ok)throw new Error(`${source.source_id}: FIRMS HTTP ${res.status}: ${body.slice(0,240)}`);
  const rows=parseCsv(body),cut=now.getTime()-WINDOW_HOURS*3600000,future=now.getTime()+600000,records:any[]=[];
  for(const r of rows){
    const dt=acq(r);if(!dt||dt.getTime()<cut||dt.getTime()>future)continue;
    const lat=Number(r.latitude),lon=Number(r.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    records.push({
      source:source.source_id,
      satellite:r.satellite??"",
      instrument:r.instrument||(source.source_id==="MODIS_NRT"?"MODIS":"VIIRS"),
      acq_datetime:dt.toISOString(),
      latitude:String(lat),longitude:String(lon),
      scan:r.scan??"",track:r.track??"",
      confidence:source.source_id==="MODIS_NRT"?modisConfidence(r.confidence??""):(r.confidence??""),
      confidence_original:r.confidence??"",
      frp:r.frp??"",daynight:r.daynight??"",
      resolution_m:source.resolution_m,
      match_radius_m:source.match_radius_m
    });
  }
  return {source:source.source_id,fetched:rows.length,recent:records.length,records};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const mapKey=Deno.env.get("FIRMS_MAP_KEY"),url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!mapKey||!url||!serviceKey)return json({ok:false,error:"Missing FIRMS_MAP_KEY or Supabase runtime environment"},500);
  const sb=createClient(url,serviceKey,{auth:{persistSession:false}});
  const secret=req.headers.get("x-cron-secret")??"";
  const {data:ok,error:authError}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(authError||ok!==true)return json({ok:false,error:"Unauthorized"},401);

  const {data:cfg,error:cfgError}=await sb.rpc("firewatch_runtime_config");
  if(cfgError)throw cfgError;
  if(!Array.isArray(cfg?.bbox)||cfg.bbox.length!==4)return json({ok:false,error:"Monitoring AOI is not configured"},409);

  const bbox=cfg.bbox.map((x:number)=>Number(x).toFixed(6)).join(",");
  const now=new Date();

  try{
    const parts=await Promise.all((cfg.sources??[]).map((s:any)=>fetchSource(mapKey,s,bbox,now)));
    const records=parts.flatMap((x:any)=>x.records);
    const {data:batch,error:batchError}=await sb.rpc("ingest_firms_batch",{p_records:records,p_match_window_hours:Number(cfg.event_match_hours??24)});
    if(batchError)throw batchError;

    const state={
      status:"active",last_success_run:new Date().toISOString(),last_error:null,
      bbox,window_hours:WINDOW_HOURS,
      sources:parts.map((x:any)=>({source:x.source,fetched:x.fetched,recent:x.recent})),
      total_recent:records.length,
      batch
    };
    await sb.from("system_state").upsert({key:"monitor_firms",value:state,updated_at:new Date().toISOString()});
    return json({ok:true,...state});
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    try{await sb.from("system_state").upsert({key:"monitor_firms",value:{status:"error",last_error:message,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()})}catch{}
    return json({ok:false,error:message},502);
  }
});