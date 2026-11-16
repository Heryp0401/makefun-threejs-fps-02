// rounds.js — the round and match state machine, plus the economy.
// One place owns the phase transitions so the sim never has two ideas
// about what a round is doing.
//
// Phases: menu -> freeze -> live -> (planted) -> roundEnd -> freeze ...
//          -> matchEnd (first to ROUND.winRounds, max ROUND.maxRounds).
// A round ends by elimination, explosion, defusal, or the clock.

import { ROUND, ECONOMY, WEAPONS, GRENADE } from './config.js';
import { resetPlayerForRound } from './player.js';
import { resetBotsForRound } from './bots.js';
import { makeWeaponState } from './weapons.js';
import * as audio from './audio.js';

export function createMatch() {
  return {
    phase: 'menu',
    round: 1,
    score: { CT: 0, T: 0 },
    phaseTime: 0, // seconds left in this phase
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    buyOpen: false,
  };
}

export function startMatch(sim) {
  const m = sim.match;
  m.phase = 'freeze';
  m.round = 1;
  m.score = { CT: 0, T: 0 };
  m.roundWinner = null;
  m.matchWinner = null;
  m.phaseTime = ROUND.freeze;
  startRound(sim);
}

export function startRound(sim) {
  const m = sim.match;
  const playerSurvived = sim.player.alive && m.round > 1;
  resetPlayerForRound(sim.player, playerSurvived);
  resetBotsForRound(sim.bots, sim);
  sim.bomb = { state: 'carried', site: null, x: 0, z: 0, timer: 0, carrier: null };
  sim.grenades = [];
  sim.pendingShots = [];
  sim.noiseEvents = [];
  m.phaseTime = ROUND.freeze;
  m.phase = 'freeze';
  m.roundWinner = null;
  m.roundReason = '';
  sim.events.push({ type: 'roundStart', round: m.round, t: sim.time });
}

function endRound(sim, winner, reason) {
  const m = sim.match;
  if (m.phase === 'roundEnd' || m.phase === 'matchEnd') return;
  m.phase = 'roundEnd';
  m.phaseTime = ROUND.intermission;
  m.roundWinner = winner;
  m.roundReason = reason;
  m.score[winner] += 1;
  // Economy: the winning side is paid (kills are paid at kill time, in sim).
  if (winner === 'CT') {
    sim.player.money += ECONOMY.win;
    audio.playRoundWin();
  } else {
    sim.player.money += ECONOMY.loss;
    audio.playRoundLose();
  }
  sim.events.push({ type: 'roundEnd', winner, reason, t: sim.time });
}

export function updateMatch(sim, dt) {
  const m = sim.match;
  if (m.phase === 'menu' || m.phase === 'matchEnd') return;
  m.phaseTime -= dt;

  if (m.phase === 'freeze') {
    if (m.phaseTime <= 0) {
      m.phase = 'live';
      m.phaseTime = ROUND.duration;
      sim.events.push({ type: 'roundLive', t: sim.time });
    }
    return;
  }

  if (m.phase === 'live' || m.phase === 'planted') {
    // Bomb fuse.
    if (m.phase === 'planted') {
      sim.bomb.timer -= dt;
      if (sim.bomb.timer <= 0) {
        sim.bomb.state = 'exploded';
        sim.events.push({ type: 'bombExploded', t: sim.time });
        audio.playExplosion();
        endRound(sim, 'T', 'Bomb detonated at site ' + sim.bomb.site);
        return;
      }
    }
    // Elimination check.
    const ctAlive = sim.bots.some((b) => b.alive && b.team === 'CT') || sim.player.alive;
    const tAlive = sim.bots.some((b) => b.alive && b.team === 'T');
    if (!tAlive) {
      endRound(sim, 'CT', 'Raiders eliminated');
      return;
    }
    if (!ctAlive) {
      // If the bomb is planted the round continues until it blows or is defused.
      if (m.phase !== 'planted') {
        endRound(sim, 'T', 'Wardens eliminated');
        return;
      }
    }
    // Clock.
    if (m.phaseTime <= 0) {
      if (m.phase === 'planted') {
        // Fuse outlives the clock: the round is decided by the fuse, not
        // the clock — keep playing until the bomb resolves.
        m.phaseTime = 0.01;
      } else {
        endRound(sim, 'CT', 'Time expired — site held');
        return;
      }
    }
    return;
  }

  if (m.phase === 'roundEnd') {
    if (m.phaseTime <= 0) {
      if (m.score.CT >= ROUND.winRounds || m.score.T >= ROUND.winRounds || m.round >= ROUND.maxRounds) {
        m.phase = 'matchEnd';
        m.matchWinner = m.score.CT > m.score.T ? 'CT' : m.score.T > m.score.CT ? 'T' : 'CT';
        sim.events.push({ type: 'matchEnd', winner: m.matchWinner, t: sim.time });
      } else {
        m.round += 1;
        startRound(sim);
      }
    }
  }
}

// --- Economy: the buy menu (freeze phase only). ---

export function buyItem(sim, id) {
  const m = sim.match;
  const p = sim.player;
  if (m.phase !== 'freeze' || !p.alive) return false;
  if (id === 'ammo') {
    if (p.money < ECONOMY.prices.ammo) return false;
    const st = p.weapons[p.weapon];
    const w = WEAPONS[p.weapon];
    if (st.reserve >= w.reserve) return false;
    p.money -= ECONOMY.prices.ammo;
    st.reserve = w.reserve;
    audio.playBuy();
    return true;
  }
  if (id === 'grenade') {
    if (p.money < GRENADE.price || p.grenades >= 1) return false;
    p.money -= GRENADE.price;
    p.grenades = 1;
    audio.playBuy();
    return true;
  }
  const w = WEAPONS[id];
  if (!w || p.money < w.price) return false;
  if (p.weapons[id]) return false; // already owned
  p.money -= w.price;
  p.weapons[id] = makeWeaponState(id);
  p.weapon = id;
  audio.playBuy();
  return true;
}

// --- Bomb events, called by bots / the player. ---

export function plantBomb(sim, bot, site) {
  const m = sim.match;
  if (m.phase !== 'live') return;
  sim.bomb = {
    state: 'planted',
    site,
    x: bot.x,
    z: bot.z,
    timer: ROUND.fuse,
    carrier: bot,
  };
  bot.hasBomb = false;
  m.phase = 'planted';
  m.phaseTime = ROUND.duration; // clock stops mattering; the fuse decides
  sim.events.push({ type: 'bombPlanted', site, t: sim.time });
  audio.playPlantBeep();
}

export function defuseBomb(sim, bot) {
  const m = sim.match;
  if (m.phase !== 'planted') return;
  sim.bomb.state = 'defused';
  endRound(sim, 'CT', 'Bomb defused by ' + (bot === sim.player ? 'You' : bot.name));
}

export function playerDefuseTick(sim, dt) {
  const m = sim.match;
  const p = sim.player;
  if (m.phase !== 'planted' || !p.alive) {
    p.defuseProgress = 0;
    return;
  }
  const d = Math.hypot(p.x - sim.bomb.x, p.z - sim.bomb.z);
  if (d < 2.2 && sim.input.keys.has('KeyE')) {
    p.defuseProgress += dt;
    if (p.defuseProgress >= ROUND.defuseTime) {
      p.defuseProgress = 0;
      defuseBomb(sim, p);
    }
  } else {
    p.defuseProgress = 0;
  }
}
