// astar-test.mjs — direct probe of NavGrid.findPath for the failing pair.
// Run: node astar-test.mjs
import { navGrid } from './game/src/map.js';

const path = [];
function test(sx, sz, tx, tz, label) {
  const n = navGrid.findPath(sx, sz, tx, tz, path);
  console.log(`${label}: (${sx},${sz}) -> (${tx},${tz}) = ${n} waypoints`, n > 0 ? JSON.stringify(path) : '');
}

test(26, 10, 6, -12, 'planter spawn -> aConnector');
test(26, 10, 22, -15, 'planter spawn -> aSite');
test(28, -6, 6, -12, 'T spawn 2 -> aConnector');
test(28, 0, 0, 0, 'T spawn -> mid');
test(-28, 0, 0, 0, 'CT spawn -> mid');
test(26, 10, 22, 15, 'planter spawn -> bSite');

// Dump the blocked grid around the planter spawn (26,10).
console.log('grid around spawn (x -32..32 step 2, z -22..22 step 2), # = blocked:');
for (let cz = 0; cz < navGrid.h; cz++) {
  let row = '';
  for (let cx = 0; cx < navGrid.w; cx++) {
    row += navGrid.blocked[cz * navGrid.w + cx] ? '#' : '.';
  }
  const zc = -22 + (cz + 0.5) * 2;
  console.log(`z=${zc.toFixed(0).padStart(3)} ${row}`);
}
console.log('start cell:', navGrid.cellAt(26, 10), 'nearestWalkable:', navGrid.nearestWalkable(navGrid.cellAt(26, 10)));
console.log('goal cell aConnector:', navGrid.cellAt(6, -12), 'nearestWalkable:', navGrid.nearestWalkable(navGrid.cellAt(6, -12)));
