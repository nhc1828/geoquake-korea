/* GEOQUAKE KOREA 4.0: shared, testable parsing and real-announcement alert policy.
   NO fake events, synthetic intensity, artificial earthquake predictions or public EEW claim. */
(function(root){
'use strict';
const SUPPORTED = new Set(['KMA','JMA','USGS']);
const INTENSITIES = ['0','1','2','3','4','5약','5강','6약','6강','7'];
const COLORS = ['#33485f','#416b8f','#4ba7c0','#63c69c','#d6c968','#ecb654','#e98652','#e36b65','#b75bd5','#ea87d6'];
const L10N = {
  ko:{title:'지진 발표정보',origin:'발생시각',epicenter:'진앙',magnitude:'규모',depth:'깊이',agency:'발표기관',issued:'발표시각',intensity:'기관 발표 최대진도',unknown:'미제공',raw:'원문 지명',label:'한국어'},
  en:{title:'Earthquake Bulletin',origin:'Origin time',epicenter:'Epicenter',magnitude:'Magnitude',depth:'Depth',agency:'Source agency',issued:'Issue time',intensity:'Max. observed intensity',unknown:'Not provided',raw:'Original place name',label:'English'},
  ja:{title:'地震情報',origin:'発生時刻',epicenter:'震央',magnitude:'マグニチュード',depth:'深さ',agency:'発表機関',issued:'発表時刻',intensity:'最大観測震度',unknown:'情報なし',raw:'原文地名',label:'日本語'}
};
const AGENCIES={KMA:'KMA · 대한민국 기상청',JMA:'JMA · 일본 기상청 (P2PQuake 중계)',USGS:'USGS · 미국 지질조사국'};
function finite(n){return typeof n==='number'&&Number.isFinite(n)}
function hasCoords(e){return e&&finite(e.latitude)&&finite(e.longitude)&&e.latitude>=-90&&e.latitude<=90&&e.longitude>=-180&&e.longitude<=180}
function validEvent(e){return e&&typeof e.id==='string'&&e.id.length>0&&e.id.length<200&&SUPPORTED.has(e.source)&&typeof e.occurredAt==='string'&&Number.isFinite(Date.parse(e.occurredAt))}
function validSnapshot(o){return o&&o.schemaVersion==='1.0'&&o.sources&&typeof o.sources==='object'&&Array.isArray(o.events)&&o.events.length<=20000}
function dateMs(x){const n=Date.parse(x||'');return Number.isFinite(n)?n:null}
function fmtDate(iso,locale='ko'){
  const ms=dateMs(iso);if(ms===null)return L10N[locale]?.unknown||'—';
  return new Intl.DateTimeFormat(locale==='ja'?'ja-JP':locale==='en'?'en-GB':'ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(ms)+' KST';
}
function magnitudeText(e){return finite(e?.magnitude)?Number(e.magnitude).toFixed(1):'—'}
function depthText(e){return finite(e?.depthKm)?(Math.round(e.depthKm*10)/10).toString()+' km':'—'}
function normIntensity(e){
  const s=e?.maxIntensity;
  if(s===null||s===undefined||s==='')return null;
  const raw=String(s).trim();
  if(e.source==='JMA'&&INTENSITIES.includes(raw))return {value:raw,scale:'JMA',index:INTENSITIES.indexOf(raw)};
  // The KMA inT field can be a narrative; it is never a 17-region grid.
  if(e.source==='KMA'){const m=raw.normalize('NFKC').match(/(?:^|[^A-Za-z])(XII|XI|VIII|VII|III|IX|IV|VI|II|X|V|I)(?![A-Za-z])/);return m?{value:m[1],scale:'KMA 발표',index:null}:null;}
  return null;
}
function intensityColor(value){const i=INTENSITIES.indexOf(String(value));return i<0?'#405c75':COLORS[i]}
function observedRegions(e){
  if(e?.source!=='JMA'||e.observationsVerified!==true||!e.observedRegions||typeof e.observedRegions!=='object'||Array.isArray(e.observedRegions))return [];
  return Object.entries(e.observedRegions).filter(([id,ob])=>/^JP-(0[1-9]|[1-3]\d|4[0-7])$/.test(id)&&INTENSITIES.includes(String(ob&&typeof ob==='object'?ob.value:ob)))
    .map(([id,ob])=>({id,value:String(ob&&typeof ob==='object'?ob.value:ob),stations:ob&&typeof ob==='object'&&Number.isInteger(ob.stationCount)?ob.stationCount:null})).sort((a,b)=>a.id.localeCompare(b.id));
}
function ageSeconds(iso,now=Date.now()){const ms=dateMs(iso);return ms===null?null:Math.max(0,Math.round((now-ms)/1000))}
function isAlertCandidate(e,now=Date.now()){
  if(!validEvent(e)||e.cancelled===true||e.training===true||e.test===true||e.ingestMode==='history')return false;
  // KMA and JMA can only alert on newly received stream bulletins. Do not alert restored history.
  if((e.source==='KMA'||e.source==='JMA')&&e.ingestMode!=='stream')return false;
  const issued=dateMs(e.reportedAt),occurred=dateMs(e.occurredAt);
  const relevant=e.source==='USGS'?occurred:issued;
  if(relevant===null)return false;
  // Catch incoming published records but exclude delayed archive backfills/restarts.
  const gap=now-relevant;
  return gap>=-120000&&gap<=15*60000;
}
function regionMatches(e,region){
  if(region==='all')return true;
  if(!hasCoords(e)){
    // Some official JMA first intensity bulletins have measured areas but no epicenter yet.
    // They still belong to Japan / East Asia; this never fabricates a coordinate.
    if(e?.source==='JMA'&&e.bulletinTypeCode!=='Foreign'&&
       (region==='japan'||region==='eastasia'))return true;
    return false;
  }
  const lat=e.latitude,lon=e.longitude;
  if(region==='korea')return lat>=32&&lat<=43&&lon>=123&&lon<=132;
  if(region==='japan')return lat>=24&&lat<=46&&lon>=122&&lon<=148;
  if(region==='eastasia')return lat>=19&&lat<=50&&lon>=107&&lon<=155;
  return true;
}
function magMatches(e,min){
  if(min==='any')return true;
  return finite(e?.magnitude)&&e.magnitude>=Number(min);
}
function geoDistanceKm(a,b){
  if(!hasCoords(a)||!hasCoords(b))return Infinity;
  const r=Math.PI/180,dLat=(b.latitude-a.latitude)*r,dLon=(b.longitude-a.longitude)*r,
        q=Math.sin(dLat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,q))));
}
function sameQuakeCrossAgency(a,b){
  if(a?.source===b?.source||!hasCoords(a)||!hasCoords(b))return false;
  const aT=dateMs(a.occurredAt),bT=dateMs(b.occurredAt);
  if(aT===null||bT===null||Math.abs(aT-bT)>90*1000||geoDistanceKm(a,b)>55)return false;
  if(finite(a.magnitude)&&finite(b.magnitude)&&Math.abs(a.magnitude-b.magnitude)>0.8)return false;
  return true;
}
function latestSort(a,b){return (dateMs(b.occurredAt)||0)-(dateMs(a.occurredAt)||0)||(dateMs(b.reportedAt)||dateMs(b.updatedAt)||0)-(dateMs(a.reportedAt)||dateMs(a.updatedAt)||0)}
// Translate only known names. Keep unrecognized text visibly marked as the
// original instead of inventing a translation of an unfamiliar place.
const PLACE_NAMES = {
 '能登半島沖':'노토반도 해역', '石川県能登地方':'이시카와현 노토 지방',
 '熊本県天草・芦北地方':'구마모토현 아마쿠사·아시키타 지방', '房総半島南方沖':'보소반도 남쪽 해역', '浦河沖':'우라카와 해역',
 '宮城県沖':'미야기현 해역', '福島県沖':'후쿠시마현 해역', '茨城県沖':'이바라키현 해역',
 '千葉県東方沖':'지바현 동쪽 해역', '日向灘':'휴가나다 해역', '豊後水道':'분고 수도',
 '台湾付近':'대만 부근', '日本海':'동해', '東海道南方沖':'도카이도 남쪽 해역',
 'Kyushu, Japan':'일본 규슈', 'Honshu, Japan':'일본 혼슈', 'Hokkaido, Japan':'일본 홋카이도',
 'Ryukyu Islands, Japan':'일본 류큐 제도', 'South Korea':'대한민국', 'North Korea':'북한',
};
function placeKo(value){
  const raw=String(value||'').trim();if(!raw)return '진앙 미제공';
  if(/[가-힣]/.test(raw))return raw;
  if(PLACE_NAMES[raw])return PLACE_NAMES[raw];
  const match=raw.match(/^(\d+(?:\.\d+)?) km ([A-Z]+) of (.+)$/i);
  const dirs={N:'북쪽',NNE:'북북동쪽',NE:'북동쪽',ENE:'동북동쪽',E:'동쪽',ESE:'동남동쪽',SE:'남동쪽',SSE:'남남동쪽',S:'남쪽',SSW:'남남서쪽',SW:'남서쪽',WSW:'서남서쪽',W:'서쪽',WNW:'서북서쪽',NW:'북서쪽',NNW:'북북서쪽'};
  if(match&&dirs[match[2].toUpperCase()])return `${PLACE_NAMES[match[3]]||match[3]+'(원문)'} ${dirs[match[2].toUpperCase()]} ${match[1]}km`;
  return raw+' (원문)';
}

function cardRows(e,locale){
  const t=L10N[locale]||L10N.ko;
  const raw=placeKo(e?.location).slice(0,160);
  const intensity=normIntensity(e);
  return {title:t.title,lang:t.label,rows:[
    [t.origin,fmtDate(e?.occurredAt,locale)],
    [t.epicenter,raw],
    [t.magnitude,finite(e?.magnitude)?'M '+magnitudeText(e):t.unknown],
    [t.depth,finite(e?.depthKm)?depthText(e):t.unknown],
    [t.agency,AGENCIES[e?.source]||t.unknown],
    [t.issued,e?.reportedAt?fmtDate(e.reportedAt,locale):t.unknown],
    [t.intensity,intensity?intensity.scale+' '+intensity.value:t.unknown],
    ...(e?.source==='KMA'&&e?.maxIntensity? [['기상청 진도 원문',String(e.maxIntensity)]]:[]),
  ],rawNotice:t.raw};
}
function safeSourceUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&['www.jma.go.jp','earthquake.usgs.gov','apihub.kma.go.kr','www.kma.go.kr'].includes(url.hostname)?url.href:null}catch{return null}}
const api={SUPPORTED,INTENSITIES,COLORS,L10N,AGENCIES,finite,hasCoords,validEvent,validSnapshot,fmtDate,magnitudeText,depthText,normIntensity,intensityColor,observedRegions,ageSeconds,isAlertCandidate,regionMatches,magMatches,geoDistanceKm,sameQuakeCrossAgency,latestSort,placeKo,cardRows,safeSourceUrl};
root.GQMapCore=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
