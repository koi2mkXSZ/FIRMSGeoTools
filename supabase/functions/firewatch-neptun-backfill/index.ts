import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "@supabase/supabase-js";
import {parseTelegramPage,classify} from "./telegram_parser.ts";

const PROFILE="stage43.5.1-neptun-backfill-v1";
const SOURCES_URL="https://neptun.in.ua/api/v1/sources";

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
async function hash(s:string){const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
function n(v:any,d:number,min:number,max:number){const x=Number(v);return Math.max(min,Math.min(max,Number.isFinite(x)?Math.trunc(x):d))}
function cutoffIso(days:number){return new Date(Date.now()-days*86400000).toISOString()}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const surl=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!surl||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(surl,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  let body:any={};try{body=await req.json()}catch{}
  const days=n(body.days,7,1,365),sourceLimit=n(body.source_limit,8,1,20),pagesPerSource=n(body.pages_per_source,2,1,6);
  const cutoff=cutoffIso(days),started=new Date().toISOString(),warnings:string[]=[];

  let sourcePayload:any;
  try{
    const r=await fetch(SOURCES_URL,{headers:{"user-agent":"GeoWatch-Neptun-Backfill/1.0","accept":"application/json"},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error("sources HTTP "+r.status);
    sourcePayload=await r.json();
  }catch(e){return json({ok:false,error:"source registry fetch failed: "+String(e)},502)}

  const sources=(Array.isArray(sourcePayload?.sources)?sourcePayload.sources:[])
    .filter((s:any)=>typeof s?.handle==="string"&&s.handle.startsWith("@"));
  for(const s of sources){
    await sb.from("neptun_backfill_sources").upsert({
      source_handle:String(s.handle),source_title:String(s.title??s.handle),source_kind:String(s.kind??"unknown"),
      source_region:String(s.region??""),updated_at:started
    },{onConflict:"source_handle",ignoreDuplicates:false});
  }

  const {data:queue,error:qe}=await sb.from("neptun_backfill_sources")
    .select("*").eq("reached_cutoff",false)
    .order("last_attempt_at",{ascending:true,nullsFirst:true}).limit(sourceLimit);
  if(qe)return json({ok:false,error:qe.message},500);

  let pages=0,seen=0,inserted=0,sourcesDone=0;
  const perSource:any[]=[];
  for(const src of queue??[]){
    let before=src.backfill_before_id==null?null:Number(src.backfill_before_id);
    let srcSeen=0,srcInserted=0,oldestId=src.oldest_message_id==null?null:Number(src.oldest_message_id);
    let newestId=src.newest_message_id==null?null:Number(src.newest_message_id);
    let oldestAt=src.oldest_published_at??null,newestAt=src.newest_published_at??null,reached=false,lastError:null;
    try{
      for(let page=0;page<pagesPerSource;page++){
        const handle=String(src.source_handle).replace(/^@/,"");
        const url="https://t.me/s/"+encodeURIComponent(handle)+(before!=null?"?before="+before:"");
        const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 GeoWatch/1.0","accept":"text/html"},signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw new Error("Telegram HTTP "+r.status);
        const html=await r.text();
        const posts=parseTelegramPage(html,src.source_handle);
        pages++;
        if(!posts.length){reached=true;break}
        posts.sort((a,b)=>a.message_id-b.message_id);
        srcSeen+=posts.length;seen+=posts.length;

        const ids=posts.map(p=>p.message_id);
        const {data:existing}=await sb.from("neptun_source_messages").select("message_id")
          .eq("source_handle",src.source_handle).in("message_id",ids);
        const exists=new Set((existing??[]).map((x:any)=>Number(x.message_id)));

        const rows=[];
        for(const p of posts){
          rows.push({
            source_handle:src.source_handle,message_id:p.message_id,source_title:src.source_title,
            source_kind:src.source_kind,source_region:src.source_region,published_at:p.published_at,
            message_text:p.text,message_url:p.url,classification:classify(p.text),
            reconstruction_mode:"telegram_public_archive",collected_at:started,
            raw_hash:await hash(src.source_handle+"|"+p.message_id+"|"+p.published_at+"|"+p.text)
          });
        }
        const {error:ue}=await sb.from("neptun_source_messages").upsert(rows,{onConflict:"source_handle,message_id",ignoreDuplicates:true});
        if(ue)throw ue;
        const fresh=posts.filter(p=>!exists.has(p.message_id)).length;
        srcInserted+=fresh;inserted+=fresh;

        const min=posts[0],max=posts[posts.length-1];
        if(oldestId==null||min.message_id<oldestId)oldestId=min.message_id;
        if(newestId==null||max.message_id>newestId)newestId=max.message_id;
        if(oldestAt==null||Date.parse(min.published_at)<Date.parse(oldestAt))oldestAt=min.published_at;
        if(newestAt==null||Date.parse(max.published_at)>Date.parse(newestAt))newestAt=max.published_at;
        if(Date.parse(min.published_at)<=Date.parse(cutoff)){reached=true;break}
        const next=min.message_id;
        if(before!=null&&next>=before){warnings.push(src.source_handle+": pagination did not advance");break}
        before=next;
      }
      if(reached)sourcesDone++;
    }catch(e){lastError=e instanceof Error?e.message:String(e);warnings.push(src.source_handle+": "+lastError)}
    await sb.from("neptun_backfill_sources").update({
      backfill_before_id:before,newest_message_id:newestId,oldest_message_id:oldestId,
      newest_published_at:newestAt,oldest_published_at:oldestAt,reached_cutoff:reached,
      pages_scanned:Number(src.pages_scanned??0)+Math.ceil(srcSeen/20),
      messages_seen:Number(src.messages_seen??0)+srcSeen,messages_inserted:Number(src.messages_inserted??0)+srcInserted,
      last_error:lastError,last_attempt_at:started,last_success_at:lastError?src.last_success_at:started,updated_at:started
    }).eq("source_handle",src.source_handle);
    perSource.push({source:src.source_handle,seen:srcSeen,inserted:srcInserted,oldest_at:oldestAt,reached_cutoff:reached,error:lastError});
  }

  const {count:totalMessages}=await sb.from("neptun_source_messages").select("*",{count:"exact",head:true})
    .gte("published_at",cutoff);
  const {count:doneCount}=await sb.from("neptun_backfill_sources").select("*",{count:"exact",head:true}).eq("reached_cutoff",true);
  const state={
    status:warnings.length?"warning":"active",profile_version:PROFILE,last_check:started,last_success_run:started,
    target_days:days,cutoff,sources_registry:sources.length,sources_processed:(queue??[]).length,
    sources_reached_cutoff:Number(doneCount??0),pages_fetched:pages,messages_seen:seen,messages_inserted:inserted,
    messages_in_target_window:Number(totalMessages??0),warnings:warnings.slice(-20),
    provenance:"Reconstructed from public Telegram web archives of sources listed by Neptun /api/v1/sources. These rows are not original Neptun tracks.",
    per_source:perSource
  };
  await sb.from("system_state").upsert({key:"monitor_neptun_backfill",value:state,updated_at:started});
  return json({ok:true,state});
});
