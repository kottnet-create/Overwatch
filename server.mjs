import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readHistory} from './history.mjs';
import {createTibberMonitor} from './tibber.mjs';
import {createNordPoolPrices} from './nordpool-prices.mjs';
import {createMyUplink} from './myuplink.mjs';
import {createNibeHistory} from './nibe-history.mjs';
import {findNibePointCandidates} from './nibe-point-diagnostics.mjs';
import {assessTibberSource} from './tibber-quality.mjs';
import {assessNibeSource} from './nibe-quality.mjs';
import {assessNordPoolSource} from './nordpool-quality.mjs';
import {getPublicCameras} from './cameras.mjs';
import {getCameraPtzStatus,getCameraPtzDiagnostics,listCameraPresets,moveCamera,stopCamera,saveCameraPreset,gotoCameraPreset,deleteCameraPreset} from './camera-ptz.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
async function readJsonBody(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('Request body too large.');}if(!raw)return {};const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid request body.');return value;}
const routes={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/model.js':'model.js','/config.js':'config.js','/assets/starter-house.svg':'assets/starter-house.svg'};
export function createServer({historyFile=path.join(root,'data/history.json'),tibberMonitor=createTibberMonitor(),nordPoolPrices=createNordPoolPrices(),myUplink=createMyUplink({root}),nibeHistory=createNibeHistory({dbPath:process.env.OVERWATCH_DB_PATH?path.resolve(root,process.env.OVERWATCH_DB_PATH):path.join(root,'data','overwatch.sqlite')}),autoCollect=false}={}){
 const server=http.createServer(async(req,res)=>{
  const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' http://127.0.0.1:1984 http://localhost:1984; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:body)};
  if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host||''))return send(403,'Local host only.');
  let route;try{route=new URL(req.url,'http://localhost').pathname;}catch{return send(400,'Bad request.');}
  const writeRoutes={POST:new Set(['/api/cameras/garage/ptz/move','/api/cameras/garage/ptz/stop','/api/cameras/garage/ptz/presets','/api/cameras/garage/ptz/preset']),DELETE:new Set(['/api/cameras/garage/ptz/preset'])};
  if(!['GET','HEAD'].includes(req.method)&&!writeRoutes[req.method]?.has(route))return send(405,'Method not allowed.');
  if(req.method!=='GET'&&req.method!=='HEAD'){const origin=req.headers.origin;if(origin&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin))return send(403,'Cross-origin request blocked.');}
  if(route==='/api/status'&&req.method==='GET'){
   try{
    let accountStatus={connected:false};
    try{
     if(typeof myUplink.connectionStatus==='function') accountStatus=await myUplink.connectionStatus();
     else myUplink.status((_status,body)=>{try{accountStatus=JSON.parse(body);}catch{}});
    }catch(error){
     accountStatus={configured:true,connectionState:'error',connectionError:String(error.message||'myUplink connection check failed')};
    }
    const sources=[
     assessTibberSource(tibberMonitor.getStatus()),
     assessNibeSource({accountStatus,latestMeasurements:nibeHistory.getLatest()}),
     assessNordPoolSource(nordPoolPrices.getStatus())
    ];
    const counts={usable:sources.filter(source=>source.usable).length,attention:sources.filter(source=>!source.usable).length,total:sources.length};
    return send(200,JSON.stringify({generatedAt:new Date().toISOString(),summary:counts,sources}),'application/json');
   }catch(error){
    console.error('Source status aggregation failed:',error);
    return send(503,JSON.stringify({error:'Source status is temporarily unavailable.'}),'application/json');
   }
  }
  if(route==='/api/cameras')return send(200,JSON.stringify({cameras:getPublicCameras()}),'application/json');
  if(route==='/api/cameras/garage/ptz/status'&&req.method==='GET')return send(200,JSON.stringify(getCameraPtzStatus()),'application/json');
  if(route==='/api/cameras/garage/ptz/diagnostics'&&req.method==='GET'){try{return send(200,JSON.stringify(await getCameraPtzDiagnostics()),'application/json');}catch(error){console.error('ONVIF PTZ diagnostics failed:',error);return send(503,JSON.stringify({error:error.message}),'application/json');}}
  if(route==='/api/cameras/garage/ptz/presets'&&req.method==='GET'){try{return send(200,JSON.stringify({presets:await listCameraPresets()}),'application/json');}catch(error){return send(503,JSON.stringify({error:error.message}),'application/json');}}
  if(route.startsWith('/api/cameras/garage/ptz/')&&['POST','DELETE'].includes(req.method)){try{const body=await readJsonBody(req);let result;if(route==='/api/cameras/garage/ptz/move'&&req.method==='POST')result=await moveCamera(body.direction);else if(route==='/api/cameras/garage/ptz/stop'&&req.method==='POST')result=await stopCamera();else if(route==='/api/cameras/garage/ptz/presets'&&req.method==='POST')result=await saveCameraPreset(body.name);else if(route==='/api/cameras/garage/ptz/preset'&&req.method==='POST')result=await gotoCameraPreset(body.token);else if(route==='/api/cameras/garage/ptz/preset'&&req.method==='DELETE')result=await deleteCameraPreset(body.token);else return send(404,'Not found.');return send(200,JSON.stringify(result),'application/json');}catch(error){console.error('ONVIF PTZ command failed:',error);return send(400,JSON.stringify({error:error.message}),'application/json');}}
  if(route==='/api/myuplink/connect')return myUplink.connect(req,res,send);
  if(route==='/api/myuplink/callback')return myUplink.callback(req,res,send);
  if(route==='/api/myuplink/status')return myUplink.status(send);
  if(route==='/api/myuplink/systems')return myUplink.systems(send);
  if(route==='/api/myuplink/points')return myUplink.points(send);
  if(route==='/api/myuplink/points/diagnostics'&&req.method==='GET'){
   try{
    if(typeof myUplink.fetchPointData!=='function')return send(503,JSON.stringify({error:'myUplink point discovery is unavailable.'}),'application/json');
    const payload=await myUplink.fetchPointData();
    return send(200,JSON.stringify(findNibePointCandidates(payload)),'application/json');
   }catch(error){return send(502,JSON.stringify({error:'Could not read myUplink point catalogue.',detail:String(error.message||'Unknown error')}),'application/json');}
  }
  if(route==='/api/myuplink/history')return send(200,JSON.stringify(nibeHistory.getHistory(new URL(req.url,'http://localhost').searchParams.get('hours')||24)),'application/json');
  if(route==='/api/myuplink/history/quality'){const requestedHours=Number(new URL(req.url,'http://localhost').searchParams.get('hours')||720);return send(200,JSON.stringify(nibeHistory.getPointStats(Number.isFinite(requestedHours)?requestedHours:720)),'application/json');}
  if(route==='/api/myuplink/history/latest')return send(200,JSON.stringify({stats:nibeHistory.stats(),samples:nibeHistory.getLatest()}),'application/json');
  if(route==='/api/history'){try{const data=readHistory(historyFile);return data?send(200,JSON.stringify(data),'application/json'):send(404,'No history yet. Start the recorder first.');}catch{return send(422,'History is invalid or too large. Review the recorder output.');}}
  if(route==='/api/tibber/status')return send(200,JSON.stringify(tibberMonitor.getStatus()),'application/json');
  if(route==='/api/tibber/history')return send(200,JSON.stringify(tibberMonitor.getHistory()),'application/json');
  if(route==='/api/tibber/prices')return send(200,JSON.stringify(tibberMonitor.getPrices()),'application/json');
  if(route==='/api/spot-prices'){
   nordPoolPrices.refresh().catch(()=>{});
   return send(200,JSON.stringify(nordPoolPrices.getStatus()),'application/json');
  }
  let name=routes[route];
  // Only local illustration files under public/assets may be served.
  if(!name&&/^\/assets\/[a-zA-Z0-9_-]+\.(?:svg|png|webp|jpg)$/.test(route))name=route.slice(1);
  if(!name)return send(404,'Not found.');
  const file=path.join(root,'public',name);
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return send(404,'Not found.');const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};return send(200,fs.readFileSync(file),types[path.extname(file)]);}catch{return send(404,'Not found.');}
 });
 let collectTimer=null,retentionTimer=null,collecting=false;
 const collectNibe=async()=>{if(collecting)return;collecting=true;try{const payload=await myUplink.fetchPointData();nibeHistory.record(payload);}catch(error){console.error('NIBE history collection failed:',error.message);}finally{collecting=false;}};
 // Retention cleanup runs independently of provider polling, including during outages.
 retentionTimer=setInterval(()=>{try{nibeHistory.prune();}catch(error){console.error('NIBE history retention cleanup failed:',error.message);}},60*60*1000);
 retentionTimer.unref?.();
 if(autoCollect){collectNibe();collectTimer=setInterval(collectNibe,5*60*1000);collectTimer.unref?.();}
 server.on('close',()=>{if(collectTimer)clearInterval(collectTimer);if(retentionTimer)clearInterval(retentionTimer);tibberMonitor.close();myUplink.close();nibeHistory.close();});
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8780);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be between 1024 and 65535.');
 const server=createServer({autoCollect:true});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Set PORT to a free port.':e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log('OVERWATCH: http://127.0.0.1:'+port+' · local only'));
}
