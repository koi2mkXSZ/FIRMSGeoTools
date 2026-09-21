import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const installToken=Deno.env.get("INSTALL_TOKEN"),given=req.headers.get("x-install-token")??"";
  if(!installToken||given!==installToken)return json({ok:false,error:"Unauthorized"},401);

  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"Missing Supabase runtime environment"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});

  try{
    const body=await req.json();
    if(!body?.aoi)return json({ok:false,error:"aoi GeoJSON is required"},400);

    const updates:any={};
    for(const k of ["project_name","timezone","telegram_enabled","dashboard_enabled","poll_interval_minutes","event_match_hours","bootstrap_fresh_hours","inactive_after_hours","close_after_hours"]){
      if(body[k]!==undefined)updates[k]=body[k];
    }
    if(Object.keys(updates).length){
      const {error}=await sb.from("project_config").update(updates).eq("id",true);
      if(error)throw error;
    }

    const {data:geo,error:ge}=await sb.rpc("firewatch_set_geography",{p_aoi:body.aoi,p_regions:body.regions??null});
    if(ge)throw ge;

    const {data:cron,error:ce}=await sb.rpc("firewatch_configure_core_cron",{p_base_url:url});
    if(ce)throw ce;

    return json({ok:true,geography:geo,cron,bootstrap_note:"Bootstrap completes after the first successful FIRMS ingestion."});
  }catch(e){
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});