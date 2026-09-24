import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const VERSION="stage40.2-v1";
const LIMIT=180;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function norm(s:any){
  return String(s??"").toLowerCase()
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g," ")
    .replace(/[^\p{L}\p{N}\s.,:;!?-]+/gu," ")
    .replace(/\s+/g," ").trim().slice(0,12000);
}
async function sha256(s:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function stem(s:string){return norm(s).replace(/(ська|ський|ське|ская|ский|ское|область|області|обл\.?)/g,"").trim().slice(0,10)}
function addUnique<T extends {entity_type?:string;canonical?:string;surface?:string;claim_type?:string;object_text?:string;numeric_value?:number|null}>(arr:T[],x:T,key:(v:T)=>string){
  const k=key(x);if(!arr.some(v=>key(v)===k))arr.push(x);
}
function extract(text:string,ctx:any){
  const t=norm(text),entities:any[]=[],claims:any[]=[];
  const addE=(type:string,canonical:string,surface:string,confidence=90,attributes:any={})=>addUnique(entities,{entity_type:type,canonical,surface,confidence,attributes},x=>[x.entity_type,x.canonical,x.surface].join("|"));
  const addC=(type:string,obj:string,n:number|null=null,unit:string|null=null,confidence=85,attributes:any={})=>addUnique(claims,{claim_type:type,subject:null,object_text:obj,numeric_value:n,unit,confidence,attributes},x=>[x.claim_type,x.object_text,String(x.numeric_value)].join("|"));

  const incidents=[
    ["fire",/(пожеж|пожар|fire|blaze|burning|загоріл|загорел)/iu],
    ["explosion",/(вибух|взрыв|explosion|blast)/iu],
    ["smoke",/(дим|дым|smoke)/iu],
    ["strike_or_attack",/(атак|удар|strike|attack|обстріл|обстрел)/iu],
    ["infrastructure_damage",/(пошкоджен|поврежден|destroyed|damaged|руйнув|разруш)/iu],
    ["power_outage",/(без світла|без света|blackout|power outage|знеструм|обесточ)/iu]
  ];
  for(const [name,re] of incidents as any[])if(re.test(t)){addE("incident_type",name,name,88);addC("incident_type",name,null,null,88)}

  const infra=[
    ["fuel_station",/(заправк|азс|gas station|fuel station)/iu],
    ["warehouse",/(склад|warehouse)/iu],
    ["power_facility",/(підстанц|подстанц|тес|грэс|теплоелект|power station|substation)/iu],
    ["transport",/(транспортн|railway|залізнич|железнодорож|transport infrastructure)/iu],
    ["residential",/(житлов|жилой|residential|будинк|дом)/iu],
    ["hospital",/(лікарн|больниц|hospital|пологов)/iu],
    ["industrial",/(промислов|промышлен|industrial|завод|factory)/iu],
    ["shopping",/(торговельн|торговый|shopping|амстор)/iu]
  ];
  for(const [name,re] of infra as any[])if(re.test(t))addE("infrastructure_type",name,name,82);

  const casualties=[
    ["casualties_killed",/(?:загинул\w*|погиб\w*|killed|dead)[^\d]{0,20}(\d{1,4})|(\d{1,4})[^\n,.]{0,30}(?:загинул\w*|погиб\w*|killed|dead)/giu],
    ["casualties_injured",/(?:поранен\w*|постраждал\w*|ранен\w*|injured|wounded)[^\d]{0,20}(\d{1,4})|(\d{1,4})[^\n,.]{0,30}(?:поранен\w*|постраждал\w*|ранен\w*|injured|wounded)/giu]
  ];
  for(const [type,re] of casualties as any[]){
    for(const m of t.matchAll(re)){
      const n=Number(m[1]??m[2]);if(Number.isFinite(n)&&n>=0&&n<=10000)addC(type,String(n),n,"persons",92,{surface:m[0].slice(0,180)});
    }
  }

  const coord=/(-?\d{1,2}\.\d{3,7})\s*[,; ]\s*(-?\d{1,3}\.\d{3,7})/g;
  for(const m of t.matchAll(coord)){
    const lat=Number(m[1]),lon=Number(m[2]);if(lat>=-90&&lat<=90&&lon>=-180&&lon<=180)addE("coordinate",lat.toFixed(5)+","+lon.toFixed(5),m[0],98,{lat,lon});
  }

  let geoStatus="none",geoScore=0;
  const place=norm(ctx.nearest_place_name??"");
  if(place&&place.length>=4&&t.includes(place)){addE("place",place,place,98,{role:"event_nearest_place"});geoStatus="nearest_place";geoScore=100}
  const oblastNames=[ctx.oblast_name,ctx.oblast_name_uk,ctx.oblast_name_en].map((x:any)=>norm(x)).filter((x:string)=>x.length>=4);
  const stems=oblastNames.map(stem).filter((x:string)=>x.length>=4);
  const roots=[...new Set(stems.flatMap((x:string)=>[x.slice(0,4),x.slice(0,5)]))].filter((x:string)=>x.length>=4);
  const foundOblast=oblastNames.find((x:string)=>t.includes(x))??stems.find((x:string)=>t.includes(x))??roots.find((x:string)=>t.includes(x));
  if(foundOblast&&geoScore<90){addE("admin1",norm(ctx.oblast_name_uk??ctx.oblast_name??foundOblast),foundOblast,95,{oblast_id:ctx.oblast_id});geoStatus="oblast";geoScore=90}
  if(geoScore===0){
    const local=(ctx.local_gazetteer??[]).find((p:string)=>p!==place&&p.length>=4&&t.includes(p));
    if(local){addE("place",local,local,86,{role:"nearby_geospatial_reference"});geoStatus="local_reference";geoScore=85}
  }
  if(geoScore===0){
    const other=(ctx.gazetteer??[]).find((p:string)=>p!==place&&p.length>=4&&t.includes(p));
    if(other){addE("place",other,other,82,{role:"other_known_place"});geoStatus="other_known_place";geoScore=10}
  }
  if(geoScore===0&&/(україн|украин|ukraine|ukrainian)/iu.test(t)){addE("country","Ukraine","Ukraine",80);geoStatus="country_only";geoScore=35}

  const foreignSignals=[
    ["Russia/Yakutia",/(якут|нерюнгр|yakutia|nerungri)/iu],
    ["Russia",/(росси[ия]|russia)/iu]
  ];
  let foreignGeo:string|null=null;
  for(const [name,re] of foreignSignals as any[])if(re.test(t)){foreignGeo=name;break}
  if(foreignGeo&&geoScore===0){geoStatus="foreign_location_signal";geoScore=0;addE("geo_warning",foreignGeo,foreignGeo,85)}

  addC("semantic_geo_status",geoStatus,null,null,95,{geo_score:geoScore,foreign_signal:foreignGeo});
  return {entities,claims,geoStatus,geoScore};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  const since=new Date(Date.now()-72*3600_000).toISOString();
  const [pubQ,docQ,oblQ,srcQ,gazQ]=await Promise.all([
    sb.from("event_public_osint").select("id,fire_event_id,source_kind,source_name,source_item_id,published_at,title,source_url,relevance_score,match_basis,payload,updated_at").gte("updated_at",since).order("updated_at",{ascending:false}).limit(LIMIT),
    sb.from("osint_documents").select("id,source_key,external_id,published_at,title,summary,language,last_seen_at,osint_event_links(fire_event_id,relevance_score)").gte("last_seen_at",since).order("last_seen_at",{ascending:false}).limit(LIMIT),
    sb.from("oblasts").select("id,name,name_uk,name_en"),
    sb.from("osint_source_catalog").select("source_key,label,provider,source_class,independent_for_corroboration"),
    sb.from("fire_events").select("nearest_place_name").gte("last_seen",new Date(Date.now()-30*86400000).toISOString()).not("nearest_place_name","is",null).limit(1000)
  ]);
  if(pubQ.error)throw pubQ.error;if(docQ.error)throw docQ.error;if(oblQ.error)throw oblQ.error;if(srcQ.error)throw srcQ.error;if(gazQ.error)throw gazQ.error;
  const oblastMap=new Map((oblQ.data??[]).map((o:any)=>[Number(o.id),o]));
  const sourceMap=new Map((srcQ.data??[]).map((s:any)=>[String(s.source_key),s]));
  const gazetteer=[...new Set((gazQ.data??[]).map((x:any)=>norm(x.nearest_place_name)).filter((x:string)=>x.length>=4))].sort((a:string,b:string)=>b.length-a.length).slice(0,350);

  const eventIds=new Set<string>();
  for(const x of pubQ.data??[])if(x.fire_event_id)eventIds.add(String(x.fire_event_id));
  for(const d of docQ.data??[])for(const l of d.osint_event_links??[])if(l.fire_event_id)eventIds.add(String(l.fire_event_id));
  let events:any[]=[],geoContexts:any[]=[];
  if(eventIds.size){
    const [q,gq]=await Promise.all([
      sb.from("fire_events").select("id,oblast_id,nearest_place_name").in("id",[...eventIds]),
      sb.from("event_geolocation_context").select("fire_event_id,overture_places,geonames_places").in("fire_event_id",[...eventIds])
    ]);
    if(q.error)throw q.error;if(gq.error)throw gq.error;
    events=q.data??[];geoContexts=gq.data??[];
  }
  const geoMap=new Map((geoContexts??[]).map((g:any)=>{
    const names:string[]=[];
    for(const p of Array.isArray(g.overture_places)?g.overture_places:[]){
      for(const v of [p?.name,p?.locality]){const n=norm(v);if(n.length>=4)names.push(n)}
    }
    for(const p of Array.isArray(g.geonames_places)?g.geonames_places:[]){
      for(const v of [p?.name,p?.toponym_name,p?.admin1,...(Array.isArray(p?.alternate_names)?p.alternate_names:[])]){
        const n=norm(v);if(n.length>=4)names.push(n)
      }
    }
    return [String(g.fire_event_id),[...new Set(names)].sort((a:string,b:string)=>b.length-a.length).slice(0,80)];
  }));
  const eventMap=new Map(events.map((e:any)=>{
    const o:any=oblastMap.get(Number(e.oblast_id))??{};
    const local_gazetteer=geoMap.get(String(e.id))??[];
    return [String(e.id),{...e,oblast_name:o.name??null,oblast_name_uk:o.name_uk??null,oblast_name_en:o.name_en??null,gazetteer,local_gazetteer}];
  }));

  const work:any[]=[];
  for(const p of pubQ.data??[])work.push({
    item_key:"public:"+p.id,origin_kind:"public_osint",origin_id:p.id,fire_event_id:p.fire_event_id,
    source_name:p.source_name,source_class:p.source_kind,provider:p.source_name,published_at:p.published_at,
    title:p.title,body:String(p?.payload?.body??p?.payload?.description??p.title??""),language:null,
    original_relevance:Number(p.relevance_score??0),match_basis:p.match_basis??{}
  });
  for(const d of docQ.data??[])for(const l of d.osint_event_links??[]){
    const sm:any=sourceMap.get(String(d.source_key))??{};
    work.push({
      item_key:"fusion:"+d.id+":"+l.fire_event_id,origin_kind:"fusion",origin_id:d.id,fire_event_id:l.fire_event_id,
      source_name:sm.label??d.source_key,source_class:sm.source_class??"fusion",provider:sm.provider??d.source_key,published_at:d.published_at,
      title:d.title,body:d.summary??d.title,language:d.language,
      original_relevance:Number(l.relevance_score??0),match_basis:{independent_for_corroboration:sm.independent_for_corroboration!==false}
    });
  }

  let processed=0,entityCount=0,claimCount=0,clusters=0,geoMismatch=0;
  const affected=new Set<string>();
  for(const w of work.slice(0,LIMIT*2)){
    const ctx=eventMap.get(String(w.fire_event_id))??{};
    const text=String(w.title??"")+"\n"+String(w.body??"");
    const normalized=norm(text);if(!normalized)continue;
    const fingerprint=await sha256(normalized);
    const sem=extract(text,ctx);
    if(["none","foreign_location_signal","other_known_place"].includes(sem.geoStatus)&&w.origin_kind==="public_osint"&&w.source_class==="news")geoMismatch++;

    const up=await sb.from("osint_semantic_items").upsert({
      item_key:w.item_key,origin_kind:w.origin_kind,origin_id:w.origin_id,fire_event_id:w.fire_event_id,
      source_name:w.source_name,source_class:w.source_class,provider:w.provider,published_at:w.published_at,
      title:String(w.title??"").slice(0,2000),body:String(w.body??"").slice(0,12000),normalized_text:normalized,
      fingerprint,language:w.language,semantic_version:VERSION,processed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    },{onConflict:"item_key"}).select("id").single();
    if(up.error)throw up.error;const itemId=up.data.id;
    await sb.from("osint_entities").delete().eq("semantic_item_id",itemId);
    await sb.from("osint_claims").delete().eq("semantic_item_id",itemId);
    if(sem.entities.length){const q=await sb.from("osint_entities").insert(sem.entities.map((x:any)=>({...x,semantic_item_id:itemId})));if(q.error)throw q.error;entityCount+=sem.entities.length}
    const claims=sem.claims.map((x:any)=>({...x,semantic_item_id:itemId,attributes:{...(x.attributes??{}),original_relevance:w.original_relevance,match_basis:w.match_basis}}));
    if(claims.length){const q=await sb.from("osint_claims").insert(claims);if(q.error)throw q.error;claimCount+=claims.length}
    const cq=await sb.rpc("osint_semantic_assign_cluster",{p_item:itemId});if(cq.error)throw cq.error;if(cq.data)clusters++;
    processed++;if(w.fire_event_id)affected.add(String(w.fire_event_id));
  }
  let divergences=0,provenanceStatements=0,pendingReviews=0;
  for(const id of [...affected].slice(0,100)){
    const q=await sb.rpc("osint_refresh_divergences",{p_event:id});if(!q.error)divergences+=Number(q.data?.divergences??0);
    const p=await sb.rpc("firewatch_refresh_statement_provenance",{p_event:id});
    if(!p.error){provenanceStatements+=Number(p.data?.claims_upserted??0)+Number(p.data?.entities_upserted??0)+Number(p.data?.links_upserted??0);pendingReviews=Math.max(pendingReviews,Number(p.data?.pending_reviews??0))}
  }
  const state={status:"active",version:VERSION,last_check:new Date().toISOString(),processed,entities:entityCount,claims:claimCount,cluster_assignments:clusters,events_affected:affected.size,geo_mismatch_candidates:geoMismatch,divergences,provenance_statements:provenanceStatements,pending_reviews:pendingReviews};
  await sb.from("system_state").upsert({key:"monitor_osint_semantic",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
});