import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import h5wasm from "npm:h5wasm@0.10.3";

const CAT="https://catalogue.dataspace.copernicus.eu/odata/v1";
const DL="https://download.dataspace.copernicus.eu/odata/v1";
const TOKEN="https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const UA_POLY="POLYGON((21.5 43.5,41.5 43.5,41.5 53.5,21.5 53.5,21.5 43.5))";
const SEARCH_HOURS=36,MAX_PRODUCTS=3,MAX_DISTANCE_KM=35;

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function arr(v:any){if(v==null)return[];if(Array.isArray(v))return v;if(ArrayBuffer.isView(v))return Array.from(v as any);return[]}
function getv(f:any,path:string){for(const p of [path,path.replace(/^\//,"")]){try{const o=f.get(p);if(o?.value!==undefined)return arr(o.value)}catch{}}return[]}
function hav(lat1:number,lon1:number,lat2:number,lon2:number){const r=6371,p=Math.PI/180,a=Math.sin((lat2-lat1)*p/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin((lon2-lon1)*p/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(a)))}
function qaNorm(v:any){const n=Number(v);if(!Number.isFinite(n))return null;return n>1?n/100:n}
async function token(u:string,p:string){const b=new URLSearchParams({grant_type:"password",username:u,password:p,client_id:"cdse-public"});const r=await fetch(TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:b,signal:AbortSignal.timeout(20000)});const t=await r.text();if(!r.ok)throw new Error("CDSE token HTTP "+r.status+": "+t.slice(0,200));return String(JSON.parse(t).access_token)}
async function authFetch(url:string,b:string){let u=url;for(let i=0;i<5;i++){const r=await fetch(u,{headers:{authorization:"Bearer "+b},redirect:"manual",signal:AbortSignal.timeout(30000)});if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get("location");if(!loc)throw new Error("redirect without location");u=new URL(loc,u).toString();continue}return r}throw new Error("too many redirects")}
async function search(kind:"CO"|"AER_AI"){
 const end=new Date(),start=new Date(end.getTime()-SEARCH_HOURS*3600e3);
 const token=kind==="CO"?"L2__CO____":"L2__AER_AI";
 const filter="Collection/Name eq 'SENTINEL-5P' and ContentDate/Start gt "+start.toISOString()+" and ContentDate/Start lt "+end.toISOString()+" and contains(Name,'"+token+"') and OData.CSC.Intersects(area=geography'SRID=4326;"+UA_POLY+"')";
 const u=CAT+"/Products?$filter="+encodeURIComponent(filter)+"&$orderby=ContentDate/Start desc&$top="+MAX_PRODUCTS+"&$select=Id,Name,ContentDate,PublicationDate";
 const r=await fetch(u,{headers:{"user-agent":"GeoWatch-S5P/1.0"},signal:AbortSignal.timeout(20000)});const t=await r.text();if(!r.ok)throw new Error("catalog "+kind+" HTTP "+r.status+": "+t.slice(0,200));const j=JSON.parse(t);return Array.isArray(j.value)?j.value:[];
}

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const {data:a,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});if(ae||a!==true)return json({ok:false,error:"unauthorized"},401);
 try{
  const {data:events,error:ee}=await sb.from("fire_events").select("id,last_seen,best_latitude,best_longitude,last_latitude,last_longitude").gte("last_seen",new Date(Date.now()-48*3600e3).toISOString()).neq("status","closed").order("last_seen",{ascending:false}).limit(30);if(ee)throw ee;
  const es=(events??[]).map((e:any)=>({...e,lat:Number(e.best_latitude??e.last_latitude),lon:Number(e.best_longitude??e.last_longitude)})).filter((e:any)=>Number.isFinite(e.lat)&&Number.isFinite(e.lon));
  const [coProducts,aerProducts]=await Promise.all([search("CO"),search("AER_AI")]);
  const user=Deno.env.get("CDSE_USERNAME")??"",pass=Deno.env.get("CDSE_PASSWORD")??"";if(!user||!pass)throw new Error("CDSE credentials missing");
  const bearer=await token(user,pass);const {FS}=await h5wasm.ready;
  const coBest=new Map<string,any>(),aerBest=new Map<string,any>();let coPixels=0,aerPixels=0,downloads=0;const warnings:string[]=[];

  async function processProduct(p:any,kind:"CO"|"AER_AI"){
   const r=await authFetch(DL+"/Products("+p.Id+")/$value",bearer);if(!r.ok){warnings.push(kind+" "+p.Name+" HTTP "+r.status);return false}
   const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length<8||bytes[0]!==137||bytes[1]!==72||bytes[2]!==68||bytes[3]!==70){warnings.push(kind+" "+p.Name+" not HDF5");return false}
   downloads++;const fn="/s5p_"+kind+"_"+p.Id+".nc";FS.writeFile(fn,bytes);
   try{
    const f=new h5wasm.File(fn,"r"),lat=getv(f,"/PRODUCT/latitude"),lon=getv(f,"/PRODUCT/longitude"),qa=getv(f,"/PRODUCT/qa_value");
    const v1=kind==="CO"?getv(f,"/PRODUCT/carbonmonoxide_total_column"):getv(f,"/PRODUCT/aerosol_index_340_380");
    const v2=kind==="AER_AI"?getv(f,"/PRODUCT/aerosol_index_354_388"):[];
    const n=Math.min(lat.length,lon.length,v1.length,qa.length||Number.MAX_SAFE_INTEGER);if(kind==="CO")coPixels+=n;else aerPixels+=n;
    const observed=String(p?.ContentDate?.Start??new Date().toISOString());
    for(const e of es){
      let best:any=null;
      for(let i=0;i<n;i++){
        const la=Number(lat[i]),lo=Number(lon[i]);if(!Number.isFinite(la)||!Number.isFinite(lo)||Math.abs(la-e.lat)>0.7||Math.abs(lo-e.lon)>1.0)continue;
        const q=qaNorm(qa[i]);if(q!==null&&q<0.5)continue;
        const d=hav(e.lat,e.lon,la,lo);if(d>MAX_DISTANCE_KM||best&&d>=best.distance_km)continue;
        const value1=Number(v1[i]);if(!Number.isFinite(value1)||Math.abs(value1)>1e6)continue;
        best={distance_km:d,qa:q,value1,value2:v2.length>i&&Number.isFinite(Number(v2[i]))?Number(v2[i]):null,observed,product:p.Name};
      }
      if(best){
        const map=kind==="CO"?coBest:aerBest,prev=map.get(e.id);
        if(!prev||Date.parse(best.observed)>Date.parse(prev.observed)||(best.observed===prev.observed&&best.distance_km<prev.distance_km))map.set(e.id,best);
      }
    }
    f.close();
   }catch(ex){warnings.push(kind+" "+p.Name+": "+(ex instanceof Error?ex.message:String(ex)))}
   try{FS.unlink(fn)}catch{}
   return true;
  }

  const coIds=coProducts.map((p:any)=>String(p.Id)),aerIds=aerProducts.map((p:any)=>String(p.Id));
  const [{data:coCached},{data:aerCached}]=await Promise.all([
    coIds.length?sb.from("processed_source_products").select("product_id").eq("source_key","S5P_CO").in("product_id",coIds):Promise.resolve({data:[]}),
    aerIds.length?sb.from("processed_source_products").select("product_id").eq("source_key","S5P_AER_AI").in("product_id",aerIds):Promise.resolve({data:[]})
  ]);
  const coDone=new Set((coCached??[]).map((x:any)=>String(x.product_id))),aerDone=new Set((aerCached??[]).map((x:any)=>String(x.product_id)));
  const coPending=coProducts.filter((p:any)=>!coDone.has(String(p.Id))),aerPending=aerProducts.filter((p:any)=>!aerDone.has(String(p.Id)));
  const processed:any[]=[];
  for(const p of coPending)if(await processProduct(p,"CO"))processed.push({source_key:"S5P_CO",product_id:String(p.Id),product_time:p?.ContentDate?.Start??null,processed_at:new Date().toISOString(),meta:{name:p.Name}});
  for(const p of aerPending)if(await processProduct(p,"AER_AI"))processed.push({source_key:"S5P_AER_AI",product_id:String(p.Id),product_time:p?.ContentDate?.Start??null,processed_at:new Date().toISOString(),meta:{name:p.Name}});
  if(processed.length)await sb.from("processed_source_products").upsert(processed,{onConflict:"source_key,product_id"});

  let updated=0;
  for(const e of es){
    const co=coBest.get(e.id),aer=aerBest.get(e.id);if(!co&&!aer)continue;
    const patch:any={};
    if(co){patch.s5p_co_observed_at=co.observed;patch.s5p_co_mol_m2=co.value1;patch.s5p_co_qa=co.qa;patch.s5p_co_distance_km=co.distance_km;}
    if(aer){patch.s5p_aer_observed_at=aer.observed;patch.s5p_aer_ai_340_380=aer.value1;patch.s5p_aer_ai_354_388=aer.value2;patch.s5p_aer_qa=aer.qa;patch.s5p_aer_distance_km=aer.distance_km;}
    const {error:ue}=await sb.from("fire_events").update(patch).eq("id",e.id);if(ue){warnings.push(e.id+": "+ue.message);continue}
    await sb.rpc("refresh_atmosphere_signal",{p_event_id:e.id});updated++;
  }

  const state={status:"active",source:"Copernicus Sentinel-5P TROPOMI",products:["CO","AER_AI"],last_success_run:new Date().toISOString(),events_considered:es.length,events_updated:updated,co_products:coProducts.length,aer_products:aerProducts.length,co_pending:coPending.length,aer_pending:aerPending.length,co_cached:coProducts.length-coPending.length,aer_cached:aerProducts.length-aerPending.length,downloads,pixels_scanned:{co:coPixels,aer_ai:aerPixels},max_event_pixel_distance_km:MAX_DISTANCE_KM,qa_min:0.5,warnings:warnings.slice(-20)};
  await sb.from("system_state").upsert({key:"monitor_sentinel5p",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
 }catch(e){
  const msg=e instanceof Error?e.message:String(e);await sb.from("system_state").upsert({key:"monitor_sentinel5p",value:{status:"error",last_error:msg,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()});return json({ok:false,error:msg},502);
 }
});