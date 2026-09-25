export type TemporalFamily="neptun"|"osint"|"atmosphere"|"satellite"|"surface"|"firms";
export type TemporalItem={
  source:string;
  family:TemporalFamily;
  source_time:string;
  time_semantics:string;
  label:string;
  ingested_at?:string|null;
  confidence?:number|null;
  scale_seconds?:number|null;
  metadata?:Record<string,unknown>;
};
export type TemporalTimelineItem=TemporalItem&{
  offset_seconds:number;
  relation:"before"|"simultaneous"|"after";
};

const FAMILY_WEIGHTS:Record<string,number>={neptun:0.30,osint:0.20,atmosphere:0.25,satellite:0.25};
const DEFAULT_SCALE:Record<string,number>={neptun:21600,osint:86400,atmosphere:21600,satellite:7200};

function parseMs(v:unknown){const n=Date.parse(String(v??""));return Number.isFinite(n)?n:null}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v))}
function uniq<T>(xs:T[]){return [...new Set(xs)]}

export function buildTemporalProfile(referenceTime:string,input:TemporalItem[]){
  const ref=parseMs(referenceTime);
  if(ref==null)throw new Error("invalid reference time");
  const seen=new Set<string>();
  const timeline:TemporalTimelineItem[]=[];
  for(const raw of input){
    const t=parseMs(raw.source_time);if(t==null)continue;
    const key=[raw.source,raw.family,new Date(t).toISOString(),raw.time_semantics,raw.label].join("|");
    if(seen.has(key))continue;seen.add(key);
    const offset=Math.round((t-ref)/1000);
    timeline.push({...raw,source_time:new Date(t).toISOString(),offset_seconds:offset,relation:offset<0?"before":offset>0?"after":"simultaneous"});
  }
  timeline.sort((a,b)=>Date.parse(a.source_time)-Date.parse(b.source_time)||a.source.localeCompare(b.source)||a.time_semantics.localeCompare(b.time_semantics)||a.label.localeCompare(b.label));

  const summary:Record<string,{count:number;best_abs_offset_seconds:number;best_offset_seconds:number;proximity_score:number;weight:number}>={};
  for(const family of ["neptun","osint","atmosphere","satellite"]){
    const rows=timeline.filter(x=>x.family===family);
    if(!rows.length)continue;
    let best=rows[0],bestP=-1;
    for(const x of rows){
      const scale=Math.max(60,Number(x.scale_seconds??DEFAULT_SCALE[family]??21600));
      const p=clamp(1-Math.abs(x.offset_seconds)/scale,0,1);
      if(p>bestP){bestP=p;best=x}
    }
    summary[family]={
      count:rows.length,
      best_abs_offset_seconds:Math.abs(best.offset_seconds),
      best_offset_seconds:best.offset_seconds,
      proximity_score:Math.round(bestP*100),
      weight:FAMILY_WEIGHTS[family]
    };
  }

  const families=Object.keys(summary);
  const weightPresent=families.reduce((s,f)=>s+(FAMILY_WEIGHTS[f]??0),0);
  const alignment=weightPresent>0
    ? Math.round(families.reduce((s,f)=>s+summary[f].proximity_score*(FAMILY_WEIGHTS[f]??0),0)/weightPresent)
    : null;
  const coverage=Math.round(clamp(weightPresent,0,1)*100);
  const consistency=alignment==null?null:Math.round(0.8*alignment+0.2*coverage);
  const level=consistency==null?"unknown":consistency>=80?"strong_alignment":consistency>=60?"aligned":consistency>=35?"partial":"weak";

  const flags:string[]=[];
  const neptun=timeline.filter(x=>x.family==="neptun");
  if(neptun.length&&neptun.every(x=>x.offset_seconds>0))flags.push("neptun_post_fallback");
  if(neptun.some(x=>x.offset_seconds<=0))flags.push("neptun_pre_or_at_firms");
  const osint=timeline.filter(x=>x.family==="osint");
  if(osint.length&&osint.every(x=>x.offset_seconds>0))flags.push("osint_publication_after_firms");
  if(timeline.some(x=>x.offset_seconds<0)&&timeline.some(x=>x.offset_seconds>0))flags.push("timeline_spans_firms");
  if(timeline.some(x=>{
    const a=parseMs(x.ingested_at);const b=parseMs(x.source_time);
    return a!=null&&b!=null&&a-b>3600_000;
  }))flags.push("ingest_lag_over_1h");

  const explanations:string[]=[];
  if(summary.neptun)explanations.push("Neptun closest selected source-time offset: "+summary.neptun.best_offset_seconds+"s.");
  if(summary.osint)explanations.push("OSINT publication-time proximity: "+summary.osint.proximity_score+"/100; publication time is not treated as observation time.");
  if(summary.atmosphere)explanations.push("Atmospheric/radar closest temporal alignment: "+summary.atmosphere.proximity_score+"/100.");
  if(summary.satellite)explanations.push("Independent satellite acquisition alignment: "+summary.satellite.proximity_score+"/100.");
  explanations.push("Temporal proximity is contextual evidence only and does not establish cause or attribution.");

  return{
    profile_version:"temporal-correlation-v1",
    reference_time:new Date(ref).toISOString(),
    reference_source:"FIRMS first_seen",
    consistency_score:consistency,
    consistency_level:level,
    alignment_score:alignment,
    coverage_score:coverage,
    source_count:uniq(timeline.map(x=>x.source)).length,
    family_count:families.length,
    timeline,
    source_summary:summary,
    flags:uniq(flags),
    explanations
  };
}
