'use strict';
const M=ObservatoryModel,C=window.OBSERVATORY_CONFIG||{},$=id=>document.getElementById(id);
let data=M.demo(),mode='connecting',view='overview',tibberLive=null,tibberHistory=[],tibberPrices=null,nibePoints=[],nibePointUpdated=null,nibeHistoryRows=[],nibeLoadState='loading';
const text=(id,value)=>$(id).textContent=value;
const formatTime=at=>new Date(at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const value=(n,unit='W')=>Number.isFinite(n)?(unit==='W'?(n/1000).toFixed(2):unit==='%'?Math.round(n):n.toFixed(1)):'—';
const unitLabel=unit=>unit==='W'?'kW':unit;
const powerDisplay=n=>Number.isFinite(n)?(Math.abs(n)<1000?Math.round(n)+' W':(n/1000).toFixed(2)+' kW'):'—';
function message(s){text('message',s);}
function show(next){view=['overview','thermal','history','connections','cameras','connect'].includes(next)?next:'overview';document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});text('page-title',({overview:C.title||'Home, in view.',thermal:'Heating, understood.',history:'A little perspective.',connections:'Your connected systems.',cameras:'Cameras around your home.',connect:'Make it yours.'})[view]);render();}
function card(label,n,unit,note,kind='') {const el=document.createElement('article');el.className='card energy-card '+kind;const l=document.createElement('div');l.className='label';l.textContent=label;const r=document.createElement('div');r.className='reading';r.textContent=typeof n==='string'?n:unit==='W'?powerDisplay(n):value(n,unit);if(unit!=='W'){const u=document.createElement('small');u.textContent=unitLabel(unit);r.append(u);}const p=document.createElement('p');p.textContent=note;el.append(l,r,p);return el;}
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

const COMPRESSOR_FREQUENCY_PARAMETER_ID='43122';
const isCompressorFrequencyPoint=p=>String(p?.parameterId??p?.id??'')===COMPRESSOR_FREQUENCY_PARAMETER_ID||/compressor.*frequency|frequency.*compressor|kompressor.*frekvens|frekvens.*kompressor|compressor.*speed|kompressor.*hastighet/i.test(String(p?.parameterName||p?.name||''));
function renderNibeHistoryChart(id,pattern,label,unit,parameterId=null){
 const host=$(id);if(!host)return;host.replaceChildren();
 const rows=nibeHistoryRows.filter(p=>(parameterId&&String(p.parameterId)===String(parameterId)||pattern.test(String(p.parameterName||'')))&&Number.isFinite(Number(p.value))).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 if(!rows.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No stored NIBE history yet. The first sample is collected when the local server starts.';host.append(empty);return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 230');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' from locally stored NIBE readings');
 const vals=rows.map(p=>Number(p.value));let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=1;max+=1;}const pad=(max-min)*.12;min-=pad;max+=pad;
 const first=Date.parse(rows[0].timestamp),last=Date.parse(rows.at(-1).timestamp);
 const add=(tag,attrs,txt)=>{const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));if(txt!==undefined)el.textContent=txt;svg.append(el);return el;};
 for(let i=0;i<=3;i++){const y=20+i*58;add('line',{x1:48,x2:780,y1:y,y2:y,stroke:'#35432f'});add('text',{x:1,y:y+4},(max-i*(max-min)/3).toFixed(1));}
 let segment=[],prev=null;const flush=()=>{if(!segment.length)return;if(segment.length===1)add('circle',{cx:segment[0][0],cy:segment[0][1],r:4,fill:'#ff7a24'});else add('polyline',{points:segment.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#ff7a24','stroke-width':2.5,'stroke-linejoin':'round'});segment=[];};
 for(const row of rows){const at=Date.parse(row.timestamp),n=Number(row.value);if(prev!==null&&at-prev>10*60*1000)flush();const x=48+(at-first)/Math.max(1,last-first)*732,y=20+(max-n)/(max-min)*174;segment.push([x,y]);prev=at;}flush();
 add('text',{x:48,y:220},new Date(first).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));
 add('text',{x:780,y:220,'text-anchor':'end'},new Date(last).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));
 host.append(svg);
}
function nibeRowsFor(parameterId,parameterName){
 return nibeHistoryRows.filter(r=>(parameterId&&String(r.parameterId)===String(parameterId))||(!parameterId&&r.parameterName===parameterName)).sort((x,y)=>Date.parse(x.timestamp)-Date.parse(y.timestamp));
}
function nibeSparkline(rows){
 const values=rows.map(r=>Number(r.value)).filter(Number.isFinite);if(!values.length)return '';
 const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
 return '<svg viewBox="0 0 220 58" aria-hidden="true"><polyline fill="none" stroke="#ff7a24" stroke-width="2.5" points="'+rows.map((r,i)=>{const n=Number(r.value);return (i/(Math.max(1,rows.length-1))*216+2)+','+(52-(n-min)/range*46)}).join(' ')+'"/></svg>';
}
function ensureNibeHistoryDialog(){
 let dialog=$('nibe-history-dialog');if(dialog)return dialog;
 dialog=document.createElement('dialog');dialog.id='nibe-history-dialog';dialog.className='nibe-history-dialog';
 dialog.innerHTML='<div class="nibe-dialog-head"><div><div class="eyebrow">NIBE / LOCAL HISTORY</div><h2 id="nibe-dialog-title">Reading history</h2><p id="nibe-dialog-meta" class="note"></p></div><button type="button" id="nibe-dialog-close" aria-label="Close history">✕</button></div><div class="nibe-dialog-range"><label for="nibe-dialog-hours">Period</label><select id="nibe-dialog-hours"><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></div><div id="nibe-dialog-chart" class="chart tall"></div><div class="table-scroll"><table><thead><tr><th>Time</th><th>Value</th></tr></thead><tbody id="nibe-dialog-table"></tbody></table></div>';
 document.body.append(dialog);
 $('nibe-dialog-close').onclick=()=>dialog.close();
 $('nibe-dialog-hours').onchange=()=>drawNibeDialog(dialog.dataset.parameterId,dialog.dataset.parameterName,dialog.dataset.unit);
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
 return dialog;
}
function drawNibeDialog(parameterId,parameterName,unit){
 const dialog=ensureNibeHistoryDialog(),hours=Number($('nibe-dialog-hours').value||24);
 const rows=nibeRowsFor(parameterId,parameterName).filter(r=>Date.parse(r.timestamp)>=Date.now()-hours*3600000);
 $('nibe-dialog-title').textContent=parameterName;
 $('nibe-dialog-meta').textContent=rows.length+' locally stored samples · '+unit+' · 30-day retention';
 const chartHost=$('nibe-dialog-chart');chartHost.replaceChildren();
 if(rows.length<1){const empty=document.createElement('div');empty.className='empty';empty.textContent='No saved readings for this input in the selected period yet.';chartHost.append(empty);}
 else{
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 230');
  const vals=rows.map(r=>Number(r.value)),min=Math.min(...vals),max=Math.max(...vals),spread=max-min||1,first=Date.parse(rows[0].timestamp),last=Date.parse(rows.at(-1).timestamp);
  for(let i=0;i<=3;i++){const y=20+i*58,line=document.createElementNS(ns,'line');line.setAttribute('x1','48');line.setAttribute('x2','780');line.setAttribute('y1',y);line.setAttribute('y2',y);line.setAttribute('stroke','#35432f');svg.append(line);}
  let seg=[],prev=null;const flush=()=>{if(!seg.length)return;const line=document.createElementNS(ns,'polyline');line.setAttribute('points',seg.join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#ff7a24');line.setAttribute('stroke-width','2.5');svg.append(line);seg=[];};
  rows.forEach(r=>{const at=Date.parse(r.timestamp);if(prev!==null&&at-prev>10*60*1000)flush();const x=48+(at-first)/Math.max(1,last-first)*732,y=20+(max-Number(r.value))/spread*174;seg.push(x+','+y);prev=at;});flush();
  const label=document.createElementNS(ns,'text');label.setAttribute('x','48');label.setAttribute('y','220');label.textContent=new Date(first).toLocaleString();svg.append(label);const endLabel=document.createElementNS(ns,'text');endLabel.setAttribute('x','780');endLabel.setAttribute('y','220');endLabel.setAttribute('text-anchor','end');endLabel.textContent=new Date(last).toLocaleString();svg.append(endLabel);chartHost.append(svg);
 }
 const body=$('nibe-dialog-table');body.replaceChildren();rows.slice(-30).reverse().forEach(r=>{const tr=document.createElement('tr'),t=document.createElement('td'),v=document.createElement('td');t.textContent=new Date(r.timestamp).toLocaleString();v.textContent=Number(r.value).toFixed(2)+' '+unit;tr.append(t,v);body.append(tr);});
 if(!dialog.open)dialog.showModal();
}
function makeNibeCard(p){
 const rawLabel=String(p.parameterName||p.name||p.parameterId||'NIBE input').replace(/\\boffset\\b/ig,'').replace(/\\s+/g,' ').trim(),label=isCompressorFrequencyPoint(p)?'Compressor activity':rawLabel,id=String(p.parameterId??p.id??label),unit=String(p.parameterUnit||p.unit||''),n=p.value===-32768||p.value===null||p.value===undefined?null:Number(p.value);
 const el=card(label,n,unit,p.timestamp?'Updated '+new Date(p.timestamp).toLocaleTimeString():'Current myUplink value',/BT1|outdoor|utomhus/i.test(label)?'battery':'load');
 el.classList.add('nibe-click-card');el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Show history for '+label);
 const preview=document.createElement('div');preview.className='nibe-hover-preview';const rows=nibeRowsFor(id,label);preview.innerHTML=rows.length?nibeSparkline(rows):'<span>No local history yet</span>';
 const caption=document.createElement('small');caption.textContent=rows.length?rows.length+' saved samples · click for details':'History starts collecting locally';preview.append(caption);el.append(preview);
 const open=()=>drawNibeDialog(id,label,unit);
 el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
 return el;
}
function renderNibeCards(){
 const host=$('thermal-cards');if(!host)return;
 if(!nibePoints.length){host.replaceChildren(card('NIBE INPUTS',null,'','Waiting for myUplink readings.','load'));return;}
 const seen=new Set(),points=nibePoints.filter(p=>{
  const id=String(p.parameterId??p.id??p.parameterName??p.name??''),name=String(p.parameterName||p.name||'');
  const wanted=!/\boffset\b/i.test(name)&&(/\bBT(?:1|2|3|6|7|10|11|12|50)\b/i.test(name)||isCompressorFrequencyPoint(p));
  if(!wanted||!id||seen.has(id))return false;seen.add(id);
  return p.value!==undefined&&p.value!==null&&Number.isFinite(Number(p.value))&&Number(p.value)!==-32768;
 });
 const order=['BT50','BT1','BT6','BT10','BT11','BT2'];
 const rank=point=>{const name=String(point.parameterName||point.name||'');const match=name.match(/\bBT(?:1|2|3|6|7|10|11|12|50)\b/i);const code=match?match[0].toUpperCase():'';const index=order.indexOf(code);return index<0?order.length:index;};
 points.sort((a,b)=>rank(a)-rank(b));
 host.replaceChildren(...points.map(makeNibeCard));
}

function wireNibeSpecialHistoryCards(){
 const specs=[{id:'thermal-chart',pattern:/\\(BT7\\)|varmvatten topp/i,label:'Hot-water temperature'},{id:'compressor-chart',pattern:/compressor.*frequency|kompressor.*frekvens|compressor.*speed|kompressor.*hastighet/i,label:'Compressor activity',match:isCompressorFrequencyPoint}];
 for(const spec of specs){const host=$(spec.id),panel=host?.closest('.chart-card');if(!panel)continue;const point=nibePoints.find(p=>spec.match?spec.match(p):spec.pattern.test(String(p.parameterName||p.name||'')));if(!point)continue;
  const pid=String(point.parameterId??point.id??point.parameterName??point.name),unit=String(point.parameterUnit||point.unit||'');
  panel.classList.add('nibe-click-card','nibe-special-card');panel.tabIndex=0;panel.setAttribute('role','button');panel.setAttribute('aria-label','Show history for '+spec.label);
  if(!panel.querySelector('.nibe-hover-preview')){const preview=document.createElement('div');preview.className='nibe-hover-preview';const rows=nibeRowsFor(pid,spec.label);preview.innerHTML=rows.length?nibeSparkline(rows):'<span>No local history yet</span>';const caption=document.createElement('small');caption.textContent=rows.length?rows.length+' saved samples · click for details':'History starts collecting locally';preview.append(caption);panel.append(preview);}
  panel.onclick=()=>drawNibeDialog(pid,spec.label,unit);panel.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();drawNibeDialog(pid,spec.label,unit);}};
 }
}
async function refreshMyUplink(){
 nibeLoadState='loading';
 const statusEl=$('myuplink-status'),detail=$('myuplink-detail'),systemsEl=$('myuplink-systems'),connect=$('myuplink-connect');
 if(!statusEl||!detail||!systemsEl)return;
 try{
  const response=await fetch('./api/myuplink/status',{cache:'no-store'});
  if(!response.ok)throw new Error('myUplink status HTTP '+response.status);
  const status=await response.json();
  statusEl.className='tibber-state'+(status.connected?' online':' offline');
  statusEl.textContent=status.connected?'CONNECTED':'NOT CONNECTED';
  detail.textContent=status.connected?'myUplink account linked. Overwatch uses READSYSTEM only and sends GET requests.':'Connect your myUplink account to allow read-only access to the NIBE system.';
  connect.hidden=Boolean(status.connected);
  systemsEl.textContent='';
  if(status.connected){
   const r=await fetch('./api/myuplink/systems',{cache:'no-store'}),result=await r.json();
   if(!r.ok)throw new Error(result.error||'Could not read myUplink systems.');
   const payload=result.data||{},items=Array.isArray(payload)?payload:(payload.systems||payload.items||[]);
   const names=items.map(x=>x.name||x.systemName||x.title).filter(Boolean);
   systemsEl.textContent=items.length?'Found '+items.length+' system(s): '+(names.join(', ')||'myUplink system')+'. Reading device points…':'myUplink is connected, but no systems were returned.';
   statusEl.className='tibber-state online';statusEl.textContent='CONNECTED';
   const pr=await fetch('./api/myuplink/points',{cache:'no-store'}),pointResult=await pr.json();
   if(!pr.ok){systemsEl.textContent+=' Device points could not be loaded: '+(pointResult.error||'HTTP '+pr.status)+'.';return;}
   const devices=pointResult.devices||[],all=devices.flatMap(d=>(d.points||[]).map(p=>({...p,deviceName:d.deviceName||d.productName||'NIBE'})));
   nibePoints=all;nibePointUpdated=new Date().toISOString();
   const hr=await fetch('./api/myuplink/history?hours=720',{cache:'no-store'});
   if(hr.ok){const saved=await hr.json();nibeHistoryRows=Array.isArray(saved.samples)?saved.samples:[];}
   nibeLoadState=all.length?'ready':'empty';
   systemsEl.textContent+=' Found '+devices.length+' device(s) and '+all.length+' available data point(s).';
   if(pointResult.diagnostics?.length)systemsEl.textContent+=' Details: '+pointResult.diagnostics.map(d=>(d.deviceName||d.systemName||d.stage)+': '+d.error).join(' | ');
   render();

  }else{
   nibeLoadState='unavailable';render();
  }
 }catch(error){
  nibeLoadState='unavailable';
  statusEl.className='tibber-state offline';statusEl.textContent='UNAVAILABLE';
  detail.textContent='Could not check myUplink account: '+error.message;
  render();
 }
}
async function refreshTibber(){
 const statusEl=$('tibber-status'), detail=$('tibber-detail');
 if(!statusEl||!detail)return;
 try{
  const response=await fetch('./api/tibber/status',{cache:'no-store'});
  if(!response.ok)throw new Error('Tibber status endpoint returned HTTP '+response.status);
  const status=await response.json(),live=status.latest;tibberLive=(status.status==='connected'&&!status.stale&&live)?status:null;if(tibberLive)mode='live';
  if(status.historyCount!==tibberHistory.length){const historyResponse=await fetch('./api/tibber/history',{cache:'no-store'});if(historyResponse.ok){const saved=await historyResponse.json();tibberHistory=Array.isArray(saved.samples)?saved.samples:[];}}
  const priceResponse=await fetch('./api/spot-prices',{cache:'no-store'});if(priceResponse.ok)tibberPrices=await priceResponse.json();
  statusEl.className='tibber-state'+(status.status==='connected'&&!status.stale?' online':' offline');
  statusEl.textContent=status.status==='connected'&&!status.stale?'CONNECTED · LIVE':String(status.status||'UNKNOWN').toUpperCase().replaceAll('_',' ');
  const kw=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?powerDisplay(Number(n)):'—';
  $('tibber-power').textContent=live?kw(live.power):'—';
  $('tibber-average').textContent=live?kw(live.averagePower):'—';
  $('tibber-peak').textContent=live?kw(live.maxPower):'—';
  $('tibber-solar').textContent='Unavailable';
  if(live){
   const when=new Date(live.timestamp).toLocaleString();
   detail.textContent=(status.homeName||'Tibber home')+' · Measurement '+when+' · '+(status.stale?'Latest reading is older than 3 minutes.':'Live data received.')+' Saved locally: '+(status.historyCount||0)+' samples at 5-minute intervals. '+(status.historyError||'Other device data is not connected yet.');
  }else detail.textContent=(status.message||'No live measurement received yet.')+' The dashboard demo values below are synthetic and are not your home readings.';
  render();
 }catch(error){
  tibberLive=null;
  statusEl.className='tibber-state offline';
  statusEl.textContent='UNAVAILABLE';
  detail.textContent='Could not read Tibber status: '+error.message+' Demo cards below are synthetic examples.';
  render();
 }
}

function tibberChart(id,samples,hours=24){
 const el=$(id);el.replaceChildren();
 const end=Date.now(),start=end-hours*3600000,rows=samples.filter(s=>Date.parse(s.timestamp)>=start&&Date.parse(s.timestamp)<=end);
 const keys=[{key:'power',label:'Tibber grid power',color:'#ff7a24'}];
 const values=rows.flatMap(s=>keys.map(k=>s[k.key])).filter(Number.isFinite);
 if(rows.length<2||!values.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=rows.length?'Collecting more live samples for this chart.':'Tibber history is being collected. Keep Overwatch running.';el.append(empty);return;}
 let min=Math.min(...values),max=Math.max(...values);const spread=max-min;const pad=spread>0?spread*.12:Math.max(Math.abs(max)*.12,1);min-=pad;max+=pad;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 230');svg.setAttribute('role','img');svg.setAttribute('aria-label','Tibber grid power history');
 const add=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(txt!==undefined)e.textContent=txt;svg.append(e);return e;};
 for(let i=0;i<=3;i++){const y=20+i*58;add('line',{x1:48,x2:780,y1:y,y2:y,stroke:'#35432f'});add('text',{x:2,y:y+4},((max-i*(max-min)/3)/1000).toFixed(1));}
 for(const k of keys){let segment=[],prev=null;const flush=()=>{if(segment.length>1)add('polyline',{points:segment.map(p=>p.join(',')).join(' '),fill:'none',stroke:k.color,'stroke-width':2,'stroke-linejoin':'round'});segment=[];};for(const s of rows){const n=s[k.key],at=Date.parse(s.timestamp);if(!Number.isFinite(n)){flush();prev=null;continue;}if(prev!==null&&at-prev>10*60*1000)flush();segment.push([48+(at-start)/Math.max(1,end-start)*732,20+(max-n)/(max-min)*174]);prev=at;}flush();}
 add('text',{x:48,y:220},new Date(start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));add('text',{x:780,y:220,'text-anchor':'end'},new Date(end).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));
 const legend=document.createElement('div');legend.className='chart-legend';for(const k of keys){if(rows.some(s=>Number.isFinite(s[k.key]))){const item=document.createElement('span');item.textContent='● '+k.label;item.style.color=k.color;legend.append(item);}}
 el.append(legend,svg);
}

function renderPriceChart(){
 const status=$('price-status'),detail=$('price-detail'),chartEl=$('price-chart');
 if(!status||!detail||!chartEl)return;
 const p=tibberPrices;
 if(!p||!Array.isArray(p.prices)||!p.prices.length){
  status.className='tibber-state offline';status.textContent='NO PRICE DATA';
  $('price-current').textContent='—';$('price-low').textContent='—';$('price-high').textContent='—';
  chartEl.replaceChildren();const empty=document.createElement('div');empty.className='empty';empty.textContent=p?.error||'Waiting for Nord Pool SE3 prices.';chartEl.append(empty);
  detail.textContent='Spot price data is independent of Tibber Pulse. The source may be temporarily unavailable.';
  return;
 }
 const rows=[...p.prices].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
 const fmt=n=>Number.isFinite(n)?Math.round(n*100)+' öre/kWh':'—';
 $('price-current').textContent=fmt(p.current?.priceSekPerKwh);
 const vals=rows.map(x=>x.priceSekPerKwh).filter(Number.isFinite);
 const negativeRows=rows.filter(x=>Number.isFinite(x.priceSekPerKwh)&&x.priceSekPerKwh<0);
 const alertEl=$('price-alert');
 if(alertEl){if(negativeRows.length){const times=negativeRows.map(x=>new Date(x.startsAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));const unique=[...new Set(times)];alertEl.hidden=false;alertEl.textContent='VARNING · Negativt spotpris! '+negativeRows.length+' kvart(er) under 0 öre/kWh. '+(unique.length<=4?'Gäller kl. '+unique.join(', '):'Första period kl. '+unique[0]+' och sista kl. '+unique[unique.length-1]+'.');}else{alertEl.hidden=true;alertEl.textContent='';}}
 $('price-low').textContent=fmt(p.lowest?.priceSekPerKwh??Math.min(...vals));
 $('price-high').textContent=fmt(p.highest?.priceSekPerKwh??Math.max(...vals));
 status.className='tibber-state'+(p.stale?' offline':' online');
 status.textContent=p.stale?'CACHED · STALE':'NORD POOL · SE3';
 const first=Date.parse(rows[0].startsAt),last=Date.parse(rows.at(-1).startsAt)+15*60*1000;
 let min=Math.min(...vals),max=Math.max(...vals);const spread=max-min;const pad=spread>0?spread*.12:Math.max(Math.abs(max)*.12,0.02);min-=pad;max+=pad;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 250');svg.setAttribute('role','img');svg.setAttribute('aria-label','Nord Pool SE3 quarter-hourly spot prices');
 const add=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(txt!==undefined)e.textContent=txt;svg.append(e);return e;};
 for(let i=0;i<=4;i++){const y=20+i*48;add('line',{x1:50,x2:780,y1:y,y2:y,stroke:'#35432f'});add('text',{x:2,y:y+4},((max-i*(max-min)/4)*100).toFixed(0));}
 let segment=[],prev=null;const flush=()=>{if(segment.length>1)add('polyline',{points:segment.map(q=>q.join(',')).join(' '),fill:'none',stroke:'#ff7a24','stroke-width':3,'stroke-linejoin':'round'});segment=[];};
 for(const item of rows){const n=item.priceSekPerKwh,at=Date.parse(item.startsAt);if(!Number.isFinite(n)){flush();prev=null;continue;}if(prev!==null&&at-prev>20*60*1000)flush();segment.push([50+(at-first)/Math.max(1,last-first)*730,20+(max-n)/(max-min)*192]);prev=at;}flush();
 const now=Date.now(),currentStart=Date.parse(p.current?.startsAt||''),currentItem=rows.find(item=>Number.isFinite(currentStart)&&Date.parse(item.startsAt)===currentStart)||rows.find(item=>{const at=Date.parse(item.startsAt);return Number.isFinite(at)&&now>=at&&now<at+15*60*1000;});
 if(currentItem&&Number.isFinite(currentItem.priceSekPerKwh)){const n=currentItem.priceSekPerKwh,at=Date.parse(currentItem.startsAt),x=50+(at-first)/Math.max(1,last-first)*730,y=20+(max-n)/(max-min)*192,labelW=124,labelH=30,lx=Math.max(50,Math.min(780-labelW,x-labelW/2)),ly=Math.max(3,Math.min(178,y-39));add('line',{x1:x,y1:20,x2:x,y2:212,stroke:'#63a9d8','stroke-width':1.5,'stroke-dasharray':'4 4',opacity:.8});add('circle',{cx:x,cy:y,r:7,fill:'#63a9d8',stroke:'#f3f3ef','stroke-width':2});add('rect',{x:lx,y:ly,width:labelW,height:labelH,rx:6,fill:'#14232d',stroke:'#63a9d8','stroke-width':1.5});add('text',{x:lx+7,y:ly+12,fill:'#8bc9ef','font-size':10,'font-weight':700},'NU · '+fmt(n));add('text',{x:lx+7,y:ly+24,fill:'#f3f3ef','font-size':9},new Date(at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));}
 const extrema=[{label:'HÖGST',item:rows.reduce((a,b)=>b.priceSekPerKwh>a.priceSekPerKwh?b:a),color:'#ff9b54'},{label:'LÄGST',item:rows.reduce((a,b)=>b.priceSekPerKwh<a.priceSekPerKwh?b:a),color:'#75c9a5'}];
 for(const point of extrema){const n=point.item.priceSekPerKwh,at=Date.parse(point.item.startsAt),x=50+(at-first)/Math.max(1,last-first)*730,y=20+(max-n)/(max-min)*192,labelW=142,labelH=34,lx=Math.max(50,Math.min(780-labelW,x-labelW/2)),ly=Math.max(3,Math.min(174,y-43)),time=new Date(at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});add('line',{x1:x,y1:y,x2:x,y2:ly+labelH,stroke:point.color,'stroke-width':1.5,'stroke-dasharray':'3 3'});add('circle',{cx:x,cy:y,r:5,fill:point.color,stroke:'#171a18','stroke-width':2});add('rect',{x:lx,y:ly,width:labelW,height:labelH,rx:6,fill:'#171a18',stroke:point.color,'stroke-width':1.5});add('text',{x:lx+7,y:ly+13,fill:point.color,'font-size':10,'font-weight':700},point.label+' · '+fmt(n));add('text',{x:lx+7,y:ly+26,fill:'#f3f3ef','font-size':10},time);}
 const ticks=[0,6,12,18,24,30,36,42];for(const h of ticks){const x=50+h/Math.max(1,(last-first)/3600000)*730;if(x<=780)add('text',{x,y:238,'text-anchor':'middle'},String((new Date(first+h*3600000)).getHours()).padStart(2,'0')+':00');}
 chartEl.replaceChildren(svg);
 detail.textContent='Elområde SE3 · Nord Pool spotpris · '+rows.length+' tillgängliga kvartsvärden · uppdaterad '+(p.fetchedAt?new Date(p.fetchedAt).toLocaleString():'okänt')+'. Priset visas i öre/kWh, exklusive moms, Bixias påslag, energiskatt och nätavgifter. Källa: Spotpris.nu.';
}
function renderConnectionStatus(){
 const target=$('connection-tibber-status'),detail=$('connection-tibber-detail');
 if(target){const live=Boolean(tibberLive&&tibberLive.latest);target.className='tibber-state'+(live?' online':' offline');target.textContent=live?'CONNECTED · LIVE':'NOT CONNECTED';}
 if(detail)detail.textContent=$('tibber-detail')?.textContent||'Waiting for Tibber status.';
}
async function ptzRequest(path,body={},method='POST'){
 const response=await fetch('./api/cameras/garage/ptz/'+path,{method,headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body),cache:'no-store'});
 const result=await response.json().catch(()=>({error:'Invalid server response'}));
 if(!response.ok)throw new Error(result.error||'PTZ request failed ('+response.status+')');
 return result;
}
function cameraPtzControls(){
 const panel=document.createElement('details');panel.className='camera-ptz';
 const heading=document.createElement('summary');heading.textContent='Kamerakontroller';panel.append(heading);
 const pad=document.createElement('div');pad.className='ptz-pad';
 for(const [direction,label] of [['up','↑'],['left','←'],['stop','■'],['right','→'],['down','↓']]){
  const button=document.createElement('button');button.type='button';button.className='ptz-button';button.textContent=label;button.setAttribute('aria-label',direction==='stop'?'Stop camera':direction);
  button.addEventListener('click',async()=>{try{if(direction==='stop')await ptzRequest('stop');else await ptzRequest('move',{direction});}catch(error){status.textContent=error.message;status.className='note error';}});
  pad.append(button);
 }
 panel.append(pad);
 const presetRow=document.createElement('div');presetRow.className='ptz-presets';
 const select=document.createElement('select');select.setAttribute('aria-label','Saved camera positions');select.innerHTML='<option value="">Loading saved positions…</option>';
 const go=document.createElement('button');go.type='button';go.textContent='Gå till';go.addEventListener('click',async()=>{if(!select.value)return;try{await ptzRequest('preset',{token:select.value});status.textContent='Kameran går till vald position.';status.className='note';}catch(error){status.textContent=error.message;status.className='note error';}});
 const remove=document.createElement('button');remove.type='button';remove.textContent='Ta bort';remove.className='ptz-delete';remove.addEventListener('click',async()=>{const token=select.value;if(!token)return;if(!window.confirm('Vill du ta bort den sparade kamerapositionen?'))return;try{await ptzRequest('preset',{token},'DELETE');await loadPresets();status.textContent='Positionen har tagits bort från kameran.';status.className='note';}catch(error){status.textContent=error.message;status.className='note error';}});
 presetRow.append(select,go,remove);panel.append(presetRow);
 const saveRow=document.createElement('div');saveRow.className='ptz-presets';
 const input=document.createElement('input');input.type='text';input.maxLength=32;input.placeholder='Namn på position';input.setAttribute('aria-label','Preset name');
 const save=document.createElement('button');save.type='button';save.textContent='Spara position';save.addEventListener('click',async()=>{try{if(!input.value.trim())throw new Error('Ange ett namn på positionen.');await ptzRequest('presets',{name:input.value.trim()});input.value='';await loadPresets();status.textContent='Position sparad på kameran.';status.className='note';}catch(error){status.textContent=error.message;status.className='note error';}});
 saveRow.append(input,save);panel.append(saveRow);
 const status=document.createElement('p');status.className='note';status.setAttribute('aria-live','polite');status.textContent='Ansluter till kamerans ONVIF-tjänst…';panel.append(status);
 async function loadPresets(){const result=await ptzRequest('presets',{},'GET');select.replaceChildren();if(!result.presets.length){const option=document.createElement('option');option.value='';option.textContent='Inga sparade positioner';select.append(option);return;}for(const preset of result.presets){const option=document.createElement('option');option.value=preset.token;option.textContent=preset.name;select.append(option);}}
 loadPresets().then(()=>{status.textContent='PTZ redo.';status.className='note';}).catch(error=>{status.textContent=error.message;status.className='note error';});
 return panel;
}
function cameraPanel(camera,large=false){const el=document.createElement('article');el.className='card camera-tile'+(large?' camera-tile-large':'');const head=document.createElement('div');head.className='heading';const left=document.createElement('div'),eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent=camera.location||'CAMERA';const title=document.createElement('h2');title.textContent=camera.name;left.append(eyebrow,title);const badge=document.createElement('span');badge.className='tibber-state '+(camera.status==='live-ready'?'online':'offline');badge.textContent=camera.statusLabel;head.append(left,badge);const preview=document.createElement('div');preview.className='camera-preview';if(camera.playerUrl){const frame=document.createElement('iframe');frame.src=camera.playerUrl;frame.title=camera.name+' live video';frame.loading='lazy';frame.allow='autoplay; fullscreen';frame.referrerPolicy='no-referrer';preview.append(frame);}else{preview.textContent='LIVE VIDEO NOT CONFIGURED';}const model=document.createElement('p');model.className='note';model.textContent=camera.model+' · '+camera.note;el.append(head,preview,model);if(large&&camera.id==='garage-c520ws')el.append(cameraPtzControls());return el;}
async function refreshCameras(){try{const response=await fetch('./api/cameras',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const result=await response.json(),items=Array.isArray(result.cameras)?result.cameras:[];for(const [id,large] of [['camera-home-grid',false],['camera-page-grid',true]]){const host=$(id);if(host)host.replaceChildren(...items.map(c=>cameraPanel(c,large)));}}catch(error){for(const id of ['camera-home-grid','camera-page-grid']){const host=$(id);if(host){const p=document.createElement('p');p.className='note';p.textContent='Camera status unavailable: '+error.message;host.replaceChildren(p);}}}}
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
 renderPriceChart();
 renderConnectionStatus();
 if(live){
  $('energy-cards').replaceChildren(
   card('TIBBER POWER',t.power,'W','Live reading from the main meter.','grid'),
   card('SOLAR PRODUCTION','Unavailable','W','Huawei SUN2000 · API access pending.','solar'),
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
 if(mode==='demo'){
  $('thermal-cards').replaceChildren(
   card('HOT WATER',v.hotWater,'°C','Synthetic example only.','load'),
   card('OUTDOOR',v.outdoor,'°C','Synthetic example only.','battery'),
   card('COMPRESSOR',v.compressor,'Hz','Synthetic example only.','solar')
  );
 }else if(nibePoints.length){
  renderNibeCards();
 }else{
  const waiting=nibeLoadState==='loading',empty=nibeLoadState==='empty';
  const label=waiting?'WAITING FOR NIBE':empty?'NO NIBE POINTS':'NIBE UNAVAILABLE';
  const note=waiting?'Connecting to myUplink and loading real measurements.':empty?'myUplink is connected, but returned no measurement points.':'Check the myUplink connection on the Connections page.';
  $('thermal-cards').replaceChildren(card(label,null,'',note,'load'));
 }
 if(view==='overview'){
  if(live){
   const el=$('energy-chart');el.replaceChildren();
   const empty=document.createElement('div');empty.className='empty';
   tibberChart('energy-chart',tibberHistory,Number($('overview-range').value));
  }else chart('energy-chart',['solar','siteLoad'],subset(Number($('overview-range').value)));
 }
 if(view==='thermal'){
  if(nibeHistoryRows.length){
   renderNibeHistoryChart('compressor-chart',/compressor.*frequency|kompressor.*frekvens|compressor.*speed|kompressor.*hastighet/i,'Compressor activity','Hz',COMPRESSOR_FREQUENCY_PARAMETER_ID);
   wireNibeSpecialHistoryCards();
  }else if(live){
   for(const id of ['compressor-chart']){const el=$(id);el.replaceChildren();const empty=document.createElement('div');empty.className='empty';empty.textContent='Waiting for locally stored NIBE readings.';el.append(empty);}
  }else if(mode==='demo'){
   chart('compressor-chart',['compressor'],subset());
  }else{
   const el=$('compressor-chart');el.replaceChildren();const empty=document.createElement('div');empty.className='empty';empty.textContent=nibeLoadState==='loading'?'Waiting for real NIBE history…':'No NIBE compressor history is available yet.';el.append(empty);
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
$('metric').onchange=render;$('overview-range').onchange=render;$('myuplink-refresh')?.addEventListener('click',refreshMyUplink);
$('demo').onclick=()=>{data=M.demo();mode='demo';message('Demo restored. All values are synthetic.');render()};
$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>2*1024*1024)throw Error('File too large. Keep it below 2 MB.');const next=M.validate(JSON.parse(await f.text()));data=next;mode='import';message('Imported '+data.samples.length+' samples. They stay in this tab; export to keep a copy.');render()}catch(error){message('Could not import: '+error.message)}finally{e.target.value=''}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=mode==='demo'?'observatory-synthetic-demo.json':'observatory-readings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported the current dataset. Review your own readings before sharing them.');};
$('recorder').onclick=async()=>{try{if(location.protocol==='file:')throw Error('Start the optional local server with npm start, then open its printed address.');const response=await fetch('./api/history',{cache:'no-store'});if(!response.ok)throw Error('Recorder history is unavailable. Start the included local server and recorder; see README.');const next=M.validate(await response.json());data=next;mode='recorder';message('Loaded local recorder history. Click again to refresh; this is a snapshot.');render()}catch(e){message(e.message)}};
if(C.illustration && !/^(?:https?:|\/\/|data:|javascript:)/i.test(C.illustration))$('house-art').src=C.illustration;
$('house-art').onerror=()=>{$('house-art').onerror=null;$('house-art').src='./assets/starter-house.svg';message('Custom artwork was unavailable. Using the included generic illustration.')};
show(location.hash.slice(1));refreshTibber();refreshMyUplink();refreshCameras();setInterval(()=>{if(!document.hidden){render();refreshTibber();refreshMyUplink()}},15000);
