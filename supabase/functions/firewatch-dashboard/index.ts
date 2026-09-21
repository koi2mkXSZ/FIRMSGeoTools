import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const enc=new TextEncoder();

function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function hmac(secret:string,value:string){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(value))))}
function safeEq(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function originOf(v:string|null|undefined){try{return v?new URL(v).origin:null}catch{return null}}
function headers(origin:string|null,allowed:string|null){
  const h:Record<string,string>={
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "referrer-policy":"no-referrer",
    "x-content-type-options":"nosniff"
  };
  if(origin&&allowed&&origin===allowed){
    h["access-control-allow-origin"]=origin;
    h["access-control-allow-methods"]="GET,POST,OPTIONS";
    h["access-control-allow-headers"]="content-type";
    h["vary"]="Origin";
  }
  return h;
}
function j(data:unknown,status:number,origin:string|null,allowed:string|null){return new Response(JSON.stringify(data),{status,headers:headers(origin,allowed)})}

Deno.serve(async(req:Request)=>{
  const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!base||!key)return new Response(JSON.stringify({ok:false,error:"Missing Supabase runtime environment"}),{status:500,headers:{"content-type":"application/json"}});
  const sb=createClient(base,key,{auth:{persistSession:false}});

  const {data:pc,error:pce}=await sb.from("project_config").select("project_name,dashboard_enabled,dashboard_public_url").eq("id",true).single();
  if(pce)return new Response(JSON.stringify({ok:false,error:"Dashboard configuration unavailable"}),{status:503,headers:{"content-type":"application/json"}});
  const origin=req.headers.get("origin"),allowed=originOf(pc?.dashboard_public_url);

  if(req.method==="OPTIONS"){
    if(!origin||!allowed||origin!==allowed)return new Response(null,{status:403});
    return new Response(null,{status:204,headers:headers(origin,allowed)});
  }

  if(pc?.dashboard_enabled===false)return j({ok:false,error:"Dashboard disabled"},403,origin,allowed);
  if(origin&&(!allowed||origin!==allowed))return j({ok:false,error:"Origin not allowed"},403,origin,allowed);

  const u=new URL(req.url),exp=Number(u.searchParams.get("exp")||0),sig=String(u.searchParams.get("sig")||""),now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(exp)||exp<now||exp>now+12*3600||!sig)return j({ok:false,error:"Invalid or expired dashboard signature"},401,origin,allowed);

  const {data:secret,error:se}=await sb.rpc("firewatch_dashboard_secret");
  if(se||!secret)return j({ok:false,error:"Dashboard auth secret unavailable"},503,origin,allowed);
  if(!safeEq(sig,await hmac(String(secret),"dashboard:"+String(exp))))return j({ok:false,error:"Invalid dashboard signature"},401,origin,allowed);

  const action=u.searchParams.get("action");
  if(!action)return j({ok:true,service:"FIRMSGeoTools Dashboard API",version:"core-dashboard-v2-static"},200,origin,allowed);

  try{
    const body:any=req.method==="POST"?await req.json().catch(()=>({})):{};

    if(action==="bootstrap"){
      const hours=Math.max(1,Math.min(Number(body.hours||24),8760));
      const [geo,a,cov,integ,e]=await Promise.all([
        sb.rpc("firewatch_dashboard_geography"),
        sb.rpc("firewatch_analytics_summary",{p_hours:hours}),
        sb.rpc("firewatch_source_coverage_summary"),
        sb.rpc("firewatch_integrity_diagnostics"),
        sb.rpc("firewatch_search_events",{p_filters:{limit:50}})
      ]);
      for(const x of [geo,a,cov,integ,e])if(x.error)throw x.error;
      return j({ok:true,project_name:pc?.project_name??"FIRMSGeoTools",geography:geo.data??{},analytics:a.data??{},coverage:cov.data??{},integrity:integ.data??{},search:e.data??{}},200,origin,allowed);
    }

    if(action==="search"){
      const f=body&&typeof body.filters==="object"?body.filters:{};
      f.limit=Math.min(Number(f.limit||50),50);
      const {data,error}=await sb.rpc("firewatch_search_events",{p_filters:f});
      if(error)throw error;
      return j(data??{count:0,events:[]},200,origin,allowed);
    }

    if(action==="detail"){
      const id=String(body.id||"").trim();
      const {data,error}=await sb.rpc("firewatch_event_detail",{p_query:id||null});
      if(error)throw error;
      if(!data)return j({ok:false,error:"not found"},404,origin,allowed);
      return j({ok:true,event:data},200,origin,allowed);
    }

    return j({ok:false,error:"unknown action"},404,origin,allowed);
  }catch(e){
    return j({ok:false,error:e instanceof Error?e.message:String(e)},500,origin,allowed);
  }
});