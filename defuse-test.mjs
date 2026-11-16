// defuse-test.mjs — prove the defuse path works: plant the bomb, put a CT
// bot on it with one T alive far away, step 6s, expect defused + CT win.
// Run: node defuse-test.mjs
import { SIM_DT } from './game/src/config.js';
import { createSim, stepSim } from './game/src/sim.js';

const input = { keys: new Set(), pressedKeys: new Set(), mouseDX: 0, mouseDY: 0, fireHeld: false, firePressed: false, adsHeld: false, crouchPressed: false };
const sim = createSim(input);
sim.startMatch();
// Skip the freeze (6s to clear the 5s freeze past float rounding).
for (let i = 0; i < 6 * 60; i++) stepSim(sim, SIM_DT);
console.log('phase after freeze:', sim.match.phase);

// Plant the bomb at site A with the planter.
const planter = sim.bots.find((b) => b.role === 'planter');
planter.x = 22; planter.z = -15;
sim.plantBomb(planter, 'A');
console.log('bomb:', sim.bomb.state, 'site:', sim.bomb.site, 'phase:', sim.match.phase);

// Keep one T alive far away (so the round does not end by elimination),
// kill the other T bots.
for (const b of sim.bots) {
  if (b.team === 'T' && b !== planter) { b.alive = false; b.health = 0; }
}
planter.x = 28; planter.z = 0; // far from the bomb, out of sight

// Teleport a CT bot onto the bomb.
const ct = sim.bots.find((b) => b.team === 'CT');
ct.x = sim.bomb.x; ct.z = sim.bomb.z;
console.log('CT bot on bomb at', ct.x, ct.z, 'dist:', Math.hypot(ct.x - sim.bomb.x, ct.z - sim.bomb.z).toFixed(2));

for (let i = 0; i < 6 * 60; i++) stepSim(sim, SIM_DT);
console.log('bomb after 6s:', sim.bomb.state, 'phase:', sim.match.phase, 'score:', sim.match.score.CT, '-', sim.match.score.T);
console.log(sim.bomb.state === 'defused' && sim.match.phase === 'roundEnd' && sim.match.score.CT === 1 ? 'DEFUSE OK' : 'DEFUSE FAILED');
