import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FIRMS_BASE="https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const SOURCES=["VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT","MODIS_NRT"];
const BBOX="21.5,43.5,41.5,53.5";
const LOOKBACK_DAYS=2, WINDOW_HOURS=24;

type Row=Record<string,string>;

function json(x:unknown,status=200){
  return new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function parseLine(s:string){
  const out:string[]=[];let v="",q=false;
  for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){v+='"';i++}else q=!q}else if(c===","&&!q){out.push(v);v=""}else v+=c}
  out.push(v);return out;
}
function parseCsv(s:string):Row[]{
  const lines=s.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return[];
  const h=parseLine(lines[0]).map(x=>x.trim());
  return lines.slice(1).map(line=>{const a=parseLine(line),r:Row={};h.forEach((k,i)=>r[k]=a[i]??"");return r});
}
function acq(r:Row){
  const d=r.acq_date?.trim(),t=r.acq_time?.trim().padStart(4,"0");
  if(!d||!t||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!/^\d{4}$/.test(t))return null;
  const x=new Date(`${d}T${t.slice(0,2)}:${t.slice(2,4)}:00Z`);
  return Number.isNaN(x.getTime())?null:x;
}
async function fetchSource(key:string,source:string,now:Date){
  const url=`${FIRMS_BASE}/${encodeURIComponent(key)}/${source}/${BBOX}/${LOOKBACK_DAYS}`;
  const res=await fetch(url,{headers:{"user-agent":"geowatch-geo-integrity/1.0"},signal:AbortSignal.timeout(30000)});
  const body=await res.text();
  if(!res.ok)throw new Error(`${source}: FIRMS HTTP ${res.status}: ${body.slice(0,200)}`);
  const rows=parseCsv(body),cut=now.getTime()-WINDOW_HOURS*3600000,future=now.getTime()+600000;
  const records:any[]=[];
  for(const r of rows){
    const dt=acq(r);if(!dt||dt.getTime()<cut||dt.getTime()>future)continue;
    const lat=Number(r.latitude),lon=Number(r.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    records.push({
      source,
      satellite:r.satellite??"",
      instrument:r.instrument||(source==="MODIS_NRT"?"MODIS":"VIIRS"),
      acq_datetime:dt.toISOString(),
      latitude:lat,
      longitude:lon
    });
  }
  return {source,fetched:rows.length,recent:records.length,records};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const key=Deno.env.get("FIRMS_MAP_KEY"),url=Deno.env.get("SUPABASE_URL"),sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!key||!url||!sr)return json({ok:false,error:"missing environment"},500);
  const sb=createClient(url,sr,{auth:{persistSession:false}});
  const secret=req.headers.get("x-cron-secret")??"";
  const {data:ok,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(ae||ok!==true)return json({ok:false,error:"unauthorized"},401);
  const started=new Date();
  try{
    const parts=await Promise.all(SOURCES.map(s=>fetchSource(key,s,started)));
    const records=parts.flatMap(x=>x.records);
    const {data,error}=await sb.rpc("firewatch_geo_integrity_refresh",{p_records:records});
    if(error)throw error;
    await sb.from("system_state").upsert({
      key:"monitor_geo_integrity_worker",
      value:{
        status:"active",last_success_run:new Date().toISOString(),
        sources:parts.map(x=>({source:x.source,fetched:x.fetched,recent:x.recent})),
        total_recent:records.length
      },
      updated_at:new Date().toISOString()
    });
    return json({ok:true,audit:data,sources:parts.map(x=>({source:x.source,fetched:x.fetched,recent:x.recent}))});
  }catch(e){
    const msg=e instanceof Error?e.message:(()=>{try{return JSON.stringify(e)}catch{return String(e)}})();
    try{await sb.from("system_state").upsert({key:"monitor_geo_integrity_worker",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()})}catch{}
    return json({ok:false,error:msg},502);
  }
});