import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CATALOG="https://catalogue.dataspace.copernicus.eu/odata/v1";
const DOWNLOAD="https://download.dataspace.copernicus.eu/odata/v1";
const TOKEN="https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const SOURCE_MWIR="COPERNICUS_S3_SL_2_FRP_MWIR1KM";
const SOURCE_SWIR="COPERNICUS_S3_SL_2_FRP_SWIR500M";
const PRODUCT_TYPE="SL_2_FRP___";
const MATCH_RADIUS_M_MWIR=1200;
const MATCH_RADIUS_M_SWIR=700;
const MATCH_WINDOW_HOURS=24;
const SEARCH_HOURS=36;
const FRESH_NOTIFY_HOURS=3;
const UA_POLY="POLYGON((21.5 43.5,41.5 43.5,41.5 53.5,21.5 53.5,21.5 43.5))";

function json(x:unknown,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseCsvLine(line:string){const out:string[]=[];let v="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++;}else q=!q;}else if(c===","&&!q){out.push(v);v="";}else v+=c;}out.push(v);return out;}
function parseFireCsv(text:string){const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim()!=="");let hi=-1;for(let i=0;i<lines.length;i++){const l=lines[i].toLowerCase();if((l.includes("latitude")&&l.includes("longitude"))||(l.includes("lat(")&&l.includes("lon("))){hi=i;break;}}if(hi<0)return{headers:[] as string[],rows:[] as Record<string,string>[]};const headers=parseCsvLine(lines[hi]).map(x=>x.trim());const rows=lines.slice(hi+1).map(line=>{const a=parseCsvLine(line),o:Record<string,string>={};headers.forEach((h,j)=>o[h]=a[j]??"");return o;});return{headers,rows};}
function pnum(row:Record<string,string>,...names:string[]){for(const n of names){const v=row[n]??row[n.toLowerCase()]??row[n.toUpperCase()];const x=Number(v);if(Number.isFinite(x))return x;}return null;}
function pstr(row:Record<string,string>,...names:string[]){for(const n of names){const v=String(row[n]??row[n.toLowerCase()]??row[n.toUpperCase()]??"").trim();if(v)return v;}return"";}
function normConfidence(v:any){const n=Number(v);if(Number.isFinite(n)){const p=n<=1?n*100:n;return p>=80?"h":p>=30?"n":"l";}return""}
function satFromName(name:string){if(name.startsWith("S3A_"))return"Sentinel-3A";if(name.startsWith("S3B_"))return"Sentinel-3B";if(name.startsWith("S3C_"))return"Sentinel-3C";return"Sentinel-3";}
function parseTime(row:Record<string,string>,fallback:string){const day=pstr(row,"day","DAY","date","DATE"),raw=pstr(row,"time","TIME","acq_time","acquisition_time");if(day&&raw){const t=Date.parse(day+"T"+raw+"Z");if(Number.isFinite(t))return new Date(t).toISOString();}if(raw){const t=Date.parse(raw);if(Number.isFinite(t))return new Date(t).toISOString();if(/^\d{14}$/.test(raw)){const d=new Date(Date.UTC(+raw.slice(0,4),+raw.slice(4,6)-1,+raw.slice(6,8),+raw.slice(8,10),+raw.slice(10,12),+raw.slice(12,14)));if(!Number.isNaN(d.getTime()))return d.toISOString();}const n=Number(raw);if(Number.isFinite(n)&&n>1e9){const ms=Date.UTC(2000,0,1)+(n>1e12?n/1000:n*1000);const d=new Date(ms);if(!Number.isNaN(d.getTime()))return d.toISOString();}}return fallback;}
async function token(user:string,pass:string){
  const body=new URLSearchParams({grant_type:"password",username:user,password:pass,client_id:"cdse-public"});
  const r=await fetch(TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(20000)});
  const t=await r.text();if(!r.ok)throw new Error(`CDSE token HTTP ${r.status}: ${t.slice(0,200)}`);
  const j=JSON.parse(t);if(!j.access_token)throw new Error("CDSE token missing");return String(j.access_token);
}
async function authFetch(url:string,bearer:string){
  let u=url;
  for(let i=0;i<5;i++){
    const r=await fetch(u,{headers:{authorization:`Bearer ${bearer}`},redirect:"manual",signal:AbortSignal.timeout(30000)});
    if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get("location");if(!loc)throw new Error("CDSE redirect without Location");u=new URL(loc,u).toString();continue}
    return r;
  }
  throw new Error("CDSE too many redirects");
}
async function resolveNodeFileUrl(id:string,target:string){
  const queue=[`${DOWNLOAD}/Products(${id})/Nodes`];
  const seen=new Set<string>(); const trace:any[]=[];
  for(let depth=0;depth<4&&queue.length;depth++){
    const n=queue.length;
    for(let i=0;i<n;i++){
      const listUrl=queue.shift()!; if(seen.has(listUrl))continue; seen.add(listUrl);
      const r=await fetch(listUrl,{headers:{"user-agent":"GeoWatch-Sentinel3/1.2"},signal:AbortSignal.timeout(15000)});
      const txt=await r.text();
      if(!r.ok){trace.push({depth,status:r.status,url:listUrl,head:txt.slice(0,180)});continue;}
      let j:any=null;try{j=JSON.parse(txt)}catch{}
      const items=Array.isArray(j?.result)?j.result:Array.isArray(j?.value)?j.value:[];
      trace.push({depth,status:r.status,url:listUrl,n:items.length,names:items.slice(0,8).map((x:any)=>String(x?.Name??x?.Id??"")),uris:items.slice(0,3).map((x:any)=>String(x?.Nodes?.uri??""))});
      for(const item of items){
        const name=String(item?.Name??item?.Id??"");
        if(name===target)return {url:listUrl.replace(/\/Nodes$/,`/Nodes(${encodeURIComponent(name)})/$value`),trace};
        const child=String(item?.Nodes?.uri??"");
        if(child)queue.push(child.startsWith("http")?child:new URL(child,DOWNLOAD).toString());
      }
    }
  }
  return {url:null,trace};
}
async function catalogProducts(){
  const end=new Date(),start=new Date(end.getTime()-SEARCH_HOURS*3600000);
  const filter=`Collection/Name eq 'SENTINEL-3' and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq '${PRODUCT_TYPE}') and OData.CSC.Intersects(area=geography'SRID=4326;${UA_POLY}') and ContentDate/Start gt ${start.toISOString()} and ContentDate/Start lt ${end.toISOString()}`;
  const u=`${CATALOG}/Products?$filter=${encodeURIComponent(filter)}&$orderby=ContentDate/Start desc&$top=12&$select=Id,Name,ContentDate,PublicationDate,Online,S3Path`;
  const r=await fetch(u,{headers:{"user-agent":"GeoWatch-Sentinel3/1.0"},signal:AbortSignal.timeout(20000)});
  const t=await r.text();if(!r.ok)throw new Error(`CDSE catalogue HTTP ${r.status}: ${t.slice(0,200)}`);
  const j=JSON.parse(t);return Array.isArray(j.value)?j.value:[];
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const sbUrl=Deno.env.get("SUPABASE_URL"),sbKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!sbUrl||!sbKey)return json({ok:false,error:"missing Supabase env"},500);
  const sb=createClient(sbUrl,sbKey,{auth:{persistSession:false}});
  const secret=req.headers.get("x-cron-secret")??"";
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
  try{
    const products=await catalogProducts();
    const latest=products[0]??null;
    const user=Deno.env.get("CDSE_USERNAME")??"";
    const pass=Deno.env.get("CDSE_PASSWORD")??"";
    if(!user||!pass){
      const state={status:"waiting_credentials",source:"Copernicus Sentinel-3 SLSTR L2 FRP",product_type:PRODUCT_TYPE,instrument:"SLSTR",resolution_m:1000,last_check:new Date().toISOString(),catalog_products_found:products.length,products_pending:pendingProducts.length,products_cached:selectedProducts.length-pendingProducts.length,latest_product:latest?.Name??null,latest_acquisition:latest?.ContentDate?.Start??null,latest_publication:latest?.PublicationDate??null,credentials_required:["CDSE_USERNAME","CDSE_PASSWORD"],notification_mode:"recent-direct-older-supporting"};
      await sb.from("system_state").upsert({key:"monitor_sentinel3_slstr",value:state,updated_at:new Date().toISOString()});
      return json({ok:true,mode:"waiting_credentials",state});
    }

    const bearer=await token(user,pass);
    const mwirRecords:any[]=[];const swirRecords:any[]=[];const warnings:string[]=[];
    let downloadedMwir=0,downloadedSwir=0,mwirRows=0,swirRows=0;
    let sampleHeadersMwir:string[]=[],sampleHeadersSwir:string[]=[];
    let sampleTextHeadMwir="",sampleTextHeadSwir="";

    async function loadChannel(p:any,target:string,channel:"MWIR"|"SWIR"){
      const start=String(p?.ContentDate?.Start??new Date().toISOString());
      const resolved=await resolveNodeFileUrl(String(p.Id),target);
      if(!resolved.url){warnings.push(`${p.Name}: ${target} node not found`);return false}
      const r=await authFetch(resolved.url,bearer);
      if(!r.ok){warnings.push(`${p.Name}: ${target} HTTP ${r.status}`);return false}
      const text=await r.text();
      const parsed=parseFireCsv(text);
      if(channel==="MWIR"){
        downloadedMwir++;mwirRows+=parsed.rows.length;
        if(!sampleTextHeadMwir)sampleTextHeadMwir=text.slice(0,1800);
        if(!sampleHeadersMwir.length&&parsed.headers.length)sampleHeadersMwir=parsed.headers.slice(0,60);
      }else{
        downloadedSwir++;swirRows+=parsed.rows.length;
        if(!sampleTextHeadSwir)sampleTextHeadSwir=text.slice(0,1800);
        if(!sampleHeadersSwir.length&&parsed.headers.length)sampleHeadersSwir=parsed.headers.slice(0,60);
      }
      for(const row of parsed.rows){
        const la=pnum(row,"lat(deg)","latitude","LATITUDE"),lo=pnum(row,"lon(deg)","longitude","LONGITUDE");
        if(la===null||lo===null||la<43.5||la>53.5||lo<21.5||lo>41.5)continue;
        const frp=pnum(row,"FRP(MW)","FRP_MWIR","FRP_SWIR","frp_mwir","frp_swir","FRP","frp");
        const unc=pnum(row,"FRPerr(MW)","FRP_uncertainty_MWIR","FRP_uncertainty_SWIR","frp_uncertainty_mwir","frp_uncertainty_swir","FRP_UNCERTAINTY");
        const c=pstr(row,"confidence(%)","confidence","CONFIDENCE","fire_confidence","FIRE_CONFIDENCE");
        const areaM2=pnum(row,"IFOV_area(m2)","IFOV_area","ifov_area","pixel_area","PIXEL_AREA");
        const dn=pstr(row,"D/N","daynight","DAYNIGHT");
        const rec={source:channel==="MWIR"?SOURCE_MWIR:SOURCE_SWIR,satellite:satFromName(String(p.Name)),instrument:"SLSTR",acq_datetime:parseTime(row,start),latitude:String(la),longitude:String(lo),scan:"",track:"",confidence:normConfidence(c),frp:frp===null?"":String(frp),daynight:dn,provider:"Copernicus Data Space Ecosystem",product:"SL_2_FRP___",product_channel:channel,product_id:p.Id,product_name:p.Name,frp_uncertainty:unc,pixel_area_km2:areaM2===null?null:areaM2/1000000,raw_row:row};
        if(channel==="MWIR")mwirRecords.push(rec);else swirRecords.push(rec);
      }
      return true;
    }

    const selectedProducts=products.slice(0,8);
    const selectedIds=selectedProducts.map((p:any)=>String(p.Id));
    const {data:cached}=selectedIds.length?await sb.from("processed_source_products").select("product_id").eq("source_key","SENTINEL3_SLSTR").in("product_id",selectedIds):{data:[]};
    const done=new Set((cached??[]).map((x:any)=>String(x.product_id)));
    const pendingProducts=selectedProducts.filter((p:any)=>!done.has(String(p.Id)));
    const processedProducts:any[]=[];
    for(const p of pendingProducts){
      const okM=await loadChannel(p,"FRP_MWIR1km_standard.csv","MWIR");
      const okS=await loadChannel(p,"FRP_SWIR500m.csv","SWIR");
      if(okM&&okS)processedProducts.push(p);
    }
    if(processedProducts.length)await sb.from("processed_source_products").upsert(processedProducts.map((p:any)=>({source_key:"SENTINEL3_SLSTR",product_id:String(p.Id),product_time:p?.ContentDate?.Start??null,processed_at:new Date().toISOString(),meta:{name:p.Name}})),{onConflict:"source_key,product_id"});

    const {data:mwirBatch,error:mwirError}=await sb.rpc("ingest_firms_batch",{p_records:mwirRecords,p_match_radius_m:MATCH_RADIUS_M_MWIR,p_match_window_hours:MATCH_WINDOW_HOURS});if(mwirError)throw mwirError;
    const now=Date.now();
    const suppressMwir=(mwirBatch?.notifications??[]).filter((x:any)=>{const t=Date.parse(String(x.acq_datetime??""));return !Number.isFinite(t)||now-t>FRESH_NOTIFY_HOURS*3600000;}).map((x:any)=>x.event_id).filter(Boolean);
    if(suppressMwir.length){const {error:se}=await sb.from("fire_events").update({notification_required:false}).in("id",suppressMwir);if(se)throw se;}

    const {data:swirBatch,error:swirError}=await sb.rpc("ingest_firms_batch",{p_records:swirRecords,p_match_radius_m:MATCH_RADIUS_M_SWIR,p_match_window_hours:MATCH_WINDOW_HOURS});if(swirError)throw swirError;
    const suppressSwir=(swirBatch?.notifications??[]).map((x:any)=>x.event_id).filter(Boolean);
    if(suppressSwir.length){const {error:se}=await sb.from("fire_events").update({notification_required:false}).in("id",suppressSwir);if(se)throw se;}

    const state={status:"active",source:"Copernicus Sentinel-3 SLSTR L2 FRP",product_type:PRODUCT_TYPE,instrument:"SLSTR",resolution_m:500,last_success_run:new Date().toISOString(),last_error:null,catalog_products_found:products.length,latest_product:latest?.Name??null,latest_acquisition:latest?.ContentDate?.Start??null,latest_publication:latest?.PublicationDate??null,
      mwir:{resolution_m:1000,products_downloaded:downloadedMwir,fire_rows_scanned:mwirRows,ukraine_records:mwirRecords.length,inserted:mwirBatch?.inserted??0,duplicates:mwirBatch?.duplicates??0,outside_ukraine:mwirBatch?.outside_ukraine??0,new_events:mwirBatch?.new_events??0,old_new_events_suppressed:suppressMwir.length,match_radius_m:MATCH_RADIUS_M_MWIR},
      swir:{resolution_m:500,products_downloaded:downloadedSwir,fire_rows_scanned:swirRows,ukraine_records:swirRecords.length,inserted:swirBatch?.inserted??0,duplicates:swirBatch?.duplicates??0,outside_ukraine:swirBatch?.outside_ukraine??0,new_events:swirBatch?.new_events??0,new_events_suppressed:suppressSwir.length,match_radius_m:MATCH_RADIUS_M_SWIR},
      warnings:warnings.slice(-20),sample_headers_mwir:sampleHeadersMwir,sample_headers_swir:sampleHeadersSwir,sample_text_head_mwir:sampleTextHeadMwir,sample_text_head_swir:sampleTextHeadSwir,notification_mode:"MWIR recent-direct; SWIR support-only",fresh_notify_hours:FRESH_NOTIFY_HOURS};
    await sb.from("system_state").upsert({key:"monitor_sentinel3_slstr",value:state,updated_at:new Date().toISOString()});
    return json({ok:true,mode:"monitor",state});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);await sb.from("system_state").upsert({key:"monitor_sentinel3_slstr",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});return json({ok:false,error:msg},502);
  }
});