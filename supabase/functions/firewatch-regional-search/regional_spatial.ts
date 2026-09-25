export type LngLat=[number,number];
export type SpatialMode="radius"|"nearest"|"polygon"|"route";
export type SpatialPlan={
 mode:SpatialMode;
 bbox:[number,number,number,number];
 query_bboxes:Array<[number,number,number,number]>;
 center?:{lat:number;lon:number};
 radius_m?:number;
 search_radius_m?:number;
 nearest_n?:number;
 geometry?:any;
 route?:LngLat[];
 corridor_m?:number;
 route_length_m?:number;
 input_vertices:LngLat[];
};

const EARTH=6371000;
const DEG=Math.PI/180;
function finite(v:unknown){const n=Number(v);return Number.isFinite(n)?n:NaN}
function coord(v:any):LngLat|null{
 if(!Array.isArray(v)||v.length<2)return null;
 const lon=finite(v[0]),lat=finite(v[1]);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
 return[lon,lat];
}
export function haversineM(aLat:number,aLon:number,bLat:number,bLon:number){
 const da=(bLat-aLat)*DEG,db=(bLon-aLon)*DEG,x=Math.sin(da/2)**2+Math.cos(aLat*DEG)*Math.cos(bLat*DEG)*Math.sin(db/2)**2;
 return 2*EARTH*Math.asin(Math.min(1,Math.sqrt(x)));
}
function bboxOf(cs:LngLat[]):[number,number,number,number]{
 if(!cs.length)throw new Error("spatial geometry has no coordinates");
 let minLon=Infinity,minLat=Infinity,maxLon=-Infinity,maxLat=-Infinity;
 for(const [lon,lat] of cs){minLon=Math.min(minLon,lon);minLat=Math.min(minLat,lat);maxLon=Math.max(maxLon,lon);maxLat=Math.max(maxLat,lat)}
 return[minLon,minLat,maxLon,maxLat];
}
function expandBbox(b:[number,number,number,number],m:number):[number,number,number,number]{
 const mid=(b[1]+b[3])/2,dy=m/111320,dx=m/(111320*Math.max(.2,Math.cos(mid*DEG)));
 return[b[0]-dx,b[1]-dy,b[2]+dx,b[3]+dy];
}
function circleBbox(lat:number,lon:number,r:number){return expandBbox([lon,lat,lon,lat],r)}
function pointInRing(lon:number,lat:number,ring:any[]){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=coord(ring[i]),b=coord(ring[j]);if(!a||!b)continue;
  const [xi,yi]=a,[xj,yj]=b,hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-15)+xi);
  if(hit)inside=!inside;
 }
 return inside;
}
export function pointInGeometry(lon:number,lat:number,g:any){
 if(g?.type==="Polygon"){const rs=g.coordinates;if(!Array.isArray(rs)||!rs.length||!pointInRing(lon,lat,rs[0]))return false;for(let i=1;i<rs.length;i++)if(pointInRing(lon,lat,rs[i]))return false;return true}
 if(g?.type==="MultiPolygon")return (g.coordinates??[]).some((p:any)=>pointInGeometry(lon,lat,{type:"Polygon",coordinates:p}));
 return false;
}
function flattenPolygon(g:any){
 const out:LngLat[]=[];
 const polygons=g?.type==="Polygon"?[g.coordinates]:g?.type==="MultiPolygon"?g.coordinates:null;
 if(!Array.isArray(polygons))throw new Error("polygon geometry must be Polygon or MultiPolygon");
 for(const p of polygons)for(const r of Array.isArray(p)?p:[])for(const x of Array.isArray(r)?r:[]){const c=coord(x);if(c)out.push(c)}
 return out;
}
function bboxAreaKm2(b:[number,number,number,number]){
 const mid=(b[1]+b[3])/2,w=Math.abs(b[2]-b[0])*111.32*Math.max(.2,Math.cos(mid*DEG)),h=Math.abs(b[3]-b[1])*111.32;return w*h;
}
function project(lon:number,lat:number,lat0:number){return{x:lon*111320*Math.cos(lat0*DEG),y:lat*111320}}
function segmentDistanceM(lon:number,lat:number,a:LngLat,b:LngLat){
 const lat0=(lat+a[1]+b[1])/3,p=project(lon,lat,lat0),q=project(a[0],a[1],lat0),r=project(b[0],b[1],lat0),vx=r.x-q.x,vy=r.y-q.y,wx=p.x-q.x,wy=p.y-q.y,d=vx*vx+vy*vy;
 const t=d?Math.max(0,Math.min(1,(wx*vx+wy*vy)/d)):0,x=q.x+t*vx,y=q.y+t*vy;
 return{distance_m:Math.hypot(p.x-x,p.y-y),t};
}
export function routeDistanceM(lon:number,lat:number,route:LngLat[]){
 let best=Infinity,segment=0,t=0,along=0,bestAlong=0;
 for(let i=1;i<route.length;i++){
  const segLen=haversineM(route[i-1][1],route[i-1][0],route[i][1],route[i][0]),d=segmentDistanceM(lon,lat,route[i-1],route[i]);
  if(d.distance_m<best){best=d.distance_m;segment=i-1;t=d.t;bestAlong=along+segLen*d.t}
  along+=segLen;
 }
 return{distance_m:best,segment,t,along_m:bestAlong};
}
export function routeLengthM(route:LngLat[]){let n=0;for(let i=1;i<route.length;i++)n+=haversineM(route[i-1][1],route[i-1][0],route[i][1],route[i][0]);return n}
function routeWindows(route:LngLat[],corridor:number,maxChunkM=90000){
 const out:Array<[number,number,number,number]>=[];let chunk:LngLat[]=[route[0]],len=0;
 for(let i=1;i<route.length;i++){
  const d=haversineM(route[i-1][1],route[i-1][0],route[i][1],route[i][0]);
  if(len+d>maxChunkM&&chunk.length>1){out.push(expandBbox(bboxOf(chunk),corridor));chunk=[route[i-1]];len=0}
  chunk.push(route[i]);len+=d;
 }
 if(chunk.length>1)out.push(expandBbox(bboxOf(chunk),corridor));
 return out;
}
function lineCoords(v:any){
 const g=v?.type==="Feature"?v.geometry:v;
 const arr=g?.type==="LineString"?g.coordinates:Array.isArray(v)?v:null;
 if(!Array.isArray(arr))throw new Error("route must be GeoJSON LineString or coordinate array");
 const out=arr.map(coord).filter(Boolean) as LngLat[];
 if(out.length<2)throw new Error("route requires at least 2 points");
 if(out.length>200)throw new Error("route supports at most 200 points");
 return out;
}
function polygonGeometry(v:any){
 const g=v?.type==="Feature"?v.geometry:v;
 if(!g||!["Polygon","MultiPolygon"].includes(String(g.type)))throw new Error("polygon must be GeoJSON Polygon or MultiPolygon");
 const cs=flattenPolygon(g);
 if(cs.length<4)throw new Error("polygon requires at least 4 coordinates");
 if(cs.length>500)throw new Error("polygon supports at most 500 coordinates");
 const b=bboxOf(cs),area=bboxAreaKm2(b);if(area>75000)throw new Error("polygon bounding area exceeds 75000 km2");
 return{g,cs,b,area};
}
export function buildSpatialPlan(input:any):SpatialPlan{
 const s=input?.spatial&&typeof input.spatial==="object"?input.spatial:input??{},mode=String(s.mode??s.type??"").toLowerCase() as SpatialMode;
 if(mode==="radius"||mode==="nearest"){
  const lat=finite(s.lat??s.latitude),lon=finite(s.lon??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)throw new Error("valid lat/lon required");
  if(mode==="radius"){
   const r=finite(s.radius_m??(finite(s.radius_km)*1000));if(!Number.isFinite(r)||r<100||r>50000)throw new Error("radius_m must be 100..50000");
   const b=circleBbox(lat,lon,r);return{mode,bbox:b,query_bboxes:[b],center:{lat,lon},radius_m:r,input_vertices:[[lon,lat]]};
  }
  const n=Math.round(finite(s.nearest_n??s.limit??10));if(!Number.isFinite(n)||n<1||n>100)throw new Error("nearest_n must be 1..100");
  const r=finite(s.search_radius_m??(finite(s.search_radius_km)*1000)||50000);if(!Number.isFinite(r)||r<500||r>100000)throw new Error("search_radius_m must be 500..100000");
  const b=circleBbox(lat,lon,r);return{mode,bbox:b,query_bboxes:[b],center:{lat,lon},search_radius_m:r,nearest_n:n,input_vertices:[[lon,lat]]};
 }
 if(mode==="polygon"){
  const p=polygonGeometry(s.geometry??s.polygon);return{mode,bbox:p.b,query_bboxes:[p.b],geometry:p.g,input_vertices:p.cs};
 }
 if(mode==="route"){
  const route=lineCoords(s.geometry??s.route),corridor=finite(s.corridor_m??(finite(s.corridor_km)*1000)||2000);
  if(!Number.isFinite(corridor)||corridor<100||corridor>20000)throw new Error("corridor_m must be 100..20000");
  const len=routeLengthM(route);if(len>1000000)throw new Error("route length exceeds 1000 km");
  const b=expandBbox(bboxOf(route),corridor),boxes=routeWindows(route,corridor);if(boxes.length>16)throw new Error("route requires too many query windows");
  return{mode,bbox:b,query_bboxes:boxes,route,corridor_m:corridor,route_length_m:len,input_vertices:route};
 }
 throw new Error("spatial mode must be radius, nearest, polygon or route");
}
export function applySpatialPlan(objects:any[],plan:SpatialPlan){
 const out:any[]=[];
 for(const raw of objects??[]){
  const x={...raw},lat=Number(x.latitude),lon=Number(x.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
  if(plan.mode==="radius"||plan.mode==="nearest"){
   const d=haversineM(plan.center!.lat,plan.center!.lon,lat,lon),limit=plan.mode==="radius"?plan.radius_m!:plan.search_radius_m!;if(d>limit)continue;x.distance_m=Math.round(d);
  }else if(plan.mode==="polygon"){if(!pointInGeometry(lon,lat,plan.geometry))continue}
  else if(plan.mode==="route"){const d=routeDistanceM(lon,lat,plan.route!);if(d.distance_m>plan.corridor_m!)continue;x.route_distance_m=Math.round(d.distance_m);x.route_along_m=Math.round(d.along_m);x.route_segment=d.segment}
  out.push(x);
 }
 if(plan.mode==="nearest"||plan.mode==="radius")out.sort((a,b)=>Number(a.distance_m??Infinity)-Number(b.distance_m??Infinity));
 if(plan.mode==="route")out.sort((a,b)=>Number(a.route_along_m??Infinity)-Number(b.route_along_m??Infinity)||Number(a.route_distance_m??Infinity)-Number(b.route_distance_m??Infinity));
 return plan.mode==="nearest"?out.slice(0,plan.nearest_n):out;
}
export function spatialSummary(plan:SpatialPlan){
 return{
  mode:plan.mode,bbox:plan.bbox,query_windows:plan.query_bboxes.length,
  center:plan.center??null,radius_m:plan.radius_m??null,search_radius_m:plan.search_radius_m??null,nearest_n:plan.nearest_n??null,
  corridor_m:plan.corridor_m??null,route_length_m:plan.route_length_m==null?null:Math.round(plan.route_length_m),
  input_vertices:plan.input_vertices.length
 };
}
