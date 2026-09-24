import {applyObjectFilters,applySettlementTarget,enrichSettlements,resolveSettlementTarget,toGeoJson} from "./regional_enrichment.ts";

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


Deno.test("settlement target uses explicit radius fallback",()=>{
 const settlements=[
  {name:"Полтава",latitude:49.5897,longitude:34.5508,place:"city",population:297600,source_id:"N:1"},
  {name:"Полтава",latitude:49.80,longitude:34.20,place:"village",population:200,source_id:"N:2"}
 ];
 const target=resolveSettlementTarget(settlements,"Полтава");
 assert(target?.source_id==="N:1","city candidate should win exact-name tie");
 assert(target?.mode==="radius_fallback","mode");
 assert(target?.radius_m===15000,"city fallback radius");
 const xs=[
  {canonical_name:"near",latitude:49.60,longitude:34.56},
  {canonical_name:"far",latitude:49.90,longitude:34.90}
 ];
 const filtered=applySettlementTarget(xs,target);
 assert(filtered.length===1&&filtered[0].canonical_name==="near","radius settlement filter failed");
});

Deno.test("unknown settlement target does not silently resolve",()=>{
 const target=resolveSettlementTarget([{name:"Полтава",latitude:49.59,longitude:34.55,place:"city"}],"Кременчук");
 assert(target===null,"unrelated settlement must not resolve");
});
