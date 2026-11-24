import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API='https://api.myuplink.com';
const DEFAULT_CALLBACK='http://127.0.0.1:8780/api/myuplink/callback';
const page=s=>'<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Overwatch · myUplink</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;background:#111;color:#eee"><h1>Overwatch · myUplink</h1><p>'+s+'</p><p>Du kan stänga fliken och gå tillbaka till Overwatch.</p><p><a style="color:#ff7a24" href="/">Till Overwatch</a></p></body></html>';

export function createMyUplink({root=process.cwd(),fetchImpl=fetch}={}) {
 const file=path.join(root,'data','myuplink-auth.json');
 let pendingState=null,pendingAt=0;
 const clientId=()=>process.env.MYUPLINK_CLIENT_ID||'';
 const clientSecret=()=>process.env.MYUPLINK_CLIENT_SECRET||'';
 const redirectUri=()=>process.env.MYUPLINK_CALLBACK_URL||DEFAULT_CALLBACK;
 function readTokens(){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return v&&typeof v==='object'?v:null;}catch{return null;}}
 function saveTokens(tokens){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(tokens,null,2),{mode:0o600});try{fs.chmodSync(tmp,0o600);}catch{}fs.renameSync(tmp,file);}
 function clearTokens(){try{fs.unlinkSync(file);}catch{}}
 const json=(send,status,obj)=>send(status,JSON.stringify(obj),'application/json; charset=utf-8');
 async function tokenRequest(params){
  const auth=Buffer.from(clientId()+':'+clientSecret()).toString('base64');
  const response=await fetchImpl(API+'/oauth/token',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(params)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('myUplink token endpoint HTTP '+response.status+(body.error?': '+body.error:''));
  return body;
 }
 async function accessToken(){
  let t=readTokens();if(!t?.access_token)throw new Error('Not connected');
  if(Number(t.expires_at)>Date.now()+60000)return t.access_token;
  if(!t.refresh_token)throw new Error('Access token expired. Reconnect myUplink.');
  const next=await tokenRequest({grant_type:'refresh_token',refresh_token:t.refresh_token});
  t={...t,...next,expires_at:Date.now()+Number(next.expires_in||3600)*1000};saveTokens(t);return t.access_token;
 }
 async function apiGet(route){
  const token=await accessToken(),response=await fetchImpl(API+route,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  const raw=await response.text();
  let body=null;try{body=raw?JSON.parse(raw):null;}catch{body=null;}
  if(response.status===401){clearTokens();throw new Error('HTTP 401 at '+route+': authorization expired. Reconnect myUplink.');}
  if(!response.ok){
   const detail=body?.message||body?.error_description||body?.error||body?.title||(raw?raw.slice(0,300):'No error details');
   throw new Error('HTTP '+response.status+' at '+route+': '+String(detail).replace(/[<>]/g,''));
  }
  if(body===null)throw new Error('Invalid JSON response at '+route);
  return body;
 }
 return {
  connect(req,res,send){
   if(!clientId()||!clientSecret())return send(503,'Missing MYUPLINK_CLIENT_ID or MYUPLINK_CLIENT_SECRET.');
   pendingState=crypto.randomBytes(32).toString('hex');pendingAt=Date.now();
   const u=new URL(API+'/oauth/authorize');u.searchParams.set('response_type','code');u.searchParams.set('client_id',clientId());u.searchParams.set('scope','READSYSTEM offline_access');u.searchParams.set('redirect_uri',redirectUri());u.searchParams.set('state',pendingState);
   res.writeHead(302,{Location:u.toString(),'Cache-Control':'no-store'});res.end();
  },
  async callback(req,res,send){
   const u=new URL(req.url,'http://127.0.0.1'),state=u.searchParams.get('state'),code=u.searchParams.get('code'),error=u.searchParams.get('error');
   if(error)return send(400,page('myUplink avbröt eller nekade anslutningen: '+String(error).replace(/[<>]/g,'')),'text/html; charset=utf-8');
   if(!pendingState||Date.now()-pendingAt>600000||state!==pendingState||!code){pendingState=null;return send(400,page('Inloggningen kunde inte verifieras. Gå tillbaka till Overwatch och försök igen.'),'text/html; charset=utf-8');}
   pendingState=null;
   try{
    const t=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri()});
    if(!t.access_token)throw new Error('No access token returned');
    saveTokens({...t,expires_at:Date.now()+Number(t.expires_in||3600)*1000});
    return send(200,page('Anslutningen till myUplink är klar. Öppna Overwatch och gå till Värmepump.'),'text/html; charset=utf-8');
   }catch(e){return send(502,page('Kunde inte slutföra anslutningen: '+String(e.message).replace(/[<>]/g,'')),'text/html; charset=utf-8');}
  },
  status(send){const t=readTokens();return json(send,200,{connected:Boolean(t?.access_token),provider:'myUplink',readOnly:true,scope:'READSYSTEM',message:t?.access_token?'myUplink account connected.':'Connect your myUplink account to begin.'});},
  async systems(send){try{const data=await apiGet('/v2/systems/me');return json(send,200,{connected:true,readOnly:true,data});}catch(e){return json(send,readTokens()?.access_token?502:401,{connected:false,readOnly:true,error:e.message});}},
  async points(send){
   try{
    const response=await apiGet('/v2/systems/me');
    const systems=Array.isArray(response)?response:(response.systems||response.items||[]);
    const results=[],diagnostics=[];
    for(const system of systems){
     const systemId=system.systemId||system.id;
     const devices=system.devices||[];
     if(!systemId){diagnostics.push({systemName:system.name||'Unknown',stage:'system discovery',error:'System entry has no systemId.'});continue;}
     if(!devices.length){diagnostics.push({systemName:system.name||'Unknown',stage:'device discovery',error:'No devices were included in /v2/systems/me.'});continue;}
     for(const device of devices){
      const deviceId=device.id||device.deviceId;
      if(!deviceId){diagnostics.push({deviceName:device.name||'Unknown',stage:'device discovery',error:'Device entry has no id.'});continue;}
      const deviceName=device.name||device.deviceName||device.productName||'NIBE device';
      try{
       const points=await apiGet('/v2/devices/'+encodeURIComponent(deviceId)+'/points');
       const list=Array.isArray(points)?points:(points.points||points.items||[]);
       results.push({systemId,systemName:system.name,deviceId,deviceName,productName:device.productName||device.product,points:list});
      }catch(e){diagnostics.push({deviceName,deviceId,stage:'device points',error:e.message});}
     }
    }
    return json(send,200,{connected:true,readOnly:true,deviceCount:results.length,devices:results,diagnostics});
   }catch(e){return json(send,readTokens()?.access_token?502:401,{connected:false,readOnly:true,error:e.message});}
  },
  close(){pendingState=null;}
 };
}
