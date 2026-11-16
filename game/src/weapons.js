// weapons.js — weapon behaviour: fire gating, spread, recoil, damage,
// grenade physics. Pure functions over plain weapon-state objects, so the
// player and the bots share exactly the same gunplay model.

import { WEAPONS, GRENADE } from './config.js';

export function makeWeaponState(id) {
  const w = WEAPONS[id];
  return {
    id,
    mag: w.mag,
    reserve: w.reserve,
    lastShot: -10,
    bloom: 0, // accumulated spread (degrees) from sustained fire
    reloading: false,
    reloadEnd: 0,
  };
}

// Current spread half-angle in degrees. Movement, bloom and ADS all feed it:
// stopping to aim pays, spraying on the move does not.
export function currentSpread(w, moveSpeed, airborne, ads, bloomDeg) {
  let s = w.spread + bloomDeg;
  s += moveSpeed * 0.28; // ~+1.4 deg at full sprint
  if (airborne) s += 1.5;
  if (ads) s *= 0.35;
  return Math.min(s, w.spreadMax + 1.5);
}

export function canFire(st, w, now) {
  if (st.reloading) return false;
  if (st.mag <= 0) return false;
  return now - st.lastShot >= 60 / w.rpm;
}

// Fire one shot. Returns the shot's spread (degrees) and applies bloom and
// recoil to the shooter's state. Caller does the raycast.
export function fireShot(st, w, now, moveSpeed, airborne, ads) {
  st.mag -= 1;
  st.lastShot = now;
  const spread = currentSpread(w, moveSpeed, airborne, ads, st.bloom);
  st.bloom = Math.min(st.bloom + w.spreadPerShot, w.spreadMax);
  return { spread, recoil: w.recoil };
}

// Bloom decays when not firing (called every sim step).
export function decayBloom(st, w, dt) {
  st.bloom = Math.max(0, st.bloom - dt * 3.2);
}

export function startReload(st, w, now) {
  if (st.reloading || st.mag === w.mag || st.reserve <= 0) return false;
  st.reloading = true;
  st.reloadEnd = now + w.reload;
  return true;
}

export function finishReload(st, w) {
  const need = w.mag - st.mag;
  const take = Math.min(need, st.reserve);
  st.mag += take;
  st.reserve -= take;
  st.reloading = false;
}

// Damage at range with a headshot multiplier. Full damage inside the
// falloff distance, then a linear fall to half damage at max range.
export function damageAtRange(w, dist, isHead) {
  let d = w.damage * (isHead ? w.headMul : 1);
  if (dist > w.falloff) {
    const t = Math.min(1, (dist - w.falloff) / Math.max(1, w.range - w.falloff));
    d *= 1 - 0.5 * t;
  }
  return d;
}

// --- Grenades: one shared physics model for player and bots. ---

export function makeGrenade() {
  return {
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    fuse: 0,
    exploded: false,
  };
}

// Throw from (x, y, z) along a direction (unit) with an upward lob.
export function throwGrenade(g, x, y, z, dx, dy, dz) {
  g.active = true;
  g.exploded = false;
  g.x = x; g.y = y; g.z = z;
  g.vx = dx * GRENADE.throwSpeed;
  g.vy = dy * GRENADE.throwSpeed + 4.5;
  g.vz = dz * GRENADE.throwSpeed;
  g.fuse = GRENADE.fuse;
}

// Step grenade physics. moveCircle is the map's collision resolver.
// Returns 'explode' on the step the fuse runs out, else null.
export function stepGrenade(g, dt, moveCircle, radius) {
  if (!g.active || g.exploded) return null;
  g.vy -= 22 * dt; // gravity
  const [nx, nz] = moveCircle(g.x, g.z, g.vx * dt, g.vz * dt, radius);
  // A blocked axis bounces the velocity back, damped.
  if (nx !== g.x + g.vx * dt) g.vx *= -0.45;
  if (nz !== g.z + g.vz * dt) g.vz *= -0.45;
  g.x = nx;
  g.z = nz;
  g.y += g.vy * dt;
  if (g.y < 0.15) {
    g.y = 0.15;
    g.vy = Math.abs(g.vy) > 1 ? -g.vy * 0.45 : 0;
    g.vx *= 0.7;
    g.vz *= 0.7;
  }
  g.fuse -= dt;
  if (g.fuse <= 0) {
    g.exploded = true;
    g.active = false;
    return 'explode';
  }
  return null;
}

// Explosion damage at a target position. Walls between the blast and the
// target halve the damage (hasLineOfSight from the map module).
export function explosionDamage(gx, gy, gz, tx, ty, tz, hasLineOfSight) {
  const d = Math.hypot(tx - gx, ty - gy, tz - gz);
  if (d > GRENADE.radius) return 0;
  let dmg = GRENADE.damage * (1 - (d / GRENADE.radius) * 0.6);
  if (!hasLineOfSight(gx, gz, tx, tz)) dmg *= 0.5;
  return dmg;
}
