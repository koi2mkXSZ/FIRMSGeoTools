import {applySpatialPlan,buildSpatialPlan,haversineM,pointInGeometry,routeDistanceM,routeLengthM} from "./regional_spatial.ts";
function assert(x:unknown,msg:string){if(!x)throw new Error(msg)}

Deno.test("radius plan filters and sorts",()=>{
 const p=buildSpatialPlan({mode:"radius",lat:49.5883,lon:34.5514,radius_m:5000});
 const xs=applySpatialPlan([{latitude:49.59,longitude:34.55},{latitude:50,longitude:35}],p);
 assert(xs.length===1,"radius count");assert(Number(xs[0].distance_m)<500,"distance");
});

Deno.test("nearest plan applies search radius and N",()=>{
 const p=buildSpatialPlan({mode:"nearest",lat:49.5883,lon:34.5514,nearest_n:2,search_radius_m:30000});
 const xs=applySpatialPlan([{id:1,latitude:49.59,longitude:34.55},{id:2,latitude:49.60,longitude:34.56},{id:3,latitude:49.70,longitude:34.70}],p);
 assert(xs.length===2,"nearest N");assert(xs[0].distance_m<=xs[1].distance_m,"nearest sort");
});

Deno.test("polygon holes are respected",()=>{
 const g={type:"Polygon",coordinates:[[[34,49],[35,49],[35,50],[34,50],[34,49]],[[34.4,49.4],[34.6,49.4],[34.6,49.6],[34.4,49.6],[34.4,49.4]]]};
 assert(pointInGeometry(34.2,49.2,g),"outer polygon");assert(!pointInGeometry(34.5,49.5,g),"hole");
 const p=buildSpatialPlan({mode:"polygon",geometry:g}),xs=applySpatialPlan([{latitude:49.2,longitude:34.2},{latitude:49.5,longitude:34.5}],p);
 assert(xs.length===1,"polygon filter");
});

Deno.test("route corridor annotates along and distance",()=>{
 const route:[[number,number],[number,number]]=[[34.5,49.5],[35.0,49.5]],p=buildSpatialPlan({mode:"route",route,corridor_m:3000});
 assert(routeLengthM(route)>30000,"route length");
 const d=routeDistanceM(34.7,49.51,route);assert(d.distance_m<2000,"route distance");
 const xs=applySpatialPlan([{latitude:49.51,longitude:34.7},{latitude:49.60,longitude:34.7}],p);assert(xs.length===1,"route corridor count");assert(Number.isFinite(xs[0].route_along_m),"along");
});

Deno.test("route is split into bounded query windows",()=>{
 const p=buildSpatialPlan({mode:"route",route:[[22.5,49],[24,49],[25.5,49],[27,49]],corridor_m:2000});
 assert(p.query_bboxes.length>1,"long route must split");assert(p.query_bboxes.length<=16,"window limit");
});

Deno.test("limits reject oversized requests",()=>{
 let ok=false;try{buildSpatialPlan({mode:"radius",lat:49,lon:34,radius_m:100000})}catch{ok=true}assert(ok,"radius cap");
 ok=false;try{buildSpatialPlan({mode:"nearest",lat:49,lon:34,nearest_n:101})}catch{ok=true}assert(ok,"nearest cap");
});

Deno.test("haversine sanity",()=>{
 const d=haversineM(50.4501,30.5234,50.4501,30.5234);assert(d===0,"same point");
});
