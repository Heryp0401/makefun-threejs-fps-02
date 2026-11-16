// bots.js — bot AI: roles, A* routing, perception, combat, bomb play.
// The sim owns bot state; this module owns the decisions. Bots see through
// the same rules as the player: a vision cone, line of sight on the grid,
// hearing for gunshots. Nothing here reads the renderer's scene.

import { BOT, WAYPOINTS, SITES, ROUND, WEAPONS } from './config.js';
import { navGrid, hasLineOfSight, moveCircle, inSite } from './map.js';
import {
  makeWeaponState, canFire, startReload, finishReload,
} from './weapons.js';
import * as audio from './audio.js';

const CT_NAMES = ['Ash', 'Brick', 'Cinder', 'Dusk'];
const T_NAMES = ['Ember', 'Flint', 'Gage', 'Havoc', 'Ivo'];

const CT_ROLES = ['aHold', 'bHold', 'mid', 'rotator'];
const T_ROLES = ['planter', 'rusher', 'rusher', 'sniper', 'lurker'];

// Where each role waits when it has nothing to do (waypoint key + watch yaw).
const HOLD_SPOTS = {
  aHold: { wp: 'aSite', yaw: Math.PI / 2 }, // faces south, down A long
  bHold: { wp: 'bSite', yaw: -Math.PI / 2 }, // faces north, down B tunnel
  mid: { wp: 'ctMid', yaw: -Math.PI / 2 }, // faces east, down mid
  rotator: { wp: 'mid', yaw: -Math.PI / 2 },
  sniper: { wp: 'aLong', yaw: Math.PI / 2 }, // faces south along A long
};

export function createBots() {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    bots.push(makeBot(i, 'CT', CT_NAMES[i], CT_ROLES[i]));
  }
  for (let i = 0; i < 5; i++) {
    bots.push(makeBot(4 + i, 'T', T_NAMES[i], T_ROLES[i]));
  }
  return bots;
}

function makeBot(id, team, name, role) {
  const weapon = role === 'sniper' ? 'sniper' : 'rifle';
  const wstate = makeWeaponState(weapon);
  wstate.reserve = 999; // bots do not run out of reserve
  return {
    id, name, team, role,
    x: 0, z: 0, yaw: 0,
    health: BOT.health, alive: true,
    weapon, wstate,
    state: 'route',
    path: [], pathIdx: 0,
    dest: null, destKey: null,
    target: null, reactUntil: 0, lastSeenAt: -10,
    burstLeft: 0, burstPauseUntil: 0,
    thinkAt: 0.05 * id,
    hasBomb: role === 'planter',
    channel: 0, // plant/defuse progress (seconds)
    strafeDir: 1, strafeUntil: 0,
    skill: 0.85 + Math.random() * 0.3, // aim/reaction multiplier
    investigate: null,
  };
}

// Reset at a round start: positions, health, routes. The T side picks a
// site for this round (stored on the sim).
export function resetBotsForRound(bots, sim) {
  const spawns = { CT: [[-28, -6], [-28, 0], [-28, 6], [-26, -10]], T: [[28, -6], [28, 0], [28, 6], [26, -10], [26, 10]] };
  const site = Math.random() < 0.5 ? 'A' : 'B';
  sim.tSite = site;
  for (const b of bots) {
    const list = spawns[b.team];
    const s = list[b.id % list.length];
    b.x = s[0];
    b.z = s[1];
    b.yaw = b.team === 'CT' ? -Math.PI / 2 : Math.PI / 2;
    b.health = BOT.health;
    b.alive = true;
    b.state = 'route';
    b.path = [];
    b.pathIdx = 0;
    b.dest = null;
    b.destKey = null;
    b.target = null;
    b.reactUntil = 0;
    b.channel = 0;
    b.burstLeft = 0;
    b.burstPauseUntil = 0;
    b.investigate = null;
    b.wstate = makeWeaponState(b.weapon);
    b.wstate.reserve = 999;
    b.skill = 0.85 + Math.random() * 0.3;
    if (b.role === 'planter') b.hasBomb = true;
  }
}

// --- Perception -----------------------------------------------------------

function canSee(bot, ex, ez, eyeY, sim) {
  const dx = ex - bot.x;
  const dz = ez - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BOT.visionRange) return 0;
  // Vision cone around the bot's facing.
  const ang = Math.atan2(dz, dx);
  const fwd = Math.atan2(-Math.cos(bot.yaw), -Math.sin(bot.yaw));
  let diff = ang - fwd;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > (BOT.visionHalfAngle * Math.PI) / 180) return 0;
  if (!hasLineOfSight(bot.x, bot.z, ex, ez)) return 0;
  return dist;
}

function nearestVisibleEnemy(bot, sim) {
  let best = null;
  let bestD = Infinity;
  const consider = (obj, isPlayer) => {
    if (!obj.alive) return;
    const d = canSee(bot, obj.x, obj.z, 0, sim);
    if (d > 0 && d < bestD) {
      bestD = d;
      best = { obj, isPlayer, dist: d };
    }
  };
  if (bot.team !== sim.player.team) consider(sim.player, true);
  for (const o of sim.bots) {
    if (o.team !== bot.team) consider(o, false);
  }
  return best;
}

// --- Routing ---------------------------------------------------------------

function routeTo(bot, tx, tz, key) {
  if (bot.destKey === key && bot.path.length > 0) return;
  bot.destKey = key;
  bot.dest = [tx, tz];
  bot.pathIdx = 0;
  navGrid.findPath(bot.x, bot.z, tx, tz, bot.path);
}

function routeToWaypoint(bot, key) {
  const wp = WAYPOINTS[key];
  if (wp) routeTo(bot, wp[0], wp[1], key);
}

// --- Decisions (10 Hz, staggered per bot) ---------------------------------

function think(bot, sim, now) {
  // Objective first: a bomb carrier standing inside its site plants, and a
  // CT standing on a planted bomb defuses — even if an enemy is visible.
  // (Without this, a planter that can see a defender fights forever and
  // the round never gets a plant; same for a retaker on the bomb.)
  if (bot.team === 'T' && bot.hasBomb && sim.bomb.state !== 'planted' && inSite(bot.x, bot.z, sim.tSite)) {
    bot.state = 'plant';
    bot.target = null;
    bot.reactUntil = 0;
    return;
  }
  if (bot.team === 'CT' && sim.bomb.state === 'planted') {
    const d = Math.hypot(bot.x - sim.bomb.x, bot.z - sim.bomb.z);
    if (d < 2.2) {
      bot.state = 'defuse';
      bot.target = null;
      bot.reactUntil = 0;
      return;
    }
  }

  const vis = nearestVisibleEnemy(bot, sim);
  if (vis) {
    bot.target = vis;
    bot.lastSeenAt = now;
    if (bot.reactUntil === 0) {
      bot.reactUntil = now + (BOT.reactionMin + Math.random() * (BOT.reactionMax - BOT.reactionMin)) * bot.skill;
    }
    bot.state = 'engage';
    return;
  }
  bot.target = null;
  bot.reactUntil = 0;

  // Hearing: a recent gunshot nearby turns the bot toward the noise.
  const noise = sim.noiseEvents[sim.noiseEvents.length - 1];
  if (noise && now - noise.t < 1.5) {
    const d = Math.hypot(noise.x - bot.x, noise.z - bot.z);
    if (d < BOT.hearRadius && (bot.role === 'rotator' || bot.role === 'lurker')) {
      bot.investigate = [noise.x, noise.z];
    }
  }

  const bomb = sim.bomb;
  if (bomb.state === 'planted') {
    if (bot.team === 'T') {
      // Defend the planted bomb: hold near its site.
      const s = SITES[bomb.site];
      const d = Math.hypot(bot.x - s.x, bot.z - s.z);
      if (d > 7) routeTo(bot, s.x, s.z, 'defend' + bomb.site);
      else bot.state = 'hold';
    } else {
      // Retake: route to the bomb, defuse when on top of it.
      const d = Math.hypot(bot.x - bomb.x, bot.z - bomb.z);
      if (d < 2.2) {
        bot.state = 'defuse';
      } else {
        routeTo(bot, bomb.x, bomb.z, 'retake');
        bot.state = 'route';
      }
    }
    return;
  }

  if (bot.team === 'T') {
    const site = sim.tSite;
    if (bot.hasBomb) {
      // Whoever carries the bomb pushes the target site, whatever their role.
      routeToWaypoint(bot, site === 'A' ? 'aConnector' : 'bConnector');
      if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) {
        routeToWaypoint(bot, site === 'A' ? 'aSite' : 'bSite');
      }
    } else if (bot.role === 'sniper') {
      if (bot.state !== 'hold') {
        routeToWaypoint(bot, 'aLong');
        if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) bot.state = 'hold';
      }
    } else if (bot.role === 'lurker') {
      const other = site === 'A' ? 'B' : 'A';
      routeToWaypoint(bot, other === 'A' ? 'aConnector' : 'bConnector');
      if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) {
        routeToWaypoint(bot, other === 'A' ? 'aSite' : 'bSite');
      }
    } else {
      // Rushers: mid, then the site.
      if (bot.destKey !== 'mid' && bot.destKey !== 'aSite' && bot.destKey !== 'bSite') {
        routeToWaypoint(bot, 'mid');
      }
      if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) {
        routeToWaypoint(bot, site === 'A' ? 'aSite' : 'bSite');
      }
    }
    bot.state = bot.state === 'plant' ? 'plant' : 'route';
    return;
  }

  // CT side: hold assigned spots; the rotator investigates noise.
  if (bot.investigate && bot.role === 'rotator') {
    routeTo(bot, bot.investigate[0], bot.investigate[1], 'investigate');
    if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) bot.investigate = null;
    bot.state = 'route';
    return;
  }
  const spot = HOLD_SPOTS[bot.role];
  if (spot) {
    const wp = WAYPOINTS[spot.wp];
    const d = Math.hypot(bot.x - wp[0], bot.z - wp[1]);
    if (d > 1.2) {
      routeToWaypoint(bot, spot.wp);
      bot.state = 'route';
    } else {
      bot.state = 'hold';
      bot.yaw = spot.yaw;
    }
  }
}

// --- Per-step update ---------------------------------------------------------

export function updateBot(bot, sim, dt, now) {
  if (!bot.alive) return;
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.1;
    think(bot, sim, now);
  }

  const st = bot.wstate;
  const wdef = WEAPONS[bot.weapon];
  if (st.reloading && now >= st.reloadEnd) finishReload(st, wdef);

  // Plant / defuse channels: standing still, progress ticks.
  if (bot.state === 'plant') {
    bot.channel += dt;
    if (bot.channel >= ROUND.plantTime) {
      bot.channel = 0;
      bot.state = 'hold';
      sim.plantBomb(bot, sim.tSite);
    }
    return;
  }
  if (bot.state === 'defuse') {
    bot.channel += dt;
    if (bot.channel >= ROUND.defuseTime) {
      bot.channel = 0;
      bot.state = 'hold';
      sim.defuseBomb(bot);
    }
    return;
  }

  // Movement.
  let mx = 0, mz = 0;
  let speed = BOT.speed;
  if (bot.state === 'engage' && bot.target) {
    // Strafe perpendicular to the enemy, flipping direction regularly.
    if (now >= bot.strafeUntil) {
      bot.strafeDir *= -1;
      bot.strafeUntil = now + 0.7 + Math.random() * 0.8;
    }
    const t = bot.target.obj;
    const dx = t.x - bot.x;
    const dz = t.z - bot.z;
    const d = Math.hypot(dx, dz) || 1;
    const px = -dz / d * bot.strafeDir;
    const pz = dx / d * bot.strafeDir;
    mx = px; mz = pz;
    speed = BOT.speed * 0.55;
    bot.yaw = Math.atan2(-dx, -dz); // face the enemy
  } else if (bot.path.length > 0 && bot.pathIdx < bot.path.length) {
    const [wx, wz] = bot.path[bot.pathIdx];
    const dx = wx - bot.x;
    const dz = wz - bot.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      bot.pathIdx++;
    } else {
      mx = dx / d; mz = dz / d;
      bot.yaw = Math.atan2(-dx, -dz); // face along the path
    }
  }
  if (mx !== 0 || mz !== 0) {
    const [nx, nz] = moveCircle(bot.x, bot.z, mx * speed * dt, mz * speed * dt, BOT.radius);
    bot.x = nx; bot.z = nz;
  }

  // Combat: fire in bursts once reacted.
  if (bot.state === 'engage' && bot.target && now >= bot.reactUntil) {
    const t = bot.target.obj;
    const dist = bot.target.dist;
    if (now >= bot.burstPauseUntil) {
      if (bot.burstLeft <= 0) bot.burstLeft = BOT.burstMin + ((Math.random() * (BOT.burstMax - BOT.burstMin)) | 0);
      if (canFire(st, wdef, now)) {
        const spreadDeg = (BOT.aimBase + BOT.aimPerMetre * dist) * bot.skill;
        const a = Math.random() * Math.PI * 2;
        const r = (spreadDeg * Math.PI / 180) * Math.sqrt(Math.random());
        // Aim at the chest (y ~1.2), sometimes the head.
        const aimY = Math.random() < 0.12 ? 1.55 : 1.2;
        const dx = t.x - bot.x;
        const dy = aimY - BOT.eyeHeight;
        const dz = t.z - bot.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        // Apply the angular error in the horizontal plane (dominant term).
        const baseYaw = Math.atan2(dx, dz);
        const errYaw = baseYaw + Math.cos(a) * r;
        const errPitch = Math.asin(Math.max(-1, Math.min(1, dy / len))) + Math.sin(a) * r;
        const cp = Math.cos(errPitch);
        st.mag -= 1;
        st.lastShot = now;
        sim.pendingShots.push({
          ox: bot.x, oy: BOT.eyeHeight, oz: bot.z,
          dx: Math.sin(errYaw) * cp, dy: Math.sin(errPitch), dz: Math.cos(errYaw) * cp,
          weapon: bot.weapon, shooter: bot, range: bot.weapon === 'sniper' ? 120 : 60,
        });
        bot.burstLeft -= 1;
        sim.noiseEvents.push({ x: bot.x, z: bot.z, t: now, radius: 22 });
        if (dist < 30) audio.playDistantShot();
        if (bot.burstLeft <= 0) bot.burstPauseUntil = now + 0.5 + Math.random() * 0.5;
      } else if (st.mag === 0) {
        startReload(st, wdef, now);
      }
    }
  } else if (st.mag === 0) {
    startReload(st, wdef, now);
  }
}

// Damage a bot. Returns true when the bot dies.
export function damageBot(bot, amount, sim, attacker) {
  if (!bot.alive) return false;
  bot.health -= amount;
  if (bot.health <= 0) {
    bot.health = 0;
    bot.alive = false;
    bot.state = 'dead';
    if (bot.hasBomb) {
      // The bomb drops where the planter died; a teammate picks it up.
      bot.hasBomb = false;
      const mates = sim.bots.filter((b) => b.alive && b.team === 'T' && b.role !== 'planter');
      if (mates.length > 0) mates[0].hasBomb = true;
      sim.events.push({ type: 'bombDropped', x: bot.x, z: bot.z, t: sim.time });
    }
    sim.events.push({
      type: 'kill', attacker: attacker && attacker.name ? attacker.name : 'You',
      victim: bot.name, victimTeam: bot.team, t: sim.time,
    });
    return true;
  }
  return false;
}
