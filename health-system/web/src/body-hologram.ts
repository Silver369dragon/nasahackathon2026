import * as THREE from 'three'

// An emissive, see-through volume: no opaque skin or scene-light shading.
// The same material is used by the interactive body and its home-card render.
export function createHologramMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#25dfff') }, uTime: { value: 0 },
      uScanHeight: { value: .8 }, uDensity: { value: .6 },
      uSelected: { value: 0 }, uMissing: { value: 0 },
    },
    vertexShader: `
      varying vec3 bodyPosition;
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      void main() {
        bodyPosition = position;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        viewNormal = normalize(normalMatrix * normal);
        viewDirection = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime, uScanHeight, uDensity, uSelected, uMissing;
      varying vec3 bodyPosition;
      varying vec3 viewNormal;
      varying vec3 viewDirection;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(viewNormal), normalize(viewDirection))), 2.4);
        float row = abs(fract(bodyPosition.y * 62.0 - uTime * .035) - .5);
        float contour = 1.0 - smoothstep(.035, .11, row);
        float column = abs(fract((bodyPosition.x + bodyPosition.z * .45) * 38.0) - .5);
        float grid = (1.0 - smoothstep(.025, .065, column)) * .08;
        float sweep = exp(-pow((bodyPosition.y - uScanHeight) / .035, 2.0));
        float energy = .55 + uDensity * .4 + rim * 1.8 + sweep * 2.0 + uSelected * rim;
        float alpha = .018 + rim * .38 + contour * .16 + grid + sweep * .20;
        alpha *= .65 + uDensity * .35;
        if (uMissing > .5) { energy = .5; alpha = .04 + rim * .25 + contour * .06; }
        gl_FragColor = vec4(uColor * energy, min(alpha, .82));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  })
}

export function createHologramPoints(geometry: THREE.BufferGeometry) {
  const source = geometry.getAttribute('position')
  const positions: number[] = []
  for (let index = 0; index < source.count; index += 18) {
    positions.push(source.getX(index),source.getY(index),source.getZ(index))
  }
  const points = new THREE.BufferGeometry()
  points.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  return new THREE.Points(points,new THREE.PointsMaterial({
    color: '#61edff', size: .006, transparent: true, opacity: .6,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }))
}

export function createProjectionStage() {
  const group = new THREE.Group()
  group.name = 'hologram-projector'
  const addRing = (radius: number, width: number, y: number, opacity: number) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius-width,radius,128),
      new THREE.MeshBasicMaterial({ color: '#29dbfb', side: THREE.DoubleSide,
        transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    ring.rotation.x = -Math.PI/2; ring.position.y = y; group.add(ring)
    return ring
  }
  addRing(.39,.003,-.032,.9)
  addRing(.34,.0015,-.03,.45)
  addRing(.20,.003,-.025,.6)
  addRing(.43,.001,-.035,.25)
  const ticks: number[] = []
  for(let i=0;i<72;i++) {
    const angle=i/72*Math.PI*2, end=i%6===0?.465:.445
    ticks.push(Math.cos(angle)*.43,-.03,Math.sin(angle)*.43,Math.cos(angle)*end,-.03,Math.sin(angle)*end)
  }
  const tickGeometry = new THREE.BufferGeometry()
  tickGeometry.setAttribute('position',new THREE.Float32BufferAttribute(ticks,3))
  group.add(new THREE.LineSegments(tickGeometry,new THREE.LineBasicMaterial({color:'#258fab',transparent:true,opacity:.7})))
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.6),new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vUv; void main(){
      float radius=length(vUv-.5);
      float glow=exp(-radius*radius*35.0)*.20;
      gl_FragColor=vec4(.02,.65,1.0,glow);
    }`, transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  }))
  glow.rotation.x=-Math.PI/2; glow.position.y=-.04; group.add(glow)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.33,.065,1.65,48,1,true),new THREE.ShaderMaterial({
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec2 vUv;void main(){
      float ray=pow(max(0.0,sin(vUv.x*6.283185*24.0)),24.0);
      float strength=pow(1.0-vUv.y,2.0)*(.014+ray*.035);
      gl_FragColor=vec4(.04,.7,1.0,strength);
    }`, transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  }))
  beam.position.y=.8; group.add(beam)
  const sweep = addRing(.32,.002,.8,.48)
  sweep.scale.set(1.1,.7,1)
  return {
    group,
    update(time: number, scanning = false) {
      const height = .15 + ((time * (scanning ? .65 : .16) + .65) % 1.65)
      sweep.position.y=height
      return height
    },
    dispose() {
      group.traverse(object=>{
        if(object instanceof THREE.Mesh || object instanceof THREE.LineSegments){
          object.geometry.dispose()
          const materials=Array.isArray(object.material)?object.material:[object.material]
          materials.forEach(material=>material.dispose())
        }
      })
    },
  }
}
