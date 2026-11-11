import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readHistory} from './history.mjs';
import {createTibberMonitor} from './tibber.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const routes={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/model.js':'model.js','/config.js':'config.js','/assets/starter-house.svg':'assets/starter-house.svg'};
export function createServer({historyFile=path.join(root,'data/history.json'),tibberMonitor=createTibberMonitor()}={}){
 const server=http.createServer((req,res)=>{
  const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:body)};
  if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host||''))return send(403,'Local host only.');
  if(!['GET','HEAD'].includes(req.method))return send(405,'Read-only server.');
  let route;try{route=new URL(req.url,'http://localhost').pathname;}catch{return send(400,'Bad request.');}
  if(route==='/api/history'){try{const data=readHistory(historyFile);return data?send(200,JSON.stringify(data),'application/json'):send(404,'No history yet. Start the recorder first.');}catch{return send(422,'History is invalid or too large. Review the recorder output.');}}
  if(route==='/api/tibber/status')return send(200,JSON.stringify(tibberMonitor.getStatus()),'application/json');
  let name=routes[route];
  // Only local illustration files under public/assets may be served.
  if(!name&&/^\/assets\/[a-zA-Z0-9_-]+\.(?:svg|png|webp|jpg)$/.test(route))name=route.slice(1);
  if(!name)return send(404,'Not found.');
  const file=path.join(root,'public',name);
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return send(404,'Not found.');const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};return send(200,fs.readFileSync(file),types[path.extname(file)]);}catch{return send(404,'Not found.');}
 });
 server.on('close',()=>tibberMonitor.close());
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8780);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be between 1024 and 65535.');
 const server=createServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Set PORT to a free port.':e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log('OVERWATCH: http://127.0.0.1:'+port+' · local only'));
}
