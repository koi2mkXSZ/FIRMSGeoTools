
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "npm:fflate@0.8.2";
import { fromArrayBuffer } from "npm:geotiff@2.1.3";

const PROFILE="ghsl-r2023a-e2025-30ss-v1";
const EPOCH=2025;
const MAX_RADIUS_M=10000;
const MOVE_REQUERY_M=750;
const MAX_EVENTS=10;
const MAX_REFRESH=6;

type Product="POP"|"BUILT";
type TileRef={r:number,c:number};
type LoadedTile={product:Product,r:number,c:number,url:string,bbox:number[],width:number,height:number,image:any};

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function num(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function havM(lat1:number,lon1:number,lat2:number,lon2:number){
  const p=Math.PI/180,R=6371000,dlat=(lat2-lat1)*p,dlon=(lon2-lon1)*p;
  const a=Math.sin(dlat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function tileFor(lat:number,lon:number):TileRef{
  return {r:Math.max(1,Math.min(18,Math.floor((90-lat)/10)+1)),c:Math.max(1,Math.min(36,Math.floor((lon+180)/10)+1))};
}
function productBase(product:Product){
  return product==="POP"?"GHS_POP_E2025_GLOBE_R2023A_4326_30ss":"GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss";
}
function productRoot(product:Product){
  return product==="POP"?"GHS_POP_GLOBE_R2023A":"GHS_BUILT_S_GLOBE_R2023A";
}
function tileUrl(product:Product,r:number,c:number){
  const base=productBase(product);
  return `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/${productRoot(product)}/${base}/V1-0/tiles/${base}_V1_0_R${r}_C${c}.zip`;
}
function neededTiles(lat:number,lon:number,radiusM:number){
  const dLat=radiusM/111320;
  const dLon=radiusM/(111320*Math.max(.2,Math.cos(lat*Math.PI/180)));
  const pts=[[lat,lon],[lat-dLat,lon-dLon],[lat-dLat,lon+dLon],[lat+dLat,lon-dLon],[lat+dLat,lon+dLon]];
  const m=new Map<string,TileRef>();
  for(const [a,b] of pts){const t=tileFor(a,b);m.set(t.r+":"+t.c,t)}
  return [...m.values()];
}
async function loadTile(product:Product,t:TileRef,cache:Map<string,Promise<LoadedTile>>){
  const key=product+":"+t.r+":"+t.c;
  let p=cache.get(key);
  if(!p){
    p=(async()=>{
      const url=tileUrl(product,t.r,t.c);
      const resp=await fetch(url,{headers:{"user-agent":"GeoWatch-GHSL/1.0"},signal:AbortSignal.timeout(30000)});
      if(!resp.ok)throw new Error(`${product} R${t.r}C${t.c} HTTP ${resp.status}`);
      const zip=new Uint8Array(await resp.arrayBuffer());
      const files=unzipSync(zip);
      const name=Object.keys(files).find(x=>x.toLowerCase().endsWith(".tif"));
      if(!name)throw new Error(`${product} R${t.r}C${t.c}: GeoTIFF missing`);
      const b=files[name];
      const copy=new Uint8Array(b.byteLength);copy.set(b);
      const tif=await fromArrayBuffer(copy.buffer);
      const image=await tif.getImage();
      return {product,r:t.r,c:t.c,url,bbox:image.getBoundingBox(),width:image.getWidth(),height:image.getHeight(),image};
    })();
    cache.set(key,p);
  }
  return await p;
}
function pointInBbox(lat:number,lon:number,b:number[]){return lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]}
function pxFor(lat:number,lon:number,t:LoadedTile){
  const [minx,miny,maxx,maxy]=t.bbox;
  const x=Math.max(0,Math.min(t.width-1,Math.floor((lon-minx)/(maxx-minx)*t.width)));
  const y=Math.max(0,Math.min(t.height-1,Math.floor((maxy-lat)/(maxy-miny)*t.height)));
  return {x,y};
}
async function cellValue(lat:number,lon:number,tiles:LoadedTile[]){
  const t=tiles.find(x=>pointInBbox(lat,lon,x.bbox));
  if(!t)return null;
  const {x,y}=pxFor(lat,lon,t);
  const ras:any=await t.image.readRasters({window:[x,y,x+1,y+1]});
  const v=Number(ras?.[0]?.[0]);
  return Number.isFinite(v)&&v>=0?v:null;
}
async function productRings(product:Product,lat:number,lon:number,cache:Map<string,Promise<LoadedTile>>){
  const refs=neededTiles(lat,lon,MAX_RADIUS_M);
  const tiles=await Promise.all(refs.map(t=>loadTile(product,t,cache)));
  const local=await cellValue(lat,lon,tiles);
  const sums:{[k:string]:number}={"1000":0,"5000":0,"10000":0};
  const dLat=MAX_RADIUS_M/111320;
  const dLon=MAX_RADIUS_M/(111320*Math.max(.2,Math.cos(lat*Math.PI/180)));
  const minLon=lon-dLon,maxLon=lon+dLon,minLat=lat-dLat,maxLat=lat+dLat;
  for(const t of tiles){
    const [bx0,by0,bx1,by1]=t.bbox;
    const ix0=Math.max(minLon,bx0),ix1=Math.min(maxLon,bx1),iy0=Math.max(minLat,by0),iy1=Math.min(maxLat,by1);
    if(ix0>=ix1||iy0>=iy1)continue;
    const dx=(bx1-bx0)/t.width,dy=(by1-by0)/t.height;
    const x0=Math.max(0,Math.floor((ix0-bx0)/dx)-1);
    const x1=Math.min(t.width,Math.ceil((ix1-bx0)/dx)+1);
    const y0=Math.max(0,Math.floor((by1-iy1)/dy)-1);
    const y1=Math.min(t.height,Math.ceil((by1-iy0)/dy)+1);
    const ras:any=await t.image.readRasters({window:[x0,y0,x1,y1]});
    const arr:any=ras?.[0]; if(!arr)continue;
    const ww=x1-x0,hh=y1-y0;
    for(let yy=0;yy<hh;yy++){
      const plat=by1-(y0+yy+.5)*dy;
      for(let xx=0;xx<ww;xx++){
        const v=Number(arr[yy*ww+xx]); if(!Number.isFinite(v)||v<0)continue;
        const plon=bx0+(x0+xx+.5)*dx;
        const d=havM(lat,lon,plat,plon);
        if(d<=10000)sums["10000"]+=v;
        if(d<=5000)sums["5000"]+=v;
        if(d<=1000)sums["1000"]+=v;
      }
    }
  }
  return {
    local,
    ring_1km:sums["1000"],
    ring_5km:sums["5000"],
    ring_10km:sums["10000"],
    tiles:tiles.map(t=>`R${t.r}_C${t.c}`),
    urls:tiles.map(t=>t.url)
  };
}
function fractionPct(builtM2:number,r:number){
  const p=builtM2/(Math.PI*r*r)*100;
  return Math.max(0,Math.min(100,p));
}
function cacheFresh(row:any,lat:number,lon:number){
  if(!row||String(row.profile_version??"")!==PROFILE||row.last_error)return false;
  const a=num(row.query_latitude),b=num(row.query_longitude); if(a==null||b==null)return false;
  return havM(a,b,lat,lon)<MOVE_REQUERY_M;
}
async function analyze(lat:number,lon:number,cache:Map<string,Promise<LoadedTile>>){
  const [pop,built]=await Promise.all([productRings("POP",lat,lon,cache),productRings("BUILT",lat,lon,cache)]);
  return {
    population_cell:pop.local,built_surface_cell_m2:built.local,
    population_1km:pop.ring_1km,population_5km:pop.ring_5km,population_10km:pop.ring_10km,
    built_surface_1km_m2:built.ring_1km,built_surface_5km_m2:built.ring_5km,built_surface_10km_m2:built.ring_10km,
    built_fraction_1km_pct:fractionPct(built.ring_1km,1000),
    built_fraction_5km_pct:fractionPct(built.ring_5km,5000),
    built_fraction_10km_pct:fractionPct(built.ring_10km,10000),
    tile_ids:[...new Set([...pop.tiles,...built.tiles])],
    source_urls:[...new Set([...pop.urls,...built.urls])]
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const bearer=req.headers.get("authorization")??"";
  let authorized=bearer==="Bearer "+key;
  if(!authorized){
    const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
    authorized=!ae&&auth===true;
  }
  if(!authorized)return json({ok:false,error:"unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{}
  const tileCache=new Map<string,Promise<LoadedTile>>();

  if(body?.mode==="probe"){
    const lat=Number(body.lat??52.23697),lon=Number(body.lon??32.49722);
    try{return json({ok:true,profile:PROFILE,lat,lon,metrics:await analyze(lat,lon,tileCache)})}
    catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},502)}
  }

  const {data:events,error}=await sb.from("fire_events")
    .select("id,status,lifecycle_status,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
    .gte("last_seen",new Date(Date.now()-24*3600e3).toISOString())
    .order("last_seen",{ascending:false}).limit(20);
  if(error)return json({ok:false,error:error.message},502);
  const candidates=(events??[]).filter((e:any)=>e.status!=="closed"&&e.lifecycle_status!=="closed").slice(0,MAX_EVENTS);
  const ids=candidates.map((e:any)=>e.id);
  const {data:rows,error:ce}=ids.length?await sb.from("ghsl_event_cache").select("*").in("fire_event_id",ids):{data:[],error:null} as any;
  if(ce)return json({ok:false,error:ce.message},502);
  const oldMap=new Map<string,any>((rows??[]).map((x:any)=>[String(x.fire_event_id),x] as [string,any]));
  const prior=(await sb.from("system_state").select("value").eq("key","monitor_ghsl").maybeSingle()).data?.value??{};

  let hits=0,attempted=0,refreshed=0,failed=0;
  const warnings:string[]=[];
  for(const e of candidates){
    const lat=num((e as any).best_latitude??(e as any).last_latitude),lon=num((e as any).best_longitude??(e as any).last_longitude);
    if(lat==null||lon==null)continue;
    const old=oldMap.get(String((e as any).id));
    if(cacheFresh(old,lat,lon)){hits++;continue}
    if(attempted>=MAX_REFRESH)continue;
    attempted++;
    const now=new Date().toISOString();
    try{
      const m=await analyze(lat,lon,tileCache);
      const {error:ue}=await sb.from("ghsl_event_cache").upsert({
        fire_event_id:(e as any).id,queried_at:now,query_latitude:lat,query_longitude:lon,
        profile_version:PROFILE,epoch:EPOCH,resolution:"30 arcsec (~1 km)",
        ...m,last_error:null,updated_at:now
      });
      if(ue)throw ue;
      refreshed++;
    }catch(err){
      failed++;const msg=(err instanceof Error?err.message:String(err)).slice(0,1600);
      warnings.push(String((e as any).id).slice(0,8)+": "+msg);
      await sb.from("ghsl_event_cache").upsert({
        fire_event_id:(e as any).id,queried_at:now,query_latitude:lat,query_longitude:lon,
        profile_version:PROFILE,epoch:EPOCH,resolution:"30 arcsec (~1 km)",
        population_cell:old?.population_cell??null,built_surface_cell_m2:old?.built_surface_cell_m2??null,
        population_1km:old?.population_1km??null,population_5km:old?.population_5km??null,population_10km:old?.population_10km??null,
        built_surface_1km_m2:old?.built_surface_1km_m2??null,built_surface_5km_m2:old?.built_surface_5km_m2??null,built_surface_10km_m2:old?.built_surface_10km_m2??null,
        built_fraction_1km_pct:old?.built_fraction_1km_pct??null,built_fraction_5km_pct:old?.built_fraction_5km_pct??null,built_fraction_10km_pct:old?.built_fraction_10km_pct??null,
        tile_ids:old?.tile_ids??[],source_urls:old?.source_urls??[],last_error:msg,updated_at:now
      });
    }
  }
  const consecutive=attempted>0&&failed===attempted?Number(prior?.consecutive_failed_cycles??0)+1:0;
  const status=consecutive>=3?"degraded":"active";
  const state={
    status,source:"JRC GHSL GHS-POP + GHS-BUILT-S R2023A, epoch 2025",
    profile_version:PROFILE,epoch:EPOCH,resolution:"30 arcsec (~1 km)",max_radius_m:MAX_RADIUS_M,
    last_check:new Date().toISOString(),last_success_run:status==="active"?new Date().toISOString():prior?.last_success_run??null,
    events_considered:candidates.length,cache_hits:hits,queries_attempted:attempted,refreshed,failed,
    consecutive_failed_cycles:consecutive,warnings:warnings.slice(-20),
    dependency_rule:"GHSL enrichment is non-critical; failures never block FIRMS ingestion or Telegram notifications."
  };
  await sb.from("system_state").upsert({key:"monitor_ghsl",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
});
