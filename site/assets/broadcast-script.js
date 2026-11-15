/* GEOQUAKE KOREA 4.3 — scripted earthquake audio.
 * User-provided Korean wording is preserved. Square-bracket placeholders alone
 * are populated from the selected record; announcements are repeated twice.
 * Real full warning speech is deliberately NOT wired to routine USGS/KMA/JMA551
 * quake bulletins; only verified EEW may invoke it in a future integration.
 */
(function(root){
'use strict';
const EXACT = {
 real: [
  '긴급 지진속보입니다.',
  '조금 전 [발생 시각], [진앙 위치]에서 규모 [지진 규모]의 지진이 발생했습니다.',
  '지진이 발생한 지역과 인근 주민 여러분께서는 강한 흔들림에 주의하십시오.',
  '진도 [높은 진도] 이상의 흔들림이 예상되는 지역은 [높은 진도 행정구역]입니다. 진도 [낮은 진도] 이상의 흔들림이 예상되는 지역은 [낮은 진도 행정구역]입니다.'
 ],
 training: [
  '훈련상황, 훈련상황 훈련 긴급 지진속보입니다.',
  '조금 전 [발생 시각], [진앙 위치]에서 규모 [지진 규모]의 지진이 발생했습니다.',
  '진도 [높은 진도] 이상의 흔들림이 예상되는 지역은 [높은 진도 행정구역]입니다.',
  '진도 [낮은 진도] 이상의 흔들림이 예상되는 지역은 [낮은 진도 행정구역]입니다 지진이 발생한 지역과 인근 주민 여러분께서는 강한 흔들림에 주의하십시오.',
  '본 방송은 지진 대응 모의훈련을 위한 방송으로 실제 지진 발생 상황이 아닙니다. 실제 지진 발생 상황이 아닙니다.'
 ]
};
const JMA=['0','1','2','3','4','5약','5강','6약','6강','7'];
const between=(n,a,b)=>Math.min(b,Math.max(a,n));
function kstTime(iso){const date=new Date(iso);if(!Number.isFinite(date.getTime()))return null;
 return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:false}).format(date).replace(/\s/g,'');
}
function cleanPlace(s){return String(s??'').trim().slice(0,100)}
function fill(kind,data){if(!EXACT[kind]||!data)return null;
 const fields={
  '[발생 시각]':kstTime(data.occurredAt),
  '[진앙 위치]':cleanPlace(data.location),
  '[지진 규모]':typeof data.magnitude==='number'&&Number.isFinite(data.magnitude)?data.magnitude.toFixed(1):null,
  '[높은 진도]':data.highIntensity,
  '[높은 진도 행정구역]':Array.isArray(data.highAreas)&&data.highAreas.length?data.highAreas.slice(0,3).join(', '):null,
  '[낮은 진도]':data.lowIntensity,
  '[낮은 진도 행정구역]':Array.isArray(data.lowAreas)&&data.lowAreas.length?data.lowAreas.slice(0,3).join(', '):null
 };
 if(Object.values(fields).some(x=>typeof x!=='string'||!x.trim()))return null;
 const paragraphs=EXACT[kind].map(p=>Object.entries(fields).reduce((s,[key,value])=>s.replaceAll(key,value),p));
 return {kind,title:kind==='training'?'훈련 긴급 지진속보':'긴급 지진속보',paragraphs,text:paragraphs.join('\n\n'),repeats:2,tonesPerRepeat:3};
}
function fromSimulation(run,predict){
 if(!run?.origin||!Array.isArray(run.arrivals)||typeof predict!=='function')return null;
 const nearestCode=run.firstStation?.id?.startsWith('JP-')?'JP':'KR';
 const side=(run.origin.lon>=129.6&&run.origin.lon<=150&&run.origin.lat>=20&&run.origin.lat<=47)?'JP':'KR';
 const preferred=run.arrivals.some(p=>p.sensor&&p.id.startsWith(side+'-'))?side:nearestCode;
 const ranked=run.arrivals.filter(p=>p.sensor&&p.id.startsWith(preferred+'-')).map(p=>({point:p,estimate:predict(run.origin,p)}))
   .filter(p=>p.estimate&&Number.isInteger(p.estimate.index)).sort((a,b)=>b.estimate.index-a.estimate.index||a.point.id.localeCompare(b.point.id));
 if(!ranked.length)return null;
 const high=ranked[0].estimate.index;
 // Second tier uses the next lower actually represented level where available.
 const lowerObserved=ranked.map(x=>x.estimate.index).find(v=>v<high);
 const low=Math.max(preferred==='JP'?0:1,lowerObserved??high-1);
 const intensity=i=>preferred==='JP'?'JMA '+(JMA[i]??String(i)):'MMI '+i;
 const areas=min=>ranked.filter(p=>p.estimate.index>=min).slice(0,3).map(p=>p.point.short||p.point.name||p.point.id);
 return {occurredAt:run.origin.occurredAt||new Date().toISOString(),location:run.origin.name,magnitude:run.origin.magnitude,
  highIntensity:intensity(high),lowIntensity:intensity(low),highAreas:areas(high),lowAreas:areas(low),model:true};
}
let generation=0;
let activeVoices=[];
const pendingSpeech=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pickVoice(){try{const voices=root.speechSynthesis?.getVoices?.()||[];return voices.find(v=>v.lang?.toLowerCase()==='ko-kr'&&/female|여성|yuna|sora/i.test(v.name))||voices.find(v=>v.lang?.toLowerCase().startsWith('ko'))||null}catch{return null}}
function stop(){generation++;
 try{root.speechSynthesis?.cancel?.()}catch{}
 for(const o of activeVoices){try{o.stop(0)}catch{}}
 activeVoices=[];
 for(const complete of [...pendingSpeech])complete();
 pendingSpeech.clear();
}
function toneBurst(ctx,type='training'){
 if(!ctx||ctx.state!=='running')return Promise.resolve();
 // Three original short alternating-tone alerts, not a copied government EEW chime.
 const tripleLength=2400;
 const start=ctx.currentTime+.025;
 const f=type==='training'?[680,890]:[790,980];
 for(let k=0;k<3;k++){
  for(let j=0;j<2;j++){
   const at=start+k*.77+j*.25;
   const oscillator=ctx.createOscillator(),gain=ctx.createGain();
   oscillator.type=j?'sine':'triangle';oscillator.frequency.value=f[j];
   gain.gain.setValueAtTime(.0001,at);
   gain.gain.exponentialRampToValueAtTime(.038,at+.025);
   gain.gain.setValueAtTime(.038,at+.18);
   gain.gain.exponentialRampToValueAtTime(.0001,at+.24);
   oscillator.connect(gain);gain.connect(ctx.destination);
   oscillator.start(at);oscillator.stop(at+.25);
   activeVoices.push(oscillator);oscillator.onended=()=>{activeVoices=activeVoices.filter(x=>x!==oscillator)};
  }
 }
 return delay(tripleLength);
}
function speakParagraph(text,token){return new Promise(resolve=>{
 const synth=root.speechSynthesis;
 if(!synth||!root.SpeechSynthesisUtterance||token!==generation){resolve();return;}
 let finished=false;
 const done=()=>{if(finished)return;finished=true;pendingSpeech.delete(done);resolve()};
 pendingSpeech.add(done);
 try{
  const u=new root.SpeechSynthesisUtterance(text);
  u.lang='ko-KR';u.rate=1.04;u.pitch=1;u.volume=.9;
  const v=pickVoice();if(v)u.voice=v;
  u.onend=done;u.onerror=done;
  synth.speak(u);
 }catch{done()}
});}
async function perform(script,{ctx=null,voice=true,sound=true,onStage=()=>{}}={}){
 if(!script)return false;
 stop();const token=generation;
 for(let repeat=1;repeat<=2;repeat++){
  if(token!==generation)return false;
  onStage(`방송 ${repeat}/2 · 경고음`,repeat);
  if(sound){await toneBurst(ctx,script.kind)}
  if(token!==generation)return false;
  onStage(`방송 ${repeat}/2 · 음성 안내`,repeat);
  if(voice){for(const paragraph of script.paragraphs){await speakParagraph(paragraph,token);if(token!==generation)return false;}}
 }
 if(token===generation)onStage('2회 방송 완료',2);
 return token===generation;
}
const api={EXACT,fill,kstTime,fromSimulation,perform,toneBurst,stop};
root.GQBroadcast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
