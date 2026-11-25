/* Training-only demonstrations; no operational predictions or warnings. */
(function(root){'use strict';
const I=root.GQIntensityModel || (typeof require==='function'?require('./intensity-model.js'):null);
function insideRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]))inside=!inside;}return inside;}
function landAt(lat,lon,fc){return (fc?.features||[]).some(f=>{let g=f.geometry;if(!g)return false;let p=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return p.some(r=>insideRing([lon,lat],r[0])&&!r.slice(1).some(h=>insideRing([lon,lat],h)));});}
function lines(g){if(!g)return [];if(g.type==='LineString')return [g.coordinates];if(g.type==='MultiLineString')return g.coordinates;if(g.type==='GeometryCollection')return g.geometries.flatMap(lines);return [];}
function km(a,b){return I.distanceKm({lat:a[1],lon:a[0]},{lat:b[1],lon:b[0]});}
function realTsunami(feed,coasts,now=Date.now()){
 if(feed?.state!=='ok'||!Array.isArray(feed.items))return [];
 const latest=feed.items.filter(x=>Number.isFinite(Date.parse(x.issuedAt))).sort((a,b)=>Date.parse(b.issuedAt)-Date.parse(a.issuedAt))[0];
 const age=latest?now-Date.parse(latest.issuedAt):Infinity;
 if(!latest||latest.cancelled!==false||age < -120000||age>86400000)return [];
 const result=[];
 for(const a of latest.areas||[]){const f=coasts?.features?.find(x=>x.properties.name===a.name);if(!f||!['대형 지진해일 경보','지진해일 경보','지진해일 주의보'].includes(a.level))continue;
  result.push({type:'Feature',geometry:f.geometry,properties:{name:'일본 지진해일 발표 · '+(f.properties.nameKo||a.name),color:a.level.includes('대형')?'#d568dc':a.level.includes('주의')?'#ffcf40':'#ff665f',level:a.level,issuedAt:latest.issuedAt}});
 }
 return result;
}
// JMA height thresholds: >=0.2–1 m, >1–3 m, >3 m.
function tsunamiLevel(height){if(!Number.isFinite(height)||height<0.2)return null;if(height<=1)return {id:'advisory',label:'지진해일 주의보',color:'#ffd744',rank:1};if(height<=3)return {id:'warning',label:'지진해일 경보',color:'#ff665f',rank:2};return {id:'major',label:'대지진해일 경보',color:'#c764f4',rank:3};}
const gridCache=new WeakMap(), STEP=.25, WEST=120, SOUTH=25, NX=121, NY=93;
function makeGrid(land){
 if(gridCache.has(land))return gridCache.get(land);
 const polygons=[];for(const f of land.features||[]){const g=f.geometry,p=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];for(const rings of p){if(!rings[0]?.length)continue;let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;for(const [x,y] of rings[0]){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}polygons.push({rings,west,east,south,north});}}
 const blocked=new Uint8Array(NX*NY);
 for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const lon=WEST+x*STEP,lat=SOUTH+y*STEP;blocked[y*NX+x]=polygons.some(p=>lon>=p.west&&lon<=p.east&&lat>=p.south&&lat<=p.north&&insideRing([lon,lat],p.rings[0])&&!p.rings.slice(1).some(r=>insideRing([lon,lat],r)))?1:0;}
 const grid={blocked};gridCache.set(land,grid);return grid;
}
function nearestWater(lon,lat,grid){
 const gx=Math.round((lon-WEST)/STEP),gy=Math.round((lat-SOUTH)/STEP);let best=-1,bestKm=Infinity;
 for(let y=Math.max(0,gy-2);y<=Math.min(NY-1,gy+2);y++)for(let x=Math.max(0,gx-2);x<=Math.min(NX-1,gx+2);x++){
  const id=y*NX+x;if(grid.blocked[id])continue;const d=km([lon,lat],[WEST+x*STEP,SOUTH+y*STEP]);if(d<bestKm){best=id;bestKm=d;}
 }return {id:best,offset:bestKm};
}
function waterDistances(origin,land){
 const grid=makeGrid(land),start=nearestWater(origin.lon,origin.lat,grid),dist=new Float64Array(NX*NY);dist.fill(Infinity);if(start.id<0||start.offset>80)return {grid,dist};
 const heap=[];function push(node,d){let i=heap.length;heap.push([node,d]);while(i){const p=(i-1)>>1;if(heap[p][1]<=d)break;heap[i]=heap[p];i=p;}heap[i]=[node,d];}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(true){let l=i*2+1,r=l+1;if(l>=heap.length)break;let c=r<heap.length&&heap[r][1]<heap[l][1]?r:l;if(heap[c][1]>=last[1])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;}
 dist[start.id]=start.offset;push(start.id,start.offset);
 while(heap.length){const [id,d]=pop();if(d>dist[id]+1e-9)continue;const x=id%NX,y=Math.floor(id/NX),lat=SOUTH+y*STEP;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=NX||yy<0||yy>=NY)continue;const next=yy*NX+xx;if(grid.blocked[next]||(dx&&dy&&(grid.blocked[y*NX+xx]||grid.blocked[yy*NX+x])))continue;
   const cost=STEP*111.2*Math.hypot(dy,dx*Math.cos(lat*Math.PI/180)),nd=d+cost;if(nd<dist[next]){dist[next]=nd;push(next,nd);}
  }
 }
 return {grid,dist};
}
function tsunami(origin,land,coasts,referenceHeight){
 if(!origin||![origin.lat,origin.lon,origin.magnitude,origin.depthKm].every(Number.isFinite)||!land?.features||!coasts?.features)return {status:'invalid',features:[]};
 if(origin.lat<25||origin.lat>48||origin.lon<120||origin.lon>150)return {status:'outside',features:[]};
 if(landAt(origin.lat,origin.lon,land))return {status:'land',features:[]};
 if(origin.magnitude<6.5||origin.depthKm>100)return {status:'below',features:[]};
 if(referenceHeight!=null&&(!Number.isFinite(referenceHeight)||referenceHeight<0||referenceHeight>30))return {status:'invalid_height',features:[]};
 const reference=referenceHeight??Math.min(30,2*Math.pow(10,.5*(origin.magnitude-7))*Math.exp(-origin.depthKm/100));
 const {grid,dist}=waterDistances(origin,land),result=[];
 for(const f of coasts.features){if(f.properties.code==='0')continue;let best=Infinity;
  for(const line of lines(f.geometry))for(const point of line){const near=nearestWater(point[0],point[1],grid);if(near.id>=0&&near.offset<60)best=Math.min(best,dist[near.id]+near.offset);}
  if(!Number.isFinite(best))continue;
  // Deliberate teaching attenuation, not a hydrodynamic or JMA forecasting model.
  const height=Math.round(reference*Math.sqrt(100/Math.max(100,best))*Math.exp(-Math.max(0,best-100)/600)*100)/100,level=tsunamiLevel(height);if(!level)continue;
  const name=f.properties.nameKo||f.properties.name;
  result.push({type:'Feature',properties:{name,color:level.color,level:level.label,rank:level.rank,height,distanceKm:Math.round(best),detail:`훈련 · ${level.label} · 모의 파고 ${height.toFixed(2)}m · 해상 격자거리 약 ${Math.round(best)}km · 실제 예측 아님`},geometry:f.geometry});
 }
 result.sort((a,b)=>b.properties.rank-a.properties.rank||a.properties.distanceKm-b.properties.distanceKm);
 return {status:result.length?'warning':'no_coast',reference,features:result};
}
const WIND={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};
function volcano(lat,lon,vei,wind='E',regions=[]){
 if(!Number.isFinite(lat)||Math.abs(lat)>80||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isInteger(vei)||vei<0||vei>8||!Object.hasOwn(WIND,wind))return null;
 const radius=[3,5,10,20,30,50,80,120,180][vei],length=[5,10,20,45,90,180,350,500,700][vei],width=Math.max(4,length*.22),angle=WIND[wind];
 const phi=angle*Math.PI/180, origin={lat,lon};
 const xy=(p)=>{const d=I.distanceKm(origin,p),dlat=(p.lat-lat)*Math.PI/180,dlon=(p.lon-lon)*Math.PI/180,lat1=lat*Math.PI/180,lat2=p.lat*Math.PI/180,bearing=Math.atan2(Math.sin(dlon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dlon));return {along:d*Math.cos(bearing-phi),cross:d*Math.sin(bearing-phi),distance:d};};
 const ring=[];for(let i=0;i<=96;i++){const t=i*2*Math.PI/96,along=length*(1+Math.cos(t))/2,cross=width*Math.sin(t),distance=Math.hypot(along,cross),bearing=angle+Math.atan2(cross,along)*180/Math.PI;ring.push(I.destination(lat,lon,distance,bearing));}ring[96]=ring[0].slice();
 const nearby=[],ash=[];for(const p of regions){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;const q=xy(p),n=p.short||p.name||p.id;if(q.distance<=radius)nearby.push(n);else if(q.along>=0&&q.along<=length&&((q.along-length/2)/(length/2))**2+(q.cross/width)**2<=1)ash.push(n);}
 const quakeMagnitude=Math.min(6,2+vei*.45);
 return {lat,lon,vei,wind,radius,length,width,nearby,ash,quakeMagnitude,features:[
  {type:'Feature',properties:{name:'훈련 · 화산재 가상 영향 구역',color:'#d8ad4f',detail:`가상 바람 방향 ${wind} · 길이 ${length}km · 실제 화산재 예측 아님`},geometry:{type:'Polygon',coordinates:[ring]}},
  {type:'Feature',properties:{name:'훈련 · 근거리 가상 피해 구역',color:'#f15f41',detail:`화구 주변 임의 반경 ${radius}km · 화산탄·화쇄류 피해 상황 시연 · 실제 피해 범위 아님`},geometry:{type:'Polygon',coordinates:[Array.from({length:97},(_,i)=>I.destination(lat,lon,radius,i*360/96))]}},
  {type:'Feature',properties:{name:'훈련 · 모의 화산',color:'#ff783d',detail:`VEI ${vei} · 가상 화산성 지진 M ${quakeMagnitude.toFixed(1)} · 실제 경보 아님`},geometry:{type:'Point',coordinates:[lon,lat]}}
 ]};
}
const api={insideRing,landAt,lines,realTsunami,tsunamiLevel,waterDistances,tsunami,volcano};root.GQHazardCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
