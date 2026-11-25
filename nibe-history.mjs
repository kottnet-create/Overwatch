import path from 'node:path';
import {createMeasurementStore} from './measurement-store.mjs';

const RETENTION_DAYS=30;
const MAX_HOURS=24*30;
const isWantedPoint=name=>!/\boffset\b/i.test(String(name||''))&&( /\bBT(?:1|2|3|6|7|10|11|12|50)\b/i.test(String(name||''))||/compressor.*frequency|frequency.*compressor|kompressor.*frekvens|frekvens.*kompressor|kompressor.*hastighet/i.test(String(name||'')));

function asIso(value,fallback){
 if(value===undefined||value===null||value==='')return fallback;
 if(typeof value==='number')return new Date(value<1e12?value*1000:value).toISOString();
 const d=new Date(value);return Number.isNaN(d.getTime())?fallback:d.toISOString();
}

export function createNibeHistory({dbPath=path.join(process.cwd(),'data','overwatch.sqlite'),now=()=>Date.now()}={}){
 const store=createMeasurementStore({dbPath,now,retentionDays:RETENTION_DAYS});
 function record(payload){
  const receivedAt=new Date(now()).toISOString();let inserted=0,seen=0;
  for(const device of payload?.devices||[]){
   const deviceId=String(device.deviceId??device.id??'');
   if(!deviceId)continue;
   const measurements=[];
   for(const p of device.points||[]){
    const raw=p.value??p.parameterValue??p.currentValue;
    const n=typeof raw==='number'?raw:Number(raw);
    if(raw===null||raw===undefined||raw===''||!Number.isFinite(n)||n===-32768)continue;
    const parameterId=String(p.parameterId??p.id??p.parameterName??p.name??'');
    const parameterName=String(p.parameterName??p.name??parameterId);
    if(!parameterId||!isWantedPoint(parameterName))continue;
    measurements.push({
     parameterId,
     parameterName,
     value:n,
     unit:String(p.parameterUnit??p.unit??''),
     sourceAt:asIso(p.timestamp??p.updatedAt??p.lastUpdated??p.time,receivedAt)
    });
   }
   if(!measurements.length)continue;
   const result=store.recordBatch({
    source:'myUplink',
    systemId:String(device.systemId??''),
    deviceId,
    measurements,
    receivedAt
   });
   inserted+=result.inserted;seen+=measurements.length;
  }
  store.prune();
  return {inserted,seen,retentionDays:RETENTION_DAYS,receivedAt};
 }
 function getHistory(hours=24){
  const h=Math.max(1,Math.min(MAX_HOURS,Number(hours)||24));
  const result=store.getHistory({source:'myUplink',hours:h,limit:100000});
  const samples=result.samples.map(row=>({
   parameterId:row.parameterId,
   parameterName:row.parameterName,
   value:row.value,
   unit:row.unit,
   timestamp:row.receivedAt,
   sourceTimestamp:row.sourceAt,
   deviceId:row.deviceId
  }));
  return {source:'myUplink',hours:h,retentionDays:RETENTION_DAYS,count:samples.length,samples};
 }
 function getLatest(){
  return store.getLatest({source:'myUplink',limit:499}).map(row=>({
   parameterId:row.parameterId,
   parameterName:row.parameterName,
   value:row.value,
   unit:row.unit,
   timestamp:row.receivedAt,
   sourceTimestamp:row.sourceAt,
   receivedAt:row.receivedAt,
   deviceId:row.deviceId
  }));
 }
 function stats(){
  const result=store.stats({source:'myUplink'});
  return {...result,retentionDays:RETENTION_DAYS};
 }
 function getPointStats(hours=24*RETENTION_DAYS){
  const result=store.getPointStats({source:'myUplink',hours});
  const currentTime=now();
  const points=result.points.map(point=>{
   const ageMs=Math.max(0,currentTime-Date.parse(point.receivedAt));
   return {...point,ageMs,quality:ageMs<=7*60*1000?'fresh':'stale'};
  });
  const counts=points.reduce((acc,point)=>{acc[point.quality]++;return acc;},{fresh:0,stale:0});
  return {...result,points,counts,generatedAt:new Date(currentTime).toISOString()};
 }
 return {record,getHistory,getLatest,getPointStats,stats,close:store.close};
}
