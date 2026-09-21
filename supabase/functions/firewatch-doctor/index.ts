import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FIRMS_BASE="https://firms.modaps.eosdis.nasa.gov/api/area/csv";

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function mergeStatus(a:string,b:string){const rank:any={pass:0,warn:1,fail:2};return rank[b]>rank[a]?b:a}
function check(id:string,status:string,message:string,fix?:string,extra:any={}){return {id,status,message,...(fix?{fix}:{}),...extra}}
const enc=new TextEncoder();
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function dashboardProbe(sb:any,base:string){
  const {data:secret,error}=await sb.rpc("firewatch_dashboard_secret");
  if(error||!secret)return check("dashboard","fail","Dashboard signing secret is unavailable","Reapply Stage 6 migration.");
  const exp=Math.floor(Date.now()/1000)+300;
  const key=await crypto.subtle.importKey("raw",enc.encode(String(secret)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const raw=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode("dashboard:"+String(exp))));
  const sig=b64url(raw);
  const r=await fetch(base+"/functions/v1/firewatch-dashboard?exp="+exp+"&sig="+encodeURIComponent(sig),{signal:AbortSignal.timeout(20000)});
  const body=await r.text();
  if(!r.ok||!body.includes("FIRMSGeoTools Dashboard"))return check("dashboard","fail",`Dashboard probe failed: HTTP ${r.status}`,"Deploy firewatch-dashboard and rerun validation.");
  return check("dashboard","pass","Signed Dashboard endpoint is reachable");
}

async function checkTelegram(token:string,chatId:string,sendTest:boolean){
  const checks:any[]=[];
  let status="pass";
  try{
    const me=await fetch(`https://api.telegram.org/bot${token}/getMe`,{signal:AbortSignal.timeout(15000)});
    const mb=await me.json().catch(()=>null);
    if(!me.ok||!mb?.ok){
      return {status:"fail",checks:[check("telegram_bot","fail","Telegram bot token is invalid or unavailable","Verify TELEGRAM_BOT_TOKEN in Supabase Edge secrets.")]};
    }
    checks.push(check("telegram_bot","pass",`Bot authenticated as @${mb.result?.username??"unknown"}`));
  }catch(e){
    return {status:"fail",checks:[check("telegram_bot","fail",`Telegram getMe failed: ${e instanceof Error?e.message:String(e)}`,"Check outbound network and TELEGRAM_BOT_TOKEN.")]};
  }

  try{
    const r=await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,{signal:AbortSignal.timeout(15000)});
    const b=await r.json().catch(()=>null);
    if(!r.ok||!b?.ok){
      checks.push(check("telegram_destination","fail","Bot cannot resolve the configured Telegram destination","Verify TELEGRAM_CHAT_ID and ensure the bot has access to the channel/group."));
      status="fail";
    }else{
      checks.push(check("telegram_destination","pass",`Destination resolved: ${b.result?.title??b.result?.username??b.result?.type??"chat"}`));
    }
  }catch(e){
    checks.push(check("telegram_destination","fail",`Telegram getChat failed: ${e instanceof Error?e.message:String(e)}`,"Check TELEGRAM_CHAT_ID and network."));
    status="fail";
  }

  if(sendTest && status!=="fail"){
    try{
      const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({chat_id:chatId,text:"✅ FIRMSGeoTools installation test\nTelegram delivery is configured correctly.",disable_notification:true}),
        signal:AbortSignal.timeout(15000)
      });
      const b=await r.json().catch(()=>null);
      if(!r.ok||!b?.ok){
        checks.push(check("telegram_test_message","fail","Telegram test message could not be sent","Grant the bot permission to publish messages in the destination."));
        status="fail";
      }else{
        checks.push(check("telegram_test_message","pass",`Test message sent (message_id ${b.result?.message_id??"?"})`));
      }
    }catch(e){
      checks.push(check("telegram_test_message","fail",`Telegram test send failed: ${e instanceof Error?e.message:String(e)}`,"Check bot publish permissions."));
      status="fail";
    }
  }else{
    checks.push(check("telegram_test_message","pass","Test message skipped (non-invasive validation mode)"));
  }

  return {status,checks};
}

async function checkFirms(key:string,cfg:any){
  const checks:any[]=[];
  let status="pass";
  if(!Array.isArray(cfg?.bbox)||cfg.bbox.length!==4){
    return {status:"fail",checks:[check("firms_api","fail","Cannot test FIRMS because AOI bbox is unavailable","Configure AOI first.")]};
  }
  const bbox=cfg.bbox.map((x:number)=>Number(x).toFixed(6)).join(",");
  const sources=Array.isArray(cfg?.sources)?cfg.sources:[];
  for(const s of sources){
    try{
      const url=`${FIRMS_BASE}/${encodeURIComponent(key)}/${encodeURIComponent(s.source_id)}/${bbox}/1`;
      const r=await fetch(url,{headers:{"user-agent":"FIRMSGeoTools-doctor/0.3"},signal:AbortSignal.timeout(30000)});
      const body=await r.text();
      if(!r.ok){
        checks.push(check(`firms_${s.source_id}`,"fail",`${s.source_id}: FIRMS HTTP ${r.status}`,"Verify FIRMS_MAP_KEY and source availability."));
        status="fail";
        continue;
      }
      const lines=body.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
      if(lines.length===0||!lines[0].includes("latitude")||!lines[0].includes("longitude")){
        checks.push(check(`firms_${s.source_id}`,"fail",`${s.source_id}: unexpected FIRMS response`,"Verify MAP_KEY and inspect FIRMS API status."));
        status="fail";
      }else{
        checks.push(check(`firms_${s.source_id}`,"pass",`${s.source_id}: API reachable, ${Math.max(0,lines.length-1)} row(s) returned for 1-day bbox test`));
      }
    }catch(e){
      checks.push(check(`firms_${s.source_id}`,"fail",`${s.source_id}: ${e instanceof Error?e.message:String(e)}`,"Check network and FIRMS API availability."));
      status="fail";
    }
  }
  if(sources.length===0){
    checks.push(check("firms_sources","fail","No enabled FIRMS sources","Enable at least one source."));
    status="fail";
  }
  return {status,checks};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);

  const installToken=Deno.env.get("INSTALL_TOKEN"),given=req.headers.get("x-install-token")??"";
  if(!installToken||given!==installToken)return json({ok:false,error:"Unauthorized"},401);

  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const firmsKey=Deno.env.get("FIRMS_MAP_KEY"),tgToken=Deno.env.get("TELEGRAM_BOT_TOKEN"),chatId=Deno.env.get("TELEGRAM_CHAT_ID");
  if(!url||!serviceKey)return json({ok:false,error:"Missing Supabase runtime environment"},500);

  const sb=createClient(url,serviceKey,{auth:{persistSession:false}});
  const body=await req.json().catch(()=>({}));
  const sendTelegramTest=body?.telegram_test===true;

  const {data:db,error:de}=await sb.rpc("firewatch_core_diagnostics");
  if(de)return json({ok:false,error:"Database diagnostics failed",detail:de.message},500);
  const {data:integrity,error:ie}=await sb.rpc("firewatch_integrity_diagnostics");
  if(ie)return json({ok:false,error:"Integrity diagnostics failed",detail:ie.message},500);

  const {data:cfg,error:ce}=await sb.rpc("firewatch_runtime_config");
  if(ce)return json({ok:false,error:"Runtime config failed",detail:ce.message},500);

  const external:any[]=[];
  let overall=String(db?.status??"fail");

  if(!firmsKey){
    external.push(check("firms_secret","fail","FIRMS_MAP_KEY Edge secret is missing","Run supabase secrets set FIRMS_MAP_KEY=..."));
    overall="fail";
  }else{
    const f=await checkFirms(firmsKey,cfg);
    external.push(...f.checks);overall=mergeStatus(overall,f.status);
  }

  if(cfg?.telegram_enabled===false){
    external.push(check("telegram","pass","Telegram is disabled in project configuration"));
  }else if(!tgToken||!chatId){
    external.push(check("telegram_secret","fail","Telegram Edge secrets are incomplete","Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."));
    overall="fail";
  }else{
    const t=await checkTelegram(tgToken,chatId,sendTelegramTest);
    external.push(...t.checks);overall=mergeStatus(overall,t.status);
  }

  const adminId=Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
  const adminSecret=Deno.env.get("TELEGRAM_ADMIN_WEBHOOK_SECRET");
  if(!adminId&&!adminSecret){
    external.push(check("admin_bot","warn","Telegram admin bot is not configured","Set TELEGRAM_ADMIN_CHAT_ID and TELEGRAM_ADMIN_WEBHOOK_SECRET, then rerun setup."));
    overall=mergeStatus(overall,"warn");
  }else if(!adminId||!adminSecret||!tgToken){
    external.push(check("admin_bot","fail","Telegram admin configuration is incomplete","Set TELEGRAM_ADMIN_CHAT_ID, TELEGRAM_ADMIN_WEBHOOK_SECRET and TELEGRAM_BOT_TOKEN."));
    overall="fail";
  }else{
    try{
      const wr=await fetch(`https://api.telegram.org/bot${tgToken}/getWebhookInfo`,{signal:AbortSignal.timeout(15000)});
      const wj=await wr.json().catch(()=>null);
      const expected=url+"/functions/v1/firewatch-admin";
      if(!wr.ok||!wj?.ok){
        external.push(check("admin_webhook","fail","Could not read Telegram webhook status","Rerun setup and check Telegram API availability."));
        overall="fail";
      }else if(String(wj.result?.url??"")!==expected){
        external.push(check("admin_webhook","fail","Telegram admin webhook points to a different URL","Rerun firewatch-setup after deploying firewatch-admin.",{expected,current:wj.result?.url??null}));
        overall="fail";
      }else{
        const pending=Number(wj.result?.pending_update_count??0);
        const lastError=wj.result?.last_error_message??null;
        const st=lastError?"warn":"pass";
        external.push(check("admin_webhook",st,`Admin webhook active; pending updates: ${pending}`,lastError?"Inspect Telegram webhook error and Edge Function logs.":undefined,{last_error:lastError}));
        overall=mergeStatus(overall,st);
      }
    }catch(e){
      external.push(check("admin_webhook","fail",`Telegram webhook check failed: ${e instanceof Error?e.message:String(e)}`,"Check Telegram network/API."));
      overall="fail";
    }
  }

  try{
    const dc=await dashboardProbe(sb,url);
    external.push(dc);
    overall=mergeStatus(overall,dc.status);
  }catch(e){
    external.push(check("dashboard","fail",`Dashboard probe failed: ${e instanceof Error?e.message:String(e)}`,"Deploy firewatch-dashboard and reapply Stage 6 migration."));
    overall="fail";
  }

  const dbChecks=Array.isArray(db?.checks)?db.checks:[];
  const integrityChecks=Array.isArray(integrity?.checks)?integrity.checks:[];
  const all=[...dbChecks,...integrityChecks,...external];
  const summary={
    pass:all.filter((x:any)=>x.status==="pass").length,
    warn:all.filter((x:any)=>x.status==="warn").length,
    fail:all.filter((x:any)=>x.status==="fail").length
  };
  overall=summary.fail>0?"fail":summary.warn>0?"warn":"pass";

  return json({
    ok:overall!=="fail",
    status:overall,
    generated_at:new Date().toISOString(),
    summary,
    database:{status:db?.status,counts:db?.counts,runtime:db?.runtime},
    integrity:{status:integrity?.status,notification_integrity:integrity?.notification_integrity,source_coverage:integrity?.source_coverage,source_baseline:integrity?.source_baseline,geo_integrity:integrity?.geo_integrity},
    checks:all,
    telegram_test_requested:sendTelegramTest
  },overall==="fail"?422:200);
});