import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const OPENAQ="https://api.openaq.org/v3";
const SENSOR_COMMUNITY="https://data.sensor.community/airrohr/v1/filter";
const MAX_EVENTS=8,MAX_LOCATIONS=15,RADIUS_M=25000,OPENAQ_EFFECTIVE_RADIUS_M=50000;
const PARAM_ALLOW=new Set(["pm25","pm2.5","pm10","co","no2","so2","o3","bc","no","nox","co2","pm1","pm4","ufp"]);

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
async function fetchJson(url:string,headers:Record<string,string>={}){
  const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"GeoWatch-GroundOSINT/1.0 (@NASA_FIRMS)",...headers},signal:AbortSignal.timeout(20000)});
  const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,260)}`);
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,180))}
}
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function iso(v:any){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString():null}
function normalizeParam(s:any){return String(s??"").toLowerCase().replace(/\s+/g,"").replace(/₂/g,"2").replace(/₁₀/g,"10")}
async function upsert(sb:any,x:any){
  const {error}=await sb.rpc("upsert_ground_sensor_latest",{
    p_source:x.source,p_station_id:String(x.station_id),p_station_name:x.station_name??null,p_provider:x.provider??null,
    p_parameter:x.parameter,p_value:x.value,p_unit:x.unit??null,p_observed_at:x.observed_at,
    p_lat:x.lat,p_lon:x.lon,p_source_url:x.source_url??null,p_is_old:x.is_old??null,p_payload:x.payload??{}
  });if(error)throw error;
}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){const p=Math.PI/180,R=6371e3,a=Math.sin((lat2-lat1)*p/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(a)))}

async function sensorCommunityRun(sb:any){
  const {data:events,error}=await sb.from("fire_events")
    .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
    .gte("last_seen",new Date(Date.now()-24*3600e3).toISOString()).neq("status","closed")
    .order("last_seen",{ascending:false}).limit(Math.min(MAX_EVENTS,6));
  if(error)throw error;
  const latest=new Map<string,any>();let queries=0,rowsSeen=0;const warnings:string[]=[];
  const mapType=(t:string)=>{const u=t.trim();if(u==="P1"||u.endsWith("_P1"))return{parameter:"pm10",unit:"µg/m³"};if(u==="P2"||u.endsWith("_P2"))return{parameter:"pm25",unit:"µg/m³"};if(u==="P0"||u.endsWith("_P0"))return{parameter:"pm1",unit:"µg/m³"};if(u==="temperature")return{parameter:"temperature",unit:"°C"};if(u==="humidity")return{parameter:"humidity",unit:"%"};if(u==="pressure"||u==="pressure_at_sealevel")return{parameter:u,unit:"Pa"};return null};
  for(const e of events??[]){
    const lat=n((e as any).best_latitude??(e as any).last_latitude),lon=n((e as any).best_longitude??(e as any).last_longitude);if(lat==null||lon==null)continue;
    const dLat=RADIUS_M/111320,dLon=RADIUS_M/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
    const box=[lat-dLat,lon-dLon,lat+dLat,lon+dLon].map(x=>x.toFixed(4)).join(",");
    try{
      const d=await fetchJson(SENSOR_COMMUNITY+"/box="+box);queries++;
      const rows=Array.isArray(d)?d:[];rowsSeen+=rows.length;
      for(const r of rows){
        const slat=n(r?.location?.latitude),slon=n(r?.location?.longitude),at=iso(String(r?.timestamp??"").replace(" ","T")+"Z");
        const sensorId=String(r?.sensor?.id??""),locationId=String(r?.location?.id??sensorId);
        if(slat==null||slon==null||!at||!sensorId||hav(lat,lon,slat,slon)>RADIUS_M)continue;
        for(const v of Array.isArray(r?.sensordatavalues)?r.sensordatavalues:[]){
          const m=mapType(String(v?.value_type??""));const value=n(v?.value);if(!m||value==null)continue;
          const key=locationId+":"+m.parameter,prev=latest.get(key);if(prev&&Date.parse(prev.observed_at)>=Date.parse(at))continue;
          latest.set(key,{source:"SENSOR_COMMUNITY",station_id:locationId,station_name:"Sensor.Community #"+locationId,
            provider:"Sensor.Community"+(r?.sensor?.sensor_type?.name?" / "+r.sensor.sensor_type.name:""),parameter:m.parameter,value,unit:m.unit,observed_at:at,
            lat:slat,lon:slon,is_old:Date.now()-Date.parse(at)>30*60000,source_url:`https://data.sensor.community/airrohr/v1/sensor/${sensorId}/`,
            payload:{sensor_id:sensorId,sensor_type:r?.sensor?.sensor_type?.name??null,manufacturer:r?.sensor?.sensor_type?.manufacturer??null,country:r?.location?.country??null,indoor:r?.location?.indoor??null,exact_location:r?.location?.exact_location??null}});
        }
      }
    }catch(e){warnings.push(String((e as any).id)+": "+(e instanceof Error?e.message:String(e)))}
  }
  let stored=0,stale=0;for(const x of latest.values()){await upsert(sb,x);stored++;if(x.is_old)stale++}
  return{configured:true,event_centers:(events??[]).length,queries,rows_seen:rowsSeen,unique_measurements:latest.size,stored,stale,warnings:warnings.slice(-20)};
}

async function openaqRun(sb:any,key:string){
  const {data:events,error}=await sb.from("fire_events")
    .select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
    .gte("last_seen",new Date(Date.now()-24*3600e3).toISOString()).neq("status","closed")
    .order("last_seen",{ascending:false}).limit(MAX_EVENTS);
  if(error)throw error;

  const locations=new Map<number,any>();let locationQueries=0;
  for(const e of events??[]){
    const lat=n((e as any).best_latitude??(e as any).last_latitude),lon=n((e as any).best_longitude??(e as any).last_longitude);
    if(lat==null||lon==null)continue;
    const dLat=OPENAQ_EFFECTIVE_RADIUS_M/111320;
    const dLon=OPENAQ_EFFECTIVE_RADIUS_M/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
    const u=new URL(OPENAQ+"/locations");
    u.searchParams.set("bbox",[lon-dLon,lat-dLat,lon+dLon,lat+dLat].map(x=>x.toFixed(4)).join(","));
    u.searchParams.set("iso","UA");
    u.searchParams.set("limit","100");
    u.searchParams.set("page","1");
    const d=await fetchJson(u.toString(),{"X-API-Key":key});locationQueries++;
    const perEvent:any[]=[];
    for(const loc of Array.isArray(d?.results)?d.results:[]){
      const llat=n(loc?.coordinates?.latitude),llon=n(loc?.coordinates?.longitude);
      if(llat==null||llon==null)continue;
      const distance=hav(lat,lon,llat,llon);
      if(distance>OPENAQ_EFFECTIVE_RADIUS_M)continue;
      perEvent.push({...loc,_event_distance_m:distance});
    }
    perEvent.sort((a:any,b:any)=>Number(a?._event_distance_m??Infinity)-Number(b?._event_distance_m??Infinity));
    for(const loc of perEvent.slice(0,5)){const id=Number(loc?.id);if(Number.isFinite(id)&&!locations.has(id))locations.set(id,loc)}
    if(locations.size>=MAX_LOCATIONS)break;
  }

  let latestQueries=0,readings=0,stored=0,stale=0;const warnings:string[]=[];
  for(const [id,loc] of [...locations.entries()].slice(0,MAX_LOCATIONS)){
    try{
      const lu=new URL(OPENAQ+`/locations/${id}/latest`);lu.searchParams.set("limit","100");lu.searchParams.set("page","1");lu.searchParams.set("datetime_min",new Date(Date.now()-24*3600e3).toISOString());
      const d=await fetchJson(lu.toString(),{"X-API-Key":key});latestQueries++;
      const sensorMap=new Map<number,any>();
      for(const s of Array.isArray(loc?.sensors)?loc.sensors:[])sensorMap.set(Number(s?.id),s);
      for(const r of Array.isArray(d?.results)?d.results:[]){
        readings++;const sid=Number(r?.sensorsId),s=sensorMap.get(sid),param=normalizeParam(s?.parameter?.name??s?.name);
        if(!PARAM_ALLOW.has(param))continue;
        const value=n(r?.value),lat=n(r?.coordinates?.latitude??loc?.coordinates?.latitude),lon=n(r?.coordinates?.longitude??loc?.coordinates?.longitude),at=iso(r?.datetime?.utc);
        if(value==null||lat==null||lon==null||!at)continue;
        const isOld=Date.now()-Date.parse(at)>6*3600e3;if(isOld)stale++;
        await upsert(sb,{source:"OPENAQ",station_id:String(id),station_name:loc?.name??loc?.locality??("OpenAQ "+id),provider:loc?.provider?.name??null,
          parameter:param,value,unit:s?.parameter?.units??null,observed_at:at,lat,lon,is_old:isOld,
          source_url:`https://api.openaq.org/v3/locations/${id}`,
          payload:{sensor_id:sid,owner:loc?.owner?.name??null,provider:loc?.provider?.name??null,country:loc?.country?.code??null,is_monitor:loc?.isMonitor??null}});
        stored++;
      }
    }catch(e){warnings.push(`location ${id}: ${e instanceof Error?e.message:String(e)}`)}
  }
  return{configured:true,event_centers:(events??[]).length,location_queries:locationQueries,locations:locations.size,latest_queries:latestQueries,readings,stored,stale,warnings:warnings.slice(-20)};
}

async function saveEcoBotRun(sb:any){
  const {data:regs,error}=await sb.from("environment_source_registry").select("*").eq("source","SAVEECOBOT_JSON").eq("enabled",true).order("id").limit(25);
  if(error)throw error;
  let checked=0,stored=0,failed=0;const warnings:string[]=[];
  for(const reg of regs??[]){
    checked++;
    try{
      const d=await fetchJson(String((reg as any).url));
      const lat=n(d?.latitude??d?.center_latitude),lon=n(d?.longitude??d?.center_longitude);
      if(lat==null||lon==null)throw new Error("missing coordinates");
      const stationId=String(d?.id??(reg as any).external_id),stationName=String(d?.sensor_name??d?.city_name??(reg as any).label??stationId),provider=String(d?.platform_name??"SaveEcoBot");
      const rows:any[]=[];
      if(Array.isArray(d?.last_data)){
        for(const x of d.last_data){const value=n(x?.value),at=iso(x?.updated_at),parameter=normalizeParam(x?.phenomenon);if(value!=null&&at)rows.push({parameter,value,at,is_old:Boolean(x?.is_old),unit:null})}
        const aqi=n(d?.aqi),aqAt=iso(d?.aqi_updated_at);if(aqi!=null&&aqAt)rows.push({parameter:"aqi",value:aqi,at:aqAt,is_old:Boolean(d?.aqi_is_old),unit:"AQI"});
      }else{
        const aqi=n(d?.aqi),aqAt=iso(d?.aqi_updated_at);if(aqi!=null&&aqAt)rows.push({parameter:"aqi",value:aqi,at:aqAt,is_old:Boolean(d?.aqi_is_old),unit:"AQI"});
        for(const [k,v] of Object.entries(d?.meteo??{})){const z:any=v,value=n(z?.value),at=iso(z?.updated_at);if(value!=null&&at)rows.push({parameter:normalizeParam(k),value,at,is_old:Boolean(z?.is_old),unit:null})}
      }
      for(const x of rows){await upsert(sb,{source:"SAVEECOBOT",station_id:stationId,station_name:stationName,provider,parameter:x.parameter,value:x.value,unit:x.unit,observed_at:x.at,lat,lon,is_old:x.is_old,source_url:String((reg as any).url),payload:{registry_id:(reg as any).id,external_id:(reg as any).external_id}});stored++}
      await sb.from("environment_source_registry").update({last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",(reg as any).id);
    }catch(e){failed++;const msg=e instanceof Error?e.message:String(e);warnings.push(`${(reg as any).external_id}: ${msg}`);await sb.from("environment_source_registry").update({last_error:msg,updated_at:new Date().toISOString()}).eq("id",(reg as any).id)}
  }
  return{configured:(regs??[]).length>0,registry_sources:(regs??[]).length,checked,stored,failed,warnings:warnings.slice(-20)};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const started=new Date().toISOString(),warnings:string[]=[];
  let sc:any;try{sc=await sensorCommunityRun(sb);if(sc.warnings?.length)warnings.push(...sc.warnings.map((x:string)=>"Sensor.Community: "+x))}catch(e){const msg=e instanceof Error?e.message:String(e);sc={configured:true,error:msg};warnings.push("Sensor.Community: "+msg)}
  const edgeOpenaqKey=Deno.env.get("OPENAQ_API_KEY")?.trim()||"";
  const {data:vaultOpenaqKey}=edgeOpenaqKey?{data:null}:await sb.rpc("firewatch_optional_vault_secret",{p_name:"openaq_api_key"});
  const openaqKey=edgeOpenaqKey||String(vaultOpenaqKey??"").trim();
  let oq:any={configured:false,status:"awaiting_credentials"},se:any;
  if(openaqKey){
    try{oq=await openaqRun(sb,openaqKey);if(oq.warnings?.length)warnings.push(...oq.warnings.map((x:string)=>"OpenAQ: "+x))}
    catch(e){const msg=e instanceof Error?e.message:String(e);oq={configured:true,error:msg};warnings.push("OpenAQ: "+msg)}
  }
  try{se=await saveEcoBotRun(sb);if(se.warnings?.length)warnings.push(...se.warnings.map((x:string)=>"SaveEcoBot: "+x))}
  catch(e){const msg=e instanceof Error?e.message:String(e);se={configured:false,error:msg};warnings.push("SaveEcoBot: "+msg)}

  const configured=Boolean(sc?.configured||oq.configured||se?.configured),hardErrors=Boolean(sc?.error||(oq.configured&&oq.error)||(se?.configured&&((se?.failed??0)>0||se?.error)));
  const state={
    status:!configured?"awaiting_credentials":hardErrors?"degraded":"active",
    source:"Sensor.Community + OpenAQ v3 (optional) + explicit SaveEcoBot JSON allow-list",
    last_check:new Date().toISOString(),
    last_success_run:configured&&!hardErrors?new Date().toISOString():null,
    sensor_community:sc,openaq:oq,saveecobot:se,warnings:warnings.slice(-20),
    radius_m:RADIUS_M,openaq_radius_m:OPENAQ_EFFECTIVE_RADIUS_M,openaq_query_mode:"bbox+exact-distance-filter",max_events:MAX_EVENTS,max_locations:MAX_LOCATIONS,
    note:"Ground measurements are contextual OSINT and do not establish that a thermal event caused observed pollution."
  };
  await sb.from("system_state").upsert({key:"monitor_ground_osint",value:state,updated_at:new Date().toISOString()});
  return json({ok:!hardErrors,started_at_utc:started,state},hardErrors?207:200);
});