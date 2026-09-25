import {haversineM,type SpatialPlan} from "./regional_spatial.ts";
const RINGS=[0,500,1000,2000,5000,10000];
const SECTORS=["N","NE","E","SE","S","SW","W","NW"];
function round(v:number,d=3){const p=10**d;return Math.round(v*p)/p}
function bearing(aLat:number,aLon:number,bLat:number,bLon:number){const p=Math.PI/180,y=Math.sin((bLon-aLon)*p)*Math.cos(bLat*p),x=Math.cos(aLat*p)*Math.sin(bLat*p)-Math.sin(aLat*p)*Math.cos(bLat*p)*Math.cos((bLon-aLon)*p);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function sectorOf(b:number){return SECTORS[Math.round(b/45)%8]}
function ringLabel(a:number,b:number){return a===0?"0-"+(b/1000)+" km":(a/1000)+"-"+(b/1000)+" km"}
function ringAreaKm2(a:number,b:number){return Math.PI*(b*b-a*a)/1e6}
function centerLimit(plan:SpatialPlan){return plan.mode==="radius"?Number(plan.radius_m??0):plan.mode==="nearest"?Number(plan.search_radius_m??0):0}
function ringArea(ring:any[]){if(!Array.isArray(ring)||ring.length<3)return 0;const lat0=ring.reduce((s:any,p:any)=>s+Number(p?.[1]??0),0)/ring.length,cf=Math.cos(lat0*Math.PI/180),pts=ring.map((p:any)=>[Number(p[0])*111.32*cf,Number(p[1])*111.32]);let a=0;for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1];return Math.abs(a)/2}function polygonAreaKm2(g:any){const polys=g?.type==="Polygon"?[g.coordinates]:g?.type==="MultiPolygon"?g.coordinates:[];let total=0;for(const p of polys??[]){if(!Array.isArray(p)||!p.length)continue;let a=ringArea(p[0]);for(let i=1;i<p.length;i++)a-=ringArea(p[i]);total+=Math.max(0,a)}return total}
function studyAreaKm2(plan:SpatialPlan){if(plan.mode==="radius")return Math.PI*Number(plan.radius_m??0)**2/1e6;if(plan.mode==="nearest")return Math.PI*Number(plan.search_radius_m??0)**2/1e6;if(plan.mode==="route")return (Number(plan.route_length_m??0)*2*Number(plan.corridor_m??0)+Math.PI*Number(plan.corridor_m??0)**2)/1e6;if(plan.mode==="polygon")return polygonAreaKm2(plan.geometry);return 0}
function categoryCounts(xs:any[]){const o:Record<string,number>={};for(const x of xs)for(const k of Array.isArray(x?.category_keys)?x.category_keys:[])o[String(k)]=(o[String(k)]??0)+1;return o}
export function analyzeSpatial(objects:any[],plan:SpatialPlan){
 const xs=Array.isArray(objects)?objects:[],area=studyAreaKm2(plan),base:any={object_count:xs.length,study_area_km2:round(area,3),density_per_km2:area>0?round(xs.length/area,3):null,category_counts:categoryCounts(xs),mode:plan.mode};
 if((plan.mode==="radius"||plan.mode==="nearest")&&plan.center){
  const limit=centerLimit(plan),rings:any[]=[];
  for(let i=0;i<RINGS.length-1;i++){const a=RINGS[i],b=Math.min(RINGS[i+1],limit);if(b<=a)continue;const members=xs.filter(x=>{const d=Number(x.distance_m??haversineM(plan.center!.lat,plan.center!.lon,Number(x.latitude),Number(x.longitude)));return d>=a&&d<b});const ar=ringAreaKm2(a,b);rings.push({from_m:a,to_m:b,label:ringLabel(a,b),count:members.length,area_km2:round(ar,3),density_per_km2:ar>0?round(members.length/ar,3):null})}
  if(limit>10000){const members=xs.filter(x=>Number(x.distance_m??0)>=10000&&Number(x.distance_m??0)<=limit),ar=ringAreaKm2(10000,limit);rings.push({from_m:10000,to_m:limit,label:"10-"+round(limit/1000,1)+" km",count:members.length,area_km2:round(ar,3),density_per_km2:ar>0?round(members.length/ar,3):null})}
  const sectors=SECTORS.map(name=>({sector:name,count:0,category_counts:{} as Record<string,number>}));
  for(const x of xs){const s=sectorOf(bearing(plan.center.lat,plan.center.lon,Number(x.latitude),Number(x.longitude))),z=sectors.find(v=>v.sector===s)!;z.count++;for(const k of Array.isArray(x.category_keys)?x.category_keys:[])z.category_counts[k]=(z.category_counts[k]??0)+1}
  const cells:any[]=[];for(const r of rings)for(const s of SECTORS){const count=xs.filter(x=>{const d=Number(x.distance_m??haversineM(plan.center!.lat,plan.center!.lon,Number(x.latitude),Number(x.longitude)));return d>=r.from_m&&d<r.to_m&&sectorOf(bearing(plan.center!.lat,plan.center!.lon,Number(x.latitude),Number(x.longitude)))===s}).length;cells.push({ring:r.label,sector:s,count})}
  const empty=cells.filter(x=>x.count===0);base.rings=rings;base.sectors=sectors;base.coverage_gaps={cell_count:cells.length,empty_cells:empty.length,empty_fraction:cells.length?round(empty.length/cells.length,3):0,gaps:empty.slice(0,24)};
 }
 if(plan.mode==="route"){const len=Number(plan.route_length_m??0),step=5000,n=Math.max(1,Math.ceil(len/step)),segments:any[]=[];for(let i=0;i<n;i++){const a=i*step,b=Math.min(len,(i+1)*step),members=xs.filter(x=>Number(x.route_along_m??-1)>=a&&Number(x.route_along_m??-1)<=(i===n-1?b:b-1e-9)),ar=(Math.max(0,b-a)*2*Number(plan.corridor_m??0))/1e6;segments.push({index:i+1,from_m:Math.round(a),to_m:Math.round(b),count:members.length,area_km2:round(ar,3),density_per_km2:ar>0?round(members.length/ar,3):null,category_counts:categoryCounts(members)})}const gaps=segments.filter(x=>x.count===0),maxGap=gaps.length?Math.max(...gaps.map(x=>x.to_m-x.from_m)):0;base.route={segment_size_m:step,segments,gap_segments:gaps.map(x=>x.index),gap_count:gaps.length,max_gap_m:maxGap}}
 if(plan.mode==="polygon")base.polygon={area_km2:round(area,3),vertex_count:Number(plan.input_vertices?.length??0)};
 return base;
}
