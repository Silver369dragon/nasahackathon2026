// Render the original GLB into the lightweight home-card image. Run from web/.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { chromium } from '@playwright/test'

const hologram = ts.transpileModule(await readFile('src/body-hologram.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText
const addonRoot=resolve('node_modules/three/examples/jsm')

const files = new Map([
  ['/three', ['node_modules/three/build/three.module.js', 'text/javascript']],
  ['/three.core.js', ['node_modules/three/build/three.core.js', 'text/javascript']],
  ['/loader', ['node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'text/javascript']],
  ['/utils/BufferGeometryUtils.js', ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'text/javascript']],
  ['/body.glb', ['public/body/orbital-body.glb', 'model/gltf-binary']],
])
const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/three"}}</script>')
    return
  }
  if(request.url==='/hologram'){
    response.setHeader('Content-Type','text/javascript');response.end(hologram);return
  }
  if(request.url?.startsWith('/addons/')){
    const path=resolve(addonRoot,request.url.slice('/addons/'.length))
    if(!path.startsWith(addonRoot+sep)||!path.endsWith('.js')){response.writeHead(404).end();return}
    try{response.setHeader('Content-Type','text/javascript');response.end(await readFile(path))}
    catch{response.writeHead(404).end()}
    return
  }
  const file = files.get(request.url)
  if (!file) { response.writeHead(404).end(); return }
  try { response.setHeader('Content-Type', file[1]); response.end(await readFile(file[0])) }
  catch { response.writeHead(500).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(chrome) ? chrome : undefined), args: ['--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 240, height: 360 } })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(async () => {
    const THREE = await import('/three')
    const { GLTFLoader } = await import('/loader')
    const { EffectComposer } = await import('/addons/postprocessing/EffectComposer.js')
    const { RenderPass } = await import('/addons/postprocessing/RenderPass.js')
    const { UnrealBloomPass } = await import('/addons/postprocessing/UnrealBloomPass.js')
    const { OutputPass } = await import('/addons/postprocessing/OutputPass.js')
    const { createHologramMaterial,createHologramPoints,createProjectionStage } = await import('/hologram')
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(240,360); renderer.setClearColor(0,0)
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1
    document.body.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34,240/360,.1,20)
    camera.position.set(.3,1.6,3.45); camera.lookAt(0,.96,0)
    const composer=new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene,camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(240,360),.45,.4,.55))
    composer.addPass(new OutputPass())
    const stage=createProjectionStage();scene.add(stage.group);stage.update(0)
    const gltf = await new GLTFLoader().loadAsync('/body.glb')
    gltf.scene.traverse(object => {
      if (!object.isMesh) return
      object.material.dispose()
      object.material = createHologramMaterial()
      object.add(createHologramPoints(object.geometry))
    })
    scene.add(gltf.scene); composer.render()
  })
  await page.screenshot({path:'public/body/preview.png',omitBackground:true})
  console.log('Saved public/body/preview.png (240 × 360)')
} finally {
  await browser?.close()
  await new Promise(resolve=>server.close(resolve))
}
