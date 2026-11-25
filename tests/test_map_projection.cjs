const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const model=require('../site/assets/intensity-model.js');
const context={window:{GQIntensityModel:model},document:{readyState:'loading',getElementById:()=>null,addEventListener:()=>{}},console,Map,Set,Number,Math};
vm.createContext(context);
vm.runInContext(fs.readFileSync('site/assets/real-map.js','utf8')+`;\npolygons=[{type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{iso:'KOR',id:'KR-47',lat:36.5,lon:128.5,name:'경북'}}];regionCenters=[];this.projectedZonesForTest=projectedZones;`,context);
const event={source:'KMA',reportedAreas:{'KR-47':{value:'4'}},latitude:36.52,longitude:127.96,magnitude:3.6,depthKm:20};
const result=context.projectedZonesForTest(event,'hybrid');
assert.equal(result.zones.length,1);assert.equal(result.zones[0].properties.kind,'reported');assert.equal(result.zones[0].properties.intensityLabel,'4');
console.log('KMA regional data produces a reported-intensity map polygon.');
