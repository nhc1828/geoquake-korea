/* GEOQUAKE KOREA 3.0 -- LIVE console UX. Does not generate or relay official EEW. */
'use strict';
(() => {
const Core=window.GQ3Core;
if(!Core)throw Error('GQ3Core missing');
const $=id=>document.getElementById(id);
const state={event:null,history:false,connected:false,lastSnapshot:0,wsRtt:null,lastPing:0,pingTimer:null,
  soundEnabled:false,audio:null,volume:0.45,watch:'korea',minimum:4.0,radius:500,
  details:false,noticeLog:[],dedupe:[],silencedUntil:0};
const now=()=>Date.now();
const kst=value=>Core.timestamp(value,'ko');
const isValid=e=>e&&typeof e.id==='string'&&['KMA','JMA','USGS'].includes(e.source);
function put(id,value){const el=$(id);if(el)el.textContent=value??'—';}
function safeStore(){try{localStorage.setItem('gq3_config',JSON.stringify({volume:state.volume,watch:state.watch,minimum:state.minimum,radius:state.radius}));}catch{}}
function loadSettings(){try{const saved=JSON.parse(localStorage.getItem('gq3_config')||'null');if(!saved)return;
  if(Object.hasOwn(Core.WATCH,saved.watch))state.watch=saved.watch;
  if([2.5,3,4,4.5,5,6].includes(saved.minimum))state.minimum=saved.minimum;
  if([150,300,500,1000].includes(saved.radius))state.radius=saved.radius;
  if(typeof saved.volume==='number'&&saved.volume>=0&&saved.volume<=1)state.volume=saved.volume;
}catch{}}
function setLinkState(connected){state.connected=connected;const indicator=$('gq3Link');indicator.dataset.connected=String(connected);
  indicator.textContent=connected?'WebSocket 연결':'재접속·HTTP 대기';
  if(!connected)put('gq3Rtt','왕복 지연 측정 대기');
}
function refreshAge(){if(!state.lastSnapshot){put('gq3Fresh','자료 수신 전');return;}
  const seconds=Math.floor(Math.max(0,now()-state.lastSnapshot)/1000);
  put('gq3Fresh',seconds>180?`자료 수신 지연 ${seconds}초`:`마지막 수신 ${seconds}초 전`);
  $('gq3Fresh').dataset.stale=String(seconds>180);
}
function receiveSnapshot(payload){const data=payload?.data;if(!data||!Array.isArray(data.events))return;
  state.lastSnapshot=now();refreshAge();
  const text=['KMA','JMA','USGS'].map(key=>{const s=data.sources?.[key];const v=s?.state;
    return key+' '+(v==='ok'?'●':v==='error'?'×':v==='unconfigured'?'키 없음':'○');});
  put('gq3Sources',text.join('  ·  '));
  if(state.event){const updated=data.events.find(e=>e.id===state.event.id);if(updated && updated.updatedAt!==state.event.updatedAt){state.event=updated;paintCard();}}
}
function numeric(v){return typeof v==='number'&&Number.isFinite(v);}
function setBadge(text,kind='bulletin'){put('gq3RibbonKind',text);$('gq3Ribbon').dataset.kind=kind;}
function updateRibbon(){const e=state.event;
  if(!e){setBadge('대기','waiting');put('gq3RibbonTitle','실제 발표정보를 선택하면 3개 언어로 표시합니다');put('gq3RibbonSource','수신 중');return;}
  setBadge(Core.typeOf(e)==='correction'?'정정·취소 발표':'발생정보','bulletin');
  put('gq3RibbonTitle',`${e.source} · ${e.magnitude==null?'규모 미상':'M '+Number(e.magnitude).toFixed(1)} · ${String(e.location||'위치 미상')}`);
  put('gq3RibbonSource',e.reportedAt?`발표 ${kst(e.reportedAt)}`:'발표시각 미제공');
}
function paintCard(){updateRibbon();const e=state.event;
  for(const locale of ['ko','en','ja']){
    const v=Core.cardData(e,locale),prefix='gq3-'+locale+'-';
    for(const key of ['time','place','mag','agency','issued','state'])put(prefix+key,e?v[key]:'—');
    const meta=$(prefix+'note');if(meta)meta.textContent=e?(v.placeOriginal?v.labels.raw+' · ':'')+v.labels.official:v.labels.model;
  }
  const extra=$('gq3Delay');
  if(!e){extra.textContent='기관 발표→서버 수신: 자료 선택 후 확인';return;}
  if(e.reportedAt && e.serverFirstSeenAt){const d=Date.parse(e.serverFirstSeenAt)-Date.parse(e.reportedAt);
    extra.textContent=Number.isFinite(d)&&d>=0&&d<=3600_000?`발표→서버 첫 수신 약 ${(d/1000).toFixed(1)}초 · 보장 수치 아님`:'발표→수신 지연: 측정 불가';
  }else extra.textContent='발표→수신 지연: 발표시각 또는 첫 수신시각 미제공';
}
function makeEntry(e,kind){return {id:e.id,source:e.source,location:String(e.location||'위치 미상').slice(0,100),magnitude:e.magnitude,receivedAt:new Date().toISOString(),kind};}
function noteLog(entry){state.noticeLog.unshift(entry);state.noticeLog=state.noticeLog.slice(0,25);
  const node=$('gq3LogEntries');node.replaceChildren();
  for(const item of state.noticeLog){const row=document.createElement('div');row.className='gq3-logrow';
    const type=document.createElement('b');type.textContent=item.kind==='watch'?'관심 지역 발표':item.kind==='test'?'사용자 테스트':'일반 발표';
    const detail=document.createElement('span');detail.textContent=`${item.source} · M${numeric(item.magnitude)?item.magnitude.toFixed(1):'—'} · ${item.location}`;
    const time=document.createElement('small');time.textContent=Core.timestamp(item.receivedAt,'ko');
    row.append(type,detail,time);node.append(row);
  }
}
function alertFor(entries){const recent=(entries||[]).filter(e=>isValid(e)&&Core.isNewEnough(e)).sort((a,b)=>Date.parse(b.reportedAt||b.occurredAt)-Date.parse(a.reportedAt||a.occurredAt));
  for(const event of recent){if(state.dedupe.some(old=>Core.sameQuake(old,event)))continue;
    state.dedupe.push(event);state.dedupe=state.dedupe.slice(-40);
    const match=Core.matchesWatch(event,state.watch,state.minimum,state.radius),kind=match?'watch':'info';
    noteLog(makeEntry(event,kind));
    if(!match)continue;
    if(state.history||document.hidden){put('gq3LastAlert','관심 지역 새 발표 · 화면 복귀 시 확인');continue;}
    const eSource=event.source||'기관';
    put('gq3LastAlert',`관심 지역 새 발표 · ${eSource} M${event.magnitude.toFixed(1)} · ${event.location} · 공식 조기경보 아님`);
    if(state.soundEnabled&&now()>state.silencedUntil)playSound('watch');
  }
}
function buildAudio(){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;
  if(!state.audio)state.audio=new Ctx();return state.audio;
}
function tone(ctx,frequency,start,length,level){const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type='sine';osc.frequency.setValueAtTime(frequency,start);
  gain.gain.setValueAtTime(0,start);
  const amplitude=Math.min(0.12,Math.max(0,state.volume*0.08*level));
  gain.gain.linearRampToValueAtTime(amplitude,start+0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001,start+length);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(start);osc.stop(start+length+0.01);
}
function playSound(type){const ctx=buildAudio();if(!ctx||ctx.state!=='running')return false;
  const t=ctx.currentTime+0.02;
  if(type==='watch')[[660,0,0.19],[880,0.26,0.21],[660,0.58,0.27]].forEach(([f,d,l])=>tone(ctx,f,t+d,l,1));
  else if(type==='test')[[610,0,0.13],[810,0.18,0.18]].forEach(([f,d,l])=>tone(ctx,f,t+d,l,0.8));
  else [[540,0,0.16]].forEach(([f,d,l])=>tone(ctx,f,t+d,l,0.6));
  return true;
}
async function toggleSound(){if(state.soundEnabled){state.soundEnabled=false;state.silencedUntil=now()+1200;updateSound();return;}
  const ctx=buildAudio();if(!ctx){put('gq3SoundStatus','이 브라우저는 Web Audio를 지원하지 않습니다.');return;}
  try{await ctx.resume();state.soundEnabled=ctx.state==='running';updateSound();if(state.soundEnabled)playSound('test');}
  catch{put('gq3SoundStatus','브라우저 소리 권한을 확인해 주세요.');}
}
function updateSound(){const b=$('gq3Sound');b.setAttribute('aria-pressed',String(state.soundEnabled));b.textContent=state.soundEnabled?'🔔 경보음 켜짐':'🔕 경보음 끔';
  put('gq3SoundStatus',state.soundEnabled?'관심 지역 조건을 만족하는 새 발표에만 재생 · 앱이 열려 있을 때 작동':'사용자 클릭으로 활성화 필요 · 실제 긴급경보 음향 아님');
}
function sendPing(){const socket=window.GQLive?.socket;if(!socket||socket.readyState!==WebSocket.OPEN)return;
  const ts=now();state.lastPing=ts;socket.send(JSON.stringify({type:'ping',clientSent:ts}));
}
function handlePong(info){const sent=info?.clientSent;if(!numeric(sent)||sent!==state.lastPing)return;
  const elapsed=Math.max(0,now()-sent);state.wsRtt=elapsed;
  put('gq3Rtt',`서버 왕복 ${elapsed} ms`);
}
function makeLabels(){const rows=['time','place','mag','agency','issued','state'];
  for(const locale of ['ko','en','ja']){
    const d=Core.cardData(null,locale),root=$('gq3Card-'+locale);root.replaceChildren();
    const title=document.createElement('div');title.className='gq3-card-title';title.textContent=d.title;
    const list=document.createElement('dl');list.className='gq3-detail-list';
    for(const id of rows){const label=document.createElement('dt');label.textContent=d.labels[id];const value=document.createElement('dd');value.id='gq3-'+locale+'-'+id;value.textContent='—';value.dataset.key=id;
      list.append(label,value);
    }
    const note=document.createElement('p');note.id='gq3-'+locale+'-note';note.className='gq3-original-note';
    root.append(title,list,note);
  }
}
function updateDetails(){const open=state.details;const tri=$('gq3Tri');tri.classList.toggle('expanded',open);
  $('gq3Expand').textContent=open?'요약 접기':'발표 상세 펼치기';$('gq3Expand').setAttribute('aria-expanded',String(open));
}
function bind(){
  loadSettings();makeLabels();paintCard();
  $('gq3Watch').value=state.watch;$('gq3Minimum').value=String(state.minimum);$('gq3Radius').value=String(state.radius);
  $('gq3Volume').value=String(Math.round(state.volume*100));
  $('gq3Watch').onchange=()=>{state.watch=$('gq3Watch').value;safeStore();};
  $('gq3Minimum').onchange=()=>{state.minimum=Number($('gq3Minimum').value);safeStore();};
  $('gq3Radius').onchange=()=>{state.radius=Number($('gq3Radius').value);safeStore();};
  $('gq3Volume').oninput=()=>{state.volume=Number($('gq3Volume').value)/100;safeStore();};
  $('gq3Sound').onclick=toggleSound;
  $('gq3Test').onclick=async()=>{const ctx=buildAudio();if(!ctx)return;
    try{await ctx.resume();playSound('test');noteLog({id:'test',source:'TEST',location:'사용자가 실행한 알림음 테스트 · 실제 지진 아님',magnitude:null,receivedAt:new Date().toISOString(),kind:'test'});put('gq3LastAlert','소리 테스트 실행 · 실제 지진정보 아님');}
    catch{put('gq3SoundStatus','알림음 재생이 제한되었습니다.');}
  };
  $('gq3Expand').onclick=()=>{state.details=!state.details;updateDetails();};
  $('gq3LogToggle').onclick=()=>{$('gq3LogBox').hidden=!$('gq3LogBox').hidden;};
  $('gq3LogClose').onclick=()=>{$('gq3LogBox').hidden=true;};
  updateSound();updateDetails();
  window.addEventListener('gq-live-transport',e=>{setLinkState(e.detail?.state==='connected');if(state.connected)sendPing();});
  window.addEventListener('gq-live-pong',e=>handlePong(e.detail));
  window.addEventListener('gq-live-snapshot',e=>receiveSnapshot(e.detail));
  window.addEventListener('gq-live-selected',e=>{state.event=e.detail?.event||null;state.history=Boolean(e.detail?.history);paintCard();});
  window.addEventListener('gq-live-new',e=>alertFor(e.detail?.events));
  const live=window.GQLive;
  if(live?.snapshot)receiveSnapshot({data:live.snapshot});
  if(live?.selected){state.event=live.selected;state.history=live.historyMode;paintCard();}
  setLinkState(Boolean(live?.socket?.readyState===WebSocket.OPEN));
  if(state.connected)sendPing();
  setInterval(()=>{refreshAge();if(state.connected)sendPing();},15000);
  setInterval(()=>{if(state.lastPing && state.connected && state.wsRtt===null && now()-state.lastPing>40_000)put('gq3Rtt','지연 계측 응답 없음');},10000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
window.GQ3Console={state,alertFor,paintCard};
})();
