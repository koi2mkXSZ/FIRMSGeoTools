import { normalizeRegionQuery as norm } from "./region_aliases.ts";
import type { RegionalFilters } from "./regional_categories.ts";

export type SettlementCandidate={
 name:string;
 latitude:number;
 longitude:number;
 place?:string|null;
 population?:number|null;
 source_id?:string|null;
};

function haversineM(a:number,b:number,c:number,d:number){
 const p=Math.PI/180,R=6371000,da=(c-a)*p,db=(d-b)*p;
 const x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(db/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
function includesNorm(v:unknown,q:unknown){
 const a=norm(v),b=norm(q);return !!a&&!!b&&a.includes(b);
}
function sourceMatches(x:any,q:unknown){
 const n=norm(q);if(!n)return true;
 const aliases=n==="osm"||n==="openstreetmap"?["openstreetmap","osm"]:
   n==="wd"||n==="wikidata"?["wikidata","wd"]:
   n==="overture"?["overture"]:[n];
 return (Array.isArray(x?.sources)?x.sources:[]).some((s:any)=>{
  const z=norm(s?.source);return aliases.some(a=>z===a||z.includes(a));
 });
}

export function applyObjectFilters(objects:any[],filters:RegionalFilters){
 const f=filters??{},min=Number(f.min_confidence??NaN),wantAddress=f.has_address==="yes"?true:f.has_address==="no"?false:null;
 return (objects??[]).filter((x:any)=>{
  if(f.settlement&&!includesNorm(x?.settlement,f.settlement))return false;
  if(f.address&&!includesNorm([x?.address,x?.normalized_location].filter(Boolean).join(" "),f.address))return false;
  if(f.brand&&!includesNorm([x?.brand,x?.canonical_name].filter(Boolean).join(" "),f.brand))return false;
  if(f.operator&&!includesNorm(x?.operator,f.operator))return false;
  if(f.source&&!sourceMatches(x,f.source))return false;
  if(Number.isFinite(min)&&Number(x?.resolution_confidence??0)<min)return false;
  if(wantAddress!==null&&Boolean(String(x?.address??"").trim())!==wantAddress)return false;
  return true;
 });
}

function bucket(lat:number,lon:number,cell:number){return Math.floor(lat/cell)+":"+Math.floor(lon/cell)}
export function enrichSettlements(objects:any[],settlements:SettlementCandidate[],maxDistanceM=25000){
 const cell=.20,grid=new Map<string,SettlementCandidate[]>();
 for(const s of settlements??[]){
  const lat=Number(s.latitude),lon=Number(s.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!String(s.name??"").trim())continue;
  const k=bucket(lat,lon,cell),a=grid.get(k)??[];a.push({...s,latitude:lat,longitude:lon});grid.set(k,a);
 }
 let direct=0,inferred=0,missing=0,addressPresent=0;
 const out=(objects??[]).map((raw:any)=>{
  const x={...raw},lat=Number(x.latitude),lon=Number(x.longitude);
  if(String(x.address??"").trim())addressPresent++;
  if(String(x.settlement??"").trim()){
   direct++;x.settlement_method=x.settlement_method??"osm_addr";x.settlement_distance_m=x.settlement_distance_m??0;
  }else if(Number.isFinite(lat)&&Number.isFinite(lon)&&grid.size){
   const bx=Math.floor(lat/cell),by=Math.floor(lon/cell);let best:SettlementCandidate|null=null,bestD=Infinity;
   for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
    const a=grid.get((bx+dx)+":"+(by+dy))??[];
    for(const s of a){const d=haversineM(lat,lon,s.latitude,s.longitude);if(d<bestD){best=s;bestD=d}}
   }
   if(best&&bestD<=maxDistanceM){
    x.settlement=best.name;x.settlement_method="osm_nearest";x.settlement_distance_m=Math.round(bestD);x.settlement_place=best.place??null;x.settlement_source_id=best.source_id??null;inferred++;
   }else missing++;
  }else missing++;
  x.normalized_location=[x.settlement,x.address].filter(Boolean).join(", ")||null;
  x.address_quality=x.address&&x.settlement?"complete":x.address?"address_only":x.settlement?"settlement_only":"coordinates_only";
  return x;
 });
 return{objects:out,summary:{settlement_direct:direct,settlement_inferred:inferred,settlement_missing:missing,address_present:addressPresent,settlement_candidates:(settlements??[]).length,max_inference_distance_m:maxDistanceM}};
}

export function toGeoJson(objects:any[],meta:any={}){
 return{
  type:"FeatureCollection",
  name:"GeoWatch Regional Object Search",
  metadata:meta,
  features:(objects??[]).map((x:any)=>({
   type:"Feature",
   geometry:{type:"Point",coordinates:[Number(x.longitude),Number(x.latitude)]},
   properties:{
    name:x.canonical_name??null,
    category_keys:Array.isArray(x.category_keys)?x.category_keys:[],
    brand:x.brand??null,
    operator:x.operator??null,
    settlement:x.settlement??null,
    settlement_method:x.settlement_method??null,
    settlement_distance_m:x.settlement_distance_m??null,
    address:x.address??null,
    normalized_location:x.normalized_location??null,
    address_quality:x.address_quality??null,
    source_count:Number(x.source_count??0),
    sources:(Array.isArray(x.sources)?x.sources:[]).map((s:any)=>({source:s.source,source_id:s.source_id,url:s.url??null})),
    resolution_status:x.resolution_status??null,
    resolution_confidence:Number(x.resolution_confidence??0),
    wikidata_qid:x.wikidata_qid??null
   }
  }))
 };
}
