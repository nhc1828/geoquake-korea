/* GEOQUAKE KOREA 4.2 — educational simulator core.  Never a real seismic alert.
   Uses the v0.8 constant-velocity P/S model (6 / 3.5 km/s) and v0.8 proxy intensities.
   Real earthquake observations are handled by a separate live-data pipeline. */
(function(root){
'use strict';
const I=root.GQIntensityModel || (typeof require==='function'?require('./intensity-model.js'):null);
const P_SPEED=6, S_SPEED=3.5;
function finite(v){return typeof v==='number'&&Number.isFinite(v)}
function validOrigin(o){return !!o && finite(o.lat)&&o.lat>=-80&&o.lat<=80 && finite(o.lon)&&Math.abs(o.lon)<=180 && finite(o.magnitude)&&o.magnitude>=0&&o.magnitude<=9.5 && finite(o.depthKm)&&o.depthKm>=0&&o.depthKm<=700}
function travel(origin,point){
 if(!validOrigin(origin)||!point||![point.lat,point.lon].every(finite)||Math.abs(point.lat)>80||Math.abs(point.lon)>180)throw Error('지진·관측점 좌표가 잘못되었습니다.');
 const d=I.distanceKm(origin,point),r=Math.hypot(d,origin.depthKm);
 return {distanceKm:d,pathKm:r,p:r/P_SPEED,s:r/S_SPEED,sp:r/S_SPEED-r/P_SPEED};
}
function waveRadius(seconds,speed,depthKm){if(![seconds,speed,depthKm].every(finite)||seconds<0||speed<=0||depthKm<0)return null;const q=speed*seconds;return q<depthKm?null:Math.sqrt(q*q-depthKm*depthKm)}
function build(origin,stations,watch=[]){
 if(!validOrigin(origin))throw Error('진앙 위치·규모·깊이를 확인하세요.');
 if(!Array.isArray(stations)||stations.length<1)throw Error('한국 또는 일본 관측망을 하나 이상 선택하세요.');
 if(!Array.isArray(watch)||watch.length>5)throw Error('추가 관측점은 최대 5개입니다.');
 const all=[...stations.map(x=>({...x,sensor:true})),...watch.map(x=>({...x,sensor:false}))];
 if(new Set(all.map(x=>x.id)).size!==all.length)throw Error('관측점 ID가 중복되었습니다.');
 const arrivals=all.map(point=>({...point,arrival:travel(origin,point)}));
 const detections=arrivals.filter(x=>x.sensor);
 const earliest=detections.slice().sort((a,b)=>a.arrival.p-b.arrival.p||a.id.localeCompare(b.id))[0];
 const events=[];for(const x of arrivals){events.push({kind:'P',time:x.arrival.p,id:x.id,station:x});events.push({kind:'S',time:x.arrival.s,id:x.id,station:x})}
 events.push({kind:'BULLETIN',time:earliest.arrival.p,id:earliest.id,station:earliest});
 const priority={P:0,BULLETIN:1,S:2};events.sort((a,b)=>a.time-b.time||priority[a.kind]-priority[b.kind]||a.id.localeCompare(b.id));
 const duration=Math.ceil(Math.max(60,...events.map(e=>e.time+5)));
 return {origin:{...origin},arrivals,firstP:earliest.arrival.p,firstStation:earliest,events,duration};
}
function at(run,seconds){const time=Math.max(0,Math.min(run.duration,finite(seconds)?seconds:0));return {time,bulletin:time>=run.firstP,pCount:run.arrivals.filter(x=>x.sensor&&x.arrival.p<=time).length,sCount:run.arrivals.filter(x=>x.sensor&&x.arrival.s<=time).length,events:run.events.filter(e=>e.time<=time)};}
function nextTime(run,time){return run.events.find(e=>e.time>time+1e-6)?.time??run.duration}
function predicted(origin,point){return I.estimate({latitude:origin.lat,longitude:origin.lon,magnitude:origin.magnitude,depthKm:origin.depthKm},point.lat,point.lon,(point.country==='JP'||point.id?.startsWith('JP-'))?'JMA':'MMI')}
function ringFeatures(origin,time){const out=[];for(const [phase,speed,color] of [['P',P_SPEED,'#79d6ff'],['S',S_SPEED,'#ffc680']]){
 const km=waveRadius(time,speed,origin.depthKm);if(km===null||km<.01||km>18000)continue;
 const ring=[];for(let i=0;i<=144;i++){ring.push(I.destination(origin.lat,origin.lon,km,i*360/144))}
 out.push({type:'Feature',geometry:{type:'LineString',coordinates:ring},properties:{phase,color,radiusKm:km}});
 }return out;
}
const api={P_SPEED,S_SPEED,validOrigin,travel,waveRadius,build,at,nextTime,predicted,ringFeatures};
root.GQSimCore=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
