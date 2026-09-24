import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BASE="https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MTG/MTFRPPixel/NATIVE";
const SOURCE="EUMETSAT_MTG_MTFRPPIXEL";
const MATCH_RADIUS_M=1500;
const MATCH_WINDOW_HOURS=24;
const LOOKBACK_FILES=8;
const BBOX={minLat:43.5,minLon:21.5,maxLat:53.5,maxLon:41.5};

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseLine(line:string){const out:string[]=[];let v="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++;}else q=!q;}else if(c===","&&!q){out.push(v);v="";}else v+=c;}out.push(v);return out;}
function parseCsv(s:string){const ls=s.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim()!=="");if(ls.length<2)return[];const h=parseLine(ls[0]).map(x=>x.trim());return ls.slice(1).map(l=>{const a=parseLine(l),o:Record<string,string>={};h.forEach((x,i)=>o[x]=a[i]??"");return o;});}
function basic(user:string,pass:string){const bytes=new TextEncoder().encode(user+":"+pass);let s="";for(const b of bytes)s+=String.fromCharCode(b);return "Basic "+btoa(s);}
async function gunzip(ab:ArrayBuffer){const u8=new Uint8Array(ab);if(u8[0]===0x1f&&u8[1]===0x8b){const ds=new DecompressionStream("gzip");return await new Response(new Response(ab).body!.pipeThrough(ds)).text();}return new TextDecoder().decode(u8);}
function pnum(...xs:any[]){for(const x of xs){const n=Number(x);if(Number.isFinite(n))return n;}return null;}
function pstr(...xs:any[]){for(const x of xs){const s=String(x??"").trim();if(s)return s;}return "";}
function conf(raw:any){const n=Number(raw);if(Number.isFinite(n)){const p=n<=1?n*100:n;return p>=80?"h":p>=30?"n":"l";}const s=String(raw??"").trim().toLowerCase();if(["h","high"].includes(s))return"h";if(["n","nominal","medium"].includes(s))return"n";if(["l","low"].includes(s))return"l";return"";}
function parseSlot(name:string){const m=name.match(/_(\d{12})\.csv\.gz$/);if(!m)return null;const s=m[1];return new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12),0));}
function parseAcq(row:Record<string,string>,fallback:Date){const raw=pstr(row.ACQTIME,row.ACQ_TIME);if(/^\d{14}$/.test(raw)){const dt=new Date(Date.UTC(+raw.slice(0,4),+raw.slice(4,6)-1,+raw.slice(6,8),+raw.slice(8,10),+raw.slice(10,12),+raw.slice(12,14)));if(!Number.isNaN(dt.getTime()))return dt;}return fallback;}
function dayDir(d:Date){const p=(n:number)=>String(n).padStart(2,"0");return `${BASE}/${d.getUTCFullYear()}/${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())}/`; }

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({ok:false,error:"missing Supabase env"},500);
 const sb=createClient(url,key,{auth:{persistSession:false}});
 const secret=req.headers.get("x-cron-secret")??"";const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
 if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
 const started=new Date();
 try{
   const dirs=[dayDir(started),dayDir(new Date(started.getTime()-86400000))];
   const fileMap=new Map<string,string>();
   for(const dir of dirs){
     const r=await fetch(dir,{headers:{"user-agent":"NASA-FIRMS-UA-MTG/1.0"},signal:AbortSignal.timeout(15000)});
     if(!r.ok)continue;
     const h=await r.text();
     const names=[...h.matchAll(/LSA-509_MTG_MTFRPPIXEL-ListProduct_MTG-FD_\d{12}\.csv\.gz/g)].map(m=>m[0]);
     for(const n of names)fileMap.set(n,dir+n);
   }
   const files=[...fileMap.keys()].sort();
   const selected=files.slice(-LOOKBACK_FILES);
   const latest=selected.at(-1)??null,latestSlot=latest?parseSlot(latest)?.toISOString()??null:null;
   const {data:cached}=selected.length?await sb.from("processed_source_products").select("product_id").eq("source_key","EUMETSAT_MTG").in("product_id",selected):{data:[]};
   const done=new Set((cached??[]).map((x:any)=>String(x.product_id)));
   const pending=selected.filter(x=>!done.has(x));

   const user=Deno.env.get("LSASAF_USERNAME")??Deno.env.get("LSA_SAF_USERNAME")??"";
   const pass=Deno.env.get("LSASAF_PASSWORD")??Deno.env.get("LSA_SAF_PASSWORD")??"";
   if(!user||!pass){
     const state={status:"waiting_credentials",enabled:true,provider:"EUMETSAT LSA SAF",product:"MTFRPPIXEL LSA-509",platform:"MTG",instrument:"FCI",resolution_m:1000,temporal_resolution_min:10,last_check:new Date().toISOString(),latest_public_file:latest,latest_public_slot:latestSlot,credentials_required:["LSASAF_USERNAME","LSASAF_PASSWORD"],notification_mode:"two-slot-or-polar-confirmation"};
     await sb.from("system_state").upsert({key:"eumetsat_lsa_saf",value:state,updated_at:new Date().toISOString()});
     return json({ok:true,mode:"waiting_credentials",state});
   }

   const records:any[]=[];let found=0,rawRows=0;const warnings:string[]=[];
   const processed:string[]=[];
   for(const name of pending){
     const slot=parseSlot(name);if(!slot)continue;
     const r=await fetch(fileMap.get(name)!,{headers:{Authorization:basic(user,pass),"user-agent":"NASA-FIRMS-UA-MTG/1.0"},signal:AbortSignal.timeout(20000)});
     if(r.status===401||r.status===403)throw new Error(`LSA SAF credentials rejected: HTTP ${r.status}`);
     if(!r.ok){warnings.push(`${name}: HTTP ${r.status}`);continue;}
     found++;
     const rows=parseCsv(await gunzip(await r.arrayBuffer()));rawRows+=rows.length;processed.push(name);
     for(const row of rows){
       const lat=pnum(row.LATITUDE_PARALLAX,row.LATITUDE,row.latitude),lon=pnum(row.LONGITUDE_PARALLAX,row.LONGITUDE,row.longitude);
       if(lat===null||lon===null||lat<BBOX.minLat||lat>BBOX.maxLat||lon<BBOX.minLon||lon>BBOX.maxLon)continue;
       const dt=parseAcq(row,slot);
       const frp=pnum(row.FRP,row.FRP_MW,row.FIRE_RADIATIVE_POWER,row.FIRE_RADIATIVE_POWER_MW);
       const c=pstr(row.FIRE_CONFIDENCE,row.CONFIDENCE,row.CONFIDENCE_MEASURE,row.QUALITY,row.QUALITYFLAG);
       records.push({source:SOURCE,satellite:"MTG",instrument:"FCI",acq_datetime:dt.toISOString(),latitude:String(lat),longitude:String(lon),scan:"",track:"",confidence:conf(c),frp:frp===null?"":String(frp),daynight:"",resolution_m:1000,provider:"EUMETSAT LSA SAF",product:"MTFRPPIXEL LSA-509",confidence_original:c,raw_row:row});
     }
   }

   if(processed.length)await sb.from("processed_source_products").upsert(processed.map(product_id=>({source_key:"EUMETSAT_MTG",product_id,product_time:parseSlot(product_id)?.toISOString()??null,processed_at:new Date().toISOString()})),{onConflict:"source_key,product_id"});
   const {data:batch,error:be}=await sb.rpc("ingest_firms_batch",{p_records:records,p_match_radius_m:MATCH_RADIUS_M,p_match_window_hours:MATCH_WINDOW_HOURS});if(be)throw be;
   const newIds=(batch?.notifications??[]).map((x:any)=>x.event_id).filter(Boolean);
   if(newIds.length){const {error:se}=await sb.from("fire_events").update({notification_required:false}).in("id",newIds);if(se)throw se;}
   const {data:promoted,error:pe}=await sb.rpc("promote_eumetsat_confirmed_events");if(pe)throw pe;

   const state={status:"active",enabled:true,provider:"EUMETSAT LSA SAF",product:"MTFRPPIXEL LSA-509",platform:"MTG",instrument:"FCI",resolution_m:1000,temporal_resolution_min:10,match_radius_m:MATCH_RADIUS_M,last_success_run:new Date().toISOString(),last_error:null,latest_public_file:latest,latest_public_slot:latestSlot,files_checked:selected.length,files_pending:pending.length,files_cached:selected.length-pending.length,files_downloaded:found,raw_rows:rawRows,ukraine_records:records.length,inserted:batch?.inserted??0,duplicates:batch?.duplicates??0,outside_ukraine:batch?.outside_ukraine??0,new_events:batch?.new_events??0,new_events_suppressed:newIds.length,promoted_events:Number(promoted??0),warnings:warnings.slice(-20),notification_mode:"two-slot-or-polar-confirmation"};
   await sb.from("system_state").upsert({key:"eumetsat_lsa_saf",value:state,updated_at:new Date().toISOString()});
   return json({ok:true,mode:"monitor",state});
 }catch(e){
   const msg=e instanceof Error?e.message:String(e);await sb.from("system_state").upsert({key:"eumetsat_lsa_saf",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});return json({ok:false,error:msg},502);
 }
});