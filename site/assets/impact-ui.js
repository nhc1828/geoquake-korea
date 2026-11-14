/* GEOQUAKE 1.2: transparent educational shaking reconstruction from published earthquake origins.
   This is NOT an operational Earthquake Early Warning (EEW) system. */
'use strict';
(() => {
const Q = window.GQImpact;
const V = window.GQViewer;
if(!Q || !V) throw Error('GEOQUAKE impact module dependency not loaded');
const $ = id => document.getElementById(id);
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ROOT = 'https://geoquake-korea-server-production.up.railway.app';
const state = {event:null,rows:[],selected:null,country:'KR',time:0,playing:false,speed:5,duration:240,lastFrame:0,overlay:true,layer:null,pWave:null,sWave:null,seen:new Set(),primed:false,history:[],historyQuery:0};
function fmt(x){return Number.isFinite(x)?x.toFixed(1):'—';}
function fmtDate(x){const d = new Date(x);return Number.isFinite(d.valueOf())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'미제공';}
function fmtArrival(x){return x>9999?'10,000초 초과':fmt(x)+'초';}
function valid(e){return Q.validEvent(e);}
function nearestForCurrent(){const target=state.rows.find(r=>r.id===state.selected);return target||state.rows[0]||null;}
function sourceIntensity(e){
  if(e.maxIntensity===null || e.maxIntensity===undefined || e.maxIntensity==='')return '기관별 관측 최대진도: 현재 수신 자료에 없음';
  return `${e.source||'기관'} 발표 최대진도: ${e.intensityScale||'진도'} ${e.maxIntensity} (지역별 모형값과 별도)`;
}
function setEvent(e,fromHistory=false){
  state.playing=false;state.time=0;state.event=e;
  if(!valid(e)){
    state.rows=[];$('impactEmpty').hidden=false;$('impactActive').hidden=true;
    $('impactEmpty').textContent='선택한 사건에 규모·깊이·진앙 좌표가 모두 제공되지 않아 모형 계산을 할 수 없습니다. 없는 값을 임의로 채우지 않습니다.';
    renderOverlay();return;
  }
  state.rows=Q.calculate(e);
  const nearest=Q.nearestRegion(e.latitude,e.longitude);
  state.country=nearest?.country==='JP'?'JP':'KR';
  state.selected=nearest?.id||state.rows[0]?.id;
  state.speed=Number($('impactSpeed').value)||5;
  state.duration=Math.max(60,Math.min(3000,Math.ceil(Math.max(...state.rows.map(r=>r.sArrival))+20)));
  $('impactSeek').max=String(state.duration);
  $('impactSeek').value='0';
  $('impactCountry').value=state.country;
  $('impactTitle').textContent=`${e.location||'진앙 위치 미상'} · M ${e.magnitude.toFixed(1)}`;
  $('impactEventMeta').textContent=`${esc(e.source||'USGS')} · 발생 ${fmtDate(e.occurredAt)} · 깊이 ${fmt(e.depthKm)} km${fromHistory?' · 과거 기록 선택':''}`;
  $('impactSourceNotice').textContent=sourceIntensity(e)+' · 계산식은 실험실 v0.8과 동일한 교육용 시연입니다.';
  $('impactEmpty').hidden=true;$('impactActive').hidden=false;
  setReconstruction();
  drawReport();
  if(state.overlay)renderOverlay();
  // Live and historical earthquake parameters are inputs; simulated playback starts from t=0, never from official issue time.
}
function setReconstruction(){
  const kr=state.rows.filter(r=>r.country==='KR'&&Q.threshold(r));
  const jp=state.rows.filter(r=>r.country==='JP'&&Q.threshold(r));
  const peakKR=state.rows.filter(r=>r.country==='KR').sort((a,b)=>b.index-a.index)[0];
  const peakJP=state.rows.filter(r=>r.country==='JP').sort((a,b)=>b.index-a.index)[0];
  const flagged=kr.length+jp.length>0;
  $('impactReconstruction').classList.toggle('impact-low',!flagged);
  $('impactReconstruction').innerHTML=`<strong>${flagged?'모형 기준 알림 조건에 해당하는 지역 있음':'모형 기준 강한 흔들림 조건에 해당하는 지역 없음'}</strong>
    <div>한국 ${kr.length}곳(대표점 MMI IV 이상) · 일본 ${jp.length}곳(대표점 JMA 4 이상).</div>
    <div>모형의 각국 최고값: 한국 ${peakKR?.display||'—'} · 일본 ${peakJP?.display||'—'}</div>
    <small>이것은 지진 발생 후 입력값을 이용한 교육용 재현입니다. 당시 실제 발령된 경보 또는 국가기관의 예상진도를 뜻하지 않습니다.</small>`;
}
function drawRows(){
  const sel=state.rows.filter(r=>r.country===state.country).sort((a,b)=>b.index-a.index||a.distanceKm-b.distanceKm);
  $('impactRegionRows').innerHTML=sel.map(r=>{
    const highlight=r.id===state.selected,phase=Q.phase(r,state.time);
    return `<button type="button" class="impact-region-row ${highlight?'active':''}" data-imp-id="${esc(r.id)}">
      <span class="color" style="background:${r.color}">${esc(String(r.value))}</span>
      <span class="city">${esc(r.short)}</span>
      <span class="distance">${fmt(r.distanceKm)}km</span>
      <span class="arrive">${phase==='도달 전'?'P '+fmtArrival(r.pArrival-state.time):phase==='P 도달'?'S '+fmtArrival(r.sArrival-state.time):'S 도달'}</span>
      <span class="level ${Q.threshold(r)?'':'quiet'}">${esc(r.display)}</span>
      </button>`;
  }).join('');
}
function drawPoint(){
  const row=nearestForCurrent();if(!row)return;
  $('impactPointInfo').innerHTML=`<strong>${esc(row.name)} · 대표 지점</strong>
    <span class="impact-intensity" style="color:${row.color}">${esc(row.display)}</span>
    <p>진앙거리 ${fmt(row.distanceKm)} km · 진원거리 ${fmt(row.hypocentralKm)} km</p>
    <p>P파 T+${fmtArrival(row.pArrival)} · S파 T+${fmtArrival(row.sArrival)}<br>P–S 간격 ${fmt(row.spWindow)}초</p>
    <p>모의 재생 현재: ${Q.phase(row,state.time)}. 실제 현재 지진파 위치를 추적한 결과가 아닙니다.</p>`;
}
function drawClock(){
  updateWaveRings();
  $('impactSeek').value=String(state.time);
  $('impactTimeText').textContent='T+'+fmt(state.time)+'초';
  $('impactDuration').textContent=`모형 재생 · 최대 ${state.duration}초`;
  $('impactPlay').textContent=state.playing?'Ⅱ 일시정지':'▶ 재현 재생';
}
function drawReport(){drawClock();drawPoint();drawRows();}
function waveSurfaceKm(velocity){
  if(!state.event || !Number.isFinite(state.event.depthKm))return 0;
  const traveled=velocity*state.time,depth=state.event.depthKm;
  return traveled<=depth?0:Math.sqrt(traveled*traveled-depth*depth);
}
function updateWaveRings(){
  if(!state.pWave||!state.sWave)return;
  for(const [ring,velocity] of [[state.pWave,6],[state.sWave,3.5]]){
    const radius=waveSurfaceKm(velocity);
    const visible=radius>0&&radius<3000;
    ring.setRadius(visible?radius*1000:0);
    ring.setStyle({opacity:visible?.75:0,fillOpacity:0});
  }
}
function renderOverlay(){
  const map=V.state.map;
  if(!map||!window.L)return;
  if(state.layer)map.removeLayer(state.layer);
  state.layer=null;state.pWave=null;state.sWave=null;
  if(!state.overlay||!state.event||!state.rows.length)return;
  const layer=L.layerGroup();
  const center=[state.event.latitude,state.event.longitude];
  state.pWave=L.circle(center,{radius:0,color:'#76bdf2',weight:2,dashArray:'6 6',fill:false,interactive:false}).addTo(layer);
  state.sWave=L.circle(center,{radius:0,color:'#efa856',weight:2,fill:false,interactive:false}).addTo(layer);
  for(const r of state.rows){
    const inCountry = r.country===state.country;
    const circle = L.circleMarker([r.lat,r.lon],{
      radius:inCountry?10:6,fillColor:r.color,color:inCountry?'#f7f8ff':'#182536',
      weight:inCountry?1.7:1,fillOpacity:inCountry?.88:.58,opacity:.96
    });
    circle.bindTooltip(`${r.short}: ${r.display} · 모형 추정`,{direction:'top'});
    circle.on('click',()=>selectPoint(r.id));
    circle.addTo(layer);
  }
  L.circleMarker([state.event.latitude,state.event.longitude],{
    radius:10,color:'#f1b978',fillColor:'#ff856a',fillOpacity:1,weight:2
  }).bindTooltip(`실제 발표 진앙: ${state.event.location}`,{direction:'top'}).addTo(layer);
  state.layer=layer.addTo(map);
  updateWaveRings();
  $('impactMapToggle').textContent='모형 진도 지도 숨기기';
  $('impactMapToggle').setAttribute('aria-pressed','true');
}
function selectPoint(id){
  if(!state.rows.some(r=>r.id===id))return;
  state.selected=id;state.country=id.slice(0,2);$('impactCountry').value=state.country;
  drawReport();
  const r=nearestForCurrent();if(V.state.map&&r)V.state.map.panTo([r.lat,r.lon]);
}
function alertBanner(e,row,test=false){
  if(!row)return;
  $('impactLiveTitle').textContent=test?'모의 알림 테스트 · 실제 지진 아님':'새 지진 발표 수신 · 지역별 진도 모형 알림';
  $('impactLiveMessage').textContent=test?
    `${row.short}에서 모형 진도 표시 기능을 테스트했습니다. 실제 지진이 발생했다는 뜻이 아닙니다.`:
    `${e.source} 발표 ${e.location} (M ${e.magnitude.toFixed(1)}). 관심 지점 ${row.short||row.name}의 시연값 ${row.display} · 거리는 ${Math.round(row.distanceKm)}km`;
  $('impactLiveBanner').hidden=false;
  if(!test && 'Notification' in window && Notification.permission==='granted'){
    try{new Notification('GEOQUAKE · 발표 후 모형 추정 알림 (공식 경보 아님)',{
      body:`${row.name}: ${row.display}, M ${e.magnitude.toFixed(1)} · ${e.location}`,
      tag:'gq-model-'+e.id
    });}catch{}
  }
}
function watchPoint(){
  const place=$('placeSelect').value;
  const coords=place==='custom'?[$('watchLat').value,$('watchLon').value]:place.split(',');
  if(!coords||coords.length!==2||coords.some(x=>String(x).trim()===''))return null;
  const lat=Number(coords[0]),lon=Number(coords[1]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
  const nearest=Q.nearestRegion(lat,lon);
  // The closest region only selects display scale. This is not an official boundary classification.
  return {lat,lon,country:nearest.country,name:$('placeSelect').selectedOptions[0].textContent||'관심 지점',short:nearest.short,id:'watch'};
}
function onSnapshot(data){
  const ids = new Set((data.events||[]).map(x=>x.id));
  if(!state.primed){state.primed=true;ids.forEach(id=>state.seen.add(id));return;}
  const additions=(data.events||[]).filter(e=>!state.seen.has(e.id) && e.ingestMode!=='history');
  ids.forEach(id=>state.seen.add(id));
  if(!additions.length||!$('impactAutoAlert').checked||document.hidden)return;
  const watch=watchPoint();if(!watch)return;
  const minMag=Number($('watchMag').value),radius=Number($('watchRadius').value);
  const fresh=additions.filter(e=>{
    const t=Date.parse(e.occurredAt);
    return valid(e) && e.magnitude>=minMag && Number.isFinite(t) && Date.now()-t<20*60000 && t<=Date.now()+60000;
  }).map(e=>({e,r:Q.estimate(e,watch)})).filter(x=>x.r&&x.r.distanceKm<=radius&&Q.threshold(x.r));
  if(!fresh.length)return;
  fresh.sort((a,b)=>b.r.index-a.r.index);
  alertBanner(fresh[0].e,fresh[0].r);
}
function restoreOpt(){try{$('impactAutoAlert').checked=localStorage.getItem('gq_impact_alert_optin')==='true';}catch{}}
function setHistoryBusy(b){$('impactHistorySearch').disabled=b;$('impactHistorySearch').textContent=b?'검색 중...':'과거 지진 조회';}
async function searchHistory(){
  const start=$('impactHistoryStart').value,end=$('impactHistoryEnd').value,minmag=Number($('impactHistoryMagnitude').value);
  const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  if(!start||!end||!Number.isFinite(days)||days<0||days>30){$('impactHistoryStatus').textContent='시작일과 종료일을 순서대로 선택하세요. 한 번에 최대 31일(날짜 차 30일)입니다.';return;}
  const controller=new AbortController(),ticket=++state.historyQuery;
  setHistoryBusy(true);$('impactHistoryStatus').textContent='USGS 과거 지진 기록을 조회합니다...';
  const timer=setTimeout(()=>controller.abort(),22000);
  try{
    const url=ROOT+'/api/history?'+new URLSearchParams({start,end,minmag:String(minmag),limit:'150'});
    const r=await fetch(url,{signal:controller.signal,cache:'no-store'});
    if(!r.ok){let msg='HTTP '+r.status;try{const error=await r.json();if(error.detail)msg+=' · '+error.detail;}catch{}throw Error(msg);}
    const data=await r.json();
    if(ticket!==state.historyQuery)return;
    if(!Array.isArray(data.events))throw Error('과거 기록의 형식이 올바르지 않습니다.');
    state.history=data.events;
    $('impactHistoryStatus').textContent=`USGS에서 ${state.history.length}건 조회 · ${start}~${end} (UTC)${data.truncated?' · 최대 150건만 표시':''} · 기록을 클릭하면 계산합니다.`;
    $('impactHistoryResults').innerHTML=state.history.length?state.history.map((e,i)=>
      `<button class="impact-history-record" data-history-index="${i}" type="button"><strong><span class="record-mag">M ${Number(e.magnitude).toFixed(1)}</span>${esc(e.location)}</strong><small>${fmtDate(e.occurredAt)} · 깊이 ${fmt(e.depthKm)}km · USGS</small></button>`).join(''):
      '<div class="impact-empty">해당 날짜와 규모에서 조회된 사건이 없습니다. 날짜와 규모 조건을 조정해 주세요.</div>';
  }catch(err){if(ticket!==state.historyQuery)return;
    $('impactHistoryStatus').textContent='기록을 받아오지 못했습니다: '+String(err.message).slice(0,160);
    $('impactHistoryResults').textContent='';
  }finally{clearTimeout(timer);if(ticket===state.historyQuery)setHistoryBusy(false);}
}
function setDefaultDates(){const now=new Date(),y=new Date(now.getTime()-7*86400000);
  $('impactHistoryStart').value=y.toISOString().slice(0,10);
  $('impactHistoryEnd').value=now.toISOString().slice(0,10);
}
function animate(now){
  const dt=Math.max(0,Math.min(0.15,(now-state.lastFrame)/1000));state.lastFrame=now;
  if(state.playing && state.rows.length){
    state.time=Math.min(state.duration,state.time+dt*state.speed);
    if(state.time>=state.duration)state.playing=false;
    if(now-(animate.last||0)>125){drawReport();animate.last=now;}
  }
  requestAnimationFrame(animate);
}
$('impactPlay').onclick=()=>{if(!state.rows.length)return;
  if(state.time>=state.duration)state.time=0;
  state.playing=!state.playing;state.lastFrame=performance.now();drawClock();};
$('impactSeek').oninput=()=>{state.playing=false;state.time=Number($('impactSeek').value)||0;drawReport();};
$('impactSpeed').onchange=()=>{state.speed=Number($('impactSpeed').value)||1;};
$('impactReset').onclick=()=>{state.playing=false;state.time=0;drawReport();};
$('impactCountry').onchange=()=>{state.country=$('impactCountry').value;
  if(!state.rows.some(r=>r.id===state.selected&&r.country===state.country))state.selected=state.rows.find(r=>r.country===state.country)?.id;
  drawReport();renderOverlay();};
$('impactRegionRows').onclick=e=>{const b=e.target.closest('[data-imp-id]');if(b)selectPoint(b.dataset.impId);};
$('impactLaunchLab').onclick=()=>{if(!state.event)return;try{sessionStorage.setItem('geoquake:live-selection',JSON.stringify(state.event));}catch{}window.location.href='./live/';};
$('impactMapToggle').onclick=()=>{state.overlay=!state.overlay;
  if(!state.overlay){if(state.layer&&V.state.map)V.state.map.removeLayer(state.layer);state.layer=null;state.pWave=null;state.sWave=null;
    $('impactMapToggle').textContent='지도에 모형 진도 표시';$('impactMapToggle').setAttribute('aria-pressed','false');}
  else renderOverlay();};
$('impactAutoAlert').onchange=()=>{try{localStorage.setItem('gq_impact_alert_optin',String($('impactAutoAlert').checked));}catch{}};
$('impactTestAlert').onclick=()=>{const p=watchPoint();if(!p)return;
  const modelEvent={latitude:p.lat,longitude:p.lon,magnitude:5,depthKm:10};const row=Q.estimate(modelEvent,p);
  alertBanner(modelEvent,row,true);};
$('impactBannerClose').onclick=()=>{$('impactLiveBanner').hidden=true;};
$('impactHistoryForm').onsubmit=e=>{e.preventDefault();searchHistory();};
$('impactHistoryResults').onclick=e=>{const b=e.target.closest('[data-history-index]');if(!b)return;
  const ev=state.history[Number(b.dataset.historyIndex)];if(!ev)return;
  setEvent(ev,true);$('impactSection').scrollIntoView({block:'start',behavior:'smooth'});
  if(V.state.map){V.state.map.setView([ev.latitude,ev.longitude],ev.longitude>=120&&ev.longitude<=150?5:3);renderOverlay();}
};
window.addEventListener('gq-event-selected',evt=>{if(evt.detail?.event)setEvent(evt.detail.event);});
window.addEventListener('gq-snapshot',evt=>onSnapshot(evt.detail.data));
document.addEventListener('visibilitychange',()=>{if(document.hidden){state.playing=false;drawClock();}});
restoreOpt();setDefaultDates();requestAnimationFrame(animate);
window.GQImpactUI={state,setEvent,searchHistory,watchPoint};
})();
