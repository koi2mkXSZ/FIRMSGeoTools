import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const UK={minLon:21.5,maxLon:41.5,minLat:43.5,maxLat:53.5};
const USGS="https://earthquake.usgs.gov/fdsnws/event/1/query";
const RELIEFWEB="https://api.reliefweb.int/v2/reports";
const DSNS_PACKAGE="https://data.gov.ua/api/3/action/package_show?id=2c9a217c-250d-49e5-8a33-26967664ad86";

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function iso(v:any){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function cleanText(v:any,n=4000){return String(v??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,n)}
async function fetchJson(url:string,init:RequestInit={}){
  const r=await fetch(url,{...init,headers:{"accept":"application/json","user-agent":"GeoWatch-OSINT-Fusion/1.0",...(init.headers??{})},signal:AbortSignal.timeout(12000)});
  const t=await r.text();
  if(!r.ok)throw new Error(`${r.status} ${t.slice(0,240)}`);
  try{return JSON.parse(t)}catch{throw new Error("invalid JSON: "+t.slice(0,180))}
}
async function save(sb:any,x:any){
  const {data:id,error}=await sb.rpc("upsert_osint_document",{
    p_source_key:x.source_key,p_external_id:x.external_id,p_published_at:x.published_at??null,
    p_source_updated_at:x.source_updated_at??null,p_title:x.title,p_summary:x.summary??null,
    p_url:x.url??null,p_language:x.language??null,p_country_codes:x.country_codes??[],
    p_lat:x.lat??null,p_lon:x.lon??null,p_payload:x.payload??{}
  });
  if(error)throw error;
  const {data:linked,error:le}=await sb.rpc("firewatch_link_osint_document",{p_document:id});
  if(le)throw le;
  return {id,links:Number(linked?.links??0)};
}
async function ingestUsgs(sb:any){
  const u=new URL(USGS);
  u.searchParams.set("format","geojson");
  u.searchParams.set("starttime",new Date(Date.now()-7*86400000).toISOString());
  u.searchParams.set("endtime",new Date().toISOString());
  u.searchParams.set("minlatitude",String(UK.minLat));
  u.searchParams.set("maxlatitude",String(UK.maxLat));
  u.searchParams.set("minlongitude",String(UK.minLon));
  u.searchParams.set("maxlongitude",String(UK.maxLon));
  u.searchParams.set("orderby","time");
  u.searchParams.set("limit","200");
  const d=await fetchJson(u.toString());
  const rows=Array.isArray(d?.features)?d.features:[];
  let stored=0,links=0;
  for(const f of rows){
    const p=f?.properties??{},c=f?.geometry?.coordinates??[];
    const lon=Number(c[0]),lat=Number(c[1]),depth=Number(c[2]);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const id=String(f?.id??p?.code??"").trim();if(!id)continue;
    const r=await save(sb,{
      source_key:"USGS_EQ",external_id:id,published_at:iso(p.time),source_updated_at:iso(p.updated),
      title:String(p.title??("Earthquake "+id)),
      summary:`Magnitude ${p.mag??"—"}; depth ${Number.isFinite(depth)?depth.toFixed(1):"—"} km; status ${p.status??"—"}`,
      url:p.url??null,language:"en",country_codes:["UA"],lat,lon,
      payload:{mag:p.mag??null,place:p.place??null,depth_km:Number.isFinite(depth)?depth:null,alert:p.alert??null,status:p.status??null,tsunami:p.tsunami??null,type:p.type??null}
    });
    stored++;links+=r.links;
  }
  return {status:"active",fetched:rows.length,stored,links};
}
async function ingestReliefWeb(sb:any){
  const appname=Deno.env.get("RELIEFWEB_APPNAME")?.trim();
  if(!appname)return {status:"waiting_appname",stored:0,links:0,note:"Set pre-approved RELIEFWEB_APPNAME"};
  const body={
    limit:50,
    preset:"latest",
    query:{value:"Ukraine",fields:["country.name","title","body"]},
    fields:{include:["title","body","url","date.original","date.changed","source.name","country.iso3","language.code","disaster.name","disaster.type.name"]}
  };
  const d=await fetchJson(`${RELIEFWEB}?appname=${encodeURIComponent(appname)}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
  });
  const rows=Array.isArray(d?.data)?d.data:[];
  let stored=0,links=0;
  for(const x of rows){
    const f=x?.fields??{},id=String(x?.id??"").trim();if(!id)continue;
    const countries=(Array.isArray(f.country)?f.country:[]).map((z:any)=>String(z?.iso3??"")).filter(Boolean);
    if(countries.length&&!countries.includes("UKR"))continue;
    const sources=(Array.isArray(f.source)?f.source:[]).map((z:any)=>z?.name).filter(Boolean);
    const disasters=(Array.isArray(f.disaster)?f.disaster:[]).map((z:any)=>z?.name).filter(Boolean);
    const r=await save(sb,{
      source_key:"RELIEFWEB",external_id:id,published_at:iso(f?.date?.original),source_updated_at:iso(f?.date?.changed),
      title:String(f.title??("ReliefWeb "+id)),summary:cleanText(f.body,3500),url:f.url??null,
      language:Array.isArray(f.language)?String(f.language[0]?.code??""):null,country_codes:countries,
      payload:{sources,disasters,disaster_types:(Array.isArray(f.disaster)?f.disaster:[]).flatMap((z:any)=>z?.type??[]).map((z:any)=>z?.name).filter(Boolean)}
    });
    stored++;links+=r.links;
  }
  return {status:"active",fetched:rows.length,stored,links};
}
async function ingestDsnsOpenData(sb:any){
  const d=await fetchJson(DSNS_PACKAGE);
  const pkg=d?.result??{},resources=Array.isArray(pkg?.resources)?pkg.resources:[];
  const rows=resources.slice().sort((a:any,b:any)=>Date.parse(String(b.last_modified??b.created??""))-Date.parse(String(a.last_modified??a.created??""))).slice(0,12);
  let stored=0;
  for(const x of rows){
    const id=String(x?.id??"").trim();if(!id)continue;
    await save(sb,{
      source_key:"UA_DSNS_OPEN_DATA",external_id:id,published_at:iso(x?.created),source_updated_at:iso(x?.last_modified),
      title:String(x?.name??pkg?.title??"DSNS operational emergency data"),
      summary:cleanText(x?.description??pkg?.notes??"",2500),url:x?.url??null,language:"uk",country_codes:["UKR"],
      payload:{format:x?.format??null,mimetype:x?.mimetype??null,size:x?.size??null,package_id:pkg?.id??null}
    });
    stored++;
  }
  return {status:"active",fetched:resources.length,stored,links:0};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const names=["usgs","reliefweb","dsns_open_data"] as const;
  const funcs=[ingestUsgs,ingestReliefWeb,ingestDsnsOpenData] as const;
  const settled=await Promise.allSettled(funcs.map(fn=>fn(sb)));
  const sources:any={};let active=0;
  settled.forEach((r,i)=>{
    if(r.status==="fulfilled"){sources[names[i]]=r.value;if(r.value.status==="active")active++}
    else sources[names[i]]={status:"error",error:r.reason instanceof Error?r.reason.message:String(r.reason)}
  });
  const state={
    status:active>=2?"active":active>0?"degraded":"error",
    version:"stage40-fusion-v1",
    last_check:new Date().toISOString(),
    sources,
    policy:"Contextual OSINT correlation only; no causal or attribution inference."
  };
  await sb.from("system_state").upsert({key:"monitor_osint_fusion",value:state,updated_at:new Date().toISOString()});
  return json({ok:active>0,state},active>0?200:502);
});