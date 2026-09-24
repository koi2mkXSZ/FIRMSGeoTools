
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const PROFILE="stage37.1-telegram-osint-v1";
const MAX_SOURCES_PER_RUN=3;
const EVENT_LOOKBACK_H=48;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function norm(s:any){return String(s??"").toLowerCase().normalize("NFKC").replace(/[’']/g,"").replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim()}
function htmlDecode(s:string){
  return s
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#036;/gi,"$")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function stripHtml(s:string){
  return htmlDecode(s.replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g," "))
    .replace(/[ \t]+/g," ").replace(/\s*\n\s*/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function safeDate(v:any){const d=new Date(String(v??""));return Number.isFinite(d.getTime())?d.toISOString():null}
function incident(text:string){
  return /(\bfire\b|\bfires\b|\bblaze\b|\bsmoke\b|\bburning\b|\bburned\b|\bexplosion\b|\bblast\b|пожеж|займан|загор|горить|пал[аио]|дим|вибух|пожар|возгоран|дым|взрыв)/i.test(text);
}
function oblastStem(name:string){
  let s=norm(name);
  s=s.replace(/\s+область$/,"");
  s=s.replace(/(ська|цька|зька|івська|инська|анська|енська)$/,"");
  return s;
}
function placeTokens(name:string){
  const stop=new Set(["сільська","міська","селищна","територіальна","громада","район","область","місто","village","district","region","community"]);
  return norm(name).split(" ").filter((x:string)=>x.length>=4&&!stop.has(x)).slice(0,3);
}
function locationMatch(text:string,e:any){
  const t=norm(text),terms:any[]=[];
  const oblast=norm(e.oblast_name),stem=oblastStem(e.oblast_name??"");
  if(oblast.length>=5)terms.push({kind:"oblast",term:oblast,weight:45});
  if(stem.length>=4)terms.push({kind:"oblast_stem",term:stem,weight:42});
  for(const p of placeTokens(e.nearest_place_name??""))terms.push({kind:"nearest_place",term:p,weight:50});
  for(const x of terms)if(t.includes(x.term))return {matched:true,...x};
  return {matched:false,kind:null,term:null,weight:0};
}
function strictSegmentMatch(text:string,e:any){
  const segments=String(text??"").split(/\n+|(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  for(const s of segments){
    const lm=locationMatch(s,e);
    if(lm.matched&&incident(s))return {matched:true,segment:s.slice(0,500),location:lm};
  }
  return {matched:false,segment:null,location:null};
}
function relevance(text:string,published:string|null,e:any){
  const reasons:string[]=[];let score=0;
  const inc=incident(text);if(inc){score+=35;reasons.push("incident_keyword")}
  const lm=locationMatch(text,e);if(lm.matched){score+=lm.weight;reasons.push(String(lm.kind))}
  if(published){
    const dt=Math.abs(Date.parse(published)-Date.parse(String(e.last_seen)))/3600000;
    if(Number.isFinite(dt)&&dt<=6){score+=20;reasons.push("time_within_6h")}
    else if(Number.isFinite(dt)&&dt<=18){score+=15;reasons.push("time_within_18h")}
    else if(Number.isFinite(dt)&&dt<=36){score+=10;reasons.push("time_within_36h")}
  }
  return {score:Math.min(100,score),reasons,location:lm,incident:inc};
}
async function sha(s:string){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function fetchPreview(channel:string){
  const url=`https://t.me/s/${encodeURIComponent(channel)}`;
  const r=await fetch(url,{
    headers:{"user-agent":"Mozilla/5.0 GeoWatch-OSINT/1.0","accept":"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(12000)
  });
  const html=await r.text();
  if(!r.ok)throw new Error(`HTTP ${r.status}: ${html.slice(0,120)}`);
  const blocks=html.split(/<div class="tgme_widget_message_wrap[^>]*>/i).slice(1);
  const out:any[]=[];
  for(const block of blocks){
    const idm=block.match(/data-post="([^"\/]+)\/(\d+)"/i);
    if(!idm)continue;
    const postId=Number(idm[2]);if(!Number.isFinite(postId))continue;
    const tm=block.match(/<time[^>]*datetime="([^"]+)"/i);
    const published=safeDate(tm?.[1]??null);
    const tx=block.match(/<div class="tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      ?? block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const text=tx?stripHtml(tx[1]):"";
    if(!text)continue;
    out.push({channel:idm[1],post_id:postId,published_at:published,text,url:`https://t.me/${channel}/${postId}`});
  }
  out.sort((a,b)=>a.post_id-b.post_id);
  return out;
}
async function storePost(sb:any,source:any,p:any){
  const hash=await sha(p.text);
  const {error}=await sb.from("telegram_osint_posts").upsert({
    channel:source.channel,post_id:p.post_id,published_at:p.published_at,text:p.text.slice(0,12000),
    source_url:p.url,content_hash:hash,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()
  },{onConflict:"channel,post_id"});
  if(error)throw error;
}
async function matchPost(sb:any,source:any,p:any,events:any[]){
  let matched=0;
  for(const e of events){
    const rel=relevance(p.text,p.published_at,e);
    const strict=source.channel==="dsns_telegram"?strictSegmentMatch(p.text,e):null;
    if(!rel.incident||!rel.location.matched||rel.score<80)continue;
    if(source.channel==="dsns_telegram"&&!strict?.matched)continue;
    const {error}=await sb.from("event_public_osint").upsert({
      fire_event_id:e.id,source_kind:"telegram",source_name:source.label,
      source_item_id:`${source.channel}:${p.post_id}`,
      published_at:p.published_at,title:p.text.slice(0,700),source_url:p.url,
      category:"public_telegram",relevance_score:rel.score,
      match_basis:{
        reasons:rel.reasons,location:rel.location,channel:source.channel,
        source_tier:source.source_tier,method:"telegram_public_preview",
        ...(strict?.matched?{segment_gate:"same_segment",matched_segment:strict.segment}:{})
      },
      payload:{channel:source.channel,post_id:p.post_id,source_tier:source.source_tier},
      last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()
    },{onConflict:"fire_event_id,source_kind,source_name,source_item_id"});
    if(error)throw error;matched++;
  }
  return matched;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const started=Date.now(),warnings:string[]=[];
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,oblast_id,last_seen,nearest_place_name,oblasts(name_uk)")
    .gte("last_seen",new Date(Date.now()-EVENT_LOOKBACK_H*3600000).toISOString())
    .order("last_seen",{ascending:false}).limit(40);
  if(ee)return json({ok:false,error:ee.message},502);
  const ev=(events??[]).map((e:any)=>({...e,oblast_name:e.oblasts?.name_uk??""}));

  const {data:sources,error:se}=await sb.from("telegram_osint_sources")
    .select("*").eq("enabled",true)
    .order("last_checked_at",{ascending:true,nullsFirst:true})
    .limit(MAX_SOURCES_PER_RUN);
  if(se)return json({ok:false,error:se.message},502);

  let sourcesOk=0,postsSeen=0,postsNew=0,eventMatches=0;
  const sourceStates:any[]=[];
  for(const source of sources??[]){
    const now=new Date().toISOString();
    try{
      const posts=await fetchPreview(source.channel);postsSeen+=posts.length;
      const last=Number(source.last_post_id??0);
      const fresh=posts.filter((p:any)=>p.post_id>last);
      for(const p of fresh){
        await storePost(sb,source,p);
        eventMatches+=await matchPost(sb,source,p,ev);
      }
      postsNew+=fresh.length;
      const latest=posts.length?posts[posts.length-1]:null;
      const {error:ue}=await sb.from("telegram_osint_sources").update({
        last_post_id:latest?.post_id??source.last_post_id,
        last_post_at:latest?.published_at??source.last_post_at,
        last_checked_at:now,last_success_at:now,last_error:null,consecutive_failures:0,updated_at:now
      }).eq("channel",source.channel);
      if(ue)throw ue;
      sourcesOk++;
      sourceStates.push({channel:source.channel,status:"active",seen:posts.length,new_posts:fresh.length,latest_post_id:latest?.post_id??null});
    }catch(err){
      const msg=err instanceof Error?err.message:String(err);warnings.push(`${source.channel}: ${msg}`);
      const fail=Number(source.consecutive_failures??0)+1;
      await sb.from("telegram_osint_sources").update({
        last_checked_at:now,last_error:msg.slice(0,1200),consecutive_failures:fail,updated_at:now
      }).eq("channel",source.channel);
      sourceStates.push({channel:source.channel,status:fail>=3?"degraded":"warning",error:msg.slice(0,220)});
    }
  }

  for(let i=0;i<Math.min(ev.length,15);i+=3){
    await Promise.allSettled(ev.slice(i,i+3).map((e:any)=>
      sb.rpc("firewatch_refresh_event_dossier",{p_event:e.id})
        .abortSignal(AbortSignal.timeout(3000))
    ));
  }

  const {count:enabledCount}=await sb.from("telegram_osint_sources").select("*",{count:"exact",head:true}).eq("enabled",true);
  const {count:degradedCount}=await sb.from("telegram_osint_sources").select("*",{count:"exact",head:true}).eq("enabled",true).gte("consecutive_failures",3);
  const state={
    status:Number(degradedCount??0)>0?"degraded":"active",
    profile_version:PROFILE,last_check:new Date().toISOString(),last_success_run:sourcesOk>0?new Date().toISOString():null,
    enabled_sources:enabledCount??0,sources_checked:(sources??[]).length,sources_ok:sourcesOk,
    degraded_sources:degradedCount??0,posts_seen:postsSeen,new_posts:postsNew,event_matches:eventMatches,
    source_states:sourceStates,warnings:warnings.slice(-20),
    match_policy:"Requires incident vocabulary + event geography + temporal proximity. Public Telegram posts are contextual evidence only and do not establish cause.",
    transport:"public t.me/s channel preview; no Telegram user account or bot token used",
    elapsed_ms:Date.now()-started
  };
  await sb.from("system_state").upsert({key:"monitor_telegram_osint",value:state,updated_at:new Date().toISOString()});
  return json({ok:sourcesOk>0,state},sourcesOk>0?200:502);
});
