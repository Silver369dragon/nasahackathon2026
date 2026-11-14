import * as THREE from 'three';
export function buildOrbitalHull(root,roof,scale){
 const hull=new THREE.Group();hull.scale.set(1/scale.x,1/scale.y,1/scale.z);roof.add(hull);
 const ceramic=new THREE.MeshStandardMaterial({color:'#d4d7ce',roughness:.62,metalness:.25,side:THREE.DoubleSide});
 const dark=new THREE.MeshStandardMaterial({color:'#273b48',roughness:.5,metalness:.5});
 const trim=new THREE.MeshStandardMaterial({color:'#aab8bd',roughness:.4,metalness:.65});
 const glass=new THREE.MeshBasicMaterial({color:'#8bcbd5',transparent:true,opacity:.045,depthWrite:false,side:THREE.DoubleSide});
 const portLayouts=[...[-14,-4,6,-14,-4].map((x,i)=>({id:`room-${i}`,x,side:i<3?-1:1,width:3.4,span:.58})),{id:'common',x:22.6,side:1,width:5.2,span:.62},{id:'training',x:15.3,side:1,width:8.8,span:.9}];
 const point=(x,a)=>new THREE.Vector3(x,.05+Math.sin(a)*(Math.sin(a)>=0?6.1:5.2),Math.cos(a)*9.7);
 const ports=portLayouts.map(port=>{
   const angle=port.side>0?.18:Math.PI-.18;
   return {...port,angle,center:point(port.x,angle)};
 });
 const xs=[-30,30,...Array.from({length:31},(_,i)=>-30+i*2),...ports.flatMap(p=>[p.x-p.width/2,p.x+p.width/2])].sort((a,b)=>a-b).filter((v,i,a)=>!i||v!==a[i-1]);
 const angles=[...Array.from({length:129},(_,i)=>-.5+i*Math.PI/64),...ports.flatMap(p=>[p.angle-p.span/2,p.angle+p.span/2])].sort((a,b)=>a-b);
 const cuts=[];
 const dxs=[-29.7,29.7,...cuts.flatMap(c=>[c.x-c.w/2,c.x+c.w/2])].sort((a,b)=>a-b).filter((v,i,a)=>!i||v!==a[i-1]);
 const dzs=[-9.3,9.3,...cuts.flatMap(c=>[c.z-c.d/2,c.z+c.d/2])].sort((a,b)=>a-b).filter((v,i,a)=>!i||v!==a[i-1]);
 const deck=[];
 for(let i=1;i<dxs.length;i++)for(let j=1;j<dzs.length;j++){const x=(dxs[i]+dxs[i-1])/2,z=(dzs[j]+dzs[j-1])/2;if(cuts.some(c=>Math.abs(x-c.x)<c.w/2&&Math.abs(z-c.z)<c.d/2))continue;for(const [xx,zz] of [[dxs[i-1],dzs[j-1]],[dxs[i-1],dzs[j]],[dxs[i],dzs[j]],[dxs[i-1],dzs[j-1]],[dxs[i],dzs[j]],[dxs[i],dzs[j-1]]])deck.push(xx,.12,zz);}
 const dg=new THREE.BufferGeometry();dg.setAttribute('position',new THREE.Float32BufferAttribute(deck,3));dg.computeVertexNormals();hull.add(new THREE.Mesh(dg,new THREE.MeshStandardMaterial({color:'#39494c',roughness:.85,side:THREE.DoubleSide})));
 for(const c of cuts){const plane=new THREE.Mesh(new THREE.PlaneGeometry(c.w,c.d),glass);plane.rotation.x=-Math.PI/2;plane.position.set(c.x,.135,c.z);plane.userData={kind:'window',id:ports.find(p=>p.x===c.x&&p.side===Math.sign(c.z)).id};hull.add(plane);for(const side of [-1,1]){const a=new THREE.Mesh(new THREE.BoxGeometry(.10,.10,c.d+.16),trim);a.position.set(c.x+side*c.w/2,.14,c.z);hull.add(a);const b=new THREE.Mesh(new THREE.BoxGeometry(c.w+.16,.10,.10),trim);b.position.set(c.x,.14,c.z+side*c.d/2);hull.add(b);}}
 const positions=[];
 function cell(dest,x0,x1,a0,a1){const a=point(x0,a0),b=point(x1,a0),c=point(x1,a1),d=point(x0,a1);for(const v of [a,b,d,b,c,d])dest.push(...v.toArray());}
 for(let i=1;i<xs.length;i++)for(let j=1;j<angles.length;j++){const x=(xs[i]+xs[i-1])/2,a=(angles[j]+angles[j-1])/2;if(ports.some(p=>Math.abs(x-p.x)<p.width/2&&Math.abs(a-p.angle)<p.span/2))continue;cell(positions,xs[i-1],xs[i],angles[j-1],angles[j]);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();hull.add(new THREE.Mesh(geometry,ceramic));
 function tube(points,r,material=dark){const curve=new THREE.CatmullRomCurve3(points);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,points.length*2),r,6,false),material);hull.add(mesh);return mesh;}
 // Above-deck wall windows; all views share the same world-space Earth.
 for(const p of ports){
   const x0=p.x-p.width/2,x1=p.x+p.width/2,a0=p.angle-p.span/2,a1=p.angle+p.span/2;
   for(const x of [x0,x1])tube(Array.from({length:17},(_,i)=>point(x,a0+(a1-a0)*i/16)),.10,trim);
   for(const a of [a0,a1])tube([point(x0,a),point(x1,a)],.10,trim);
   const pane=[];for(let i=0;i<12;i++)cell(pane,x0,x1,a0+(a1-a0)*i/12,a0+(a1-a0)*(i+1)/12);
   const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(pane,3));pg.computeVertexNormals();const window=new THREE.Mesh(pg,glass);window.userData={kind:'window',id:p.id};hull.add(window);
 }
 // Rounded pressure endcaps and circumferential reinforcement bands.
 for(const x of [-30,30]){const cap=new THREE.Mesh(new THREE.SphereGeometry(1,48,24,0,Math.PI*2,0,Math.PI/2),ceramic);cap.scale.set(5.65,3.7,9.7);cap.rotation.z=x>0?-Math.PI/2:Math.PI/2;cap.position.set(x,-.1,0);hull.add(cap);}
 for(const x of [-29,-20,10,29])tube(Array.from({length:97},(_,i)=>point(x,-Math.PI+i*Math.PI/48).multiply(new THREE.Vector3(1,1.014,1.014))),.14,trim);
 // Separate aft propulsion collar and forward docking neck articulate the silhouette.
 for(const [x,length,r] of [[34,3,3.8],[-34,2.2,2.8]]){const neck=new THREE.Mesh(new THREE.CylinderGeometry(r,r,length,40),dark);neck.rotation.z=Math.PI/2;neck.position.set(x,0,0);hull.add(neck);const rim=new THREE.Mesh(new THREE.TorusGeometry(r,.16,8,48),trim);rim.rotation.y=Math.PI/2;rim.position.set(x+Math.sign(x)*length/2,0,0);hull.add(rim);}
 for(const x of [-21,-11,-1,9,21]){const panel=new THREE.Mesh(new THREE.BoxGeometry(5,.12,2),dark);panel.position.set(x,-5.25,0);hull.add(panel);}
 // Hiyoko identity: swept photovoltaic feathers, a low crest and a tapered forward fairing.
 const solar=new THREE.MeshStandardMaterial({color:'#173a51',metalness:.48,roughness:.45,side:THREE.DoubleSide});
 const gold=new THREE.MeshStandardMaterial({color:'#c19b56',metalness:.55,roughness:.5});
 for(const side of [-1,1]){
   for(const x of [-5,9])tube([new THREE.Vector3(x,2.7,side*8.4),new THREE.Vector3(x,4.55,side*10)],.12,trim);
   for(let n=0;n<5;n++){
     const z0=side*(9+n*3.2),z1=side*(12.05+n*3.2),lead=-10+n*3.1,trail=13+n*1.5;
     const shape=new THREE.Shape();shape.moveTo(lead,z0);shape.lineTo(lead+2.7,z1);shape.lineTo(trail+1,z1);shape.lineTo(trail,z0);shape.closePath();
     const feather=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:true,bevelThickness:.06,bevelSize:.08,bevelSegments:1}),solar);feather.rotation.x=Math.PI/2;feather.position.y=4.55+n*.06;hull.add(feather);
     tube([new THREE.Vector3(lead,4.67+n*.06,z0),new THREE.Vector3(lead+2.7,4.67+n*.06,z1)],.045,gold);
     for(let x=lead+3;x<trail;x+=1.6)tube([new THREE.Vector3(x,4.67+n*.06,z0),new THREE.Vector3(x+1.1,4.67+n*.06,z1)],.017,trim);
   }
   const tail=new THREE.Shape();tail.moveTo(25,side*8);tail.lineTo(34,side*14);tail.lineTo(38,side*13);tail.lineTo(30,side*6);tail.closePath();const fin=new THREE.Mesh(new THREE.ExtrudeGeometry(tail,{depth:.22,bevelEnabled:false}),ceramic);fin.rotation.x=Math.PI/2;fin.position.y=1;hull.add(fin);
 }
 const crestShape=new THREE.Shape();crestShape.moveTo(-20,5.4);crestShape.lineTo(-13,8.4);crestShape.lineTo(-7,5.8);crestShape.closePath();const crest=new THREE.Mesh(new THREE.ExtrudeGeometry(crestShape,{depth:.5,bevelEnabled:true,bevelThickness:.1,bevelSize:.1,bevelSegments:1}),gold);crest.position.z=-.25;hull.add(crest);
 const beak=new THREE.Mesh(new THREE.ConeGeometry(2.7,6,4),gold);beak.rotation.z=Math.PI/2;beak.rotation.x=Math.PI/4;beak.scale.z=.72;beak.position.set(-36.3,-.25,0);hull.add(beak);
 const logoMap=new THREE.TextureLoader().load('./assets/team-logo.png',()=>roof.userData.logoReady=true);logoMap.colorSpace=THREE.SRGBColorSpace;
 const lp=[],lu=[];
 for(let j=0;j<12;j++){const a0=.31+j*.29/12,a1=.31+(j+1)*.29/12;const points=[[24.8,a0,0,j/12],[27.0,a0,1,j/12],[24.8,a1,0,(j+1)/12],[27.0,a0,1,j/12],[27.0,a1,1,(j+1)/12],[24.8,a1,0,(j+1)/12]];for(const [x,a,u,v] of points){const p=point(x,a);p.y*=1.014;p.z*=1.014;lp.push(...p.toArray());lu.push(u,v);}}
 const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));lg.setAttribute('uv',new THREE.Float32BufferAttribute(lu,2));lg.computeVertexNormals();hull.add(new THREE.Mesh(lg,new THREE.MeshBasicMaterial({map:logoMap,side:THREE.DoubleSide})));
 return ports;
}
export function createOrbit(scene){
 const earth=new THREE.Group();scene.add(earth);let ready=false;
 const texture=new THREE.TextureLoader().load('./assets/earth.jpg',()=>{ready=true;});texture.colorSpace=THREE.SRGBColorSpace;
 const globe=new THREE.Mesh(new THREE.SphereGeometry(77,64,40),new THREE.MeshStandardMaterial({map:texture,roughness:.94,metalness:0,emissive:'#ffffff',emissiveMap:texture,emissiveIntensity:.2}));globe.rotation.x=Math.PI/2;globe.rotation.z=.18;earth.add(globe);
 globe.material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 vec3 base=diffuseColor.rgb;float vegetation=smoothstep(1.05,1.35,base.g/max(base.b,.003));float ice= smoothstep(.35,.7,min(base.r,min(base.g,base.b)));vec3 lively=base*vec3(1.02,1.48,.96);diffuseColor.rgb=mix(base,lively,vegetation*(1.0-ice)*.65);`);};
 let moonReady=false;const moonMap=new THREE.TextureLoader().load('./assets/moon.jpg',()=>moonReady=true);moonMap.colorSpace=THREE.SRGBColorSpace;const moon=new THREE.Mesh(new THREE.SphereGeometry(21,40,28),new THREE.MeshStandardMaterial({map:moonMap,roughness:1,emissive:'#ffffff',emissiveMap:moonMap,emissiveIntensity:.13}));scene.add(moon);
 const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(78.2,48,32),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,uniforms:{glow:{value:new THREE.Color('#5caeff')}},vertexShader:'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 n; varying vec3 v; uniform vec3 glow; void main(){float a=pow(1.0-abs(dot(normalize(n),normalize(v))),3.0);gl_FragColor=vec4(glow,a*.55);}'}));earth.add(atmosphere);
 const period=1200;
 // Co-moving attitude frame: the ship travels a circular path, while its side-window composition stays fixed.
 const earthOffset=new THREE.Vector3(-18.36,-57.8,159.8),radial=earthOffset.clone().negate(),nose=new THREE.Vector3(-1,0,0);
 const axis=radial.clone().cross(nose).normalize(),attitude=new THREE.Quaternion();let phase=0;
 const orbitalState=()=>{const worldPosition=radial.clone().applyQuaternion(attitude),heading=nose.clone().applyQuaternion(attitude),tangent=axis.clone().cross(worldPosition).normalize();return{phase,shipWorldPosition:worldPosition.toArray(),shipWorldHeading:heading.toArray(),tangent:tangent.toArray(),headingErrorDegrees:Math.acos(THREE.MathUtils.clamp(heading.dot(tangent),-1,1))*180/Math.PI,earthDepressionDegrees:Math.atan2(-earthOffset.y,Math.hypot(earthOffset.x,earthOffset.z))*180/Math.PI};};
 return {update(seconds){const a=seconds*Math.PI*2/period;phase=a;attitude.setFromAxisAngle(axis,a);earth.position.copy(earthOffset);const lat=23.7*Math.PI/180,lon=121*Math.PI/180;const taiwan=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));const facing=earth.position.clone().negate().normalize(),north=new THREE.Vector3(0,1,0).addScaledVector(facing,-facing.y).normalize(),east=north.clone().cross(facing).normalize();const localEast=new THREE.Vector3(-Math.sin(lon),0,-Math.cos(lon)),localNorth=taiwan.clone().cross(localEast);const localBasis=new THREE.Matrix4().makeBasis(localEast,localNorth,taiwan),worldBasis=new THREE.Matrix4().makeBasis(east,north,facing);globe.quaternion.setFromRotationMatrix(worldBasis.multiply(localBasis.transpose()));moon.position.copy(earth.position).add(axis.clone().multiplyScalar(220));moon.rotation.y=seconds*.0001;},skyAttitude(){return attitude.clone().invert();},diagnostics(){return{...orbitalState(),earthReady:ready,moonReady,taiwanFacing:{latitude:23.7,longitude:121,alignment:"approximate equirectangular texture alignment"},moonPosition:moon.position.toArray(),earthPosition:earth.position.toArray(),periodSeconds:period,referenceFrame:'ship-centered attitude-tracked illustrative orbit'};}};
}
