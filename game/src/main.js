// main.js — bootstrap and render loop.
// The simulation (sim.js) owns all gameplay; this file owns the DOM input,
// the three.js scene, and the fixed-step loop that drives the sim. Nothing
// gameplay-related is decided here.

import * as THREE from 'three';
import { SIM_DT, PLAYER, TEAM_COLOR, WEAPONS } from './config.js';
import { buildMapMeshes, PALETTE } from './map.js';
import { createSim, stepSim } from './sim.js';
import { createHud, updateHud, setBuyOpen, showBanner } from './hud.js';
import { createEffects, updateEffects } from './effects.js';
import * as audio from './audio.js';

// --- Seeded RNG for screenshot staging (?seed=N). Deterministic scenes. ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot'); // 'start' | 'play' | 'end' | null
const seedParam = params.get('seed');
if (seedParam !== null) {
  const rng = mulberry32(parseInt(seedParam, 10) || 1);
  Math.random = rng;
}

// --- Input (plain object; the player consumes it each sim step). ---
const input = {
  keys: new Set(),
  pressedKeys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  fireHeld: false,
  firePressed: false,
  adsHeld: false,
};

// --- Three.js setup. ---
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, 55, 110);

const camera = new THREE.PerspectiveCamera(PLAYER.fov, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xcfd8e6, 0x2a241f, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b3, 2.2);
sun.position.set(18, 30, -12);
scene.add(sun);
// A small light on the camera so the viewmodel gun reads (and nearby walls
// get a warm fill). It does not affect gameplay.
const camLight = new THREE.PointLight(0xfff2dd, 8, 10, 1.2);
camera.add(camLight);

buildMapMeshes(scene);

// --- Sim + HUD + effects. ---
const sim = createSim(input);
const hud = createHud(sim);
const fx = createEffects(scene);

// --- Bot meshes (one group per bot; the sim owns the numbers). ---
const botMeshes = new Map();
const bodyGeo = new THREE.BoxGeometry(0.72, 1.15, 0.42);
const headGeo = new THREE.SphereGeometry(0.24, 12, 10);
const gunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.85);

function makeBotMesh(bot) {
  const group = new THREE.Group();
  const color = TEAM_COLOR[bot.team];
  const bodyMat = new THREE.MeshLambertMaterial({ color, transparent: true });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xcaa27a, transparent: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.58;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: bot.team === 'CT' ? 0x9fd4ff : 0xff9d7a }),
  );
  visor.position.set(0, 1.6, -0.22);
  const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
  gun.position.set(0.28, 1.15, -0.35);
  // Health bar: two sprites (always face the camera, no per-frame lookAt).
  const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false }));
  barBg.scale.set(0.7, 0.09, 1);
  barBg.position.y = 2.0;
  const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: bot.team === 'CT' ? 0x4da3ff : 0xff6a4d, transparent: true, opacity: 0.95, depthWrite: false }));
  barFg.scale.set(0.7, 0.09, 1);
  barFg.position.y = 2.0;
  group.add(body, head, visor, gun, barBg, barFg);
  scene.add(group);
  return { group, bodyMat, headMat, barBg, barFg, dead: false };
}

for (const bot of sim.bots) botMeshes.set(bot.id, makeBotMesh(bot));

// --- Player viewmodel (a simple gun, rebuilt per weapon). ---
const viewmodel = new THREE.Group();
camera.add(viewmodel);
let viewmodelWeapon = '';
function buildViewmodel(weaponId) {
  while (viewmodel.children.length > 0) viewmodel.remove(viewmodel.children[0]);
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262b });
  const mid = new THREE.MeshLambertMaterial({ color: 0x3a3e45 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xf0a830 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    viewmodel.add(m);
    return m;
  };
  if (weaponId === 'rifle') {
    add(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark, 0, 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.35), mid, 0, 0.02, -0.42);
    add(new THREE.BoxGeometry(0.07, 0.16, 0.1), dark, 0, -0.12, 0.08);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.12), accent, 0, 0.08, -0.15);
  } else if (weaponId === 'sniper') {
    add(new THREE.BoxGeometry(0.08, 0.11, 0.7), dark, 0, 0, 0);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.5), mid, 0, 0.02, -0.55);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), mid, 0, 0.09, -0.1).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.06, 0.14, 0.09), dark, 0, -0.11, 0.1);
  } else {
    add(new THREE.BoxGeometry(0.07, 0.1, 0.28), dark, 0, 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.08, 0.08), mid, 0, -0.08, 0.05);
  }
  viewmodelWeapon = weaponId;
}
buildViewmodel(sim.player.weapon);

// Bomb mesh: a small blinking device, visible only when planted.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.45, 0.22, 0.32),
  new THREE.MeshLambertMaterial({ color: 0x2a2d33 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
);
bombLight.position.set(0.12, 0.13, 0);
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// --- Input listeners. ---
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
const endScreen = document.getElementById('end-screen');
const restartBtn = document.getElementById('restart');

function lockPointer() {
  renderer.domElement.requestPointerLock?.();
}

function startPlaying() {
  audio.ensureAudio();
  if (sim.match.phase === 'menu') {
    sim.startMatch();
    showBanner(hud, 'ROUND 1', 'Defend the sites — press B to buy', 3);
  } else if (sim.match.phase === 'matchEnd') {
    sim.startMatch();
    if (endScreen) endScreen.hidden = true;
  }
  if (overlay) overlay.hidden = true;
  lockPointer();
}

if (playBtn) playBtn.addEventListener('click', startPlaying);
if (restartBtn) restartBtn.addEventListener('click', () => { startPlaying(); });
renderer.domElement.addEventListener('click', () => {
  if (sim.match.phase !== 'menu' && document.pointerLockElement !== renderer.domElement) lockPointer();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && sim.match.phase !== 'menu' && sim.match.phase !== 'matchEnd' && !hud.buyOpen && !shotMode) {
    if (overlay) {
      overlay.hidden = false;
      document.getElementById('overlay-title').textContent = 'Paused';
      document.getElementById('overlay-copy').textContent = 'Click to resume. The round keeps its state.';
      document.getElementById('play').textContent = 'Click to resume';
    }
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  input.mouseDX += e.movementX;
  input.mouseDY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { input.fireHeld = true; input.firePressed = true; }
  if (e.button === 2) input.adsHeld = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fireHeld = false;
  if (e.button === 2) input.adsHeld = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && !e.repeat) {
    setBuyOpen(hud, !hud.buyOpen);
    return;
  }
  if (e.code === 'KeyC' && !e.repeat) input.crouchPressed = true;
  if (e.repeat) return;
  input.keys.add(e.code);
  input.pressedKeys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  if (e.code === 'ControlLeft') input.keys.delete('ControlLeft');
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screenshot staging (?shot=start|play|end&seed=N). ---
// The game auto-starts without pointer lock so a headless browser can
// capture real renders. Bots and rounds run for real; the camera is placed
// for the shot.
function stageShot(shot) {
  sim.startMatch();
  if (overlay) overlay.hidden = true;
  const p = sim.player;
  if (shot === 'start') {
    // Round 1 freeze, player at CT spawn looking down mid.
    p.x = -28; p.z = 0; p.yaw = -Math.PI / 2; p.pitch = 0;
  } else if (shot === 'play') {
    // Fast-forward ~35s of live play, then put the player mid-map.
    fastForward(5 + 35);
    // The staged player must be alive for the shot.
    if (!p.alive) { p.alive = true; p.health = 100; }
    p.x = -2; p.z = -4; p.yaw = -Math.PI / 2 - 0.5; p.pitch = 0.02;
  } else if (shot === 'end') {
    // Fast-forward until a round ends (cap 100s), then force the banner.
    fastForward(5 + 100);
    if (!p.alive) { p.alive = true; p.health = 100; }
    if (sim.match.phase !== 'roundEnd' && sim.match.phase !== 'matchEnd') {
      for (const b of sim.bots) if (b.team === 'T') { b.health = 0; b.alive = false; }
      stepSim(sim, SIM_DT);
    }
    p.x = -6; p.z = 2; p.yaw = -Math.PI / 2; p.pitch = 0;
  }
}

// Run the sim forward N seconds (no rendering) for shot staging.
function fastForward(seconds) {
  const steps = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) stepSim(sim, SIM_DT);
}

if (shotMode) {
  stageShot(shotMode);
}

// --- Main loop: fixed-step sim, then render. ---
const clock = new THREE.Clock();
let acc = 0;
let fovCurrent = PLAYER.fov;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;

  acc += dt;
  let guard = 0;
  while (acc >= SIM_DT && guard < 8) {
    stepSim(sim, SIM_DT);
    acc -= SIM_DT;
    guard++;
    // Staging only (?shot=): the staged player cannot stay dead — revive
    // instantly and drop the death event, so the screenshot shows the
    // fight instead of a death screen. Real play is untouched.
    if (shotMode && !sim.player.alive) {
      sim.player.alive = true;
      sim.player.health = 100;
      for (let i = sim.events.length - 1; i >= 0; i--) {
        if (sim.events[i].type === 'playerDied') sim.events.splice(i, 1);
      }
    }
  }
  input.pressedKeys.clear();
  input.firePressed = false;
  input.crouchPressed = false;

  // --- Camera from the player. ---
  const p = sim.player;
  camera.position.set(p.x, p.eyeH, p.z);
  camera.rotation.y = p.yaw + p.yawKick;
  camera.rotation.x = p.pitch + p.pitchKick;
  const w = WEAPONS[p.weapon];
  const targetFov = p.ads ? PLAYER.fov / w.zoom : PLAYER.fov;
  fovCurrent += (targetFov - fovCurrent) * Math.min(1, dt * 14);
  if (Math.abs(camera.fov - fovCurrent) > 0.05) {
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }

  // --- Viewmodel follows the weapon and ADS state. ---
  if (viewmodelWeapon !== p.weapon) buildViewmodel(p.weapon);
  const vmTarget = p.ads ? { x: 0, y: -0.185, z: -0.32 } : { x: 0.24, y: -0.22, z: -0.45 };
  viewmodel.position.x += (vmTarget.x - viewmodel.position.x) * Math.min(1, dt * 14);
  viewmodel.position.y += (vmTarget.y - viewmodel.position.y) * Math.min(1, dt * 14);
  viewmodel.position.z += (vmTarget.z - viewmodel.position.z) * Math.min(1, dt * 14);
  viewmodel.scale.setScalar(0.8);
  viewmodel.visible = p.alive;

  // --- Bot meshes follow sim state. ---
  for (const bot of sim.bots) {
    const m = botMeshes.get(bot.id);
    if (!m) continue;
    m.group.position.set(bot.x, 0, bot.z);
    m.group.rotation.y = bot.yaw;
    if (!bot.alive) {
      if (!m.dead) {
        m.dead = true;
        m.group.rotation.x = -Math.PI / 2 + 0.15;
        m.group.position.y = 0.25;
        m.barBg.visible = false;
        m.barFg.visible = false;
      }
    } else {
      const h = Math.max(0.001, bot.health / 100);
      m.barFg.scale.x = 0.7 * h;
      m.barFg.position.x = -(0.7 * (1 - h)) / 2;
    }
  }

  // --- Bomb mesh. ---
  if (sim.bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(sim.bomb.x, 0.12, sim.bomb.z);
    const blink = (sim.time * 2) % 1 < 0.5;
    bombLight.visible = blink;
  } else {
    bombMesh.visible = false;
  }

  updateEffects(fx, sim, now, camera);
  updateHud(hud, now);
  renderer.render(scene, camera);
}

// Expose the sim for play-testing and debugging.
window.__game = { sim, input };

animate();
