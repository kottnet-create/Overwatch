// Camera metadata only. Private stream URLs and credentials stay server-side.
const cameras=[
{id:'garage-c520ws',name:'Garage',location:'Garage',model:'Tapo C520WS',status:'configured',statusLabel:'RTSP VERIFIED IN VLC',note:'Local RTSP connectivity was verified in VLC. Browser playback still needs a server-side RTSP-to-WebRTC/HLS bridge.'},
{id:'outdoor-c460',name:'Utomhus',location:'Utomhus',model:'Tapo C460',status:'pending',statusLabel:'INTEGRATION PENDING',note:'Battery camera. Local RTSP/ONVIF support has not been verified.'}
];
export function getPublicCameras(){return cameras.map(({id,name,location,model,status,statusLabel,note})=>({id,name,location,model,status,statusLabel,note}));}
