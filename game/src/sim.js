// sim.js — the fixed-step simulation core. One state object, one step
// function, no rendering here. The renderer reads state; it never writes
// gameplay. Combat resolution (raycasts) lives here so the player and the
// bots are judged by exactly the same hit rules.

import { SIM_DT, ROUND, ECONOMY, WEAPONS, BOT, PLAYER } from './config.js';
import { WALLS, hasLineOfSight } from './map.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
import { createBots, updateBot, damageBot } from './bots.js';
import {
  createMatch, startMatch, updateMatch, plantBomb, defuseBomb, playerDefuseTick,
} from './rounds.js';
import { damageAtRange, stepGrenade, explosionDamage } from './weapons.js';
import { moveCircle } from './map.js';
import * as audio from './audio.js';

export function createSim(input) {
  const sim = {
    input,
    time: 0,
    tick: 0,
    player: createPlayer(),
    bots: createBots(),
    match: createMatch(),
    bomb: { state: 'carried', site: null, x: 0, z: 0, timer: 0, carrier: null },
    grenades: [],
    pendingShots: [],
    noiseEvents: [],
    events: [],
    effects: [],
    tSite: 'A',
  };
  sim.player.team = 'CT';
  // Bound helpers so bots and rounds call back into this sim.
  sim.plantBomb = (bot, site) => plantBomb(sim, bot, site);
  sim.defuseBomb = (bot) => defuseBomb(sim, bot);
  sim.startMatch = () => startMatch(sim);
  return sim;
}

export function stepSim(sim, dt) {
  sim.time += dt;
  sim.tick += 1;
  const phase = sim.match.phase;

  updateMatch(sim, dt);

  const active = phase === 'freeze' || phase === 'live' || phase === 'planted';
  if (active) {
    updatePlayer(sim.player, sim.input, dt, sim.time, sim);
    for (const bot of sim.bots) updateBot(bot, sim, dt, sim.time);
  }

  resolveShots(sim);
  stepGrenades(sim, dt);
  playerDefuseTick(sim, dt);

  // Prune stale noise and events so the lists stay bounded.
  const now = sim.time;
  sim.noiseEvents = sim.noiseEvents.filter((n) => now - n.t < 2);
  if (sim.events.length > 40) sim.events.splice(0, sim.events.length - 40);
  if (sim.effects.length > 60) sim.effects.splice(0, sim.effects.length - 60);
}

// --- Raycasts (slab method, no allocation) --------------------------------

function rayAABB(ox, oy, oz, dx, dy, dz, x1, y1, z1, x2, y2, z2) {
  let tmin = 0;
  let tmax = Infinity;
  // X slab.
  if (Math.abs(dx) < 1e-9) {
    if (ox < x1 || ox > x2) return Infinity;
  } else {
    let t1 = (x1 - ox) / dx;
    let t2 = (x2 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Y slab.
  if (Math.abs(dy) < 1e-9) {
    if (oy < y1 || oy > y2) return Infinity;
  } else {
    let t1 = (y1 - oy) / dy;
    let t2 = (y2 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Z slab.
  if (Math.abs(dz) < 1e-9) {
    if (oz < z1 || oz > z2) return Infinity;
  } else {
    let t1 = (z1 - oz) / dz;
    let t2 = (z2 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Nearest wall/floor distance along the ray (Infinity when nothing).
function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  if (dy < -1e-9) {
    const t = -oy / dy; // floor y = 0
    if (t > 0 && t < best) best = t;
  }
  for (const [x1, z1, x2, z2, h] of WALLS) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, x1, 0, z1, x2, h, z2);
    if (t < best) best = t;
  }
  return best;
}

// --- Shot resolution --------------------------------------------------------

function resolveShots(sim) {
  for (const shot of sim.pendingShots) {
    resolveShot(sim, shot);
  }
  sim.pendingShots.length = 0;
}

function resolveShot(sim, shot) {
  const w = WEAPONS[shot.weapon];
  const wallT = rayWorld(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, shot.range);
  let bestT = wallT;
  let bestTarget = null;
  let bestHead = false;

  const consider = (obj, isPlayer) => {
    if (!obj.alive) return;
    if (obj === shot.shooter) return;
    if (obj.team === shot.shooter.team) return; // no friendly fire
    const eyeY = isPlayer ? obj.eyeH : BOT.eyeHeight;
    // Head sphere first (it is the smaller, higher-value target).
    const headT = raySphere(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz,
      obj.x, eyeY - 0.07, obj.z, 0.24);
    if (headT < bestT) {
      bestT = headT;
      bestTarget = obj;
      bestHead = true;
      return;
    }
    const bodyT = rayAABB(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz,
      obj.x - 0.38, 0, obj.z - 0.38, obj.x + 0.38, eyeY, obj.z + 0.38);
    if (bodyT < bestT) {
      bestT = bodyT;
      bestTarget = obj;
      bestHead = false;
    }
  };

  consider(sim.player, true);
  for (const bot of sim.bots) consider(bot, false);

  const hx = shot.ox + shot.dx * bestT;
  const hy = shot.oy + shot.dy * bestT;
  const hz = shot.oz + shot.dz * bestT;
  sim.effects.push({
    type: 'tracer',
    x0: shot.ox, y0: shot.oy, z0: shot.oz,
    x1: hx, y1: hy, z1: hz, t: sim.time,
  });

  if (bestTarget) {
    const dmg = damageAtRange(w, bestT, bestHead);
    const isPlayerShooter = shot.shooter === sim.player;
    if (bestTarget === sim.player) {
      damagePlayer(sim.player, dmg, shot.ox, shot.oz, sim);
    } else {
      const died = damageBot(bestTarget, dmg, sim, shot.shooter);
      if (died && isPlayerShooter) {
        sim.player.money += ECONOMY.kill;
        sim.player.kills += 1;
        audio.playKill();
      }
    }
    if (isPlayerShooter) {
      sim.events.push({ type: 'hit', head: bestHead, kill: bestTarget.health <= 0, t: sim.time });
      if (bestHead) audio.playHeadshot();
      else audio.playHit();
    }
  } else if (bestT < shot.range) {
    sim.effects.push({ type: 'impact', x: hx, y: hy, z: hz, t: sim.time });
  }
}

// --- Grenades ---------------------------------------------------------------

function stepGrenades(sim, dt) {
  for (const g of sim.grenades) {
    const res = stepGrenade(g, dt, moveCircle, 0.15);
    if (res === 'explode') {
      sim.effects.push({ type: 'explosion', x: g.x, y: g.y, z: g.z, t: sim.time });
      const dPlayer = Math.hypot(sim.player.x - g.x, sim.player.z - g.z);
      if (dPlayer < 40) audio.playExplosion();
      // Damage everyone in the blast (no friendly-fire exemption: a bad
      // throw hurts your own side, like the real thing).
      const blast = (obj, isPlayer) => {
        if (!obj.alive) return;
        const dmg = explosionDamage(g.x, g.y, g.z, obj.x, isPlayer ? obj.eyeH * 0.6 : 1.0, obj.z, hasLineOfSight);
        if (dmg <= 0) return;
        if (isPlayer) damagePlayer(obj, dmg, g.x, g.z, sim);
        else damageBot(obj, dmg, sim, null);
      };
      blast(sim.player, true);
      for (const bot of sim.bots) blast(bot, false);
      sim.noiseEvents.push({ x: g.x, z: g.z, t: sim.time, radius: 30 });
    }
  }
  sim.grenades = sim.grenades.filter((g) => g.active);
}

export { SIM_DT };
