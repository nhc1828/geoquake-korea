/* GEOQUAKE KOREA 4.2 — integrated, locally simulated P/S-wave laboratory.
 * Every simulated event, sound, bulletin, and region shading is TRAINING ONLY.
 * No simulation data is ever submitted to the live Railway API or browser notifications.
 */
'use strict';
(() => {
const S=window.GQSimCore,I=window.GQIntensityModel;
if(!S||!I)throw Error('Simulation modules missing');
const $=id=>document.getElementById(id);
const presets={
 kyushu:{name:'큐슈 북부 (가상)',lat:33.65,lon:130.25,magnitude:6.4,depthKm:20},
 korea:{name:'한반도 동남부 (가상)',lat:35.7,lon:129.35,magnitude:5.8,depthKm:12},
 shikoku:{name:'시코쿠 남쪽 해역 (가상)',lat:32.5,lon:134.3,magnitude:7.6,depthKm:25},
 tokyo:{name:'도쿄 동쪽 해역 (가상)',lat:35.5,lon:140.5,magnitude:6.8,depthKm:30}
};
const state={active:false,picking:null,regions:[],custom:[],tab:'feed',run:null,event:null,time:0,playing:false,speed:5,lastTick:0,lastDraw:0,lastFeedSig:'',bulletinFired:false,selected:'KR-26',soundCtx:null,realAlert:null,pausedForHidden:false};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const numField=id=>$(id).value.trim()?Number($(id).value):NaN;
const fmt=x=>Number.isFinite(x)?x.toFixed(1):'—';
const clock=ms=>new Date(ms).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
function source(){const key=$('simPreset').value,p=presets[key];return {name:p?.name||'사용자 지정 진앙 (가상)',lat:numField('simLat'),lon:numField('simLon'),magnitude:Number($('simMag').value),depthKm:numField('simDepth')};}
function setPreset(){const p=presets[$('simPreset').value];if(!p)return;
 $('simLat').value=p.lat.toFixed(4);$('simLon').value=p.lon.toFixed(4);$('simMag').value=p.magnitude;$('simMagValue').textContent=p.magnitude.toFixed(1);$('simDepth').value=p.depthKm;invalidate();}
function getStations(){return state.regions.filter(x=>x.id.startsWith('KR-')?$('simKR').checked:$('simJP').checked);}
function updateSensorCount(){$('simSensorCount').textContent=getStations().length+'곳';}
function initBlankMap(){window.GQRealMap?.setSimulationFrame(null);window.GQRealMap?.setSnapshot({events:[],event:null,mode:'off'});}
function showMode(){state.active=true;document.getElementById('application').classList.add('sim-active');
 $('newAlert').hidden=true;$('eventDetail').hidden=true;if(window.GQMapLive?.state)window.GQMapLive.state.detailsVisible=false;document.getElementById('application').classList.remove('real-alert-open');
 $('liveSidebar').hidden=true;$('simSidebar').hidden=false;$('simBanner').hidden=false;$('navExperiment').classList.add('active');$('navExperiment').setAttribute('aria-pressed','true');
 $('simRealtimeNotice').hidden=true;state.realAlert=null;$('simTransport').hidden=true;$('simBulletin').hidden=true;
 initBlankMap();window.GQRealMap?.focus(numField('simLon'),numField('simLat'),17);
}
function stop(){state.active=false;state.playing=false;state.run=null;state.event=null;state.picking=null;state.realAlert=null;state.bulletinFired=false;
 $('simSidebar').hidden=true;$('liveSidebar').hidden=false;$('simBanner').hidden=true;$('simTransport').hidden=true;$('simBulletin').hidden=true;$('simRealtimeNotice').hidden=true;$('simPickNote').hidden=true;
 $('navExperiment').classList.remove('active');$('navExperiment').setAttribute('aria-pressed','false');document.getElementById('application').classList.remove('sim-active','real-alert-open');
 window.speechSynthesis?.cancel?.();window.GQRealMap?.setSimulationFrame(null);window.GQMapLive?.resync?.();
}
function toggle(){state.active?stop():showMode();}
function invalidate(){if(!state.active)return;state.playing=false;state.run=null;state.event=null;state.bulletinFired=false;state.time=0;state.lastFeedSig='';
 $('simTransport').hidden=true;$('simBulletin').hidden=true;$('simError').textContent='';$('simFeedCount').textContent='0건';$('simFeed').innerHTML='<p>조건을 바꿨습니다. 새 실험을 시작하세요.</p>';
 initBlankMap();}
function picks(mode){if(!state.active)return;state.picking=state.picking===mode?null:mode;
 $('simMapPick').classList.toggle('active',state.picking==='source');$('simPickPoint').classList.toggle('active',state.picking==='point');$('simPickNote').hidden=!state.picking;
 $('simPickNote').textContent=state.picking==='point'?'관심 지점 위치를 지도에서 클릭하세요 · Esc 취소':'진앙 위치를 지도에서 클릭하세요 · Esc 취소';}
function addCustom(){if(state.custom.length>=5){$('simError').textContent='관심 지점은 최대 5곳까지 추가할 수 있습니다.';return;}
 const name=$('simPointName').value.trim(),lat=numField('simPointLat'),lon=numField('simPointLon');
 if(!name||name.length>24||!Number.isFinite(lat)||Math.abs(lat)>80||!Number.isFinite(lon)||Math.abs(lon)>180){$('simError').textContent='관심 지점의 이름·위도·경도를 확인하세요.';return;}
 const index=state.custom.length+1,id='USER-'+Date.now().toString(36)+'-'+index;
 state.custom.push({id,name,short:name,lat,lon,country:$('simPointCountry').value});
 $('simPointName').value='관심 지점 '+(index+1);$('simError').textContent='';renderCustom();invalidate();
}
function renderCustom(){$('simPointList').innerHTML=state.custom.map(x=>`<div class="sim-custom-item"><span>${esc(x.name)} · ${x.lat.toFixed(2)} / ${x.lon.toFixed(2)}</span><button type="button" data-remove-point="${esc(x.id)}" aria-label="${esc(x.name)} 삭제">×</button></div>`).join('');}
function makeSimEvent(origin){return {id:'SIM:'+Date.now().toString(36),source:'SIM',simulation:true,latitude:origin.lat,longitude:origin.lon,magnitude:origin.magnitude,depthKm:origin.depthKm,
 location:origin.name,occurredAt:new Date().toISOString(),reportedAt:null,bulletinType:'모의 지진 발생',observationsVerified:false,observedRegions:{}};}
function armaudio(){if(!$('simSound').checked)return;const AudioCtx=window.AudioContext||window.webkitAudioContext;
 if(!AudioCtx)return;try{if(!state.soundCtx)state.soundCtx=new AudioCtx();state.soundCtx.resume?.().catch(()=>{});}catch{}}
function playTrainingSound(){if(!$('simSound').checked)return;const a=state.soundCtx;if(!a||a.state!=='running')return;
 // Original training-only chime; NOT a copy of any governmental EEW tone.
 const t=a.currentTime+0.05;const seq=[[660,0,.18],[830,.26,.2],[660,.54,.23],[440,.90,.35]];
 for(const [hz,offset,duration] of seq){const osc=a.createOscillator(),gain=a.createGain();osc.type='triangle';osc.frequency.value=hz;
   gain.gain.setValueAtTime(.0001,t+offset);gain.gain.exponentialRampToValueAtTime(.052,t+offset+.03);gain.gain.exponentialRampToValueAtTime(.0001,t+offset+duration);
   osc.connect(gain);gain.connect(a.destination);osc.start(t+offset);osc.stop(t+offset+duration+.05);
 }
}
function speakTraining(){if(!$('simVoice').checked||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;
 try{window.speechSynthesis.cancel();const o=state.run?.origin;const msg=o?`훈련, 훈련. 모의 지진속보입니다. 실제 경보가 아닙니다. 가상 진앙 ${o.name} 부근, 설정 규모 ${o.magnitude.toFixed(1)}, 깊이 ${o.depthKm} 킬로미터. 예상진도는 교육용 계산입니다.`:'훈련, 훈련. 경고음 테스트입니다. 실제 경보가 아닙니다.';const utterance=new SpeechSynthesisUtterance(msg);
 utterance.lang='ko-KR';utterance.rate=1.02;utterance.volume=.8;window.speechSynthesis.speak(utterance);}catch{}}
function setupRun(){const origin=source();$('simError').textContent='';
 if(!S.validOrigin(origin)){$('simError').textContent='유효한 진앙·규모·깊이를 입력하세요.';return false;}
 if(!state.regions.length){$('simError').textContent='가상 관측망 자료를 아직 불러오지 못했습니다.';return false;}
 try{state.run=S.build(origin,getStations(),state.custom);}catch(e){$('simError').textContent=e.message;return false;}
 state.event=makeSimEvent(origin);state.time=0;state.playing=true;state.bulletinFired=false;state.lastTick=performance.now();state.lastDraw=0;state.lastFeedSig='';state.selected=state.run.firstStation.id;
 $('simTransport').hidden=false;$('simBulletin').hidden=true;$('simRealtimeNotice').hidden=true;$('simTimeline').max=state.run.duration;$('simTimeline').value=0;
 $('simSpeed').value=String(state.speed);$('simFeed').innerHTML='<p>첫 가상 P파 감지를 기다리고 있습니다.</p>';state.realAlert=null;
 armaudio();
 window.GQRealMap?.setSnapshot({events:[state.event],event:state.event,mode:$('simFill').checked?'model':'off'});
 window.GQRealMap?.focus(origin.lon,origin.lat,20);render(0,true);return true;
}
function showBulletin(){const r=state.run;if(!r)return;
 $('simBulletin').hidden=false;
 $('simBulletin').classList.remove('compact');$('simBulletinBody').hidden=false;$('simBulletinClose').textContent='−';
 $('simBulletinMag').textContent='M '+r.origin.magnitude.toFixed(1);$('simBulletinPlace').textContent=r.origin.name;
 $('simBulletinCoords').textContent=`위도 ${r.origin.lat.toFixed(3)}° · 경도 ${r.origin.lon.toFixed(3)}° · 깊이 ${r.origin.depthKm.toFixed(0)} km`;
 $('simBulletinIssued').textContent='모의 제1보 · T+'+fmt(r.firstP)+'초';$('simFirstStation').textContent=r.firstStation.name||r.firstStation.short;
 for(const country of ['KR','JP']){const ranked=r.arrivals.filter(x=>x.sensor&&x.id.startsWith(country+'-')).map(x=>({point:x,estimate:S.predicted(r.origin,x)})).filter(x=>x.estimate).sort((a,b)=>b.estimate.index-a.estimate.index);
 const top=ranked[0];$('simMax'+country).textContent=top?top.estimate.value:'—';$('simMax'+country+'Place').textContent=top?(top.point.short||top.point.name):'관측망 제외';
 if(top)$('simMax'+country).style.color=top.estimate.color;}

}
function refreshBulletin(snap){if(!snap.bulletin){$('simBulletin').hidden=true;return;}
 if($('simBulletin').hidden)showBulletin();
 const st=state.run.arrivals.find(x=>x.id===state.selected)||state.run.firstStation;
 const remaining=st.arrival.s-snap.time;$('simSCountdown').textContent=remaining>0?st.name+' · '+fmt(remaining)+'초 후':st.name+' · 모형상 도달';
}
function feed(snap){const data=snap.events.slice(-90).reverse(),signature=data.length+':'+(data[0]?.kind||'')+':'+(data[0]?.id||'')+':'+snap.bulletin;
 if(signature===state.lastFeedSig)return;state.lastFeedSig=signature;$('simFeedCount').textContent=snap.events.length+'건';
 if(!data.length){$('simFeed').innerHTML='<p>가상 관측망의 첫 신호를 기다리고 있습니다.</p>';return;}
 $('simFeed').innerHTML=data.map(ev=>{const type=ev.kind==='BULLETIN'?'모의 속보':ev.kind+'파 감지',desc=ev.kind==='BULLETIN'?'가상 최초 P파 수신 · 훈련용 속보':(ev.station.name||ev.station.short)+' · 가상 '+ev.kind+'파 도달';
 return `<div class="sim-feed-item"><span class="phase ${ev.kind}">${ev.kind==='BULLETIN'?'!':ev.kind}</span><div><strong>${esc(type)}</strong> ${esc(desc)}<small>T+${ev.time.toFixed(2)}s</small></div></div>`}).join('');
}
function selectPoint(id){if(!state.active)return;state.selected=id;renderSelected();renderRegions();const snap=state.run?S.at(state.run,state.time):null;if(snap)refreshBulletin(snap);frameMap();}
function showTab(view){state.tab=view;$('simFeed').hidden=view!=='feed';$('simRegionPanel').hidden=view!=='regions';
  for(const [key,id] of [['feed','simTabFeed'],['regions','simTabRegions']]){$(id).classList.toggle('active',key===view);$(id).setAttribute('aria-pressed',String(key===view));}
  if(view==='regions')renderRegions();
}
function renderRegions(){if(state.tab!=='regions')return;
 if(!state.run){$('simRegionList').innerHTML='<p>실험 시작 후 지역별 예상진도를 확인하세요.</p>';return;}
 const country=$('simCountrySelect').value;
 const rows=state.run.arrivals.filter(x=>x.sensor&&x.id.startsWith(country+'-')).map(x=>({...x,v:S.predicted(state.run.origin,x)}));
 rows.sort((a,b)=>(b.v?.index??-1)-(a.v?.index??-1)||a.id.localeCompare(b.id));
 $('simRegionList').innerHTML=rows.map(x=>{const phase=state.time>=x.arrival.s?'S':state.time>=x.arrival.p?'P':'대기';
 return `<button type="button" class="${state.selected===x.id?'active':''}" data-sim-region="${esc(x.id)}"><i style="background:${esc(x.v?.color||'#42576c')}">${esc(x.v?.value||'—')}</i><span>${esc(x.short||x.name)}</span><small>${phase==='대기'?'P '+fmt(Math.max(0,x.arrival.p-state.time))+'초':phase+' 도달'}</small></button>`}).join('');
}
function renderSelected(){const st=state.run?.arrivals.find(x=>x.id===state.selected);
 if(!st){$('simSelectedInfo').textContent='관측점을 클릭하면 예상진도와 도달시간을 볼 수 있습니다.';return;}
 const v=S.predicted(state.run.origin,st);const a=st.arrival;
 $('simSelectedInfo').innerHTML=`<strong>${esc(st.name||st.short)} · ${st.sensor?'가상 관측점':'관심 지점'}</strong>교육용 ${esc(v?.scale||'모형')} ${esc(v?.value||'—')} · 진앙거리 ${a.distanceKm.toFixed(1)}km<br>P파 T+${a.p.toFixed(2)}초 · S파 T+${a.s.toFixed(2)}초 · S−P ${a.sp.toFixed(2)}초`;
}
function frameMap(){if(!state.active||!state.run)return;
 const r=state.run,snap=S.at(r,state.time),waves=$('simWaves').checked?S.ringFeatures(r.origin,snap.time):[];
 const stations=r.arrivals.map(x=>{const phase=snap.time>=x.arrival.s?'S':snap.time>=x.arrival.p?'P':'대기';
  return {type:'Feature',geometry:{type:'Point',coordinates:[x.lon,x.lat]},properties:{id:x.id,name:x.short||x.name||x.id,phase,selected:x.id===state.selected?1:0,
   color:phase==='S'?'#ffb663':phase==='P'?'#88d3ff':x.sensor?'#92a9c4':'#67d6b8'}}});
 window.GQRealMap?.setSimulationFrame({waves:{type:'FeatureCollection',features:waves},stations:{type:'FeatureCollection',features:$('simSensors').checked?stations:[]}});
}
function render(time,forceMap=false){if(!state.run)return;state.time=Math.max(0,Math.min(state.run.duration,time));const snap=S.at(state.run,state.time);
 $('simClock').textContent='T+'+fmt(state.time)+'s';$('simPhase').textContent=state.time>=state.run.duration?'재현 완료':snap.bulletin?'모의 속보 공개':'첫 P파 감지 전';
 $('simTimeline').value=state.time;$('simPlay').textContent=state.playing?'Ⅱ 일시정지':state.time>=state.run.duration?'↺ 처음부터':'▶ 재생';
 refreshBulletin(snap);feed(snap);renderSelected();if(forceMap||performance.now()-state.lastDraw>350)renderRegions();
 if(forceMap||performance.now()-state.lastDraw>110){frameMap();state.lastDraw=performance.now();}
}
function tick(now){if(state.active&&state.run&&state.playing){const old=state.time,dt=Math.max(0,Math.min(0.25,(now-state.lastTick)/1000));state.time=Math.min(state.run.duration,old+dt*state.speed);
 if(!state.bulletinFired && old<state.run.firstP && state.time>=state.run.firstP){state.bulletinFired=true;showBulletin();playTrainingSound();speakTraining();}
 if(state.time>=state.run.duration)state.playing=false;render(state.time);
 }state.lastTick=now;requestAnimationFrame(tick)}
function fireBulletinByButton(next){if(!state.run||state.bulletinFired||state.time>=state.run.firstP||next<state.run.firstP)return;
 state.bulletinFired=true;armaudio();playTrainingSound();speakTraining();
}
function replay(){if(!state.run)return;state.time=0;state.playing=true;state.bulletinFired=false;window.speechSynthesis?.cancel?.();render(0,true)}
function setPlaying(){if(!state.run)return;if(!state.playing&&state.time>=state.run.duration){replay();return;}state.playing=!state.playing;state.lastTick=performance.now();render(state.time)}
function download(){if(!state.run)return;const r=state.run;const obj={schemaVersion:'4.2',kind:'simulation-not-real-observation',simulated:true,model:'v0.8 homogeneous P=6km/s S=3.5km/s, uncalibrated intensity proxy',
  origin:r.origin,simulatedTimeSeconds:state.time,firstP:r.firstP,firstVirtualStation:r.firstStation.id,stations:r.arrivals.map(x=>({id:x.id,name:x.name,lat:x.lat,lon:x.lon,p:x.arrival.p,s:x.arrival.s,predictedIntensity:S.predicted(r.origin,x)})),events:S.at(r,state.time).events.map(e=>({time:e.time,kind:e.kind,stationId:e.id}))};
 const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='GEOQUAKE_모의실험기록.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function onRealAlert(event){if(!state.active)return;state.realAlert=event;$('simRealtimeNotice').hidden=false;document.getElementById('application').classList.add('real-alert-open');}
function goLive(){const id=state.realAlert?.id;stop();if(id)window.GQMapLive?.select?.(id,true);}
async function loadRegions(){try{const r=await fetch('./data/region_centers.json',{cache:'force-cache'});if(!r.ok)throw Error('HTTP '+r.status);const rows=await r.json();
 if(!Array.isArray(rows)||rows.length!==64||rows.some(x=>!x.id||!Number.isFinite(x.lat)||!Number.isFinite(x.lon)))throw Error('관측망 자료 형식 오류');state.regions=rows;updateSensorCount();}
 catch(e){$('simError').textContent='64개 가상 관측점 자료 연결 실패. 새로고침해 주세요.';}}
function bind(){
 $('navExperiment').onclick=toggle;$('simExit').onclick=stop;
 $('simPreset').onchange=setPreset;
 for(const id of ['simLat','simLon','simDepth'])$(id).oninput=()=>{$('simPreset').value='custom';invalidate()};
 $('simMag').oninput=()=>{$('simMagValue').textContent=Number($('simMag').value).toFixed(1);invalidate()};
 for(const id of ['simKR','simJP'])$(id).onchange=()=>{updateSensorCount();invalidate()};
 $('simMapPick').onclick=()=>picks('source');$('simPickPoint').onclick=()=>picks('point');$('simAddPoint').onclick=addCustom;
 $('simPointList').onclick=e=>{const b=e.target.closest('[data-remove-point]');if(!b)return;state.custom=state.custom.filter(x=>x.id!==b.dataset.removePoint);renderCustom();invalidate()};
 $('simForm').onsubmit=e=>{e.preventDefault();setupRun()};
 $('simReset').onclick=()=>invalidate();$('simPlay').onclick=setPlaying;
 $('simNext').onclick=()=>{if(!state.run)return;const next=S.nextTime(state.run,state.time);state.playing=false;fireBulletinByButton(next);render(next,true)};
 $('simFirst').onclick=()=>{if(!state.run)return;state.playing=false;fireBulletinByButton(state.run.firstP);render(state.run.firstP,true)};
 $('simTimeline').oninput=()=>{if(!state.run)return;state.playing=false;render(Number($('simTimeline').value),true)};
 $('simSpeed').onchange=()=>{state.speed=Number($('simSpeed').value)};
 $('simExport').onclick=download;
 $('simTabFeed').onclick=()=>showTab('feed');$('simTabRegions').onclick=()=>showTab('regions');$('simCountrySelect').onchange=renderRegions;
 $('simRegionList').onclick=e=>{const b=e.target.closest('[data-sim-region]');if(b)selectPoint(b.dataset.simRegion)};
 $('simAudioTest').onclick=()=>{armaudio();playTrainingSound();if($('simVoice').checked)speakTraining()};
 $('simFill').onchange=()=>{if(state.active&&state.run){window.GQRealMap?.setSnapshot({events:[state.event],event:state.event,mode:$('simFill').checked?'model':'off'});frameMap()}};
 for(const id of ['simWaves','simSensors'])$(id).onchange=frameMap;
 $('simBulletinClose').onclick=()=>{const hidden=!$('simBulletinBody').hidden;$('simBulletinBody').hidden=hidden;$('simBulletinClose').textContent=hidden?'+':'−'};
 $('simGoLive').onclick=goLive;
 window.addEventListener('gq-sim-select-point',e=>{if(e.detail?.id)selectPoint(e.detail.id)});
 window.addEventListener('gq-map-pick',e=>{if(!state.active||!state.picking||!e.detail)return;const {lat,lon}=e.detail;if(!Number.isFinite(lat)||Math.abs(lat)>80||!Number.isFinite(lon)||Math.abs(lon)>180)return;
 if(state.picking==='source'){$('simLat').value=lat.toFixed(4);$('simLon').value=lon.toFixed(4);$('simPreset').value='custom';invalidate()}
 else{$('simPointLat').value=lat.toFixed(4);$('simPointLon').value=lon.toFixed(4)}picks(state.picking);
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.picking){picks(state.picking);e.stopPropagation()}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing){state.playing=false;state.pausedForHidden=true;render(state.time)}else if(!document.hidden&&state.pausedForHidden){state.pausedForHidden=false;}});
}
const api={isActive:()=>state.active,isPicking:()=>!!state.picking,stop,onRealAlert,syncMap(){if(!state.active)return;if(!state.run){initBlankMap();return;}
 window.GQRealMap?.setSnapshot({events:[state.event],event:state.event,mode:$('simFill').checked?'model':'off'});frameMap();},get state(){return state;},start:setupRun};
window.GQSimulator=api;
bind();loadRegions();requestAnimationFrame(tick);
})();
