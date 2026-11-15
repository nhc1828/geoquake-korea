/* GEOQUAKE KOREA 4.1 — real world map, observed and educational predicted regional intensity.
   Real bulletin alerts remain separated from model-only shaking overlays. */
'use strict';
(() => {
const C=window.GQMapCore;if(!C)throw Error('GQMapCore missing');
const $=id=>document.getElementById(id);
const API='https://geoquake-korea-server-production.up.railway.app';
const WS_URL=API.replace(/^https:/,'wss:')+'/ws';
const configKey='geoquake:v4:settings';const alertStorageKey='geoquake:v4:recent-real-notices';
const state={snapshot:null,primed:false,known:new Set(),notified:new Map(),connected:false,ws:null,retry:1500,retryTimer:null,httpTimer:null,pingMs:null,lastPong:null,receivedAt:null,
  selectedId:null,heroId:null,alertId:null,detailsVisible:false,source:'ALL',focus:'all',minMag:'any',autoFollow:true,intensityMode:'hybrid',soundEnabled:false,audio:null,volume:.5,notificationEnabled:false,recentAlerts:[],
  regions:[],base:[],prefectures:[],regionStatus:'loading',lastEventListSig:'',scene:null};
const bound=(v,min,max)=>Math.max(min,Math.min(max,v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames={KMA:'한국 기상청',JMA:'일본 기상청 · P2PQuake',USGS:'미국 지질조사국'};
function persist(){try{localStorage.setItem(configKey,JSON.stringify({minMag:state.minMag,focus:state.focus,autoFollow:state.autoFollow,intensityMode:state.intensityMode,volume:state.volume}))}catch{}}
function restore(){try{const o=JSON.parse(localStorage.getItem(configKey)||'null');if(!o)return;
  if(['any','2.5','3','4','5','6'].includes(o.minMag))state.minMag=o.minMag;
  if(['all','eastasia','korea','japan'].includes(o.focus))state.focus=o.focus;
  if(typeof o.autoFollow==='boolean')state.autoFollow=o.autoFollow;
  if(['hybrid','observed','model','off'].includes(o.intensityMode))state.intensityMode=o.intensityMode;
  else if(typeof o.observed==='boolean')state.intensityMode=o.observed?'hybrid':'off';
  if(typeof o.volume==='number'&&o.volume>=0&&o.volume<=1)state.volume=o.volume;
}catch{}}
function rememberNotice(event){const key=event.id;state.notified.set(key,Date.now());if(state.notified.size>200){const first=state.notified.keys().next().value;state.notified.delete(first)}
  try{localStorage.setItem(alertStorageKey,JSON.stringify([...state.notified].slice(-150)))}catch{}}
function restoreNotices(){try{const a=JSON.parse(localStorage.getItem(alertStorageKey)||'[]');for(const [id,ts] of a){if(typeof id==='string'&&typeof ts==='number'&&Date.now()-ts<12*3600000)state.notified.set(id,ts)}}catch{}}
// The former handmade country canvas/tile system has been fully removed.
// A standalone real-map module handles worldwide basemap and true ADM1 polygons.
let queued=false;
function syncRealMap(){
  const engine=window.GQRealMap;
  if(!engine)return;
  if(window.GQSimulator?.isActive()){window.GQSimulator.syncMap();return;}
  engine.setSnapshot({events:getVisibleEvents(),event:selectedEvent(),mode:state.intensityMode});
}
const map={};
Object.defineProperty(map,'dirty',{get(){return false;},set(v){
  if(!v||queued)return;
  queued=true;
  queueMicrotask(()=>{queued=false;syncRealMap();});
}});
function selectedEvent(){return state.snapshot?.events.find(e=>e.id===state.selectedId)||null;}
function fitEastAsia(){window.GQRealMap?.fitEastAsia();}
function goTo(lon,lat,zoom){window.GQRealMap?.focus(lon,lat,zoom);}
function zoom(factor){window.GQRealMap?.zoom(factor);}
function bindMap(){
  $('zoomIn').onclick=()=>zoom(1.35);
  $('zoomOut').onclick=()=>zoom(1/1.35);
  $('zoomReset').onclick=fitEastAsia;
  window.addEventListener('gq-realmap-ready',()=>{map.dirty=true;});
  window.addEventListener('gq-map-select',e=>{if(e.detail?.id)choose(e.detail.id,true)});
  window.addEventListener('gq-map-coord',e=>{
    const p=e.detail;if(p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon))$('coordDisplay').textContent=p.lat.toFixed(2)+'° / '+p.lon.toFixed(2)+'°';
  });
  window.addEventListener('gq-map-layer-updated',e=>{
    const {observed=0,estimated=0,boundaries=0,provider=''}=e.detail||{};
    const label=state.intensityMode==='off'?'진도 색칠 꺼짐':state.intensityMode==='observed'?'관측진도만':state.intensityMode==='model'?'모형 추정만':'관측 우선 + 모형 보완';
    $('mapKeyNote').textContent=`${label} · 기관 관측 ${observed}곳 / 모형 추정 ${estimated}곳 · 실제 행정경계 ${boundaries}개 · ${provider==='maplibre'?'세계 벡터지도':provider==='leaflet'?'OpenStreetMap':''}`;
  });
}
function updateModeUI(){
  const labels={hybrid:'관측 우선 + 추정 보완',observed:'관측진도만',model:'모형 예상진도만',off:'진도 색칠 끄기'};
  $('intensityModeSelect').value=state.intensityMode;
  $('navObserved').setAttribute('aria-label','진도 레이어: '+labels[state.intensityMode]);
  $('navObserved').setAttribute('title','진도 레이어 변경 · '+labels[state.intensityMode]);
  $('navObserved').setAttribute('aria-pressed',String(state.intensityMode!=='off'));
  $('mapKeyTitle').textContent=labels[state.intensityMode];
  $('mapKeySubtitle').textContent='실측 JMA / 추정 JMA·MMI';
  map.dirty=true;
}
function getVisibleEvents(){const all=state.snapshot?.events?.filter(C.validEvent)||[];
  return all.filter(e=>(state.source==='ALL'||e.source===state.source)&&C.regionMatches(e,state.focus)).sort(C.latestSort)}
function bestEvent(){const filtered=getVisibleEvents();return filtered[0]||null}
function agencyStatusRow(k){const s=state.snapshot?.sources?.[k];const v=s?.state||'pending';const status=v==='ok'?'수신 정상':v==='error'?'연결 오류':v==='unconfigured'?'키 없음':'수신 대기';
  const connected=k==='JMA'&&s?.connected?' · WS 연결':'';return `<div class="agency-row"><span><b>${k}</b> · ${sourceNames[k]}</span><span class="${v==='ok'?'status-ok':v==='error'?'status-off':'status-wait'}">${status}${connected}</span></div>`;}
function renderSources(){if(!state.snapshot)return;$('sourceStates').innerHTML=['KMA','JMA','USGS'].map(agencyStatusRow).join('');const age=C.ageSeconds(state.snapshot.generatedAt);$('mapUpdate').textContent=age===null?'수신 전':age>180?'데이터 갱신 지연 '+age+'초':`서버 자료 ${age}초 전`;
  const online=['KMA','JMA','USGS'].filter(x=>state.snapshot.sources?.[x]?.state==='ok').length;
  $('connectionStatus').dataset.status=state.connected?'open':online?'connecting':'error';$('connectionText').textContent=state.connected?'WebSocket 연결':online?'HTTP 조회 · 재접속':'서버 연결 확인 중';
  $('netDiagnostics').textContent=`통신: ${state.connected?'WebSocket':'HTTP/연결 대기'} · 브라우저↔서버 왕복: ${state.pingMs===null?'미측정':state.pingMs+' ms'} · 서버 최신 수집: ${age===null?'미수신':age+'초 전'}`;
}
function renderList(){const rows=getVisibleEvents().slice(0,120);$('eventCount').textContent=rows.length+'건 표시';
  if(!rows.length){const states=Object.values(state.snapshot?.sources||{});const hasOk=states.some(s=>s?.state==='ok');$('eventList').innerHTML=`<div class="empty-history">${hasOk?'현재 지도 범위의 발표가 없습니다. 필터를 변경해 확인할 수 있습니다.':'수신 중인 기관 자료가 없습니다. 오른쪽 연결 상태를 확인하세요.'}</div>`;return;}
  $('eventList').innerHTML=rows.map(e=>{
    const intensity=C.normIntensity(e),label=intensity?intensity.value:C.finite(e.magnitude)?'M'+e.magnitude.toFixed(1):'—',level=intensity?.index??-1,active=e.id===state.selectedId?' active':'';
    return `<button class="event-row${active}" type="button" data-id="${esc(e.id)}"><div class="event-level ${intensity?'':'missing'}" data-level="${level}"><small>${intensity?'진도':C.finite(e.magnitude)?'규모':'미제공'}</small><strong>${esc(label)}</strong></div><div class="event-body"><strong>${esc(e.location||'진앙 미제공')}</strong><time>${esc(C.fmtDate(e.occurredAt).replace(' KST',''))}</time><div><b>${e.source}</b> · 깊이 ${esc(C.depthText(e))}</div></div></button>`;}).join('');
}
function renderHero(){const e=state.snapshot?.events.find(x=>x.id===state.heroId)||bestEvent();if(!e){$('heroType').textContent='수신 준비 중';$('heroPlace').textContent='최신 지진 발표를 기다리고 있습니다';$('heroIntensityValue').textContent='—';$('heroIntensity').dataset.level='none';$('heroIntensityScale').textContent='기관 발표자료 미수신';$('heroTime').textContent='발생시각 —';$('heroSource').textContent='—';$('heroMag').textContent='—';$('heroDepth').textContent='—';$('heroDetails').disabled=true;return;}
  const i=C.normIntensity(e);$('heroType').textContent=e.bulletinType||'지진 발생정보';$('heroSource').textContent=e.source;$('heroPlace').textContent=e.location||'진앙 미제공';$('heroTime').textContent=C.fmtDate(e.occurredAt);$('heroIntensityValue').textContent=i?i.value:'—';$('heroIntensity').dataset.level=String(i?.index??'none');$('heroIntensityScale').textContent=i?i.scale:'지역별 실제 진도 미제공';$('heroMag').textContent=C.finite(e.magnitude)?'M '+e.magnitude.toFixed(1):'—';$('heroDepth').textContent=C.depthText(e);$('heroDetails').disabled=false;
  $('heroNotice').textContent=i?'기관 발표 최대진도와 지도 추정진도는 서로 다른 값입니다.':'지역별 실측값이 없으면 거리감쇠 모형으로 예상진도를 색칠합니다(교육용 추정).';
}
function renderDetails(){const e=selectedEvent();$('eventDetail').hidden=!e||!state.detailsVisible;if(!e)return;
  $('detailTitle').textContent=e.location||'진앙 미제공';$('detailSubtitle').textContent=`${e.source} · ${e.bulletinType||'지진 발생정보'} · ${e.ingestMode==='history'?'과거 발표':'실제 발표'}`;
  $('threeLang').innerHTML=['ko','en','ja'].map(lang=>{const d=C.cardRows(e,lang);return `<section class="langcard" lang="${lang}"><h4>${d.lang}</h4>${d.rows.map(([l,v])=>`<div class="lang-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</section>`}).join('');
  const obs=C.observedRegions(e);$('detailNote').textContent=obs.length?`JMA 관측점 최고진도가 제공된 도도부현 ${obs.length}곳을 색칠합니다. 현 전체의 흔들림을 뜻하지 않습니다. 세 언어의 지명은 원문을 그대로 표시합니다.`:'지명은 기관 발표 원문입니다. 해당 사건의 지역별 검증된 관측진도는 수신 자료에 없어 임의로 색칠하지 않습니다.';
  const url=C.safeSourceUrl(e.url);$('sourceLink').hidden=!url;if(url)$('sourceLink').href=url;
}
function choose(id,follow=false){const e=state.snapshot?.events.find(a=>a.id===id);if(!e)return;
  if(window.GQSimulator?.isActive())window.GQSimulator.stop();state.selectedId=e.id;state.heroId=e.id;state.detailsVisible=true;
  renderHero();renderList();renderDetails();if(follow&&C.hasCoords(e))goTo(e.longitude,e.latitude,18);map.dirty=true;
}
function sourceFilter(key){state.source=key;document.querySelectorAll('.source-filter').forEach(b=>{const a=b.dataset.source===key;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});
  if(!state.snapshot)return;const visible=getVisibleEvents();if(!visible.some(e=>e.id===state.selectedId)){state.selectedId=visible[0]?.id||null;state.heroId=state.selectedId;}renderList();renderHero();renderDetails();map.dirty=true;}
function displayAlert(event){state.alertId=event.id;$('newAlert').hidden=false;
  $('alertThreeLang').innerHTML=['ko','en','ja'].map(loc=>{const d=C.cardRows(event,loc);return `<div lang="${loc}"><small>${d.lang}</small><b>${esc(d.rows[1][0])}: ${esc(d.rows[1][1])}</b><span>${esc(d.rows[2][0])} ${esc(d.rows[2][1])} · ${esc(d.rows[0][1])}</span></div>`}).join('');
  $('alertMag').textContent=C.finite(event.magnitude)?event.magnitude.toFixed(1):C.normIntensity(event)?.value||'—';
  $('alertLevel').querySelector('small').textContent=C.finite(event.magnitude)?'규모 M':'발표 진도';
  $('alertPlace').textContent=event.location||'진앙 미제공';$('alertAgency').textContent=(sourceNames[event.source]||event.source)+' · '+(event.bulletinType||'지진 발표정보');
  $('alertTime').textContent='발생 '+C.fmtDate(event.occurredAt);}
function notifySystem(event){if(typeof Notification==='undefined'||Notification.permission!=='granted'||!state.notificationEnabled)return;try{new Notification('GEOQUAKE · 새로운 실제 지진 발표',{body:`${event.source} · ${C.finite(event.magnitude)?'M '+C.magnitudeText(event):'규모 미제공'} · ${event.location||'진앙 미제공'}`,tag:'gq-real-'+event.id,renotify:false})}catch{}}
function startAudio(){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;if(!state.audio)state.audio=new Ctx();return state.audio}
function playSound(){if(!state.soundEnabled)return;const a=startAudio();if(!a||a.state!=='running')return;
  const t=a.currentTime+.02;[[700,0,.14],[880,.21,.14]].forEach(([hz,delay,len])=>{const osc=a.createOscillator(),gain=a.createGain();osc.type='sine';osc.frequency.value=hz;gain.gain.setValueAtTime(0,t+delay);gain.gain.linearRampToValueAtTime(.095*state.volume,t+delay+.025);gain.gain.exponentialRampToValueAtTime(.0001,t+delay+len);osc.connect(gain);gain.connect(a.destination);osc.start(t+delay);osc.stop(t+delay+len+.015)});
}
async function toggleAudio(){if(state.soundEnabled){state.soundEnabled=false;$('audioToggle').setAttribute('aria-pressed','false');$('audioLabel').textContent='알림음 켜기';$('audioSetting').textContent='소리 켜기';return;}
  const audio=startAudio();if(!audio){$('audioLabel').textContent='음향 지원 안 됨';return;}try{await audio.resume();state.soundEnabled=audio.state==='running';}catch{state.soundEnabled=false;}
  $('audioToggle').setAttribute('aria-pressed',String(state.soundEnabled));$('audioLabel').textContent=state.soundEnabled?'알림음 켜짐':'알림음 켜기';$('audioSetting').textContent=state.soundEnabled?'소리 끄기':'소리 켜기';}
function newEventsFrom(data){const current=data.events.filter(C.validEvent);if(!state.primed){current.forEach(e=>state.known.add(e.id));state.primed=true;return;}
  const arrived=[];for(const e of current){if(state.known.has(e.id))continue;state.known.add(e.id);if(!C.isAlertCandidate(e)||state.notified.has(e.id)||!C.regionMatches(e,state.focus)||!C.magMatches(e,state.minMag))continue;arrived.push(e)}
  if(state.known.size>12000)state.known=new Set([...state.known].slice(-6000));
  if(!arrived.length)return;arrived.sort(C.latestSort);
  const distinct=[];
  for(const e of arrived){
    if(state.recentAlerts.some(previous=>C.sameQuakeCrossAgency(e,previous)))continue;
    rememberNotice(e);distinct.push(e);state.recentAlerts.push(e);
    if(state.recentAlerts.length>60)state.recentAlerts.shift();
  }
  const first=distinct[0];if(!first)return;
  displayAlert(first);playSound();notifySystem(first);window.GQSimulator?.onRealAlert(first);
  if(state.autoFollow&&!window.GQSimulator?.isActive()){state.selectedId=first.id;state.heroId=first.id;if(C.hasCoords(first))goTo(first.longitude,first.latitude,20);}
}
function receive(data,via='http'){if(!C.validSnapshot(data))return;
  if(state.snapshot?.generatedAt&&data.generatedAt){const old=Date.parse(state.snapshot.generatedAt),newer=Date.parse(data.generatedAt);if(Number.isFinite(old)&&Number.isFinite(newer)&&newer<old-2000)return;}
  newEventsFrom(data);state.snapshot=data;state.receivedAt=Date.now();
  const visible=getVisibleEvents();if(!state.selectedId||!data.events.some(e=>e.id===state.selectedId)){state.selectedId=visible[0]?.id||null;state.heroId=state.selectedId;}
  renderHero();renderList();renderDetails();renderSources();map.dirty=true;
}
let fetching=false;
async function fetchLatest(){if(fetching)return;fetching=true;$('refreshNow').disabled=true;
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),17000);
  try{const r=await fetch(API+'/api/events',{cache:'no-store',signal:abort.signal});if(!r.ok)throw Error('HTTP '+r.status);receive(await r.json(),'http');}
  catch(e){if(!state.connected){$('connectionStatus').dataset.status='error';$('connectionText').textContent='서버 조회 오류';$('mapUpdate').textContent='최근 자료 유지 · 연결 실패';}}
  finally{clearTimeout(timer);fetching=false;$('refreshNow').disabled=false;}
}
function connect(){clearTimeout(state.retryTimer);const socket=new WebSocket(WS_URL);state.ws=socket;
  socket.onopen=()=>{if(state.ws!==socket)return;state.connected=true;state.retry=1500;renderSources()};
  socket.onmessage=evt=>{try{const p=JSON.parse(evt.data);if(p?.type==='snapshot')receive(p.data,'ws');if(p?.type==='pong'&&Number.isFinite(p.clientSent))state.pingMs=Math.round(Math.max(0,Date.now()-p.clientSent));}catch{}};
  socket.onclose=()=>{if(state.ws!==socket)return;state.connected=false;renderSources();state.retryTimer=setTimeout(connect,state.retry+Math.random()*500);state.retry=Math.min(30000,state.retry*1.7)};
  socket.onerror=()=>{if(socket.readyState===WebSocket.OPEN)socket.close()};
}
function liveCounters(){const dt=new Date();$('clock').textContent=dt.toLocaleTimeString('ko-KR',{hour12:false,timeZone:'Asia/Seoul'});$('today').textContent=dt.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  if(state.snapshot){const age=C.ageSeconds(state.snapshot.generatedAt);if(age!==null&&age>180){$('mapUpdate').textContent='자료 지연 '+age+'초';$('mapUpdate').style.color='#ffd089';}else $('mapUpdate').style.color='';}}
function bind(){document.querySelectorAll('.source-filter').forEach(b=>b.onclick=()=>sourceFilter(b.dataset.source));$('eventList').onclick=e=>{const b=e.target.closest('[data-id]');if(b)choose(b.dataset.id,true)};
  $('heroDetails').onclick=()=>{const e=state.snapshot?.events.find(e=>e.id===state.heroId);if(e)choose(e.id,false)};
  $('detailClose').onclick=()=>{state.detailsVisible=false;$('eventDetail').hidden=true};
  $('alertDismiss').onclick=()=>{$('newAlert').hidden=true;document.getElementById('application').classList.remove('real-alert-open');};
  $('alertOpenDetail').onclick=()=>{if(state.alertId)choose(state.alertId,true)};
  $('refreshNow').onclick=fetchLatest;
  $('audioToggle').onclick=toggleAudio;$('audioSetting').onclick=toggleAudio;
  $('testSound').onclick=async()=>{if(!state.soundEnabled)await toggleAudio();playSound()};
  $('mapFollow').onclick=()=>{state.autoFollow=!state.autoFollow;$('mapFollow').classList.toggle('selected',state.autoFollow);$('mapFollow').setAttribute('aria-pressed',String(state.autoFollow));persist()};
  $('navObserved').onclick=()=>{const modes=['hybrid','observed','model','off'];state.intensityMode=modes[(modes.indexOf(state.intensityMode)+1)%modes.length];updateModeUI();persist()};
  $('intensityModeSelect').onchange=()=>{state.intensityMode=$('intensityModeSelect').value;updateModeUI();persist()};
  $('navSettings').onclick=()=>$('settingsDialog').showModal();$('navHelp').onclick=()=>$('helpDialog').showModal();
  $('navFullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.()};
  $('navQuakes').onclick=()=>{if(window.GQSimulator?.isActive())window.GQSimulator.stop();state.detailsVisible=false;$('eventDetail').hidden=true;$('newAlert').hidden=true;fitEastAsia()};
  $('minMag').onchange=()=>{state.minMag=$('minMag').value;persist()};$('focusRegion').onchange=()=>{state.focus=$('focusRegion').value;persist();sourceFilter(state.source)};
  $('notifyPermission').onclick=async()=>{if(typeof Notification==='undefined'||!window.isSecureContext){$('notifyPermission').textContent='브라우저 미지원';return;}try{const p=await Notification.requestPermission();state.notificationEnabled=p==='granted';$('notifyPermission').textContent=p==='granted'?'알림 허용됨':'알림 권한: '+p}catch{$('notifyPermission').textContent='권한 요청 실패'}};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)fetchLatest()});
}
function init(){restore();restoreNotices();$('minMag').value=state.minMag;$('focusRegion').value=state.focus;updateModeUI();$('mapFollow').classList.toggle('selected',state.autoFollow);$('mapFollow').setAttribute('aria-pressed',String(state.autoFollow));
  bind();bindMap();liveCounters();setInterval(liveCounters,1000);setInterval(fetchLatest,45000);
  setInterval(()=>{if(state.ws?.readyState===WebSocket.OPEN)try{state.ws.send(JSON.stringify({type:'ping',clientSent:Date.now()}))}catch{}},20000);
  connect();fetchLatest();}
init();window.GQMapLive={state,map,receive,select:choose,refresh:fetchLatest,resync:syncRealMap};
})();
