import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const VERSION="stage30-report-v1";
const BUCKET="event-reports";
const EXPECTED_CLASSES=["satellite","satellite_surface","atmosphere","geospatial","infrastructure","ground","external_osint","history"];

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function esc(v:any){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]!))}
function n(v:any,d=1){const x=Number(v);return Number.isFinite(x)?x.toFixed(d):"—"}
function dt(v:any){const s=String(v??"");return s?s.slice(0,16).replace("T"," ")+" UTC":"—"}
function arr(v:any){return Array.isArray(v)?v:[]}
function list(items:string[]){return items.length?`<ul>${items.map(x=>`<li>${x}</li>`).join("")}</ul>`:"<p>—</p>"}
function link(url:any,label:string){const u=String(url??"");return u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:"—"}

function evidenceCoverage(d:any){
  const present=new Set(arr(d?.evidence_classes).map(String));
  const available=EXPECTED_CLASSES.filter(x=>present.has(x));
  const missing=EXPECTED_CLASSES.filter(x=>!present.has(x));
  return{available,missing,count:available.length,total:EXPECTED_CLASSES.length};
}

function sourceRows(d:any){
  const rows:string[]=[];
  const sat=d?.satellite??{};
  for(const s of arr(sat.source_stats))rows.push(`<tr><td>${esc(s.source)}</td><td>${esc(s.observations)}</td><td>${dt(s.first_seen)}</td><td>${dt(s.last_seen)}</td><td>${n(s.frp_max_mw,1)}</td></tr>`);
  return rows.join("")||'<tr><td colspan="5">—</td></tr>';
}

function infrastructureRows(d:any){
  const rows:string[]=[];
  for(const x of arr(d?.infrastructure?.features).slice(0,20)){
    const p=x?.profile??{};
    const detail=[p.voltage&&`U ${p.voltage}`,p.circuits&&`circuits ${p.circuits}`,p.substance&&`substance ${p.substance}`,p.diameter&&`Ø ${p.diameter}`,p.operator&&`operator ${p.operator}`].filter(Boolean).join(" • ");
    rows.push(`<tr><td>${esc(x.infra_label??x.infra_type)}</td><td>${esc(x.name??"—")}</td><td>${n(Number(x.distance_m)/1000,2)} km</td><td>${esc(detail||"—")}</td></tr>`);
  }
  return rows.join("")||'<tr><td colspan="4">—</td></tr>';
}

function groundRows(d:any){
  const rows:string[]=[];
  for(const x of arr(d?.ground?.measurements).slice(0,20))rows.push(`<tr><td>${esc(x.source)}</td><td>${esc(x.station_name??x.station_id)}</td><td>${esc(x.parameter)}</td><td>${esc(x.value)} ${esc(x.unit)}</td><td>${n(x.distance_km,1)} km</td><td>${dt(x.observed_at)}</td></tr>`);
  return rows.join("")||'<tr><td colspan="6">—</td></tr>';
}

function externalRows(d:any){
  const rows:string[]=[];
  for(const x of arr(d?.external_osint?.evidence).slice(0,20))rows.push(`<tr><td>${esc(x.source)}</td><td>${esc(x.title??x.category)}</td><td>${esc(x.correlation_class)}</td><td>${x.distance_km==null?"—":n(x.distance_km,1)+" km"}</td><td>${dt(x.observed_at)}</td><td>${link(x.source_url,"source")}</td></tr>`);
  return rows.join("")||'<tr><td colspan="6">—</td></tr>';
}

function html(d:any,generatedAt:string,visualUrl:string|null){
  const e=d?.event??{},sat=d?.satellite??{},surf=d?.satellite_surface??{},atm=d?.atmosphere??{},geo=d?.geospatial??{},inf=d?.infrastructure??{},hist=d?.history??{};
  const cov=evidenceCoverage(d),flags=arr(d?.context_flags).map(String),classes=arr(d?.evidence_classes).map(String);
  const b=surf?.before??null,a=surf?.after??null;
  const visual=visualUrl?`<div class="visual"><img src="${esc(visualUrl)}" alt="Sentinel-2 surface evidence montage"></div>`:"<p>Visual montage unavailable or not yet generated.</p>";
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GeoWatch Event Evidence Report ${esc(String(e.id??"").slice(0,8))}</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f6f8;color:#1f2937;margin:0}.wrap{max-width:1100px;margin:auto;padding:22px}.head,.card{background:white;border-radius:12px;padding:18px;margin:0 0 14px;box-shadow:0 1px 4px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.kv{background:#f8fafc;border-radius:8px;padding:10px}.muted{color:#64748b}.ok{color:#166534}.wait{color:#92400e}.tag{display:inline-block;background:#e2e8f0;border-radius:999px;padding:4px 8px;margin:2px;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}th{background:#f8fafc}.visual img{max-width:100%;height:auto;border-radius:8px}.warn{background:#fff7ed;border-left:4px solid #f97316;padding:10px}.footer{font-size:12px;color:#64748b;margin-top:18px}a{color:#0369a1}
</style></head><body><div class="wrap">
<div class="head"><h1>Event Evidence Report</h1><div class="grid">
<div class="kv"><b>ID</b><br>${esc(String(e.id??"").slice(0,8))}</div>
<div class="kv"><b>Область</b><br>${esc(e.oblast??"—")}</div>
<div class="kv"><b>Координаты</b><br>${n(e.latitude,5)}, ${n(e.longitude,5)}</div>
<div class="kv"><b>Период</b><br>${dt(e.first_seen)} → ${dt(e.last_seen)}</div>
<div class="kv"><b>Evidence coverage</b><br><span class="ok">${cov.count}/${cov.total}</span> классов доступны</div>
<div class="kv"><b>Report</b><br>${esc(VERSION)}<br>${esc(generatedAt)}</div>
</div></div>

<div class="card"><h2>1. Наблюдение тепловой аномалии</h2><div class="grid">
<div class="kv"><b>Наблюдений</b><br>${esc(e.observation_count??0)}</div>
<div class="kv"><b>Спутниковых платформ</b><br>${esc(sat.source_count??0)}</div>
<div class="kv"><b>FRP max</b><br>${n(sat.frp_max_mw,1)} MW</div>
<div class="kv"><b>FRP avg</b><br>${n(sat.frp_avg_mw,1)} MW</div>
<div class="kv"><b>FRP trend</b><br>${esc(sat.frp_trend??"—")}</div>
<div class="kv"><b>Confidence</b><br>${esc(e.confidence_label??e.confidence_level??"—")}</div>
</div>
<table><thead><tr><th>Source</th><th>Obs.</th><th>First</th><th>Last</th><th>FRP max</th></tr></thead><tbody>${sourceRows(d)}</tbody></table></div>

<div class="card"><h2>2. Sentinel-2 Surface Evidence</h2>
<div class="grid">
<div class="kv"><b>Status</b><br>${esc(surf.status??"pending")}</div>
<div class="kv"><b>BEFORE</b><br>${b?dt(b.datetime)+"<br>cloud "+n(b.cloud_pct,1)+"%<br>NBR "+n(b.nbr,3)+" • NDVI "+n(b.ndvi,3):"—"}</div>
<div class="kv"><b>AFTER</b><br>${a?dt(a.datetime)+"<br>cloud "+n(a.cloud_pct,1)+"%<br>NBR "+n(a.nbr,3)+" • NDVI "+n(a.ndvi,3):"—"}</div>
<div class="kv"><b>dNBR / ΔNDVI</b><br>${n(surf.dnbr,3)} / ${n(surf.dndvi,3)}</div>
</div>
${visual}
<p>${b?link(b.stac_url,"STAC BEFORE"):""} ${a?" • "+link(a.stac_url,"STAC AFTER"):""}</p></div>

<div class="card"><h2>3. Атмосферный контекст</h2><div class="grid">
<div class="kv"><b>Signal</b><br>${esc(atm.signal_level??"—")}</div>
<div class="kv"><b>CAMS PM2.5</b><br>${n(atm.cams_pm2_5_ug_m3,1)} µg/m³</div>
<div class="kv"><b>CAMS CO</b><br>${n(atm.cams_co_ug_m3,0)} µg/m³</div>
<div class="kv"><b>Sentinel-5P CO</b><br>${n(atm.s5p_co_mol_m2,4)} mol/m²</div>
<div class="kv"><b>Aerosol Index</b><br>${n(atm.s5p_aer_ai_340_380,3)}</div>
<div class="kv"><b>Wind transport</b><br>${atm.plume_forecast&&Object.keys(atm.plume_forecast).length?"available":"—"}</div>
</div></div>

<div class="card"><h2>4. Географический контекст</h2>
<div class="grid"><div class="kv"><b>Context</b><br>${esc(geo.context_type??"—")}</div><div class="kv"><b>Nearest feature</b><br>${esc(geo.nearest_feature??"—")} ${geo.nearest_feature_distance_m==null?"":n(Number(geo.nearest_feature_distance_m)/1000,2)+" km"}</div><div class="kv"><b>Infrastructure features</b><br>${esc(inf.feature_count??0)}</div></div>
<table><thead><tr><th>Type</th><th>Name</th><th>Distance</th><th>Public metadata</th></tr></thead><tbody>${infrastructureRows(d)}</tbody></table>
<p>${link(inf.openinframap_url,"OpenInfraMap review")}</p></div>

<div class="card"><h2>5. Наземные экологические датчики</h2>
<table><thead><tr><th>Source</th><th>Station</th><th>Parameter</th><th>Value</th><th>Distance</th><th>Time</th></tr></thead><tbody>${groundRows(d)}</tbody></table></div>

<div class="card"><h2>6. External OSINT</h2>
<table><thead><tr><th>Source</th><th>Title/category</th><th>Correlation</th><th>Distance</th><th>Time</th><th>Link</th></tr></thead><tbody>${externalRows(d)}</tbody></table></div>

<div class="card"><h2>7. История точки</h2><div class="grid">
<div class="kv"><b>30 days</b><br>${esc(hist.events_30d??0)}</div><div class="kv"><b>90 days</b><br>${esc(hist.events_90d??0)}</div><div class="kv"><b>365 days</b><br>${esc(hist.events_365d??0)}</div><div class="kv"><b>Hotspot class</b><br>${esc(hist.hotspot_class??"—")}</div></div></div>

<div class="card"><h2>8. Evidence coverage & context flags</h2>
<p><b>Available classes:</b> ${classes.map(x=>`<span class="tag">${esc(x)}</span>`).join("")||"—"}</p>
<p><b>Not currently represented:</b> ${cov.missing.map(x=>`<span class="tag">${esc(x)}</span>`).join("")||"none"}</p>
<p><b>Context flags:</b> ${flags.map(x=>`<span class="tag">${esc(x)}</span>`).join("")||"—"}</p>
<div class="warn"><b>Interpretation:</b> coverage is data availability, not a confidence, severity, attribution or causal score. Spatial/temporal proximity and spectral change do not establish the cause of the thermal anomaly.</div></div>

<div class="footer">Generated by GeoWatch / NASA FIRMS monitoring stack • ${esc(VERSION)} • ${esc(generatedAt)}<br>Underlying sources retain their own attribution and usage terms.</div>
</div></body></html>`;
}

async function sha256Hex(s:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function tempToken(){return (crypto.randomUUID()+crypto.randomUUID()).replaceAll("-","")}

Deno.serve(async(req:Request)=>{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});

  if(req.method==="GET"){
    try{
      const u=new URL(req.url),eventId=String(u.searchParams.get("event")??""),token=String(u.searchParams.get("token")??""),format=String(u.searchParams.get("format")??"html").toLowerCase();
      if(!eventId||!token||!["html","json"].includes(format))return json({ok:false,error:"invalid viewer request"},400);
      const {data:r,error}=await sb.from("event_evidence_reports").select("viewer_token_hash,viewer_expires_at,html_storage_path,json_storage_path").eq("fire_event_id",eventId).maybeSingle();
      if(error||!r)return json({ok:false,error:"report not found"},404);
      const exp=Date.parse(String(r.viewer_expires_at??""));
      if(!Number.isFinite(exp)||exp<Date.now())return json({ok:false,error:"report link expired"},410);
      if(await sha256Hex(token)!==String(r.viewer_token_hash??""))return json({ok:false,error:"invalid report token"},401);
      const path=format==="json"?r.json_storage_path:r.html_storage_path;
      if(!path)return json({ok:false,error:"report object missing"},404);
      const {data:file,error:de}=await sb.storage.from(BUCKET).download(String(path));
      if(de||!file)return json({ok:false,error:"report object unavailable"},404);
      const bytes=new Uint8Array(await file.arrayBuffer());
      return new Response(bytes,{status:200,headers:{
        "content-type":format==="html"?"text/html; charset=utf-8":"application/json; charset=utf-8",
        "cache-control":"private, max-age=300",
        "content-security-policy":format==="html"?"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'":"default-src 'none'",
        "x-content-type-options":"nosniff",
        "referrer-policy":"no-referrer"
      }});
    }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},502)}
  }

  if(req.method!=="POST")return json({ok:false,error:"GET or POST required"},405);
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);

  let body:any={};try{body=await req.json()}catch{}
  const q=String(body.event_id??"").trim();
  if(!q)return json({ok:false,error:"event_id required"},400);

  try{
    const {data:d,error:de}=await sb.rpc("firewatch_dossier",{p_query:q});
    if(de)throw de;if(!d?.event?.id)return json({ok:false,error:"event not found"},404);
    const eventId=String(d.event.id),generatedAt=new Date().toISOString();

    let visualUrl:string|null=null;
    const visualPath=d?.satellite_surface?.visual?.storage_path;
    if(visualPath){
      const {data:signed}=await sb.storage.from("satellite-evidence").createSignedUrl(String(visualPath),21600);
      visualUrl=signed?.signedUrl??null;
    }

    const coverage=evidenceCoverage(d);
    const reportSnapshot={
      report_version:VERSION,
      generated_at:generatedAt,
      event_id:eventId,
      coverage:{available:coverage.available,missing:coverage.missing,count:coverage.count,total:coverage.total},
      disclaimer:"Evidence coverage is availability only. The report does not establish cause or attribution.",
      dossier:d
    };
    const h=html(d,generatedAt,visualUrl);
    const j=JSON.stringify(reportSnapshot,null,2);
    const base=`${eventId}/${VERSION}`,htmlPath=`${base}.html`,jsonPath=`${base}.json`;

    const [hu,ju]=await Promise.all([
      sb.storage.from(BUCKET).upload(htmlPath,new Blob([h],{type:"text/html; charset=utf-8"}),{contentType:"text/html; charset=utf-8",upsert:true,cacheControl:"300"}),
      sb.storage.from(BUCKET).upload(jsonPath,new Blob([j],{type:"application/json"}),{contentType:"application/json",upsert:true,cacheControl:"300"})
    ]);
    if(hu.error)throw hu.error;if(ju.error)throw ju.error;

    const classes=arr(d.evidence_classes).map(String),flags=arr(d.context_flags).map(String);
    const viewerToken=tempToken(),viewerHash=await sha256Hex(viewerToken),viewerExpires=new Date(Date.now()+21600_000).toISOString();
    const {data:eventRow}=await sb.from("fire_events").select("updated_at").eq("id",eventId).single();
    const {error:ue}=await sb.from("event_evidence_reports").upsert({
      fire_event_id:eventId,report_version:VERSION,generated_at:generatedAt,event_updated_at:eventRow?.updated_at??generatedAt,
      dossier_schema_version:String(d.schema_version??""),evidence_classes:classes,context_flags:flags,
      coverage_available:coverage.count,coverage_expected:coverage.total,
      html_storage_path:htmlPath,json_storage_path:jsonPath,
      html_bytes:new TextEncoder().encode(h).length,json_bytes:new TextEncoder().encode(j).length,
      viewer_token_hash:viewerHash,viewer_expires_at:viewerExpires,
      last_error:null,updated_at:generatedAt
    });
    if(ue)throw ue;

    const viewerBase=`${url}/functions/v1/firewatch-event-report?event=${encodeURIComponent(eventId)}&token=${encodeURIComponent(viewerToken)}`;
    const [htmlDownload,jsonDownload]=await Promise.all([
      sb.storage.from(BUCKET).createSignedUrl(htmlPath,900),
      sb.storage.from(BUCKET).createSignedUrl(jsonPath,900)
    ]);
    if(htmlDownload.error)throw htmlDownload.error;if(jsonDownload.error)throw jsonDownload.error;
    return json({
      ok:true,event_id:eventId,report_version:VERSION,generated_at:generatedAt,
      coverage_available:coverage.count,coverage_expected:coverage.total,
      evidence_classes:classes,missing_classes:coverage.missing,
      surface_status:d?.satellite_surface?.status??"pending",
      visual_status:d?.satellite_surface?.visual?.status??"pending",
      viewer_expires_at:viewerExpires,
      html_url:`${viewerBase}&format=html`,json_url:`${viewerBase}&format=json`,
      html_download_url:htmlDownload.data.signedUrl,json_download_url:jsonDownload.data.signedUrl,
      html_bytes:new TextEncoder().encode(h).length,json_bytes:new TextEncoder().encode(j).length
    });
  }catch(e){
    return json({ok:false,error:e instanceof Error?e.message:String(e)},502);
  }
});

