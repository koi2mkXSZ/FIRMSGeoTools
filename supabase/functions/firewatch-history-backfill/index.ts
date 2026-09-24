import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const FIRMS_BASE="https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const AVAIL_BASE="https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv";
const UKRAINE_BBOX="21.5,43.5,41.5,53.5";
const CHUNK_DAYS=5;
const GRID_DEG=0.0025;
const FAMILIES=[
  {family:"MODIS",preferred:["MODIS_SP","MODIS_NRT"]},
  {family:"VIIRS_NOAA20",preferred:["VIIRS_NOAA20_SP","VIIRS_NOAA20_NRT"]},
  {family:"VIIRS_NOAA21",preferred:["VIIRS_NOAA21_NRT"]},
  {family:"VIIRS_SNPP",preferred:["VIIRS_SNPP_SP","VIIRS_SNPP_NRT"]},
] as const;

type CsvRow=Record<string,string>;
type Availability=Record<string,{min:string,max:string}>;
function json(data:unknown,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseCsvLine(line:string){const out:string[]=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(ch===","&&!quoted){out.push(value);value=""}else value+=ch}out.push(value);return out}
function parseCsv(csv:string):CsvRow[]{const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim()!=="");if(lines.length<2)return[];const headers=parseCsvLine(lines[0]).map(x=>x.trim());return lines.slice(1).map(line=>{const vals=parseCsvLine(line),row:CsvRow={};headers.forEach((h,i)=>row[h]=vals[i]??"");return row})}
function isoDate(d:Date){return d.toISOString().slice(0,10)}
function addDays(s:string,n:number){const d=new Date(`${s}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return isoDate(d)}
function cmp(a:string,b:string){return a<b?-1:a>b?1:0}
async function fetchAvailability(mapKey:string):Promise<Availability>{const r=await fetch(`${AVAIL_BASE}/${encodeURIComponent(mapKey)}/ALL`,{headers:{"user-agent":"NASA-FIRMS-UA-history/1.0"},signal:AbortSignal.timeout(20000)});const t=await r.text();if(!r.ok)throw new Error(`FIRMS availability HTTP ${r.status}: ${t.slice(0,200)}`);const out:Availability={};for(const row of parseCsv(t)){const id=(row.data_id??row.source??"").trim(),min=(row.min_date??"").trim(),max=(row.max_date??"").trim();if(id&&min&&max)out[id]={min,max}}return out}
function chooseSource(pref:readonly string[],day:string,a:Availability){for(const s of pref){const x=a[s];if(x&&cmp(day,x.min)>=0&&cmp(day,x.max)<=0)return s}return null}
async function fetchDay(mapKey:string,source:string,day:string){const u=`${FIRMS_BASE}/${encodeURIComponent(mapKey)}/${source}/${UKRAINE_BBOX}/1/${day}`;const r=await fetch(u,{headers:{"user-agent":"NASA-FIRMS-UA-history/1.0"},signal:AbortSignal.timeout(30000)});const t=await r.text();if(!r.ok)throw new Error(`${source} ${day}: HTTP ${r.status}: ${t.slice(0,200)}`);return parseCsv(t).map(row=>({latitude:row.latitude??"",longitude:row.longitude??"",day:row.acq_date??day,frp:row.frp??"",confidence:row.confidence??""}))}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"Требуется POST-запрос"},405);
  const mapKey=Deno.env.get("FIRMS_MAP_KEY"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!mapKey||!url||!key)return json({ok:false,error:"Отсутствует обязательная настройка среды"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}}),secret=req.headers.get("x-cron-secret")??"";
  const {data:authorized,error:authError}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:secret});
  if(authError||authorized!==true)return json({ok:false,error:"Нет доступа"},401);
  const started=new Date();
  try{
    const today=isoDate(started),defaultEnd=addDays(today,-1),defaultStart=addDays(defaultEnd,-364);
    const {data:stateRow}=await sb.from("system_state").select("value").eq("key","history_backfill_365d").maybeSingle();
    const old=stateRow?.value??{};
    if(old.done===true)return json({ok:true,mode:"complete",state:old});
    const startDate=old.start_date??defaultStart,endDate=old.end_date??defaultEnd,cursor=old.cursor??startDate;
    if(cmp(cursor,endDate)>0){const {data:refreshed}=await sb.rpc("refresh_all_fire_event_history");const done={...old,start_date:startDate,end_date:endDate,cursor,done:true,completed_at:new Date().toISOString(),refresh:refreshed};await sb.from("system_state").upsert({key:"history_backfill_365d",value:done,updated_at:new Date().toISOString()});return json({ok:true,mode:"complete",state:done});}
    const avail=await fetchAvailability(mapKey),days:string[]=[];for(let i=0;i<CHUNK_DAYS;i++){const d=addDays(cursor,i);if(cmp(d,endDate)<=0)days.push(d)}
    let apiCalls=0,fetchedRows=0,acceptedRows=0,upsertedCells=0;const used:Record<string,number>={},warnings:string[]=[];
    for(const day of days){
      const jobs=FAMILIES.map(async f=>{const source=chooseSource(f.preferred,day,avail);if(!source)return{family:f.family,source:null,rows:[] as any[],warning:`Нет доступного набора для ${f.family} на ${day}`};try{const rows=await fetchDay(mapKey,source,day);return{family:f.family,source,rows,warning:null}}catch(e){return{family:f.family,source,rows:[] as any[],warning:e instanceof Error?e.message:String(e)}}});
      const results=await Promise.all(jobs);
      for(const x of results){if(!x.source){if(x.warning)warnings.push(x.warning);continue}apiCalls++;used[x.source]=(used[x.source]??0)+1;fetchedRows+=x.rows.length;if(x.warning){warnings.push(x.warning);continue}const {data:r,error}=await sb.rpc("upsert_hotspot_history_batch",{p_sensor_family:x.family,p_source_used:x.source,p_rows:x.rows,p_grid_deg:GRID_DEG});if(error)throw error;acceptedRows+=Number(r?.accepted_rows??0);upsertedCells+=Number(r?.upserted_cells??0)}
    }
    const nextCursor=addDays(cursor,days.length),processedDays=Number(old.processed_days??0)+days.length;
    const state={done:false,start_date:startDate,end_date:endDate,cursor:nextCursor,last_chunk_start:cursor,last_chunk_end:days.at(-1)??cursor,processed_days:processedDays,api_calls:Number(old.api_calls??0)+apiCalls,fetched_rows:Number(old.fetched_rows??0)+fetchedRows,accepted_rows:Number(old.accepted_rows??0)+acceptedRows,upserted_cells:Number(old.upserted_cells??0)+upsertedCells,last_run:new Date().toISOString(),last_error:null,warnings:warnings.slice(-20),sources_used:used,storage_mode:"daily-grid-aggregate-no-raw",grid_deg:GRID_DEG};
    await sb.from("system_state").upsert({key:"history_backfill_365d",value:state,updated_at:new Date().toISOString()});
    return json({ok:true,mode:"backfill",days,api_calls:apiCalls,fetched_rows:fetchedRows,accepted_rows:acceptedRows,upserted_cells:upsertedCells,next_cursor:nextCursor,warnings});
  }catch(e){const message=e instanceof Error?e.message:String(e);try{await sb.from("system_state").upsert({key:"history_backfill_365d",value:{done:false,last_error:message,failed_at:new Date().toISOString()},updated_at:new Date().toISOString()})}catch{}return json({ok:false,error:message,started_at_utc:started.toISOString()},502)}
});
