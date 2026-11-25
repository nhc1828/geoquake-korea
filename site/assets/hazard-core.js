/* Educational scenarios only. Nothing here predicts or issues real warnings. */
(function(root){'use strict';
const I=root.GQIntensityModel || (typeof require==='function'?require('./intensity-model.js'):null);
function insideRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]))inside=!inside;}return inside;}
function landAt(lat,lon,fc){return (fc?.features||[]).some(f=>{let g=f.geometry;if(!g)return false;let p=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return p.some(r=>insideRing([lon,lat],r[0])&&!r.slice(1).some(h=>insideRing([lon,lat],h)));});}
function lines(g){if(!g)return [];if(g.type==='LineString')return [g.coordinates];if(g.type==='MultiLineString')return g.coordinates;if(g.type==='GeometryCollection')return g.geometries.flatMap(lines);return [];}
function km(a,b){return I.distanceKm({lat:a[1],lon:a[0]},{lat:b[1],lon:b[0]});}
// P2PQuake supplies announcement history, not a confirmed current-warning state.
function realTsunami(feed,coasts,now=Date.now()){
 if(feed?.state!=='ok'||!Array.isArray(feed.items))return [];
 const latest=feed.items.filter(x=>Number.isFinite(Date.parse(x.issuedAt))).sort((a,b)=>Date.parse(b.issuedAt)-Date.parse(a.issuedAt))[0];
 const age=latest?now-Date.parse(latest.issuedAt):Infinity;
 if(!latest||latest.cancelled!==false||age < -120000||age>86400000)return [];
 const result=[];
 for(const a of latest.areas||[]){const f=coasts?.features?.find(x=>x.properties.name===a.name);if(!f||!['대형 지진해일 경보','지진해일 경보','지진해일 주의보'].includes(a.level))continue;
  result.push({type:'Feature',geometry:f.geometry,properties:{name:'일본 지진해일 발표 · '+(f.properties.nameKo||a.name),color:a.level.includes('대형')?'#d568dc':a.level.includes('주의')?'#ffcf40':'#ff665f',level:a.level,issuedAt:latest.issuedAt}});
 }
 return result;
}
function tsunami(origin,land,coasts){
 if(!origin||![origin.lat,origin.lon,origin.magnitude,origin.depthKm].every(Number.isFinite))return {status:'invalid',features:[]};
 if(origin.lat<25||origin.lat>48||origin.lon<120||origin.lon>150)return {status:'outside',features:[]};
 if(landAt(origin.lat,origin.lon,land))return {status:'land',features:[]};
 if(origin.magnitude<7||origin.depthKm>70)return {status:'below',features:[]};
 const radius=origin.magnitude>=8?500:origin.magnitude>=7.5?300:180;
 const result=[];for(const f of coasts?.features||[]){if(f.properties.code==='0')continue;let selected=[];for(const line of lines(f.geometry)){
  let run=[];for(let i=0;i<line.length;i++){
   const prev=line[Math.max(0,i-1)],p=line[i],steps=i?Math.max(1,Math.ceil(km(prev,p)/15)):1;
   for(let n=i?1:0;n<=steps;n++){const t=i?n/steps:0,point=[prev[0]+(p[0]-prev[0])*t,prev[1]+(p[1]-prev[1])*t];
    if(km([origin.lon,origin.lat],point)<=radius)run.push(point);else{if(run.length>1)selected.push(run);run=[];}
   }
  }if(run.length>1)selected.push(run);
 }if(selected.length)result.push({type:'Feature',properties:{name:f.properties.nameKo||f.properties.name,color:'#ffb72b',detail:'훈련용 직선거리 연안 · '+radius+' km 이내 · 실제 영향 예측 아님'},geometry:{type:'MultiLineString',coordinates:selected}});}
 return {status:result.length?'warning':'no_coast',radius,features:result};
}
function volcano(lat,lon,vei){if(!Number.isFinite(lat)||Math.abs(lat)>80||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isInteger(vei)||vei<0||vei>8)return null;
 const radius=[3,5,10,20,40,70,120,200,300][vei];return {lat,lon,vei,radius,quakeMagnitude:Math.min(6,2.0+vei*.45),features:[{type:'Feature',properties:{name:'모의 화산',color:'#ff783d',detail:'훈련용 VEI '+vei+' · 가상 화산성 지진 M '+Math.min(6,2+vei*.45).toFixed(1)},geometry:{type:'Point',coordinates:[lon,lat]}},{type:'Feature',properties:{name:'훈련용 가상 영향 원',color:'#ff783d',detail:'훈련용 임의 반경 '+radius+' km · 실제 피해 범위 아님'},geometry:{type:'Polygon',coordinates:[Array.from({length:97},(_,i)=>I.destination(lat,lon,radius,i*360/96))]}}]};}
const api={insideRing,landAt,lines,realTsunami,tsunami,volcano};root.GQHazardCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
