import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { stationBase } from './api'
import { tx, type Lang } from './domain'
import { activeFindings, bodyNumber, regionFromMesh, regionLabel, regionReading, type BodyLayer, type BodyScan, type RegionCode } from './body-map'
import { BodySilhouette } from './BodySilhouette'
import { createHologramMaterial, createHologramPoints, createProjectionStage } from './body-hologram'

type Props = {
  scan: BodyScan | null; layer: BodyLayer; selectedRegion: RegionCode | null
  onSelect: (region: RegionCode | null) => void; lang: Lang; scanning: boolean
}
type SceneControl = { apply: () => void; face: (back: boolean) => void; zoom: (amount: number) => void; motion: (active: boolean) => void }

export default function BodyScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const current = useRef(props)
  const runtime = useRef<SceneControl | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [back, setBack] = useState(false)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => { current.current = props; runtime.current?.apply() }, [props])
  useEffect(() => { runtime.current?.motion(playing) }, [playing])
  const t = (en: string, zh: string) => tx(props.lang, en, zh)

  useEffect(() => {
    const container = host.current!
    let disposed = false
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      queueMicrotask(() => { if (!disposed) setStatus('fallback') })
      return () => { disposed = true }
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35))
    renderer.setClearColor(0x061721, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    container.appendChild(renderer.domElement)
    const canvas = renderer.domElement
    canvas.setAttribute('aria-label', 'Interactive 3D body / 互動立體人體')
    canvas.setAttribute('role', 'img')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#061721')
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 20)
    camera.position.set(0, 1.6, 3.45)
    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0, .96, 0)
    controls.enablePan = false
    controls.enableDamping = false
    controls.minDistance = 1.65
    controls.maxDistance = 4.4
    controls.minPolarAngle = Math.PI * .28
    controls.maxPolarAngle = Math.PI * .72
    controls.rotateSpeed = .7
    controls.touches.ONE = THREE.TOUCH.ROTATE
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    controls.update()
    // Keep color conversion, but avoid the eleven extra floating-point targets
    // and repeated blur passes used by continuous bloom.
    const composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene,camera)
    const output = new OutputPass()
    composer.addPass(renderPass); composer.addPass(output)
    const model = new THREE.Group()
    scene.add(model)
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = []
    const particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = []
    const markers: THREE.Sprite[] = []
    const markerCanvas = document.createElement('canvas')
    markerCanvas.width = markerCanvas.height = 64
    const painter = markerCanvas.getContext('2d')!
    painter.strokeStyle = '#fff'; painter.lineWidth = 2
    painter.beginPath(); painter.arc(32,32,23,0,Math.PI*2); painter.stroke()
    painter.fillStyle = '#fff'; painter.beginPath(); painter.arc(32,32,4,0,Math.PI*2); painter.fill()
    const markerTexture = new THREE.CanvasTexture(markerCanvas)
    const markerMaterial = new THREE.SpriteMaterial({map:markerTexture,color:0xf1ac85,depthTest:false,transparent:true})
    const projector = createProjectionStage()
    scene.add(projector.group)
    const ray = new THREE.Raycaster()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let motion = !reducedMotion.matches
    let frame = 0, elapsed = 0, lastPaint = 0, ready = false, failed = false
    const render = (time: number) => {
      frame = 0
      if (disposed || failed || document.hidden || renderer.getContext().isContextLost()) return
      if (motion && ready && time-lastPaint < 32) { frame=requestAnimationFrame(render); return }
      if (motion) elapsed += Math.min((time-lastPaint)/1000,.06)
      lastPaint = time
      const height = projector.update(elapsed,current.current.scanning)
      meshes.forEach(mesh=>{
        mesh.material.uniforms.uTime.value=elapsed
        mesh.material.uniforms.uScanHeight.value=height
      })
      composer.render()
      if (motion && ready) frame=requestAnimationFrame(render)
    }
    const invalidate = () => { if (!frame && !disposed && !failed && !document.hidden) frame = requestAnimationFrame(render) }
    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height; camera.updateProjectionMatrix()
      renderer.setSize(width, height); composer.setSize(width,height); invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const apply = () => {
      const { scan, layer, selectedRegion } = current.current
      const findings = activeFindings(scan)
      const values = meshes.map(mesh => {
        const region = regionFromMesh(mesh.name)!
        return regionReading(scan, region, layer === 'fat' ? 'fatMassKg' : 'muscleMassKg') ?? 0
      })
      const max = Math.max(...values, .1)
      meshes.forEach((mesh, index) => {
        const region = regionFromMesh(mesh.name)!
        const value = regionReading(scan, region, layer === 'fat' ? 'fatMassKg' : 'muscleMassKg')
        const selected = selectedRegion === region
        const finding = findings.find(f => f.regionCode === region)
        const unavailable = !!scan && value == null
        const color = new THREE.Color('#20cbe8')
        if (layer === 'muscle') color.set('#168eae').lerp(new THREE.Color('#60ffe0'),values[index]/max)
        if (layer === 'fat') color.set('#9d75e5').lerp(new THREE.Color('#ffd88a'),values[index]/max)
        if (finding) color.set(finding.status === 'recovering' ? '#ffd589' : '#ff805c')
        if (unavailable) color.set('#77858d')
        if (selected && !unavailable) color.lerp(new THREE.Color('#b0fffa'),.2)
        mesh.material.uniforms.uColor.value.copy(color)
        mesh.material.uniforms.uSelected.value=selected?1:0
        mesh.material.uniforms.uMissing.value=unavailable?1:0
        mesh.material.uniforms.uDensity.value=layer==='overview'?.6:values[index]/max
        particles[index].material.color.copy(color)
        particles[index].material.opacity=unavailable?.12:selected?.85:.45
      })
      markers.forEach(marker => scene.remove(marker)); markers.length = 0
      findings.slice(0,3).forEach(finding => {
        const mesh = meshes.find(item=>item.name===finding.regionCode)
        if (!mesh) return
        const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3())
        center.z += .12
        const marker = new THREE.Sprite(markerMaterial)
        marker.position.copy(center); marker.scale.set(.12,.12,1); marker.name=finding.regionCode
        marker.renderOrder=5; scene.add(marker); markers.push(marker)
      })
      invalidate()
    }
    runtime.current = {
      apply,
      motion: active => {motion=active;lastPaint=performance.now();invalidate()},
      face: rear => {
        camera.position.set(0, 1.6, rear ? -3.45 : 3.45)
        controls.target.set(0, .96, 0); controls.update(); invalidate()
      },
      zoom: amount => {
        const offset = camera.position.clone().sub(controls.target)
        offset.setLength(THREE.MathUtils.clamp(offset.length() * amount, controls.minDistance, controls.maxDistance))
        camera.position.copy(controls.target).add(offset); controls.update(); invalidate()
      },
    }
    const loader = new GLTFLoader()
    loader.load(stationBase + '/body/orbital-body.glb', gltf => {
      if (disposed || failed) {
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose() }
        })
        return
      }
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !regionFromMesh(object.name)) return
        const material = createHologramMaterial()
        ;(object.material as THREE.Material).dispose()
        object.material = material
        meshes.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>)
        const points = createHologramPoints(object.geometry)
        object.add(points); particles.push(points)
      })
      model.add(gltf.scene)
      ready=true; apply(); setStatus('ready')
    }, undefined, () => { if (!disposed) {failed=true;setStatus('fallback')} })
    let down: { x: number; y: number; id: number } | null = null
    const pointers = new Set<number>()
    const pointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId)
      down = pointers.size === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
    }
    const pointerMove = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX-down.x,event.clientY-down.y) > 7) down = null
    }
    const pointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (!down || down.id !== event.pointerId || Math.hypot(event.clientX-down.x,event.clientY-down.y) > 7) { down = null; return }
      down = null
      const rect = canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1), camera)
      const hit = ray.intersectObjects([...meshes,...markers], false)[0]
      if (hit) current.current.onSelect(regionFromMesh(hit.object.name))
    }
    const cancel = (event: PointerEvent) => { pointers.delete(event.pointerId); down = null }
    const lost = (event: Event) => { event.preventDefault(); failed=true;cancelAnimationFrame(frame);frame=0;setStatus('fallback') }
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0 } else invalidate() }
    const changed = () => { setBack(camera.position.z < controls.target.z); invalidate() }
    controls.addEventListener('change', changed)
    const preferenceChanged = () => { if(reducedMotion.matches){motion=false;setPlaying(false);invalidate()} }
    reducedMotion.addEventListener('change',preferenceChanged)
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('webglcontextlost', lost)
    document.addEventListener('visibilitychange', visibility)
    resize()
    return () => {
      disposed = true; runtime.current = null; observer.disconnect(); controls.dispose()
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
      reducedMotion.removeEventListener('change',preferenceChanged)
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('webglcontextlost', lost)
      meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose() })
      particles.forEach(points=>{points.geometry.dispose();points.material.dispose()})
      markerTexture.dispose(); markerMaterial.dispose()
      projector.dispose(); renderPass.dispose(); output.dispose(); composer.dispose()
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    }
  }, [])

  const face = (rear: boolean) => { setBack(rear); runtime.current?.face(rear) }
  return <div className={'body-viewport ' + (props.scanning ? 'is-scanning' : '')} data-testid="body-scene" data-renderer={status} data-visual="hologram-v2" data-motion={playing?'playing':'paused'}>
    <div className="body-coordinate body-coordinate-top" aria-hidden="true">HOLOGRAPHIC / 02 <span>VOLUMETRIC BODY</span></div>
    <button className="body-motion-toggle" disabled={status!=='ready'} onClick={()=>setPlaying(value=>!value)} aria-label={playing?t('Pause hologram animation','暫停投影動態'):t('Play hologram animation','播放投影動態')} aria-pressed={playing}>{playing?<Pause size={13}/>:<Play size={13}/>}<span>{t('Projection','全息投影')}</span></button>
    <div ref={host} className="body-canvas" style={{ visibility: status === 'fallback' ? 'hidden' : 'visible' }} />
    {status === 'loading' && <p className="body-model-status" role="status">{t('Loading body model…', '正在載入人體模型…')}</p>}
    {status === 'fallback' && <div className="body-fallback">
      <BodySilhouette back={back} selected={props.selectedRegion} scan={props.scan} onSelect={props.onSelect} lang={props.lang}/>
    </div>}
    {props.scanning && <div className="body-scan-plane" aria-hidden="true"/>}
    <div className="body-side-hints" aria-hidden="true"><span>{back ? 'L' : 'R'}</span><span>{back ? 'R' : 'L'}</span></div>
    {props.selectedRegion && <div className="body-selected-tag"><strong>{regionLabel(props.selectedRegion,props.lang)}</strong>
      <span>{t('Muscle','肌肉')} {bodyNumber(regionReading(props.scan,props.selectedRegion,'muscleMassKg'))} kg</span>
      <span>{t('Fat','脂肪')} {bodyNumber(regionReading(props.scan,props.selectedRegion,'fatMassKg'))} kg</span>
    </div>}
    <div className="body-view-actions">
      <div className="body-segment" aria-label={t('Body orientation', '人體方向')}>
        <button aria-pressed={!back} onClick={() => face(false)}>{t('Front', '正面')}</button>
        <button aria-pressed={back} onClick={() => face(true)}>{t('Back', '背面')}</button>
      </div>
      <div className="body-zoom">
        <button disabled={status!=='ready'} onClick={() => runtime.current?.zoom(.85)} aria-label={t('Zoom in', '放大人體')}><ZoomIn size={18}/></button>
        <button disabled={status!=='ready'} onClick={() => runtime.current?.zoom(1.18)} aria-label={t('Zoom out', '縮小人體')}><ZoomOut size={18}/></button>
        <button onClick={() => face(false)} aria-label={t('Reset view', '重設視角')}><RotateCcw size={17}/></button>
      </div>
    </div>
    <p className="body-gesture">{status==='fallback' ? t('2D view · tap a region to read its scan', '平面檢視・點選部位可閱讀掃描資料') : t('Drag to rotate · pinch to zoom · tap a region', '拖曳旋轉・雙指縮放・點選部位')}</p>
  </div>
}
