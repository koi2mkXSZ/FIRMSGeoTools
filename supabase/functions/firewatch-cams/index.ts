import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const {data:a,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
 if(ae||a!==true)return json({ok:false,error:"unauthorized"},401);
 try{
  const {data:events,error:ee}=await sb.from("fire_events")
   .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,weather_wind_direction_deg")
   .gte("last_seen",new Date(Date.now()-48*3600e3).toISOString())
   .neq("status","closed")
   .order("last_seen",{ascending:false}).limit(30);
  if(ee)throw ee;
  const es=(events??[]).filter((e:any)=>Number.isFinite(Number(e.best_latitude??e.last_latitude))&&Number.isFinite(Number(e.best_longitude??e.last_longitude)));
  if(!es.length)return json({ok:true,events:0,updated:0});
  const lats=es.map((e:any)=>Number(e.best_latitude??e.last_latitude).toFixed(5)).join(",");
  const lons=es.map((e:any)=>Number(e.best_longitude??e.last_longitude).toFixed(5)).join(",");
  const vars="carbon_monoxide,pm2_5,aerosol_optical_depth,pm10_wildfires,european_aqi";
  const u="https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+encodeURIComponent(lats)+"&longitude="+encodeURIComponent(lons)+"&current="+encodeURIComponent(vars)+"&domains=cams_europe&timezone=UTC";
  const r=await fetch(u,{headers:{"user-agent":"GeoWatch-CAMS/1.0"},signal:AbortSignal.timeout(20000)});
  const txt=await r.text();if(!r.ok)throw new Error("Open-Meteo CAMS HTTP "+r.status+": "+txt.slice(0,500));
  const parsed=JSON.parse(txt);const rows=Array.isArray(parsed)?parsed:[parsed];
  let updated=0;const warnings:string[]=[];
  for(let i=0;i<Math.min(rows.length,es.length);i++){
    const cur=rows[i]?.current??{};const e:any=es[i];
    const wind=Number(e.weather_wind_direction_deg);
    const patch:any={
      cams_observed_at:cur.time?new Date(cur.time+"Z").toISOString():new Date().toISOString(),
      cams_carbon_monoxide_ug_m3:Number.isFinite(Number(cur.carbon_monoxide))?Number(cur.carbon_monoxide):null,
      cams_pm2_5_ug_m3:Number.isFinite(Number(cur.pm2_5))?Number(cur.pm2_5):null,
      cams_aerosol_optical_depth:Number.isFinite(Number(cur.aerosol_optical_depth))?Number(cur.aerosol_optical_depth):null,
      cams_pm10_wildfires_ug_m3:Number.isFinite(Number(cur.pm10_wildfires))?Number(cur.pm10_wildfires):null,
      cams_european_aqi:Number.isFinite(Number(cur.european_aqi))?Number(cur.european_aqi):null,
      plume_direction_deg:Number.isFinite(wind)?(wind+180)%360:null
    };
    const {error:ue}=await sb.from("fire_events").update(patch).eq("id",e.id);
    if(ue){warnings.push(e.id+": "+ue.message);continue}
    await sb.rpc("refresh_atmosphere_signal",{p_event_id:e.id});
    updated++;
  }
  const state={status:"active",source:"CAMS Europe via Open-Meteo",resolution_km:11,last_success_run:new Date().toISOString(),events_considered:es.length,events_updated:updated,warnings:warnings.slice(-20),variables:["carbon_monoxide","pm2_5","aerosol_optical_depth","pm10_wildfires","european_aqi"],plume_direction_basis:"meteorological wind direction + 180°"};
  await sb.from("system_state").upsert({key:"monitor_cams",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
 }catch(e){
  const msg=e instanceof Error?e.message:String(e);
  await sb.from("system_state").upsert({key:"monitor_cams",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});
  return json({ok:false,error:msg},502);
 }
});