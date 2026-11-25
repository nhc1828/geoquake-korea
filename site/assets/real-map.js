/* GEOQUAKE KOREA v4.1 — full-world REAL map (OpenFreeMap / OSM),
 * geoBoundaries administrative polygons and transparent model/observed overlays.
 * The map layer runs independently from the incoming real earthquake notifications.
 */
const I=window.GQIntensityModel;
const EMPTY=()=>({type:'FeatureCollection',features:[]});
const ROOT=document.getElementById('realMap');
const STATUS=document.getElementById('realMapStatus');
const MODEL_NOTE=document.getElementById('mapKeyNote');
const COUNTRIES=['KOR','JPN','CHN','TWN','PRK'];
const ISO_NAME={KOR:'대한민국',JPN:'일본',CHN:'중국',TWN:'대만',PRK:'북한'};
let provider='',map=null,lib=null,ready=false,polygons=[],regionCenters=[],latest=null,lastGeoKey='',lastEventKey='',reloadToken=0;
let leafletZones=null,leafletEvents=null,leafletContours=null,leafletCenterPoints=null,leafletSimulation=null,leafletHazards=null;
let simFrame=null,hazardFrame=null;
const SUPPORTED_MODES=new Set(['hybrid','observed','model','off']);
const once=(key,fn)=>{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn,{once:true});else fn();};
function tell(message,level='loading'){
  if(!STATUS)return;
  STATUS.textContent=message;
  STATUS.dataset.level=level;
  STATUS.hidden=level==='ready';
}
function emit(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}));}
const featureCollection=features=>({type:'FeatureCollection',features});
function wrapFetch(url,timeout=18000){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  return fetch(url,{signal:ctl.signal,credentials:'omit',cache:'force-cache'}).then(async response=>{
    if(!response.ok)throw Error('HTTP '+response.status);
    const txt=await response.text();
    if(txt.length>15_000_000)throw Error('geometry too large');
    return JSON.parse(txt);
  }).finally(()=>clearTimeout(timer));
}
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/(?:prefecture|province|autonomous|metropolitan|city|special|teukbyeolsi|gwangyeoksi|\-do|\-si)/g,'').replace(/[^a-z\uac00-\ud7af\u3400-\u9fff]/g,'');
function matchRegionId(feature,iso){
  const p=feature.properties||{};
  const country=iso==='JPN'?'JP':iso==='KOR'?'KR':null;
  if(!country)return null;
  for(const key of ['shapeISO','iso_3166_2','ISO_3166_2','iso-code','name_1']){
    const code=String(p[key]||'').toUpperCase();
    const aliases={'KR-51':'KR-42','KR-52':'KR-45'};
    const converted=aliases[code]||code;
    if(regionCenters.some(r=>r.id===converted))return converted;
  }
  const raw=[p.shapeName,p.name,p.NAME_1,p.name_en,p.name_1].filter(Boolean).map(norm);
  const found=regionCenters.find(r=>r.id.startsWith(country+'-')&&[r.name,r.short,...(r.aliases||[])].map(norm).some(a=>raw.includes(a)));
  return found?.id||null;
}
function prepareGeometry(data,iso){
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>600)return [];
  return data.features.filter(f=>f&&['Polygon','MultiPolygon'].includes(f.geometry?.type)&&Array.isArray(f.geometry.coordinates))
    .map((f,i)=>{
      const place=I?.polygonRepresentative(f.geometry);
      if(!place||!Number.isFinite(place.lat)||!Number.isFinite(place.lon)||Math.abs(place.lat)>90||Math.abs(place.lon)>180)return null;
      const id=matchRegionId(f,iso),center=regionCenters.find(r=>r.id===id);
      return {type:'Feature',geometry:f.geometry,properties:{iso:iso,id:id||'',name:String(f.properties?.shapeName||f.properties?.name||f.properties?.NAME_1||ISO_NAME[iso]).slice(0,90),lat:center?.lat??place.lat,lon:center?.lon??place.lon,geoId:iso+':'+i}};
    }).filter(Boolean);
}
async function fetchCountry(iso){
  const apiUrls=[`https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM1/`,`https://geoboundaries-dev.org/api/current/gbOpen/${iso}/ADM1/`];
  let error;
  for(const api of apiUrls){try{
    const meta=await wrapFetch(api,12000);
    const url=meta?.simplifiedGeometryGeoJSON;
    if(typeof url!=='string'||!url.startsWith('https://'))throw Error('geometry link missing');
    const data=await wrapFetch(url,25000),arr=prepareGeometry(data,iso);
    if(!arr.length)throw Error('geometry empty');
    polygons.push(...arr);
    update();
    emit('gq-map-boundaries',{country:iso,count:arr.length});
    return;
  }catch(e){error=e;}}
  emit('gq-map-boundaries',{country:iso,count:0,error:error?.message||'failed'});
}
async function loadBoundaries(){
  try{const r=await wrapFetch('./data/region_centers.json',9000);if(Array.isArray(r))regionCenters=r;}catch{}
  // Avoid heavy requests in parallel and respect provider bandwidth.
  for(const bucket of [['KOR','JPN'],['CHN','TWN'],['PRK']])await Promise.allSettled(bucket.map(fetchCountry));
  update();
}
function projectedZones(event,mode){
  if(!I||!event)return {zones:[],points:[],counts:{observed:0,model:0}};
  // Real JMA observations can still be drawn when epicenter, depth or magnitude is unavailable.
  const hasModelInput=[event.latitude,event.longitude,event.magnitude,event.depthKm].every(Number.isFinite);
  const obs=new Map();
  if(event.source==='JMA'&&event.observationsVerified===true&&event.observedRegions&&typeof event.observedRegions==='object'){
    for(const [id,value] of Object.entries(event.observedRegions))if(/^JP-(0[1-9]|[1-3]\d|4[0-7])$/.test(id)){
      const v=I.recorded(value);if(v)obs.set(id,v);
    }
  }
  if(event.source==='KMA'&&event.reportedAreas&&typeof event.reportedAreas==='object'){
    for(const [id,value] of Object.entries(event.reportedAreas))if(/^KR-\d{2}$/.test(id)){const v=I.kmaReported(value);if(v)obs.set(id,v);}
  }
  const result=[],counts={observed:0,model:0};
  for(const f of polygons){const p=f.properties,id=p.id,estimate=hasModelInput?I.estimate(event,p.lat,p.lon,p.iso==='JPN'?'JMA':'MMI'):null;
    const measured=(p.iso==='JPN'||p.iso==='KOR')?obs.get(id):null;
    const v=I.combine(estimate,measured,mode);
    if(!v)continue;
    counts[v.kind==='estimate'?'model':'observed']++;
    result.push({...f,properties:{...p,kind:v.kind,intensityLabel:v.value,scale:v.scale,color:v.color,originDistanceKm:Math.round(estimate?.distanceKm??0),tooltip:p.name+' · '+v.scale+' '+v.value}});
  }
  // If administrative boundaries are unreachable, use real geo-coordinates for station badges,
  // NOT fabricated administrative polygons. Dedupe against loaded region identifiers.
  const loaded=new Set(polygons.map(f=>f.properties.id).filter(Boolean));
  const points=[];
  for(const p of regionCenters){if(loaded.has(p.id))continue;
    const v=I.combine(hasModelInput?I.estimate(event,p.lat,p.lon,p.id.startsWith('JP-')?'JMA':'MMI'):null,obs.get(p.id)||null,mode);
    if(!v)continue;
    points.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lon,p.lat]},properties:{id:p.id,name:p.name,kind:v.kind,color:v.color,intensityLabel:v.value,scale:v.scale}});
  }
  return {zones:result,points,counts};
}
function eventGeoJSON(events,chosenId){
  return featureCollection((events||[]).filter(e=>e&&Number.isFinite(e.latitude)&&Number.isFinite(e.longitude)&&Math.abs(e.latitude)<=90&&Math.abs(e.longitude)<=180)
    .slice(0,600).map(e=>({type:'Feature',geometry:{type:'Point',coordinates:[e.longitude,e.latitude]},properties:{id:e.id,place:String(e.location||'진앙 미상').slice(0,100),selected:e.id===chosenId?1:0,source:e.source||'USGS',mag:Number.isFinite(e.magnitude)?e.magnitude:null,color:e.id===chosenId?'#ffe0a3':e.source==='KMA'?'#69ddc9':e.source==='JMA'?'#74c0f2':'#f4ab72'}})));
}
function mapPayload(){const payload=latest||{};const event=payload.event||null,mode=SUPPORTED_MODES.has(payload.mode)?payload.mode:'hybrid';
  const geo=projectedZones(event,mode), contours=mode==='off'||mode==='observed'||!I?[]:I.contourFeatures(event);
  return {...geo,contours,events:eventGeoJSON(payload.events,event?.id),event,mode};
}
function popupContent(lines){const box=document.createElement('div');box.className='geoquake-map-popup';
  for(const [label,value] of lines){const row=document.createElement('div'),a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;row.append(a,b);box.append(row);}
  return box;
}
function maplibrePopup(e){
  if(!map||provider!=='maplibre')return;
  const p=e.features?.[0]?.properties,point=e.lngLat;if(!p)return;
  const el=popupContent([['지역',p.name||p.place||'미상'],['진도',p.scale?p.scale+' '+p.intensityLabel:'발생정보'],['구분',p.kind==='reported'?'기관 발표 지역별 진도':p.kind==='observed'?'기관 관측점 최고값':p.kind==='estimate'?'교육용 거리감쇠 추정':'공식 발생정보']]);
  new lib.Popup({offset:10,maxWidth:'260px'}).setLngLat(point).setDOMContent(el).addTo(map);
}
function setupMapLibreLayers(){
  if(!map||provider!=='maplibre')return;
  const style=map.getStyle();
  const before=style.layers?.find(l=>l.type==='symbol')?.id;
  for(const [id,type] of [['gq-contours','geojson'],['gq-zones','geojson'],['gq-centers','geojson'],['gq-events','geojson'],['gq-sim-waves','geojson'],['gq-sim-sensors','geojson'],['gq-hazards','geojson']])if(!map.getSource(id))map.addSource(id,{type,data:EMPTY()});
  map.addLayer({id:'gq-contours-fill',type:'fill',source:'gq-contours',paint:{'fill-color':['get','color'],'fill-opacity':0.12}},before);
  map.addLayer({id:'gq-zone-fill',type:'fill',source:'gq-zones',paint:{'fill-color':['get','color'],'fill-opacity':['case',['!=',['get','kind'],'estimate'],0.72,0.40]}},before);
  map.addLayer({id:'gq-zone-outline',type:'line',source:'gq-zones',paint:{'line-color':['case',['!=',['get','kind'],'estimate'],'#f2f8fb','#8cb5c7'],'line-width':['case',['!=',['get','kind'],'estimate'],1.3,0.65],'line-opacity':0.86}},before);
  map.addLayer({id:'gq-zone-label',type:'symbol',source:'gq-zones',layout:{'text-field':['get','intensityLabel'],'text-size':13,'text-font':['Noto Sans Regular'],'text-allow-overlap':false,'text-optional':true},paint:{'text-color':'#10202b','text-halo-color':'#eef6f3','text-halo-width':1.5}});
  map.addLayer({id:'gq-center-badges',type:'circle',source:'gq-centers',paint:{'circle-color':['get','color'],'circle-radius':9,'circle-stroke-color':'#112b42','circle-stroke-width':1.5}});
  map.addLayer({id:'gq-sim-wave-lines',type:'line',source:'gq-sim-waves',paint:{'line-color':['get','color'],'line-width':['case',['==',['get','phase'],'P'],2.5,3.4],'line-opacity':0.95,'line-dasharray':[3,2]}});
  map.addLayer({id:'gq-sim-station-circles',type:'circle',source:'gq-sim-sensors',paint:{'circle-color':['get','color'],'circle-radius':['case',['==',['get','selected'],1],7,4.2],'circle-stroke-color':'#112538','circle-stroke-width':['case',['==',['get','selected'],1],2.4,1.2]}});
  map.addLayer({id:'gq-sim-station-label',type:'symbol',source:'gq-sim-sensors',layout:{'text-field':['case',['==',['get','selected'],1],['get','name'],''],'text-size':11,'text-allow-overlap':false},paint:{'text-color':'#fff5e4','text-halo-color':'#172638','text-halo-width':2}});
  map.addLayer({id:'gq-event-rings',type:'circle',source:'gq-events',filter:['==',['get','selected'],1],paint:{'circle-color':'rgba(255,220,140,0.03)','circle-radius':23,'circle-stroke-color':'#ffda94','circle-stroke-width':1.5}});
  map.addLayer({id:'gq-event-circles',type:'circle',source:'gq-events',paint:{'circle-color':['get','color'],'circle-radius':['case',['==',['get','selected'],1],8,5],'circle-stroke-color':'#0c2132','circle-stroke-width':2}});
  map.addLayer({id:'gq-hazard-area',type:'fill',source:'gq-hazards',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','color'],'fill-opacity':0.18}});
  map.addLayer({id:'gq-hazard-area-border',type:'line',source:'gq-hazards',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['get','color'],'line-width':2,'line-opacity':0.95,'line-dasharray':[3,2]}});
  map.addLayer({id:'gq-hazard-lines',type:'line',source:'gq-hazards',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['get','color'],'line-width':5,'line-opacity':0.95}});
  map.addLayer({id:'gq-hazard-points',type:'circle',source:'gq-hazards',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':11,'circle-color':['get','color'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
  map.addLayer({id:'gq-hazard-icon',type:'symbol',source:'gq-hazards',filter:['==',['geometry-type'],'Point'],layout:{'text-field':'▲','text-size':16,'text-allow-overlap':true},paint:{'text-color':'#38190d'}});
  for(const layer of ['gq-hazard-points','gq-hazard-lines','gq-hazard-area'])map.on('click',layer,e=>{if(window.GQSimulator?.isPicking())return;const p=e.features?.[0]?.properties;if(p)new lib.Popup({offset:10,maxWidth:'300px'}).setLngLat(e.lngLat).setDOMContent(popupContent([['구분',p.name||'발표'],['내용',p.detail||'기관 원문 확인']])).addTo(map)});
  map.on('click','gq-event-circles',e=>{if(window.GQSimulator?.isPicking())return;const id=e.features?.[0]?.properties?.id;if(id&&!String(id).startsWith('SIM:'))emit('gq-map-select',{id});});
  map.on('click','gq-sim-station-circles',e=>{const id=e.features?.[0]?.properties?.id;if(id)emit('gq-sim-select-point',{id});});
  map.on('click','gq-zone-fill',e=>{if(!window.GQSimulator?.isPicking())maplibrePopup(e);});
  map.on('click','gq-center-badges',maplibrePopup);
  for(const layer of ['gq-event-circles','gq-zone-fill','gq-center-badges','gq-sim-station-circles']){
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  }
}
function redrawMapLibre(data){
  const change=(id,features)=>{const src=map.getSource(id);if(src)src.setData(featureCollection(features));};
  change('gq-contours',data.contours);change('gq-zones',data.zones);change('gq-centers',data.points);change('gq-events',data.events.features);
  redrawSimulationFrame();
}
function redrawLeaflet(data){
  for(const lay of [leafletZones,leafletEvents,leafletContours,leafletCenterPoints])if(lay)lay.clearLayers();
  for(const f of data.contours)lib.geoJSON(f,{style:{color:f.properties.color,weight:0,fillColor:f.properties.color,fillOpacity:.08,interactive:false}}).addTo(leafletContours);
  for(const f of data.zones){
    const layer=lib.geoJSON(f,{style:{color:f.properties.kind!=='estimate'?'#ecf8fa':'#8cb8cd',weight:f.properties.kind!=='estimate'?1.2:.5,fillColor:f.properties.color,fillOpacity:f.properties.kind!=='estimate'?.7:.40}});
    layer.on('click',e=>lib.popup().setLatLng(e.latlng).setContent(popupContent([['지역',f.properties.name],['진도',f.properties.scale+' '+f.properties.intensityLabel],['종류',f.properties.kind==='reported'?'기관 발표 지역별 진도':f.properties.kind==='observed'?'기관 관측점 최고값':'교육용 모형 추정']])).openOn(map));
    layer.addTo(leafletZones);
  }
  for(const f of data.points){const p=f.properties,ll=[f.geometry.coordinates[1],f.geometry.coordinates[0]];
    lib.circleMarker(ll,{radius:9,weight:1.5,color:'#132e42',fillColor:p.color,fillOpacity:.9}).bindTooltip(p.name+' · '+p.scale+' '+p.intensityLabel).addTo(leafletCenterPoints);
  }
  for(const e of data.events.features){const p=e.properties,ll=[e.geometry.coordinates[1],e.geometry.coordinates[0]];
    const m=lib.circleMarker(ll,{radius:p.selected?9:5,color:'#081e2c',weight:2,fillColor:p.color,fillOpacity:1});
    m.on('click',()=>emit('gq-map-select',{id:p.id}));m.bindTooltip(p.place+' · '+p.source);m.addTo(leafletEvents);
  }
}
function redrawSimulationFrame(){
  if(!ready)return;
  const waves=simFrame?.waves||EMPTY(),stations=simFrame?.stations||EMPTY();
  if(provider==='maplibre'){
    const a=map.getSource('gq-sim-waves'),b=map.getSource('gq-sim-sensors');
    if(a)a.setData(waves);if(b)b.setData(stations);
  }else if(provider==='leaflet'&&leafletSimulation){
    leafletSimulation.clearLayers();
    for(const f of waves.features||[])lib.geoJSON(f,{style:{color:f.properties.color,weight:f.properties.phase==='S'?3:2,dashArray:'7 7',opacity:.93,interactive:false}}).addTo(leafletSimulation);
    for(const f of stations.features||[]){const p=f.properties,ll=[f.geometry.coordinates[1],f.geometry.coordinates[0]];
      const b=lib.circleMarker(ll,{radius:p.selected?7:4.2,color:'#152536',weight:p.selected?2.5:1.2,fillColor:p.color,fillOpacity:.98});
      b.on('click',()=>emit('gq-sim-select-point',{id:p.id}));b.bindTooltip(p.name+' · '+p.phase);b.addTo(leafletSimulation);
    }
  }
}
function setSimulationFrame(frame){simFrame=frame;redrawSimulationFrame();}
function redrawHazards(){
  if(!ready)return;const data=hazardFrame||EMPTY();
  if(provider==='maplibre')map.getSource('gq-hazards')?.setData(data);
  else if(provider==='leaflet'&&leafletHazards){leafletHazards.clearLayers();for(const f of data.features||[]){
    const p=f.properties||{},layer=lib.geoJSON(f,{style:{color:p.color||'#ffb72b',weight:5,fillOpacity:.18},pointToLayer:(_,ll)=>lib.marker(ll,{icon:lib.divIcon({className:'gq-volcano-icon',html:'▲',iconSize:[24,24]})})});
    layer.bindPopup(popupContent([['구분',p.name||'발표'],['내용',p.detail||'기관 원문 확인']]));layer.addTo(leafletHazards);
  }}
}
function setHazardFrame(frame){hazardFrame=frame;redrawHazards();}
let latestDrawToken=0;
function update(){
  if(!ready||!latest)return;
  const t=++latestDrawToken, current=mapPayload();
  if(t!==latestDrawToken)return;
  try{if(provider==='maplibre')redrawMapLibre(current);else if(provider==='leaflet')redrawLeaflet(current);}catch(err){console.warn('GEOQUAKE map overlay:',err?.message||err);}
  const info={observed:current.counts.observed,estimated:current.counts.model,boundaries:polygons.length,provider};
  emit('gq-map-layer-updated',info);
}
function setSnapshot(p){latest=p;update()}
function focus(lon,lat,zoomHint){if(!ready||!Number.isFinite(lon)||!Number.isFinite(lat))return;
  const z=Number.isFinite(zoomHint)?Math.min(8,Math.max(4,zoomHint/3.4)):6;
  if(provider==='maplibre')map.flyTo({center:[lon,lat],zoom:Math.max(map.getZoom(),z),duration:650});
  else map.flyTo([lat,lon],Math.max(map.getZoom(),z),{duration:.65});
}
function zoom(factor){if(!ready)return;const dz=Math.log2(factor);if(provider==='maplibre')map.zoomTo(map.getZoom()+dz,{duration:250});else map.setZoom(map.getZoom()+dz)}
function fitEastAsia(){if(!ready)return;const sw=[73,14],ne=[155,56];
  if(provider==='maplibre')map.fitBounds([sw,ne],{padding:35,duration:550,maxZoom:5});
  else map.fitBounds([[sw[1],sw[0]],[ne[1],ne[0]]],{padding:[35,35],maxZoom:5});
}
function fitWorld(){if(!ready)return;if(provider==='maplibre')map.flyTo({center:[132,33],zoom:2.4,duration:550});else map.setView([33,132],2.4)}
async function setupMapLibre(){
  const gl=await import('https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs');
  if(typeof gl?.Map!=='function')throw Error('MapLibre import failed');
  lib=gl;provider='maplibre';
  map=new gl.Map({container:ROOT,style:'https://tiles.openfreemap.org/styles/dark',center:[119,36],zoom:3.2,minZoom:1.1,maxZoom:14,attributionControl:true,dragRotate:false,pitchWithRotate:false,antialias:true});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('vector map timeout')),18000);
    map.once('load',()=>{clearTimeout(timer);resolve()});
    map.on('error',e=>{if(!map.loaded()){clearTimeout(timer);reject(Error('vector map style unavailable'))}else console.warn('map layer',e?.error?.message||'error')});
  });
  setupMapLibreLayers();
  map.on('mousemove',e=>emit('gq-map-coord',{lat:e.lngLat.lat,lon:e.lngLat.lng}));
  map.on('click',e=>emit('gq-map-pick',{lat:e.lngLat.lat,lon:e.lngLat.lng}));
  ready=true;ROOT.classList.add('map-gl');tell('', 'ready');update();redrawSimulationFrame();redrawHazards();fitEastAsia();emit('gq-realmap-ready',{provider});
}
async function setupLeaflet(){
  provider='leaflet';ROOT.replaceChildren();
  const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.append(css);
  if(!window.L){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=resolve;s.onerror=()=>reject(Error('Leaflet CDN unavailable'));document.head.append(s)});}
  lib=window.L;
  if(!lib)throw Error('Leaflet missing');
  map=lib.map(ROOT,{zoomControl:false,minZoom:1,maxZoom:13,worldCopyJump:true,preferCanvas:true}).setView([36,130],4);
  lib.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',minZoom:1,maxZoom:19,detectRetina:false
  }).addTo(map);
  leafletZones=lib.layerGroup().addTo(map);leafletContours=lib.layerGroup().addTo(map);leafletCenterPoints=lib.layerGroup().addTo(map);leafletEvents=lib.layerGroup().addTo(map);leafletSimulation=lib.layerGroup().addTo(map);leafletHazards=lib.layerGroup().addTo(map);
  map.on('mousemove',e=>emit('gq-map-coord',{lat:e.latlng.lat,lon:e.latlng.lng}));
  map.on('click',e=>emit('gq-map-pick',{lat:e.latlng.lat,lon:e.latlng.lng}));
  ready=true;ROOT.classList.add('map-leaflet');tell('', 'ready');update();redrawSimulationFrame();redrawHazards();fitEastAsia();emit('gq-realmap-ready',{provider});
}
async function boot(){
  tell('실제 세계지도 연결 중…');
  loadBoundaries();
  try{await setupMapLibre();return}catch(e){try{map?.remove()}catch{};map=null;ready=false;ROOT.replaceChildren();console.warn('OpenFreeMap unavailable; using OSM fallback:',e?.message||e)}
  tell('벡터 지도 연결 지연 · OpenStreetMap 대체 지도 연결 중');
  try{await setupLeaflet();return}catch(e){tell('실제 지도 연결 실패 · 네트워크 상태를 확인하세요','error');console.warn('OSM fallback failed:',e?.message||e)}
}
const publicApi={setSnapshot,setSimulationFrame,setHazardFrame,focus,zoom,fitEastAsia,fitWorld,info:()=>({ready,provider,boundaries:polygons.length})};
window.GQRealMap=publicApi;
once('dom',boot);
