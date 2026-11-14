/* GEOQUAKE KOREA 1.1 live viewer. KMA keys stay server-side. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const labels = {KMA:'한국 기상청',JMA:'일본 기상청',USGS:'미국 지질조사국'};
const API_BASE = 'https://geoquake-korea-server-production.up.railway.app';
const EVENTS_URL = API_BASE + '/api/events';
const SOCKET_URL = API_BASE.replace(/^https:/, 'wss:') + '/ws';
const RECONNECT_LIMIT_MS = 30000;
const FALLBACK_POLL_MS = 60000;
const state = {data:null, filtered:[], selected:null, map:null, layer:null, markers:new Map(), markerReady:false, fallback:null, initialized:false, known:new Set(), watchMarker:null, transport:'connecting', socket:null, reconnectTimer:null, reconnectAttempt:0, lastReceivedAt:null};
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const dt = x => x ? new Date(x) : null;
const isoTime = x => {const d=dt(x);return d && !Number.isNaN(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'미제공';};
const hhmm = x => {const d=dt(x);return d && !Number.isNaN(d.getTime())?d.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}):'미제공';};
const distance=(a,b)=>{const rad=Math.PI/180,p=(b.lat-a.lat)*rad,q=(b.lon-a.lon)*rad, h=Math.sin(p/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(q/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));};
const hasCoords = e => n(e.latitude)!==null && n(e.longitude)!==null && Math.abs(e.latitude)<=90 && Math.abs(e.longitude)<=180;
const mStyle = mag => mag === null ? '' : mag>=6?'high':mag>=4?'medium':'';
const validSourceUrl = raw => {try{const u=new URL(raw);return u.protocol==='https:' && ['apihub.kma.go.kr','www.jma.go.jp','earthquake.usgs.gov'].includes(u.hostname)?u.href:null;}catch{return null;}};
function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toast.id);toast.id=setTimeout(()=>$('toast').hidden=true,4800);}
function tab(view){for(const el of document.querySelectorAll('.tab-panel'))el.hidden=el.id!=='tab-'+view;for(const b of document.querySelectorAll('[data-tab]')){const yes=b.dataset.tab===view;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',String(yes));}if(view==='lab'){const frame=$('labFrame');if(!frame.getAttribute('src'))frame.src='./lab/';}if(view==='monitor' && state.map)setTimeout(()=>state.map.invalidateSize(),60);if(view==='monitor' && state.fallback)setTimeout(fallbackDraw,60);location.hash=view==='monitor'?'':'#'+view;}
function mapSetup(){if(typeof window.L==='undefined'){fallbackSetup();return;}
  state.map=L.map('map',{scrollWheelZoom:true,zoomControl:false}).setView([36.2,132.1],5);
  L.control.zoom({position:'bottomright'}).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'© OpenStreetMap contributors',crossOrigin:true}).addTo(state.map);
  state.layer=L.layerGroup().addTo(state.map);
}
function fallbackSetup(){
  const box=$('map'),canvas=document.createElement('canvas');
  canvas.className='fallback-canvas';box.append(canvas);box.classList.add('fallback-map-active');
  const f=state.fallback={canvas,ctx:canvas.getContext('2d'),geo:[],hits:[]};
  $('mapFallback').hidden=false;$('mapFallback').textContent='내장 간략 지도 · 외부 지도 서비스 미연결 · 발생 위치를 클릭해 상세정보 확인';
  canvas.addEventListener('click',ev=>{
    const r=canvas.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;
    const hits=[...f.hits].sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
    if(hits.length&&Math.hypot(hits[0].x-x,hits[0].y-y)<19)selectEvent(hits[0].id,false);
  });
  const resize=()=>{
    const r=box.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));
    f.ctx.setTransform(dpr,0,0,dpr,0,0);fallbackDraw();
  };
  new ResizeObserver(resize).observe(box);resize();
  fetch('./data/base_geometry.json').then(r=>{if(!r.ok)throw Error('geometry HTTP '+r.status);return r.json();})
    .then(data=>{if(Array.isArray(data.features))f.geo=data.features;fallbackDraw();})
    .catch(()=>{ /* fallback grid and epicenters remain functional */ });
}
function fallbackDraw(){
  const f=state.fallback;if(!f)return;
  const c=f.ctx,rect=f.canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  if(w<2||h<2)return;
  c.clearRect(0,0,w,h);c.fillStyle='#173042';c.fillRect(0,0,w,h);
  const region=$('regionSelect').value;
  const bounds=region==='korea'?[122,30.5,133,43.5]:region==='japan'?[122,23,148,47]:region==='all'?[-180,-82,180,82]:[108,19,151,50];
  const [west,south,east,north]=bounds,midLat=(south+north)/2,midLon=(west+east)/2;
  const factor=Math.cos(midLat*Math.PI/180),scale=Math.min((w-36)/((east-west)*factor),(h-36)/(north-south));
  const project=(lon,lat)=>({x:w/2+(lon-midLon)*factor*scale,y:h/2-(lat-midLat)*scale});
  const step=region==='korea'?2:region==='all'?30:10;
  c.strokeStyle='#4a637433';c.lineWidth=.75;c.setLineDash([3,6]);
  for(let lon=Math.ceil(west/step)*step;lon<=east;lon+=step){const a=project(lon,south),b=project(lon,north);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  for(let lat=Math.ceil(south/step)*step;lat<=north;lat+=step){const a=project(west,lat),b=project(east,lat);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  c.setLineDash([]);
  for(const feature of f.geo){
    const geometry=feature.geometry||{},polygons=geometry.type==='MultiPolygon'?geometry.coordinates:geometry.type==='Polygon'?[geometry.coordinates]:[];
    c.beginPath();
    for(const poly of polygons)for(const ring of poly){ring.forEach((pt,i)=>{const a=project(pt[0],pt[1]);if(i===0)c.moveTo(a.x,a.y);else c.lineTo(a.x,a.y);});c.closePath();}
    c.fillStyle=feature.id==='JPN'||feature.id==='KOR'?'#355967':'#293d4a';c.fill('evenodd');c.lineWidth=1;c.strokeStyle='#7596a066';c.stroke();
  }
  const labels=[['한국',127.4,36.0],['일본',137.2,37.0],['중국',115.4,38.0],['동해',131.9,39.2]];
  c.fillStyle='#9db8bd';c.font='12px sans-serif';c.textAlign='center';
  for(const [name,lon,lat] of labels){const a=project(lon,lat);if(a.x>5&&a.x<w-5&&a.y>5&&a.y<h-5)c.fillText(name,a.x,a.y);}
  f.hits=[];
  const points=state.filtered.filter(hasCoords).slice(0,550);
  for(const e of points){const a=project(e.longitude,e.latitude);if(a.x<0||a.x>w||a.y<0||a.y>h)continue;
    const mag=n(e.magnitude),r=mag===null?4:Math.max(4,Math.min(12,mag*1.45)),color=mag===null?'#a8c2d2':mag>=6?'#ec6572':mag>=4?'#e8aa65':'#67d2d1';
    c.beginPath();c.arc(a.x,a.y,r+2,0,Math.PI*2);c.fillStyle='#0d223ccc';c.fill();
    c.beginPath();c.arc(a.x,a.y,r,0,Math.PI*2);c.fillStyle=color;c.fill();
    if(e.id===state.selected){c.beginPath();c.arc(a.x,a.y,r+5,0,Math.PI*2);c.strokeStyle='#f7ffff';c.lineWidth=2;c.stroke();}
    f.hits.push({id:e.id,x:a.x,y:a.y});
  }
  const watch=getWatch();if(watch){const a=project(watch.lon,watch.lat);if(a.x>=0&&a.x<=w&&a.y>=0&&a.y<=h){
    c.fillStyle='#7ce6b8';c.strokeStyle='#efffe7';c.lineWidth=1.5;c.beginPath();c.moveTo(a.x,a.y-9);c.lineTo(a.x+9,a.y);c.lineTo(a.x,a.y+9);c.lineTo(a.x-9,a.y);c.closePath();c.fill();c.stroke();}}
  c.fillStyle='#93b0c0';c.font='10px sans-serif';c.textAlign='left';c.fillText('GEOQUAKE · 단순화한 지리 윤곽',15,h-18);
}
function inRegion(e,region){if(region==='all')return true;if(!hasCoords(e))return false;const lat=e.latitude,lon=e.longitude;
  if(region==='korea')return lat>=32 && lat<=43 && lon>=123 && lon<=132;
  if(region==='japan')return lat>=24 && lat<=46 && lon>=122 && lon<=148;
  return lat>=20 && lat<=48 && lon>=110 && lon<=150;
}
function filters(){if(!state.data)return [];
  const source=$('sourceSelect').value,reg=$('regionSelect').value,min=Number($('magnitudeSelect').value),q=$('searchInput').value.trim().toLocaleLowerCase();
  return state.data.events.filter(e=>(source==='ALL'||e.source===source)&&inRegion(e,reg)
    &&(n(e.magnitude)===null?(min<=-2):e.magnitude>=min)
    &&(!q||String(e.location).toLocaleLowerCase().includes(q))).slice(0,2000);
}
function renderSources(){if(!state.data)return;const snapshot=state.data;
  const stale=!snapshot.generatedAt||Date.now()-new Date(snapshot.generatedAt).getTime()>25*60*1000;
  const names={ok:'수신 정상',error:'연결 오류',unconfigured:'키 미설정',pending:'수집 대기'};
  $('sourceCards').innerHTML=['KMA','JMA','USGS'].map(key=>{
    const s=(snapshot.sources||{})[key]||{state:'pending',message:'수집 안 됨'},isStale=s.state==='ok'&&stale,status=isStale?'stale':s.state;
    const title=isStale?'자료 오래됨':names[s.state]||'상태 확인 필요';
    return `<article class="sourcecard"><span class="sourcecode">${key}</span><div class="sourcecontent"><strong>${labels[key]}</strong><span class="sourcestamp" title="${esc(s.message||'')}">${esc(s.message||'상태 정보 없음')} · ${s.state==='ok'?Number(s.count||0)+'건': '확인 필요'}</span></div><span class="statusbadge ${status}">${title}</span></article>`;
  }).join('');
  $('updatedAt').textContent='마지막 수집: '+isoTime(snapshot.generatedAt);
  const good=['KMA','JMA','USGS'].filter(k=>(snapshot.sources||{})[k]?.state==='ok').length;
  const mode=state.transport==='live'?'WebSocket 연결':state.transport==='connecting'?'서버 연결 중':state.transport==='reconnecting'?'실시간 재연결 중':'HTTP로 확인 중';
  $('globalStatus').textContent=stale?'자료 갱신 지연':good?good+'개 기관 수신 · '+mode:'자료 수신 대기/오류 · '+mode;
  document.querySelector('.livepoint').className='livepoint '+(stale||!good||state.transport!=='live'?'bad':'ok');
}
function renderStats(){if(!state.data)return;const events=state.data.events,now=Date.now(),recent=events.filter(e=>now-new Date(e.occurredAt).getTime()<86400000&&now>=new Date(e.occurredAt).getTime());
  $('count24').textContent=recent.length.toLocaleString('ko-KR')+'건';
  const mags=events.filter(e=>n(e.magnitude)!==null).sort((a,b)=>b.magnitude-a.magnitude);
  $('largestMag').textContent=mags.length?'M '+mags[0].magnitude.toFixed(1):'—';
  $('largestDesc').textContent=mags.length?mags[0].location+' · '+mags[0].source:'규모 자료 없음';
  $('latestTime').textContent=events.length?hhmm(events[0].occurredAt):'—';
  $('latestDesc').textContent=events.length?events[0].location+' · '+isoTime(events[0].occurredAt):'수신된 발생자료 없음';
}
function renderEvents(){const shown=state.filtered;$('filterCount').textContent='목록 '+shown.length+'건';$('mapCount').textContent='지도 '+Math.min(550,shown.filter(hasCoords).length)+'개 표시';
  const noGood=!state.data || !Object.values(state.data.sources||{}).some(s=>s.state==='ok');
  if(!shown.length){$('eventList').innerHTML=`<div class="empty">${noGood?'정상 수신 중인 자료원이 없습니다.<br>Railway 서버와 기관별 수집 상태를 확인하세요.':'조회 조건에 해당하는 발표자료가 없습니다.<br>필터 또는 수집된 기관의 범위를 확인하세요.'}</div>`;return;}
  $('eventList').innerHTML=shown.slice(0,150).map(e=>{
    const m=n(e.magnitude),active=state.selected===e.id,depth=n(e.depthKm);
    return `<button type="button" class="eventitem ${active?'selected':''}" data-eid="${esc(e.id)}"><span class="magblock ${mStyle(m)}">${m===null?'—':m.toFixed(1)}</span><span><span class="eventtop"><b>${esc(e.location)}</b><span class="sourcechip">${esc(e.source)}</span></span><span class="eventmeta"><span>${esc(isoTime(e.occurredAt))}</span><span>${depth===null?'깊이 미상':depth+' km'}</span></span><span class="eventkind">${esc(e.bulletinType)}${e.cancelled?' · 취소':''}${e.maxIntensity?' · 최대진도 '+esc(e.maxIntensity):''}</span></span></button>`;
  }).join('');
}
function renderMap(){if(state.fallback){fallbackDraw();return;}if(!state.map || !state.layer)return;state.layer.clearLayers();state.markers.clear();const points=state.filtered.filter(hasCoords).slice(0,550);
  for(const e of points){const mag=n(e.magnitude),size=mag===null?10:Math.max(9,Math.min(24,6+mag*2.1));const selected=e.id===state.selected;
    const icon=L.divIcon({className:'leaflet-custom-pin',html:`<div class="quakepin ${mStyle(mag)} ${selected?'selected':''}" style="width:${size}px;height:${size}px"></div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
    const marker=L.marker([e.latitude,e.longitude],{icon,title:e.location}).addTo(state.layer);
    marker.on('click',()=>selectEvent(e.id,false));state.markers.set(e.id,marker);
  }
}
function detailEvent(){const e=state.data?.events.find(x=>x.id===state.selected);if(!e){$('selectedEvent').innerHTML='<div class="selection-empty">목록이나 지도에서 지진을 선택하면 자세한 정보가 나타납니다.</div>';return;}
  const m=n(e.magnitude),dep=n(e.depthKm),url=validSourceUrl(e.url);
  $('selectedEvent').innerHTML=`<div class="selection-head"><strong>${esc(e.location)}</strong><span class="tag">${esc(e.source)}</span></div><div class="detail-grid"><div><small>규모 (Magnitude)</small><b>${m===null?'미제공':'M '+m.toFixed(1)}</b></div><div><small>진원 깊이</small><b>${dep===null?'미제공':dep+' km'}</b></div><div><small>발생시각 · 한국시간</small><b>${esc(isoTime(e.occurredAt))}</b></div><div><small>발표/갱신 시각 · 한국시간</small><b>${esc(isoTime(e.reportedAt))}</b></div><div><small>진앙 좌표</small><b>${hasCoords(e)?e.latitude.toFixed(3)+', '+e.longitude.toFixed(3):'미제공'}</b></div><div><small>${esc(e.intensityScale||'발표 최대진도')}</small><b>${esc(e.maxIntensity||'미제공')}</b></div></div>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">기관 발표 원문 / 안내 보기 ↗</a>`:''}<div class="detail-note">발표 종류: ${esc(e.bulletinType)}${e.cancelled?' (취소 표기)':''}. 출처별 자료는 동일한 지진을 각각 발표할 수 있습니다.</div>`;
}
function selectEvent(id,pan=true){state.selected=id;renderEvents();renderMap();detailEvent();const e=state.data?.events.find(x=>x.id===id);if(pan&&e&&hasCoords(e)&&state.map)state.map.flyTo([e.latitude,e.longitude],Math.max(state.map.getZoom(),6),{duration:.4});}
function update(){if(!state.data)return;state.filtered=filters();renderSources();renderStats();renderEvents();renderMap();detailEvent();}
function getWatch(){const place=$('placeSelect').value, parts=place==='custom'?[Number($('watchLat').value),Number($('watchLon').value)]:place.split(',').map(Number);if(parts.length!==2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1])||Math.abs(parts[0])>90||Math.abs(parts[1])>180)return null;
  if(place==='custom'&&(!$('watchLat').value.trim()||!$('watchLon').value.trim()))return null;
  return {lat:parts[0],lon:parts[1],radius:Number($('watchRadius').value),min:Number($('watchMag').value)};
}
function saveWatch(){try{localStorage.setItem('gq_watch_v1',JSON.stringify({place:$('placeSelect').value,lat:$('watchLat').value,lon:$('watchLon').value,radius:$('watchRadius').value,min:$('watchMag').value,notify:$('notifyToggle').checked}));}catch{}updateWatchMarker();}
function restoreWatch(){try{const x=JSON.parse(localStorage.getItem('gq_watch_v1')||'null');if(!x)return;for(const [key,id]of [['place','placeSelect'],['radius','watchRadius'],['min','watchMag']])if(x[key]!==undefined&&[...$(id).options].some(o=>o.value===String(x[key])))$(id).value=String(x[key]);$('watchLat').value=x.lat||'';$('watchLon').value=x.lon||'';$('notifyToggle').checked=!!x.notify;}catch{}updateCustom();}
function updateCustom(){$('customCoords').hidden=$('placeSelect').value!=='custom';saveWatch();}
function updateWatchMarker(){if(state.fallback){fallbackDraw();return;}if(!state.map)return;if(state.watchMarker)state.map.removeLayer(state.watchMarker);const w=getWatch();if(!w)return;const size=11;state.watchMarker=L.marker([w.lat,w.lon],{icon:L.divIcon({className:'leaflet-custom-pin',html:`<div class="watchpin" style="width:${size}px;height:${size}px"></div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]}),title:'관심 지역'}).addTo(state.map).bindPopup('관심 지역 · 반경 '+w.radius+'km, M '+w.min.toFixed(1)+' 이상');}
function matchesWatch(e){const w=getWatch(),mag=n(e.magnitude);return w&&hasCoords(e)&&mag!==null&&!e.cancelled&&mag>=w.min&&distance({lat:e.latitude,lon:e.longitude},w)<=w.radius;}
function newRecords(payload){const entries=payload.events||[];const fresh=[];
  for(const e of entries){if(!state.known.has(e.id)&&state.initialized&&matchesWatch(e)){
      const occurred=new Date(e.occurredAt).getTime(),reported=e.reportedAt?new Date(e.reportedAt).getTime():occurred;
      // Publication may have been updated after origin time. No alert for old backfills.
      const mostRecent=Math.max(occurred,reported);
      if(Number.isFinite(mostRecent)&&Date.now()-mostRecent<20*60000&&mostRecent<Date.now()+60000)fresh.push(e);
    }
    state.known.add(e.id);
  }
  state.initialized=true;
  if(!fresh.length||!$('notifyToggle').checked)return;
  const top=fresh.sort((a,b)=>(b.magnitude??-99)-(a.magnitude??-99))[0];
  toast('관심 지역 새 지진 발표 '+fresh.length+'건 · '+top.source+' M'+top.magnitude+' '+top.location);
  if('Notification' in window&&Notification.permission==='granted'){
    try{new Notification('GEOQUAKE · 새 지진 발생정보 (공식 조기경보 아님)',{body:`${top.source} · M ${top.magnitude} · ${top.location}`,tag:'gq-'+top.id});}catch{}
  }
}
// The Railway API is the only source of live data. The old static JSON is not a fallback.
function validSnapshot(data){
  return data && data.schemaVersion==='1.0' && Array.isArray(data.events)
    && data.sources && typeof data.sources==='object'
    && ['KMA','JMA','USGS'].every(key=>data.sources[key] && typeof data.sources[key].state==='string')
    && data.events.every(event=>event && typeof event.id==='string' && event.id.length>0 &&
      ['KMA','JMA','USGS'].includes(event.source) && typeof event.occurredAt==='string');
}
function receiveSnapshot(data){
  if(!validSnapshot(data))throw Error('Railway 응답 형식 불일치');
  const prevTime=state.data?.generatedAt && Date.parse(state.data.generatedAt);
  const nextTime=data.generatedAt && Date.parse(data.generatedAt);
  // Never replace newer live data with an older HTTP response that arrives later.
  if(Number.isFinite(prevTime)&&Number.isFinite(nextTime)&&nextTime<prevTime)return;
  newRecords(data);
  state.data=data;
  state.lastReceivedAt=Date.now();
  if(state.selected&&!data.events.some(event=>event.id===state.selected))state.selected=null;
  update();
  if(!state.selected&&state.filtered.length)selectEvent(state.filtered[0].id,false);
}
let fetching=false;
async function refresh(){if(fetching)return;fetching=true;$('reloadBtn').disabled=true;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    let response;
    try{response=await fetch(EVENTS_URL,{cache:'no-store',mode:'cors',signal:controller.signal});}
    finally{clearTimeout(timeout);}
    if(!response.ok)throw Error('HTTP '+response.status);
    receiveSnapshot(await response.json());
  }catch(err){
    if(state.transport!=='live'){
      $('globalStatus').textContent='Railway 서버 연결 실패 · 재시도 중';
      document.querySelector('.livepoint').className='livepoint bad';
    }
    if(!state.data)$('eventList').innerHTML='<div class="empty">Railway 서버에 연결할 수 없습니다.<br>잠시 후 자동으로 재시도하며 기존 정적 자료로 대체하지 않습니다.</div>';
    console.warn('GEOQUAKE API:',err.message);
  }finally{fetching=false;$('reloadBtn').disabled=false;}
}
function scheduleReconnect(){
  if(state.reconnectTimer!==null)return;
  const delay=Math.min(RECONNECT_LIMIT_MS,1000*2**Math.min(state.reconnectAttempt,5));
  state.reconnectAttempt+=1;
  state.reconnectTimer=setTimeout(()=>{state.reconnectTimer=null;connectSocket();},delay);
}
function connectSocket(){
  if(state.socket && (state.socket.readyState===WebSocket.OPEN || state.socket.readyState===WebSocket.CONNECTING))return;
  if(!('WebSocket' in window)){
    state.transport='http';if(state.data)renderSources();return;
  }
  state.transport=state.reconnectAttempt?'reconnecting':'connecting';
  if(state.data)renderSources();
  let socket;
  try{socket=new WebSocket(SOCKET_URL);}catch(err){state.transport='reconnecting';scheduleReconnect();return;}
  state.socket=socket;
  socket.onopen=()=>{
    if(state.socket!==socket)return;
    state.transport='live';state.reconnectAttempt=0;
    if(state.data)renderSources();
  };
  socket.onmessage=event=>{
    if(state.socket!==socket)return;
    try{const message=JSON.parse(event.data);
      if(message?.type==='snapshot')receiveSnapshot(message.data);
    }catch(err){console.warn('GEOQUAKE WebSocket message:',err.message);}
  };
  socket.onclose=()=>{
    if(state.socket!==socket)return;
    state.socket=null;state.transport='reconnecting';
    if(state.data)renderSources();
    scheduleReconnect();
  };
  socket.onerror=()=>{
    // The close event schedules reconnect; errors do not require a second timer.
    if(state.socket===socket)socket.close();
  };
}
function escapeCSV(x){let v=x==null?'':String(x);if(/^[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function csv(){const cols=['source','agencyEventId','occurredAt','reportedAt','location','magnitude','depthKm','latitude','longitude','maxIntensity','intensityScale','bulletinType'];const content=['\uFEFF'+cols.join(','),...state.filtered.map(e=>cols.map(c=>escapeCSV(e[c])).join(','))].join('\r\n');const blob=new Blob([content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='GEOQUAKE_KOREA_발생기록.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function bind(){for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>tab(b.dataset.tab);
  for(const id of ['regionSelect','sourceSelect','magnitudeSelect'])$(id).addEventListener('change',update);
  $('searchInput').addEventListener('input',update);$('reloadBtn').onclick=()=>refresh();
  $('resetFilters').onclick=()=>{$('regionSelect').value='eastasia';$('sourceSelect').value='ALL';$('magnitudeSelect').value='-2';$('searchInput').value='';update();};
  $('csvBtn').onclick=()=>{if(!state.data)return;csv();};
  $('eventList').onclick=e=>{const b=e.target.closest('[data-eid]');if(b)selectEvent(b.dataset.eid);};
  $('placeSelect').onchange=updateCustom;
  for(const id of ['watchLat','watchLon','watchRadius','watchMag'])$(id).addEventListener('change',saveWatch);
  $('notifyToggle').onchange=()=>{saveWatch();$('notifyStatus').textContent=$('notifyToggle').checked?'활성화 · 열려 있는 페이지에서 새 발표를 확인합니다.':'알림 꺼짐';};
  $('notifyPermission').onclick=async()=>{if(!('Notification' in window))return toast('이 브라우저는 데스크톱 알림을 지원하지 않습니다.');if(!window.isSecureContext)return toast('HTTPS 환경에서 권한을 요청해 주세요.');const result=await Notification.requestPermission();$('notifyStatus').textContent=result==='granted'?'브라우저 알림 허용됨 · 새 자료가 감지되면 알립니다.':'알림 권한: '+result;};
}
function init(){bind();restoreWatch();mapSetup();updateWatchMarker();refresh();connectSocket();setInterval(refresh,FALLBACK_POLL_MS);setInterval(()=>{if(state.data)renderSources();},30000);setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});},1000);tab(['lab','guide'].includes(location.hash.slice(1))?location.hash.slice(1):'monitor');}
init();
})();
