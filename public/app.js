'use strict';
const M=ObservatoryModel,C=window.OBSERVATORY_CONFIG||{},$=id=>document.getElementById(id);
let data=M.demo(),mode='demo',view='overview';
const text=(id,value)=>$(id).textContent=value;
const formatTime=at=>new Date(at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const value=(n,unit='W')=>Number.isFinite(n)?(unit==='W'?(n/1000).toFixed(2):unit==='%'?Math.round(n):n.toFixed(1)):'—';
const unitLabel=unit=>unit==='W'?'kW':unit;
function message(s){text('message',s);}
function show(next){view=['overview','thermal','history','connect'].includes(next)?next:'overview';document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});text('page-title',({overview:C.title||'Home, in view.',thermal:'Heating, understood.',history:'A little perspective.',connect:'Make it yours.'})[view]);render();}
function card(label,n,unit,note,kind='') {const el=document.createElement('article');el.className='card energy-card '+kind;const l=document.createElement('div');l.className='label';l.textContent=label;const r=document.createElement('div');r.className='reading';r.textContent=value(n,unit);const u=document.createElement('small');u.textContent=unitLabel(unit);r.append(u);const p=document.createElement('p');p.textContent=note;el.append(l,r,p);return el;}
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
  const status=await response.json(),live=status.latest;
  statusEl.className='tibber-state'+(status.status==='connected'&&!status.stale?' online':' offline');
  statusEl.textContent=status.status==='connected'&&!status.stale?'CONNECTED · LIVE':String(status.status||'UNKNOWN').toUpperCase().replaceAll('_',' ');
  const kw=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?(Number(n)/1000).toFixed(2)+' kW':'—';
  $('tibber-power').textContent=live?kw(live.power):'—';
  $('tibber-average').textContent=live?kw(live.averagePower):'—';
  $('tibber-peak').textContent=live?kw(live.maxPower):'—';
  $('tibber-solar').textContent=live?kw(live.powerProduction):'—';
  if(live){
   const when=new Date(live.timestamp).toLocaleString();
   detail.textContent=(status.homeName||'Tibber home')+' · Measurement '+when+' · '+(status.stale?'Latest reading is older than 3 minutes.':'Live data received.')+' Values here come directly from Tibber; the demo cards below are synthetic examples.';
  }else detail.textContent=(status.message||'No live measurement received yet.')+' The dashboard demo values below are synthetic and are not your home readings.';
 }catch(error){
  statusEl.className='tibber-state offline';
  statusEl.textContent='UNAVAILABLE';
  detail.textContent='Could not read Tibber status: '+error.message+' Demo cards below are synthetic examples.';
 }
}

function render(){const latest=M.latest(data),v=latest.values,stale=M.age(data)>90000;let badge=mode==='demo'?'SYNTHETIC DEMO':mode==='recorder'?(data.source.toLowerCase().includes('synthetic')?'SYNTHETIC / RECORDER':stale?'RECORDER / STALE':'RECORDER / RECENT'):'IMPORTED / RECORDED';text('mode-badge',badge);text('dataset-label',data.source);text('clock',new Date().toLocaleString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'}));text('data-time',(mode==='demo'?'Synthetic sample':'Latest recorded sample')+' · '+formatTime(latest.at));text('scene-source',mode==='demo'?'SAMPLE HOME':'YOUR IMPORTED READINGS');text('subtitle',C.subtitle||'One place to understand your home.');
 $('energy-cards').replaceChildren(card('SOLAR GENERATION',v.solar,'W','Panel production only.','solar'),card('SITE CONSUMPTION',v.siteLoad,'W','Whole property demand.','load'),card(Number.isFinite(v.gridNet)&&v.gridNet<0?'GRID / EXPORT':'GRID / IMPORT',Number.isFinite(v.gridNet)?Math.abs(v.gridNet):null,'W','Positive import · negative export.','grid'),card('BATTERY CHARGE',v.batterySOC,'%','Charge level, not power.','battery'));
 $('split').replaceChildren();for(const [label,n] of [['Total site',v.siteLoad],[C.garageLabel||'Garage',v.garage],[C.houseLabel||'House',M.houseLoad(v)]]){const row=document.createElement('div');row.className='split-row';const name=document.createElement('span');name.textContent=label;const val=document.createElement('b');val.textContent=value(n)+' kW';row.append(name,val);$('split').append(row)}
 $('thermal-cards').replaceChildren(card('HOT WATER',v.hotWater,'°C','Latest recorded temperature.','load'),card('OUTDOOR',v.outdoor,'°C','Latest recorded temperature.','battery'),card('COMPRESSOR',v.compressor,'Hz','Frequency is not input power.','solar'));
 if(view==='overview')chart('energy-chart',['solar','siteLoad'],subset(Number($('overview-range').value)));
 if(view==='thermal'){chart('thermal-chart',['hotWater'],subset());chart('compressor-chart',['compressor'],subset());}
 if(view==='history'){const key=$('metric').value;chart('explore-chart',[key],data.samples);const n=data.samples.filter(s=>Number.isFinite(s.values[key])).length;text('coverage',n+' of '+data.samples.length+' samples contain this reading. Missing values and gaps over 10 minutes break the line. Chart times use your browser’s local timezone.');text('table-metric',M.metrics[key].label+' / '+unitLabel(M.metrics[key].unit));$('samples-table').replaceChildren();data.samples.slice(-12).reverse().forEach(s=>{const row=document.createElement('tr');[formatTime(s.at),Number.isFinite(s.values[key])?value(s.values[key],M.metrics[key].unit):'Unavailable'].forEach(t=>{const td=document.createElement('td');td.textContent=t;row.append(td)});$('samples-table').append(row)});}
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
