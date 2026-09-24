import {applyObjectFilters,enrichSettlements,toGeoJson} from "./regional_enrichment.ts";

function assert(x:unknown,msg:string){if(!x)throw new Error(msg)}

Deno.test("settlement enrichment preserves tagged settlement and fills missing nearest",()=>{
 const objects=[
  {canonical_name:"A",latitude:49.59,longitude:34.55,settlement:"Полтава",address:"вул. X 1",sources:[{source:"OpenStreetMap"}],resolution_confidence:100},
  {canonical_name:"B",latitude:49.6005,longitude:34.552,settlement:null,address:null,sources:[{source:"OpenStreetMap"}],resolution_confidence:92}
 ];
 const settlements=[{name:"Полтава",latitude:49.5883,longitude:34.5514,place:"city",source_id:"N:1"}];
 const r=enrichSettlements(objects,settlements);
 assert(r.objects[0].settlement_method==="osm_addr","direct settlement method");
 assert(r.objects[1].settlement==="Полтава","nearest settlement not assigned");
 assert(r.objects[1].settlement_method==="osm_nearest","nearest settlement method");
 assert(Number(r.objects[1].settlement_distance_m)<5000,"unexpected nearest distance");
 assert(r.summary.settlement_inferred===1,"inferred counter");
});

Deno.test("settlement enrichment does not invent far settlements",()=>{
 const r=enrichSettlements([{latitude:49,longitude:34,settlement:null,address:null}],[
  {name:"Far",latitude:50,longitude:35,place:"city"}
 ],10000);
 assert(r.objects[0].settlement==null,"far settlement must not be assigned");
 assert(r.objects[0].address_quality==="coordinates_only","address quality mismatch");
});

Deno.test("post filters include inferred settlement source confidence and address state",()=>{
 const xs=[
  {canonical_name:"WOG",brand:"WOG",operator:"X",settlement:"Полтава",address:"A 1",normalized_location:"Полтава, A 1",sources:[{source:"OpenStreetMap"}],resolution_confidence:95},
  {canonical_name:"Other",brand:"Other",operator:"Y",settlement:"Кременчук",address:null,normalized_location:"Кременчук",sources:[{source:"Wikidata"}],resolution_confidence:80}
 ];
 assert(applyObjectFilters(xs,{settlement:"полтава",source:"OSM",min_confidence:"90",has_address:"yes"}).length===1,"combined post filter failed");
 assert(applyObjectFilters(xs,{source:"wikidata",has_address:"no"}).length===1,"source/address filter failed");
 assert(applyObjectFilters(xs,{min_confidence:"90"}).length===1,"confidence filter failed");
});

Deno.test("GeoJSON export is valid FeatureCollection",()=>{
 const g=toGeoJson([{canonical_name:"A",latitude:49.5,longitude:34.5,category_keys:["fuel"],sources:[{source:"OpenStreetMap",source_id:"N:1"}],source_count:1,resolution_confidence:100}],{oblast_code:"UA53"});
 assert(g.type==="FeatureCollection","type");
 assert(g.features.length===1,"feature count");
 assert(g.features[0].geometry.coordinates[0]===34.5,"longitude order");
 assert(g.metadata.oblast_code==="UA53","metadata");
});
