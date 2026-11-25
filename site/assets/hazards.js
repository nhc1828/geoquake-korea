'use strict';
(() => {
 const API='https://geoquake-korea-server-production.up.railway.app/api/hazards';
 const el=id=>document.getElementById(id);
 const seen={jmaTsunami:null,jmaVolcano:null,kmaTsunami:null,kmaVolcano:null};
 const fmt=x=>{const d=new Date(x);return x&&Number.isFinite(d.valueOf())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(d):'시각 미제공'};
 const add=(parent,tag,text)=>{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n};
 function render(data){
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
     add(section,'p',`${fmt(item.issuedAt)} · ${item.title||'기관 발표'} · ${item.name||item.area||'지역 미제공'}`);
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
    for(const item of feed.items.slice(0,30))add(section,'p',`${item.name} · ${item.level} · ${fmt(item.issuedAt)} 발표`);
   }
   const a=add(section,'a','기관 원문 확인 ↗');a.href=key.startsWith('kma')?'https://www.weather.go.kr/w/earthquake-volcano/recent-eqk.do':key==='jmaTsunami'?'https://www.jma.go.jp/bosai/tsunami/':'https://www.jma.go.jp/bosai/volcano/';a.target='_blank';a.rel='noopener noreferrer';
  }
 }
 async function refresh(){try{const r=await fetch(API,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();render(await r.json())}catch{render(null);el('hazardContent').prepend(document.createTextNode('재해 정보 연결 실패 · 현재 상태 확인 불가'))}}
 function init(){
  el('hazardTraining').addEventListener('submit',e=>{e.preventDefault();const kind=el('hazardTrainingType').value,place=el('hazardTrainingPlace').value.trim()||'가상 지역',level=el('hazardTrainingLevel').value;
   el('hazardTrainingResult').textContent=`[훈련용 · 실제 발표 아님] ${place}에 모의 ${kind} ${level} 상황을 설정했습니다. 도달시간·피해 범위는 계산하지 않습니다.`;
  });
  el('hazardNoticeClose').addEventListener('click',()=>{el('hazardNotice').hidden=true});
  refresh();setInterval(refresh,60000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
