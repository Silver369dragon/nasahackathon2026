import {buildOrbitalHull} from './orbital-hull.js';
import {localizedContext} from './i18n.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {dressCabin} from './cabin-design.js';
import * as THREE from 'three';
import {SHIP_SCALE} from './config.mjs';

function cabinZones(crew) { return [
  {id:'cockpit',name:'Flight deck',label:'01 / FLIGHT DECK',x:-12,z:0,description:'Flight consoles, restraint seats and observation panels. Navigation graphics are illustrative; no flight controls.'},
  ...crew.map((c,i)=>({id:`room-${i}`,name:`${c.name} quarters`,label:`0${i+2} / ${c.name.toUpperCase()} QUARTERS`,x:[-7,-2,3,-7,-2][i],z:i<3?-3.55:3.55,description:'Private sleeping quarters with a restraint bunk, work desk, stowage and handrails.'})),
  {id:'common',name:'Commons',label:'07 / COMMONS',x:9,z:-3,description:'A communal table, galley and shared health display. Click the display to open it.'},
  {id:'training',name:'Training and recovery',label:'08 / TRAINING',x:7.5,z:3.4,description:'Restraint treadmill, resistance frame and cycle. Exercise and health scenarios are synthetic; equipment collects no real readings.'},
  {id:'service',name:'Systems and airlock',label:'09 / SYSTEMS',x:13.7,z:2.7,description:'Concept service racks, stowage and airlock. No real networking, backend or life-support controls.'}
]; }

export function buildShip(crew){
 const zones = cabinZones(crew);
 const root=new THREE.Group(),roof=new THREE.Group(),pickables=[],people=[],devices=[],labels=[];
 root.scale.set(SHIP_SCALE.x,SHIP_SCALE.y,SHIP_SCALE.z);
 let buildParent=root;
 function furnishedArea(x,z){const group=new THREE.Group();group.scale.set(1/SHIP_SCALE.x,1/SHIP_SCALE.y,1/SHIP_SCALE.z);group.position.set(x*(1-1/SHIP_SCALE.x),.08,z*(1-1/SHIP_SCALE.z));root.add(group);buildParent=group;return group;}
 const materials=new Map();const mat=(c,metal=.25)=>{const key=c+metal;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color:c,metalness:metal,roughness:.72}));return materials.get(key);};
 const white=mat('#c9c9bf',.12),dark=mat('#15252b'),steel=mat('#48565c',.55),cream=mat('#e3d9c5',.1),glass=mat('#122d39',.6),yellow=mat('#b48b52',.45);
 const glow=new THREE.MeshBasicMaterial({color:'#a3e1e3'});
 const box=(w,h,d,x,y,z,m=white,parent=buildParent)=>{const o=new THREE.Mesh(((parent!==root&&parent!==roof&&Math.min(w,h,d)>.08)?new RoundedBoxGeometry(w,h,d,2,Math.min(.065,Math.min(w,h,d)/4)):new THREE.BoxGeometry(w,h,d)),m);o.position.set(x,y,z);parent.add(o);return o;};
 const cyl=(r1,r2,h,x,y,z,m=steel,parent=buildParent)=>{const o=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),m);o.position.set(x,y,z);parent.add(o);return o;};
 const sphere=(r,x,y,z,m,parent=buildParent)=>{const o=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),m);o.position.set(x,y,z);parent.add(o);return o;};
 function canvasScreen(w=512,h=256){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const localized=localizedContext(canvas),ctx=localized.ctx,texture=new THREE.CanvasTexture(canvas);localized.bind(texture);texture.colorSpace=THREE.SRGBColorSpace;return{canvas,ctx,texture};}
 function panel(text,w,h,x,y,z,parent=buildParent){const d=canvasScreen();d.ctx.fillStyle='#102934';d.ctx.fillRect(0,0,512,256);d.ctx.fillStyle='#9fddd9';d.ctx.font='bold 28px monospace';d.ctx.fillText(text,22,52);d.ctx.strokeStyle='#457786';for(let i=0;i<4;i++){d.ctx.strokeRect(20+i*120,90,100,110);d.ctx.fillRect(30+i*120,160-i*15,80,5);}d.texture.needsUpdate=true;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:d.texture}));o.position.set(x,y,z);parent.add(o);return o;}
 function sign(text,x,y,z,color='#c7e9e9',width=4){const d=canvasScreen(768,96);d.ctx.fillStyle='#11232be8';d.ctx.fillRect(0,0,768,96);d.ctx.fillStyle=color;d.ctx.font='bold 30px monospace';d.ctx.textAlign='center';d.ctx.fillText(text,384,60);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:d.texture,depthTest:false,transparent:true}));s.position.set(x,y,z);s.scale.set(width,.5,1);s.renderOrder=5;root.add(s);labels.push(s);return s;}
 function rail(x,y,z,w=1,parent=buildParent){box(w,.06,.07,x,y,z,yellow,parent);box(.05,.18,.08,x-w/2,y-.07,z,steel,parent);box(.05,.18,.08,x+w/2,y-.07,z,steel,parent);}
 function chair(x,z,rotation=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;buildParent.add(g);cyl(.12,.2,.55,0,.3,0,steel,g);box(.8,.2,.8,0,.63,0,dark,g);box(.8,1.05,.2,0,1.15,-.35,dark,g);box(.12,.8,.03,-.2,1.1,-.22,yellow,g);box(.12,.8,.03,.2,1.1,-.22,yellow,g);box(.1,.12,.7,-.5,.9,0,steel,g);box(.1,.12,.7,.5,.9,0,steel,g);}
 // Continuous pressure hull, axial corridor and a removable roof.

 root.add(roof);const windows=buildOrbitalHull(root,roof,SHIP_SCALE);

 box(.2,2.8,11.5,14.9,1.3,0,white);


 box(28,.025,1.6,0,.07,0,mat('#202b30'));
 for(const z of [-.85,.85])box(28,.025,.055,0,.09,z,glow);

 // Hull rings, utilities, ventilation and exterior identification.
 for(let x=-13;x<15;x+=2){box(1.6,.45,.1,x,.4,-5.72,dark);for(let n=0;n<5;n++)box(1.35,.025,.04,x,.25+n*.07,-5.64,steel);}
 for(const z of [-2.2,2.2]){const win=box(.08,1,2.3,-14.85,2.55,z,glass);win.rotation.z=-.2;}
 const space=canvasScreen(1024,512),sc=space.ctx;const sky=sc.createLinearGradient(0,0,0,512);sky.addColorStop(0,'#030a16');sky.addColorStop(1,'#193a4c');sc.fillStyle=sky;sc.fillRect(0,0,1024,512);for(let n=0;n<160;n++){sc.fillStyle=n%4?'#8bacc2':'#e6f2ed';sc.fillRect((n*317)%1024,(n*173)%512,n%7===0?2:1,n%7===0?2:1);}sc.fillStyle='#2d8299';sc.beginPath();sc.arc(820,700,420,0,Math.PI*2);sc.fill();sc.strokeStyle='#b4dadd';sc.lineWidth=6;sc.stroke();space.texture.needsUpdate=true;
 for(const z of [-2.2,2.2]){const view=new THREE.Mesh(new THREE.PlaneGeometry(2.15,.94),new THREE.MeshBasicMaterial({map:space.texture}));view.position.set(-14.79,2.55,z);view.rotation.y=Math.PI/2;root.add(view);}

 for(const z of [-3.5,0,3.5]){let e=cyl(1,1.3,2.7,16.25,-.1,z,dark);e.rotation.z=Math.PI/2;e=cyl(.82,1,.12,17.65,-.1,z,new THREE.MeshBasicMaterial({color:'#78c6d9'}));e.rotation.z=Math.PI/2;}
 // Forward flight deck: seats face a three-display flight console.
 furnishedArea(-12,0);
 box(3.5,.9,7.8,-13,.5,0,dark);for(let i=-1;i<=1;i++){const p=panel(['NAVIGATION','FLIGHT / SIM','SYSTEMS'][i+1],2.1,1.15,-12,1.5,i*2.4);p.rotation.y=Math.PI/2;}
 chair(-10.6,-2,Math.PI/2);chair(-10.6,2,Math.PI/2);
 for(const z of [-4.6,4.6]){box(2.4,.65,.8,-12.2,.4,z,white);for(let i=0;i<6;i++)box(.13,.07,.18,-13+i*.3,.76,z,i%2?yellow:glass);}
 buildParent=root;
 // Five enclosed personal quarters; doors open onto the same central corridor.
 zones.filter(z=>z.id.startsWith('room')).forEach((room,i)=>{const {x,z}=room,side=Math.sign(z),accent=mat(crew[i].color);

   for(const edge of [-2.4,2.4]){
     const shape=new THREE.Shape(),lo=z-2.375,hi=z+2.375;shape.moveTo(-lo,0);shape.lineTo(-hi,0);
     for(let n=0;n<=32;n++){const zz=hi-(hi-lo)*n/32,top=Math.min(2.7,(.05+6.1*Math.sqrt(Math.max(0,1-(zz*SHIP_SCALE.z/9.7)**2)))/SHIP_SCALE.y-.06);shape.lineTo(-zz,Math.max(.1,top));}shape.closePath();
     const wall=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.15,bevelEnabled:false}),white);wall.rotation.y=Math.PI/2;wall.position.x=x+edge-.075;root.add(wall);
   }
   // 1.30 m clear opening, 2.15 m clear height above the deck, independent of hull scale.
   const opening=1.60/SHIP_SCALE.x, top=2.48/SHIP_SCALE.y;
   const flank=(4.8-opening)/2;
   for(const edge of [-1,1])box(flank,2.7,.18,x+edge*(opening/2+flank/2),1.35,side*1.15,white);
   box(opening,2.7-top,.18,x,(2.7+top)/2,side*1.15,white);
   furnishedArea(x,z);
   box(1,1.9,.23,x-1.35,1.05,z+side*1.55,cream);box(.8,1.5,.22,x-1.35,1.1,z+side*1.35,accent);box(.7,.25,.24,x-1.35,1.78,z+side*1.2,cream);
   for(let n=0;n<3;n++)box(.85,.045,.04,x-1.35,.65+n*.38,z+side*1.19,steel);
   box(1.15,2,.75,x+1.45,1,z+side*1.5,white);for(let n=0;n<3;n++){box(1,.025,.02,x+1.45,.4+n*.55,z+side*1.08,steel);rail(x+1.45,.65+n*.55,z+side*1.05,.35);}
   box(1.35,.12,.65,x+.9,.82,z-side*.2,cream);box(.1,.8,.1,x+.4,.4,z-side*.2,steel);const terminal=panel('PRIVATE / SIM',.7,.45,x+.9,1.2,z-side*.2);terminal.rotation.x=-.2;
   rail(x,.9,z+side*2.15,1);box(.7,.14,.1,x,2.1,z+side*2.15,glow);buildParent=root;
 });
 // Commons with a five-place table, galley, water and a shared display.
 box(.15,1.25,4.8,4.9,.6,-3.5,white);
 furnishedArea(9,-3);
 box(3.4,.17,1.8,8.5,.95,-3.1,cream);for(const x of [7.3,9.7])box(.16,.9,.16,x,.45,-3.1,steel);
 for(const [x,z] of [[7.2,-4.5],[9.5,-4.5],[7.2,-1.75],[9.5,-1.75],[11,-3.1]]){cyl(.33,.33,.6,x,.35,z,dark);box(.1,.03,.65,x,.68,z,yellow);}
 for(const x of [7.4,8.5,9.6]){cyl(.15,.15,.15,x,1.12,-3.2,steel);box(.3,.025,.45,x,1.05,-2.75,mat('#8da6a0'));}
 box(1.5,2.1,1.4,13.4,1,-4.6,white);panel('WATER / FOOD',.9,.5,13.4,1.5,-3.87);box(.6,.45,.1,13.4,.7,-3.87,glass);rail(13.4,.4,-3.8,.8);
 const shared=canvasScreen(1024,512);box(4.5,1.95,.2,5.6,2.05,-4.54,dark);const screen=new THREE.Mesh(new THREE.PlaneGeometry(4.3,1.8),new THREE.MeshBasicMaterial({map:shared.texture}));screen.position.set(5.6,2.05,-4.42);screen.userData={kind:'shared'};buildParent.add(screen);pickables.push(screen);buildParent=root;
 // Training: restraint treadmill, resistive exercise frame, stationary cycle.
 box(9,.04,4.65,7.5,.08,3.5,mat('#364b52'));box(.15,1.2,4.8,2.8,.6,3.5,white);
 furnishedArea(7.5,3.4);
 box(1.65,.22,2.8,4.3,.22,3.7,dark);box(1.25,.04,2.3,4.3,.35,3.7,mat('#1b2830'));
 for(let z=2.8;z<4.8;z+=.25)box(1.2,.02,.03,4.3,.38,z,steel);
 for(const x of [3.55,5.05]){box(.1,1.5,.1,x,1,2.5,steel);box(.06,.06,1.2,x,1.6,3,yellow);}panel('TREAD / SIM',1,.55,4.3,1.65,2.5);
 for(const x of [7,9])box(.15,2.15,.15,x,1.075,4.8,steel);box(2.2,.16,.16,8,2.15,4.8,steel);box(1.8,.1,.1,8,1.8,4.65,yellow);for(const x of [7.2,8.8])box(.04,1.5,.04,x,1.75,4.65,dark);box(2.2,.15,1.3,8,.2,4.2,dark);
 const fly=cyl(.5,.5,.24,10.6,.65,3.5,steel);fly.rotation.z=Math.PI/2;box(.12,1,.12,10.6,.9,3.8,white);box(.55,.1,.35,10.6,1.4,3.85,dark);box(.12,1.4,.12,10.6,1.1,2.9,steel);rail(10.6,1.7,2.9,.8);box(1,.1,.1,10.6,.6,3.5,yellow);
 buildParent=root;
 // Service racks and a circular airlock with a handwheel.
 box(.15,1.5,4.8,12,.7,3.5,white);furnishedArea(13.7,2.7);for(const z of [2,3.4,4.8]){box(1.1,2.1,1.1,13.8,1,z,dark);for(let n=0;n<4;n++){box(.08,.25,.8,13.2,.4+n*.45,z,white);box(.1,.07,.12,13.14,.4+n*.45,z,glow);}}
 buildParent=root;let hatch=cyl(1,1,.2,15.05,1.3,0,dark);hatch.rotation.z=Math.PI/2;hatch=cyl(.75,.75,.23,15.1,1.3,0,white);hatch.rotation.z=Math.PI/2;
 const hatchRing=new THREE.Mesh(new THREE.TorusGeometry(.4,.04,8,24),yellow);hatchRing.rotation.y=Math.PI/2;hatchRing.position.set(15.25,1.3,0);root.add(hatchRing);buildParent=root;
 // Crew stay near their quarters and carry their personal device.
 crew.forEach((c,i)=>{
   const room=zones[i+1],g=new THREE.Group(),body=new THREE.Group();
   g.position.set(room.x,.1,room.z-Math.sign(room.z)*.8);
   g.scale.set(1/SHIP_SCALE.x,1/SHIP_SCALE.y,1/SHIP_SCALE.z);root.add(g);g.add(body);
   const suit=mat(c.color),legs=[],arms=[];
   box(.6,.72,.38,0,.94,0,suit,body);box(.62,.12,.4,0,.62,0,dark,body);
   sphere(.31,0,1.48,0,cream,body);const visor=sphere(.28,0,1.5,.22,glass,body);visor.scale.set(1,.68,.7);
   for(const x of [-.18,.18]){const leg=new THREE.Group();leg.position.set(x,.62,0);body.add(leg);box(.23,.5,.25,0,-.25,0,cream,leg);box(.27,.12,.42,0,-.54,.08,dark,leg);box(.24,.12,.27,0,-.3,.01,suit,leg);legs.push(leg);}
   for(const x of [-.43,.43]){const arm=new THREE.Group();arm.position.set(x,1.2,0);body.add(arm);box(.2,.58,.23,0,-.26,.05,suit,arm);sphere(.11,0,-.56,.05,cream,arm);arms.push(arm);}
   box(.35,.45,.2,0,.95,-.28,dark,body);box(.28,.18,.04,0,1,.21,cream,body);
   const d=canvasScreen(256,384),phone=box(.34,.48,.07,.48,.91,.25,dark,body);
   const face=new THREE.Mesh(new THREE.PlaneGeometry(.29,.42),new THREE.MeshBasicMaterial({map:d.texture,side:THREE.DoubleSide}));face.position.set(.48,.91,.291);body.add(face);devices.push(d);
   const ring=new THREE.Mesh(new THREE.TorusGeometry(.67,.025,6,32),new THREE.MeshBasicMaterial({color:c.color}));ring.rotation.x=-Math.PI/2;ring.position.y=.025;g.add(ring);
   g.traverse(o=>{if(o.isMesh){o.userData={kind:'crew',id:i};pickables.push(o);}});phone.userData={kind:'phone',id:i};face.userData={kind:'phone',id:i};people.push({g,body,legs,arms,ring,phone:face});
 });
 dressCabin(root,zones,crew,SHIP_SCALE);
 zones.forEach((zone,i)=>{const s=sign(zone.label,zone.x,3.2,zone.z,i>0&&i<6?crew[i-1].color:'#c1e4e6',zone.id==='cockpit'?4:3.5);s.userData={kind:'zone',id:zone.id};pickables.push(s);});
 sign('HIYOKO / DEEP SPACE HABITAT',0,4.2,0,'#f6c85b',8).visible=false;
 return{root,roof,windows,pickables,people,devices,shared,labels,screen,canvasScreen,zones};
}
