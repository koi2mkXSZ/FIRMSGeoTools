export type UrbanExposureClass="dense_urban"|"urban"|"suburban"|"industrial"|"forest"|"agricultural"|"mixed"|"rural"|"unknown";
export type UrbanContext={
  total:number;buildings:number;residential_buildings?:number;commercial_buildings?:number;industrial_buildings?:number;
  nonresidential_buildings?:number;residential_landuse:number;industrial_landuse:number;commercial_landuse:number;retail_landuse:number;
  forest_landuse?:number;agricultural_landuse?:number;amenities:number;shops:number;offices:number;schools?:number;hospitals?:number;
  fuel_stations?:number;energy?:number;transport:number;industrial_objects:number;area_km2?:number|null;radius_m?:number|null;truncated?:boolean;
};
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(v:number,a=0,b=1){return Math.max(a,Math.min(b,v))}
function round(v:number,d=3){const p=10**d;return Math.round(v*p)/p}
function scoreAbove(v:number|null,lo:number,hi:number){if(v==null)return 0;return clamp((v-lo)/(hi-lo))}
function scoreBelow(v:number|null,lo:number,hi:number){if(v==null)return 0;return 1-scoreAbove(v,lo,hi)}
export function buildUrbanExposure(ghsl:any,ctx:UrbanContext,meta:any={}){
  const pop1=n(ghsl?.population_1km),pop5=n(ghsl?.population_5km),built1=n(ghsl?.built_fraction_1km_pct),built5=n(ghsl?.built_fraction_5km_pct);
  const urbanLand=Math.max(1,Number(ctx.residential_landuse||0)+Number(ctx.industrial_landuse||0)+Number(ctx.commercial_landuse||0)+Number(ctx.retail_landuse||0));
  const allLand=Math.max(1,urbanLand+Number(ctx.forest_landuse||0)+Number(ctx.agricultural_landuse||0));
  const industrialShare=Number(ctx.industrial_landuse||0)/urbanLand;
  const residentialShare=Number(ctx.residential_landuse||0)/urbanLand;
  const forestShare=Number(ctx.forest_landuse||0)/allLand;
  const agriculturalShare=Number(ctx.agricultural_landuse||0)/allLand;
  const area=n(ctx.area_km2),buildingDensity=area&&area>0?Number(ctx.buildings||0)/area:null;
  const activity=Number(ctx.amenities||0)+Number(ctx.shops||0)+Number(ctx.offices||0)+Number(ctx.transport||0);
  const dense=Math.max(scoreAbove(built1,22,45),scoreAbove(pop1,5000,16000),scoreAbove(buildingDensity,80,300));
  const urban=Math.max(scoreAbove(built1,9,25),scoreAbove(pop1,1800,7000),scoreAbove(buildingDensity,25,120),scoreAbove(activity,15,100));
  const suburban=Math.max(scoreAbove(built1,3,12),scoreAbove(pop1,350,2500),scoreAbove(buildingDensity,5,45));
  const industrial=Math.max(scoreAbove(Number(ctx.industrial_landuse||0),1,8),scoreAbove(Number(ctx.industrial_objects||0)+Number(ctx.industrial_buildings||0),1,16),scoreAbove(industrialShare,.18,.65));
  const forest=Math.max(scoreAbove(Number(ctx.forest_landuse||0),1,5),scoreAbove(forestShare,.25,.7))*(.55+.45*scoreBelow(built1,4,18));
  const agricultural=Math.max(scoreAbove(Number(ctx.agricultural_landuse||0),1,5),scoreAbove(agriculturalShare,.25,.7))*(.55+.45*scoreBelow(built1,4,18));
  const rural=Math.min(scoreBelow(built1,2,8),scoreBelow(pop1,200,1200),scoreBelow(buildingDensity,2,20));
  const mixedUrbanIndustrial=Math.min(1,(urban+industrial)/1.35);
  const mixedNatural=Math.min(1,(forest+agricultural)/1.25);
  const mixed=Math.max(
    industrial>=.45&&urban>=.35?mixedUrbanIndustrial:0,
    forest>=.42&&agricultural>=.42?mixedNatural:0,
    (forest>=.38||agricultural>=.38)&&suburban>=.35?Math.min(1,(Math.max(forest,agricultural)+suburban)/1.3):0
  );
  let klass:UrbanExposureClass="rural";
  if(!ghsl&&Number(ctx.total||0)===0&&Number(ctx.buildings||0)===0)klass="unknown";
  else if(mixed>=.62)klass="mixed";
  else if(industrial>=.68&&residentialShare<.35)klass="industrial";
  else if(forest>=.64&&forest>=agricultural+.08)klass="forest";
  else if(agricultural>=.64&&agricultural>=forest+.08)klass="agricultural";
  else if(dense>=.62)klass="dense_urban";
  else if(urban>=.48)klass="urban";
  else if(suburban>=.38)klass="suburban";
  const ranking={dense_urban:dense,urban,suburban,industrial,forest,agricultural,mixed,rural,unknown:0};
  const vals=Object.entries(ranking).filter(([k])=>k!=="unknown").map(([k,v])=>[k,Number(v)] as const).sort((a,b)=>b[1]-a[1]);
  const margin=vals.length>1?Math.max(0,vals[0][1]-vals[1][1]):0;
  const ghslOk=[pop1,built1,pop5,built5].some(x=>x!=null),osmOk=Number(ctx.total||0)>0||Number(ctx.buildings||0)>0;
  const completeness=(ghslOk?0.6:0)+(osmOk?0.4:0);
  const confidence=klass==="unknown"?0:clamp(.48+.27*completeness+.25*clamp(margin/.5)-((ctx.truncated===true)?.08:0),.35,.96);
  const reasons:string[]=[];
  if(built1!=null)reasons.push("GHSL built-up 1 km "+round(built1,1)+"%");
  if(pop1!=null)reasons.push("GHSL population 1 km ~"+Math.round(pop1));
  if(buildingDensity!=null)reasons.push("OSM building density "+round(buildingDensity,1)+"/km²");
  if(Number(ctx.industrial_landuse||0)>0||Number(ctx.industrial_objects||0)>0||Number(ctx.industrial_buildings||0)>0)reasons.push("industrial indicators "+(Number(ctx.industrial_landuse||0)+Number(ctx.industrial_objects||0)+Number(ctx.industrial_buildings||0)));
  if(Number(ctx.forest_landuse||0)>0)reasons.push("forest/wood polygons "+Number(ctx.forest_landuse||0));
  if(Number(ctx.agricultural_landuse||0)>0)reasons.push("agricultural polygons "+Number(ctx.agricultural_landuse||0));
  if(activity>0)reasons.push("urban activity POI "+activity);
  return{
    profile_version:"urban-exposure-v1",
    class:klass,
    confidence:round(confidence,3),
    scores:Object.fromEntries(Object.entries(ranking).map(([k,v])=>[k,round(Number(v),3)])),
    ghsl:{population_1km:pop1,population_5km:pop5,population_10km:n(ghsl?.population_10km),built_fraction_1km_pct:built1,built_fraction_5km_pct:built5,built_fraction_10km_pct:n(ghsl?.built_fraction_10km_pct),epoch:ghsl?.epoch??2025,resolution:ghsl?.resolution??"30 arcsec (~1 km)"},
    osm_context:{...ctx,building_density_per_km2:buildingDensity==null?null:round(buildingDensity,3),industrial_share:round(industrialShare,3),residential_share:round(residentialShare,3),forest_share:round(forestShare,3),agricultural_share:round(agriculturalShare,3),activity_poi:activity},
    source_status:{ghsl:ghslOk?"active":"unavailable",osm_context:osmOk?(ctx.truncated?"partial":"active"):"empty",completeness:round(completeness,2)},
    representative_center:meta?.center??null,
    center_method:meta?.center_method??null,
    reasons:reasons.slice(0,7),
    interpretation:"Exposure class describes mapped population/built-up and public OSM land-use, building and POI context around the representative center; it is not a building-level occupancy or damage estimate."
  };
}
