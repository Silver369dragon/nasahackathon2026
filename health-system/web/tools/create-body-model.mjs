// Original smooth, neutral mannequin. Run with: node tools/create-body-model.mjs
// Generates a continuous implicit surface, then partitions faces into semantic regions.
import { mkdirSync, writeFileSync } from 'node:fs'
import { MeshBasicMaterial, Vector3 } from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

const resolution = 88
const surface = new MarchingCubes(resolution, new MeshBasicMaterial(), false, false, 50000)
surface.isolation = 0
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smoothMin = (a, b, k = 0.035) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  return (Math.hypot((x-cx)/rx, (y-cy)/ry, (z-cz)/rz) - 1) * Math.min(rx, ry, rz)
}
function limb(x, y, z, a, b, r1, r2) {
  const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2]
  const t = clamp(((x-a[0])*dx + (y-a[1])*dy + (z-a[2])*dz) / (dx*dx+dy*dy+dz*dz), 0, 1)
  return Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy, z-a[2]-t*dz) - (r1+(r2-r1)*t)
}
const profile = [[.94,.125,.09], [1.01,.171,.108], [1.10,.158,.10], [1.20,.144,.086],
  [1.31,.182,.106], [1.42,.205,.108], [1.48,.195,.088], [1.52,.128,.065]]
function torso(x, y, z) {
  const yy = clamp(y, profile[0][0], profile.at(-1)[0])
  let i = 1
  while (i < profile.length-1 && yy > profile[i][0]) i++
  const a = profile[i-1], b = profile[i], t = (yy-a[0])/(b[0]-a[0])
  const rx = a[1]+(b[1]-a[1])*t, rz = a[2]+(b[2]-a[2])*t
  const radial = (Math.hypot(x/rx, z/rz)-1)*Math.min(rx,rz)
  const cap = Math.max(profile[0][0]-y, y-profile.at(-1)[0])
  return Math.hypot(Math.max(radial,0), Math.max(cap,0)) + Math.min(Math.max(radial,cap),0)
}
function distance(x, y, z) {
  let d = torso(x,y,z)
  d = smoothMin(d, ellipsoid(x,y,z,0,1.565,0,.057,.092,.056))
  d = smoothMin(d, ellipsoid(x,y,z,0,1.735,-.006,.087,.124,.091), .018)
  d = smoothMin(d, ellipsoid(x,y,z,0,1.666,.022,.066,.066,.066), .023)
  // Small brow / nose relief makes the front readable without an identifiable face.
  d = smoothMin(d, ellipsoid(x,y,z,0,1.718,.078,.025,.036,.024), .014)
  const side = Math.abs(x)
  d = smoothMin(d, ellipsoid(side,y,z,.205,1.456,0,.068,.072,.074))
  d = smoothMin(d, limb(side,y,z,[.23,1.425,0],[.315,1.19,.004],.061,.045))
  d = smoothMin(d, ellipsoid(side,y,z,.273,1.31,.012,.053,.106,.061), .022)
  d = smoothMin(d, limb(side,y,z,[.315,1.19,.004],[.38,.974,.025],.045,.027), .024)
  d = smoothMin(d, ellipsoid(side,y,z,.343,1.096,.015,.038,.087,.041), .020)
  d = smoothMin(d, ellipsoid(side,y,z,.395,.913,.027,.034,.071,.022), .018)
  d = smoothMin(d, limb(side,y,z,[.368,.934,.046],[.357,.893,.052],.016,.012), .013)
  d = smoothMin(d, ellipsoid(side,y,z,.088,.996,-.022,.09,.105,.105), .025)
  d = smoothMin(d, limb(side,y,z,[.092,.953,0],[.103,.569,.005],.086,.049), .026)
  d = smoothMin(d, ellipsoid(side,y,z,.097,.788,.012,.078,.177,.087), .020)
  d = smoothMin(d, ellipsoid(side,y,z,.103,.554,.012,.049,.059,.055), .018)
  d = smoothMin(d, limb(side,y,z,[.103,.53,0],[.108,.14,-.005],.042,.029), .020)
  d = smoothMin(d, ellipsoid(side,y,z,.106,.383,-.022,.055,.125,.063), .018)
  d = smoothMin(d, ellipsoid(side,y,z,.108,.082,.045,.047,.052,.102), .016)
  return d
}
for (let z=0; z<resolution; z++) for (let y=0; y<resolution; y++) for (let x=0; x<resolution; x++) {
  const wx=(x/resolution*2-1)*.65, wy=y/resolution*1.96, wz=(z/resolution*2-1)*.32
  surface.field[x + y*resolution + z*resolution*resolution] = -distance(wx,wy,wz)
}
surface.update()
const positions = surface.geometry.attributes.position.array
const normals = surface.geometry.attributes.normal.array
const buckets = new Map()
function region(x,y,z) {
  const side = x >= 0 ? 'left_' : 'right_'
  const ax = Math.abs(x)
  if (y > 1.62) return 'head'
  if (y > 1.50 && ax < .13) return 'neck'
  if (ax > .18 && y > 1.37) return side+'shoulder'
  if (ax > .205 + Math.max(0,1.38-y)*.14 && y > .8) {
    if (y > 1.185) return side+'upper_arm'
    return side + (y > .975 ? 'forearm' : 'hand')
  }
  if (y > 1.065 && z < -.025) return 'back'
  if (y > 1.25) return 'chest'
  if (y > 1.075) return 'abdomen'
  if (y > .94) return 'pelvis'
  if (y > .61) return side+'thigh'
  if (y > .50) return side+'knee'
  if (y > .145) return side+'lower_leg'
  return side+'foot'
}
const normal = new Vector3()
for (let i=0; i<surface.count*3; i+=9) {
  const vertices = [], ns = []
  for (let v=0; v<9; v+=3) {
    vertices.push(positions[i+v]*.65, (positions[i+v+1]+1)*.98, positions[i+v+2]*.32)
    normal.set(normals[i+v]/.65, normals[i+v+1]/.98, normals[i+v+2]/.32).normalize()
    ns.push(normal.x,normal.y,normal.z)
  }
  const code = region((vertices[0]+vertices[3]+vertices[6])/3,(vertices[1]+vertices[4]+vertices[7])/3,(vertices[2]+vertices[5]+vertices[8])/3)
  if (!buckets.has(code)) buckets.set(code,{p:[],n:[]})
  buckets.get(code).p.push(...vertices)
  buckets.get(code).n.push(...ns)
}
const doc = {asset:{version:'2.0',generator:'Orbital original implicit mannequin'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[{name:'Scan surface',pbrMetallicRoughness:{baseColorFactor:[.22,.6,.64,1],metallicFactor:.2,roughnessFactor:.5}}],accessors:[],bufferViews:[],buffers:[{byteLength:0}]}
const buffers = []
function attribute(values, bounds=false) {
  const bytes=Buffer.from(new Float32Array(values).buffer), offset=doc.buffers[0].byteLength
  const view=doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target:34962})-1
  buffers.push(bytes); doc.buffers[0].byteLength+=bytes.length
  const accessor={bufferView:view,componentType:5126,count:values.length/3,type:'VEC3'}
  if(bounds) {
    accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity]
    values.forEach((v,i)=>{accessor.min[i%3]=Math.min(accessor.min[i%3],v);accessor.max[i%3]=Math.max(accessor.max[i%3],v)})
  }
  return doc.accessors.push(accessor)-1
}
for(const [name,{p,n}] of buckets) {
  const mesh=doc.meshes.push({name,primitives:[{attributes:{POSITION:attribute(p,true),NORMAL:attribute(n)},material:0}]})-1
  doc.scenes[0].nodes.push(doc.nodes.push({name,mesh})-1)
}
let json=Buffer.from(JSON.stringify(doc)); json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)])
const bin=Buffer.concat(buffers), header=Buffer.alloc(12), jh=Buffer.alloc(8), bh=Buffer.alloc(8)
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4); header.writeUInt32LE(28+json.length+bin.length,8)
jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4)
const out=new URL('../public/body/',import.meta.url);mkdirSync(out,{recursive:true})
writeFileSync(new URL('orbital-body.glb',out),Buffer.concat([header,jh,json,bh,bin]))
console.log(JSON.stringify({regions:buckets.size,triangles:surface.count/3,bytes:28+json.length+bin.length}))
