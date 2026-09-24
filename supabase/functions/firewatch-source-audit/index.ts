import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const AVAIL="https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv";
const KNOWN: Record<string,{role:string;coverage:string;enabled:boolean;reason?:string}> = {
  MODIS_NRT:{role:"live-active-fire",coverage:"global",enabled:true},
  MODIS_SP:{role:"archive-active-fire",coverage:"global",enabled:true},
  VIIRS_NOAA20_NRT:{role:"live-active-fire",coverage:"global",enabled:true},
  VIIRS_NOAA20_SP:{role:"archive-active-fire",coverage:"global",enabled:true},
  VIIRS_NOAA21_NRT:{role:"live-active-fire",coverage:"global",enabled:true},
  VIIRS_SNPP_NRT:{role:"live-active-fire",coverage:"global",enabled:true},
  VIIRS_SNPP_SP:{role:"archive-active-fire",coverage:"global",enabled:true},
  LANDSAT_NRT:{role:"regional-active-fire",coverage:"US/Canada only",enabled:false,reason:"Нет покрытия Украины в FIRMS Area API"},
  GOES_NRT:{role:"regional-geostationary",coverage:"Americas",enabled:false,reason:"Нет покрытия Украины"},
  BA_MODIS:{role:"burned-area",coverage:"global",enabled:false,reason:"Продукт выгоревшей площади, не поток активных очагов"},
  BA_VIIRS:{role:"burned-area",coverage:"global",enabled:false,reason:"Продукт выгоревшей площади, не поток активных очагов"}
};

function parseLine(line:string){const out:string[]=[];let v="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c=='"'){if(q&&line[i+1]=='"'){v+='"';i++;}else q=!q;}else if(c==","&&!q){out.push(v);v="";}else v+=c;}out.push(v);return out;}
function parseCsv(s:string){const ls=s.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);if(ls.length<2)return[];const h=parseLine(ls[0]);return ls.slice(1).map(l=>{const a=parseLine(l),o:Record<string,string>={};h.forEach((x,i)=>o[x]=a[i]??"");return o;});}
function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}

Deno.serve(async(req)=>{
 if(req.method!=="POST") return json({ok:false,error:"POST required"},405);
 const mapKey=Deno.env.get("FIRMS_MAP_KEY"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!mapKey||!url||!key) return json({ok:false,error:"missing env"},500);
 const sb=createClient(url,key,{auth:{persistSession:false}});
 const secret=req.headers.get("x-cron-secret")??"";
 const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
 if(ae||auth!==true) return json({ok:false,error:"unauthorized"},401);
 try{
   const r=await fetch(`${AVAIL}/${encodeURIComponent(mapKey)}/ALL`,{headers:{"user-agent":"NASA-FIRMS-UA-source-audit/1.1"},signal:AbortSignal.timeout(20000)});
   const t=await r.text(); if(!r.ok) throw new Error(`FIRMS availability HTTP ${r.status}: ${t.slice(0,200)}`);
   const rows=parseCsv(t);
   const structured=rows.map((x:any)=>{
     const id=String(x.data_id??x.source??"").trim(); const k=KNOWN[id];
     return {id,min_date:x.min_date??null,max_date:x.max_date??null,role:k?.role??"unknown",coverage:k?.coverage??"unknown",enabled:k?.enabled??false,reason:k?.reason??null};
   }).filter((x:any)=>x.id);
   const unknown=structured.filter((x:any)=>x.role==="unknown").map((x:any)=>x.id);
   const expectedLive=["MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"];
   const missingLive=expectedLive.filter(id=>!structured.some((x:any)=>x.id===id));
   const state={
     status:unknown.length||missingLive.length?"attention":"ok",
     checked_at:new Date().toISOString(),
     structured_sources:structured,
     all_active_fire_sources_applicable_to_ukraine_covered:unknown.length===0&&missingLive.length===0,
     unknown_sources:unknown,
     missing_expected_live_sources:missingLive,
     live_ukraine_sources:structured.filter((x:any)=>x.role==="live-active-fire"&&x.enabled).map((x:any)=>x.id),
     archive_active_fire_sources:structured.filter((x:any)=>x.role==="archive-active-fire"&&x.enabled).map((x:any)=>x.id),
     auxiliary_sources:structured.filter((x:any)=>x.role==="burned-area"),
     excluded_regional_sources:structured.filter((x:any)=>x.role.startsWith("regional-")),
     map_only_layers:[
       {id:"METEOSAT9_SEVIRI_FRP",satellite:"Meteosat-9",instrument:"SEVIRI",coverage:"Europe/Africa",temporal_resolution_min:15,nominal_resolution_km:3,mode:"provisional-map-layer",ingested:false,reason:"Доступен в FIRMS как provisional geostationary layer, но не опубликован как структурированный глобальный Area API/WFS поток детекций"}
     ]
   };
   await sb.from("system_state").upsert({key:"firms_source_registry",value:state,updated_at:new Date().toISOString()});
   return json({ok:true,...state});
 }catch(e){
   const msg=e instanceof Error?e.message:String(e);
   await sb.from("system_state").upsert({key:"firms_source_registry",value:{status:"error",last_error:msg,checked_at:new Date().toISOString()},updated_at:new Date().toISOString()});
   return json({ok:false,error:msg},502);
 }
});