import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

function json(x:unknown,status=200){return new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function esc(v:unknown){return String(v??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]||c))}
function age(iso:any){const t=Date.parse(String(iso??""));if(!Number.isFinite(t))return"never";const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60} min`}
function shortId(v:any){return String(v??"").slice(0,8)}
function num(v:any,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—"}
const enc=new TextEncoder();
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function dashboardUrl(sb:any){
  const [{data:secret,error},{data:pc,error:pce}]=await Promise.all([
    sb.rpc("firewatch_dashboard_secret"),
    sb.from("project_config").select("dashboard_public_url,dashboard_enabled").eq("id",true).single()
  ]);
  if(error||!secret)throw new Error("Dashboard signing secret unavailable");
  if(pce)throw pce;
  if(pc?.dashboard_enabled===false)throw new Error("Dashboard is disabled");
  if(!pc?.dashboard_public_url)throw new Error("dashboard_public_url is not configured");
  const base=Deno.env.get("SUPABASE_URL");if(!base)throw new Error("SUPABASE_URL unavailable");
  const exp=Math.floor(Date.now()/1000)+4*3600;
  const key=await crypto.subtle.importKey("raw",enc.encode(String(secret)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const raw=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode("dashboard:"+String(exp))));
  const sig=b64url(raw);
  const front=new URL(String(pc.dashboard_public_url));
  front.searchParams.set("api",base+"/functions/v1/firewatch-dashboard");
  front.searchParams.set("exp",String(exp));
  front.searchParams.set("sig",sig);
  return front.toString();
}

async function tg(token:string,method:string,body:any){
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
  });
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j?.ok)throw new Error(`Telegram ${method}: ${j?.description??r.status}`);
  return j.result;
}
async function send(token:string,chatId:string|number,text:string,reply_markup?:any){
  return tg(token,"sendMessage",{chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true,...(reply_markup?{reply_markup}:{})});
}
async function sendChunks(token:string,chatId:string|number,parts:string[]){for(const p of parts)await send(token,chatId,p)}

const panel={inline_keyboard:[
  [{text:"🌐 Dashboard",callback_data:"a:dashboard"}],
  [{text:"📊 Status",callback_data:"a:status"},{text:"🛰 Coverage",callback_data:"a:coverage"}],
  [{text:"🔥 Events",callback_data:"a:events"},{text:"📈 Analytics 24h",callback_data:"a:analytics24"}],
  [{text:"📍 Radius search",callback_data:"a:searchgeo"},{text:"🔎 Search help",callback_data:"a:searchhelp"}],
  [{text:"🩺 Doctor",callback_data:"a:doctor"}]
]};

function parseSearch(s:string){
  const f:any={};
  for(const part of s.trim().split(/\s+/).slice(1)){
    const i=part.indexOf("=");if(i<1)continue;
    const k=part.slice(0,i).toLowerCase(),v=part.slice(i+1);
    if(["id","region","status","source","from","to","min_frp","min_obs","min_platforms","sent","limit"].includes(k))f[k]=v;
    if(["radius","radius_km","r"].includes(k))f.radius_km=v;
    if(["coord","coords","center"].includes(k)){
      const [lat,lon]=v.split(",").map(Number);if(Number.isFinite(lat)&&Number.isFinite(lon)){f.lat=lat;f.lon=lon}
    }
    if(k==="lat")f.lat=v;if(["lon","lng"].includes(k))f.lon=v;
  }
  return f;
}
function eventLine(e:any){
  const dist=e.distance_km==null?"":` • ${num(e.distance_km,2)} km`;
  return `#${shortId(e.id)} • ${esc(e.region??"Unassigned")} • ${esc(e.lifecycle_status??e.status)}${dist}\n${num(e.latitude,5)}, ${num(e.longitude,5)} • obs ${Number(e.observation_count??0)} • sources ${Number(e.multisource_count??0)} • FRP max ${num(e.max_frp_mw,1)} MW`;
}
async function statusText(sb:any){
  const {data,error}=await sb.rpc("firewatch_admin_summary");if(error)throw error;
  const c=data?.counts??{},f=data?.firms??{},t=data?.telegram??{},b=data?.bootstrap??{};
  const cr=Array.isArray(data?.cron)?data.cron:[];
  return [
    `🛠 <b>${esc(data?.project?.project_name??"FIRMSGeoTools")}</b>`,
    `Bootstrap: ${b.done?"✅ complete":"⏳ pending"}`,
    `FIRMS: ${esc(f.status??"not run")} • ${esc(age(f.last_success_run))}`,
    `Telegram: ${esc(t.status??"not run")} • ${esc(age(t.last_success_run))}`,
    `Cron: ${cr.filter((x:any)=>x.active).length}/${cr.length} active`,
    "",
    `Detections 24h: <b>${Number(c.detections_24h??0)}</b>`,
    `New events 24h: <b>${Number(c.events_new_24h??0)}</b>`,
    `Touched events 24h: ${Number(c.events_touched_24h??0)}`,
    `Pending Telegram: ${Number(c.pending_telegram??0)}`,
    `Regions: ${Number(c.regions??0)}`
  ].join("\n");
}
async function coverageText(sb:any){
  const [
    {data:sum,error:e1},{data:cfg,error:e2},{data:cov,error:e3},
    {data:base,error:e4},{data:notif,error:e5},{data:geo,error:e6}
  ]=await Promise.all([
    sb.rpc("firewatch_admin_summary"),sb.rpc("firewatch_runtime_config"),
    sb.rpc("firewatch_source_coverage_summary"),sb.rpc("firewatch_source_baseline_summary"),
    sb.rpc("firewatch_notification_integrity_summary"),sb.rpc("firewatch_geo_integrity_summary")
  ]);
  if(e1)throw e1;if(e2)throw e2;if(e3)throw e3;if(e4)throw e4;if(e5)throw e5;if(e6)throw e6;

  const live=new Map((sum?.firms?.sources??[]).map((x:any)=>[x.source,x]));
  const coverage=new Map((cov?.sources??[]).map((x:any)=>[x.source_id,x]));
  const anomalies=new Map((base?.sources??[]).map((x:any)=>[x.source_id,x]));
  const geoSrc=new Map((geo?.sources??[]).map((x:any)=>[x.source_id,x]));
  const lines=["🛰 <b>Integrity & Coverage</b>",""];

  for(const s of cfg?.sources??[]){
    const l:any=live.get(s.source_id),cv:any=coverage.get(s.source_id),an:any=anomalies.get(s.source_id),gs:any=geoSrc.get(s.source_id);
    const mark=cv?.status==="active"&&Number(gs?.missing_in_db??0)===0?"✅":cv?.status?"⚠️":"⚪";
    lines.push(`${mark} <b>${esc(s.display_name)}</b>`);
    lines.push(`   worker ${esc(cv?.status??"unknown")} • activity ${esc(cv?.activity??"unknown")} • baseline ${esc(an?.status??"learning")}`);
    lines.push(`   fetched ${Number(l?.fetched??cv?.fetched_last_run??0)} • recent ${Number(l?.recent??cv?.recent_last_run??0)} • DB 24h ${Number(cv?.detections_24h??0)}`);
    if(gs)lines.push(`   audit API ${Number(gs.api_recent??0)} → AOI ${Number(gs.inside_aoi??0)} → DB ${Number(gs.db_matched??0)} • missing ${Number(gs.missing_in_db??0)}`);
  }

  const ns=notif?.state??{},gg=geo?.state??{},bs=base?.state??{},cs=cov?.state??{};
  lines.push("",
    `Source Coverage: <b>${esc(cs.status??"unknown")}</b> • active ${Number(cs.sources_active??0)}/${Number(cs.sources_total??0)} • degraded ${Number(cs.sources_degraded??0)}`,
    `Baseline: <b>${esc(bs.status??"learning")}</b> • watch ${Number(bs.sources_watch??0)} • anomaly ${Number(bs.sources_anomaly??0)}`,
    `Notification Integrity: <b>${esc(ns.status??"unknown")}</b> • gaps ${Number(ns.notification_gaps??0)} • backlog ${Number(ns.delivery_backlog??0)}`,
    `Geo Integrity: <b>${esc(gg.status??"unknown")}</b> • API ${Number(gg.api_recent??0)} → AOI ${Number(gg.inside_aoi??0)} → DB ${Number(gg.db_matched??0)} • missing ${Number(gg.missing_in_db??0)}`
  );
  return lines.join("\n");
}
async function eventsText(sb:any){
  const {data,error}=await sb.rpc("firewatch_search_events",{p_filters:{limit:10}});if(error)throw error;
  const ev=Array.isArray(data?.events)?data.events:[];
  return `🔥 <b>Latest events</b>\n\n${ev.map(eventLine).join("\n\n")||"No events."}`;
}
async function eventText(sb:any,q?:string){
  const {data:e,error}=await sb.rpc("firewatch_event_detail",{p_query:q?.trim()||null});if(error)throw error;
  if(!e)return"Event not found.";
  return [
    `🔥 <b>Event #${shortId(e.id)}</b>`,
    `Region: ${esc(e.region??"Unassigned")}`,
    `Status: ${esc(e.lifecycle_status??e.status)}`,
    `First: ${esc(e.first_seen)}`,
    `Last: ${esc(e.last_seen)}`,
    `Coordinates: <code>${num(e.latitude,5)}, ${num(e.longitude,5)}</code>`,
    `Resolution: ${e.resolution_m==null?"—":Number(e.resolution_m)+" m"}`,
    `Observations: ${Number(e.observation_count??0)}`,
    `Platforms: ${Number(e.multisource_count??0)}`,
    `Sources: ${esc((e.sources??[]).join(", ")||"—")}`,
    `FRP max / avg: ${num(e.max_frp_mw,1)} / ${num(e.avg_frp_mw,1)} MW`,
    `Telegram: ${e.telegram_sent?"✅ sent":"⏳ not sent"}${e.telegram_message_id?` • message ${e.telegram_message_id}`:""}`
  ].join("\n");
}
async function analyticsParts(sb:any,h=24){
  const {data,error}=await sb.rpc("firewatch_analytics_summary",{p_hours:h});if(error)throw error;
  const e=data?.events??{},frp=data?.frp??{},regions=Array.isArray(data?.by_region)?data.by_region:[],src=Array.isArray(data?.by_source)?data.by_source:[];
  const head=[
    `📈 <b>Analytics • ${h} h</b>`,
    `New events: <b>${Number(e.new??0)}</b> • active ${Number(e.active_new??0)} • closed ${Number(e.closed_new??0)}`,
    `Touched: ${Number(e.touched??0)}`,
    `Telegram sent in window: ${Number(e.telegram_sent??0)}`,
    `Multisource new: ${Number(e.multisource_new??0)}`,
    `Detections: ${Number(frp.detections??0)} • FRP max ${num(frp.max_mw,1)} MW • avg ${num(frp.avg_mw,1)} MW`,
    `Unassigned events: ${Number(data?.unassigned??0)}`,
    "",
    "<b>Sources</b>",
    ...(src.map((x:any)=>`• ${esc(x.source)}: ${Number(x.detections??0)}`))
  ].join("\n");
  const parts=[head];
  let cur="<b>All regions</b>\n";
  for(const r of regions){
    const line=`• ${esc(r.region)}: ${Number(r.events??0)}\n`;
    if(cur.length+line.length>3500){parts.push(cur.trim());cur="<b>All regions (continued)</b>\n"}
    cur+=line;
  }
  if(regions.length)parts.push(cur.trim());
  return parts;
}
async function searchText(sb:any,cmd:string){
  const filters=parseSearch(cmd);
  const {data,error}=await sb.rpc("firewatch_search_events",{p_filters:filters});if(error)throw error;
  const ev=Array.isArray(data?.events)?data.events:[];
  return `🔎 <b>Search</b> • ${ev.length} result(s)\n\n${ev.map(eventLine).join("\n\n")||"Nothing found."}`;
}
async function doctorText(sb:any){
  const {data,error}=await sb.rpc("firewatch_core_diagnostics");if(error)throw error;
  const s=data?.summary??{},checks=Array.isArray(data?.checks)?data.checks:[];
  const bad=checks.filter((x:any)=>x.status!=="pass");
  return [
    `🩺 <b>Core Doctor</b> • ${esc(String(data?.status??"unknown").toUpperCase())}`,
    `PASS ${Number(s.pass??0)} • WARN ${Number(s.warn??0)} • FAIL ${Number(s.fail??0)}`,
    "",
    ...(bad.length?bad.slice(0,12).map((x:any)=>`${x.status==="fail"?"❌":"⚠️"} ${esc(x.message)}`):["✅ No database warnings."]),
    "",
    "For external FIRMS/Telegram credential checks run scripts/validate.*."
  ].join("\n");
}
const help=`<b>Admin commands</b>

<code>/panel</code>
<code>/dashboard</code>
<code>/status</code>
<code>/coverage</code>
<code>/events</code>
<code>/event [ID]</code>
<code>/analytics [hours]</code>
<code>/search id=... region=... status=... source=... min_frp=... min_obs=... min_platforms=... sent=true limit=20</code>
<code>/search coord=50.45,30.52 radius=10</code>
<code>/doctor</code>

Radius: 0.1–500 km. Default 10 km.`;

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  const adminId=Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
  const webhookSecret=Deno.env.get("TELEGRAM_ADMIN_WEBHOOK_SECRET");
  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!token||!adminId||!webhookSecret||!url||!serviceKey)return json({ok:false,error:"Admin environment is incomplete"},500);

  const incoming=req.headers.get("x-telegram-bot-api-secret-token")??"";
  if(incoming!==webhookSecret)return json({ok:false,error:"Unauthorized"},401);

  const sb=createClient(url,serviceKey,{auth:{persistSession:false}});
  const update=await req.json().catch(()=>null);
  if(!update)return json({ok:true});

  const msg=update.message??update.callback_query?.message;
  const chatId=String(msg?.chat?.id??"");
  if(chatId!==String(adminId)){
    if(update.callback_query?.id)try{await tg(token,"answerCallbackQuery",{callback_query_id:update.callback_query.id,text:"Not authorized",show_alert:true})}catch{}
    return json({ok:true,ignored:"not admin"});
  }

  try{
    if(update.callback_query?.id)try{await tg(token,"answerCallbackQuery",{callback_query_id:update.callback_query.id})}catch{}
    const cb=String(update.callback_query?.data??"");
    let text=String(update.message?.text??"").trim();

    if(cb){
      if(cb==="a:dashboard"){
        const u=await dashboardUrl(sb);
        await send(token,chatId,"🌐 <b>Dashboard</b>\nLink is valid for 4 hours.",{inline_keyboard:[[{text:"Open Dashboard",url:u}],[{text:"⬅️ Admin panel",callback_data:"a:status"}]]});
        return json({ok:true});
      }
      if(cb==="a:status")text="/status";
      else if(cb==="a:coverage")text="/coverage";
      else if(cb==="a:events")text="/events";
      else if(cb==="a:analytics24")text="/analytics 24";
      else if(cb==="a:doctor")text="/doctor";
      else if(cb==="a:searchgeo"){await send(token,chatId,"Use: <code>/search coord=50.45,30.52 radius=10</code>",panel);return json({ok:true})}
      else if(cb==="a:searchhelp"){await send(token,chatId,help,panel);return json({ok:true})}
    }

    if(!text||text==="/start"||text==="/panel"||text==="/help"){await send(token,chatId,help,panel);return json({ok:true})}
    if(text.startsWith("/dashboard")){
      const u=await dashboardUrl(sb);
      await send(token,chatId,"🌐 <b>Dashboard</b>\nLink is valid for 4 hours.",{inline_keyboard:[[{text:"Open Dashboard",url:u}],[{text:"⬅️ Admin panel",callback_data:"a:status"}]]});
    }
    else if(text.startsWith("/status"))await send(token,chatId,await statusText(sb),panel);
    else if(text.startsWith("/coverage"))await send(token,chatId,await coverageText(sb),panel);
    else if(text.startsWith("/events"))await send(token,chatId,await eventsText(sb),panel);
    else if(text.startsWith("/event"))await send(token,chatId,await eventText(sb,text.split(/\s+/)[1]),panel);
    else if(text.startsWith("/analytics")){
      const h=Math.max(1,Math.min(8760,Number(text.split(/\s+/)[1]??24)||24));
      await sendChunks(token,chatId,await analyticsParts(sb,h));await send(token,chatId,"Admin panel",panel);
    }else if(text.startsWith("/search"))await send(token,chatId,await searchText(sb,text),panel);
    else if(text.startsWith("/doctor"))await send(token,chatId,await doctorText(sb),panel);
    else await send(token,chatId,help,panel);

    return json({ok:true});
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    try{await send(token,chatId,`❌ <b>Admin error</b>\n${esc(m).slice(0,3000)}`,panel)}catch{}
    return json({ok:false,error:m},500);
  }
});