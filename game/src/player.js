// player.js — the human player: movement, look, weapons, damage.
// Reads a plain `input` object (keys, mouse deltas, buttons) built by
// main.js. Emits shot events into sim.pendingShots; the sim resolves hits,
// so the player never decides its own damage.

import { PLAYER, WEAPONS, ECONOMY } from './config.js';
import { moveCircle } from './map.js';
import {
  makeWeaponState, canFire, fireShot, decayBloom,
  startReload, finishReload, throwGrenade, makeGrenade,
} from './weapons.js';
import * as audio from './audio.js';

export function createPlayer() {
  return {
    x: -28, z: 0, vx: 0, vz: 0,
    yaw: -Math.PI / 2, pitch: 0, // facing east (+x) at spawn
    pitchKick: 0, yawKick: 0,
    eyeH: PLAYER.eyeStand,
    health: PLAYER.health, alive: true,
    crouched: false, ads: false,
    weapon: 'pistol',
    weapons: { pistol: makeWeaponState('pistol') },
    grenades: 0,
    money: ECONOMY.start,
    kills: 0, deaths: 0,
    moveSpeed: 0,
    damageFlash: 0, damageDir: 0,
    defuseProgress: 0,
  };
}

// Reset at a round start. Survivors keep their weapons; the dead restart
// with a pistol, Counter-Strike style.
export function resetPlayerForRound(p, survived) {
  p.x = -28; p.z = 0; p.vx = 0; p.vz = 0;
  p.yaw = -Math.PI / 2; p.pitch = 0; p.pitchKick = 0; p.yawKick = 0;
  p.health = PLAYER.health;
  p.alive = true;
  p.crouched = false; p.ads = false;
  p.damageFlash = 0;
  p.defuseProgress = 0;
  if (!survived) {
    p.weapon = 'pistol';
    p.weapons = { pistol: makeWeaponState('pistol') };
    p.grenades = 0;
  } else {
    // Survivors keep what they had, topped up on pistol ammo.
    for (const st of Object.values(p.weapons)) st.reloading = false;
  }
}

export function giveWeapon(p, id) {
  if (!p.weapons[id]) p.weapons[id] = makeWeaponState(id);
  p.weapon = id;
}

// Forward/right vectors in (x, z) for a yaw. Yaw -PI/2 faces +x (east).
export function forwardOf(yaw) {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
export function rightOf(yaw) {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

export function updatePlayer(p, input, dt, now, sim) {
  if (!p.alive) return;

  // --- Look (mouse deltas are consumed here). ---
  const sens = 0.0022 * (p.ads ? 0.6 : 1);
  p.yaw -= input.mouseDX * sens;
  p.pitch -= input.mouseDY * sens;
  p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch));
  input.mouseDX = 0;
  input.mouseDY = 0;

  // --- Crouch: C toggles, Ctrl holds. (crouchPressed is consumed here.) ---
  if (input.crouchPressed) {
    p.crouched = !p.crouched;
    input.crouchPressed = false;
  }
  if (input.keys.has('ControlLeft')) p.crouched = true;
  const targetEye = p.crouched ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  p.eyeH += (targetEye - p.eyeH) * Math.min(1, dt * 12);

  // --- ADS: right mouse, only while the weapon is up. ---
  p.ads = input.adsHeld && !p.weapons[p.weapon].reloading;

  // --- Movement: acceleration + friction, speed cap by weapon/crouch/ADS. ---
  const w = WEAPONS[p.weapon];
  let maxSpeed = w.moveSpeed;
  if (p.crouched) maxSpeed *= PLAYER.crouchMul;
  if (p.ads) maxSpeed *= PLAYER.adsMul;
  const [fx, fz] = forwardOf(p.yaw);
  const [rx, rz] = rightOf(p.yaw);
  let wx = 0, wz = 0;
  if (input.keys.has('KeyW')) { wx += fx; wz += fz; }
  if (input.keys.has('KeyS')) { wx -= fx; wz -= fz; }
  if (input.keys.has('KeyD')) { wx += rx; wz += rz; }
  if (input.keys.has('KeyA')) { wx -= rx; wz -= rz; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl; wz /= wl;
    p.vx += wx * PLAYER.accel * dt;
    p.vz += wz * PLAYER.accel * dt;
  }
  // Friction.
  const fr = Math.max(0, 1 - PLAYER.friction * dt);
  p.vx *= fr;
  p.vz *= fr;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > maxSpeed) {
    p.vx *= maxSpeed / sp;
    p.vz *= maxSpeed / sp;
  }
  const [nx, nz] = moveCircle(p.x, p.z, p.vx * dt, p.vz * dt, PLAYER.radius);
  p.x = nx; p.z = nz;
  p.moveSpeed = Math.hypot(p.vx, p.vz);

  // --- Recoil recovery (the kick springs back; the player pulls down). ---
  p.pitchKick *= Math.max(0, 1 - dt * 6);
  p.yawKick *= Math.max(0, 1 - dt * 6);

  // --- Weapon state. ---
  const st = p.weapons[p.weapon];
  decayBloom(st, w, dt);
  if (st.reloading && now >= st.reloadEnd) {
    finishReload(st, w);
    audio.playReload();
  }

  // --- Weapon switching (1/2/3). ---
  for (const [key, id] of [['Digit1', 'rifle'], ['Digit2', 'sniper'], ['Digit3', 'pistol']]) {
    if (input.pressedKeys.has(key) && p.weapons[id] && p.weapon !== id) {
      p.weapon = id;
      p.ads = false;
      audio.playClick();
    }
  }

  // --- Reload (R, or auto on empty). ---
  if (input.pressedKeys.has('KeyR')) startReload(st, w, now);

  // --- Fire. (Only once the round is live: no shooting in freeze time.) ---
  const canShootPhase = sim.match.phase === 'live' || sim.match.phase === 'planted';
  const wantFire = w.auto ? input.fireHeld : input.firePressed;
  if (wantFire && !st.reloading && canShootPhase) {
    if (canFire(st, w, now)) {
      const { spread, recoil } = fireShot(st, w, now, p.moveSpeed, false, p.ads);
      // Shot direction: camera forward plus a random cone of `spread`.
      const a = Math.random() * Math.PI * 2;
      const r = (spread * Math.PI / 180) * Math.sqrt(Math.random());
      const yawOff = Math.cos(a) * r;
      const pitchOff = Math.sin(a) * r;
      const yaw = p.yaw + yawOff;
      const pitch = p.pitch + p.pitchKick + pitchOff;
      const cp = Math.cos(pitch);
      sim.pendingShots.push({
        ox: p.x, oy: p.eyeH, oz: p.z,
        dx: -Math.sin(yaw) * cp, dy: Math.sin(pitch), dz: -Math.cos(yaw) * cp,
        weapon: p.weapon, shooter: p, range: w.range,
      });
      p.pitchKick += recoil * Math.PI / 180;
      p.yawKick += (Math.random() - 0.5) * recoil * 0.4 * Math.PI / 180;
      sim.noiseEvents.push({ x: p.x, z: p.z, t: now, radius: 26 });
      audio.playShot(p.weapon);
      sim.effects.push({ type: 'muzzle', x: p.x, y: p.eyeH, z: p.z, yaw: p.yaw, t: now });
    } else if (st.mag === 0 && now - st.lastShot > 0.25) {
      audio.playDryFire();
      startReload(st, w, now);
    }
  }

  // --- Grenade (G or 4). ---
  if ((input.pressedKeys.has('KeyG') || input.pressedKeys.has('Digit4')) && p.grenades > 0 && canShootPhase) {
    const g = makeGrenade();
    const cp = Math.cos(p.pitch);
    throwGrenade(
      g, p.x, p.eyeH - 0.15, p.z,
      -Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp,
    );
    sim.grenades.push(g);
    p.grenades -= 1;
    audio.playClick();
  }

  // --- Damage flash decay. ---
  p.damageFlash = Math.max(0, p.damageFlash - dt * 2.2);
}

export function damagePlayer(p, amount, fromX, fromZ, sim) {
  if (!p.alive) return;
  p.health -= amount;
  p.damageFlash = 1;
  // Direction of the damage relative to where the player looks (for the HUD).
  const ang = Math.atan2(fromZ - p.z, fromX - p.x);
  const fwd = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
  p.damageDir = ang - fwd;
  audio.playHurt();
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    p.deaths += 1;
    sim.events.push({ type: 'playerDied', t: sim.time });
  }
}
