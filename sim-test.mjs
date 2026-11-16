// sim-test.mjs — headless logic test for the FOUNDRY sim (no rendering).
// Imports the real sim modules in Node and runs the game for 3 rounds,
// with a scripted player that walks, aims and fires. Reports: phases,
// round outcomes, bot movement, plant/defuse, kills, and any exception.
// Run: node sim-test.mjs
import { SIM_DT } from './game/src/config.js';
import { createSim, stepSim } from './game/src/sim.js';

const input = {
  keys: new Set(),
  pressedKeys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  fireHeld: false,
  firePressed: false,
  adsHeld: false,
  crouchPressed: false,
};

const sim = createSim(input);
sim.startMatch();

const seen = { phases: new Set(), roundEnds: 0, kills: 0, plants: 0, defuses: 0, explosions: 0 };
let lastPhase = '';
let maxBotTravel = 0;
const startPos = new Map(sim.bots.map((b) => [b.id, [b.x, b.z]]));

function step() {
  stepSim(sim, SIM_DT);
  const m = sim.match;
  if (m.phase !== lastPhase) {
    seen.phases.add(m.phase);
    console.log(`t=${sim.time.toFixed(1)}s phase=${m.phase} round=${m.round} score=${m.score.CT}-${m.score.T}`);
    lastPhase = m.phase;
  }
  for (const e of sim.events) {
    if (e._counted) continue;
    e._counted = true;
    if (e.type === 'roundEnd') seen.roundEnds += 1;
    if (e.type === 'kill') { seen.kills += 1; if (seen.kills <= 6) console.log(`  kill: ${e.attacker} -> ${e.victim}`); }
    if (e.type === 'bombPlanted') { seen.plants += 1; console.log(`  BOMB PLANTED site ${e.site}`); }
    if (e.type === 'bombDefused') { seen.defuses += 1; console.log('  BOMB DEFUSED'); }
    if (e.type === 'bombExploded') { seen.explosions += 1; console.log('  BOMB EXPLODED'); }
  }
  for (const b of sim.bots) {
    const [sx, sz] = startPos.get(b.id);
    maxBotTravel = Math.max(maxBotTravel, Math.hypot(b.x - sx, b.z - sz));
  }
}

// Scripted player: walk forward + strafe, ADS, fire in bursts.
let tick = 0;
const TOTAL = 60 * 60 * 4; // 4 minutes of sim
let nextTrace = 10;
for (let i = 0; i < TOTAL; i++) {
  tick++;
  // Walk toward mid/A, strafe periodically.
  input.keys.clear();
  if (sim.player.alive && sim.match.phase === 'live') {
    input.keys.add('KeyW');
    if (Math.floor(tick / 120) % 2 === 0) input.keys.add('KeyA'); else input.keys.add('KeyD');
    input.adsHeld = tick % 240 < 120;
    input.fireHeld = tick % 90 < 20;
    if (tick % 90 === 0) input.firePressed = true;
  } else {
    input.fireHeld = false;
    input.adsHeld = false;
  }
  // Buy a rifle at the start of each freeze.
  if (sim.match.phase === 'freeze' && !sim.player.weapons.rifle && sim.player.money >= 1500) {
    const { buyItem } = await import('./game/src/rounds.js');
    buyItem(sim, 'rifle');
  }
  step();
  input.firePressed = false;
  input.pressedKeys.clear();
  // Trace the bomb carrier every 5s of sim time.
  if (sim.time >= nextTrace) {
    nextTrace += 5;
    const carrier = sim.bots.find((b) => b.hasBomb);
    if (carrier) {
      console.log(`  trace t=${sim.time.toFixed(0)} carrier=${carrier.name} role=${carrier.role} pos=(${carrier.x.toFixed(1)},${carrier.z.toFixed(1)}) state=${carrier.state} path=${carrier.pathIdx}/${carrier.path.length} alive=${carrier.alive} tSite=${sim.tSite} bomb=${sim.bomb.state}`);
    } else {
      console.log(`  trace t=${sim.time.toFixed(0)} no carrier bomb=${sim.bomb.state}`);
    }
  }
  if (sim.match.phase === 'matchEnd') break;
}

console.log('---');
console.log('phases seen:', [...seen.phases].join(', '));
console.log('roundEnds:', seen.roundEnds, 'kills:', seen.kills, 'plants:', seen.plants, 'defuses:', seen.defuses, 'explosions:', seen.explosions);
console.log('max bot travel from spawn (m):', maxBotTravel.toFixed(1));
console.log('player alive:', sim.player.alive, 'health:', Math.round(sim.player.health), 'kills:', sim.player.kills, 'money:', sim.player.money, 'weapon:', sim.player.weapon);
console.log('bots alive:', sim.bots.filter((b) => b.alive).length, '/', sim.bots.length);
console.log('final score:', sim.match.score.CT, '-', sim.match.score.T, 'phase:', sim.match.phase, 'round:', sim.match.round);
console.log('bomb state:', sim.bomb.state, 'site:', sim.bomb.site);
