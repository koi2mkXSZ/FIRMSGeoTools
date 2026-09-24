
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";

const PROFILE="stage37-event-osint-v1";
const ALERTS_URL="https://alerts.com.ua/api/states";
const MAX_EVENTS=1;
const NEWS_SCAN_MIN=30;
const EVENT_LOOKBACK_H=36;
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@",trimValues:true});

const FEEDS=[
  {name:"Ukrainska Pravda",url:"https://www.pravda.com.ua/eng/rss/"},
  {name:"Ukrinform",url:"https://www.ukrinform.net/rss/block-lastnews"}
];

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function norm(s:any){return String(s??"").toLowerCase().normalize("NFKC").replace(/[’']/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function safeDate(v:any){
  const z=String(v??"").trim();
  const m=z.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const d=m?new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`):new Date(z);
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
function arr<T>(x:T|T[]|null|undefined):T[]{return x==null?[]:Array.isArray(x)?x:[x]}
function textVal(x:any):string{
  if(x==null)return"";
  if(typeof x==="string"||typeof x==="number")return String(x);
  if(typeof x==="'object'"){
    if("#text" in x)return String(x["#text"]??"");
    if("@" in x)return String(x["@"]??"");
  }
  return String(x??"");
}
function stripHtml(s:string){return s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim()}
function incident(text:string){return /(\bfire\b|\bfires\b|\bblaze\b|\bsmoke\b|\bburning\b|\bburned\b|\bexplosion\b|\bblast\b|пожеж|займан|загор|горить|дим|вибух|пожар|возгоран|дым|взрыв)/i.test(text)}
function oblastStem(name:string){return norm(name).replace(/ська$|цька$|зька$|івська$|инська$|область$/g,"").trim()}
function locationMatch(title:string,e:any){
  const t=norm(title),place=norm(e.nearest_place_name),obl=norm(e.oblast_name),stem=oblastStem(e.oblast_name??"");
  if(place.length>=4&&t.includes(place))return {matched:true,kind:"nearest_place",term:e.nearest_place_name};
  if(obl.length>=4&&t.includes(obl))return {matched:true,kind:"oblast",term:e.oblast_name};
  if(stem.length>=5&&t.includes(stem))return {matched:true,kind:"oblast_stem",term:stem};
  return {matched:false,kind:null,term:null};
}
function relevance(title:string,pub:string|null,e:any,forcedLocation=false){
  let score=0;const reasons:string[]=[];
  if(incident(title)){score+=40;reasons.push("incident_keyword")}
  const lm=locationMatch(title,e);
  if(lm.matched||forcedLocation){score+=35;reasons.push(lm.matched?String(lm.kind):"event_scoped_query")}
  if(pub){
    const dt=Math.abs(Date.parse(pub)-Date.parse(String(e.last_seen)))/3600000;
    if(Number.isFinite(dt)&&dt<=12){score+=25;reasons.push("time_within_12h")}
    else if(Number.isFinite(dt)&&dt<=36){score+=15;reasons.push("time_within_36h")}
  }
  return {score:Math.min(100,score),reasons,location:lm};
}
async function sha(s:string){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32);
}
async function fetchText(url:string,timeout=12000){
  const r=await fetch(url,{headers:{"user-agent":"GeoWatch-EventOSINT/1.0","accept":"application/rss+xml, application/xml, text/xml, application/json, */*"},signal:AbortSignal.timeout(timeout)});
  const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,160)}`);return t;
}
async function inBatches<T>(items:T[],size:number,fn:(x:T)=>Promise<void>){
  for(let i=0;i<items.length;i+=size){
    await Promise.allSettled(items.slice(i,i+size).map(fn));
  }
}
function rssItems(xml:string,source:string){
  const d=parser.parse(xml);
  const raw=arr(d?.rss?.channel?.item).length?arr(d?.rss?.channel?.item):arr(d?.feed?.entry);
  return raw.slice(0,40).map((x:any)=>{
    let title=stripHtml(textVal(x?.title));
    let link=textVal(x?.link);
    if(!link&&x?.link?.["@href"])link=String(x.link["@href"]);
    if(typeof x?.link==="object"&&x?.link?.["@href"])link=String(x.link["@href"]);
    const guid=textVal(x?.guid)||textVal(x?.id)||link||title;
    const published=safeDate(x?.pubDate??x?.published??x?.updated??x?.date);
    const desc=stripHtml(textVal(x?.description??x?.summary??x?.content));
    return {source,title,link,guid,published,description:desc};
  }).filter((x:any)=>x.title);
}
async function upsertItem(sb:any,e:any,item:any,kind="news"){
  const id=await sha(String(item.guid||item.link||item.title));
  const {error}=await sb.from("event_public_osint").upsert({
    fire_event_id:e.id,source_kind:kind,source_name:item.source,source_item_id:id,
    published_at:item.published,title:String(item.title).slice(0,900),
    source_url:item.link?String(item.link).slice(0,1500):null,category:item.category??null,
    relevance_score:item.relevance_score??0,match_basis:item.match_basis??{},payload:item.payload??{},
    last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()
  },{onConflict:"fire_event_id,source_kind,source_name,source_item_id"});
  if(error)throw error;
}
const OBLAST_EN:Record<string,string>={
  "Вінницька":"Vinnytsia","Волинська":"Volyn","Дніпропетровська":"Dnipropetrovsk","Донецька":"Donetsk",
  "Житомирська":"Zhytomyr","Закарпатська":"Zakarpattia","Запорізька":"Zaporizhzhia","Івано-Франківська":"Ivano-Frankivsk",
  "Київська":"Kyiv","Київ":"Kyiv","Кіровоградська":"Kirovohrad","Луганська":"Luhansk","Львівська":"Lviv",
  "Миколаївська":"Mykolaiv","Одеська":"Odesa","Полтавська":"Poltava","Рівненська":"Rivne","Сумська":"Sumy",
  "Тернопільська":"Ternopil","Харківська":"Kharkiv","Херсонська":"Kherson","Хмельницька":"Khmelnytskyi",
  "Черкаська":"Cherkasy","Чернівецька":"Chernivtsi","Чернігівська":"Chernihiv",
  "Автономна Республіка Крим":"Crimea","Севастополь":"Sevastopol"
};
function gdeltQuery(e:any){
  const place=String(e.nearest_place_name??"").trim();
  const asciiPlace=/^[\x00-\x7F]+$/.test(place)&&place.length>=4?place:"";
  const loc=asciiPlace||OBLAST_EN[String(e.oblast_name??"")]||"Ukraine";
  return `"${loc}" (fire OR smoke OR explosion OR blaze OR burning)`;
}
async function gdeltItems(e:any){
  const q=gdeltQuery(e);
  const u=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  u.searchParams.set("query",q);u.searchParams.set("mode","artlist");u.searchParams.set("maxrecords","20");
  u.searchParams.set("format","json");u.searchParams.set("timespan","2d");u.searchParams.set("sort","datedesc");
  const d=JSON.parse(await fetchText(u.toString(),6000));
  const arts=Array.isArray(d?.articles)?d.articles:[];
  const items=arts.map((x:any)=>({
    source:String(x?.domain??x?.sourcecountry??"GDELT"),
    title:stripHtml(String(x?.title??"")),
    link:String(x?.url??""),
    guid:String(x?.url??x?.title??""),
    published:safeDate(x?.seendate),
    description:"",
    payload:{language:x?.language??null,sourcecountry:x?.sourcecountry??null,domain:x?.domain??null}
  })).filter((x:any)=>x.title&&x.link);
  return {q,items};
}
function mapOblastName(name:string,rows:any[]){
  const n=norm(name).replace(/^м\s+/,"").replace(/\s+область$/,"");
  if(n==="київ"||n==="kyiv")return rows.find((x:any)=>x.name_uk==="Київ")?.id??null;
  const translit:Record<string,string>={
    "vinnytsia":"Вінницька","volyn":"Волинська","dnipropetrovsk":"Дніпропетровська","donetsk":"Донецька",
    "zhytomyr":"Житомирська","zakarpattia":"Закарпатська","zaporizhzhia":"Запорізька","ivano frankivsk":"Івано-Франківська",
    "kyiv":"Київська","kirovohrad":"Кіровоградська","luhansk":"Луганська","lviv":"Львівська","mykolaiv":"Миколаївська",
    "odesa":"Одеська","poltava":"Полтавська","rivne":"Рівненська","sumy":"Сумська","ternopil":"Тернопільська",
    "kharkiv":"Харківська","kherson":"Херсонська","khmelnytskyi":"Хмельницька","cherkasy":"Черкаська",
    "chernivtsi":"Чернівецька","chernihiv":"Чернігівська"
  };
  const uk=translit[n];
  if(uk)return rows.find((x:any)=>x.name_uk===uk)?.id??null;
  return rows.find((x:any)=>norm(x.name_uk).replace(/\s+область$/,"")===n||norm(x.name_uk)===n)?.id??null;
}
async function updateAlerts(sb:any,events:any[],oblasts:any[]){
  const data=JSON.parse(await fetchText(ALERTS_URL));
  const states=Array.isArray(data?.states)?data.states:[];
  const providerLast=safeDate(data?.last_update);
  let changes=0,contexts=0;
  const errors:string[]=[];
  await inBatches(states,5,async(st:any)=>{
    try{
      const sid=Number(st.id);if(!Number.isFinite(sid))return;
      const oid=mapOblastName(String(st.name_en??st.name??""),oblasts);
      const changed=safeDate(st.changed);
      const {data:old,error:oldErr}=await sb.from("air_alert_current").select("alert,changed_at").eq("provider_state_id",sid).maybeSingle();
      if(oldErr)throw oldErr;
      const isChange=!old||Boolean(old.alert)!==Boolean(st.alert)||String(old.changed_at??"")!==String(changed??"");
      if(isChange){
        const {error:he}=await sb.from("air_alert_history").upsert({
          provider_state_id:sid,oblast_id:oid,provider_name:String(st.name??""),provider_name_en:String(st.name_en??""),
          alert:Boolean(st.alert),changed_at:changed,observed_at:new Date().toISOString(),raw:st
        },{onConflict:"provider_state_id,alert,changed_at"});
        if(he)throw he;changes++;
      }
      const {error:ce}=await sb.from("air_alert_current").upsert({
        provider_state_id:sid,oblast_id:oid,provider_name:String(st.name??""),provider_name_en:String(st.name_en??""),
        alert:Boolean(st.alert),changed_at:changed,provider_last_update:providerLast,checked_at:new Date().toISOString(),raw:st
      });
      if(ce)throw ce;
      if(!st.alert||oid==null)return;
      for(const e of events.filter((x:any)=>Number(x.oblast_id)===Number(oid))){
        const evtLast=Date.parse(String(e.last_seen)),chg=changed?Date.parse(changed):NaN;
        if(Number.isFinite(chg)&&chg>evtLast+6*3600000)continue;
        const sourceId=`state:${sid}:${changed??"unknown"}:active`;
        const {error:oe}=await sb.from("event_public_osint").upsert({
          fire_event_id:e.id,source_kind:"air_alert",source_name:"alerts.com.ua",source_item_id:sourceId,
          published_at:changed??new Date().toISOString(),
          title:`Air alert active: ${String(st.name??st.name_en??"region")}`,
          category:"air_alert_active",relevance_score:50,
          match_basis:{oblast_id:oid,provider_state_id:sid,state_active_at_scan:true,changed_at:changed,event_window_hours:6},
          payload:{provider_last_update:providerLast,name:st.name??null,name_en:st.name_en??null},
          last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()
        },{onConflict:"fire_event_id,source_kind,source_name,source_item_id"});
        if(oe)throw oe;contexts++;
      }
    }catch(e){errors.push(e instanceof Error?e.message:String(e))}
  });
  if(errors.length)throw new Error("alerts partial failure: "+errors.slice(0,3).join(" | "));
  return {states:states.length,changes,active_contexts:contexts,provider_last_update:providerLast};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const started=Date.now(),warnings:string[]=[];
  const {data:oblasts,error:obe}=await sb.from("oblasts").select("id,name_uk");
  if(obe)return json({ok:false,error:obe.message},502);
  const {data:events,error:ee}=await sb.from("fire_events")
    .select("id,oblast_id,first_seen,last_seen,nearest_place_name,best_latitude,best_longitude,last_latitude,last_longitude,oblasts(name_uk)")
    .gte("last_seen",new Date(Date.now()-EVENT_LOOKBACK_H*3600000).toISOString())
    .order("last_seen",{ascending:false}).limit(20);
  if(ee)return json({ok:false,error:ee.message},502);
  const ev=(events??[]).map((e:any)=>({...e,oblast_name:e.oblasts?.name_uk??""}));
  const ids=ev.map((e:any)=>e.id);
  const {data:scans}=ids.length?await sb.from("event_public_osint_scan").select("*").in("fire_event_id",ids):{data:[]} as any;
  const scanMap=new Map((scans??[]).map((x:any)=>[String(x.fire_event_id),x]));
  const due=ev.filter((e:any)=>{
    const t=Date.parse(String(scanMap.get(String(e.id))?.last_news_scan_at??""));
    return !Number.isFinite(t)||Date.now()-t>=NEWS_SCAN_MIN*60000;
  }).sort((a:any,b:any)=>{
    const ta=Date.parse(String(scanMap.get(String(a.id))?.last_news_scan_at??""));
    const tb=Date.parse(String(scanMap.get(String(b.id))?.last_news_scan_at??""));
    const aa=Number.isFinite(ta)?ta:0,bb=Number.isFinite(tb)?tb:0;
    return aa-bb || Date.parse(String(b.last_seen))-Date.parse(String(a.last_seen));
  }).slice(0,MAX_EVENTS);

  const feedItems:any[]=[];let feedSuccess=0;
  const feedResults=await Promise.allSettled(FEEDS.map(async f=>({f,items:rssItems(await fetchText(f.url,6000),f.name)})));
  for(const x of feedResults){
    if(x.status==="fulfilled"){feedItems.push(...x.value.items);feedSuccess++}
    else warnings.push("RSS: "+(x.reason instanceof Error?x.reason.message:String(x.reason)));
  }

  let newsSeen=0,newsStored=0,gdeltQueries=0;
  for(const e of due){
    const candidates:any[]=[];
    for(const it of feedItems){
      const rel=relevance(it.title+" "+it.description,it.published,e,false);
      if(rel.score>=80)candidates.push({...it,relevance_score:rel.score,match_basis:{reasons:rel.reasons,location:rel.location,method:"rss_filter"}});
    }
    try{
      const g=await gdeltItems(e);gdeltQueries++;
      for(const it of g.items){
        const rel=relevance(it.title+" "+it.description,it.published,e,true);
        if(rel.score>=65){
          candidates.push({...it,relevance_score:rel.score,match_basis:{reasons:rel.reasons,location:rel.location,method:"event_scoped_gdelt",query:g.q},payload:it.payload??{}});
        }
      }
      newsSeen+=candidates.length;
      const seen=new Set<string>();let stored=0;
      for(const it of candidates.sort((a,b)=>Date.parse(b.published??0)-Date.parse(a.published??0)).slice(0,15)){
        const k=norm(it.title).slice(0,100);if(seen.has(k))continue;seen.add(k);
        await upsertItem(sb,e,it,"news");stored++;newsStored++;
      }
      await sb.from("event_public_osint_scan").upsert({
        fire_event_id:e.id,last_news_scan_at:new Date().toISOString(),last_news_query:g.q,
        news_items_seen:candidates.length,news_items_stored:stored,last_error:null,updated_at:new Date().toISOString()
      });
    }catch(err){
      const msg=err instanceof Error?err.message:String(err);warnings.push(`event ${String(e.id).slice(0,8)}: ${msg}`);
      await sb.from("event_public_osint_scan").upsert({
        fire_event_id:e.id,last_news_scan_at:new Date().toISOString(),
        news_items_seen:candidates.length,news_items_stored:0,last_error:msg.slice(0,1200),updated_at:new Date().toISOString()
      });
    }
  }

  let alerts:any={error:null};
  try{alerts=await updateAlerts(sb,ev,oblasts??[])}
  catch(err){alerts={error:err instanceof Error?err.message:String(err)};warnings.push("alerts: "+alerts.error)}

  await inBatches(ev.slice(0,12),3,async(e:any)=>{
    await sb.rpc("firewatch_refresh_event_dossier",{p_event:e.id})
      .abortSignal(AbortSignal.timeout(3000));
  });

  const state={
    status:(alerts?.error&&feedSuccess===0)?"degraded":"active",profile_version:PROFILE,
    last_check:new Date().toISOString(),last_success_run:new Date().toISOString(),
    events_considered:ev.length,events_news_scanned:due.length,gdelt_queries:gdeltQueries,
    feed_sources_ok:feedSuccess,feed_items_seen:feedItems.length,news_candidates_seen:newsSeen,news_items_stored:newsStored,
    alerts,warnings:warnings.slice(-20),
    sources:["GDELT DOC 2.0","Ukrainska Pravda RSS","Ukrinform RSS","alerts.com.ua"],
    policy:"Contextual public-source matching only. Geographic/temporal overlap does not establish cause.",
    elapsed_ms:Date.now()-started
  };
  await sb.from("system_state").upsert({key:"monitor_event_public_osint",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
});
