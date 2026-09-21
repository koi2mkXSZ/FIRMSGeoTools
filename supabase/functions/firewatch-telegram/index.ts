import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function esc(s:unknown){return String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]||c))}
function fmtDate(v:string,tz:string){
  try{return new Intl.DateTimeFormat("en-GB",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(v))}
  catch{return new Date(v).toISOString()}
}
function eventText(e:any,project:string,tz:string){
  const lat=Number(e.best_latitude??e.last_latitude),lon=Number(e.best_longitude??e.last_longitude);
  const region=e.regions?.name?String(e.regions.name):"—";
  const src=Array.isArray(e.multisource_sources)?e.multisource_sources.join(", "):"—";
  return [
    `🔥 <b>${esc(project)}</b>`,
    `ID события: <code>${esc(String(e.id).slice(0,8))}</code>`,
    "",
    `Дата/время: <b>${esc(fmtDate(e.first_seen,tz))}</b> (${esc(tz)})`,
    `Регион: <b>${esc(region)}</b>`,
    `Координаты: <code>${lat.toFixed(5)}, ${lon.toFixed(5)}</code>`,
    `Наблюдений: ${Number(e.observation_count??1)}`,
    `Источников: ${Number(e.multisource_count??1)}`,
    `Спутники: ${esc(src)}`
  ].join("\n");
}
async function tg(token:string,chatId:string,text:string){
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true}),
    signal:AbortSignal.timeout(20000)
  });
  const body=await r.json().catch(()=>null);
  if(!r.ok||!body?.ok)throw new Error(`Telegram HTTP ${r.status}: ${JSON.stringify(body).slice(0,500)}`);
  return body.result;
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN"),chatId=Deno.env.get("TELEGRAM_CHAT_ID");
  if(!url||!serviceKey||!token||!chatId)return json({ok:false,error:"Missing Telegram or Supabase runtime configuration"},500);
  const sb=createClient(url,serviceKey,{auth:{persistSession:false}});
  const secret=req.headers.get("x-cron-secret")??"";
  const {data:ok,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(ae||ok!==true)return json({ok:false,error:"Unauthorized"},401);

  const holder=crypto.randomUUID();
  const {data:lease}=await sb.rpc("firewatch_acquire_telegram_lease",{p_holder:holder,p_ttl_seconds:180});
  if(lease!==true)return json({ok:true,skipped:"delivery lease busy"});

  try{
    const {data:cfg}=await sb.from("project_config").select("project_name,timezone,telegram_enabled").eq("id",true).single();
    if(cfg?.telegram_enabled===false)return json({ok:true,skipped:"Telegram disabled"});

    const {data:events,error}=await sb.from("fire_events")
      .select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,observation_count,multisource_count,multisource_sources,regions(name)")
      .eq("notification_required",true).eq("telegram_sent",false)
      .order("first_seen",{ascending:true}).limit(20);
    if(error)throw error;

    let sent=0;const failures:any[]=[];
    for(const e of events??[]){
      try{
        const result=await tg(token,chatId,eventText(e,cfg?.project_name??"FIRMSGeoTools",cfg?.timezone??"UTC"));
        const {error:ue}=await sb.from("fire_events").update({
          telegram_sent:true,telegram_sent_at:new Date().toISOString(),telegram_message_id:result.message_id,
          telegram_last_observation_count:e.observation_count,telegram_last_seen_snapshot:e.last_seen,
          telegram_last_update_at:new Date().toISOString()
        }).eq("id",e.id);
        if(ue)throw ue;
        sent++;
      }catch(err){failures.push({event_id:e.id,error:err instanceof Error?err.message:String(err)})}
    }
    await sb.from("system_state").upsert({
      key:"monitor_telegram",
      value:{status:failures.length?"degraded":"active",last_success_run:new Date().toISOString(),selected:(events??[]).length,sent,failures:failures.slice(0,10)},
      updated_at:new Date().toISOString()
    });
    return json({ok:failures.length===0,selected:(events??[]).length,sent,failures});
  }finally{
    await sb.rpc("firewatch_release_telegram_lease",{p_holder:holder}).catch(()=>null);
  }
});