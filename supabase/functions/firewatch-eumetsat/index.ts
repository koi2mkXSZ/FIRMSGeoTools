import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import h5wasm from "npm:h5wasm@0.10.3";

const BASE="https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/FRP-PIXEL/HDF5";
const LOOKBACK_FILES=8;
const UA_BBOX={minLon:21.5,minLat:43.5,maxLon:41.5,maxLat:53.5};

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function ymd(d:Date){return {y:d.getUTCFullYear(),m:String(d.getUTCMonth()+1).padStart(2,"0"),d:String(d.getUTCDate()).padStart(2,"0")}}
function parseSlot(name:string){const m=name.match(/(\d{12})$/);if(!m)return null;const s=m[1];return new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12),0))}
function normalizeArray(v:any){if(v==null)return[];if(Array.isArray(v))return v;if(ArrayBuffer.isView(v))return Array.from(v as any);return[]}
function getDataset(f:any,names:string[]){for(const n of names){try{const o=f.get(n);if(o?.value!==undefined)return normalizeArray(o.value)}catch{}}return[]}
function basic(user:string,pass:string){return "Basic "+btoa(user+":"+pass)}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({ok:false,error:"missing Supabase env"},500);
 const sb=createClient(url,key,{auth:{persistSession:false}});
 const secret=req.headers.get("x-cron-secret")??""; const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
 if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
 const started=new Date();
 try{
   const parts=ymd(started); const dir=`${BASE}/${parts.y}/${parts.m}/${parts.d}/`;
   const dr=await fetch(dir,{headers:{"user-agent":"NASA-FIRMS-UA-EUMETSAT/1.0"},signal:AbortSignal.timeout(20000)});
   const html=await dr.text();
   const files=[...new Set([...html.matchAll(/HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_\d{12}/g)].map(m=>m[0]))].sort();
   const latest=files.at(-1)??null;
   const latestSlot=latest?parseSlot(latest)?.toISOString()??null:null;

   const user=Deno.env.get("LSA_SAF_USERNAME")??"";
   const pass=Deno.env.get("LSA_SAF_PASSWORD")??"";
   if(!user||!pass){
     const monitor={status:"awaiting_credentials",last_check:new Date().toISOString(),last_error:null,source:"EUMETSAT LSA SAF FRP-PIXEL LSA-502",platform:"MSG",instrument:"SEVIRI",cadence_min:15,latest_public_file:latest,latest_public_slot:latestSlot,directory_http_status:dr.status,credentials_required:true,required_secrets:["LSA_SAF_USERNAME","LSA_SAF_PASSWORD"],notification_mode:"supporting-observation-only"};
     await sb.from("system_state").upsert({key:"monitor_eumetsat",value:monitor,updated_at:new Date().toISOString()});
     return json({ok:true,active:false,...monitor});
   }

   const selected=files.slice(-LOOKBACK_FILES);
   let totalFetched=0,totalRows=0; const records:any[]=[]; const warnings:string[]=[];
   const {FS}=await h5wasm.ready;

   for(const name of selected){
     const slot=parseSlot(name); if(!slot)continue;
     const fr=await fetch(dir+name,{headers:{authorization:basic(user,pass),"user-agent":"NASA-FIRMS-UA-EUMETSAT/1.0"},signal:AbortSignal.timeout(20000)});
     const ab=await fr.arrayBuffer();
     if(!fr.ok){warnings.push(`${name}: HTTP ${fr.status}`);continue}
     const bytes=new Uint8Array(ab);
     if(bytes.length<8||bytes[0]!==137||bytes[1]!==72||bytes[2]!==68||bytes[3]!==70){warnings.push(`${name}: not HDF5`);continue}
     const fn=`/tmp_${slot.getTime()}.h5`; FS.writeFile(fn,bytes);
     try{
       const f=new h5wasm.File(fn,"r");
       const lat=getDataset(f,["LATITUDE","Latitude","latitude"]);
       const lon=getDataset(f,["LONGITUDE","Longitude","longitude"]);
       const frp=getDataset(f,["FRP"]);
       const unc=getDataset(f,["FRP_UNCERTAINTY"]);
       const conf=getDataset(f,["FIRE_CONFIDENCE","CONFIDENCE"]);
       const pix=getDataset(f,["PIXEL_SIZE"]);
       const acq=getDataset(f,["ACQTIME"]);
       const n=Math.min(lat.length,lon.length,frp.length||Number.MAX_SAFE_INTEGER);
       totalFetched+=n;
       for(let i=0;i<n;i++){
         const la=Number(lat[i])/100,lo=Number(lon[i])/100;
         if(!Number.isFinite(la)||!Number.isFinite(lo)||la<UA_BBOX.minLat||la>UA_BBOX.maxLat||lo<UA_BBOX.minLon||lo>UA_BBOX.maxLon)continue;
         let dt=slot;
         if(acq.length>i){
           const a=String(Math.trunc(Number(acq[i]))).padStart(4,"0");
           const hh=Number(a.slice(0,2)),mm=Number(a.slice(2,4));
           if(hh>=0&&hh<24&&mm>=0&&mm<60)dt=new Date(Date.UTC(slot.getUTCFullYear(),slot.getUTCMonth(),slot.getUTCDate(),hh,mm,0));
         }
         records.push({
           source:"LSA_SAF_MSG_FRP_PIXEL",platform:"MSG",instrument:"SEVIRI",
           acq_datetime:dt.toISOString(),latitude:la,longitude:lo,
           frp:frp.length>i?Number(frp[i])/10:null,
           frp_uncertainty:unc.length>i?Number(unc[i])/100:null,
           confidence:conf.length>i?Number(conf[i])/100:null,
           pixel_area_km2:pix.length>i?Number(pix[i])/100:null,
           product_file:name
         });
       }
       totalRows+=n; f.close();
     }catch(e){warnings.push(`${name}: ${e instanceof Error?e.message:String(e)}`)}
     try{FS.unlink(fn)}catch{}
   }

   const {data:ing,error:ie}=await sb.rpc("ingest_eumetsat_frp_batch",{p_records:records,p_match_radius_m:5000,p_match_window_hours:24});
   if(ie)throw ie;
   const monitor={status:"active",last_success_run:new Date().toISOString(),last_error:null,source:"EUMETSAT LSA SAF FRP-PIXEL LSA-502",platform:"MSG",instrument:"SEVIRI",cadence_min:15,latest_public_file:latest,latest_public_slot:latestSlot,files_checked:selected.length,hdf_rows_scanned:totalRows,ukraine_bbox_rows:records.length,ingest:ing,warnings:warnings.slice(-20),credentials_required:false,notification_mode:"supporting-observation-only",match_radius_m:5000};
   await sb.from("system_state").upsert({key:"monitor_eumetsat",value:monitor,updated_at:new Date().toISOString()});
   return json({ok:true,active:true,...monitor});
 }catch(e){
   const msg=e instanceof Error?e.message:String(e);
   const monitor={status:"error",last_error:msg,failed_at:new Date().toISOString()};
   try{await sb.from("system_state").upsert({key:"monitor_eumetsat",value:monitor,updated_at:new Date().toISOString()})}catch{}
   return json({ok:false,error:msg,started_at_utc:started.toISOString()},502);
 }
});