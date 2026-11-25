'use strict';
(() => {
 const API='https://geoquake-korea-server-production.up.railway.app/api/hazards';
 const el=id=>document.getElementById(id);
 let data=null,volcanoes=[],coasts=null,land=null,scenario=null,lastSignature='';
 const C=window.GQHazardCore, empty=()=>({type:'FeatureCollection',features:[]});
 function realFeatures(){
  const features=[];
  const vf=data?.jmaVolcano;
  if(vf?.state==='ok')for(const item of vf.items||[]){
   const loc=volcanoes.find(v=>v.code===String(item.id));if(!loc)continue;
   features.push({type:'Feature',geometry:{type:'Point',coordinates:[loc.lon,loc.lat]},properties:{name:'일본 화산 · '+item.name,color:'#ff9855',detail:`${item.level} · 발표 ${fmt(item.issuedAt)} · 일본 기상청. 현재 상태는 원문 확인`}});
  }
  const kf=data?.kmaVolcano;
  if(kf?.state==='ok')for(const item of (kf.items||[]).slice(0,20)){
   let loc=null;
   if(/킬라우에아|kilauea/i.test(item.name||''))loc={lat:19.421,lon:-155.287}; // USGS summit location
   if(!loc)continue;
   features.push({type:'Feature',geometry:{type:'Point',coordinates:[loc.lon,loc.lat]},properties:{name:'한국 기상청 화산 발표 · '+item.name,color:'#ffbb67',detail:`${item.title||'화산정보'} · 발표 ${fmt(item.issuedAt)} · 발표 이력, 현재 상태 미확인`}});
  }
  for(const f of C.realTsunami(data?.jmaTsunami,coasts)){
   f.properties.detail=`${f.properties.level} · ${fmt(f.properties.issuedAt)} 발표 이력 · 현재 발효 여부는 일본 기상청 원문 확인`;
   features.push(f);
  }
  return features;
 }
 function simulationChanged(){
  const sim=window.GQSimulator,active=sim?.isActive();
  if(!active){scenario=null;lastSignature='live';el('simHazardNotice').hidden=true;window.GQRealMap?.setHazardFrame({type:'FeatureCollection',features:realFeatures()});return;}
  const run=sim.state.run,shown=!!run&&sim.state.time>=run.firstP;
  const sig=JSON.stringify([active,shown,run?.eventId,run?.origin,el('simTsunami').checked,scenario,!!coasts,!!land]);
  if(sig===lastSignature)return;lastSignature=sig;
  const features=[],messages=[];
  if(run&&scenario&&shown){features.push(...scenario.features);messages.push(`훈련 · 모의 화산 특보: VEI ${scenario.vei}, 가상 화산성 지진 M ${scenario.quakeMagnitude.toFixed(1)} · 가상 영향 반경 ${scenario.radius} km`);}
  if(run&&!scenario&&el('simTsunami').checked){
   if(!coasts||!land)messages.push('훈련 · 해안 지도 수신 대기 또는 실패');
   else{const result=C.tsunami(run.origin,land,coasts);
    const msg={outside:'지원 범위 밖 · 한반도·일본 주변만 모의',land:'진앙이 육지로 분류되어 해일 모의를 실행하지 않음',below:'모의 조건 미달 · 해역 M7.0 이상, 깊이 70km 이하 필요',no_coast:'모의 조건 충족 · 표시 범위 안의 해안 구간 없음',warning:`모의 지진해일 경보 · 직선거리 ${result.radius}km 이내 연안: ${result.features.map(f=>f.properties.name).join(', ')}`,invalid:'좌표 또는 규모 확인 필요'}[result.status];
    if(shown||result.status!=='warning')messages.push('훈련 · '+msg);
    if(shown)features.push(...result.features);
   }
  }
  const notice=el('simHazardNotice');notice.textContent=messages.join(' / ')+(messages.length?' · 실제 경보·피해 예측 아님':'');notice.hidden=!messages.length;
  el('hazardTrainingResult').textContent=messages.join(' / ')||'훈련용 임의 모형입니다. 실제 화산 경보·피해 예측이 아닙니다.';
  window.GQRealMap?.setHazardFrame({type:'FeatureCollection',features});
 }
 window.GQHazards={simulationChanged,clearVolcano(){scenario=null;lastSignature=''},isVolcano:()=>!!scenario};
 const seen={jmaTsunami:null,jmaVolcano:null,kmaTsunami:null,kmaVolcano:null};
 const fmt=x=>{const d=new Date(x);return x&&Number.isFinite(d.valueOf())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(d):'시각 미제공'};
 const add=(parent,tag,text)=>{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n};
 function render(snapshot){
  data=snapshot;lastSignature='';simulationChanged();
  for(const key of ['jmaTsunami','jmaVolcano','kmaTsunami','kmaVolcano']){
   const feed=data?.[key];if(feed?.state!=='ok'||!Array.isArray(feed.items))continue;
   const ids=new Set(feed.items.map(i=>String(i.id)+'|'+String(i.issuedAt)));
   if(seen[key])for(const i of feed.items){
    const id=String(i.id)+'|'+String(i.issuedAt), age=Date.now()-Date.parse(i.issuedAt||'');
    if(!seen[key].has(id)&&Number.isFinite(age)&&age>=-120000&&age<=900000){
     el('hazardNoticeText').textContent=key==='jmaTsunami'?`일본 지진해일 ${i.cancelled?'해제':'신규'} 발표 · ${fmt(i.issuedAt)} · P2PQuake 중계`:key==='jmaVolcano'?`일본 화산 발표 변경 · ${i.name} · ${i.level} · ${fmt(i.issuedAt)}`:`한국 기상청 ${key==='kmaTsunami'?'지진해일':'화산'} 발표 · ${fmt(i.issuedAt)}`;
     el('hazardNotice').hidden=false;break;
    }
   }
   seen[key]=ids;
  }
  const box=el('hazardContent');box.replaceChildren();
  for(const [key,title] of [['kmaTsunami','한국 지진해일 통보 이력'],['kmaVolcano','한국 기상청 화산 발표'],['jmaTsunami','일본 지진해일 발표 이력'],['jmaVolcano','일본 화산 발표 현황']]){
   const section=add(box,'section','');add(section,'strong',title);const feed=data?.[key];
   if(!feed||feed.state!=='ok'){add(section,'p',feed?.state==='error'?'조회 실패 · API 권한 또는 연결 확인 필요':feed?.state==='unconfigured'?'기상청 인증키 미설정':'수신 대기 · 현재 상태 확인 불가');continue;}
   add(section,'small','최종 확인 '+fmt(feed.checkedAt));
   if(!Array.isArray(feed.items)){add(section,'p','응답 형식 오류 · 현재 상태 확인 불가');continue;}
   if(key==='kmaTsunami'||key==='kmaVolcano'){
    add(section,'p','발표 이력입니다. 현재 발효 상태는 기관 원문에서 확인하세요.');
    if(!feed.items.length)add(section,'p','조회 기간의 발표 없음 · 현재 발효 상태 미확인');
    for(const item of feed.items.slice(0,20)){
     const p=add(section,'p',`${fmt(item.issuedAt)} · ${item.title||'기관 발표'} · ${item.name||item.area||'지역 미제공'}`);
     if(key==='kmaVolcano'&&/킬라우에아|kilauea/i.test(item.name||'')){const b=add(p,'button','지도 보기');b.type='button';b.onclick=()=>window.GQRealMap?.focus(-155.287,19.421,22);}
     if(item.area&&item.name)add(section,'p','대상 지역: '+item.area);
     if(item.body)add(section,'p',item.body);if(item.remarks)add(section,'p',item.remarks);if(item.release)add(section,'p','해제 내용: '+item.release);
    }
   }else if(key==='jmaTsunami'){
    add(section,'p','최근 발표 이력입니다. 현재 발효 여부는 원문을 확인하세요.');
    if(!feed.items.length)add(section,'p','수신된 발표 이력 없음 · 현재 발효 상태 미확인');
    for(const item of feed.items.slice(0,4)){
     const p=add(section,'p',`${fmt(item.issuedAt)} · ${item.cancelled?'해제 발표':'발표'} · 일본 기상청(P2PQuake 중계)`);
     if(item.areas?.length)add(p,'span',' — '+item.areas.map(a=>`${a.name} (원문) ${a.level}`).join(', '));
    }
   }else{
    if(!feed.items.length)add(section,'p','수신 목록 비어 있음 · 원문에서 확인');
    for(const item of feed.items.slice(0,30)){const p=add(section,'p',`${item.name} · ${item.level} · ${fmt(item.issuedAt)} 발표`),loc=volcanoes.find(v=>v.code===String(item.id));if(loc){const b=add(p,'button','지도 보기');b.type='button';b.onclick=()=>window.GQRealMap?.focus(loc.lon,loc.lat,22);}}
   }
   const a=add(section,'a','기관 원문 확인 ↗');a.href=key.startsWith('kma')?'https://www.weather.go.kr/w/earthquake-volcano/recent.do':key==='jmaTsunami'?'https://www.jma.go.jp/bosai/map.html#contents=tsunami':'https://www.jma.go.jp/bosai/map.html#contents=volcano';a.target='_blank';a.rel='noopener noreferrer';
  }
 }
 async function refresh(){try{const r=await fetch(API,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();render(await r.json())}catch{render(null);el('hazardContent').prepend(document.createTextNode('재해 정보 연결 실패 · 현재 상태 확인 불가'))}}
 function init(){
  el('simVolcanoLaunch').addEventListener('click',()=>{
   const lat=Number(el('simLat').value),lon=Number(el('simLon').value),vei=Number(el('simVolcanoVei').value);
   if(!el('simLat').value.trim()||!el('simLon').value.trim()||!(scenario=C.volcano(lat,lon,vei))){el('hazardTrainingResult').textContent='훈련 · 화산 위치와 VEI를 확인하세요.';return;}
   el('simPreset').value='custom';el('simMag').value=scenario.quakeMagnitude.toFixed(1);el('simMagValue').textContent=scenario.quakeMagnitude.toFixed(1);el('simDepth').value=5;
   if(!window.GQSimulator?.start()){scenario=null;return;}lastSignature='';simulationChanged();
  });
  el('hazardNoticeClose').addEventListener('click',()=>{el('hazardNotice').hidden=true});
  Promise.allSettled(['./data/jma_volcanoes.json','./data/jma_tsunami_coast.json','./data/base_geometry.json'].map(url=>fetch(url).then(r=>{if(!r.ok)throw Error();return r.json()}))).then(([v,c,l])=>{
   if(v.status==='fulfilled')volcanoes=v.value;
   if(c.status==='fulfilled')coasts=c.value;
   if(l.status==='fulfilled')land=l.value;
   const korea=land?.features?.find(f=>f.id==='KOR');if(coasts&&korea?.geometry?.type==='Polygon')coasts.features.push({type:'Feature',properties:{name:'한국 연안(간략)',code:'KR'},geometry:{type:'LineString',coordinates:korea.geometry.coordinates[0].slice(0,14)}});
   if(!coasts||!land)el('hazardTrainingResult').textContent='해안 자료 연결 실패 · 새로고침해 주세요.';
   lastSignature='';if(data)render(data);else simulationChanged();
  });
  window.addEventListener('gq-realmap-ready',()=>{lastSignature='';simulationChanged()});
  refresh();setInterval(refresh,60000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
