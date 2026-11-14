import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { filmActionTime, filmStoryTime } from './film-actors.js';
import { readings } from './simulation.mjs';
import { scenarioReadings } from './scenarios.mjs';

const ink = '#0b1e24';
const mint = '#8de6c8';
const type = '"Segoe UI", sans-serif';

function panelTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return { ctx, map, material: new THREE.MeshBasicMaterial({ map, toneMapped: false }) };
}

function text(ctx, label, x, y, size, color = '#edf7ef', weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${type}`;
  ctx.fillText(label, x, y);
}

function paintConsole(panel, time, progress) {
  const { ctx, map } = panel;
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 512, 240);
  text(ctx, 'FLIGHT DECK / AIRFLOW', 18, 34, 25, '#a6bec3');
  ctx.fillStyle = '#345459';
  ctx.fillRect(19, 48, 474, 2);
  const level = Math.round(42 + 28 * progress);
  text(ctx, String(level) + '%', 17, 120, 60, mint);
  text(ctx, 'FLOW SET', 260, 113, 33);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i / 24 < level / 100 ? mint : '#2b4146';
    ctx.fillRect(21 + i * 19.5, 147, 14, 20);
  }
  text(ctx, time < 2.65 ? 'LEVER / ADJUSTING' : 'LEVER / SET', 20, 211, 27, mint);
  map.needsUpdate = true;
}

// Scene-space metres, inside the actual forward flight deck at world x=-24.
// Both entrances use the same equipment. Only the studio animates its controls
// against the film timeline; the cabin keeps its own crew routines.
export function addFilmSet(scene, ship, {scripted = true} = {}) {
  const stage = new THREE.Group();
  stage.name = 'film-set';
  stage.visible = false;
  stage.scale.set(1 / ship.root.scale.x, 1 / ship.root.scale.y, 1 / ship.root.scale.z);
  ship.root.add(stage);
  const finish = (color, metalness = .25) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness: .52 });
  const ivory = finish('#c6cac0');
  const trim = finish('#52676c', .52);
  const dark = finish('#203039');
  const copper = finish('#d3ab64', .56);
  const deckFinish = finish('#37494e', .10);
  const indicator = new THREE.MeshBasicMaterial({ color: '#c2ffed', toneMapped: false });
  const box = (parent, material, size, position, radius = .025) => {
    const [w, h, d] = size;
    const geometry = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 4, h / 4, d / 4));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (parent, material, radius, height, ...position) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };

  function workstation(name, position, yaw, pitch = 0) {
    const mount = new THREE.Group();
    mount.name = name;
    mount.position.fromArray(position);
    mount.rotation.set(pitch, yaw, 0);
    stage.add(mount);
    box(mount, dark, [1.04, .65, .065], [0, 0, 0]);
    const panel = panelTexture(1280, 720);
    panel.material.color.set('#071114');
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(.96, .54), panel.material);
    screen.name = name + '-screen';
    screen.position.z = .036;
    mount.add(screen);
    return panel;
  }
  const radiation = workstation('film-radiation-station', [26.64, 1.5, 4.32], -Math.PI / 2);
  const bodyMap = workstation('film-body-map-station', [-13.1, 1.4, -5.40], 0, -.12);
  stage.getObjectByName('film-body-map-station-screen').userData = {kind:'phone', id:0, route:'/app/body-map'};
  let previousRadiation;
  function updateRadiation(time) {
    const warning = scenarioReadings(readings(time, false), null).some(sample => sample.environmentalWarning);
    if (warning === previousRadiation) return;
    const { ctx, map, material } = radiation;
    ctx.fillStyle = '#10262d'; ctx.fillRect(0, 0, 1280, 720);
    text(ctx, 'CABIN STATUS', 64, 92, 52, '#b5cdc9');
    text(ctx, 'Radiation', 64, 200, 82);
    ctx.strokeStyle = mint; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(172, 280); ctx.lineTo(252, 310); ctx.lineTo(252, 398);
    ctx.quadraticCurveTo(246, 448, 172, 485); ctx.quadraticCurveTo(98, 448, 92, 398);
    ctx.lineTo(92, 310); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(127, 375); ctx.lineTo(164, 408); ctx.lineTo(222, 343); ctx.stroke();
    text(ctx, warning ? 'Warning active' : 'No active warning', 322, 400, 66, mint);
    text(ctx, 'SIMULATION / SCENARIO STATE', 64, 635, 40, '#d3b980');
    material.color.set('#ffffff'); map.needsUpdate = true;
    previousRadiation = warning;
  }

  // Flush centre deck plates leave both original flight seats unobstructed.
  for (let x = -22.7; x <= -19.4; x += 1.1) {
    for (const z of [-.57, .57]) {
      box(stage, deckFinish, [1.06, .012, 1.10], [x, .141, z], .004);
      for (const edge of [-.42, .42]) {
        box(stage, trim, [.13, .006, .018], [x + edge, .150, z + .43], .002);
      }
    }
  }

  // A compact console is mounted aft of the ship's real forward control bank.
  // Timmy faces -X; the lever pivots toward +X into his right hand.
  const consoleRoot = new THREE.Group();
  consoleRoot.position.set(-22.94, 0, 0);
  stage.add(consoleRoot);
  box(consoleRoot, dark, [.65, .15, 1.10], [0, .25, 0]);
  box(consoleRoot, trim, [.43, .67, .80], [-.06, .64, 0]);
  box(consoleRoot, ivory, [.69, .16, 1.16], [0, 1.01, 0], .045);
  box(consoleRoot, dark, [.65, .025, 1.10], [0, 1.102, 0]);
  for (const z of [-.46, .46]) {
    for (const x of [-.25, .25]) {
      cylinder(consoleRoot, trim, .021, .008, x, 1.119, z);
      box(consoleRoot, dark, [.023, .004, .004], [x, 1.125, z], .001);
    }
  }
  for (let i = 0; i < 5; i++) {
    box(consoleRoot, trim, [.025, .02, .60], [.225, .47 + i * .055, 0], .003);
  }
  for (const z of [-.28, -.10, .08]) {
    box(consoleRoot, trim, [.12, .023, .115], [.08, 1.127, z], .009);
    box(consoleRoot, ivory, [.085, .011, .080], [.08, 1.145, z], .007);
  }
  const lever = new THREE.Group();
  lever.name = 'film-console-lever';
  lever.position.set(-22.82, 1.07, .38);
  stage.add(lever);
  cylinder(stage, trim, .115, .035, -22.82, 1.121, .38);
  cylinder(lever, copper, .027, .34, 0, .17, 0);
  const handle = cylinder(lever, dark, .047, .24, 0, .34, 0);
  handle.rotation.x = Math.PI / 2;
  for (const z of [-.12, .12]) {
    cylinder(lever, copper, .052, .018, 0, .34, z).rotation.x = Math.PI / 2;
  }
  box(stage, trim, [.11, .08, .12], [-22.63, 1.06, -.36]);
  const rail = cylinder(stage, copper, .034, .60, -22.48, 1.08, -.36);
  rail.name = 'film-console-handhold';
  rail.rotation.z = Math.PI / 2;
  box(stage, trim, [.12, .07, .12], [-22.75, 1.08, -.36]);
  cylinder(stage, dark, .040, .040, -22.18, 1.08, -.36).rotation.z = Math.PI / 2;

  const monitor = new THREE.Group();
  monitor.position.set(-23.21, 1.48, -.10);
  monitor.rotation.set(-.14, Math.PI / 2, 0);
  stage.add(monitor);
  box(monitor, trim, [.78, .43, .069], [0, 0, 0]);
  const consoleScreen = panelTexture(512, 240);
  const hmi = new THREE.Mesh(new THREE.PlaneGeometry(.73, .365), consoleScreen.material);
  hmi.position.z = .037;
  monitor.add(hmi);
  box(consoleRoot, indicator, [.018, .024, .27], [.352, 1.03, .12]);
  const phoneStand = new THREE.Group();
  phoneStand.name = 'film-console-phone-stand';
  phoneStand.position.set(-22.87, 1.14, -.52);
  phoneStand.rotation.y = Math.PI - .65;
  stage.add(phoneStand);
  box(phoneStand, dark, [.20, .035, .15], [0, 0, 0]);
  box(phoneStand, trim, [.065, .18, .035], [0, .095, -.025]);
  box(phoneStand, copper, [.19, .025, .07], [0, .1225, .005]);

  const board = panelTexture(1600, 900);
  board.ctx.fillStyle = ink;
  board.ctx.fillRect(0, 0, 1600, 900);
  board.map.needsUpdate = true;
  let medicalBoard = null;
  let normalBoard = null;
  let boardTime = 0;
  function updateBoard() {
    const texture = (boardTime < 13.35 ? normalBoard : medicalBoard) || board.map;
    if (board.material.map === texture) return;
    board.material.map = texture;
    board.material.needsUpdate = true;
  }
  function setMedicalTextures({ board: texture, boardNormal, bodyMap: bodyTexture } = {
    board: null, boardNormal: null, bodyMap: null,
  }) {
    medicalBoard = texture;
    normalBoard = boardNormal;
    bodyMap.material.map = bodyTexture || null;
    bodyMap.material.color.set(bodyTexture ? '#ffffff' : '#071114');
    bodyMap.material.needsUpdate = true;
    updateBoard();
  }
  const boardFrame = new THREE.Group();
  boardFrame.position.set(-24, 2.55, 3.90);
  boardFrame.rotation.y = Math.PI;
  stage.add(boardFrame);
  box(boardFrame, dark, [4.15, 2.40, .12], [0, 0, -.025]);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.25), board.material);
  face.name = 'film-training-board';
  face.userData = {kind:'shared'};
  face.position.z = .041;
  boardFrame.add(face);

  // Ground contact remains visible during the fall and the ground rescue.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 96;
  const shadowContext = shadowCanvas.getContext('2d');
  const falloff = shadowContext.createRadialGradient(48, 48, 7, 48, 48, 47);
  falloff.addColorStop(0, 'rgba(0,0,0,.29)');
  falloff.addColorStop(.40, 'rgba(0,0,0,.17)');
  falloff.addColorStop(1, 'rgba(0,0,0,0)');
  shadowContext.fillStyle = falloff;
  shadowContext.fillRect(0, 0, 96, 96);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
    toneMapped: false,
  });
  const shadowGeometry = new THREE.PlaneGeometry(1.20, .92);
  const shadows = ship.people.map(() => {
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    stage.add(shadow);
    return shadow;
  });
  const actorPosition = new THREE.Vector3();

  // Static hardware can share draw calls, but the moving lever stays separate.
  const staticParts = new Map();
  stage.updateWorldMatrix(true, true);
  stage.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh) || mesh.parent === lever ||
        mesh.material.map || mesh.material.transparent) return;
    let geometry = mesh.geometry.clone();
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!staticParts.has(mesh.material)) staticParts.set(mesh.material, []);
    staticParts.get(mesh.material).push({ mesh, geometry });
  });
  for (const [material, parts] of staticParts) {
    const combined = mergeGeometries(parts.map(part => part.geometry), false);
    if (combined) {
      stage.add(new THREE.Mesh(combined, material));
      for (const { mesh } of parts) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    }
    for (const { geometry } of parts) geometry.dispose();
  }

  let previousState;
  let previousLevel;
  function update(time) {
    const storyTime = scripted ? filmStoryTime(time) : 0;
    updateRadiation(storyTime);
    time = scripted ? filmActionTime(time) : 3;
    boardTime = time;
    updateBoard();
    ship.people.forEach((person, index) => {
      person.g.getWorldPosition(actorPosition);
      const fall = scripted && index === 2 ? THREE.MathUtils.smoothstep(time, 8.8, 10.2) : 0;
      shadows[index].position.set(actorPosition.x + fall * .20, .157, actorPosition.z);
      shadows[index].scale.set(1 + fall * .68, 1, 1);
    });
    const progress = THREE.MathUtils.smoothstep(time, 1.9, 2.65);
    lever.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-.48, -1.02, progress), .7,
      THREE.MathUtils.smoothstep(storyTime, 24.15, 24.4));
    const state = time < 2.65 ? 'adjusting' : 'set';
    const level = Math.round(42 + 28 * progress);
    if (state !== previousState || level !== previousLevel) paintConsole(consoleScreen, time, progress);
    previousState = state;
    previousLevel = level;
  }
  update(0);
  return { update, setMedicalTextures, setVisible(visible) { stage.visible = visible; } };
}
