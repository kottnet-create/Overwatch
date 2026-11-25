import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import '../public/model.js';
import {recordFile,readHistory} from '../history.mjs';
import {createServer} from '../server.mjs';
import {createNibeHistory} from '../nibe-history.mjs';
const M=globalThis.ObservatoryModel;
const sample=(values={siteLoad:2000,garage:500},at='2026-01-01T12:00:00.000Z')=>({schemaVersion:1,source:'Test adapter',samples:[{at,values}]});
test('demo is synthetic and validates; nulls are real gaps',()=>{const d=M.demo();assert.match(d.source,/Synthetic/);assert.equal(M.validate(d).samples.length,289);assert.ok(d.samples.some(s=>s.values.hotWater===null));assert.ok(M.pathSegments(d.samples,'hotWater').length>1);});
test('strict import contract rejects typos, strings, future/invalid/missing timezone dates, duplicates and bad values',()=>{
 for(const input of [sample({solar:'200'}),sample({solar:Infinity}),sample({solar:-1}),sample({batterySOC:101}),sample({electricity:200}),sample({},'2026-02-30T12:00:00Z'),sample({solar:1},'2026-01-01T12:00:00'),sample({solar:1},'2026-02-30T12:00:00Z'),sample({solar:1},'2099-01-01T00:00:00Z'),{...sample(),samples:[...sample().samples,...sample().samples]}])assert.throws(()=>M.validate(input));
 const d=M.validate(sample({solar:null,hotWater:48.2}));assert.equal(d.samples[0].values.solar,null);assert.equal(d.samples[0].values.hotWater,48.2);
});
test('building split withholds unavailable/inconsistent measurements',()=>{assert.equal(M.houseLoad({siteLoad:2000,garage:500}),1500);for(const values of [{siteLoad:100,garage:500},{siteLoad:null,garage:20},{siteLoad:400}])assert.equal(M.houseLoad(values),null)});
test('gap over 10 minutes does not connect and single-point chart remains visible',()=>{const a=sample({solar:10}).samples[0],b=sample({solar:20},'2026-01-01T12:20:00Z').samples[0];const segments=M.pathSegments([a,b],'solar');assert.equal(segments.length,2);assert.equal(segments[0].length,1);});
test('recorder persists newer samples, preserves timestamps, and rejects mixing sources',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observatory-test-')),input=path.join(dir,'input.json'),history=path.join(dir,'data/history.json');try{fs.writeFileSync(input,JSON.stringify(sample()));assert.equal(recordFile(input,history),1);assert.equal(recordFile(input,history),0);const next=sample({solar:40},'2026-01-01T12:01:00Z');fs.writeFileSync(input,JSON.stringify(next));assert.equal(recordFile(input,history),1);assert.equal(readHistory(history).samples.length,2);assert.equal(readHistory(history).samples.at(-1).at,'2026-01-01T12:01:00.000Z');fs.writeFileSync(input,JSON.stringify({...next,source:'Different source'}));assert.throws(()=>recordFile(input,history),/Source changed/)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
test('NIBE SQLite history survives closing and reopening the database',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'overwatch-nibe-')),dbPath=path.join(dir,'overwatch.sqlite');
 let now=Date.parse('2026-11-25T12:00:00.000Z');
 const payload={devices:[{systemId:'system-1',deviceId:'device-1',points:[{parameterId:'bt7',parameterName:'BT7 Hot water top',parameterValue:48.5,parameterUnit:'°C',timestamp:'2026-11-25T11:59:00.000Z'}]}]};
 try{
  const first=createNibeHistory({dbPath,now:()=>now});
  assert.equal(first.record(payload).inserted,1);
  assert.equal(first.getHistory(24).count,1);
  first.close();
  now+=5*60*1000;
  const second=createNibeHistory({dbPath,now:()=>now});
  assert.equal(second.getHistory(24).count,1);
  assert.equal(second.getLatest()[0].value,48.5);
  assert.equal(second.stats().count,1);
  second.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('local server serves only public files, blocks writes/foreign Host, and returns validated history',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observatory-http-')),history=path.join(dir,'history.json');fs.writeFileSync(history,JSON.stringify(sample()));const server=createServer({historyFile:history});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{assert.equal((await fetch(base)).status,200);for(const route of ['/package.json','/README.md','/data/history.json','/.env','/assets/../server.mjs','/assets/%2e%2e/server.mjs'])assert.equal((await fetch(base+route)).status,404);assert.equal((await fetch(base,{method:'POST'})).status,405);assert.equal(await new Promise((resolve,reject)=>{http.get(base,{headers:{Host:'foreign.example'}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)}),403);const r=await fetch(base+'/api/history');assert.equal(r.status,200);assert.equal((await r.json()).samples.length,1);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await fetch(base+'/assets/starter-house.svg')).status,200)}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}});
