import {Onvif} from 'onvif';

const url=process.env.TAPO_ONVIF_URL||'http://192.168.20.137:2020/onvif/device_service';
const username=process.env.TAPO_ONVIF_USER||'';
const password=process.env.TAPO_ONVIF_PASSWORD||'';
let clientPromise=null;
let activeProfile=null;

function configured(){return Boolean(username&&password&&url);}
async function getClient(){
 if(!configured())throw new Error('ONVIF is not configured. Add TAPO_ONVIF_USER and TAPO_ONVIF_PASSWORD to the private .env file.');
 if(!clientPromise){
  clientPromise=(async()=>{
   const client=new Onvif({url,username,password,timeout:8000,preserveAddress:true});
   client.on('warn',error=>console.warn('ONVIF warning:',error.message));
   await client.connect();
   const info=await client.device.getDeviceInformation();
   const profile=client.profiles.find(item=>item.PTZConfiguration?.token)||client.profiles[0];
   if(!profile?.token)throw new Error('ONVIF connected, but no media profile was returned.');
   if(!profile.PTZConfiguration)throw new Error('The camera profile does not advertise a PTZ configuration.');
   activeProfile=profile.token;
   console.log('ONVIF connected:',info.manufacturer,info.model,'profile:',profile.name);
   return client;
  })().catch(error=>{clientPromise=null;activeProfile=null;throw error;});
 }
 return clientPromise;
}
function cleanPreset(p){return {token:String(p.token||''),name:String(p.name||p.token||'').slice(0,64)};}
export function getCameraPtzStatus(){return {configured:configured(),camera:'garage-c520ws',protocol:'ONVIF',url:configured()?new URL(url).origin+'/…':null};}
export async function getCameraPtzDiagnostics(){
 const client=await getClient();
 const nodes=await client.ptz.getNodes();
 const configuration=client.profiles.find(p=>p.token===activeProfile)?.PTZConfiguration;
 let options=null;
 if(configuration?.token)options=await client.ptz.getConfigurationOptions({configurationToken:configuration.token});
 return {profileToken:activeProfile,configurationToken:configuration?.token||null,nodes:nodes.map(n=>({token:n.token,name:n.name,maximumNumberOfPresets:n.maximumNumberOfPresets,supportedPTZSpaces:n.supportedPTZSpaces})),options};
}
export async function listCameraPresets(){
 const client=await getClient();
 const presets=await client.ptz.getPresets({profileToken:activeProfile});
 return presets.map(cleanPreset).filter(p=>p.token);
}
export async function moveCamera(direction){
 const vectors={left:{x:-0.45,y:0,zoom:0},right:{x:0.45,y:0,zoom:0},up:{x:0,y:0.45,zoom:0},down:{x:0,y:-0.45,zoom:0}};
 const vector=vectors[direction];if(!vector)throw new Error('Unsupported camera direction.');
 const client=await getClient();
 // The onvif package PTZ API expects scalar x/y/zoom values, not a nested velocity object.
 // This camera advertises continuous Pan/Tilt but no continuous Zoom space.
 await client.ptz.continuousMove({profileToken:activeProfile,x:vector.x,y:vector.y,timeout:600,onlySendPanTilt:true});
 return {ok:true};
}
export async function stopCamera(){
 const client=await getClient();await client.ptz.stop({profileToken:activeProfile,panTilt:true,zoom:false});return {ok:true};
}
export async function saveCameraPreset(name){
 const label=String(name||'').trim();
 if(!label||label.length>32)throw new Error('Preset name must contain 1–32 characters.');
 const client=await getClient();
 const result=await client.ptz.setPreset({profileToken:activeProfile,presetName:label});
 return {result,name:label};
}
export async function gotoCameraPreset(token){
 const value=String(token||'');if(!value||value.length>256)throw new Error('Invalid preset token.');
 const presets=await listCameraPresets();
 if(!presets.some(p=>p.token===value))throw new Error('Preset not found on the camera.');
 const client=await getClient();await client.ptz.gotoPreset({profileToken:activeProfile,presetToken:value});
 return {ok:true};
}
export async function deleteCameraPreset(token){
 const value=String(token||'');if(!value||value.length>256)throw new Error('Invalid preset token.');
 const presets=await listCameraPresets();
 if(!presets.some(p=>p.token===value))throw new Error('Preset not found on the camera.');
 const client=await getClient();await client.ptz.removePreset({profileToken:activeProfile,presetToken:value});
 return {ok:true};
}
