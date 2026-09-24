import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { fromUrl } from "geotiff";
import proj4 from "proj4";

const STAC="https://earth-search.aws.element84.com/v1";
const COLLECTION="sentinel-2-l2a";
const ROI_RADIUS_M=500;
const GRID=48;
const MAX_SCENE_CLOUD=35;
const MIN_LOCAL_VALID=0.55;
const PRE_DAYS=45;
const POST_DAYS=45;
const AFTER_MIN_HOURS=24;
const MIN_EVENT_AGE_HOURS=24;
const MAX_NEW_PER_RUN=2;
const MAX_RETRY_PER_RUN=1;
const MAX_SCENES_TO_TRY=2;
const RETRY_HOURS=24;
const USER_AGENT="GeoWatch-SatelliteEvidence/1.0 (@NASA_FIRMS)";
const ALGO_VERSION="stage29-s2-v2-offset-aware";

type StacItem={
  id:string;
  bbox?:number[];
  geometry?:any;
  properties:Record<string,any>;
  assets:Record<string,{href:string;type?:string;roles?:string[];title?:string;"raster:bands"?:any[]}>;
  links?:Array<{rel:string;href:string}>;
};

type SceneMetrics={
  item_id:string;
  datetime:string;
  cloud_pct:number|null;
  local_valid_fraction:number;
  nbr:number;
  ndvi:number;
  thumbnail_url:string|null;
  stac_url:string|null;
  epsg:number|null;
  mgrs_tile:string|null;
};

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function iso(d:Date){return d.toISOString()}
function addMs(d:Date,ms:number){return new Date(d.getTime()+ms)}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v))}
function median(a:number[]){if(!a.length)return NaN;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function finite(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
function itemTime(i:StacItem){return Date.parse(String(i.properties?.datetime??""))}
function cloud(i:StacItem){return finite(i.properties?.["eo:cloud_cover"])??999}
function itemSelf(i:StacItem){return i.links?.find(x=>x.rel==="self")?.href??null}
function thumb(i:StacItem){return i.assets?.thumbnail?.href??i.assets?.preview?.href??null}
function containsPoint(i:StacItem,lat:number,lon:number){
  const b=i.bbox;if(!Array.isArray(b)||b.length<4)return true;
  return lon>=Number(b[0])&&lon<=Number(b[2])&&lat>=Number(b[1])&&lat<=Number(b[3]);
}
function projDef(epsg:number){
  if(epsg===4326)return "EPSG:4326";
  if(epsg>=32601&&epsg<=32660)return `+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m +no_defs`;
  if(epsg>=32701&&epsg<=32760)return `+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m +no_defs`;
  throw new Error("Unsupported Sentinel-2 EPSG "+epsg);
}
function assetScaleOffset(item:StacItem,key:string){
  const rb=item.assets?.[key]?.["raster:bands"]?.[0]??{};
  const scale=finite(rb.scale)??1;
  const advertisedOffset=finite(rb.offset)??0;
  const boaApplied=item.properties?.["earthsearch:boa_offset_applied"]===true;
  return{scale,offset:boaApplied?0:advertisedOffset,nodata:rb.nodata??null,boa_offset_applied:boaApplied,advertised_offset:advertisedOffset};
}
function spectralChangeMagnitude(dnbr:number|null){
  if(dnbr==null||!Number.isFinite(dnbr))return null;
  const a=Math.abs(dnbr);
  if(a<0.05)return"minimal";
  if(a<0.15)return"small";
  if(a<0.30)return"moderate";
  return"strong";
}

async function stacSearch(lat:number,lon:number,start:Date,end:Date){
  if(end<=start)return[] as StacItem[];
  const d=0.0025;
  const body={
    collections:[COLLECTION],
    bbox:[lon-d,lat-d,lon+d,lat+d],
    datetime:`${iso(start)}/${iso(end)}`,
    query:{"eo:cloud_cover":{lte:MAX_SCENE_CLOUD}},
    limit:12
  };
  const r=await fetch(`${STAC}/search`,{
    method:"POST",
    headers:{"content-type":"application/json","accept":"application/geo+json","user-agent":USER_AGENT},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Earth Search HTTP ${r.status}: ${text.slice(0,280)}`);
  const djson=JSON.parse(text);
  return (Array.isArray(djson?.features)?djson.features:[]).filter((x:StacItem)=>containsPoint(x,lat,lon));
}

async function readAsset(item:StacItem,key:string,lat:number,lon:number,resampleMethod:"nearest"|"bilinear"){
  const href=item.assets?.[key]?.href;
  if(!href)throw new Error(`STAC item ${item.id} has no asset ${key}`);
  const epsg=finite(item.properties?.["proj:epsg"]);
  if(!epsg)throw new Error(`STAC item ${item.id} missing proj:epsg`);
  const [x,y]=proj4("EPSG:4326",projDef(epsg),[lon,lat]);
  const bbox=[x-ROI_RADIUS_M,y-ROI_RADIUS_M,x+ROI_RADIUS_M,y+ROI_RADIUS_M];
  const tiff=await fromUrl(href,{headers:{"User-Agent":USER_AGENT}});
  const rr:any=await tiff.readRasters({bbox,width:GRID,height:GRID,resampleMethod,fillValue:0});
  const arr:any=rr?.[0];
  if(!arr||!arr.length)throw new Error(`Empty raster for ${key} ${item.id}`);
  return{data:arr,epsg,meta:assetScaleOffset(item,key)};
}

async function analyzeItem(item:StacItem,lat:number,lon:number):Promise<SceneMetrics>{
  const [red,nir,swir,scl]=await Promise.all([
    readAsset(item,"red",lat,lon,"bilinear"),
    readAsset(item,"nir",lat,lon,"bilinear"),
    readAsset(item,"swir22",lat,lon,"bilinear"),
    readAsset(item,"scl",lat,lon,"nearest")
  ]);
  const n=Math.min(red.data.length,nir.data.length,swir.data.length,scl.data.length);
  const nbrVals:number[]=[],ndviVals:number[]=[];
  let valid=0;
  for(let i=0;i<n;i++){
    const s=Number(scl.data[i]);
    if([0,1,3,8,9,10,11].includes(s))continue;
    const rraw=Number(red.data[i]),nraw=Number(nir.data[i]),sraw=Number(swir.data[i]);
    if(!Number.isFinite(rraw)||!Number.isFinite(nraw)||!Number.isFinite(sraw)||rraw<=0||nraw<=0||sraw<=0)continue;
    const rv=rraw*red.meta.scale+red.meta.offset;
    const nv=nraw*nir.meta.scale+nir.meta.offset;
    const sv=sraw*swir.meta.scale+swir.meta.offset;
    if(!Number.isFinite(rv)||!Number.isFinite(nv)||!Number.isFinite(sv)||rv<=0||nv<=0||sv<=0)continue;
    const nd=nv+rv,nb=nv+sv;
    if(Math.abs(nd)<1e-12||Math.abs(nb)<1e-12)continue;
    const ndvi=(nv-rv)/nd,nbr=(nv-sv)/nb;
    if(!Number.isFinite(ndvi)||!Number.isFinite(nbr))continue;
    valid++;ndviVals.push(clamp(ndvi,-1,1));nbrVals.push(clamp(nbr,-1,1));
  }
  const frac=n?valid/n:0;
  if(valid<20)throw new Error(`Too few valid local pixels (${valid}/${n})`);
  return{
    item_id:item.id,
    datetime:String(item.properties?.datetime),
    cloud_pct:finite(item.properties?.["eo:cloud_cover"]),
    local_valid_fraction:Number(frac.toFixed(4)),
    nbr:Number(median(nbrVals).toFixed(4)),
    ndvi:Number(median(ndviVals).toFixed(4)),
    thumbnail_url:thumb(item),
    stac_url:itemSelf(item),
    epsg:finite(item.properties?.["proj:epsg"]),
    mgrs_tile:String(item.properties?.["mgrs:tile"]??item.properties?.["s2:mgrs_tile"]??"")||null
  };
}

async function bestScene(kind:"before"|"after",lat:number,lon:number,eventTime:Date){
  const hour=3600e3,day=86400e3;
  const start=kind==="before"?addMs(eventTime,-PRE_DAYS*day):addMs(eventTime,AFTER_MIN_HOURS*hour);
  const end=kind==="before"?addMs(eventTime,-hour):new Date(Math.min(Date.now(),eventTime.getTime()+POST_DAYS*day));
  if(end<=start)return{scene:null as SceneMetrics|null,candidates:0,errors:[] as string[]};
  let items=await stacSearch(lat,lon,start,end);
  items=items.filter(x=>x.assets?.red?.href&&x.assets?.nir?.href&&x.assets?.swir22?.href&&x.assets?.scl?.href);
  items.sort((a,b)=>{
    const ta=itemTime(a),tb=itemTime(b);
    if(kind==="before"){
      const dt=(eventTime.getTime()-ta)-(eventTime.getTime()-tb);
      return dt!==0?dt:cloud(a)-cloud(b);
    }else{
      const dt=(ta-eventTime.getTime())-(tb-eventTime.getTime());
      return dt!==0?dt:cloud(a)-cloud(b);
    }
  });
  const errors:string[]=[];
  for(const item of items.slice(0,MAX_SCENES_TO_TRY)){
    try{
      const m=await analyzeItem(item,lat,lon);
      if(m.local_valid_fraction<MIN_LOCAL_VALID){errors.push(`${item.id}: local valid ${m.local_valid_fraction}`);continue}
      return{scene:m,candidates:items.length,errors};
    }catch(e){errors.push(`${item.id}: ${e instanceof Error?e.message:String(e)}`)}
  }
  return{scene:null,candidates:items.length,errors};
}

function pairPayload(before:SceneMetrics|null,after:SceneMetrics|null){
  const dnbr=before&&after?Number((before.nbr-after.nbr).toFixed(4)):null;
  const dndvi=before&&after?Number((after.ndvi-before.ndvi).toFixed(4)):null;
  return{dnbr,dndvi,spectral_change_magnitude:spectralChangeMagnitude(dnbr)};
}

async function buildEvidence(lat:number,lon:number,eventTime:Date,existing:any=null){
  let before:SceneMetrics|null=null,after:SceneMetrics|null=null;
  const errors:string[]=[];
  let beforeCandidates=0,afterCandidates=0;

  if(existing?.before_item_id&&existing?.before_nbr!=null&&existing?.before_ndvi!=null){
    before={
      item_id:existing.before_item_id,datetime:existing.before_datetime,cloud_pct:finite(existing.before_cloud_pct),
      local_valid_fraction:Number(existing.before_local_valid_fraction??0),nbr:Number(existing.before_nbr),ndvi:Number(existing.before_ndvi),
      thumbnail_url:existing.before_thumbnail_url??null,stac_url:existing.before_stac_url??null,epsg:null,mgrs_tile:null
    };
  }else{
    const b=await bestScene("before",lat,lon,eventTime);before=b.scene;beforeCandidates=b.candidates;errors.push(...b.errors.map(x=>"before "+x));
  }

  const a=await bestScene("after",lat,lon,eventTime);after=a.scene;afterCandidates=a.candidates;errors.push(...a.errors.map(x=>"after "+x));
  const pair=pairPayload(before,after);

  let status:"waiting_after"|"partial"|"ready"|"no_imagery";
  if(before&&after)status="ready";
  else if(before&&!after)status="waiting_after";
  else if(!before&&after)status="partial";
  else status="no_imagery";

  return{before,after,...pair,status,errors,beforeCandidates,afterCandidates};
}

async function buildBeforeOnly(lat:number,lon:number,eventTime:Date,existing:any=null){
  if(existing?.before_item_id&&existing?.before_nbr!=null&&existing?.before_ndvi!=null){
    const before={
      item_id:existing.before_item_id,datetime:existing.before_datetime,cloud_pct:finite(existing.before_cloud_pct),
      local_valid_fraction:Number(existing.before_local_valid_fraction??0),nbr:Number(existing.before_nbr),ndvi:Number(existing.before_ndvi),
      thumbnail_url:existing.before_thumbnail_url??null,stac_url:existing.before_stac_url??null,epsg:null,mgrs_tile:null
    };
    return{before,after:null,dnbr:null,dndvi:null,spectral_change_magnitude:null,status:"waiting_after",errors:[],beforeCandidates:0,afterCandidates:0,next_retry_at:iso(addMs(eventTime,AFTER_MIN_HOURS*3600e3))};
  }
  const b=await bestScene("before",lat,lon,eventTime);
  const next=iso(new Date(Math.max(Date.now()+3600e3,eventTime.getTime()+AFTER_MIN_HOURS*3600e3)));
  return{
    before:b.scene,after:null,dnbr:null,dndvi:null,spectral_change_magnitude:null,
    status:b.scene?"waiting_after":"no_imagery",
    errors:b.errors.map(x=>"before "+x),beforeCandidates:b.candidates,afterCandidates:0,next_retry_at:next
  };
}

async function persistEvidence(sb:any,e:any,built:any){
  const now=new Date(),next=built.status==="ready"?null:(built.next_retry_at??iso(addMs(now,RETRY_HOURS*3600e3)));
  const b=built.before,a=built.after;
  const row={
    fire_event_id:e.id,provider:"Element84 Earth Search",collection:COLLECTION,algorithm_version:ALGO_VERSION,status:built.status,
    searched_at:iso(now),next_retry_at:next,event_time:e.first_seen,latitude:e.lat,longitude:e.lon,
    roi_radius_m:ROI_RADIUS_M,max_scene_cloud_pct:MAX_SCENE_CLOUD,
    before_item_id:b?.item_id??null,before_datetime:b?.datetime??null,before_cloud_pct:b?.cloud_pct??null,
    before_local_valid_fraction:b?.local_valid_fraction??null,before_nbr:b?.nbr??null,before_ndvi:b?.ndvi??null,
    before_thumbnail_url:b?.thumbnail_url??null,before_stac_url:b?.stac_url??null,
    after_item_id:a?.item_id??null,after_datetime:a?.datetime??null,after_cloud_pct:a?.cloud_pct??null,
    after_local_valid_fraction:a?.local_valid_fraction??null,after_nbr:a?.nbr??null,after_ndvi:a?.ndvi??null,
    after_thumbnail_url:a?.thumbnail_url??null,after_stac_url:a?.stac_url??null,
    dnbr:built.dnbr,dndvi:built.dndvi,spectral_change_magnitude:built.spectral_change_magnitude,
    source_metadata:{
      algorithm_version:ALGO_VERSION,pre_days:PRE_DAYS,post_days:POST_DAYS,after_min_hours:AFTER_MIN_HOURS,grid:GRID,min_local_valid:MIN_LOCAL_VALID,
      before_candidates:built.beforeCandidates,after_candidates:built.afterCandidates,
      before_epsg:b?.epsg??null,after_epsg:a?.epsg??null,before_mgrs:b?.mgrs_tile??null,after_mgrs:a?.mgrs_tile??null,
      errors:built.errors.slice(-8)
    },
    last_error:null,updated_at:iso(now)
  };
  const {error}=await sb.from("satellite_surface_evidence").upsert(row);
  if(error)throw error;
  return row;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  let body:any={};try{body=await req.json()}catch{}
  if(body?.mode==="probe"){
    const lat=finite(body.lat)??49.0,lon=finite(body.lon)??31.0;
    const eventTime=new Date(String(body.event_time??"2026-09-01T12:00:00Z"));
    if(!Number.isFinite(eventTime.getTime()))return json({ok:false,error:"invalid event_time"},400);
    const started=performance.now();
    const built=await buildEvidence(lat,lon,eventTime,null);
    return json({ok:true,mode:"probe",lat,lon,event_time:iso(eventTime),elapsed_ms:Math.round(performance.now()-started),...built});
  }

  if(body?.mode==="event"){
    const q=String(body.event_id??"").trim();
    if(!q)return json({ok:false,error:"event_id required"},400);
    const {data:rows,error:re}=await sb.from("fire_events")
      .select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
      .eq("id",q).order("last_seen",{ascending:false}).limit(1);
    if(re)return json({ok:false,error:re.message},502);
    const ev:any=rows?.[0];if(!ev)return json({ok:false,error:"event not found"},404);
    const lat=finite(ev.best_latitude??ev.last_latitude),lon=finite(ev.best_longitude??ev.last_longitude);
    if(lat==null||lon==null)return json({ok:false,error:"event has no coordinates"},422);
    const eventTime=new Date(String(ev.first_seen));
    const eventAgeH=(Date.now()-eventTime.getTime())/3600000;
    if(!Number.isFinite(eventAgeH))return json({ok:false,error:"invalid event time"},422);
    const {data:old}=await sb.from("satellite_surface_evidence").select("*").eq("fire_event_id",ev.id).maybeSingle();
    const started=performance.now();
    const built=eventAgeH<MIN_EVENT_AGE_HOURS
      ? await buildBeforeOnly(lat,lon,eventTime,old??null)
      : await buildEvidence(lat,lon,eventTime,old??null);
    const row=await persistEvidence(sb,{...ev,lat,lon},built);
    try{await sb.rpc("firewatch_refresh_event_dossier",{p_event:ev.id})}catch{}
    return json({ok:true,mode:"event",event_id:ev.id,event_age_h:Number(eventAgeH.toFixed(2)),prefetch_only:eventAgeH<MIN_EVENT_AGE_HOURS,elapsed_ms:Math.round(performance.now()-started),status:built.status,before:built.before,after:built.after,dnbr:built.dnbr,dndvi:built.dndvi,spectral_change_magnitude:built.spectral_change_magnitude,row});
  }

  const started=performance.now(),warnings:string[]=[];
  const nowIso=iso(new Date());
  const {data:retryRows,error:rr}=await sb.from("satellite_surface_evidence")
    .select("fire_event_id,status,next_retry_at,event_time")
    .neq("status","ready").lte("next_retry_at",nowIso)
    .order("event_time",{ascending:false}).limit(20);
  if(rr)return json({ok:false,error:rr.message},502);
  const retryIds=(retryRows??[]).slice(0,MAX_RETRY_PER_RUN).map((x:any)=>x.fire_event_id);
  let retryEvents:any[]=[];
  if(retryIds.length){
    const {data,error}=await sb.from("fire_events")
      .select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,multisource_count,observation_count")
      .in("id",retryIds);
    if(error)return json({ok:false,error:error.message},502);
    retryEvents=data??[];
  }

  const {data:newCandidates,error:ee}=await sb.from("fire_events")
    .select("id,first_seen,last_seen,best_latitude,best_longitude,last_latitude,last_longitude,multisource_count,observation_count")
    .gte("last_seen",iso(addMs(new Date(),-30*86400e3)))
    .lte("first_seen",iso(addMs(new Date(),-MIN_EVENT_AGE_HOURS*3600e3)))
    .or("multisource_count.gte.2,observation_count.gte.3")
    .order("multisource_count",{ascending:false})
    .order("observation_count",{ascending:false})
    .order("last_seen",{ascending:false})
    .limit(100);
  if(ee)return json({ok:false,error:ee.message},502);

  const candidateIds=(newCandidates??[]).map((x:any)=>x.id);
  const {data:existing,error:xe}=candidateIds.length?await sb.from("satellite_surface_evidence").select("*").in("fire_event_id",candidateIds):{data:[],error:null} as any;
  if(xe)return json({ok:false,error:xe.message},502);
  const existingMap=new Map((existing??[]).map((x:any)=>[String(x.fire_event_id),x]));

  const due:any[]=[];
  for(const raw of retryEvents){
    const lat=finite(raw.best_latitude??raw.last_latitude),lon=finite(raw.best_longitude??raw.last_longitude);
    if(lat==null||lon==null)continue;
    const {data:old}=await sb.from("satellite_surface_evidence").select("*").eq("fire_event_id",raw.id).maybeSingle();
    due.push({...raw,lat,lon,existing:old??null,reason:"retry"});
  }
  let addedNew=0;
  for(const raw of newCandidates??[]){
    if(addedNew>=MAX_NEW_PER_RUN)break;
    if(retryIds.includes(raw.id)||existingMap.has(String(raw.id)))continue;
    const lat=finite(raw.best_latitude??raw.last_latitude),lon=finite(raw.best_longitude??raw.last_longitude);
    if(lat==null||lon==null)continue;
    due.push({...raw,lat,lon,existing:null,reason:"new"});
    addedNew++;
  }

  let processed=0,ready=0,waiting_after=0,partial=0,no_imagery=0,failed=0;
  for(const e of due){
    try{
      const built=await buildEvidence(e.lat,e.lon,new Date(e.first_seen),e.existing);
      await persistEvidence(sb,e,built);
      try{await sb.rpc("firewatch_refresh_event_dossier",{p_event:e.id})}catch{}
      processed++;
      if(built.status==="ready")ready++;
      else if(built.status==="waiting_after")waiting_after++;
      else if(built.status==="partial")partial++;
      else no_imagery++;
    }catch(err){
      failed++;const msg=err instanceof Error?err.message:String(err);warnings.push(String(e.id).slice(0,8)+": "+msg);
      const now=new Date();
      await sb.from("satellite_surface_evidence").upsert({
        fire_event_id:e.id,provider:"Element84 Earth Search",collection:COLLECTION,algorithm_version:ALGO_VERSION,status:"error",
        searched_at:iso(now),next_retry_at:iso(addMs(now,RETRY_HOURS*3600e3)),event_time:e.first_seen,
        latitude:e.lat,longitude:e.lon,roi_radius_m:ROI_RADIUS_M,max_scene_cloud_pct:MAX_SCENE_CLOUD,
        source_metadata:{error_at:iso(now)},last_error:msg.slice(0,1800),updated_at:iso(now)
      });
    }
  }

  const state={
    status:failed>0&&processed===0?"degraded":"active",
    source:"Element84 Earth Search / Sentinel-2 L2A Cloud-Optimized GeoTIFF",
    collection:COLLECTION,algorithm_version:ALGO_VERSION,last_check:iso(new Date()),last_success_run:iso(new Date()),
    automatic_new_window_days:30,min_event_age_hours:MIN_EVENT_AGE_HOURS,after_min_hours:AFTER_MIN_HOURS,pre_window_days:PRE_DAYS,post_window_days:POST_DAYS,
    roi_radius_m:ROI_RADIUS_M,grid:GRID,max_scene_cloud_pct:MAX_SCENE_CLOUD,min_local_valid:MIN_LOCAL_VALID,
    due_events:due.length,new_selected:due.filter((x:any)=>x.reason==="new").length,retry_selected:due.filter((x:any)=>x.reason==="retry").length,processed,ready,waiting_after,partial,no_imagery,failed,
    warnings:warnings.slice(-20),
    method:"delayed surface verification; median local NBR=(NIR-SWIR2)/(NIR+SWIR2), NDVI=(NIR-Red)/(NIR+Red), Sentinel-2 SCL cloud mask",
    interpretation:"surface spectral change only; non-causal"
  };
  await sb.from("system_state").upsert({key:"monitor_satellite_evidence",value:state,updated_at:iso(new Date())});
  return json({ok:true,state,elapsed_ms:Math.round(performance.now()-started)});
});