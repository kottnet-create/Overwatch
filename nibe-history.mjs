import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const RETENTION_DAYS=30;
const MAX_HOURS=24*30;

function asIso(value,fallback){
 if(value===undefined||value===null||value==='')return fallback;
 if(typeof value==='number')return new Date(value<1e12?value*1000:value).toISOString();
 const d=new Date(value);return Number.isNaN(d.getTime())?fallback:d.toISOString();
}

export function createNibeHistory({dbPath=path.join(process.cwd(),'data','overwatch.sqlite'),now=()=>Date.now()}={}){
 fs.mkdirSync(path.dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
 db.exec(`
  CREATE TABLE IF NOT EXISTS measurements (
   id INTEGER PRIMARY KEY,
   source TEXT NOT NULL,
   system_id TEXT NOT NULL,
   device_id TEXT NOT NULL,
   parameter_id TEXT NOT NULL,
   parameter_name TEXT NOT NULL,
   value REAL NOT NULL,
   unit TEXT NOT NULL DEFAULT '',
   source_at TEXT NOT NULL,
   received_at TEXT NOT NULL,
   UNIQUE(source, device_id, parameter_id, received_at)
  );
  CREATE INDEX IF NOT EXISTS idx_measurements_source_time ON measurements(source, source_at);
  CREATE INDEX IF NOT EXISTS idx_measurements_device_parameter_time ON measurements(device_id, parameter_id, source_at);
 `);
 const insert=db.prepare(`INSERT OR IGNORE INTO measurements
  (source,system_id,device_id,parameter_id,parameter_name,value,unit,source_at,received_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
 const prune=db.prepare("DELETE FROM measurements WHERE received_at < ?");
 const history=db.prepare(`SELECT parameter_id AS parameterId, parameter_name AS parameterName,
  value, unit, received_at AS timestamp, source_at AS sourceTimestamp, device_id AS deviceId
  FROM measurements WHERE source='myUplink' AND received_at >= ? ORDER BY received_at ASC`);
 const latest=db.prepare(`SELECT parameter_id AS parameterId, parameter_name AS parameterName,
  value, unit, received_at AS timestamp, source_at AS sourceTimestamp, received_at AS receivedAt, device_id AS deviceId
  FROM measurements WHERE source='myUplink' ORDER BY received_at DESC LIMIT 499`);
 function record(payload){
  const receivedAt=new Date(now()).toISOString();let inserted=0,seen=0;
  for(const device of payload?.devices||[]){
   for(const p of device.points||[]){
    const raw=p.value??p.parameterValue??p.currentValue;
    const n=typeof raw==='number'?raw:Number(raw);
    if(raw===null||raw===undefined||raw===''||!Number.isFinite(n)||n===-32768)continue;
    const parameterId=String(p.parameterId??p.id??p.parameterName??p.name??'');
    const parameterName=String(p.parameterName??p.name??parameterId);
    if(!parameterId)continue;
    const sourceAt=asIso(p.timestamp??p.updatedAt??p.lastUpdated??p.time,receivedAt);
    const result=insert.run('myUplink',String(device.systemId??''),String(device.deviceId??''),parameterId,parameterName,n,String(p.parameterUnit??p.unit??''),sourceAt,receivedAt);
    inserted+=Number(result.changes||0);seen++;
   }
  }
  prune.run(new Date(now()-RETENTION_DAYS*86400000).toISOString());
  return {inserted,seen,retentionDays:RETENTION_DAYS,receivedAt};
 }
 function getHistory(hours=24){
  const h=Math.max(1,Math.min(MAX_HOURS,Number(hours)||24));
  const since=new Date(now()-h*3600000).toISOString();
  const rows=history.all(since);
  return {source:'myUplink',hours:h,retentionDays:RETENTION_DAYS,count:rows.length,samples:rows};
 }
 function getLatest(){return latest.all().reverse();}
 function stats(){
  const row=db.prepare("SELECT COUNT(*) AS count, MIN(source_at) AS oldest, MAX(source_at) AS newest FROM measurements WHERE source='myUplink'").get();
  return {count:Number(row.count),oldest:row.oldest,newest:row.newest,retentionDays:RETENTION_DAYS,databasePath:dbPath};
 }
 return {record,getHistory,getLatest,stats,close(){db.close();}};
}
