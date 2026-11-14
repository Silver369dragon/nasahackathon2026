import {createSocial} from './social.mjs';
import {createOrbit} from './orbital-hull.js';
import {t,language,setLanguage,localizeDOM,localizedCanvasText} from './i18n.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildShip} from './ship.js';
import {crew as simulatedCrew,readings,stageAt} from './simulation.mjs';
import {startHealthStations} from './health-wall.js';
import {routineAt} from './routines.mjs';
import {scenarioReadings} from './scenarios.mjs';
import {SHIP_SCALE,EYE_HEIGHT,stationCrew} from './config.mjs';
const simulationMode = new URLSearchParams(location.search).get('mode') === 'simulation';
const crew = simulationMode ? simulatedCrew : stationCrew.map((id, i) => ({
  ...simulatedCrew[i], id, name: id[0].toUpperCase() + id.slice(1),
}));
let stationsReady = false;
let wallEmergency = () => null;
const $=s=>document.querySelector(s),viewport=$('#viewport'),modal=$('#modal');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;viewport.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D interior: WASD to move, drag to look, click a phone or shared display');renderer.domElement.tabIndex=0;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(68,1,.08,1400);
scene.add(new THREE.HemisphereLight(0xd8efff,0x30353a,1.55));const key=new THREE.DirectionalLight(0xffe3b3,2.1);key.position.set(-8,20,12);scene.add(key);const fill=new THREE.DirectionalLight(0xa8c9da,.85);fill.position.set(10,10,-8);scene.add(fill);
scene.add(new THREE.AmbientLight(0xb5cad0,.65));
const ship=buildShip(crew),zones=ship.zones;scene.add(ship.root);const orbit=createOrbit(scene);orbit.update(0);
const controls=new OrbitControls(camera,renderer.domElement);controls.enabled=false;controls.enableDamping=false;controls.enablePan=true;controls.screenSpacePanning=true;controls.minDistance=5;controls.maxDistance=800;controls.maxPolarAngle=Math.PI*.94;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
let mode='interior',yaw=Math.PI/2,pitch=0,time=Math.max(0,Number(new URLSearchParams(location.search).get('crewPreview'))||0),paused=false,speed=1,eventStart=null,acknowledged=false,selected=0,modalType='',labelsOn=false;
let data=[],activities=[],frame=0,incident=null,eventCounter=0,orbitTime=Math.max(0,Math.min(1200,Number(new URLSearchParams(location.search).get("orbitPreview"))||0));
const social=createSocial();let conversation=null,socialChecks=0,lastBubbleCheck=-999,bubbleClear=false;
const bubble=document.createElement('div');bubble.id='crew-dialogue';bubble.dataset.noTranslate='';bubble.hidden=true;bubble.setAttribute('aria-live','off');bubble.innerHTML='<small></small><p></p>';document.body.appendChild(bubble);
const bubbleRay=new THREE.Raycaster();bubbleRay.camera=camera;
function drawConversation(now){
 if(!conversation||incident||modal.open||mode!=='interior'){bubble.hidden=true;return;}
 const person=ship.people[conversation.speaker].g,head=person.getWorldPosition(new THREE.Vector3());head.y+=2.15;
 const delta=head.clone().sub(camera.position),distance=delta.length(),p=head.clone().project(camera);
 if(distance>18||distance<1||p.z<0||p.z>1||Math.abs(p.x)>.94||Math.abs(p.y)>.8){bubble.hidden=true;return;}
 if(now-lastBubbleCheck>250){lastBubbleCheck=now;socialChecks++;const face=person.getWorldPosition(new THREE.Vector3());face.y+=1.55;const sight=face.sub(camera.position);bubbleRay.set(camera.position,sight.clone().normalize());bubbleRay.far=Math.max(0,sight.length()-.1);bubbleClear=!bubbleRay.intersectObject(ship.root,true).some(hit=>{let o=hit.object;while(o){if(o===person)return false;o=o.parent;}return !hit.object.material?.transparent;});}
 if(!bubbleClear){bubble.hidden=true;return;}bubble.hidden=false;
 const label=crew[conversation.speaker].name+' / '+t('SCRIPTED CREW CHAT');if(bubble.firstChild.textContent!==label)bubble.firstChild.textContent=label;
 const line=t(conversation.text);if(bubble.lastChild.textContent!==line)bubble.lastChild.textContent=line;
 bubble.style.left=Math.max(130,Math.min(innerWidth-130,(p.x+1)*innerWidth/2))+'px';bubble.style.top=Math.max(95,Math.min(innerHeight-190,(1-p.y)*innerHeight/2))+'px';
}
const velocity={forward:0,right:0,up:0},panQueue={forward:0,right:0};
function stopMotion(){velocity.forward=velocity.right=velocity.up=0;panQueue.forward=panQueue.right=0;}
const emergencyRing=new THREE.Mesh(new THREE.TorusGeometry(1.35,.045,8,48),new THREE.MeshBasicMaterial({color:'#ff815e'}));emergencyRing.rotation.x=-Math.PI/2;emergencyRing.visible=false;scene.add(emergencyRing);
function triggerScenario(type,crewId){
 const r=routineAt(crewId,time);incident={id:`SIM-${++eventCounter}`,type,crewId,position:[...r.position],start:time,acknowledged:false};eventStart=time;acknowledged=false;selected=crewId;paused=false;
 $('#pause').textContent='Pause simulation';$('#pause').setAttribute('aria-pressed','false');$('#event').disabled=true;updatePeople();updateData();
}
function scenarioName(type){return{collapse:'Collapse / motion stopped',heart:'Abnormal health indicator',offline:'Device offline / missing data',radiation:'Environmental radiation warning'}[type];}
function focusIncident(){if(!incident)return;if(incident.type==='radiation'){enterZone('common');caption('Ship-wide / simulated environment warning','Scripted radiation warning · F scenario panel');return;}setMode('interior');camera.fov=68;camera.updateProjectionMatrix();const p=ship.people[incident.crewId].g.getWorldPosition(new THREE.Vector3());const target=p.clone().add(new THREE.Vector3(.5,.55,0));scene.updateMatrixWorld(true);
 const candidates=[[2.6,.9],[-2.6,.9],[.7,p.z>0?-2.1:2.1],[.7,p.z>0?2.1:-2.1]];
 const probe=new THREE.Raycaster();probe.camera=camera;let chosen=null;
 for(const [dx,dz] of candidates){const candidate=new THREE.Vector3(p.x+dx,EYE_HEIGHT+.6,p.z+dz),vector=target.clone().sub(candidate);probe.set(candidate,vector.clone().normalize());probe.far=vector.length()-.65;const blocked=probe.intersectObject(ship.root,true).some(hit=>{let visible=true;for(let o=hit.object;o;o=o.parent)visible&&=o.visible;return visible&&hit.object.isMesh&&hit.object.userData.id!==incident.crewId&&!hit.object.material.transparent;});if(!blocked){chosen=candidate;break;}}
 camera.position.copy(chosen||new THREE.Vector3(p.x+.7,EYE_HEIGHT+.6,p.z+(p.z>0?-2.1:2.1)));const d=target.sub(camera.position).normalize();yaw=Math.atan2(d.x,d.z);pitch=Math.asin(d.y);look();caption(`${crew[incident.crewId].name} / Simulated event`,`Script: ${scenarioName(incident.type)} · F scenario panel`);}
function scenarioPanel(){return `<h2>Scenario control <small>SIMULATION</small></h2><p class="modal-copy">Choose a crew member and a scenario to demonstrate synchronized changes. These are scripted events, not medically validated detection.</p><div class="scenario-fields"><label>Crew<select id="scenario-crew">${crew.map((c,i)=>`<option value="${i}" ${i===selected?'selected':''}>${c.name} · ${c.role}</option>`).join('')}</select></label><label>Demo scenario<select id="scenario-type"><option value="collapse">Collapse / motion stopped</option><option value="heart">Abnormal health indicator (heart rate)</option><option value="offline">Device offline / missing data</option><option value="radiation">Environmental radiation warning (ship-wide)</option></select></label></div><div class="notice">Collapse, abnormal readings and offline events target one crew member; environmental warnings affect everyone. Offline readings are explicitly missing. All event flags are scripted, not medical or radiation-safety detection.</div><div class="modal-actions"><button id="scenario-start">Trigger simulated event</button><button id="scenario-reset">Clear event / resume routines</button></div><p id="scenario-current" class="state-line"></p><div class="modal-actions"><button id="scenario-focus">Focus event</button><button id="scenario-phone">Open crew phone</button><button id="scenario-shared">Open shared display</button></div><p class="subtle">F toggles this panel; Esc closes it. One active event at a time; a new event replaces the previous one. Acknowledgement records review only. Collapse and abnormal states persist until reset. Events exist only in local memory. No health system, Wokwi or backend is connected.</p>`;}
function bindScenarioPanel(){
 $('#scenario-type').onchange=()=>{$('#scenario-crew').disabled=$('#scenario-type').value==='radiation';};
 $('#scenario-start').onclick=()=>{triggerScenario($('#scenario-type').value,Number($('#scenario-crew').value));modal.close();focusIncident();};
 $('#scenario-reset').onclick=()=>{resetSimulation();refreshModal();};
 $('#scenario-focus').onclick=()=>{modal.close();focusIncident();};
 $('#scenario-phone').onclick=()=>openModal('phone',incident?.crewId??Number($('#scenario-crew').value));
 $('#scenario-shared').onclick=()=>openModal('shared');
}

ship.labels.forEach(s=>s.visible=false);
const stars=[];let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};for(let i=0;i<750;i++){const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(1-y*y);stars.push(1500*r*Math.cos(a),1500*y,1500*r*Math.sin(a));}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));const starfield=new THREE.Points(geo,new THREE.PointsMaterial({color:'#9db4c1',size:.6}));scene.add(starfield);
function look(){camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))));}
function caption(title,subtitle){$('#zone-caption').innerHTML=`<span>${title}</span><small>${subtitle}</small>`;}
function setMode(next){stopMotion();mode=next;controls.enabled=mode==='exterior';ship.roof.visible=true;ship.labels.forEach(s=>s.visible=labelsOn&&mode==='exterior');$('#shell').textContent=mode==='interior'?'Exterior view':'Return inside';$('#shell').setAttribute('aria-pressed',String(mode==='exterior'));$('#labels').setAttribute('aria-pressed',String(labelsOn));$('#hover-tip').hidden=true;}
function resetView(){setMode('interior');camera.fov=68;camera.position.set(-9.1*SHIP_SCALE.x,EYE_HEIGHT,0);yaw=Math.PI/2;pitch=0;look();camera.updateProjectionMatrix();$('#zone-select').value='';caption('HIYOKO / Habitat corridor','Interior · Free exploration · WASD move · Q down / E up');}
function exterior(){setMode('exterior');camera.fov=45;camera.position.set(35,31,40).multiplyScalar(SHIP_SCALE.x);if(innerWidth<650)camera.position.multiplyScalar(1.55);controls.target.set(0,0,0);controls.update();camera.updateProjectionMatrix();caption('HIYOKO / Exterior','Left drag orbit · Right drag pan · Wheel zoom');}
function enterZone(id){const zone=zones.find(z=>z.id===id);if(!zone)return;setMode('interior');camera.fov=68;camera.updateProjectionMatrix();let x=zone.x,z=zone.z,y=EYE_HEIGHT;if(id==='cockpit'){x=-10;z=0;yaw=-Math.PI/2;}else if(id==='common'){x=simulationMode?8.3:7.3;z=simulationMode?-1.3:-1.82;yaw=Math.PI;}else if(id==='training'){x=7.75;z=3.8125;yaw=-.23;}else if(id==='service'){x=12.65;z=1.7;yaw=.4;}else{z=Math.sign(z)*1.48;yaw=z<0?Math.PI:0;}camera.position.set(x*SHIP_SCALE.x,y,z*SHIP_SCALE.z);pitch=id==='training'?-.28:id.startsWith('room')?-.25:0;look();caption(zone.name,zone.description);$('#zone-select').value=id;}
$('#zone-select').innerHTML+=[...zones].map(z=>`<option value="${z.id}">${z.name}</option>`).join('');$('#zone-select').onchange=e=>enterZone(e.target.value);
$('#crew-select').innerHTML+=crew.map((c,i)=>`<option value="${i}">${c.name} · Personal phone</option>`).join('');$('#crew-select').onchange=e=>{if(e.target.value!=='')openModal('phone',Number(e.target.value));e.target.value='';};
$('#reset-view').onclick=resetView;$('#shell').onclick=()=>mode==='interior'?exterior():resetView();$('#more').onclick=()=>{const o=$('#options');o.hidden=!o.hidden;$('#more').setAttribute('aria-expanded',String(!o.hidden));};
$('#labels').onclick=()=>{labelsOn=!labelsOn;ship.labels.forEach(s=>s.visible=labelsOn&&mode==='exterior');$('#labels').setAttribute('aria-pressed',String(labelsOn));};$('#labels').setAttribute('aria-pressed','false');
$('#pause').onclick=()=>{paused=!paused;$('#pause').setAttribute('aria-pressed',String(paused));$('#pause').textContent=paused?'Resume simulation':'Pause simulation';updateData();};$('#speed').onchange=e=>speed=Number(e.target.value);
function resetSimulation(){social.reset();conversation=null;time=0;eventStart=null;incident=null;emergencyRing.visible=false;acknowledged=false;paused=false;$('#pause').textContent='Pause simulation';$('#pause').setAttribute('aria-pressed','false');$('#event').disabled=false;updatePeople();updateData();resetView();}
function viewWindow(id=$('#zone-select').value){const port=ship.windows.find(p=>p.id===id)||ship.windows.find(p=>p.id==='common');setMode('interior');camera.position.set(port.x, EYE_HEIGHT,port.side*8.1);const target=port.side>0?new THREE.Vector3(...orbit.diagnostics().earthPosition):port.center.clone();const dir=target.sub(camera.position).normalize();yaw=Math.atan2(dir.x,dir.z);pitch=Math.asin(dir.y);look();caption('Earth observation / '+port.id,'SIMULATION · Slow illustrative orbit · Q / E free exploration');$('#options').hidden=true;}
$('#window-view').onclick=()=>viewWindow();$('#taiwan-view').onclick=()=>{viewWindow('common');caption('Taiwan-facing Earth','SIMULATION · East Asia / Taiwan · Approximate visual alignment');};
$('#orbit-view').onclick=()=>{setMode('exterior');camera.fov=62;camera.position.set(-400,100,130);controls.target.set(-10,-10,130);controls.update();camera.updateProjectionMatrix();caption('Earth orbit overview','SIMULATION · Slow continuous orbit · Navigation remains independent');$('#options').hidden=true;};
$('#reset').onclick=resetSimulation;$('#event').onclick=()=>{triggerScenario('heart',2);openModal('phone',2);};$('#shared').onclick=()=>openModal('shared');$('#info').onclick=()=>openModal('info');$('#scenario-open').onclick=()=>openModal('scenario');$('#incident-banner').onclick=()=>openModal('scenario');$('#close').onclick=()=>modal.close();
function updatePeople(dt=.016){activities=crew.map((_,i)=>routineAt(i,time));conversation=social.update(time,activities,!!incident);ship.people.forEach(({g,body,legs,arms,ring},i)=>{const collapsed=incident?.crewId===i&&incident.type==='collapse';const r=collapsed?{position:incident.position,moving:false,activity:'Simulated collapse',next:'Awaiting reset'}:activities[i];activities[i]=r;g.position.set(r.position[0],.08+(collapsed?.3/SHIP_SCALE.y:(.27+Math.sin(time*.8+i)*.055)/SHIP_SCALE.y),r.position[1]);const partner=conversation&&(conversation.a===i||conversation.b===i)?activities[conversation.a===i?conversation.b:conversation.a]:null;const heading=collapsed?0:r.moving?r.heading:partner?Math.atan2(partner.position[0]-r.position[0],partner.position[1]-r.position[1]):0;body.rotation.y+=Math.atan2(Math.sin(heading-body.rotation.y),Math.cos(heading-body.rotation.y))*(1-Math.exp(-4*dt));body.rotation.z=collapsed?-Math.min(1,(time-incident.start)/1.2)*Math.PI/2:Math.sin(time*.65+i)*.018;legs.forEach((leg,j)=>leg.rotation.x=collapsed?0:r.moving?Math.sin(time*.9+j*Math.PI+i)*.09:r.activity==='Cycle training'?Math.sin(time*1.8+j*Math.PI)*.28:r.activity==='Rest'?.12:0);
 arms.forEach((arm,j)=>{arm.rotation.x=collapsed?0:r.moving?Math.sin(time*.8+j*Math.PI+i)*-.07:r.activity==='Resistance training'?-.35-Math.sin(time*1.2)*.3:r.activity==='Stretching'?-.45-Math.sin(time*.65+j)*.2:r.activity==='Photo break'?-.85:r.activity==='Plant care'?-.4+Math.sin(time*.7)*.1:r.activity==='Shared meal'||r.activity==='Tea break'?-.25-Math.max(0,Math.sin(time*.65+j))*.35:r.activity==='Personal work'?(j===0?-.65:-.1):partner&&j===0?-.2-Math.sin(time*1.4)*.1:r.activity==='Rest'?-.15:0;});ring.visible=i===selected&&!collapsed;});emergencyRing.visible=!!incident;scene.children.find(o=>o.isHemisphereLight).color.set(incident?.type==='radiation'?'#ffcb7c':'#d8efff');if(incident){const p=(incident.type==='radiation'?ship.screen:ship.people[incident.crewId].g).getWorldPosition(new THREE.Vector3());emergencyRing.material.color.set(incident.type==='radiation'?'#ffd16c':incident.type==='offline'?'#80c5ff':'#ff815e');emergencyRing.position.set(p.x+.4,.08*SHIP_SCALE.y+.04,p.z);emergencyRing.scale.setScalar(1+Math.sin(time*4)*.06);}}
function updateData(){
  $('#clock').textContent = `T+${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  if (!simulationMode) return;
  const raw=readings(time,false).map((c,i)=>({...c,heart:c.heart+(activities[i].activity.includes('training')?22:activities[i].moving?8:0),activity:activities[i].activity,next:activities[i].next,sequence:Math.floor(time),timestamp:time}));data=scenarioReadings(raw,incident);const step=eventStart===null?-1:stageAt(time-eventStart);const name=incident?(incident.type==='radiation'?'Ship-wide':crew[incident.crewId].name):'';$('#event-status').textContent=step<0?'Ready for a simulated scenario':acknowledged?'Acknowledged; simulated event remains active until reset.':[`${name}：${scenarioName(incident.type)+' (scripted)'}`,'Crew device: same simulated event','Shared display: team event visible','Awaiting review: acknowledge on the shared display','Awaiting review: acknowledge on the shared display'][step];$('#incident-banner').hidden=!incident;$('#incident-banner').textContent=incident?`Simulated ${scenarioName(incident.type)} · ${name} · ${acknowledged?'Reviewed':'Awaiting review'} · F controls`:'';drawScreens();if(modal.open)refreshModal();}
function drawScreens(){const x=ship.shared.ctx;x.fillStyle='#10232b';x.fillRect(0,0,1024,512);x.fillStyle='#f6c85b';x.font='25px monospace';x.fillText('HIYOKO / CREW HEALTH',35,48);x.font='18px monospace';x.fillText('SIMULATION ONLY',755,48);data.forEach((c,i)=>{const y=108+i*74;x.fillStyle=c.flag?'#4b3827':'#1d343e';x.fillRect(25,y-28,974,62);x.fillStyle=c.color;x.font='26px monospace';x.fillText(c.name,45,y+10);x.fillStyle='#e1efee';x.fillText(`${c.heart??"--"} BPM`,310,y+10);x.fillText(`${c.oxygen??"--"}%`,550,y+10);x.fillText(c.flag?(c.dataQuality==='missing'?'OFFLINE':c.environmentalWarning?'ENV / SIM':c.fallDetected?'FALL / SIM':'CHECK IN'):'SIMULATED',750,y+10);const d=ship.devices[i],ctx=d.ctx;ctx.fillStyle='#132d37';ctx.fillRect(0,0,256,384);ctx.fillStyle=c.color;ctx.font='28px monospace';ctx.fillText(c.name,20,48);ctx.font='68px monospace';ctx.fillText(String(c.heart??"--"),20,155);ctx.font='24px monospace';ctx.fillText('BPM / SIM',20,199);ctx.fillText(`${c.oxygen??"--"}% O2`,20,250);ctx.fillText(c.flag?(c.dataQuality==='missing'?'OFFLINE':c.environmentalWarning?'ENV / SIM':c.fallDetected?'FALL / SIM':'CHECK IN'):'SIMULATED',20,330);d.texture.needsUpdate=true;});ship.shared.texture.needsUpdate=true;}
const wave=`<svg class="spark" viewBox="0 0 260 45" aria-label="Decorative simulated waveform"><path d="M0 26H25l5 -5 5 5h15l4 8 6 -29 6 21h25l5 -5 5 5h22l4 8 6 -29 6 21h25l5 -5 5 5h23l4 8 6 -29 6 21h26" fill="none" stroke="#91d6c1" stroke-width="1.5"/></svg>`;
function openModal(type, id = selected) {
  keys.clear();
  stopMotion();
  selected = id;
  $('#options').hidden = true;
  $('#more').setAttribute('aria-expanded', 'false');
  $('#hover-tip').hidden = true;
  const medical = !simulationMode && (type === 'phone' || type === 'shared');
  modal.classList.toggle('health-modal', medical);
  modal.classList.toggle('phone-modal', type === 'phone');
  modalType = medical ? 'health' : type;
  if (medical) {
    const phone = type === 'phone';
    const title = phone ? 'Personal health app' : 'Crew health board';
    $('#modal-kicker').textContent = phone ? crew[id].name + ' / ' + title : title;
    if (!stationsReady) {
      $('#modal-body').textContent = 'Preparing device sign-in. Check the health service connection.';
      if (!modal.open) modal.showModal();
      return;
    }
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.src = phone ? '/stations/' + crew[id].id + '/app' : '/stations/display/board';
    frame.allowFullscreen = !phone;
    $('#modal-body').replaceChildren(frame);
    if (!modal.open) modal.showModal();
    return;
  }
  $('#modal-kicker').textContent=type==='phone'?'PERSONAL DEVICE / SIMULATION':type==='shared'?'SHARED HEALTH DISPLAY / SIMULATION':'HIYOKO / Controls and data flow';if(type==='phone'){const c=data[id];$('#modal-body').innerHTML=`<div class="phone"><div class="phone-head"><span>HIYOKO HEALTH</span><span>Simulated data</span></div><h2>${c.name}</h2><p>${c.role}</p><p id="phone-activity"></p><div class="heart"><span id="phone-hr"></span> <small>BPM</small></div>${wave}<div class="stats"><div><strong id="phone-o2"></strong><small>Oxygen SpO₂</small></div><div><strong id="phone-temp"></strong><small>Temperature °C</small></div></div><div id="phone-notice" class="notice"></div><p class="subtle">Standalone demonstration. No real health system is connected.</p></div>`;}else if(type==='shared'){$('#modal-body').innerHTML=`<h2>Shared crew health display</h2><p class="subtle">All five devices and this display share the same local simulated state.</p><table class="dashboard-table"><thead><tr><th>Crew</th><th>Activity</th><th>Heart rate</th><th>Oxygen</th><th>Status</th></tr></thead><tbody>${crew.map((c,i)=>`<tr><td>${c.name}</td><td id="activity-${i}"></td><td id="heart-${i}"></td><td id="oxygen-${i}"></td><td id="flag-${i}"></td></tr>`).join('')}</tbody></table><p id="shared-state" class="state-line"></p><button id="ack">Acknowledge · keep event active</button><p class="subtle">Acknowledgement means reviewed, not treated. This demo sends no notifications and stores no medical records.</p>`;$('#ack').onclick=()=>{acknowledged=true;if(incident)incident.acknowledged=true;updateData();};}else if(type==='scenario'){$('#modal-kicker').textContent='SCENARIO CONTROL / SIMULATION';$('#modal-body').innerHTML=scenarioPanel();bindScenarioPanel();}else{$('#modal-body').innerHTML=`<h2>Explore HIYOKO</h2><p class="modal-copy">Inside: left drag to look, right drag to pan horizontally, wheel to move horizontally. WASD / arrows move; Q lowers and E raises the camera. Looking up never changes forward movement height. Explore freely through the hull. Use the area menu to jump to a room. Click a phone or crew member for the personal display, or the commons screen for the shared display. Esc closes panels. Outside: left orbit, right pan, wheel zoom. Reset view returns to the interior starting point.</p>${simulationMode ? `<h3>Working now: local simulation</h3><div class="pipeline"><span>Routines / synthetic readings</span><span>Shared state</span><span>Phones + shared display</span><span>Alert + acknowledgement</span></div><p class="modal-copy">Five crew cycle through rest, duty, exercise, meals and work. One simulation clock drives motion and readings. Samples carry crew ID, simulation time, sequence and simulation provenance. Scenarios are scripted, not medical assessments. Pause and speed affect routines, readings and events together.</p><h3>Future integration: not implemented</h3><div class="pipeline"><span>Sensors / Wokwi</span><span>Ingestion + validation</span><span>Backend + event storage</span><span>Live subscriptions</span></div><p class="modal-copy">The health system and Wokwi are not connected or embedded. A future adapter must validate device identity, timestamps, units and data quality, handle stale or missing data, and deduplicate by event ID. Personal and shared screens need different permissions. This remains a plan: there is no external data transmission or database.</p>` : `<h3>Onboard health system</h3><p class="modal-copy">Each crew device starts signed in. Live readings and the latest emergency appear on the commons wall. Click it for the full board.</p>`}<h3>Orbital scene: illustrative only</h3><p class="modal-copy">Use More for the lower observation windows, Taiwan view and Earth orbit overview. Earth stays below the craft; the slow orbital display continues when health simulation is paused. Earth and Moon sizes and distances are adjusted for visibility. Taiwan alignment is approximate. Crew gently float; their earthward posture is a visual choice, not gravity holding them to the deck.</p><h3>Design references and limitations</h3><p class="modal-copy">An original near-future habitat informed by ISS equipment, ESA Lunar I-Hab ergonomics and science-fiction modular interiors. Crew are approximately 1.8 m tall; room door clearances are 2.15 m high and 1.30 m wide. The corridor service ceiling is about 3.2 m high, with taller shared areas. This is not an engineering replica or a microgravity simulation. Walking and falls are stylized; there is no character-control mode, collision avoidance or real medical detection.</p><div class="sources"><a href="https://www.nasa.gov/missions/meet-nasas-orion-spacecraft/" target="_blank" rel="noopener">NASA · Orion spacecraft</a><br><a href="https://www.esa.int/ESA_Multimedia/Images/2024/04/Lunar_I-Hab_mock-up_interior" target="_blank" rel="noopener">ESA · Lunar I-Hab interior</a><br><a href="https://blogs.esa.int/luca-parmitano/2013/11/06/guide-to-the-international-space-station-for-the-occasional-visitor-part-2/" target="_blank" rel="noopener">ESA · ISS interior and exercise equipment</a><br><a href="https://www.ex-astris-scientia.org/gallery/snw-sets-props.htm" target="_blank" rel="noopener">Science-fiction reference · Strange New Worlds sets</a></div>`;}refreshModal();if(!modal.open)modal.showModal();}
function refreshModal(){if(modalType==='phone'){const c=data[selected];$('#phone-hr').textContent=c.heart??'—';$('#phone-o2').textContent=c.oxygen===null?'—':c.oxygen+'%';$('#phone-temp').textContent=c.temperature===null?'—':c.temperature+'°';$('#phone-activity').textContent=c.activity+(activities[selected].moving?' → '+c.next:'')+(paused?' · Paused':'');$('#phone-notice').textContent=c.flag?`${scenarioName(incident.type)} (simulated script) · ${c.eventState==='acknowledged'?'Reviewed; awaiting reset':'Awaiting review'} · ${c.eventId}`:'Synthetic readings · Not medical interpretation';}else if(modalType==='shared'){data.forEach((c,i)=>{$(`#activity-${i}`).textContent=c.activity;$(`#heart-${i}`).textContent=c.heart===null?'—':c.heart+' BPM';$(`#oxygen-${i}`).textContent=c.oxygen===null?'—':c.oxygen+'%';$(`#flag-${i}`).textContent=c.flag?scenarioName(incident.type)+(c.eventState==='acknowledged'?' / reviewed':''):'Simulated';$(`#flag-${i}`).classList.toggle('warning',c.flag);});$('#shared-state').textContent=acknowledged?'Review acknowledged. Simulated event remains active; reset from the F panel.':eventStart===null?'No active event.':$('#event-status').textContent;$('#ack').disabled=eventStart===null||time-eventStart<6||acknowledged;}else if(modalType==='scenario'){$('#scenario-current').textContent=incident?`${incident.id} · ${incident.type==='radiation'?'Ship-wide':crew[incident.crewId].name} · ${$('#event-status').textContent}`:'No active simulated event';$('#scenario-focus').disabled=!incident;}}
// Interior controls use a human-height camera. Exterior controls use OrbitControls.
const keys=new Set();window.addEventListener('keydown',e=>{if(simulationMode&&e.key.toLowerCase()==='f'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();if(modal.open&&modalType==='scenario')modal.close();else openModal('scenario');return;}if(modal.open||['SELECT','BUTTON','INPUT'].includes(document.activeElement?.tagName))return;if(['w','a','s','d','q','e','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){keys.add(e.key);e.preventDefault();}});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>{keys.clear();stopMotion();});modal.addEventListener('close', () => {
  // A queued close from the previous device may arrive after the next one opens.
  if (modal.open) return;
  if (modalType === 'health') $('#modal-body').replaceChildren();
  keys.clear();
  renderer.domElement.focus({ preventScroll: true });
});
function translate(forward,right){camera.position.x+=Math.sin(yaw)*forward-Math.cos(yaw)*right;camera.position.z+=Math.cos(yaw)*forward+Math.sin(yaw)*right;look();}
let down=null;const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();const canvas=renderer.domElement;
function hitAt(e){const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hits=ray.intersectObject(ship.root,true);return hits.find(h=>h.object.visible&&h.object.parent?.visible);}
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,button:e.button,moved:false};canvas.focus({preventScroll:true});if(mode==='interior')canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(down){const dx=e.clientX-down.lastX,dy=e.clientY-down.lastY;down.lastX=e.clientX;down.lastY=e.clientY;if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)down.moved=true;if(mode==='interior'){if(down.button===0){yaw-=dx*.004;pitch=THREE.MathUtils.clamp(pitch-dy*.004,-1.2,1.2);look();}else if(down.button===2){panQueue.forward+=dy*.035;panQueue.right-=dx*.035;}}$('#hover-tip').hidden=true;}else{const h=hitAt(e),kind=h?.object.userData.kind;const clickable=['crew','phone','shared','zone','window'].includes(kind);canvas.style.cursor=clickable?'pointer':'grab';const tip=$('#hover-tip');tip.hidden=!clickable;if(clickable){tip.textContent=kind==='window'?'View Earth through this window':kind==='shared'?'Click to enlarge shared display':kind==='zone'?'Go to this area':`Open ${crew[h.object.userData.id].name} phone`;tip.style.left=Math.min(innerWidth-180,e.clientX+14)+'px';tip.style.top=Math.max(10,e.clientY-35)+'px';}}});
canvas.addEventListener('pointerup',e=>{if(down&&!down.moved&&down.button===0){const h=hitAt(e);if(h){const {kind,id}=h.object.userData;if(kind==='shared')openModal('shared');else if(kind==='crew'||kind==='phone')openModal('phone',id);else if(kind==='zone')enterZone(id);else if(kind==='window')viewWindow(id);}}down=null;});canvas.addEventListener('pointercancel',()=>down=null);
canvas.addEventListener('wheel',e=>{if(mode==='interior'){e.preventDefault();panQueue.forward-=Math.sign(e.deltaY)*1.5;}},{passive:false});
new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(viewport);
function drawHealthEntrances() {
  const screens = ship.devices.map((screen, id) => [screen, crew[id].name]);
  for (const [screen, title] of screens) {
    const { ctx, texture } = screen;
    const { width, height } = ctx.canvas;
    ctx.fillStyle = '#132d37';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#91d6c1';
    ctx.font = `${Math.round(width * 0.045)}px monospace`;
    ctx.fillText('HIYOKO HEALTH', width * 0.07, height * 0.24);
    ctx.fillStyle = '#f2f7f5';
    ctx.font = `bold ${Math.round(width * 0.095)}px sans-serif`;
    ctx.fillText(title, width * 0.07, height * 0.53);
    ctx.fillStyle = '#c2d7d3';
    ctx.font = `${Math.round(width * 0.05)}px sans-serif`;
    ctx.fillText('Click to open', width * 0.07, height * 0.79);
    texture.needsUpdate = true;
  }
}
const modeLink = $('#health-mode-link');
if (simulationMode) {
  modeLink.href = './';
  modeLink.textContent = 'Open health system mode';
} else {
  drawHealthEntrances();
  wallEmergency = startHealthStations(ship.shared, ready => {
    stationsReady = ready;
    $('#crew-select').disabled = !ready;
    $('.sim-dot').textContent = ready ? 'Health system' : 'Preparing devices';
    if (ready && modal.open && modalType === 'health' && !$('#modal-body iframe')) {
      openModal(modal.classList.contains('phone-modal') ? 'phone' : 'shared');
    }
  });
  $('#crew-select').disabled = true;
  for (const id of ['scenario-open', 'event', 'event-status']) $('#' + id).hidden = true;
  $('.sim-dot').textContent = 'Preparing devices';
  $('#mode-description').textContent = 'Each crew device starts signed in. Live readings and the latest emergency appear on the commons wall. Click it for the full board.';
  $('#device-hint').textContent = 'Click a device to open the health system';
}
$('#language').onchange=e=>{setLanguage(e.target.value);updateData();};localizeDOM();
resetView();updatePeople();updateData();$('#loading').remove();let last=performance.now(),acc=0;
function animate(now){requestAnimationFrame(animate);const elapsed=Math.max(0,Math.min((now-last)/1000,.5)),dt=Math.min(elapsed,.1);last=now;if(document.hidden)return;orbitTime+=elapsed;if(!paused){time+=elapsed*speed;acc+=elapsed*speed;updatePeople(dt);}if(mode==='interior'&&!modal.open){const f=(keys.has('w')||keys.has('ArrowUp')?1:0)-(keys.has('s')||keys.has('ArrowDown')?1:0),r=(keys.has('d')||keys.has('ArrowRight')?1:0)-(keys.has('a')||keys.has('ArrowLeft')?1:0),u=(keys.has('e')?1:0)-(keys.has('q')?1:0);const norm=Math.max(1,Math.hypot(f,r)),blend=1-Math.exp(-14*dt);velocity.forward+=(f*5/norm-velocity.forward)*blend;velocity.right+=(r*5/norm-velocity.right)*blend;velocity.up+=(u*4-velocity.up)*blend;const panBlend=1-Math.exp(-18*dt),pf=panQueue.forward*panBlend,pr=panQueue.right*panBlend;panQueue.forward-=pf;panQueue.right-=pr;translate(velocity.forward*dt+pf,velocity.right*dt+pr);camera.position.y+=velocity.up*dt;look();}if(acc>=1){acc=0;updateData();}if(mode==='exterior')controls.update();orbit.update(orbitTime);starfield.quaternion.copy(orbit.skyAttitude());if (!(modal.open && modalType === 'health')) renderer.render(scene,camera);drawConversation(now);frame++;}requestAnimationFrame(animate);
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();caption('3D rendering interrupted','Reload to restore WebGL');});
function screenPosition(object){const p=object.getWorldPosition(new THREE.Vector3()).project(camera);return{x:(p.x+1)/2*canvas.clientWidth,y:(1-p.y)/2*canvas.clientHeight};}
window.demoDiagnostics=()=>({wallEmergency:wallEmergency(),conversation,socialChecks,conversationCount:social.count,activities:activities.map(a=>a.activity),language,canvasTexts:localizedCanvasText(),orbit:orbit.diagnostics(),logoReady:!!ship.roof.userData.logoReady,windows:ship.windows.length,mode,worldScale:SHIP_SCALE,freeCamera:true,crew:ship.people.length,devices:ship.devices.length,rooms:zones.filter(z=>z.id.startsWith('room')).length,zones:zones.map(z=>z.id),sharedScreens:1,simulationTime:time,paused,stage:eventStart===null?-1:stageAt(time-eventStart),acknowledged,incident:incident?{...incident}:null,crewRotations:ship.people.map(p=>p.body.rotation.z),data:data.map(c=>({...c})),positions:ship.people.map(p=>p.g.position.toArray()),camera:camera.position.toArray(),target:controls.target.toArray(),direction:camera.getWorldDirection(new THREE.Vector3()).toArray(),phonePixels:ship.people.map(p=>screenPosition(p.phone)),screenPixel:screenPosition(ship.screen),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,webgl:renderer.capabilities.isWebGL2,frame});
