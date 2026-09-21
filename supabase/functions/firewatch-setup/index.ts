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

    if(body.sources && typeof body.sources==="object"){
      for(const [sourceId,enabled] of Object.entries(body.sources)){
        const {error}=await sb.from("firms_sources").update({enabled:Boolean(enabled)}).eq("source_id",sourceId);
        if(error)throw error;
      }
    }
    if(body.event_match_radius_m && typeof body.event_match_radius_m==="object"){
      const viirs=Number(body.event_match_radius_m.VIIRS);
      const modis=Number(body.event_match_radius_m.MODIS);
      if(Number.isFinite(viirs)&&viirs>0){
        const {error}=await sb.from("firms_sources").update({match_radius_m:Math.round(viirs)}).like("source_id","VIIRS_%");
        if(error)throw error;
      }
      if(Number.isFinite(modis)&&modis>0){
        const {error}=await sb.from("firms_sources").update({match_radius_m:Math.round(modis)}).eq("source_id","MODIS_NRT");
        if(error)throw error;
      }
    }

    const {data:geo,error:ge}=await sb.rpc("firewatch_set_geography",{p_aoi:body.aoi,p_regions:body.regions??null});
    if(ge)throw ge;

    const {data:cron,error:ce}=await sb.rpc("firewatch_configure_core_cron",{p_base_url:url});
    if(ce)throw ce;
    const {data:stage5Cron,error:s5e}=await sb.rpc("firewatch_configure_stage5_cron",{p_base_url:url});
    if(s5e)throw s5e;

    let admin:any={enabled:false};
    const tgToken=Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId=Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    const adminWebhookSecret=Deno.env.get("TELEGRAM_ADMIN_WEBHOOK_SECRET");
    if(tgToken&&adminChatId&&adminWebhookSecret){
      const hookUrl=url+"/functions/v1/firewatch-admin";
      const wr=await fetch(`https://api.telegram.org/bot${tgToken}/setWebhook`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          url:hookUrl,
          secret_token:adminWebhookSecret,
          allowed_updates:["message","callback_query"],
          drop_pending_updates:false
        }),
        signal:AbortSignal.timeout(20000)
      });
      const wj=await wr.json().catch(()=>null);
      if(!wr.ok||!wj?.ok)throw new Error(`Telegram setWebhook failed: ${wj?.description??wr.status}`);
      admin={enabled:true,chat_id_configured:true,webhook_url:hookUrl};
    }

    return json({ok:true,geography:geo,cron,stage5_cron:stage5Cron,admin,bootstrap_note:"Bootstrap completes after the first successful FIRMS ingestion."});
  }catch(e){
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});