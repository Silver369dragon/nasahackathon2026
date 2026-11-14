import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp;
const ease = (time, start, end) => THREE.MathUtils.smoothstep(time, start, end);
const upperLength = 0.31;
const foreLength = 0.31;
const down = v(0, -1, 0);
const actionAnchors = [[0, 0], [.8, .8], [3.6, 1.9], [4.4, 2.65], [7.5, 8], [8.3, 8.8],
  [9.7, 10.2], [10.9, 12], [12.05, 13.35], [12.3, 13.6], [12.7, 14], [21.65, 25.95],
  [22.05, 26.35], [22.1, 26.4], [23.3, 27.9], [24.4, 29.4], [30, 35]];

// Keep accepted poses while giving the task, explanation and procedure more
// screen time. Both actors and set consume this same absolute story mapping.
export function filmStoryTime(time) {
  if (time <= 2.1) return Math.max(0, time) * .8 / 2.1;
  if (time <= 16.1) return time - 1.3;
  if (time <= 19.7) return mix(14.8, 17.4, (time - 16.1) / 3.6);
  if (time <= 22) return time - 2.3;
  if (time <= 25.4) return mix(19.7, 22.1, (time - 22) / 3.4);
  return time - 3.3;
}

// Preserve the accepted poses while fitting their action beats to the v5 cuts.
export function filmActionTime(time) {
  time = filmStoryTime(time);
  for (let index = 1; index < actionAnchors.length; index++) {
    const [end, to] = actionAnchors[index];
    if (time > end) continue;
    const [start, from] = actionAnchors[index - 1];
    return mix(from, to, THREE.MathUtils.clamp((time - start) / (end - start), 0, 1));
  }
  return actionAnchors.at(-1)[1];
}
const metal = color => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.22 });
const ivory = metal('#e6ddc7'), graphite = metal('#253239'), seam = metal('#50636b');
const amber = metal('#f2b862');
const ceramic = metal('#d3dad5'), titanium = metal('#859597');
const lens = new THREE.MeshStandardMaterial({ color:'#244752', roughness:0.23, metalness:0.24 });
const reflection = new THREE.LineBasicMaterial({color:'#bfe1dc', transparent:true, opacity:0.72});

function joint(parent, x = 0, y = 0, z = 0) {
  const node = new THREE.Group();
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

function part(parent, material, size, position) {
  const radius = Math.min(0.035, ...size.map(n => n * 0.23));
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, radius), material);
  mesh.position.fromArray(position);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, radius, height, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function helmetAndSuit(person) {
  const shell = joint(person.head), torso = joint(person.body);
  // The bezel follows the existing convex visor, with a shallower lens and
  // a swept highlight on its upper quadrant to read even in the wide shot.
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.91, 1, 64), titanium);
  rim.position.set(0, 0.022, 0.249);
  rim.scale.set(0.300, 0.215, 1);
  shell.add(rim);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32, 0, Math.PI), lens);
  glass.position.set(0, 0.021, 0.251);
  glass.scale.set(0.282, 0.180, 0.186);
  shell.add(glass);
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const x = -0.178 + i * 0.023, y = 0.086 + 0.028 * Math.sin(Math.PI * i / 12);
    const z = 0.251 + 0.186 * Math.sqrt(1 - (x/0.282)**2 - (y/0.180)**2);
    points.push(v(x, 0.021 + y, z + 0.003));
  }
  shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), reflection));
  for (const side of [-1, 1]) {
    cylinder(shell, 0.113, 0.071, seam, side * 0.285, -0.010, 0.017).rotation.z = Math.PI / 2;
    cylinder(shell, 0.087, 0.076, ceramic, side * 0.294, -0.010, 0.017).rotation.z = Math.PI / 2;
    const strap = part(torso, seam, [0.070, 0.47, 0.031], [side * 0.245, 0.969, 0.207]);
    strap.rotation.z = -side * 0.08;
    part(torso, titanium, [0.084, 0.074, 0.046], [side * 0.238, 0.88, 0.218]);
    part(torso, graphite, [0.114, 0.112, 0.067], [side * 0.226, 0.658, 0.213]);
  }
  const seal = cylinder(torso, 0.284, 0.077, graphite, 0, 1.245, 0);
  seal.scale.z = 0.84;
  const collar = cylinder(torso, 0.285, 0.037, titanium, 0, 1.272, 0);
  collar.scale.z = 0.85;
  part(torso, ceramic, [0.21, 0.079, 0.054], [0, 0.648, 0.217]);
  const legs = person.legs.map(leg => {
    const fittings = joint(leg);
    part(fittings, seam, [0.238, 0.053, 0.255], [0, -0.257, 0.003]);
    part(fittings, graphite, [0.207, 0.173, 0.057], [0, -0.322, 0.144]);
    part(fittings, titanium, [0.160, 0.116, 0.049], [0, -0.319, 0.175]);
    return fittings;
  });
  return [shell, torso, ...legs];
}

function faceTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function plate(parent, width, height, texture, position) {
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.fromArray(position);
  parent.add(face);
  return face;
}

function makeNameplate(body, name, color) {
  const texture = faceTexture(384, 100, ctx => {
    ctx.fillStyle = '#172c35';
    ctx.fillRect(0, 0, 384, 100);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 14, 100);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 61px sans-serif';
    ctx.fillText(name, 200, 51);
  });
  return plate(body, 0.37, 0.096, texture, [0, 1.08, 0.234]);
}

function makeArm(body, original, side) {
  const suit = original.children[0].material;
  const upper = joint(body, side * 0.37, 1.2, 0);
  part(upper, suit, [0.215, 0.26, 0.227], [0, -0.125, 0]);
  part(upper, ivory, [0.224, 0.080, 0.231], [0, -0.045, 0]);
  const patch = part(upper, seam, [0.112, 0.089, 0.032], [side * 0.037, -0.133, 0.113]);
  part(patch, ivory, [0.069, 0.020, 0.012], [0, 0.018, 0.019]);
  part(patch, amber, [0.052, 0.016, 0.012], [0, -0.012, 0.019]);
  const elbow = joint(upper, 0, -upperLength, 0);
  part(elbow, seam, [0.17, 0.103, 0.169], [0, 0.024, 0]);
  part(elbow, suit, [0.179, 0.224, 0.187], [0, -0.108, 0]);
  part(elbow, ivory, [0.17, 0.077, 0.177], [0, -0.236, 0]);
  const wrist = joint(elbow, 0, -foreLength, 0);
  part(wrist, graphite, [0.154, 0.065, 0.128], [0, 0.023, 0]);
  part(wrist, ivory, [0.151, 0.107, 0.091], [0, -0.065, 0.006]);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const length = [0.094, 0.104, 0.096, 0.076][i];
    const finger = joint(wrist, side * (0.048 - i * 0.032), -0.112, 0.011);
    part(finger, ivory, [0.029, length * 0.54, 0.036], [0, -length * 0.27, 0]);
    const tip = joint(finger, 0, -length * 0.54, 0);
    part(tip, ivory, [0.027, length * 0.46, 0.033], [0, -length * 0.23, 0]);
    fingers.push({ finger, tip });
  }
  const thumb = joint(wrist, -side * 0.069, -0.048, 0.012);
  thumb.rotation.z = -side * 0.61;
  part(thumb, ivory, [0.040, 0.087, 0.043], [0, -0.037, 0.013]);
  return { upper, elbow, wrist, thumb, fingers };
}

function makeLeg(body, original, side) {
  const suit = original.children[2].material;
  const thigh = joint(body, side * 0.18, 0.62, 0);
  part(thigh, ivory, [0.23, 0.28, 0.25], [0, -0.14, 0]);
  const knee = joint(thigh, 0, -0.28, 0);
  part(knee, seam, [0.23, 0.105, 0.245], [0, 0, 0]);
  part(knee, titanium, [0.18, 0.12, 0.044], [0, 0, 0.145]);
  part(knee, suit, [0.22, 0.225, 0.24], [0, -0.125, 0]);
  part(knee, ivory, [0.23, 0.075, 0.25], [0, -0.24, 0]);
  const ankle = joint(knee, 0, -0.28, 0);
  part(ankle, graphite, [0.27, 0.12, 0.40], [0, 0, 0.07]);
  return { thigh, knee, ankle };
}

function gesture(arm, grip, palm = 0) {
  // Set the glove in world space so its display remains on top as the elbow bends.
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, Math.PI, palm));
  arm.wrist.quaternion.copy(arm.elbow.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(q);
  arm.fingers.forEach(({ finger, tip }, i) => {
    finger.rotation.x = -(0.08 + Math.min(1, grip * (0.90 + i * 0.08)) * 1.10);
    tip.rotation.x = -(0.11 + grip * 0.89);
  });
  arm.thumb.rotation.x = -0.12 - grip * 0.72;
}

// Two-bone reach in torso-local metres. The elbow pole keeps the sleeve on its own
// side of the body. Clamping allows a natural near miss at the end of a reach.
function reach(body, arm, target, side, grip, palm) {
  const delta = body.worldToLocal(target.clone()).sub(arm.upper.position);
  const direction = delta.clone().normalize();
  const distance = THREE.MathUtils.clamp(delta.length(), 0.095, upperLength + foreLength - 0.001);
  const pole = v(side * 0.72, -0.55, -0.4);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const along = (upperLength ** 2 - foreLength ** 2 + distance ** 2) / (2 * distance);
  const elbow = direction.clone().multiplyScalar(along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
  arm.upper.quaternion.setFromUnitVectors(down, elbow.clone().normalize());
  const fore = direction.multiplyScalar(distance).sub(elbow).normalize();
  arm.elbow.quaternion.copy(arm.upper.quaternion).invert()
    .multiply(new THREE.Quaternion().setFromUnitVectors(down, fore));
  gesture(arm, grip, palm);
}

function sensorFace(label, value, accent) {
  return faceTexture(384, 256, ctx => {
    ctx.fillStyle = '#10232b';
    ctx.fillRect(0, 0, 384, 256);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 384, 14);
    ctx.font = 'bold 35px sans-serif';
    ctx.fillText('ORBITAL', 20, 65);
    ctx.textAlign = 'center';
    ctx.font = 'bold 90px monospace';
    ctx.fillText(value, 192, 162);
    ctx.font = 'bold 35px sans-serif';
    ctx.fillText(label, 192, 226);
  });
}

function makeSensor(parent, texture, bevelColor) {
  const module = joint(parent);
  part(module, bevelColor, [0.146, 0.106, 0.045], [0, 0, 0.006]);
  const display = plate(module, 0.129, 0.087, texture, [0, 0, 0.030]);
  return { module, display };
}

function makeInspectionSensor(parent, texture) {
  const module = joint(parent);
  module.name = 'film-faulty-sensor';
  part(module, graphite, [.146, .106, .014], [0, 0, 0]);
  const pcb = part(module, metal('#315d4b'), [.126, .086, .007], [0, 0, .011]);
  pcb.name = 'film-schematic-pcb';
  part(module, graphite, [.042, .034, .010], [-.012, .004, .021]);
  part(module, titanium, [.027, .018, .009], [.037, .019, .020]);
  for (const y of [-.027, -.015, .023]) {
    part(module, amber, [.093, .0025, .0015], [0, y, .016]);
  }
  for (const x of [-.047, .030, .044]) {
    part(module, amber, [.0025, .057, .0015], [x, 0, .016]);
    part(module, ivory, [.011, .008, .008], [x, -.026, .021]);
  }
  const cover = joint(module, 0, 0, .033);
  cover.name = 'film-faulty-sensor-cover';
  part(cover, graphite, [.146, .106, .023], [0, 0, 0]);
  const display = plate(cover, .129, .087, texture, [0, 0, .014]);
  return { module, cover, display };
}

function placePerson(rig, x, y, z, yaw, lean = 0) {
  const parentScale = rig.g.parent.scale;
  rig.g.position.set(x / parentScale.x, y / parentScale.y, z / parentScale.z);
  rig.body.rotation.set(0, yaw, lean, 'YXZ');
  rig.body.position.set(0, 0, 0);
}

// Rotate around the pelvis, not around the feet. This keeps a full fall grounded
// and lets the same rig fold its knees while standing, lying or kneeling.
function placePelvis(rig, position, yaw, pitch, roll = 0) {
  placePerson(rig, position.x, position.y - 0.62, position.z, yaw);
  rig.body.rotation.set(pitch, yaw, roll, 'YXZ');
  const pivot = v(0, 0.62, 0);
  rig.body.position.copy(pivot).sub(pivot.clone().applyQuaternion(rig.body.quaternion));
}

function legsAt(person, hips, knees, spread = 0) {
  person.detailLegs.forEach((leg, index) => {
    leg.thigh.rotation.set(hips[index], 0, (index ? -1 : 1) * spread);
    leg.knee.rotation.set(knees[index], 0, 0);
    leg.ankle.rotation.set(0, 0, 0);
  });
}

function handAt(rig, side, world, grip, palm = 0) {
  const arm = rig.detailArms[side === -1 ? 0 : 1];
  reach(rig.body, arm, world, side, grip, palm);
}

function transformSnapshot(object) {
  const { visible } = object, position = object.position.clone(), rotation = object.quaternion.clone();
  return () => {
    object.position.copy(position);
    object.quaternion.copy(rotation);
    object.visible = visible;
  };
}

export function createFilmActors(ship, {scripted = true, names = ['LIN', 'SEAN', 'TIMMY', 'NOA', 'SOL']} = {}) {
  const [operator, sean, timmy, support, technician] = ship.people;
  const cast = ship.people.map((person, index) => {
    const detailArms = person.arms.map((original, i) => makeArm(person.body, original, i * 2 - 1));
    const detailLegs = person.legs.map((original, i) => makeLeg(person.body, original, i * 2 - 1));
    const badge = makeNameplate(person.body, names[index], ['#f7cc74', '#86ddd7', '#cdb6f5', '#ffab80', '#a8dab9'][index]);
    badge.name = 'crew-detail-' + index;
    return Object.assign(person, { detailArms, detailLegs, badge, suitDetails: helmetAndSuit(person) });
  });
  const ok = sensorFace('WAITING', '—', '#a7e6db');
  const offline = sensorFace('OFFLINE', '—', '#ffc87b');
  let liveSensor = null;
  const standby = sensorFace('SPARE', '02', '#a7e6db');
  const band = joint(timmy.detailArms[0].wrist, 0, 0.070, 0.090);
  band.rotation.y = 0.22;
  part(band, graphite, [0.170, 0.110, 0.078], [0, 0, -0.008]);
  const old = makeSensor(band, ok, graphite);
  old.module.name = 'crew-wrist-sensor';
  old.module.position.z = 0.026;
  const pocket = joint(sean.body, 0.26, 0.63, 0.21);
  part(pocket, seam, [0.210, 0.220, 0.112], [0, 0, 0.012]);
  part(pocket, graphite, [0.213, 0.061, 0.136], [0, 0.057, 0.012]);
  part(pocket, amber, [0.049, 0.112, 0.023], [-0.076, -0.005, 0.087]);
  // The spare uses one physical mesh from belt to hand to wrist. Its parent
  // stays fixed so seeking backwards never depends on a previous reparenting.
  const props = joint(ship.root);
  props.scale.set(1 / ship.root.scale.x, 1 / ship.root.scale.y, 1 / ship.root.scale.z);
  const spare = makeSensor(props, standby, amber);
  spare.module.name = 'crew-spare-sensor';
  const retired = makeInspectionSensor(props, offline);
  retired.module.position.set(-22.70, 1.123, 0);
  retired.module.rotation.x = -Math.PI / 2;
  const tag = plate(retired.module, 0.19, 0.066, faceTexture(384, 128, ctx => {
    ctx.fillStyle = '#ffbf62'; ctx.fillRect(0, 0, 384, 128);
    ctx.fillStyle = '#17252c'; ctx.font = 'bold 64px sans-serif'; ctx.fillText('INSPECT', 36, 88);
  }), [0, -0.10, 0.018]);
  tag.rotation.set(0.14, 0, Math.PI);
  const restored = cast.flatMap(person =>
    [person.g, person.body, person.head, person.head.children[1], person.phone, person.phoneCase, person.ring, ...person.arms, ...person.legs].map(transformSnapshot));
  const normalScreen = sean.phone.material.map;
  const medicalDevice = joint(props, -22.87, 1.49, -0.52);
  medicalDevice.name = 'film-medical-phone';
  medicalDevice.rotation.y = Math.PI - 0.65;
  part(medicalDevice, graphite, [0.253, 0.43, 0.036], [0, 0, 0]);
  const deviceScreen = plate(medicalDevice, 0.403 * 390 / 700, 0.403, null, [0, 0, 0.020]);
  deviceScreen.name = 'film-medical-phone-screen';
  deviceScreen.material.color.set('#071114');
  const chest = timmy.body.children[0];
  const chestScale = chest.scale.clone();
  let normalPhoneTexture = null, alertPhoneTexture = null, phoneTime = 0;
  function updatePhoneTexture() {
    const texture = phoneTime < 13.35 ? normalPhoneTexture : alertPhoneTexture;
    if (deviceScreen.material.map === texture) return;
    deviceScreen.material.map = texture;
    deviceScreen.material.color.set(texture ? '#ffffff' : '#071114');
    deviceScreen.material.needsUpdate = true;
  }
  const supportBag = joint(props, -19.6, 0.90, -1.25);
  part(supportBag, ivory, [0.30, 0.25, 0.16], [0, 0, 0]);
  part(supportBag, amber, [0.22, 0.035, 0.018], [0, 0.03, 0.087]);
  const workBoard = joint(props);
  workBoard.name = 'sean-engineering-clipboard';
  part(workBoard, seam, [0.48, 0.32, 0.025], [0, 0, 0]);
  const checklist = faceTexture(576, 360, ctx => {
    ctx.fillStyle = '#e6ddc7'; ctx.fillRect(0, 0, 576, 360);
    ctx.fillStyle = '#253239'; ctx.font = 'bold 41px sans-serif';
    ctx.fillText('SYSTEM CHECK', 32, 63);
    ctx.font = '30px sans-serif';
    ['AIRFLOW', 'POWER', 'LOCKS'].forEach((label, index) => {
      const y = 136 + index * 77;
      ctx.strokeStyle = '#50636b'; ctx.lineWidth = 4;
      ctx.strokeRect(34, y - 28, 30, 30);
      ctx.beginPath(); ctx.moveTo(39, y - 15); ctx.lineTo(46, y - 7); ctx.lineTo(60, y - 25); ctx.stroke();
      ctx.fillText(label, 91, y);
    });
  });
  plate(workBoard, 0.44, 0.275, checklist, [0, -0.008, 0.014]);
  part(workBoard, titanium, [0.14, 0.040, 0.025], [0, 0.144, 0.021]);
  const workClip = part(sean.body, graphite, [0.10, 0.09, 0.14], [-0.36, 0.84, -0.03]);
  const trainingPhone = joint(props);
  trainingPhone.name = 'film-training-phone';
  part(trainingPhone, graphite, [.253, .43, .036], [0, 0, 0]);
  const trainingScreen = plate(trainingPhone, .403 * 390 / 700, .403, null, [0, 0, .020]);
  trainingScreen.name = 'film-training-phone-screen';
  trainingScreen.material.color.set('#071114');
  let taskTexture = null, taskReadyTexture = null, taskTime = 0;
  function updateTaskTexture() {
    const texture = taskTime < .35 ? taskReadyTexture : taskTexture;
    if (trainingScreen.material.map === texture) return;
    trainingScreen.material.map = texture;
    trainingScreen.material.color.set(texture ? '#ffffff' : '#071114');
    trainingScreen.material.needsUpdate = true;
  }
  function setMedicalTextures({ phone, phoneNormal, taskPhone, taskPhoneReady, sensor } = {
    phone: null, phoneNormal: null, taskPhone: null, taskPhoneReady: null, sensor: null,
  }) {
    alertPhoneTexture = phone || null;
    normalPhoneTexture = phoneNormal || null;
    taskTexture = taskPhone || null;
    taskReadyTexture = taskPhoneReady || null;
    liveSensor = sensor || null;
    updateTaskTexture();
    updatePhoneTexture();
  }

  function setVisible(visible) {
    if (!visible) {
      restored.forEach(restore => restore());
      sean.phone.material.map = normalScreen;
      chest.scale.copy(chestScale);
    }
    for (const person of cast) {
      person.badge.visible = visible;
      person.suitDetails.forEach(detail => { detail.visible = visible; });
      person.detailArms.forEach(arm => { arm.upper.visible = visible; });
      person.detailLegs.forEach(leg => { leg.thigh.visible = visible; });
      if (visible) {
        person.head.children[1].visible = false;
        person.arms.forEach(arm => { arm.visible = false; });
        person.legs.forEach(leg => { leg.visible = false; });
        if (scripted) person.phone.visible = person.phoneCase.visible = person.ring.visible = false;
      }
    }
    props.visible = pocket.visible = workClip.visible = visible;
  }

  function update(time) {
    const storyTime = filmStoryTime(time);
    taskTime = storyTime;
    updateTaskTexture();
    time = filmActionTime(time);
    phoneTime = time;
    updatePhoneTexture();
    const weakness = ease(time, 8, 8.8);
    const fall = ease(time, 8.8, 10.2);
    const buckle = Math.sin(fall * Math.PI);
    const sit = ease(time, 27.9, 29.4);
    const attend = ease(time, 26.4, 26.8) * (1 - ease(time, 27.9, 28.5));
    const breathing = ease(time, 26.4, 26.6) * (1 - ease(time, 27.9, 28.2));
    chest.scale.copy(chestScale);
    chest.scale.z *= 1 + breathing * 0.045 * (1 - Math.cos((time - 26.4) * Math.PI * 2 / 2.8));
    band.rotation.y = mix(0.22, -0.58, fall);
    const timmyPelvis = v(mix(-22.05, -21.72, fall), mix(0.78, 0.53 - 0.06 * sit, fall) - 0.16 * buckle, 0);
    const tilt = mix(-Math.PI / 2 * fall, -0.65, sit);
    placePelvis(timmy, timmyPelvis, -Math.PI / 2, tilt, -0.055 * weakness * (1 - fall));
    timmy.head.position.set(0, 1.48, -0.06 * fall * (1 - sit));
    timmy.head.rotation.set(0.12 + 0.23 * weakness - 0.26 * fall - 0.04 * sit, -0.05 + 0.09 * sit, 0.10 * fall * (1 - sit));
    legsAt(timmy,
      [mix(0.26 * fall - 0.90 * buckle, -0.90, sit), mix(0.18 * fall - 0.84 * buckle, -0.84, sit)],
      [mix(0.70 * fall + 1.45 * buckle, 1.05, sit), mix(0.78 * fall + 1.38 * buckle, 0.98, sit)],
      0.05 * fall);
    timmy.detailLegs.forEach(leg => {
      leg.ankle.rotation.x = -tilt - leg.thigh.rotation.x - leg.knee.rotation.x;
    });

    const leverAngle = mix(-0.48, -1.02, ease(time, 1.9, 2.65));
    const leverWrist = v(-22.82 - Math.sin(leverAngle) * 0.34 + 0.015,
      1.07 + Math.cos(leverAngle) * 0.34 + 0.075, 0.38);
    const railWrist = v(-22.43, 1.19, -0.35);
    const lyingWrist = v(-21.38, 0.59, -0.58).lerp(v(-21.45, 0.68, -0.49), sit);
    handAt(timmy, -1, railWrist.clone().lerp(v(-22.26, 1.05, -0.40), weakness * 0.25)
      .lerp(lyingWrist, fall), mix(0.94, 0.02, ease(time, 8.8, 9.25)) + 0.32 * sit, 0.06);
    handAt(timmy, 1, leverWrist.lerp(v(-21.58, 0.35, 0.45), fall)
      .lerp(v(-21.67, 0.38, 0.41), sit), mix(0.91, 0.04, ease(time, 8.8, 9.2)), -0.07);

    // Sean reacts immediately at 10.2 s, then takes three measured steps and
    // kneels beside the near wrist. His helmet stays behind Timmy's shoulder.
    const reaction = ease(time, 10.2, 10.65);
    const approach = ease(time, 10.35, 11.65);
    const kneel = ease(time, 11.5, 12);
    const phase = approach * Math.PI * 6;
    const stepping = Math.sin(approach * Math.PI) * (1 - kneel);
    const seanPelvis = v(mix(-19.20, -21.85, approach) + 0.40 * attend,
      mix(0.78, 0.45, kneel) + Math.abs(Math.sin(phase)) * 0.026 * stepping,
      mix(-0.60, -0.88, approach) + 0.10 * attend);
    const approachYaw = mix(-Math.PI, -Math.PI / 2, reaction);
    placePelvis(sean, seanPelvis, mix(approachYaw, 0.9, kneel), 0.30 * kneel + 0.25 * attend);
    sean.head.position.set(0, 1.48, 0);
    sean.head.rotation.set(0.08 + 0.22 * kneel + 0.15 * attend - 0.06 * sit, -0.24 * reaction, 0);
    legsAt(sean,
      [0.44 * Math.sin(phase) * stepping - 0.75 * kneel, -0.44 * Math.sin(phase) * stepping - 0.89 * kneel],
      [-0.28 * Math.max(0, -Math.sin(phase)) * stepping + 1.95 * kneel,
        -0.28 * Math.max(0, Math.sin(phase)) * stepping + 2.10 * kneel], 0.075 * kneel);

    // The physical checklist travels from both gloves into the opposite belt
    // clip before rescue. It remains attached there for the rest of the take.
    const tuck = ease(time, 10.2, 10.55);
    workBoard.position.copy(sean.body.localToWorld(v(0, 0.98, 0.35).lerp(v(-0.40, 0.70, -0.03), tuck)));
    workBoard.quaternion.copy(sean.body.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12 * (1 - tuck), -Math.PI / 2 * tuck, 0)));

    const braceReach = ease(time, 11.45, 12);
    const pull = ease(time, 12, 12.55), fit = ease(time, 12.55, 13.35);
    const pouchPosition = pocket.getWorldPosition(new THREE.Vector3()).add(v(0, 0, 0.10));
    const fitting = band.getWorldPosition(new THREE.Vector3()).add(v(0, 0, -0.025));
    const movingRight = sean.body.localToWorld(v(0.35, 0.87, 0.22));
    const serviceHand = movingRight.lerp(v(-21.10, 0.73, -0.40), braceReach)
      .lerp(pouchPosition.clone().add(v(0.035, 0.105, 0.015)), pull)
      .lerp(fitting.clone().add(v(0.07, 0.095, -0.005)), fit);
    serviceHand.y += 0.09 * Math.sin(fit * Math.PI);
    serviceHand.lerp(v(-21.63, 0.69, -1.02), ease(time, 13.35, 13.6));
    const usingPhone = ease(time, 13.6, 14) * (1 - ease(time, 25.95, 26.35));
    medicalDevice.visible = true;
    medicalDevice.position.copy(v(-22.87, 1.49, -0.52).lerp(v(-20.95, 0.98, -0.78), usingPhone));
    sean.phone.visible = sean.phoneCase.visible = false;
    serviceHand.lerp(v(-20.95, 0.78, -0.78), usingPhone);
    serviceHand.lerp(v(-21.27, 0.66, -0.40), sit);
    serviceHand.lerp(v(-21.32, 0.66, -0.56), attend);
    serviceHand.lerp(workBoard.localToWorld(v(0.24, 0.08, 0.02)), 1 - ease(time, 10.2, 10.36));
    handAt(sean, 1, serviceHand, mix(0.30, 0.62, usingPhone), -0.14);
    const brace = sean.body.localToWorld(v(-0.34, 0.90, 0.25));
    brace.lerp(lyingWrist.clone().add(v(-0.14, -0.035, 0.12)), braceReach);
    brace.lerp(v(-21.14, 0.56, -0.35), attend);
    brace.lerp(workBoard.localToWorld(v(-0.24, 0.08, 0.02)), 1 - ease(time, 10.55, 10.7));
    handAt(sean, -1, brace, 0.36 + 0.08 * sit, 0.10);

    old.module.visible = time < 13.35;
    old.display.material.map = liveSensor || ok;
    spare.module.position.copy(pouchPosition);
    const carried = sean.detailArms[1].wrist.localToWorld(v(0.015, -0.09, 0.035));
    spare.module.position.lerp(carried, ease(time, 12.30, 12.52));
    spare.module.position.lerp(fitting, ease(time, 13.10, 13.35));
    spare.module.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
    spare.module.quaternion.slerp(band.getWorldQuaternion(new THREE.Quaternion()), fit);
    spare.display.material.map = liveSensor || standby;
    retired.module.visible = storyTime >= 12.05;
    tag.visible = storyTime >= 24.4;
    retired.module.position.copy(fitting).lerp(pouchPosition, ease(storyTime, 12.05, 12.3));
    retired.module.quaternion.copy(band.getWorldQuaternion(new THREE.Quaternion()))
      .slerp(pocket.getWorldQuaternion(new THREE.Quaternion()), ease(storyTime, 12.05, 12.3));
    if (storyTime >= 24.4) {
      retired.module.position.set(-22.70, 1.123, 0);
      retired.module.rotation.set(-Math.PI / 2, 0, 0);
    }
    const inspect = ease(storyTime, 24.65, 25.55);
    retired.cover.position.set(-.10 * inspect, -.04 * inspect, .033 + .10 * inspect);
    retired.cover.rotation.set(0, -.18 * inspect, 0);

    // The rest of the crew remain at separate stations. Lin leaves the nearest
    // quarters only after the incident and walks the centre aisle to support.
    const assist = ease(time, 14.1, 21.8);
    const linPosition = v(-13.65, 0.16, -4.90)
      .lerp(v(-14.00, 0.16, -0.72), ease(assist, 0, 0.35))
      .lerp(v(-19.65, 0.16, -1.25), ease(assist, 0.35, 1))
      .lerp(v(-19.65, .16, .82), ease(storyTime, 22.1, 22.75))
      .lerp(v(-22.70, .16, .65), ease(storyTime, 22.75, 24.2));
    const atBench = ease(storyTime, 23.9, 24.4);
    const duties = [
      [operator, linPosition, mix(mix(Math.PI, -1.1, ease(assist, 0, 0.3)), Math.PI, atBench)],
      [technician, v(26.02, 0.16, 4.92), Math.PI / 2],
    ];
    for (const [person, position, angle] of duties) {
      placePerson(person, position.x, position.y, position.z, angle);
      person.head.position.set(0, 1.48, 0);
      person.head.rotation.set(0.18, 0.07 * Math.sin(time * 0.5), 0);
      if (person === operator) person.head.rotation.y -= .35 * (1 - ease(assist, 0, .2));
      if (person === technician) person.head.rotation.y = .45;
      const walk = person === operator ? Math.sin(assist * Math.PI) : 0;
      legsAt(person, [0.30 * Math.sin(assist * 22) * walk, -0.30 * Math.sin(assist * 22) * walk], [0, 0]);
      for (const side of [-1, 1]) {
        const work = 0.035 * Math.sin(time * 1.5 + side);
        const hand = person.body.localToWorld(v(side * 0.31, 0.99 + work, 0.36));
        if (person === technician) {
          if (side === 1) hand.lerp(v(26.59, 1.40, 4.58), .85 + .08 * Math.sin(storyTime * 2));
        }
        if (person === operator) {
          const inspectingHand = side === 1
            ? retired.cover.localToWorld(v(-.13, 0, .015)).add(v(0, .13, 0))
            : v(-22.54, 1.235, .01);
          hand.lerp(inspectingHand, atBench);
        }
        handAt(person, side, hand, 0.48);
      }
    }
    // Noa reads the real task screen, stows it, and steps onto the ship's
    // existing treadmill. The belt is at y=.502, independent of hull scaling.
    const onTreadmill = ease(storyTime, .8, 1.35);
    const jogging = ease(storyTime, 1.2, 1.8);
    const stride = Math.sin(Math.max(0, storyTime - 1.2) * 8);
    placePerson(support, mix(13.08, 11.8, onTreadmill),
      mix(.16, .505, onTreadmill) + .018 * Math.abs(stride) * jogging,
      mix(5.60, 5.75, onTreadmill), Math.PI);
    support.head.position.set(0, 1.48, 0);
    support.head.rotation.set(mix(.27, .06, jogging), 0, 0);
    legsAt(support, [stride * .34 * jogging, -stride * .34 * jogging],
      [Math.max(0, -stride) * .55 * jogging, Math.max(0, stride) * .55 * jogging]);
    support.detailLegs.forEach(leg => { leg.ankle.rotation.x = -leg.thigh.rotation.x - leg.knee.rotation.x; });
    const stowTask = ease(storyTime, .75, 1.10);
    trainingPhone.position.copy(support.body.localToWorld(v(0, 1.02, .62).lerp(v(-.35, .67, 0), stowTask)));
    trainingPhone.quaternion.copy(support.body.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.95 * (1 - stowTask), mix(Math.PI, Math.PI * 1.5, stowTask), 0)));
    for (const side of [-1, 1]) {
      // The display faces Noa: the hands approach its front from his side.
      const gripPoint = v(-side * .17, -.03, .08);
      if (side === 1) {
        const lift = ease(storyTime, .10, .18) * (1 - ease(storyTime, .56, .64));
        const reach = ease(storyTime, .18, .32) * (1 - ease(storyTime, .42, .56));
        const press = ease(storyTime, .32, .35) * (1 - ease(storyTime, .38, .42));
        gripPoint.set(mix(-.17, -.07, reach), mix(-.03, -.085, reach), .08 + .17 * lift - .025 * press);
      }
      const held = trainingPhone.localToWorld(gripPoint);
      const railHand = v(side < 0 ? 12.47 : 11.13, 1.80, 5.43);
      handAt(support, side, held.lerp(railHand, ease(storyTime, .95, 1.45)), .55);
    }
    supportBag.visible = time >= 19;
    supportBag.position.copy(operator.detailArms[1].wrist.localToWorld(v(0, -0.11, 0.03)));
    supportBag.position.lerp(v(-19.6, .28, -.7), ease(storyTime, 22.1, 22.5));
  }

  function updateCabin() {
    for (const person of cast) {
      person.detailArms.forEach((arm, i) => arm.upper.quaternion.copy(person.arms[i].quaternion));
      person.detailLegs.forEach((leg, i) => leg.thigh.quaternion.copy(person.legs[i].quaternion));
    }
    old.display.material.map = liveSensor || ok;
    // The spare stays in the engineer's pouch until a scripted shoot uses it.
    spare.module.position.copy(pocket.getWorldPosition(new THREE.Vector3()));
    spare.module.quaternion.copy(pocket.getWorldQuaternion(new THREE.Quaternion()));
    updatePhoneTexture();
    updateTaskTexture();
  }
  if (!scripted) {
    sean.body.add(workBoard);
    workBoard.position.set(-.43, .88, .20);
    workBoard.rotation.y = -.6;
    operator.body.add(supportBag);
    supportBag.position.set(-.36, .61, -.08);
    trainingPhone.position.set(12.45, 1.65, 5.43);
    trainingPhone.rotation.set(-.35, Math.PI, 0);
    cast.forEach((person, id) => person.g.traverse(object => {
      if (object.isMesh && !object.userData.kind) object.userData = {kind:'crew', id};
    }));
    medicalDevice.traverse(object => { if (object.isMesh) object.userData = {kind:'phone', id:2}; });
    trainingPhone.traverse(object => { if (object.isMesh) object.userData = {kind:'phone', id:3}; });
  }
  setVisible(true);
  const tick = scripted ? update : updateCabin;
  tick(0);
  return { update:tick, setVisible, setMedicalTextures };
}
