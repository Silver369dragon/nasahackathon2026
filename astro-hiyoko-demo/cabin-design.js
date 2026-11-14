import {localizedContext} from './i18n.js';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// All interior fittings use metres, independent of the pressure-hull scale.
export function dressCabin(root,zones,crew,scale){
 const cabin=new THREE.Group();cabin.scale.set(1/scale.x,1/scale.y,1/scale.z);root.add(cabin);
 const material=(color,metalness=.15)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.72});
 const ivory=material('#c7c6bc'), inset=material('#9caaa7'), graphite=material('#202c33'), trim=material('#53666b',.55), brass=material('#b49360',.6), fabric=material('#34535a');
 const warm=new THREE.MeshBasicMaterial({color:'#ffe3b1'}), cool=new THREE.MeshBasicMaterial({color:'#addcd8'});
 const geometry=new Map();
 function box(w,h,d,x,y,z,m=ivory,bevel=.035,parent=cabin){const key=[w,h,d,bevel].join('/');if(!geometry.has(key))geometry.set(key,bevel?new RoundedBoxGeometry(w,h,d,2,Math.min(bevel,w/4,h/4,d/4)):new THREE.BoxGeometry(w,h,d));const o=new THREE.Mesh(geometry.get(key),m);o.position.set(x,y,z);parent.add(o);return o;}
 function lettering(title,subtitle,w,h,x,y,z,rotation=0){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const localized=localizedContext(canvas),c=localized.ctx;c.fillStyle='#1b2b31';c.fillRect(0,0,1024,256);c.fillStyle='#d8c199';c.fillRect(0,0,12,256);c.font='600 62px monospace';c.fillText(title,42,100);c.fillStyle='#a7c7c5';c.font='27px monospace';c.fillText(subtitle,44,176);const map=new THREE.CanvasTexture(canvas);localized.bind(map);map.colorSpace=THREE.SRGBColorSpace;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));o.position.set(x,y,z);o.rotation.y=rotation;cabin.add(o);return o;}
 // Recessed, human-sized door cassettes with a dark gasket and warm lintel light.
 zones.filter(z=>z.id.startsWith('room')).forEach((room,i)=>{
   const x=room.x*scale.x,side=Math.sign(room.z),z=side*1.15*scale.z,front=z-side*.19;
   for(const d of [-1,1]){
     box(.16,2.24,.29,x+d*.73,1.26,z-side*.10,graphite);
     box(.055,2.12,.32,x+d*.69,1.23,z-side*.13,trim);
     box(.025,1.2,.025,x+d*.79,1.3,front,cool,0);
   }
   box(1.62,.18,.29,x,2.38,z-side*.10,graphite);box(1.30,.035,.045,x,2.31,front-side*.12,warm,0);
   box(1.55,.035,.4,x,.15,z,trim);
   lettering(`0${i+1}  ${crew[i].name.toUpperCase()}`,'CREW QUARTERS  /  HABITAT',1.6,.4,x,2.72,front,side>0?Math.PI:0);
   for(const dx of [-2.8,2.8]){
     box(2.9,1.76,.08,x+dx,1.17,front,ivory);
     box(2.7,.37,.11,x+dx,.43,front-side*.035,graphite);
     box(2.65,.12,.12,x+dx,2.11,front,trim);
     for(let k=0;k<6;k++)box(1.95,.018,.03,x+dx,.32+k*.045,front-side*.105,trim,0);
     box(2.6,.028,.05,x+dx,.19,front-side*.1,cool,0);
     // Flush inspection cover, corner fasteners and a restrained brass grab rail.
     box(.6,.64,.04,x+dx+.7,1.42,front-side*.065,inset);
     for(const bx of [-.24,.24])for(const by of [-.26,.26])box(.035,.035,.04,x+dx+.7+bx,1.42+by,front-side*.09,graphite,0);
     box(1.12,.055,.07,x+dx-.4,1.01,front-side*.18,brass);
     for(const bx of [-.5,.5])box(.06,.15,.12,x+dx-.4+bx,.97,front-side*.12,graphite);
   }
   // Real storage logic: restrained fabric lockers and padded headboard near the bunk.
   const rz=room.z*scale.z;box(.88,1.93,.12,x-2.9,1.04,rz+side*2.04,trim);
   for(let k=0;k<3;k++){
     box(.65,.5,.4,x-2.9, .43+k*.57,rz+side*1.8,fabric,.08);
     box(.04,.45,.42,x-2.9,.43+k*.57,rz+side*1.8,brass,.01);
   }
   // A recognizable horizontal microgravity berth, with padded bag and restraint bands.
   const bx=x-2.45,bz=rz+side*.35;
   box(2.35,.20,1.02,bx,.58,bz,graphite,.10);box(2.2,.15,.94,bx,.75,bz,ivory,.09);
   box(1.55,.13,.82,bx+.25,.89,bz,fabric,.08);box(.45,.17,.75,bx-.82,.91,bz,ivory,.09);
   for(const offset of [-.25,.5])box(.09,.035,.84,bx+offset,.975,bz,brass,.015);
   for(const offset of [-.9,.9])box(.12,.45,.75,bx+offset,.3,bz,trim,.035);
   box(.10,.45,1.03,bx-1.13,.82,bz,ivory,.06);
   lettering('CREW BERTH','SLEEP BAG / RESTRAINTS',1.9,.32,bx,1.45,bz+side*.65,side>0?Math.PI:0);
   lettering('PERSONAL STOWAGE','RESTRAIN BEFORE TRANSIT',1.5,.35,x-2.6,2.4,rz+side*2.04,side>0?Math.PI:0);
 });
 // A layered overhead service spine gives the passage a 3.2 m ceiling datum.
 for(let x=-18;x<10;x+=2){
   box(1.94,.12,3.45,x,3.36,0,graphite);
   box(1.65,.055,1.8,x,3.28,0,inset);
   for(const z of [-1.45,1.45]){box(1.76,.07,.18,x,3.24,z,trim);box(1.65,.025,.09,x,3.19,z,warm,0);}
   for(const z of [-.55,.55])box(1.4,.02,.025,x,3.242,z,trim,0);
 }
 // Repeating inset floor plates replace the road-like central yellow dash.
 for(let x=-27;x<29;x+=1.4){box(1.32,.018,2.3,x,.143,0,graphite,.02);for(const z of [-1.04,1.04])box(.2,.008,.025,x,.155,z,brass,0);}
 lettering('HABITAT  /  01—05','FLIGHT DECK  ←     →  COMMONS',2.65,.55,-18.6,2.6,0,Math.PI/2);
 // Commons: warm recessed ceiling raft, upholstered seating and an equipment wall.
 // Open commons ceiling: the observation window remains unobstructed.
 for(const z of [-6.8,-3.4])box(6.1,.035,.1,17.8,3.4,z,warm,0);
 for(const x of [15.1,20.5])box(.1,.035,3.4,x,3.4,-5.1,warm,0);
 box(5.8,.7,.72,17.7,.55,-7.3,graphite,.13);box(5.6,.19,.78,17.7,.95,-7.3,fabric,.08);box(5.6,.78,.16,17.7,1.35,-7.65,fabric,.07);
 lettering('07 / COMMONS','CREW WELLBEING  ·  SIMULATION',3.8,.55,17.7,3.06,-7.6);
 // A small hydroponic display makes the living area distinct from the service bay.
 box(1.3,1.6,.12,24.4,.95,-7.1,graphite,.06);for(const x of [23.8,25])box(.09,1.6,.7,x,.95,-6.8,graphite);
 for(const y of [.45,1.1]){box(1.18,.08,.6,24.4,y,-6.8,ivory);box(1.1,.025,.04,24.4,y+.53,-6.8,warm,0);for(let j=0;j<4;j++){const leaf=new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),material('#557b55'));leaf.scale.set(.7,1.2,1);leaf.position.set(24+j*.25,y+.2,-6.8);cabin.add(leaf);}}
 lettering('BOTANY','HABITAT EXPERIMENT',1.2,.28,24.4,1.9,-6.42);
 // Training equipment bays and textured exercise mat borders.
 for(const [x,w] of [[11.8,2.25],[15.5,2.7],[18.1,2]]){box(w,.025,3.3,x,.17,5.5,graphite,.05);for(const dx of [-1,1])box(.045,.015,3.1,x+dx*(w/2-.1),.19,5.5,brass,0);}
 lettering('08 / TRAINING','RESISTANCE  ·  CYCLE  ·  RECOVERY',4.5,.65,16.4,2.9,7.7,Math.PI);
 for(let x=11;x<23;x+=2.4){box(2.25,.13,.8,x,3.65,6.8,graphite);box(1.95,.035,.12,x,3.56,6.8,cool,0);}
 // Soft contact shading is procedural and adds no image download or dynamic shadow pass.
 const cv=document.createElement('canvas');cv.width=cv.height=128;const ctx=cv.getContext('2d'),gradient=ctx.createRadialGradient(64,64,4,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.38)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);const sm=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthWrite:false});
 for(const [x,z,w,d] of [[17.5,-4.9,6,4],[-22.6,-2,2,2],[-22.6,2,2],[15.5,6,3,3],[18.1,5.5,2,3]]){const shadow=new THREE.Mesh(new THREE.PlaneGeometry(w,d),sm);shadow.rotation.x=-Math.PI/2;shadow.position.set(x,.215,z);cabin.add(shadow);}
 // Batch immutable fittings by material to keep detailed interiors inexpensive to draw.
 cabin.updateMatrixWorld(true);const batches=new Map();
 for(const mesh of [...cabin.children]){if(!mesh.isMesh||mesh.material.map||mesh.material.transparent)continue;mesh.updateMatrix();let g=mesh.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(mesh.matrix);const key=mesh.material.uuid;if(!batches.has(key))batches.set(key,{material:mesh.material,parts:[]});batches.get(key).parts.push(g);cabin.remove(mesh);}
 for(const {material,parts} of batches.values()){const combined=mergeGeometries(parts,false);if(combined)cabin.add(new THREE.Mesh(combined,material));parts.forEach(g=>g.dispose());}
 return cabin;
}
