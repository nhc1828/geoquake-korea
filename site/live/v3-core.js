/* GEOQUAKE KOREA 3.0 -- pure alert classification and localization helpers. */
(function(root){
'use strict';
const LOCATIONS={
 '서울':['서울','Seoul','ソウル'], '부산':['부산','Busan','釜山'], '광주':['광주','Gwangju','光州'],
 '순천':['순천','Suncheon','順天'], '경주':['경주','Gyeongju','慶州'], '포항':['포항','Pohang','浦項'],
 '도쿄':['도쿄','Tokyo','東京'], '후쿠오카':['후쿠오카','Fukuoka','福岡'], '오사카':['오사카','Osaka','大阪'],
 '홋카이도':['홋카이도','Hokkaido','北海道'], '미야기':['미야기','Miyagi','宮城'], '이시카와':['이시카와','Ishikawa','石川']
};
const LANGUAGE={
 ko:{title:'지진 발생정보',time:'발생시각',place:'진앙',mag:'규모 / 깊이',agency:'발표기관',issued:'발표시각',state:'정보 구분',unknown:'미제공',published:'지진 발생정보',corrected:'정정 발표',cancel:'취소 발표',model:'모형 추정 · 공식 경보 아님',official:'공식 발표문 확인',raw:'원문 지명'},
 en:{title:'EARTHQUAKE INFORMATION',time:'Origin time',place:'Epicenter',mag:'Magnitude / depth',agency:'Source agency',issued:'Bulletin issued',state:'Information type',unknown:'Not provided',published:'Earthquake bulletin',corrected:'Corrected bulletin',cancel:'Cancelled bulletin',model:'Model estimate · Not an official warning',official:'Published agency information',raw:'Original place name'},
 ja:{title:'地震情報',time:'発生時刻',place:'震央',mag:'マグニチュード / 深さ',agency:'発表機関',issued:'発表時刻',state:'情報区分',unknown:'未提供',published:'地震情報',corrected:'訂正情報',cancel:'取消情報',model:'模擬推定・公式警報ではありません',official:'機関発表情報',raw:'原文地名'}
};
const AGENCIES={
 KMA:['한국 기상청','Korea Meteorological Administration','韓国気象庁'],
 JMA:['일본 기상청','Japan Meteorological Agency','気象庁（日本）'],
 USGS:['미국 지질조사국','U.S. Geological Survey','米国地質調査所']
};
const LOCALE_IDX={ko:0,en:1,ja:2};
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function timestamp(v,locale){if(!v)return LANGUAGE[locale].unknown;const d=new Date(v);if(!Number.isFinite(d.getTime()))return LANGUAGE[locale].unknown;
  const parts=new Intl.DateTimeFormat(locale==='en'?'en-GB':locale==='ja'?'ja-JP':'ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
  return parts+' UTC+09';
}
function localPlace(place,locale){const raw=String(place??'').trim();if(!raw)return {value:LANGUAGE[locale].unknown,original:false};
  // Exact dictionary lookup only. Complex place names are displayed unmodified to avoid fabricated translations.
  const item=LOCATIONS[raw];return {value:item?item[LOCALE_IDX[locale]]:raw,original:!item};
}
function bulletinType(e,locale){const l=LANGUAGE[locale];if(e?.cancelled)return l.cancel;
  if(/(정정|수정|訂正|corrected|correction)/i.test(String(e?.correctionType||'')))return l.corrected;
  return l.published;
}
function cardData(e,locale){if(!LANGUAGE[locale])throw Error('unsupported locale');const l=LANGUAGE[locale],p=localPlace(e?.location,locale);
  const magnitude=finite(e?.magnitude)?'M '+e.magnitude.toFixed(1):l.unknown;
  const depth=finite(e?.depthKm)?e.depthKm.toFixed(1)+' km':l.unknown;
  const agency=AGENCIES[e?.source]?.[LOCALE_IDX[locale]]||l.unknown;
  return {title:l.title,locale,time:timestamp(e?.occurredAt,locale),place:p.value,placeOriginal:p.original,mag:magnitude+'  /  '+depth,agency,issued:timestamp(e?.reportedAt||e?.updatedAt,locale),state:bulletinType(e,locale),labels:l};
}
function distanceKm(a,b){if(!a||!b||!finite(a.latitude)||!finite(a.longitude)||!finite(b.lat)||!finite(b.lon))return null;
  const k=Math.PI/180,dlat=(b.lat-a.latitude)*k,dlon=(b.lon-a.longitude)*k;
  const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*k)*Math.cos(b.lat*k)*Math.sin(dlon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}
const WATCH={all:null,korea:{lat:36,lon:127.8},suncheon:{lat:34.95,lon:127.49},seoul:{lat:37.5665,lon:126.978},busan:{lat:35.18,lon:129.076},tokyo:{lat:35.69,lon:139.69},fukuoka:{lat:33.59,lon:130.40}};
function matchesWatch(e,place='all',minmag=4,radius=350){if(!e||!finite(e.magnitude)||e.magnitude<minmag||e.cancelled)return false;
  const point=WATCH[place];if(!point)return place==='all';const d=distanceKm(e,point);return d!==null&&d<=radius;
}
function sameQuake(a,b){if(!a||!b)return false;const ta=Date.parse(a.occurredAt),tb=Date.parse(b.occurredAt);
  if(!Number.isFinite(ta)||!Number.isFinite(tb)||Math.abs(ta-tb)>90_000)return false;
  if(!finite(a.magnitude)||!finite(b.magnitude)||Math.abs(a.magnitude-b.magnitude)>1.0)return false;
  const d=distanceKm(a,{lat:b.latitude,lon:b.longitude});return d!==null&&d<=90;
}
function isNewEnough(e,nowMs=Date.now(),windowMs=10*60_000){if(!e||e.ingestMode==='history')return false;
  const d=Date.parse(e.reportedAt||e.updatedAt||e.occurredAt);
  return Number.isFinite(d)&&nowMs>=d-60_000&&nowMs-d<=windowMs;
}
function typeOf(e){ // No official EEW without an explicitly verified, permitted source channel.
  if(e?.cancelled||/취소|取消|cancel/i.test(String(e?.correctionType||'')))return 'correction';
  if(/정정|수정|訂正|correction/i.test(String(e?.correctionType||'')))return 'correction';
  return 'bulletin';
}
const api={LANGUAGE,AGENCIES,WATCH,cardData,localPlace,timestamp,distanceKm,matchesWatch,sameQuake,isNewEnough,typeOf};
root.GQ3Core=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
