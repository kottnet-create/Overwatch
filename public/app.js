'use strict';
const M=ObservatoryModel,C=window.OBSERVATORY_CONFIG||{},$=id=>document.getElementById(id);
let data=M.demo(),mode='connecting',view='overview',tibberLive=null,tibberHistory=[];
const text=(id,value)=>$(id).textContent=value;
const formatTime=at=>new Date(at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const value=(n,unit='W')=>Number.isFinite(n)?(unit==='W'?(n/1000).toFixed(2):unit==='%'?Math.round(n):n.toFixed(1)):'—';
const unitLabel=unit=>unit==='W'?'kW':unit;
const powerDisplay=n=>Number.isFinite(n)?(Math.abs(n)<1000?Math.round(n)+' W':(n/1000).toFixed(2)+' kW'):'—';
function message(s){text('message',s);}
function show(next){view=['overview','thermal','history','connect'].includes(next)?next:'overview';document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});text('page-title',({overview:C.title||'Home, in view.',thermal:'Heating, understood.',history:'A little perspective.',connect:'Make it yours.'})[view]);render();}
function card(label,n,unit,note,kind='') {const el=document.createElement('article');el.className='card energy-card '+kind;const l=document.createElement('div');l.className='label';l.textContent=label;const r=document.createElement('div');r.className='reading';r.textContent=unit==='W'?powerDisplay(n):value(n,unit);if(unit!=='W'){const u=document.createElement('small');u.textContent=unitLabel(unit);r.append(u);}const p=document.createElement('p');p.textContent=note;el.append(l,r,p);return el;}
function subset(hours=24){const to=Date.parse(data.samples.at(-1).at);return data.samples.filter(s=>Date.parse(s.at)>=to-hours*3600000);}
function chart(id,keys,samples){const el=$(id);el.replaceChildren();const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 230');svg.setAttribute('role','img');svg.setAttribute('aria-label',keys.map(k=>M.metrics[k].label).join(' and ')+' over time');
 const finite=samples.flatMap(s=>keys.map(k=>s.values[k])).filter(Number.isFinite);if(!finite.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No readings in this range.';el.append(empty);return}
 let min=Math.min(...finite),max=Math.max(...finite);if(min===max){min-=1;max+=1}const pad=(max-min)*.12;min-=pad;max+=pad;const first=Date.parse(samples[0].at),end=Date.parse(samples.at(-1).at);
 function element(type,attributes,content){const e=document.createElementNS(ns,type);Object.entries(attributes).forEach(([k,v])=>e.setAttribute(k,v));if(content!==undefined)e.textContent=content;svg.append(e);return e;}
 for(let i=0;i<=3;i++){const y=20+i*58;element('line',{x1:48,x2:780,y1:y,y2:y,stroke:'#35432f'});element('text',{x:1,y:y+4},((max-i*(max-min)/3)/(M.metrics[keys[0]].unit==='W'?1000:1)).toFixed(1));}
 keys.forEach(key=>{let points=[],prev=null;function flush(){if(!points.length)return;element('polyline',{points:points.map(p=>p.slice(0,2).join(',')).join(' '),fill:'none',stroke:M.metrics[key].color,'stroke-width':2,'stroke-linejoin':'round'});for(const p of points){const single=points.length===1;const dot=element('circle',{cx:p[0],cy:p[1],r:3,fill:M.metrics[key].color,opacity:single?'1':'0','tabindex':single?'0':'-1'});const t=document.createElementNS(ns,'title');t.textContent=M.metrics[key].label+': '+value(p[2].values[key],M.metrics[key].unit)+' '+unitLabel(M.metrics[key].unit)+' · '+formatTime(p[2].at);dot.append(t);dot.onpointerenter=()=>dot.setAttribute('opacity','1');dot.onpointerleave=()=>dot.setAttribute('opacity',single?'1':'0');}points=[];}
 for(const s of samples){const n=s.values[key],at=Date.parse(s.at);if(!Number.isFinite(n)){flush();prev=null;continue}if(prev!==null&&at-prev>600000)flush();points.push([48+(at-first)/Math.max(1,end-first)*732,20+(max-n)/(max-min)*174,s]);prev=at;}flush();});
 element('text',{x:48,y:220},new Date(first).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));element('text',{x:780,y:220,'text-anchor':'end'},new Date(end).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));el.append(svg);
}

async function refreshTibber(){
 const statusEl=$('tibber-status'), detail=$('tibber-detail');
 if(!statusEl||!detail)return;
 try{
  const response=await fetch('./api/tibber/status',{cache:'no-store'});
  if(!response.ok)throw new Error('Tibber status endpoint returned HTTP '+response.status);
  const status=await response.json(),live=status.latest;tibberLive=(status.status==='connected'&&!status.stale&&live)?status:null;if(tibberLive)mode='live';
  if(status.historyCount!==tibberHistory.length){const historyResponse=await fetch('./api/tibber/history',{cache:'no-store'});if(historyResponse.ok){const saved=await historyResponse.json();tibberHistory=Array.isArray(saved.samples)?saved.samples:[];}}
  statusEl.className='tibber-state'+(status.status==='connected'&&!status.stale?' online':' offline');
  statusEl.textContent=status.status==='connected'&&!status.stale?'CONNECTED · LIVE':String(status.status||'UNKNOWN').toUpperCase().replaceAll('_',' ');
  const kw=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?powerDisplay(Number(n)):'—';
  $('tibber-power').textContent=live?kw(live.power):'—';
  $('tibber-average').textContent=live?kw(live.averagePower):'—';
  $('tibber-peak').textContent=live?kw(live.maxPower):'—';
  $('tibber-solar').textContent=live?kw(live.powerProduction):'—';
  if(live){
   const when=new Date(live.timestamp).toLocaleString();
   detail.textContent=(status.homeName||'Tibber home')+' · Measurement '+when+' · '+(status.stale?'Latest reading is older than 3 minutes.':'Live data received.')+' Saved locally: '+(status.historyCount||0)+' samples at 5-minute intervals. '+(status.historyError||'Other device data is not connected yet.');
  }else detail.textContent=(status.message||'No live measurement received yet.')+' The dashboard demo values below are synthetic and are not your home readings.';
 }catch(error){
  tibberLive=null;
  statusEl.className='tibber-state offline';
  statusEl.textContent='UNAVAILABLE';
  detail.textContent='Could not read Tibber status: '+error.message+' Demo cards below are synthetic examples.';
 }
}

function tibberChart(id,samples,hours=24){
 const el=$(id);el.replaceChildren();
 const end=Date.now(),start=end-hours*3600000,rows=samples.filter(s=>Date.parse(s.timestamp)>=start&&Date.parse(s.timestamp)<=end);
 const keys=[{key:'power',label:'Tibber power',color:'#ff7a24'},{key:'powerProduction',label:'PV production',color:'#63a9d8'}];
 const values=rows.flatMap(s=>keys.map(k=>s[k.key])).filter(Number.isFinite);
 if(rows.length<2||!values.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=rows.length?'Collecting more live samples for this chart.':'Tibber history is being collected. Keep Overwatch running.';el.append(empty);return;}
 let min=Math.min(0,...values),max=Math.max(...values);if(min===max)max=min+1;const pad=(max-min)*.1;min-=pad;max+=pad;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 230');svg.setAttribute('role','img');svg.setAttribute('aria-label','Tibber power and reported solar production history');
 const add=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(txt!==undefined)e.textContent=txt;svg.append(e);return e;};
 for(let i=0;i<=3;i++){const y=20+i*58;add('line',{x1:48,x2:780,y1:y,y2:y,stroke:'#35432f'});add('text',{x:2,y:y+4},((max-i*(max-min)/3)/1000).toFixed(1));}
 for(const k of keys){let segment=[],prev=null;const flush=()=>{if(segment.length>1)add('polyline',{points:segment.map(p=>p.join(',')).join(' '),fill:'none',stroke:k.color,'stroke-width':2,'stroke-linejoin':'round'});segment=[];};for(const s of rows){const n=s[k.key],at=Date.parse(s.timestamp);if(!Number.isFinite(n)){flush();prev=null;continue;}if(prev!==null&&at-prev>10*60*1000)flush();segment.push([48+(at-start)/Math.max(1,end-start)*732,20+(max-n)/(max-min)*174]);prev=at;}flush();}
 add('text',{x:48,y:220},new Date(start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));add('text',{x:780,y:220,'text-anchor':'end'},new Date(end).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));
 const legend=document.createElement('div');legend.className='chart-legend';for(const k of keys){if(rows.some(s=>Number.isFinite(s[k.key]))){const item=document.createElement('span');item.textContent='● '+k.label;item.style.color=k.color;legend.append(item);}}
 el.append(legend,svg);
}

function render(){
 const latest=M.latest(data),v=latest.values,stale=M.age(data)>90000;
 const live=Boolean(tibberLive&&tibberLive.latest);
 const t=live?tibberLive.latest:null;
 const badge=live?'TIBBER LIVE':mode==='demo'?'SYNTHETIC DEMO':mode==='recorder'?(data.source.toLowerCase().includes('synthetic')?'SYNTHETIC / RECORDER':stale?'RECORDER / STALE':'RECORDER / RECENT'):'IMPORTED / RECORDED';
 text('mode-badge',badge);
 text('dataset-label',live?'Tibber Pulse · live measurements':'Synthetic demo · not a real home');
 text('clock',new Date().toLocaleString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'}));
 text('data-time',live?'Latest Tibber measurement · '+formatTime(t.timestamp):(mode==='demo'?'Synthetic sample':'Latest recorded sample')+' · '+formatTime(latest.at));
 text('scene-source',live?'LIVE TIBBER DATA':mode==='demo'?'SAMPLE HOME':'YOUR IMPORTED READINGS');
 text('subtitle',C.subtitle||'One place to understand your home.');
 if(live){
  $('energy-cards').replaceChildren(
   card('TIBBER POWER',t.power,'W','Live reading from the main meter.','grid'),
   card('SOLAR PRODUCTION',t.powerProduction,'W','Reported by Tibber, if available.','solar'),
   card('AVERAGE POWER',t.averagePower,'W','Tibber live-measurement average.','load'),
   card('PEAK POWER',t.maxPower,'W','Tibber live-measurement peak.','battery')
  );
 }else{
  $('energy-cards').replaceChildren(
   card('SOLAR GENERATION',v.solar,'W','Synthetic example only.','solar'),
   card('SITE CONSUMPTION',v.siteLoad,'W','Synthetic example only.','load'),
   card('GRID EXCHANGE',v.gridNet,'W','Synthetic example only.','grid'),
   card('BATTERY CHARGE',v.batterySOC,'%','Synthetic example only.','battery')
  );
 }
 $('split').replaceChildren();
 const rows=live
  ?[['Battery charge','Not connected'],['Whole-home breakdown','Not available yet'],['Historical readings','Collection not enabled']]
  :[['Total site',value(v.siteLoad)+' kW'],[C.garageLabel||'Garage',value(v.garage)+' kW'],[C.houseLabel||'House',value(M.houseLoad(v))+' kW']];
 for(const [label,n] of rows){
  const row=document.createElement('div');row.className='split-row';
  const name=document.createElement('span');name.textContent=label;
  const val=document.createElement('b');val.textContent=n;
  row.append(name,val);$('split').append(row);
 }
 if(live){
  $('thermal-cards').replaceChildren(
   card('HOT WATER',null,'°C','NIBE is not connected yet.','load'),
   card('OUTDOOR',null,'°C','NIBE is not connected yet.','battery'),
   card('COMPRESSOR',null,'Hz','NIBE is not connected yet.','solar')
  );
 }else{
  $('thermal-cards').replaceChildren(
   card('HOT WATER',v.hotWater,'°C','Synthetic example only.','load'),
   card('OUTDOOR',v.outdoor,'°C','Synthetic example only.','battery'),
   card('COMPRESSOR',v.compressor,'Hz','Synthetic example only.','solar')
  );
 }
 if(view==='overview'){
  if(live){
   const el=$('energy-chart');el.replaceChildren();
   const empty=document.createElement('div');empty.className='empty';
   tibberChart('energy-chart',tibberHistory,Number($('overview-range').value));
  }else chart('energy-chart',['solar','siteLoad'],subset(Number($('overview-range').value)));
 }
 if(view==='thermal'){
  if(live){
   for(const id of ['thermal-chart','compressor-chart']){
    const el=$(id);el.replaceChildren();
    const empty=document.createElement('div');empty.className='empty';
    empty.textContent='NIBE readings are not connected yet.';el.append(empty);
   }
  }else{
   chart('thermal-chart',['hotWater'],subset());
   chart('compressor-chart',['compressor'],subset());
  }
 }
 if(view==='history'){
  const key=$('metric').value;
  if(live){
   $('explore-chart').replaceChildren();
   const empty=document.createElement('div');empty.className='empty';
   tibberChart('explore-chart',tibberHistory,Number($('overview-range').value));
   text('coverage',tibberHistory.length+' locally stored Tibber samples. Sampling interval: 5 minutes.');
   $('samples-table').replaceChildren();
  }else{
   chart('explore-chart',[key],data.samples);
   const n=data.samples.filter(s=>Number.isFinite(s.values[key])).length;
   text('coverage',n+' of '+data.samples.length+' samples contain this reading. Missing values and gaps over 10 minutes break the line. Chart times use your browser’s local timezone.');
   text('table-metric',M.metrics[key].label+' / '+unitLabel(M.metrics[key].unit));
   $('samples-table').replaceChildren();
   data.samples.slice(-12).reverse().forEach(s=>{
    const row=document.createElement('tr');
    [formatTime(s.at),Number.isFinite(s.values[key])?value(s.values[key],M.metrics[key].unit):'Unavailable'].forEach(t=>{
     const td=document.createElement('td');td.textContent=t;row.append(td);
    });
    $('samples-table').append(row);
   });
  }
 }
}
for(const [key,m] of Object.entries(M.metrics)){const o=document.createElement('option');o.value=key;o.textContent=m.label;$('metric').append(o)}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.view});document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.go});window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
$('metric').onchange=render;$('overview-range').onchange=render;
$('demo').onclick=()=>{data=M.demo();mode='demo';message('Demo restored. All values are synthetic.');render()};
$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>2*1024*1024)throw Error('File too large. Keep it below 2 MB.');const next=M.validate(JSON.parse(await f.text()));data=next;mode='import';message('Imported '+data.samples.length+' samples. They stay in this tab; export to keep a copy.');render()}catch(error){message('Could not import: '+error.message)}finally{e.target.value=''}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=mode==='demo'?'observatory-synthetic-demo.json':'observatory-readings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported the current dataset. Review your own readings before sharing them.');};
$('recorder').onclick=async()=>{try{if(location.protocol==='file:')throw Error('Start the optional local server with npm start, then open its printed address.');const response=await fetch('./api/history',{cache:'no-store'});if(!response.ok)throw Error('Recorder history is unavailable. Start the included local server and recorder; see README.');const next=M.validate(await response.json());data=next;mode='recorder';message('Loaded local recorder history. Click again to refresh; this is a snapshot.');render()}catch(e){message(e.message)}};
if(C.illustration && !/^(?:https?:|\/\/|data:|javascript:)/i.test(C.illustration))$('house-art').src=C.illustration;
$('house-art').onerror=()=>{$('house-art').onerror=null;$('house-art').src='./assets/starter-house.svg';message('Custom artwork was unavailable. Using the included generic illustration.')};
show(location.hash.slice(1));refreshTibber();setInterval(()=>{if(!document.hidden){render();refreshTibber()}},15000);
