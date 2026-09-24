import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const OPEN_METEO="https://api.open-meteo.com/v1/forecast";
const NOMINATIM="https://nominatim.openstreetmap.org/reverse";
const HOURS=[1,3,6];
const RINGS=[10,25,50,100];
const MAX_EVENTS=20;
const PLACE_LOOKUPS=5;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function project(lat:number,lon:number,bearingDeg:number,distKm:number){
  const R=6371,b=bearingDeg*Math.PI/180,d=distKm/R,p1=lat*Math.PI/180,l1=lon*Math.PI/180;
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(b));
  const l2=l1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return {lat:p2*180/Math.PI,lon:((l2*180/Math.PI+540)%360)-180};
}
function meanDirection(degs:number[]){if(!degs.length)return null;let x=0,y=0;for(const d of degs){const r=d*Math.PI/180;x+=Math.cos(r);y+=Math.sin(r)}return (Math.atan2(y,x)*180/Math.PI+360)%360}
function sectorGeoJson(lat:number,lon:number,dir:number,maxKm=100,halfAngle=22.5){
  const coords:Array<[number,number]>=[[lon,lat]];
  for(let a=-halfAngle;a<=halfAngle;a+=7.5){const p=project(lat,lon,(dir+a+360)%360,maxKm);coords.push([p.lon,p.lat])}
  coords.push([lon,lat]);
  return {type:"Feature",properties:{kind:"forecast_sector",direction_deg:dir,half_angle_deg:halfAngle,max_km:maxKm},geometry:{type:"Polygon",coordinates:[coords]}};
}
async function reversePlace(lat:number,lon:number){
  const u=new URL(NOMINATIM);u.searchParams.set("format","jsonv2");u.searchParams.set("lat",String(lat));u.searchParams.set("lon",String(lon));u.searchParams.set("zoom","10");u.searchParams.set("addressdetails","1");u.searchParams.set("accept-language","ru");
  const r=await fetch(u,{headers:{"user-agent":"GeoWatch/1.0 (@NASA_FIRMS)","accept-language":"ru"},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error("Nominatim HTTP "+r.status);
  const d=await r.json(),a=d?.address??{},name=a.city||a.town||a.village||a.hamlet||a.municipality||a.county||d?.name;
  return name?{name:String(name),type:String(d?.type??d?.addresstype??"")||null,lat:Number(d?.lat),lon:Number(d?.lon)}:null;
}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){const R=6371,p=Math.PI/180,a=Math.sin((lat2-lat1)*p/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(a)))}
function delay(ms:number){return new Promise(r=>setTimeout(r,ms))}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({ok:false,error:"missing env"},500);
 const sb=createClient(url,key,{auth:{persistSession:false}});
 const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
 if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
 try{
   const {data:events,error:ee}=await sb.from("fire_events")
     .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,weather_wind_speed_ms,weather_wind_direction_deg,atmosphere_signal_level,multisource_count,event_confidence_level,plume_reference_place,intelligence_updated_at")
     .gte("last_seen",new Date(Date.now()-24*3600e3).toISOString())
     .neq("status","closed")
     .order("last_seen",{ascending:false}).limit(MAX_EVENTS);
   if(ee)throw ee;
   const es=(events??[]).map((e:any)=>({...e,lat:Number(e.best_latitude??e.last_latitude),lon:Number(e.best_longitude??e.last_longitude)})).filter((e:any)=>Number.isFinite(e.lat)&&Number.isFinite(e.lon));
   if(!es.length){const state={status:"active",last_success_run:new Date().toISOString(),events_considered:0,events_updated:0};await sb.from("system_state").upsert({key:"monitor_intelligence",value:state,updated_at:new Date().toISOString()});return json({ok:true,state})}

   const lats=es.map((e:any)=>e.lat.toFixed(5)).join(","),lons=es.map((e:any)=>e.lon.toFixed(5)).join(",");
   const u=new URL(OPEN_METEO);u.searchParams.set("latitude",lats);u.searchParams.set("longitude",lons);u.searchParams.set("hourly","wind_speed_10m,wind_direction_10m,wind_gusts_10m");u.searchParams.set("forecast_days","1");u.searchParams.set("timezone","UTC");u.searchParams.set("wind_speed_unit","ms");
   const wr=await fetch(u,{headers:{"user-agent":"GeoWatch-Intelligence/1.0"},signal:AbortSignal.timeout(20000)});const wt=await wr.text();if(!wr.ok)throw new Error("Open-Meteo HTTP "+wr.status+": "+wt.slice(0,300));
   const parsed=JSON.parse(wt),rows=Array.isArray(parsed)?parsed:[parsed];
   let updated=0,placeLookups=0;const warnings:string[]=[];

   for(let i=0;i<Math.min(es.length,rows.length);i++){
     const e:any=es[i],h=rows[i]?.hourly??{},times:string[]=h.time??[],spd:any[]=h.wind_speed_10m??[],dir:any[]=h.wind_direction_10m??[];
     if(!times.length)continue;
     const now=Date.now();let base=0,best=Infinity;for(let j=0;j<times.length;j++){const t=Date.parse(times[j]+"Z"),d=Math.abs(t-now);if(d<best){best=d;base=j}}
     let lat=e.lat,lon=e.lon,totalKm=0;const points:any[]=[{hour:0,lat,lon,distance_km:0}];const dirs:number[]=[];
     for(let hr=1;hr<=6;hr++){
       const idx=Math.min(base+hr-1,spd.length-1,dir.length-1),s=Number(spd[idx]),from=Number(dir[idx]);
       if(!Number.isFinite(s)||!Number.isFinite(from))continue;
       const to=(from+180)%360,km=s*3.6;dirs.push(to);const p=project(lat,lon,to,km);lat=p.lat;lon=p.lon;totalKm+=km;
       if(HOURS.includes(hr))points.push({hour:hr,lat,lon,distance_km:Number(totalKm.toFixed(1)),wind_speed_ms:Number(s.toFixed(1)),transport_bearing_deg:Number(to.toFixed(0))});
     }
     const fallbackDir=Number.isFinite(Number(e.weather_wind_direction_deg))?(Number(e.weather_wind_direction_deg)+180)%360:0;
     const mean=meanDirection(dirs)??fallbackDir;
     const plume={model:"simple_wind_advection",generated_at:new Date().toISOString(),hours:points,rings_km:RINGS,mean_transport_direction_deg:Number(mean.toFixed(0)),limitations:"Расчёт по ветру 10 м; без учёта вертикального профиля, рельефа и химии атмосферы."};
     const sector=sectorGeoJson(e.lat,e.lon,mean,100,22.5);
     const patch:any={plume_forecast:plume,plume_sector_geojson:sector,plume_direction_deg:mean};

     const intelAge=Date.now()-Date.parse(String(e.intelligence_updated_at??""));
     if(placeLookups<PLACE_LOOKUPS&&(!e.plume_reference_place||!Number.isFinite(intelAge)||intelAge>6*3600e3)){
       const p3=points.find((p:any)=>p.hour===3)??points.at(-1);
       if(p3){
         try{
           if(placeLookups>0)await delay(1100);
           const pl=await reversePlace(p3.lat,p3.lon);placeLookups++;
           if(pl){patch.plume_reference_place=pl.name;patch.plume_reference_place_type=pl.type;patch.plume_reference_place_distance_km=Number.isFinite(pl.lat)&&Number.isFinite(pl.lon)?hav(p3.lat,p3.lon,pl.lat,pl.lon):null;patch.plume_reference_place_hour=3}
         }catch(ex){warnings.push(e.id+": place "+(ex instanceof Error?ex.message:String(ex)))}
       }
     }

     const {error:ue}=await sb.from("fire_events").update(patch).eq("id",e.id);if(ue){warnings.push(e.id+": "+ue.message);continue}
     const {error:re}=await sb.rpc("refresh_fire_event_intelligence",{p_event_id:e.id});if(re){warnings.push(e.id+": rollup "+re.message);continue}
     updated++;
   }

   const state={status:"active",source:"Open-Meteo wind forecast + detections + CAMS/Sentinel-5P",last_success_run:new Date().toISOString(),events_considered:es.length,events_updated:updated,forecast_hours:HOURS,distance_rings_km:RINGS,place_lookups:placeLookups,warnings:warnings.slice(-20),model:"simple wind-advection; non-attributive"};
   await sb.from("system_state").upsert({key:"monitor_intelligence",value:state,updated_at:new Date().toISOString()});
   return json({ok:true,state});
 }catch(e){
   const msg=e instanceof Error?e.message:String(e);await sb.from("system_state").upsert({key:"monitor_intelligence",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});return json({ok:false,error:msg},502)
 }
});