/* GEOQUAKE KOREA · original v0.8 laboratory educational model.
   The formulas below are *not* calibrated GMPEs nor official intensity forecasts.
   Source: GEOQUAKE_KOREA_v0_8_visual(1).html, GQSim.intensity and GQCore.travel. */
'use strict';
(() => {
  const EARTH_RADIUS_KM = 6371;
  const RAD = Math.PI / 180;
  const JMA = ['0','1','2','3','4','5약','5강','6약','6강','7'];
  const JP_BOUNDS = [0.5,1.5,2.5,3.5,4.5,5,5.5,6,6.5];
  const ROMAN=['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
  const PALETTE_KR = ['#334254','#35536f','#3c769b','#39a5b6','#55c2a3','#b5cb61','#e0b652','#df8b47','#df6854','#d54e65','#b8548f','#a66bd4','#e49bea'];
  const PALETTE_JP = ['#3c4c61','#4f83b8','#4eafc9','#79caa4','#d6ce68','#edb84e','#e98c4d','#e26963','#b977d7','#ed9bdb'];
  const REGIONS = Object.freeze([{"id":"KR-11","name":"서울특별시","short":"서울","lat":37.5665,"lon":126.978,"country":"KR"},{"id":"KR-26","name":"부산광역시","short":"부산","lat":35.1796,"lon":129.0756,"country":"KR"},{"id":"KR-27","name":"대구광역시","short":"대구","lat":35.8714,"lon":128.6014,"country":"KR"},{"id":"KR-28","name":"인천광역시","short":"인천","lat":37.4563,"lon":126.7052,"country":"KR"},{"id":"KR-29","name":"광주광역시","short":"광주","lat":35.1595,"lon":126.8526,"country":"KR"},{"id":"KR-30","name":"대전광역시","short":"대전","lat":36.3504,"lon":127.3845,"country":"KR"},{"id":"KR-31","name":"울산광역시","short":"울산","lat":35.5384,"lon":129.3114,"country":"KR"},{"id":"KR-50","name":"세종특별자치시","short":"세종","lat":36.48,"lon":127.289,"country":"KR"},{"id":"KR-41","name":"경기도","short":"경기","lat":37.275,"lon":127.009,"country":"KR"},{"id":"KR-42","name":"강원특별자치도","short":"강원","lat":37.8813,"lon":127.7298,"country":"KR"},{"id":"KR-43","name":"충청북도","short":"충북","lat":36.6424,"lon":127.489,"country":"KR"},{"id":"KR-44","name":"충청남도","short":"충남","lat":36.6588,"lon":126.6728,"country":"KR"},{"id":"KR-45","name":"전북특별자치도","short":"전북","lat":35.8202,"lon":127.1089,"country":"KR"},{"id":"KR-46","name":"전라남도","short":"전남","lat":34.8161,"lon":126.4629,"country":"KR"},{"id":"KR-47","name":"경상북도","short":"경북","lat":36.576,"lon":128.5057,"country":"KR"},{"id":"KR-48","name":"경상남도","short":"경남","lat":35.237,"lon":128.692,"country":"KR"},{"id":"KR-49","name":"제주특별자치도","short":"제주","lat":33.4996,"lon":126.5312,"country":"KR"},{"id":"JP-01","name":"홋카이도","short":"홋카이도","lat":43.0642,"lon":141.3469,"country":"JP"},{"id":"JP-02","name":"아오모리현","short":"아오모리","lat":40.8244,"lon":140.74,"country":"JP"},{"id":"JP-03","name":"이와테현","short":"이와테","lat":39.7036,"lon":141.1527,"country":"JP"},{"id":"JP-04","name":"미야기현","short":"미야기","lat":38.2688,"lon":140.8721,"country":"JP"},{"id":"JP-05","name":"아키타현","short":"아키타","lat":39.7186,"lon":140.1024,"country":"JP"},{"id":"JP-06","name":"야마가타현","short":"야마가타","lat":38.2404,"lon":140.3633,"country":"JP"},{"id":"JP-07","name":"후쿠시마현","short":"후쿠시마","lat":37.75,"lon":140.4676,"country":"JP"},{"id":"JP-08","name":"이바라키현","short":"이바라키","lat":36.3418,"lon":140.4468,"country":"JP"},{"id":"JP-09","name":"도치기현","short":"도치기","lat":36.5658,"lon":139.8836,"country":"JP"},{"id":"JP-10","name":"군마현","short":"군마","lat":36.3911,"lon":139.0608,"country":"JP"},{"id":"JP-11","name":"사이타마현","short":"사이타마","lat":35.8569,"lon":139.6489,"country":"JP"},{"id":"JP-12","name":"지바현","short":"지바","lat":35.6047,"lon":140.1233,"country":"JP"},{"id":"JP-13","name":"도쿄도","short":"도쿄","lat":35.6895,"lon":139.6917,"country":"JP"},{"id":"JP-14","name":"가나가와현","short":"가나가와","lat":35.4478,"lon":139.6425,"country":"JP"},{"id":"JP-15","name":"니가타현","short":"니가타","lat":37.9026,"lon":139.023,"country":"JP"},{"id":"JP-16","name":"도야마현","short":"도야마","lat":36.6953,"lon":137.2113,"country":"JP"},{"id":"JP-17","name":"이시카와현","short":"이시카와","lat":36.5947,"lon":136.6256,"country":"JP"},{"id":"JP-18","name":"후쿠이현","short":"후쿠이","lat":36.0652,"lon":136.2216,"country":"JP"},{"id":"JP-19","name":"야마나시현","short":"야마나시","lat":35.6642,"lon":138.5684,"country":"JP"},{"id":"JP-20","name":"나가노현","short":"나가노","lat":36.6513,"lon":138.181,"country":"JP"},{"id":"JP-21","name":"기후현","short":"기후","lat":35.3912,"lon":136.7223,"country":"JP"},{"id":"JP-22","name":"시즈오카현","short":"시즈오카","lat":34.9769,"lon":138.3831,"country":"JP"},{"id":"JP-23","name":"아이치현","short":"아이치","lat":35.1802,"lon":136.9066,"country":"JP"},{"id":"JP-24","name":"미에현","short":"미에","lat":34.7303,"lon":136.5086,"country":"JP"},{"id":"JP-25","name":"시가현","short":"시가","lat":35.0045,"lon":135.8686,"country":"JP"},{"id":"JP-26","name":"교토부","short":"교토","lat":35.0211,"lon":135.7556,"country":"JP"},{"id":"JP-27","name":"오사카부","short":"오사카","lat":34.6863,"lon":135.52,"country":"JP"},{"id":"JP-28","name":"효고현","short":"효고","lat":34.6913,"lon":135.183,"country":"JP"},{"id":"JP-29","name":"나라현","short":"나라","lat":34.6853,"lon":135.8327,"country":"JP"},{"id":"JP-30","name":"와카야마현","short":"와카야마","lat":34.226,"lon":135.1675,"country":"JP"},{"id":"JP-31","name":"돗토리현","short":"돗토리","lat":35.5039,"lon":134.2377,"country":"JP"},{"id":"JP-32","name":"시마네현","short":"시마네","lat":35.4723,"lon":133.0505,"country":"JP"},{"id":"JP-33","name":"오카야마현","short":"오카야마","lat":34.6618,"lon":133.9344,"country":"JP"},{"id":"JP-34","name":"히로시마현","short":"히로시마","lat":34.3963,"lon":132.4596,"country":"JP"},{"id":"JP-35","name":"야마구치현","short":"야마구치","lat":34.1859,"lon":131.4714,"country":"JP"},{"id":"JP-36","name":"도쿠시마현","short":"도쿠시마","lat":34.0658,"lon":134.5593,"country":"JP"},{"id":"JP-37","name":"가가와현","short":"가가와","lat":34.3401,"lon":134.0434,"country":"JP"},{"id":"JP-38","name":"에히메현","short":"에히메","lat":33.8416,"lon":132.7657,"country":"JP"},{"id":"JP-39","name":"고치현","short":"고치","lat":33.5597,"lon":133.5311,"country":"JP"},{"id":"JP-40","name":"후쿠오카현","short":"후쿠오카","lat":33.6064,"lon":130.4183,"country":"JP"},{"id":"JP-41","name":"사가현","short":"사가","lat":33.2494,"lon":130.2988,"country":"JP"},{"id":"JP-42","name":"나가사키현","short":"나가사키","lat":32.7448,"lon":129.8738,"country":"JP"},{"id":"JP-43","name":"구마모토현","short":"구마모토","lat":32.7898,"lon":130.7417,"country":"JP"},{"id":"JP-44","name":"오이타현","short":"오이타","lat":33.2382,"lon":131.6126,"country":"JP"},{"id":"JP-45","name":"미야자키현","short":"미야자키","lat":31.9111,"lon":131.4239,"country":"JP"},{"id":"JP-46","name":"가고시마현","short":"가고시마","lat":31.5602,"lon":130.5581,"country":"JP"},{"id":"JP-47","name":"오키나와현","short":"오키나와","lat":26.2124,"lon":127.6809,"country":"JP"}]);
  const valid = x => typeof x === 'number' && Number.isFinite(x);
  function haversine(a,b){
    const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;
    const q=Math.sin(dLat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dLon/2)**2;
    return 2*EARTH_RADIUS_KM*Math.asin(Math.sqrt(Math.max(0,Math.min(q,1))));
  }
  function validEvent(e){
    return !!e && valid(e.latitude) && valid(e.longitude) &&
      Math.abs(e.latitude)<=90 && Math.abs(e.longitude)<=180 &&
      valid(e.magnitude) && e.magnitude>=0 && e.magnitude<=9.5 &&
      valid(e.depthKm) && e.depthKm>=0 && e.depthKm<=700;
  }
  function estimate(e,p){
    if(!validEvent(e) || !p || !valid(p.lat) || !valid(p.lon) || !['KR','JP'].includes(p.country)) return null;
    const distanceKm = haversine({lat:e.latitude,lon:e.longitude},p);
    const hypocentralKm = Math.hypot(distanceKm,e.depthKm);
    const pArrival = hypocentralKm / 6;
    const sArrival = hypocentralKm / 3.5;
    // The source code in the original lab explicitly labels these as uncalibrated pedagogical proxies.
    const mm = 1.5*e.magnitude - 3*Math.log10(hypocentralKm+10) + 1;
    const jm = 1.25*e.magnitude - 2.5*Math.log10(hypocentralKm+10) + 0.9;
    let ix=0;
    while(ix<JP_BOUNDS.length && jm>=JP_BOUNDS[ix]) ix++;
    const index = p.country==='KR'?Math.max(1,Math.min(12,Math.round(mm))):ix;
    const value = p.country==='KR'?index:JMA[index];
    return {
      id:p.id||'custom',country:p.country,name:p.name||p.short||'관심 지점',short:p.short||p.name||'관심 지점',
      lat:p.lat,lon:p.lon,distanceKm,hypocentralKm,pArrival,sArrival,spWindow:sArrival-pArrival,
      index,value,display:p.country==='KR'?('MMI '+ROMAN[index]):('JMA '+value),
      color:p.country==='KR'?PALETTE_KR[index]:PALETTE_JP[index],
      scale:p.country==='KR'?'MMI':'JMA',kind:'uncalibrated-educational-proxy'
    };
  }
  function calculate(e){return validEvent(e)?REGIONS.map(p=>estimate(e,p)):[];}
  function nearestRegion(lat,lon){return REGIONS.reduce((prev,r)=>!prev||haversine({lat,lon},r)<haversine({lat,lon},prev)?r:prev,null);}
  function threshold(row){return row.country==='KR'?row.index>=4:row.index>=4; /* KR: MMI IV, JP: JMA 4 — distinct scales, not equivalent */}
  function phase(row,t){return t>=row.sArrival?'S 도달':t>=row.pArrival?'P 도달':'도달 전';}
  window.GQImpact={REGIONS,JMA,ROMAN,haversine,validEvent,estimate,calculate,nearestRegion,threshold,phase};
})();
