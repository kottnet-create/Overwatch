// Camera metadata only. Never return private RTSP URLs or credentials to the browser.
const bridgeEnabled=process.env.OVERWATCH_GO2RTC_ENABLED==='true';
const cameras=[
{id:'garage-c520ws',name:'Garage',location:'Garage',model:'Tapo C520WS',status:bridgeEnabled?'live-ready':'bridge-needed',statusLabel:bridgeEnabled?'STREAM BRIDGE ENABLED':'LIVE VIDEO SETUP NEEDED',note:bridgeEnabled?'Live stream is provided by the local go2rtc bridge.':'RTSP works in VLC; install/configure go2rtc for browser playback.',playerUrl:bridgeEnabled?'http://127.0.0.1:1984/stream.html?src=overwatch_garage&mode=webrtc':null},
{id:'outdoor-c460',name:'Utomhus',location:'Utomhus',model:'Tapo C460',status:'pending',statusLabel:'INTEGRATION PENDING',note:'Battery camera. Local RTSP/ONVIF support has not been verified.',playerUrl:null}
];
export function getPublicCameras(){return cameras.map(({id,name,location,model,status,statusLabel,note,playerUrl})=>({id,name,location,model,status,statusLabel,note,playerUrl}));}
