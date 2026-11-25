/* GEOQUAKE KOREA v4.1 — educational proxy intensity and geographic helpers.
 * Published origin/depth/magnitude come from agencies; calculated shaking is NOT
 * an agency observation, validated GMPE, or operational earthquake early warning.
 * The proxy coefficients match GEOQUAKE laboratory v0.8, intentionally unchanged.
 */
(function(root){
'use strict';
const R=6371, RAD=Math.PI/180;
const JMA=['0','1','2','3','4','5약','5강','6약','6강','7'];
const JMA_COLORS=['#34485c','#416b8f','#4ba7c0','#63c69c','#d6c968','#ecb654','#e98652','#e36b65','#b75bd5','#ea87d6'];
const MMI_COLORS=['#354a5e','#42647f','#438bab','#48a4b0','#5dc1ac','#a6c468','#dfc25a','#e9a453','#e9854e','#e56d62','#ca5b8e','#a76ad6','#dd91e7'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function distanceKm(a,b){
  if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(finite))return null;
  const dlat=(b.lat-a.lat)*RAD,dlon=(b.lon-a.lon)*RAD;
  const q=Math.sin(dlat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(clamp(q,0,1)));
}
function estimate(event,lat,lon,country='MMI'){
  if(!event||![event.latitude,event.longitude,event.magnitude,event.depthKm,lat,lon].every(finite))return null;
  if(Math.abs(event.latitude)>90||Math.abs(event.longitude)>180||Math.abs(lat)>90||Math.abs(lon)>180||event.depthKm<0||event.depthKm>700||event.magnitude<0||event.magnitude>10)return null;
  const d=distanceKm({lat:event.latitude,lon:event.longitude},{lat,lon});
  const Rkm=Math.hypot(d,event.depthKm);
  if(country==='JPN'||country==='JMA'){
    const score=1.25*event.magnitude-2.5*Math.log10(Rkm+10)+0.9;
    const limits=[0.5,1.5,2.5,3.5,4.5,5,5.5,6,6.5];
    let index=0;while(index<limits.length&&score>=limits[index])index++;
    return {value:JMA[index],index,scale:'JMA 모형',distanceKm:d,score,eligible:index>=1,color:JMA_COLORS[index],kind:'estimate'};
  }
  const score=1.5*event.magnitude-3*Math.log10(Rkm+10)+1;
  const intensity=clamp(Math.round(score),1,12);
  return {value:String(intensity),index:intensity,scale:'MMI 모형',distanceKm:d,score,eligible:intensity>=2,color:MMI_COLORS[intensity],kind:'estimate'};
}
function recorded(value){
  const label=String(value?.value??value??'');const index=JMA.indexOf(label);
  return index<0?null:{value:label,index,scale:'JMA 관측',color:JMA_COLORS[index],kind:'observed',eligible:true};
}
function kmaReported(value){
  const number=Number(value?.value);if(!Number.isInteger(number)||number<1||number>12)return null;
  return {value:String(number),index:number,scale:'KMA 발표 지역 진도',color:MMI_COLORS[number],kind:'reported',eligible:true};
}
function combine(estimateResult,observedResult,mode='hybrid'){
  if(mode==='off')return null;
  if(mode==='observed')return observedResult||null;
  if(mode==='model')return estimateResult?.eligible?estimateResult:null;
  return observedResult||(estimateResult?.eligible?estimateResult:null);
}
// Destination point on the sphere: useful for clear, approximate intensity-distance contours.
function destination(lat,lon,km,bearing){
  const delta=km/R,phi=lat*RAD,lambda=lon*RAD,b=bearing*RAD;
  const sinPhi=Math.sin(phi)*Math.cos(delta)+Math.cos(phi)*Math.sin(delta)*Math.cos(b);
  const phi2=Math.asin(clamp(sinPhi,-1,1));
  const lambda2=lambda+Math.atan2(Math.sin(b)*Math.sin(delta)*Math.cos(phi),Math.cos(delta)-Math.sin(phi)*Math.sin(phi2));
  return [((lambda2/RAD+540)%360)-180,phi2/RAD];
}
function radiusAtMMI(magnitude,depthKm,level){
  if(![magnitude,depthKm,level].every(finite)||depthKm<0)return 0;
  const Rkm=10**((1.5*magnitude+1-(level-0.5))/3)-10;
  return clamp(Math.sqrt(Math.max(0,Rkm*Rkm-depthKm*depthKm)),0,2500);
}
function contourFeatures(e){
  if(!e||![e.latitude,e.longitude,e.magnitude,e.depthKm].every(finite))return [];
  const items=[];
  // Outermost MMI2 first, then stronger levels: translucent overlaid bands.
  for(let level=2;level<=9;level++){
    const km=radiusAtMMI(e.magnitude,e.depthKm,level);
    if(km<8)continue;
    const ring=[];for(let i=0;i<=96;i++)ring.push(destination(e.latitude,e.longitude,km,i*360/96));
    items.push({type:'Feature',properties:{level,color:MMI_COLORS[level],label:`MMI ${level}+ 거리모형`},geometry:{type:'Polygon',coordinates:[ring]}});
  }
  return items;
}
function polygonRepresentative(geometry){
  if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))return null;
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  let best=null,bestArea=0;
  for(const poly of polys){const ring=poly?.[0];if(!Array.isArray(ring)||ring.length<3)continue;
    let a=0,x=0,y=0;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const p=ring[j],q=ring[i];if(!Array.isArray(p)||!Array.isArray(q))continue;
      const cross=p[0]*q[1]-q[0]*p[1];a+=cross;x+=(p[0]+q[0])*cross;y+=(p[1]+q[1])*cross;
    }
    if(Math.abs(a)>bestArea && Math.abs(a)>1e-9){bestArea=Math.abs(a);best={lon:x/(3*a),lat:y/(3*a)};}
  }
  if(best&&finite(best.lon)&&finite(best.lat))return best;
  const p=polys[0]?.[0]?.[0];return Array.isArray(p)?{lon:p[0],lat:p[1]}:null;
}
const api={JMA,JMA_COLORS,MMI_COLORS,distanceKm,estimate,recorded,kmaReported,combine,destination,radiusAtMMI,contourFeatures,polygonRepresentative};
root.GQIntensityModel=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
