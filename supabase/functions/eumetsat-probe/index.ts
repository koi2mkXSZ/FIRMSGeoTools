import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
async function probe(url:string){try{const r=await fetch(url,{headers:{"user-agent":"NASA-FIRMS-UA-EUMETSAT-probe/1.3"},signal:AbortSignal.timeout(20000)});const t=await r.text();return{url,status:r.status,ok:r.ok,type:r.headers.get("content-type"),len:t.length,head:t.slice(0,3000)}}catch(e){return{url,error:e instanceof Error?e.message:String(e)}}}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false},500);
 const sb=createClient(url,key,{auth:{persistSession:false}});const secret=req.headers.get("x-cron-secret")??"";const{data:a}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});if(a!==true)return json({ok:false},401);
 const urls=[
  "https://adaguc.lsasvcs.ipma.pt/adaguc-server?DATASET=MTG-FRP&SERVICE=WFS&REQUEST=GetCapabilities",
  "https://adaguc.lsasvcs.ipma.pt/adagucserver?dataset=MSG-FRP&service=WFS&request=GetCapabilities"
 ];
 const out=[];for(const u of urls)out.push(await probe(u));await sb.from("system_state").upsert({key:"eumetsat_wfs_probe",value:{checked_at:new Date().toISOString(),results:out},updated_at:new Date().toISOString()});return json({ok:true,results:out});
});