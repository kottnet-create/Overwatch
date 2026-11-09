(function (root) {
  'use strict';
  const metrics = {
    solar: {label:'Solar generation',unit:'W',color:'#ffad55'},
    siteLoad: {label:'Site consumption',unit:'W',color:'#ff7a24'},
    garage: {label:'Garage consumption',unit:'W',color:'#63a9d8'},
    gridNet: {label:'Grid exchange',unit:'W',color:'#aeb7c2'},
    batterySOC: {label:'Battery charge',unit:'%',color:'#ff9b4a'},
    hotWater: {label:'Hot water',unit:'°C',color:'#ff7a24'},
    outdoor: {label:'Outdoor temperature',unit:'°C',color:'#63a9d8'},
    compressor: {label:'Compressor frequency',unit:'Hz',color:'#aeb7c2'},
  };
  function validate(input) {
    if(!input || input.schemaVersion!==1 || !Array.isArray(input.samples) || !input.samples.length || input.samples.length>5000) throw Error('Use schemaVersion 1 with 1–5,000 samples.');
    const samples=input.samples.map((s,index)=>{
      if(!s || typeof s.at!=='string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(s.at) || !Number.isFinite(Date.parse(s.at)) || Date.parse(s.at)>Date.now()+300000) throw Error('Sample '+(index+1)+': use a valid ISO timestamp, not a future time.');
      if(!s.values || typeof s.values!=='object' || Array.isArray(s.values) || !Object.keys(s.values).length) throw Error('Sample '+(index+1)+': values must contain at least one supported measurement.');
      const calendar=new Date(s.at.slice(0,10)+'T00:00:00Z');
      if(!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10)!==s.at.slice(0,10)) throw Error('Invalid calendar date.');
      const values={};
      for(const [key,value] of Object.entries(s.values)) {
        if(!Object.hasOwn(metrics,key)) throw Error('Unknown measurement: '+key);
        if(value!==null && (typeof value!=='number' || !Number.isFinite(value) || Math.abs(value)>1e9)) throw Error(key+': use a finite number or null.');
        if(value!==null && ((key==='batterySOC' && (value<0||value>100)) || (['solar','siteLoad','garage','compressor'].includes(key)&&value<0))) throw Error(key+': value outside the supported range.');
        values[key]=value;
      }
      return {at:new Date(s.at).toISOString(),values};
    }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    for(let i=1;i<samples.length;i++) if(samples[i].at===samples[i-1].at) throw Error('Duplicate sample timestamps.');
    const source=typeof input.source==='string'?input.source.trim().slice(0,100):'Imported readings';
    return {schemaVersion:1,source:source||'Imported readings',samples};
  }
  function houseLoad(values) {
    const {siteLoad,garage}=values;
    return Number.isFinite(siteLoad)&&Number.isFinite(garage)&&siteLoad>=garage ? siteLoad-garage : null;
  }
  function demo(now=Date.now()) {
    const end=Math.floor(now/300000)*300000,samples=[];
    for(let i=0;i<=288;i++) {
      const at=end-(288-i)*300000,d=new Date(at),hour=d.getHours()+d.getMinutes()/60;
      const solar=Math.round(Math.max(0,Math.sin((hour-6)/12*Math.PI))*5400);
      const garage=Math.round(260+Math.max(0,Math.sin(i/13))*650),siteLoad=garage+Math.round(850+Math.max(0,Math.sin(i/9))*1600);
      const missing=i>172&&i<177;
      samples.push({at:new Date(at).toISOString(),values:{solar:missing?null:solar,siteLoad:missing?null:siteLoad,garage:missing?null:garage,gridNet:missing?null:siteLoad-solar,batterySOC:Math.round(52+Math.sin(i/70)*25),hotWater:missing?null:Math.round((47+Math.sin(i/18)*5)*10)/10,outdoor:Math.round((9+Math.sin((hour-8)/24*Math.PI*2)*5)*10)/10,compressor:missing?null:(i%43<16?42:0)}});
    }
    return {schemaVersion:1,source:'Synthetic demo · not a real home',samples};
  }
  function latest(data){return data.samples.at(-1);}
  function age(data,now=Date.now()){return Math.max(0,now-Date.parse(latest(data).at));}
  function pathSegments(samples,key,width=800,height=200) {
    const start=Date.parse(samples[0].at),end=Date.parse(samples.at(-1).at),finite=samples.map(s=>s.values[key]).filter(Number.isFinite);
    if(!finite.length)return [];
    let min=Math.min(...finite),max=Math.max(...finite);if(min===max){min-=1;max+=1;}const padding=(max-min)*.12;min-=padding;max+=padding;
    const segments=[];let current=[],prev=null;
    for(const s of samples){const value=s.values[key],time=Date.parse(s.at);if(!Number.isFinite(value)){if(current.length)segments.push(current);current=[];prev=null;continue;}if(prev!==null&&time-prev>600000){if(current.length)segments.push(current);current=[];}current.push([20+(time-start)/Math.max(1,end-start)*(width-40),15+(max-value)/(max-min)*(height-30),s]);prev=time;}
    if(current.length)segments.push(current);return segments;
  }
  root.ObservatoryModel={metrics,validate,demo,latest,age,houseLoad,pathSegments};
})(globalThis);
