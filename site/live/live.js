/* GEOQUAKE LIVE bridge v2.0 — real published quake origins -> original v0.8 educational simulation.
   The published event is real; travel times, waves, displayed regional colors and model bulletin are NOT measurements or official warnings.
   The original /lab/index.html file is not modified. */
'use strict';
(() => {
  const API = 'https://geoquake-korea-server-production.up.railway.app';
  const $ = id => document.getElementById(id);
  const labs = window.GEOQUAKE;
  const WS_URL = API.replace(/^https:/,'wss:') + '/ws';
  const cache = {live:[],history:[],historyMode:false,selected:null,snapshot:null,connected:false,
    lastHttp:null, known:new Set(), primed:false, ws:null, retry:1500, retryTimer:0, observedMode:false};
  const allowed = new Set(['KMA','JMA','USGS']);
  const safetyWindowMs = 20*60*1000;
  const stamp = s => {const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'시간 미제공';};
  const valid = e => e && typeof e.id==='string' && allowed.has(e.source) &&
    Number.isFinite(e.latitude) && Number.isFinite(e.longitude) &&
    e.latitude>=-80&&e.latitude<=80&&e.longitude>=-180&&e.longitude<=180&&
    Number.isFinite(e.depthKm)&&e.depthKm>=0&&e.depthKm<=700 &&
    Number.isFinite(e.magnitude)&&e.magnitude>=0&&e.magnitude<=9.5 &&
    !e.cancelled && Number.isFinite(Date.parse(e.occurredAt));
  function describe(e){return `${e.source} | M ${e.magnitude.toFixed(1)} | ${String(e.location||'위치 미상').slice(0,60)} | ${stamp(e.occurredAt)}`;}
  function status(message,isError=false){$('liveNetwork').textContent=message;document.querySelector('.live-light').classList.toggle('on',!isError);document.querySelector('.live-light').classList.toggle('bad',isError);}
  function sourceStatus(){const src=cache.snapshot?.sources||{};const entries=['KMA','JMA','USGS'].map(k=>{
    const s=src[k]||{},text=s.state==='ok'?`수신 ${s.count??'?' }건`:s.state==='error'?'오류':s.state==='unconfigured'?'키 미설정':'연결 대기';
    return `${k} ${text}`;
  });
    $('liveAgencyStatus').textContent=entries.join(' · ');
    const gen=cache.snapshot?.generatedAt;
    const elapsed=gen?Date.now()-Date.parse(gen):NaN;
    $('liveTimestamp').textContent=gen?`최근 수집 ${stamp(gen)}${elapsed>3*60*1000?' · 자료 지연':''}`:'최근 수집 없음';
  }
  function list(){return (cache.historyMode?cache.history:cache.live).filter(valid).filter(e=>$('liveAgency').value==='ALL'||e.source===$('liveAgency').value);}
  function updateSelect({preferLatest=false}={}){
    const select=$('liveEventSelect'),items=list();
    const selected=cache.selected && items.some(e=>e.id===cache.selected)?cache.selected:null;
    const wanted=selected || (preferLatest?items[0]?.id:null);
    select.replaceChildren();
    if(!items.length){const o=new Option(cache.historyMode?'검색된 유효 지진 없음':'연결 대기 또는 선택 조건에 해당하는 지진 없음','');select.append(o);}
    else for(const e of items.slice(0,450))select.append(new Option(describe(e),e.id));
    select.value=wanted||'';
    cache.selected=select.value||null;
    $('liveApply').disabled=!cache.selected;
  }
  function selectedEvent(){return list().find(e=>e.id===cache.selected)||null;}
  function showModel(e){
    if(!valid(e)){status('진앙·규모·깊이 정보가 없어 모형 계산 불가',true);return;}
    cache.selected=e.id;
    $('liveEventSelect').value=e.id;
    $('preset').value='custom';
    $('inputLat').value=e.latitude.toFixed(4);
    $('inputLon').value=e.longitude.toFixed(4);
    $('inputMag').value=String(e.magnitude);
    $('magOutput').textContent=e.magnitude.toFixed(1);
    $('inputDepth').value=String(e.depthKm);
    // In the original lab, the model time starts at the user action; replace it with the real event's timestamp
    // while *never* claiming that the modeled wave position is a measured/current seismic wave location.
    if(!labs.launch())return;
    labs.state.run.source.name=`${e.source} 발표 · ${String(e.location||'진앙').slice(0,50)}`;
    const t=Date.parse(e.occurredAt);
    if(Number.isFinite(t))labs.state.origin=t;
    const first=Math.min(labs.state.run.duration,Math.max(0,labs.state.run.firstP+0.03));
    labs.setTime(first,{pause:true});
    const nearest=labs.REGIONS.reduce((best,r)=>{
      const rad=Math.PI/180,dl=(r.lat-e.latitude)*rad,doLon=(r.lon-e.longitude)*rad;
      const d=2*6371*Math.asin(Math.min(1,Math.sqrt(Math.sin(dl/2)**2+Math.cos(r.lat*rad)*Math.cos(e.latitude*rad)*Math.sin(doLon/2)**2)));
      return !best||d<best.distance?{distance:d,id:r.id}:best;
    },null);
    if(nearest)labs.selectPoint(nearest.id);
    const current=cache.historyMode?'과거 발표정보':'최근 발표정보';
    $('liveNetwork').textContent=`${current} 적용 · ${e.source} M${e.magnitude.toFixed(1)} · T+ 모델`;
    $('liveMode').disabled=!hasObserved(e);
    if(cache.observedMode&&!hasObserved(e))cache.observedMode=false;
    updateModeButton();
    // Reset bulletin rendering after changing the model origin so it displays the selected event's timestamp.
    document.getElementById('bulletin').dataset.runId='';
    labs.renderAll();
    document.querySelector('.settings .desc').textContent='현재 입력은 실제 지진의 발표 값입니다. 아래 계산·파면·색칠은 교육용 시뮬레이션이며 공식 관측·경보가 아닙니다.';
  }
  function alertMessage(head,msg,asNotification=false){
    $('liveAlertTitle').textContent=head;$('liveAlertMessage').textContent=msg;$('liveAlert').hidden=false;
    if(asNotification && $('liveNotify').checked && 'Notification' in window && Notification.permission==='granted'){
      try{new Notification(head,{body:msg,tag:'gq-live-published-event'});}catch{}
    }
  }
  function incoming(data,via){
    if(!data || data.schemaVersion!=='1.0' || !Array.isArray(data.events) || !data.sources)return;
    const next=data.events.filter(e=>e && typeof e.id==='string' && allowed.has(e.source));
    const recentlyArrived=next.filter(e=>{
      if(cache.known.has(e.id)||!cache.primed)return false;
      const last=Date.parse(e.reportedAt||e.updatedAt||e.occurredAt),origin=Date.parse(e.occurredAt);
      const fresh=Number.isFinite(last)?last:origin;
      return valid(e)&&Number.isFinite(fresh)&&Date.now()-fresh<=safetyWindowMs&&fresh<=Date.now()+60_000;
    });
    next.forEach(e=>cache.known.add(e.id));
    cache.primed=true;
    cache.live=next.slice().sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
    cache.snapshot=data;
    cache.lastHttp=Date.now();
    sourceStatus();
    if(!cache.historyMode){
      const old=cache.selected;
      updateSelect({preferLatest:!old});
      if(!old && cache.selected){const first=selectedEvent();if(first)showModel(first);}
    }
    if(cache.connected)status('WebSocket 실시간 연결');
    else status(via==='http'?'HTTP 조회 연결 · WebSocket 재접속 중':'자료 수신 중');
    if(recentlyArrived.length){
      const e=recentlyArrived.sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
      const info=`${e.source} 발표 · M ${e.magnitude.toFixed(1)} · ${e.location} · 지진파와 색칠은 모형 재현입니다.`;
      alertMessage('새 지진 발표정보 수신 (공식 조기경보 아님)',info,true);
      if(!cache.historyMode && $('liveAutoFollow').checked){
        cache.selected=e.id;
        updateSelect();
        showModel(e);
      }
    }
  }
  async function fetchLatest(){
    try{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),16000);
      let r;try{r=await fetch(API+'/api/events',{cache:'no-store',signal:ctrl.signal});}finally{clearTimeout(t);}
      if(!r.ok)throw Error('HTTP '+r.status);
      incoming(await r.json(),'http');
    }catch(e){if(!cache.connected)status(`서버 연결 오류 (${e.name==='AbortError'?'시간초과':e.message}) · 마지막 자료 보존`,true);}
  }
  function connect(){
    if(cache.ws && [WebSocket.CONNECTING,WebSocket.OPEN].includes(cache.ws.readyState))return;
    const socket=new WebSocket(WS_URL);cache.ws=socket;
    socket.onopen=()=>{cache.connected=true;cache.retry=1500;status('WebSocket 실시간 연결');sourceStatus();};
    socket.onmessage=evt=>{try{const p=JSON.parse(evt.data);if(p.type==='snapshot')incoming(p.data,'ws');}catch{status('지진정보 메시지 형식 오류',true);}};
    socket.onclose=()=>{if(cache.ws!==socket)return;cache.connected=false;status('WebSocket 끊김 · 다시 연결 중',true);cache.retryTimer=setTimeout(connect,cache.retry);cache.retry=Math.min(30_000,Math.round(cache.retry*1.7));};
    socket.onerror=()=>{if(socket.readyState===WebSocket.OPEN)socket.close();};
  }
  async function searchHistory(){
    const start=$('liveStart').value,end=$('liveEnd').value,minmag=Number($('liveMinMag').value);
    const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
    if(!start||!end||!Number.isFinite(days)||days<0||days>30){$('liveHistoryStatus').textContent='시작일·종료일과 조회 범위를 확인하세요 (날짜 차 최대 30일).';return;}
    const btn=$('liveHistorySearch');btn.disabled=true;$('liveHistoryStatus').textContent='과거 지진정보 조회 중...';
    try{
      const params=new URLSearchParams({start,end,minmag:String(minmag),limit:'150'});
      const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),22000);let r;
      try{r=await fetch(API+'/api/history?'+params,{cache:'no-store',signal:ctrl.signal});}finally{clearTimeout(t);}
      if(!r.ok){let message='HTTP '+r.status;try{let obj=await r.json();if(typeof obj.detail==='string')message+=' '+obj.detail;}catch{}throw Error(message);}
      const obj=await r.json();if(!Array.isArray(obj.events))throw Error('서버 응답 형식 오류');
      cache.history=obj.events.filter(valid);cache.historyMode=true;cache.selected=null;
      $('liveAgency').value='ALL';updateSelect({preferLatest:true});
      $('liveHistoryStatus').textContent=`${cache.history.length}건 수신${obj.truncated?' · 더 많은 결과가 있어 상위 150건만 표시':''}. 실제 과거 발령 경보 및 당시 관측진도는 제공되지 않습니다.`;
      if(cache.selected)showModel(selectedEvent());
    }catch(e){$('liveHistoryStatus').textContent='조회 실패: '+e.message+' · 과거 기록이 0건이라는 뜻이 아닙니다.';}
    finally{btn.disabled=false;}
  }
  function returnLive(){cache.historyMode=false;cache.selected=null;$('liveHistoryPanel').hidden=true;updateSelect({preferLatest:true});if(cache.selected)showModel(selectedEvent());}
  // Optional official observation overlay: require explicitly sourced, already-normalized regional values
  // from a future, independently verified KMA/JMA adapter. Never synthesize missing observed intensities.
  const JP=['0','1','2','3','4','5약','5강','6약','6강','7'];
  const KR_COLORS=['#334254','#35536f','#3c769b','#39a5b6','#55c2a3','#b5cb61','#e0b652','#df8b47','#df6854','#d54e65','#b8548f','#a66bd4','#e49bea'];
  const JP_COLORS=['#3c4c61','#4f83b8','#4eafc9','#79caa4','#d6ce68','#edb84e','#e98c4d','#e26963','#b977d7','#ed9bdb'];
  function official(e){return e && e.observationsVerified===true && ['KMA','JMA'].includes(e.source) && e.observedRegions && typeof e.observedRegions==='object' && !Array.isArray(e.observedRegions);}
  function hasObserved(e){return Boolean(official(e)&&Object.entries(e.observedRegions).some(([id,v])=>validatedObs(e,id,v)));}
  function validatedObs(e,id,raw){
    if(!/^(KR|JP)-\d{2}$/.test(id))return false;
    const country=id.slice(0,2),v=(raw && typeof raw==='object')?raw.value:raw;
    if(country==='KR')return e.source==='KMA' && Number.isInteger(v) && v>=1 && v<=12;
    return e.source==='JMA' && JP.includes(String(v));
  }
  function getObserved(id){
    const e=selectedEvent();if(!official(e))return null;
    const raw=e.observedRegions[id];if(!validatedObs(e,id,raw))return null;
    const val=(raw && typeof raw==='object')?raw.value:raw;
    const ix=id.startsWith('KR')?Number(val):JP.indexOf(String(val));
    return {value:val,index:ix,scale:id.startsWith('KR')?'MMI':'JMA',kind:'official-observed'};
  }
  function drawObservedFill(){
    const map=labs.map,ctx=map.ctx,B=window.GQBoundaries;
    if(!B?.features)return;
    for(const f of B.features){
      const obs=getObserved(f.gqid);if(!obs)continue;
      const color=f.gqid.startsWith('KR')?KR_COLORS[obs.index]:JP_COLORS[obs.index];
      const g=f.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
      ctx.beginPath();
      for(const poly of polys){for(const ring of poly){
        for(let i=0;i<ring.length;i++){const [x,y]=labs.project(ring[i][0],ring[i][1]);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();
      }}
      ctx.save();ctx.globalAlpha=labs.state.fillAlpha||0.78;ctx.fillStyle=color;ctx.fill('evenodd');ctx.restore();
    }
  }
  function updateModeButton(){
    const e=selectedEvent(),exists=hasObserved(e);
    $('liveMode').disabled=!exists;
    $('liveMode').textContent=cache.observedMode?'관측 색칠 → 모형으로 전환':(exists?'모형 색칠 → 관측진도로 전환':'모형 색칠 · 관측자료 없음');
    $('liveMode').setAttribute('aria-pressed',String(cache.observedMode));
    labs.map.dirty=true;
  }
  function toggleMode(){const e=selectedEvent();if(!hasObserved(e))return;cache.observedMode=!cache.observedMode;updateModeButton();labs.renderAll();
    if(cache.observedMode)alertMessage('공식 관측진도 표시','관측 자료가 제공된 구역만 색칠하며, 나머지 구역은 미제공으로 표시합니다. 원래 모형 재현정보는 별도로 구분됩니다.');
  }
  function init(){
    // Existing lab canvas, map interactions, administrative boundaries, color legend and timeline remain intact.
    const warning=document.createElement('div');warning.className='live-model-warning';warning.textContent='LIVE에서 선택한 지진의 발생정보는 실제 발표 값입니다. 아래 행정구역 색칠·가상 관측점·P·S파·모형 속보는 실제 관측진도가 아닌 교육용 추정입니다.';
    const settings=document.querySelector('.settings');settings.insertBefore(warning,settings.querySelector('form'));
    $('liveAgency').onchange=()=>{cache.selected=null;updateSelect({preferLatest:true});};
    $('liveEventSelect').onchange=()=>{cache.selected=$('liveEventSelect').value;};
    $('liveApply').onclick=()=>{const e=selectedEvent();if(e)showModel(e);};
    $('liveHistoryButton').onclick=()=>{$('liveHistoryPanel').hidden=!$('liveHistoryPanel').hidden;};
    $('liveHistorySearch').onclick=searchHistory;
    $('liveReturn').onclick=returnLive;
    $('liveMode').onclick=toggleMode;
    $('liveCloseAlert').onclick=()=>$('liveAlert').hidden=true;
    $('liveNotify').onchange=async()=>{if(!$('liveNotify').checked)return;if('Notification' in window && Notification.permission==='default'){
      const permission=await Notification.requestPermission();if(permission!=='granted')alertMessage('알림 권한 미허용','페이지 내 발표 표시와 기록 조회는 계속 사용할 수 있습니다.');
    }};
    $('sourceForm').addEventListener('submit',()=>{cache.selected=null;cache.observedMode=false;updateModeButton();},false);
    const today=new Date().toISOString().slice(0,10);$('liveEnd').value=today;
    const from=new Date(Date.now()-7*86400_000).toISOString().slice(0,10);$('liveStart').value=from;
    setInterval(()=>{sourceStatus();if(!cache.snapshot)return;const stale=Date.now()-Date.parse(cache.snapshot.generatedAt);if(stale>3*60*1000)status('수집 지연 · 이전 자료 참고',true);},15_000);
    setInterval(fetchLatest,60_000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)fetchLatest();});
    try{const handoff=sessionStorage.getItem('geoquake:live-selection');sessionStorage.removeItem('geoquake:live-selection');
      if(handoff){const e=JSON.parse(handoff);if(valid(e)){cache.history=[e];cache.historyMode=true;cache.selected=e.id;updateSelect();showModel(e);$('liveHistoryStatus').textContent='이전 화면에서 선택한 실제 발표 사건입니다.';}}
    }catch{}
    sourceStatus();fetchLatest();connect();
  }
  window.GQLive={get observedMode(){return cache.observedMode;},getObserved,drawObservedFill};
  init();
})();
