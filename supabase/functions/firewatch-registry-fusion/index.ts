import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CKAN="https://data.gov.ua/api/3/action/package_search";
const CACHE_MS=24*3600_000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
function norm(v:any){return String(v??"").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/['’\u02bc"]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim()}
function tokens(v:any){return new Set(norm(v).split(" ").filter(x=>x.length>=3))}
function similarity(a:any,b:any){
  const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 1;
  if((x.length>=8&&y.includes(x))||(y.length>=8&&x.includes(y)))return .94;
  const A=tokens(x),B=tokens(y);let i=0;for(const t of A)if(B.has(t))i++;
  const j=(A.size+B.size-i)?i/(A.size+B.size-i):0;
  return j;
}
function usefulQuery(v:any){
  const x=String(v??"").trim();if(x.length<5)return false;
  const n=norm(x);return !["industrial","residential","commercial","government","transport","energy","telecom","water","storage"].includes(n);
}
async function ckanSearch(q:string){
  const u=new URL(CKAN);u.searchParams.set("q",q);u.searchParams.set("rows","10");u.searchParams.set("sort","metadata_modified desc");
  const r=await fetch(u.toString(),{headers:{"accept":"application/json","user-agent":"GeoWatch-RegistryFusion/1.0"},signal:AbortSignal.timeout(15000)});
  const t=await r.text();if(!r.ok)throw new Error("data.gov.ua HTTP "+r.status+": "+t.slice(0,220));
  let j:any;try{j=JSON.parse(t)}catch{throw new Error("data.gov.ua invalid JSON")}
  if(j?.success!==true)throw new Error("data.gov.ua success=false");
  return Array.isArray(j?.result?.results)?j.result.results:[];
}
function asArray(x:any){return Array.isArray(x)?x:x==null?[]:[x]}
function firstOfficialResource(ds:any){
  const rs=Array.isArray(ds?.resources)?ds.resources:[];
  const sorted=[...rs].sort((a:any,b:any)=>Number(Boolean(b?.datastore_active))-Number(Boolean(a?.datastore_active))||String(b?.last_modified??"").localeCompare(String(a?.last_modified??"")));
  const r=sorted.find((x:any)=>/^https?:\/\//i.test(String(x?.url??"")));return r??null;
}
function datasetLanding(ds:any){const id=String(ds?.name??ds?.id??"");return id?"https://data.gov.ua/dataset/"+encodeURIComponent(id):"https://data.gov.ua"}
function isGovUaUrl(v:any){
  try{
    const u=new URL(String(v??""));const h=u.hostname.toLowerCase();
    return h==="gov.ua"||h.endsWith(".gov.ua");
  }catch{return false}
}
function operatorValues(profile:any){
  const v=profile?.operator;return asArray(v).map(String).filter(Boolean);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const bearer=req.headers.get("authorization")??"",cron=req.headers.get("x-cron-secret")??"";
  let authorized=bearer==="Bearer "+key;
  if(!authorized&&cron){const {data}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:cron});authorized=data===true}
  if(!authorized)return json({ok:false,error:"unauthorized"},401);

  const body:any=await req.json().catch(()=>({})),query=String(body.query??body.entity??"").trim();
  if(!query)return json({ok:false,error:"missing query"},400);
  const {data:e,error:ee}=await sb.rpc("firewatch_resolve_area_entity",{p_query:query});if(ee)throw ee;if(!e)return json({ok:false,error:"entity not found"},404);
  const entityId=String(e.id);

  const {data:existing,error:xe}=await sb.from("area_entity_registry_hits").select("last_seen_at").eq("entity_id",entityId).order("last_seen_at",{ascending:false}).limit(1);
  if(xe)throw xe;
  const latest=existing?.[0]?.last_seen_at?Date.parse(existing[0].last_seen_at):NaN;
  if(!body.refresh&&Number.isFinite(latest)&&Date.now()-latest<CACHE_MS){
    const {data:cached,error}=await sb.rpc("firewatch_entity_registry_cached",{p_query:query});if(error)throw error;
    return json({ok:true,cached:true,...cached});
  }

  let profile:any={};
  const {data:pc}=await sb.rpc("firewatch_entity_profile_cached",{p_query:query});
  if(pc?.profile)profile=pc.profile;
  const aliases=asArray(profile.aliases??e.aliases).map(String);
  const operators=operatorValues(profile);
  const qs=[String(e.canonical_name??""),...aliases.slice(0,2),...operators.slice(0,1)].filter(usefulQuery);
  const uniqueQs=[...new Set(qs.map(x=>x.trim()))].slice(0,4);
  const errors:string[]=[],all=new Map<string,any>();
  const officialWebsite=String(profile?.official_website??"").trim();
  if(isGovUaUrl(officialWebsite)){
    const host=new URL(officialWebsite).hostname.toLowerCase();
    const now=new Date().toISOString();
    const {error:ow}=await sb.from("area_entity_registry_hits").upsert({
      entity_id:entityId,source_key:"GOV_UA_OFFICIAL_WEB",external_id:officialWebsite,
      title:String(e.canonical_name??"")+" — official web reference",publisher:host,
      resource_url:officialWebsite,landing_url:officialWebsite,updated_external_at:null,
      match_status:"confirmed",match_confidence:100,
      match_basis:{rule:"Resolved entity profile contains a URL within the gov.ua domain tree.",domain:host,profile_field:"official_website",
        caveat:"Confirms the official web reference, not event relevance or ownership beyond the published source metadata."},
      payload:{domain:host,profile_source:"area_entity_profiles"},first_seen_at:now,last_seen_at:now
    },{onConflict:"entity_id,source_key,external_id"});
    if(ow)errors.push("official web: "+errText(ow));
  }
  for(const q of uniqueQs){
    try{
      const rows=await ckanSearch(q);
      for(const ds of rows){
        const id=String(ds?.id??ds?.name??"");if(!id)continue;
        const prev=all.get(id)??{dataset:ds,queries:[] as string[]};prev.queries.push(q);all.set(id,prev);
      }
    }catch(x){errors.push(q+": "+errText(x))}
  }

  const canonical=String(e.canonical_name??"");
  const entityTerms=[canonical,...aliases,...operators].filter(Boolean);
  const now=new Date().toISOString(),hits:any[]=[];
  for(const {dataset:ds,queries} of all.values()){
    const title=String(ds?.title??ds?.name??""),notes=String(ds?.notes??"");
    const publisher=String(ds?.organization?.title??ds?.author??"");
    let best=0,bestTerm="";
    for(const term of entityTerms){
      const st=similarity(term,title),sn=similarity(term,notes.slice(0,1200))*0.75,sp=operators.some(o=>similarity(o,publisher)>=.85)?0.88:0;
      const s=Math.max(st,sn,sp);if(s>best){best=s;bestTerm=term}
    }
    const exactTitle=entityTerms.some(t=>norm(title)===norm(t));
    const containsTitle=entityTerms.some(t=>norm(t).length>=8&&norm(title).includes(norm(t)));
    let confidence=Math.round(best*100);
    if(exactTitle)confidence=Math.max(confidence,96);
    else if(containsTitle)confidence=Math.max(confidence,90);
    const publisherMatch=operators.some(o=>similarity(o,publisher)>=.82);
    if(publisherMatch)confidence=Math.max(confidence,88);
    if(confidence<55)continue;

    const status=confidence>=90&&(exactTitle||containsTitle||publisherMatch)?"probable":"candidate";
    const res=firstOfficialResource(ds);
    const hit={
      entity_id:entityId,source_key:"DATA_GOV_UA_REGISTRY",external_id:String(ds.id??ds.name),
      title:title||null,publisher:publisher||null,resource_url:res?.url??null,landing_url:datasetLanding(ds),
      updated_external_at:ds?.metadata_modified??null,match_status:status,match_confidence:confidence,
      match_basis:{matched_term:bestTerm,queries:[...new Set(queries)],exact_title:exactTitle,title_contains_entity:containsTitle,publisher_match:publisherMatch,
        rule:"Official dataset search hit; not an automatic object-identity confirmation."},
      payload:{dataset_name:ds?.name??null,notes:String(ds?.notes??"").slice(0,900),license_title:ds?.license_title??null,
        organization:ds?.organization?{id:ds.organization.id,title:ds.organization.title}:null,
        resources:(Array.isArray(ds?.resources)?ds.resources:[]).slice(0,5).map((r:any)=>({id:r.id,name:r.name,format:r.format,url:r.url,datastore_active:r.datastore_active,last_modified:r.last_modified}))},
      first_seen_at:now,last_seen_at:now
    };
    hits.push(hit);
  }
  hits.sort((a,b)=>b.match_confidence-a.match_confidence);

  if(hits.length){
    const {error:up}=await sb.from("area_entity_registry_hits").upsert(hits,{onConflict:"entity_id,source_key,external_id",ignoreDuplicates:false});if(up)throw new Error("registry upsert: "+errText(up));
  }
  const {data:cached,error:ce}=await sb.rpc("firewatch_entity_registry_cached",{p_query:query});if(ce)throw ce;
  return json({ok:true,cached:false,...cached,refresh:{queries:uniqueQs,datasets_considered:all.size,hits_written:hits.length,errors},policy:"Official registry search hits are references, not automatic proof that a dataset describes the same physical entity."});
});