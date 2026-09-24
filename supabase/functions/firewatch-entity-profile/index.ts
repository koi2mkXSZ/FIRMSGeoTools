import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const WIKIDATA_API="https://www.wikidata.org/w/api.php";
const CACHE_MS=7*86400_000;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function errText(e:any){return e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify({code:e.code,message:e.message,details:e.details,hint:e.hint}):String(e))}
async function wdApi(params:Record<string,string>){
  const u=new URL(WIKIDATA_API);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u.toString(),{headers:{"accept":"application/json","user-agent":"GeoWatch-EntityProfile/1.0 (FIRMSGeoTools)"},signal:AbortSignal.timeout(12000)});
  const t=await r.text();if(!r.ok)throw new Error("Wikidata HTTP "+r.status+": "+t.slice(0,180));
  try{return JSON.parse(t)}catch{throw new Error("Wikidata invalid JSON")}
}
function langValue(o:any){for(const l of ["uk","ru","en"]){const v=o?.[l]?.value;if(v)return String(v)}return null}
function aliases(o:any){
  const out:string[]=[];for(const l of ["uk","ru","en"])for(const x of Array.isArray(o?.[l])?o[l]:[])if(x?.value&&!out.includes(String(x.value)))out.push(String(x.value));
  return out.slice(0,20);
}
function claimValues(claims:any,p:string){
  return (Array.isArray(claims?.[p])?claims[p]:[]).map((c:any)=>c?.mainsnak?.datavalue?.value).filter((x:any)=>x!=null);
}
function qids(claims:any,p:string){return claimValues(claims,p).map((x:any)=>String(x?.id??"")).filter((x:string)=>/^Q\d+$/.test(x))}
function stringClaims(claims:any,p:string){return claimValues(claims,p).map((x:any)=>typeof x==="string"?x:String(x?.text??"")).filter(Boolean)}
function timeClaim(claims:any,p:string){const x=claimValues(claims,p)[0];const t=String(x?.time??"");return t?t.replace(/^\+/,"").replace(/T00:00:00Z$/,""):null}
function osmUrl(id:string){const m=String(id).match(/^([NWR]):(\d+)$/);if(!m)return null;const t=m[1]==="N"?"node":m[1]==="W"?"way":"relation";return "https://www.openstreetmap.org/"+t+"/"+m[2]}
function prov(source:string,sourceId:string,confidence:number,method:string){return{source,source_id:sourceId,confidence,method,retrieved_at:new Date().toISOString()}}
function setField(profile:any,fp:any,key:string,value:any,p:any){
  if(value==null||(Array.isArray(value)&&!value.length)||value==="")return;
  profile[key]=value;fp[key]=p;
}
function uniq(a:any[]){return [...new Set(a.filter(Boolean).map(x=>String(x)))]}

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
  const entityId=String(e.id),qid=String(e.wikidata_qid??"");
  const {data:cached}=await sb.from("area_entity_profiles").select("*").eq("entity_id",entityId).maybeSingle();
  const age=Date.now()-Date.parse(String(cached?.refreshed_at??""));
  if(cached&&!body.refresh&&Number.isFinite(age)&&age<CACHE_MS)return json({ok:true,cached:true,entity:e,profile_status:cached.status,refreshed_at:cached.refreshed_at,profile:cached.profile,field_provenance:cached.field_provenance,source_status:cached.source_status,errors:cached.errors});

  const profile:any={
    entity_id:entityId,canonical_name:e.canonical_name??null,category:e.category??null,subcategory:e.subcategory??null,
    latitude:e.latitude??null,longitude:e.longitude??null,wikidata_qid:e.wikidata_qid??null,
    identity:{source_count:Number(e.source_count??0),resolution_status:e.resolution_status??null,resolution_confidence:e.resolution_confidence??null}
  };
  const fp:any={},errors:string[]=[],sourceStatus:any={wikidata:qid?"pending":"not_applicable",osm:"not_present",overture:"not_present"};
  setField(profile,fp,"canonical_name",profile.canonical_name,prov("Entity Resolution",entityId,Number(e.resolution_confidence??100),"resolved_identity"));
  setField(profile,fp,"coordinates",{latitude:profile.latitude,longitude:profile.longitude},prov("Entity Resolution",entityId,Number(e.resolution_confidence??100),"resolved_coordinates"));

  const srcs:any[]=Array.isArray(e.sources)?e.sources:[];
  const links:any[]=[];
  const operatorCandidates:string[]=[],websiteCandidates:string[]=[],brandCandidates:string[]=[],osmAliases:string[]=[];
  for(const s of srcs){
    if(s.source==="OpenStreetMap"){
      sourceStatus.osm="active";
      const tags=s?.provenance?.tags??{};
      for(const k of ["name","name:uk","name:ru","official_name"])if(tags[k])osmAliases.push(String(tags[k]));
      if(tags.operator)operatorCandidates.push(String(tags.operator));
      if(tags.brand)brandCandidates.push(String(tags.brand));
      if(tags.website)websiteCandidates.push(String(tags.website));
      const u=osmUrl(String(s.source_id));if(u)links.push({label:"OpenStreetMap",url:u,source_id:s.source_id});
    }else if(s.source==="Overture"){sourceStatus.overture="active"}
  }

  const relLabels=new Map<string,string>();
  if(qid){
    try{
      const w=await wdApi({action:"wbgetentities",ids:qid,props:"labels|descriptions|aliases|claims|sitelinks",languages:"uk|ru|en",format:"json",formatversion:"2"});
      const we=w?.entities?.[qid];if(!we?.missing){
        sourceStatus.wikidata="active";
        const claims=we?.claims??{};
        const related=uniq([...qids(claims,"P31"),...qids(claims,"P17"),...qids(claims,"P131"),...qids(claims,"P127"),...qids(claims,"P137")]);
        if(related.length){
          try{
            const rr=await wdApi({action:"wbgetentities",ids:related.slice(0,50).join("|"),props:"labels",languages:"uk|ru|en",format:"json",formatversion:"2"});
            for(const [id,v] of Object.entries<any>(rr?.entities??{})){const l=langValue(v?.labels);if(l)relLabels.set(id,l)}
          }catch(x){errors.push("Wikidata related labels: "+errText(x))}
        }
        const p=(field:string,conf=100)=>prov("Wikidata",qid,conf,field);
        const wname=langValue(we.labels),desc=langValue(we.descriptions),wa=aliases(we.aliases);
        if(wname)setField(profile,fp,"wikidata_label",wname,p("label"));
        if(desc)setField(profile,fp,"description",desc,p("description"));
        const allAliases=uniq([...(Array.isArray(e.aliases)?e.aliases:[]),...osmAliases,...wa]).filter(x=>x!==profile.canonical_name).slice(0,30);
        setField(profile,fp,"aliases",allAliases,p("aliases",95));
        const labels=(prop:string)=>qids(claims,prop).map(x=>relLabels.get(x)??x);
        setField(profile,fp,"instance_of",labels("P31"),p("P31"));
        setField(profile,fp,"country",labels("P17"),p("P17"));
        setField(profile,fp,"administrative_entity",labels("P131"),p("P131"));
        setField(profile,fp,"owner",labels("P127"),p("P127"));
        setField(profile,fp,"operator",labels("P137"),p("P137"));
        const sites=stringClaims(claims,"P856");if(sites.length)setField(profile,fp,"official_website",sites[0],p("P856"));
        const inception=timeClaim(claims,"P571");if(inception)setField(profile,fp,"inception",inception,p("P571"));
        links.push({label:"Wikidata",url:"https://www.wikidata.org/wiki/"+qid,source_id:qid});
        const uk=we?.sitelinks?.ukwiki?.title;if(uk)links.push({label:"Wikipedia (uk)",url:"https://uk.wikipedia.org/wiki/"+encodeURIComponent(String(uk).replace(/ /g,"_")),source_id:qid});
      }else sourceStatus.wikidata="missing";
    }catch(x){sourceStatus.wikidata="error";errors.push("Wikidata: "+errText(x))}
  }

  if(!profile.operator&&operatorCandidates.length)setField(profile,fp,"operator",uniq(operatorCandidates),prov("OpenStreetMap",srcs.find(x=>x.source==="OpenStreetMap")?.source_id??"",90,"operator_tag"));
  if(!profile.official_website&&websiteCandidates.length)setField(profile,fp,"official_website",websiteCandidates[0],prov("OpenStreetMap",srcs.find(x=>x.source==="OpenStreetMap")?.source_id??"",90,"website_tag"));
  if(brandCandidates.length)setField(profile,fp,"brand",uniq(brandCandidates),prov("OpenStreetMap",srcs.find(x=>x.source==="OpenStreetMap")?.source_id??"",85,"brand_tag"));
  if(!profile.aliases){
    const aa=uniq([...(Array.isArray(e.aliases)?e.aliases:[]),...osmAliases]).filter(x=>x!==profile.canonical_name);
    if(aa.length)setField(profile,fp,"aliases",aa,prov("Entity Resolution",entityId,Number(e.resolution_confidence??90),"source_aliases"));
  }
  if(profile.official_website)links.push({label:"Official website",url:profile.official_website,source_id:"website"});
  profile.links=links;
  profile.sources=srcs.map(s=>({source:s.source,source_id:s.source_id,source_name:s.source_name,match_method:s.match_method,match_confidence:s.match_confidence}));

  const status=sourceStatus.wikidata==="error"?"degraded":"active",now=new Date().toISOString();
  const {error:up}=await sb.from("area_entity_profiles").upsert({entity_id:entityId,refreshed_at:now,status,profile,field_provenance:fp,source_status:sourceStatus,errors,updated_at:now},{onConflict:"entity_id"});
  if(up)throw new Error("profile upsert: "+errText(up));
  return json({ok:true,cached:false,entity:e,profile_status:status,refreshed_at:now,profile,field_provenance:fp,source_status:sourceStatus,errors,policy:"Public-source descriptive profile only; no vulnerability, access-route, target-value or operational-capability assessment."});
});