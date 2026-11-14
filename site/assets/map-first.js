/* GEOQUAKE KOREA 4.0 — map-first real published earthquake monitor.
   Upstream: KMA bulletin polling / JMA 551 P2PQuake / USGS GeoJSON. NO simulated alerts. */
'use strict';
(() => {
const C=window.GQMapCore;if(!C)throw Error('GQMapCore missing');
const $=id=>document.getElementById(id);
const API='https://geoquake-korea-server-production.up.railway.app';
const WS_URL=API.replace(/^https:/,'wss:')+'/ws';
const configKey='geoquake:v4:settings';const alertStorageKey='geoquake:v4:recent-real-notices';
const state={snapshot:null,primed:false,known:new Set(),notified:new Map(),connected:false,ws:null,retry:1500,retryTimer:null,httpTimer:null,pingMs:null,lastPong:null,receivedAt:null,
  selectedId:null,heroId:null,alertId:null,detailsVisible:false,source:'ALL',focus:'eastasia',minMag:'any',autoFollow:true,observed:true,soundEnabled:false,audio:null,volume:.5,notificationEnabled:false,recentAlerts:[],
  regions:[],base:[],prefectures:[],regionStatus:'loading',lastEventListSig:'',scene:null};
const bound=(v,min,max)=>Math.max(min,Math.min(max,v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames={KMA:'한국 기상청',JMA:'일본 기상청 · P2PQuake',USGS:'미국 지질조사국'};
function persist(){try{localStorage.setItem(configKey,JSON.stringify({minMag:state.minMag,focus:state.focus,autoFollow:state.autoFollow,observed:state.observed,volume:state.volume}))}catch{}}
function restore(){try{const o=JSON.parse(localStorage.getItem(configKey)||'null');if(!o)return;
  if(['any','2.5','3','4','5','6'].includes(o.minMag))state.minMag=o.minMag;
  if(['all','eastasia','korea','japan'].includes(o.focus))state.focus=o.focus;
  if(typeof o.autoFollow==='boolean')state.autoFollow=o.autoFollow;
  if(typeof o.observed==='boolean')state.observed=o.observed;
  if(typeof o.volume==='number'&&o.volume>=0&&o.volume<=1)state.volume=o.volume;
}catch{}}
function rememberNotice(event){const key=event.id;state.notified.set(key,Date.now());if(state.notified.size>200){const first=state.notified.keys().next().value;state.notified.delete(first)}
  try{localStorage.setItem(alertStorageKey,JSON.stringify([...state.notified].slice(-150)))}catch{}}
function restoreNotices(){try{const a=JSON.parse(localStorage.getItem(alertStorageKey)||'[]');for(const [id,ts] of a){if(typeof id==='string'&&typeof ts==='number'&&Date.now()-ts<12*3600000)state.notified.set(id,ts)}}catch{}}
const map={tiles:new Map(),tileKey:'',canvas:$('mapCanvas'),ctx:$('mapCanvas').getContext('2d'),w:1000,h:700,dpr:1,cx:133,cy:0,scale:20,minScale:2,maxScale:360,dirty:true,drag:null,hits:[],chosen:null,lastPointer:null,renderTimer:0};
const rad=Math.PI/180;
const merc=lat=>Math.log(Math.tan(Math.PI/4+bound(lat,-85,85)*rad/2))/rad;
const unmerc=y=>(2*Math.atan(Math.exp(y*rad))-Math.PI/2)/rad;
map.cy=merc(36);
const project=(lon,lat)=>({x:map.w/2+(lon-map.cx)*map.scale,y:map.h/2+(map.cy-merc(lat))*map.scale});
const unproject=(x,y)=>({lon:(x-map.w/2)/map.scale+map.cx,lat:unmerc(map.cy-(y-map.h/2)/map.scale)});
function fitEastAsia(){const r=map.canvas.getBoundingClientRect();map.cx=131.5;map.cy=merc(35.6);map.scale=bound(Math.min(r.width/40,r.height/30),5,45);map.dirty=true;}
function goTo(lon,lat,zoom){if(!Number.isFinite(lon)||!Number.isFinite(lat))return;map.cx=lon;map.cy=merc(lat);if(zoom)map.scale=Math.max(map.scale,zoom);map.dirty=true;}
function zoom(factor,x=map.w/2,y=map.h/2){const p=unproject(x,y);map.scale=bound(map.scale*factor,map.minScale,map.maxScale);map.cx=p.lon-(x-map.w/2)/map.scale;map.cy=merc(p.lat)+(y-map.h/2)/map.scale;map.cx=bound(map.cx,-179,179);map.cy=bound(map.cy,-160,160);map.dirty=true;}
function drawGeometry(geometry){const ctx=map.ctx,polys=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];ctx.beginPath();for(const poly of polys)for(const ring of poly){for(let i=0;i<ring.length;i++){const p=project(ring[i][0],ring[i][1]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.closePath();}}
function drawBadge(x,y,value,fill,label){const ctx=map.ctx;textStyle();ctx.font='700 14px '+getComputedStyle(document.body).fontFamily;
  const digits=String(value),ww=Math.max(26,ctx.measureText(digits).width+14),hh=26;
  ctx.fillStyle='#0d2235dd';ctx.beginPath();ctx.roundRect(x-ww/2-1,y-hh/2-1,ww+2,hh+2,6);ctx.fill();
  ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x-ww/2,y-hh/2,ww,hh,5);ctx.fill();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#10202e';ctx.fillText(digits,x,y+1);map.hits.push({x,y,w:ww,h:hh,label});}
function textStyle(){map.ctx.textBaseline='alphabetic';map.ctx.textAlign='left';}
function observedMap(event){const list=C.observedRegions(event);return new Map(list.map(o=>[o.id,o]));}
function selectedEvent(){return state.snapshot?.events.find(e=>e.id===state.selectedId)||null}
function syncTiles(){
  if(!map.w||!map.h)return;
  const z=bound(Math.round(Math.log2(360*map.scale/256)),2,8),n=2**z,tile=360*map.scale/n,
    xc=(map.cx+180)/360*n,yc=(180-map.cy)/360*n,root=$('tileBackdrop'),wanted=new Set();
  const minX=Math.max(0,Math.floor(xc-map.w/2/tile)-1),maxX=Math.min(n-1,Math.ceil(xc+map.w/2/tile)),
    minY=Math.max(0,Math.floor(yc-map.h/2/tile)-1),maxY=Math.min(n-1,Math.ceil(yc+map.h/2/tile));
  let count=0;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    if(++count>80)break;
    const id=z+'/'+x+'/'+y;wanted.add(id);let img=map.tiles.get(id);
    if(!img){img=new Image();img.alt='';img.draggable=false;img.decoding='async';
      img.onload=()=>img.classList.add('loaded');
      img.onerror=()=>{img.remove();map.tiles.delete(id)};
      img.src='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/'+z+'/'+y+'/'+x+'.jpeg';
      map.tiles.set(id,img);root.append(img);
    }
    img.style.left=(map.w/2+(x-xc)*tile)+'px';img.style.top=(map.h/2+(y-yc)*tile)+'px';img.style.width=(tile+1)+'px';img.style.height=(tile+1)+'px';
  }
  for(const [id,img]of map.tiles)if(!wanted.has(id)){img.onload=null;img.onerror=null;img.remove();map.tiles.delete(id)}
}
function draw(){if(!map.w||!map.h)return;syncTiles();const ctx=map.ctx,w=map.w,h=map.h;ctx.clearRect(0,0,w,h);map.hits=[];
  const ocean=ctx.createRadialGradient(w*.53,h*.35,20,w*.52,h*.48,Math.max(w,h)*.9);
  ocean.addColorStop(0,'#1b334fc4');ocean.addColorStop(.58,'#12243abc');ocean.addColorStop(1,'#071523d0');ctx.fillStyle=ocean;ctx.fillRect(0,0,w,h);
  // Geographic graticule is a rendered aid, never a fabricated seismic measurement.
  ctx.lineWidth=.6;ctx.strokeStyle='#71869f20';
  for(let lon=-180;lon<=180;lon+=10){const x=project(lon,35).x;if(x>=0&&x<=w){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}}
  for(let lat=-70;lat<=80;lat+=10){const y=project(132,lat).y;if(y>=0&&y<=h){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}}
  if(state.base.length){for(const f of state.base){drawGeometry(f.geometry);ctx.fillStyle=f.id==='JPN'||f.id==='KOR'?'#273629ba':'#29342db7';ctx.fill('evenodd');ctx.lineWidth=.9;ctx.strokeStyle='#8398a6';ctx.stroke();}}
  const event=selectedEvent();const observed=state.observed&&event?observedMap(event):new Map();
  for(const f of state.prefectures){const v=observed.get(f.gqid);drawGeometry(f.geometry);ctx.fillStyle=v?C.intensityColor(v.value)+'e0':'#34464a33';ctx.fill('evenodd');ctx.strokeStyle=v?'#d3e6da':'#a4b4be6b';ctx.lineWidth=v?1.3:.62;ctx.stroke();}
  for(const [t,lon,lat] of [['대한민국',127.3,36.5],['日本',137.6,38.5],['中国',119,37.5],['東海',133,40.2],['東シナ海',126.3,29.4],['九州',131.3,32.4]]){
    const p=project(lon,lat);if(p.x>-5&&p.x<w+5&&p.y>0&&p.y<h){ctx.textAlign='center';ctx.font='500 13px '+getComputedStyle(document.body).fontFamily;ctx.lineWidth=3;ctx.strokeStyle='#112637bd';ctx.strokeText(t,p.x,p.y);ctx.fillStyle='#9bb7b6';ctx.fillText(t,p.x,p.y);}}
  // Only institution-published JMA station maxima are represented; no estimated regional intensity.
  if(state.observed&&observed.size){for(const [id,o]of observed){const region=state.regions.find(r=>r.id===id);if(!region)continue;const p=project(region.lon,region.lat);if(p.x<16||p.x>w-16||p.y<16||p.y>h-16)continue;drawBadge(p.x,p.y,o.value,C.intensityColor(o.value),region.name+' · 관측점 최고진도 JMA '+o.value);}}
  const points=getVisibleEvents();
  for(const e of points.slice(0,420)){if(!C.hasCoords(e))continue;const p=project(e.longitude,e.latitude);if(p.x<-15||p.x>w+15||p.y<-15||p.y>h+15)continue;
    const chosen=event?.id===e.id,mag=C.finite(e.magnitude)?e.magnitude:null,r=chosen?7:mag!==null?bound(mag*1.15,3,7):3;
    ctx.beginPath();ctx.arc(p.x,p.y,r+2,0,2*Math.PI);ctx.fillStyle='#081827d0';ctx.fill();
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fillStyle=chosen?'#ffdb8c':e.source==='KMA'?'#76d5c7':e.source==='JMA'?'#7bc8eb':'#eeb57d';ctx.fill();
    if(chosen){ctx.beginPath();ctx.arc(p.x,p.y,18,0,2*Math.PI);ctx.strokeStyle='#ffe1a3dd';ctx.lineWidth=1.7;ctx.stroke();ctx.beginPath();ctx.moveTo(p.x-15,p.y);ctx.lineTo(p.x-9,p.y);ctx.moveTo(p.x+9,p.y);ctx.lineTo(p.x+15,p.y);ctx.moveTo(p.x,p.y-15);ctx.lineTo(p.x,p.y-9);ctx.moveTo(p.x,p.y+9);ctx.lineTo(p.x,p.y+15);ctx.stroke();}
    map.hits.push({x:p.x,y:p.y,w:18,h:18,id:e.id});
  }
  map.dirty=false;
}
function resize(){const r=map.canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;map.w=r.width;map.h=r.height;map.dpr=Math.min(2,window.devicePixelRatio||1);map.canvas.width=Math.floor(map.w*map.dpr);map.canvas.height=Math.floor(map.h*map.dpr);map.ctx.setTransform(map.dpr,0,0,map.dpr,0,0);if(!map.chosen){fitEastAsia();map.chosen=true;}map.dirty=true;draw();}
function showTip(entry,x,y){const tip=$('mapTip');if(!entry){tip.hidden=true;return;}tip.textContent=entry.label||'';tip.style.left=bound(x+14,4,map.w-245)+'px';tip.style.top=bound(y+12,4,map.h-55)+'px';tip.hidden=false;}
function mapPick(x,y){return [...map.hits].reverse().find(p=>Math.abs(p.x-x)<=p.w/2+3&&Math.abs(p.y-y)<=p.h/2+3)}
function bindMap(){new ResizeObserver(resize).observe($('mapSurface'));
  map.canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;map.drag={x:e.clientX,y:e.clientY,cx:map.cx,cy:map.cy,moved:false};map.canvas.setPointerCapture(e.pointerId);map.canvas.classList.add('dragging');});
  map.canvas.addEventListener('pointermove',e=>{const r=map.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,p=unproject(x,y);$('coordDisplay').textContent=p.lat.toFixed(2)+'° / '+p.lon.toFixed(2)+'°';
    if(map.drag){const dx=e.clientX-map.drag.x,dy=e.clientY-map.drag.y;if(Math.hypot(dx,dy)>4)map.drag.moved=true;if(map.drag.moved){map.cx=map.drag.cx-dx/map.scale;map.cy=map.drag.cy+dy/map.scale;map.dirty=true;}$('mapTip').hidden=true;}
    else showTip(mapPick(x,y),x,y);});
  map.canvas.addEventListener('pointerup',e=>{const d=map.drag;map.drag=null;map.canvas.classList.remove('dragging');if(d&&!d.moved){const r=map.canvas.getBoundingClientRect(),h=mapPick(e.clientX-r.left,e.clientY-r.top);if(h?.id)choose(h.id,false);else if(h?.label)showTip(h,e.clientX-r.left,e.clientY-r.top);}});
  map.canvas.addEventListener('pointercancel',()=>{map.drag=null;map.canvas.classList.remove('dragging')});
  map.canvas.addEventListener('pointerleave',()=>{$('mapTip').hidden=true});
  map.canvas.addEventListener('wheel',e=>{e.preventDefault();const r=map.canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0013),e.clientX-r.left,e.clientY-r.top)},{passive:false});
  $('zoomIn').onclick=()=>zoom(1.32);$('zoomOut').onclick=()=>zoom(1/1.32);$('zoomReset').onclick=()=>{fitEastAsia();draw()};
  setInterval(()=>{if(map.dirty)draw()},80);
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
  $('heroNotice').textContent=i?'발표된 최대진도 · 지역별 자료가 있다면 해당 관측점을 표시합니다.':'공식 발표된 진앙·규모 정보 · 지역별 실측진도는 제공되지 않았습니다.';
}
function renderDetails(){const e=selectedEvent();$('eventDetail').hidden=!e||!state.detailsVisible;if(!e)return;
  $('detailTitle').textContent=e.location||'진앙 미제공';$('detailSubtitle').textContent=`${e.source} · ${e.bulletinType||'지진 발생정보'} · ${e.ingestMode==='history'?'과거 발표':'실제 발표'}`;
  $('threeLang').innerHTML=['ko','en','ja'].map(lang=>{const d=C.cardRows(e,lang);return `<section class="langcard" lang="${lang}"><h4>${d.lang}</h4>${d.rows.map(([l,v])=>`<div class="lang-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</section>`}).join('');
  const obs=C.observedRegions(e);$('detailNote').textContent=obs.length?`JMA 관측점 최고진도가 제공된 도도부현 ${obs.length}곳을 색칠합니다. 현 전체의 흔들림을 뜻하지 않습니다. 세 언어의 지명은 원문을 그대로 표시합니다.`:'지명은 기관 발표 원문입니다. 해당 사건의 지역별 검증된 관측진도는 수신 자료에 없어 임의로 색칠하지 않습니다.';
  const url=C.safeSourceUrl(e.url);$('sourceLink').hidden=!url;if(url)$('sourceLink').href=url;
}
function choose(id,follow=false){const e=state.snapshot?.events.find(a=>a.id===id);if(!e)return;state.selectedId=e.id;state.heroId=e.id;state.detailsVisible=true;
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
  displayAlert(first);playSound();notifySystem(first);
  if(state.autoFollow){state.selectedId=first.id;state.heroId=first.id;if(C.hasCoords(first))goTo(first.longitude,first.latitude,20);}
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
function mapRefGeo(feature,country){const p=feature.properties||{},str=(x)=>String(x||'').trim();
  for(const k of ['shapeISO','iso_3166_2','ISO_3166_2','iso-code']){const v=str(p[k]).toUpperCase();if(/^JP-\d\d$/.test(v)&&state.regions.some(r=>r.id===v))return v;}
  const values=[p.shapeName,p.name,p.NAME_1,p.name_en].filter(Boolean).map(s=>str(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\d]/gu,''));
  for(const r of state.regions){if(!r.id.startsWith(country))continue;const terms=[r.name,r.short,...r.aliases].map(s=>str(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\d]/gu,''));if(terms.some(s=>values.includes(s)))return r.id;}
  return null;
}
async function fetchJSON(url,timeout=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,cache:'force-cache'});if(!r.ok)throw Error('HTTP '+r.status);const obj=await r.json();return obj;}finally{clearTimeout(t)}}
async function loadMaps(){try{const [regions,base]=await Promise.all([fetchJSON('./data/region_centers.json'),fetchJSON('./data/base_geometry.json')]);if(Array.isArray(regions))state.regions=regions;if(Array.isArray(base.features))state.base=base.features;map.dirty=true;}catch{map.dirty=true;}
  // geoBoundaries gbOpen, used only for administrative boundaries. Offline failure -> truthful point indicators.
  const urls=['https://www.geoboundaries.org/api/current/gbOpen/JPN/ADM1/','https://geoboundaries-dev.org/api/current/gbOpen/JPN/ADM1/'];
  for(const url of urls){try{const meta=await fetchJSON(url,10000);const link=meta.simplifiedGeometryGeoJSON;if(!/^https:\/\//.test(link))continue;
    const data=await fetchJSON(link,20000);if(!Array.isArray(data.features)||data.features.length>250)continue;
    const features=data.features.map(f=>({...f,gqid:mapRefGeo(f,'JP')})).filter(f=>f.gqid&&['Polygon','MultiPolygon'].includes(f.geometry?.type));
    if(features.length>=35){state.prefectures=features;state.regionStatus='ready';map.dirty=true;break;}
  }catch{state.regionStatus='error';}}
  if(!state.prefectures.length)$('mapKeyNote').textContent='행정구역 경계 연결 전에는 실제 관측진도를 지역 대표점에 숫자로 표시합니다.';
}
function bind(){document.querySelectorAll('.source-filter').forEach(b=>b.onclick=()=>sourceFilter(b.dataset.source));$('eventList').onclick=e=>{const b=e.target.closest('[data-id]');if(b)choose(b.dataset.id,true)};
  $('heroDetails').onclick=()=>{const e=state.snapshot?.events.find(e=>e.id===state.heroId);if(e)choose(e.id,false)};
  $('detailClose').onclick=()=>{state.detailsVisible=false;$('eventDetail').hidden=true};
  $('alertDismiss').onclick=()=>$('newAlert').hidden=true;
  $('alertOpenDetail').onclick=()=>{if(state.alertId)choose(state.alertId,true)};
  $('refreshNow').onclick=fetchLatest;
  $('audioToggle').onclick=toggleAudio;$('audioSetting').onclick=toggleAudio;
  $('testSound').onclick=async()=>{if(!state.soundEnabled)await toggleAudio();playSound()};
  $('mapFollow').onclick=()=>{state.autoFollow=!state.autoFollow;$('mapFollow').classList.toggle('selected',state.autoFollow);$('mapFollow').setAttribute('aria-pressed',String(state.autoFollow));persist()};
  $('navObserved').onclick=()=>{state.observed=!state.observed;$('observedToggle').checked=state.observed;$('navObserved').setAttribute('aria-pressed',String(state.observed));map.dirty=true;persist()};
  $('observedToggle').onchange=()=>{state.observed=$('observedToggle').checked;$('navObserved').setAttribute('aria-pressed',String(state.observed));map.dirty=true;persist()};
  $('navSettings').onclick=()=>$('settingsDialog').showModal();$('navHelp').onclick=()=>$('helpDialog').showModal();
  $('navFullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.()};
  $('navQuakes').onclick=()=>{state.detailsVisible=false;$('eventDetail').hidden=true;$('newAlert').hidden=true;fitEastAsia()};
  $('minMag').onchange=()=>{state.minMag=$('minMag').value;persist()};$('focusRegion').onchange=()=>{state.focus=$('focusRegion').value;persist();sourceFilter(state.source)};
  $('notifyPermission').onclick=async()=>{if(typeof Notification==='undefined'||!window.isSecureContext){$('notifyPermission').textContent='브라우저 미지원';return;}try{const p=await Notification.requestPermission();state.notificationEnabled=p==='granted';$('notifyPermission').textContent=p==='granted'?'알림 허용됨':'알림 권한: '+p}catch{$('notifyPermission').textContent='권한 요청 실패'}};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)fetchLatest()});
}
function init(){restore();restoreNotices();$('minMag').value=state.minMag;$('focusRegion').value=state.focus;$('observedToggle').checked=state.observed;$('navObserved').setAttribute('aria-pressed',String(state.observed));$('mapFollow').classList.toggle('selected',state.autoFollow);$('mapFollow').setAttribute('aria-pressed',String(state.autoFollow));
  bind();bindMap();loadMaps();liveCounters();setInterval(liveCounters,1000);setInterval(fetchLatest,45000);
  setInterval(()=>{if(state.ws?.readyState===WebSocket.OPEN)try{state.ws.send(JSON.stringify({type:'ping',clientSent:Date.now()}))}catch{}},20000);
  connect();fetchLatest();}
init();window.GQMapLive={state,map,receive,select:choose,refresh:fetchLatest};
})();
