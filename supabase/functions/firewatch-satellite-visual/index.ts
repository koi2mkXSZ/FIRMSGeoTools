import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { fromUrl } from "geotiff";
import proj4 from "proj4";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const STAC="https://earth-search.aws.element84.com/v1";
const BUCKET="satellite-evidence";
const VERSION="stage29.1-visual-v1";
const ROI=500;
const GRID=256;
const PANEL=512;
const USER_AGENT="GeoWatch-SatelliteVisual/1.0 (@NASA_FIRMS)";

type Item={id:string;properties:Record<string,any>;assets:Record<string,{href:string;"raster:bands"?:any[]}>;links?:Array<{rel:string;href:string}>};

function json(x:unknown,s=200){return new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function finite(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
function projDef(epsg:number){if(epsg>=32601&&epsg<=32660)return `+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m +no_defs`;if(epsg>=32701&&epsg<=32760)return `+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m +no_defs`;if(epsg===4326)return"EPSG:4326";throw new Error("unsupported EPSG "+epsg)}
function meta(item:Item,key:string){const rb=item.assets?.[key]?.["raster:bands"]?.[0]??{},scale=finite(rb.scale)??1,adv=finite(rb.offset)??0,boa=item.properties?.["earthsearch:boa_offset_applied"]===true;return{scale,offset:boa?0:adv}}
function refl(raw:number,m:{scale:number;offset:number}){return raw*m.scale+m.offset}
function norm(v:number,min=0.02,max=0.35){const x=Math.max(0,Math.min(1,(v-min)/(max-min)));return Math.pow(x,1/2.2)}
function ch(v:number){return Math.max(0,Math.min(255,Math.round(v*255)))}
function maskScl(s:number){return [0,1,3,8,9,10,11].includes(s)}
function colorDnbr(v:number|null){if(v==null||!Number.isFinite(v))return[70,70,70];const x=Math.max(-0.5,Math.min(0.5,v));if(x>=0){const t=x/0.5;return[ch(0.8+0.2*t),ch(0.8*(1-t)+0.15*t),ch(0.8*(1-t)+0.05*t)]}const t=-x/0.5;return[ch(0.65*(1-t)+0.05*t),ch(0.75*(1-t)+0.35*t),ch(0.85+0.15*t)]}
async function item(id:string){const r=await fetch(`${STAC}/collections/sentinel-2-l2a/items/${encodeURIComponent(id)}`,{headers:{"accept":"application/geo+json","user-agent":USER_AGENT},signal:AbortSignal.timeout(15000)});const t=await r.text();if(!r.ok)throw new Error("STAC "+r.status+" "+t.slice(0,200));return JSON.parse(t) as Item}
async function band(it:Item,key:string,lat:number,lon:number,method:"nearest"|"bilinear"="bilinear"){const href=it.assets?.[key]?.href;if(!href)throw new Error("missing asset "+key);const epsg=finite(it.properties?.["proj:epsg"]);if(!epsg)throw new Error("missing proj:epsg");const [x,y]=proj4("EPSG:4326",projDef(epsg),[lon,lat]);const tif=await fromUrl(href,{headers:{"User-Agent":USER_AGENT}});const rr:any=await tif.readRasters({bbox:[x-ROI,y-ROI,x+ROI,y+ROI],width:GRID,height:GRID,resampleMethod:method,fillValue:0});return{data:rr[0],meta:meta(it,key)}}
async function scene(it:Item,lat:number,lon:number){
  const [r,g,b,n,s2,scl]=await Promise.all([band(it,"red",lat,lon),band(it,"green",lat,lon),band(it,"blue",lat,lon),band(it,"nir",lat,lon),band(it,"swir22",lat,lon),band(it,"scl",lat,lon,"nearest")]);
  const npx=GRID*GRID,trueRgb=new Uint8ClampedArray(npx*4),falseRgb=new Uint8ClampedArray(npx*4),nbr=new Float32Array(npx);nbr.fill(NaN);
  for(let i=0;i<npx;i++){
    const sc=Number(scl.data[i]),cloud=maskScl(sc);
    const rv=refl(Number(r.data[i]),r.meta),gv=refl(Number(g.data[i]),g.meta),bv=refl(Number(b.data[i]),b.meta),nv=refl(Number(n.data[i]),n.meta),sv=refl(Number(s2.data[i]),s2.meta);
    const ok=!cloud&&rv>0&&gv>0&&bv>0&&nv>0&&sv>0&&[rv,gv,bv,nv,sv].every(Number.isFinite);
    const o=i*4;
    if(ok){
      trueRgb[o]=ch(norm(rv));trueRgb[o+1]=ch(norm(gv));trueRgb[o+2]=ch(norm(bv));trueRgb[o+3]=255;
      falseRgb[o]=ch(norm(sv,0.01,0.4));falseRgb[o+1]=ch(norm(nv,0.01,0.45));falseRgb[o+2]=ch(norm(rv,0.01,0.35));falseRgb[o+3]=255;
      const den=nv+sv;if(Math.abs(den)>1e-12)nbr[i]=(nv-sv)/den;
    }else{
      trueRgb[o]=trueRgb[o+1]=trueRgb[o+2]=90;trueRgb[o+3]=255;
      falseRgb[o]=falseRgb[o+1]=falseRgb[o+2]=90;falseRgb[o+3]=255;
    }
  }
  return{trueRgb,falseRgb,nbr};
}
async function rgbaImage(buf:Uint8ClampedArray){const img=new Image(GRID,GRID);img.bitmap.set(buf);img.resize(PANEL,PANEL);return img}
async function dnbrImage(before:Float32Array,after:Float32Array){const buf=new Uint8ClampedArray(GRID*GRID*4);for(let i=0;i<GRID*GRID;i++){const a=Number(before[i]),b=Number(after[i]),v=Number.isFinite(a)&&Number.isFinite(b)?a-b:null,[r,g,bl]=colorDnbr(v);const o=i*4;buf[o]=r;buf[o+1]=g;buf[o+2]=bl;buf[o+3]=255}return rgbaImage(buf)}
async function banner(text:string,w:number){const s=text.replace(/&/g,"&amp;").replace(/</g,"&lt;");return Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="38"><rect width="100%" height="100%" fill="rgba(0,0,0,.72)"/><text x="12" y="25" fill="white" font-family="Arial" font-size="16">${s}</text></svg>`)}
async function pin(img:any){const svg=await Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="none" stroke="#ff2d2d" stroke-width="3"/><line x1="14" y1="1" x2="14" y2="27" stroke="#ff2d2d" stroke-width="2"/><line x1="1" y1="14" x2="27" y2="14" stroke="#ff2d2d" stroke-width="2"/></svg>');img.composite(svg,Math.round(PANEL/2-14),Math.round(PANEL/2-14))}
async function montage(before:Item,after:Item,lat:number,lon:number,eventId:string,dnbrMetric:number|null){
  const [bs,as]=await Promise.all([scene(before,lat,lon),scene(after,lat,lon)]);
  const bt=await rgbaImage(bs.trueRgb),at=await rgbaImage(as.trueRgb),af=await rgbaImage(as.falseRgb),dm=await dnbrImage(bs.nbr,as.nbr);
  for(const x of [bt,at,af,dm])await pin(x);
  const bdt=String(before.properties?.datetime??"").slice(0,10),adt=String(after.properties?.datetime??"").slice(0,10);
  bt.composite(await banner(`BEFORE • ${bdt}`,PANEL),0,0);
  at.composite(await banner(`AFTER • ${adt}`,PANEL),0,0);
  af.composite(await banner("AFTER • SWIR2/NIR/RED",PANEL),0,0);
  dm.composite(await banner(`dNBR MAP • value ${dnbrMetric==null?"—":dnbrMetric.toFixed(3)}`,PANEL),0,0);
  const head=70,out=new Image(PANEL*2,head+PANEL*2);const title=await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${head}"><rect width="100%" height="100%" fill="#111827"/><text x="18" y="29" fill="white" font-family="Arial" font-size="21">Sentinel-2 Surface Evidence • ID ${eventId.slice(0,8)}</text><text x="18" y="54" fill="#cbd5e1" font-family="Arial" font-size="14">ROI ~1×1 km • одинаковый центр/масштаб • поверхность, не причинная атрибуция</text></svg>`);
  out.composite(title,0,0);out.composite(bt,0,head);out.composite(at,PANEL,head);out.composite(af,0,head+PANEL);out.composite(dm,PANEL,head+PANEL);
  const enc=(out as any).encodeJPEG;let bytes:Uint8Array;if(typeof enc==="function")bytes=await enc.call(out,88);else bytes=await out.encode(2);
  return bytes;
}
async function buildAndStore(sb:any,eventId:string,lat:number,lon:number,beforeId:string,afterId:string,dnbr:number|null){
  const [bi,ai]=await Promise.all([item(beforeId),item(afterId)]);
  const bytes=await montage(bi,ai,lat,lon,eventId,dnbr);
  const path=`${eventId}/${VERSION}.jpg`;
  const {error}=await sb.storage.from(BUCKET).upload(path,new Blob([bytes],{type:"image/jpeg"}),{contentType:"image/jpeg",upsert:true,cacheControl:"3600"});
  if(error)throw error;
  await sb.from("satellite_surface_evidence").update({visual_status:"ready",visual_version:VERSION,visual_storage_path:path,visual_generated_at:new Date().toISOString(),visual_bytes:bytes.length,visual_last_error:null,updated_at:new Date().toISOString()}).eq("fire_event_id",eventId);
  const {data:signed,error:se}=await sb.storage.from(BUCKET).createSignedUrl(path,21600);if(se)throw se;
  return{path,bytes:bytes.length,signed_url:signed.signedUrl,version:VERSION};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});if(auth!==true)return json({ok:false,error:"unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{}
  try{
    if(body.mode==="probe"){
      const beforeId=String(body.before_item_id??""),afterId=String(body.after_item_id??""),lat=finite(body.lat),lon=finite(body.lon);if(!beforeId||!afterId||lat==null||lon==null)return json({ok:false,error:"probe requires before_item_id, after_item_id, lat, lon"},400);
      const bytes=await montage(await item(beforeId),await item(afterId),lat,lon,"probe000",finite(body.dnbr));
      if(body.store===true){
        const path=`probe/${VERSION}.jpg`;
        const {error:ue}=await sb.storage.from(BUCKET).upload(path,new Blob([bytes],{type:"image/jpeg"}),{contentType:"image/jpeg",upsert:true,cacheControl:"300"});if(ue)throw ue;
        const {data:signed,error:se}=await sb.storage.from(BUCKET).createSignedUrl(path,900);if(se)throw se;
        return json({ok:true,mode:"probe",stored:true,path,signed_url:signed.signedUrl,bytes:bytes.length,width:1024,height:1094,version:VERSION});
      }
      return json({ok:true,mode:"probe",stored:false,bytes:bytes.length,width:1024,height:1094,version:VERSION});
    }
    if(body.mode==="cleanup-probe"){
      const path=`probe/${VERSION}.jpg`;
      const {error}=await sb.storage.from(BUCKET).remove([path]);if(error)throw error;
      return json({ok:true,mode:"cleanup-probe",path});
    }
    const q=String(body.event_id??"").trim();if(!q)return json({ok:false,error:"event_id required"},400);
    const {data:rows,error:re}=await sb.from("satellite_surface_evidence").select("*").ilike("fire_event_id",q+"%").limit(2);if(re)throw re;if(!rows?.length)return json({ok:false,error:"surface evidence not found"},404);if(rows.length>1)return json({ok:false,error:"event id prefix ambiguous"},409);
    const e:any=rows[0];if(e.status!=="ready"||!e.before_item_id||!e.after_item_id)return json({ok:false,error:"before/after pair not ready",status:e.status},409);
    if(e.visual_status==="ready"&&e.visual_storage_path&&e.visual_version===VERSION&&!body.force){
      const {data:signed,error:se}=await sb.storage.from(BUCKET).createSignedUrl(e.visual_storage_path,21600);if(se)throw se;return json({ok:true,cached:true,path:e.visual_storage_path,bytes:e.visual_bytes,signed_url:signed.signedUrl,version:VERSION});
    }
    const result=await buildAndStore(sb,String(e.fire_event_id),Number(e.latitude),Number(e.longitude),String(e.before_item_id),String(e.after_item_id),finite(e.dnbr));
    return json({ok:true,cached:false,...result});
  }catch(err){
    const q=String(body.event_id??"").trim();if(q)await sb.from("satellite_surface_evidence").update({visual_status:"error",visual_version:VERSION,visual_last_error:(err instanceof Error?err.message:String(err)).slice(0,1500),updated_at:new Date().toISOString()}).ilike("fire_event_id",q+"%");
    return json({ok:false,error:err instanceof Error?err.message:String(err)},502);
  }
});