import {assertEquals,assert} from "jsr:@std/assert@1";
import {buildUrbanExposure} from "./urban_exposure.ts";
Deno.test("dense urban profile",()=>{
 const x=buildUrbanExposure({population_1km:18000,built_fraction_1km_pct:48,population_5km:180000,built_fraction_5km_pct:34},{total:900,buildings:700,residential_landuse:35,industrial_landuse:2,commercial_landuse:8,retail_landuse:4,amenities:90,shops:60,offices:20,transport:15,industrial_objects:2,area_km2:3.14});
 assertEquals(x.class,"dense_urban");assert(x.confidence>=.7);
});
Deno.test("industrial profile",()=>{
 const x=buildUrbanExposure({population_1km:180,built_fraction_1km_pct:7,population_5km:2400,built_fraction_5km_pct:5},{total:150,buildings:90,residential_landuse:1,industrial_landuse:14,commercial_landuse:1,retail_landuse:0,amenities:2,shops:0,offices:1,transport:4,industrial_objects:18,area_km2:12.5});
 assertEquals(x.class,"industrial");assert(x.osm_context.industrial_share>.7);
});
Deno.test("mixed urban industrial profile",()=>{
 const x=buildUrbanExposure({population_1km:5000,built_fraction_1km_pct:21,population_5km:42000,built_fraction_5km_pct:18},{total:400,buildings:260,residential_landuse:12,industrial_landuse:10,commercial_landuse:3,retail_landuse:2,amenities:35,shops:18,offices:8,transport:9,industrial_objects:15,area_km2:20});
 assertEquals(x.class,"mixed_urban_industrial");
});
Deno.test("rural profile",()=>{
 const x=buildUrbanExposure({population_1km:70,built_fraction_1km_pct:1.1,population_5km:900,built_fraction_5km_pct:1.6},{total:8,buildings:5,residential_landuse:0,industrial_landuse:0,commercial_landuse:0,retail_landuse:0,amenities:1,shops:0,offices:0,transport:0,industrial_objects:0,area_km2:78});
 assertEquals(x.class,"rural");
});
Deno.test("unknown when no evidence",()=>{
 const x=buildUrbanExposure(null,{total:0,buildings:0,residential_landuse:0,industrial_landuse:0,commercial_landuse:0,retail_landuse:0,amenities:0,shops:0,offices:0,transport:0,industrial_objects:0,area_km2:null});
 assertEquals(x.class,"unknown");
});
