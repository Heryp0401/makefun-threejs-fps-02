// map.js — the FOUNDRY map: geometry, collision, nav grid, line of sight.
// All gameplay code asks this module: "can I stand here?", "can I see
// there?", "how do I walk there?". Rendering reads the same wall list, so
// what you see is exactly what collides.

import * as THREE from 'three';
import { MAP, SITES } from './config.js';
import { NavGrid } from './astar.js';

// Walls and crates: [x1, z1, x2, z2, height]. Height <= 1.5 is a low crate:
// it blocks movement but you can see over it.
export const WALLS = [
  // Perimeter.
  [-32, -22, 32, -21, 4],
  [-32, 21, 32, 22, 4],
  [-32, -22, -31, 22, 4],
  [31, -22, 32, 22, 4],
  // North lane walls (A long / A connector). Gap x[4,10] is the A doorway.
  [-18, -10.5, 4, -9.5, 3.5],
  [10, -10.5, 26, -9.5, 3.5],
  // South lane walls (B tunnel / B connector). Gap x[4,10] is the B doorway.
  [-18, 9.5, 4, 10.5, 3.5],
  [10, 9.5, 26, 10.5, 3.5],
  // West choke block: CT side must swing north or south of it to reach mid.
  [-14, -4, -10, 4, 3.5],
  // Low crates (movement cover, sight goes over).
  [-4, -2, -1, 1, 1.4], // mid
  [12, -1.5, 15, 1.5, 1.4], // east mid
  [16, -20, 20, -17, 2.5], // A site stack (tall)
  [24, -14, 28, -11, 1.4], // A site crate
  [16, 17, 20, 20, 2.5], // B site stack (tall)
  [24, 11, 28, 14, 1.4], // B site crate
  [-24, -8, -21, -5, 1.4], // CT side crate
  [21, -4, 24, -1, 1.4], // T side crate
  [-2, -18, 2, -15, 1.4], // A long crate
];

const NAV_MARGIN = 0.45; // agent radius + clearance

function buildGrids() {
  const w = Math.ceil((MAP.halfX * 2) / MAP.cell);
  const h = Math.ceil((MAP.halfZ * 2) / MAP.cell);
  const nav = new Uint8Array(w * h);
  const sight = new Uint8Array(w * h);
  for (let cz = 0; cz < h; cz++) {
    for (let cxi = 0; cxi < w; cxi++) {
      const cx = -MAP.halfX + (cxi + 0.5) * MAP.cell;
      const czw = -MAP.halfZ + (cz + 0.5) * MAP.cell;
      for (const [x1, z1, x2, z2, ht] of WALLS) {
        const inside =
          cx > x1 - NAV_MARGIN && cx < x2 + NAV_MARGIN &&
          czw > z1 - NAV_MARGIN && czw < z2 + NAV_MARGIN;
        if (inside) {
          nav[cz * w + cxi] = 1;
          if (ht >= 2.5) sight[cz * w + cxi] = 1;
        }
      }
    }
  }
  return { w, h, nav, sight };
}

const grids = buildGrids();
export const navGrid = new NavGrid(
  grids.w, grids.h, MAP.cell, -MAP.halfX, -MAP.halfZ, grids.nav,
);
const sightGrid = new NavGrid(
  grids.w, grids.h, MAP.cell, -MAP.halfX, -MAP.halfZ, grids.sight,
);

// 2D line of sight: tall walls block it, low crates do not.
export function hasLineOfSight(x0, z0, x1, z1) {
  return sightGrid.hasLineOfSight(x0, z0, x1, z1);
}

// Circle-vs-walls collision. Moves (x, z) by (dx, dz) axis by axis and
// slides along walls. Returns [nx, nz].
export function moveCircle(x, z, dx, dz, r) {
  let nx = x + dx;
  for (const [x1, z1, x2, z2] of WALLS) {
    if (z > z1 - r && z < z2 + r && nx + r > x1 && nx - r < x2) {
      if (dx > 0) nx = x1 - r;
      else if (dx < 0) nx = x2 + r;
    }
  }
  let nz = z + dz;
  for (const [x1, z1, x2, z2] of WALLS) {
    if (nx > x1 - r && nx < x2 + r && nz + r > z1 && nz - r < z2) {
      if (dz > 0) nz = z1 - r;
      else if (dz < 0) nz = z2 + r;
    }
  }
  // Clamp to the playable bounds.
  nx = Math.max(-MAP.halfX + r, Math.min(MAP.halfX - r, nx));
  nz = Math.max(-MAP.halfZ + r, Math.min(MAP.halfZ - r, nz));
  return [nx, nz];
}

export function inSite(x, z, siteKey) {
  const s = SITES[siteKey];
  const dx = x - s.x;
  const dz = z - s.z;
  return dx * dx + dz * dz < s.r * s.r;
}

export function nearestSite(x, z) {
  const da = Math.hypot(x - SITES.A.x, z - SITES.A.z);
  const db = Math.hypot(x - SITES.B.x, z - SITES.B.z);
  return da <= db ? 'A' : 'B';
}

// ---- Rendering: one palette, Lambert materials, canvas floor texture. ----

export const PALETTE = {
  floor: 0x3d3831,
  floorLine: 0x4a443c,
  wall: 0x8a8172,
  wallDark: 0x5d564c,
  crate: 0xa8824a,
  crateTall: 0x71808a,
  accentA: 0xd5543a,
  accentB: 0x3a7bd5,
  sky: 0x2b3644,
};

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2a26';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#3a352f';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = i * 64;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
  }
  // Speckle for a worn concrete read.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#332e29' : '#292524';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function siteMarkerTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color;
  g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMapMeshes(scene) {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2),
    new THREE.MeshLambertMaterial({ map: floorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = false;
  group.add(floor);

  const wallMat = new THREE.MeshLambertMaterial({ color: PALETTE.wall });
  const wallDarkMat = new THREE.MeshLambertMaterial({ color: PALETTE.wallDark });
  const crateMat = new THREE.MeshLambertMaterial({ color: PALETTE.crate });
  const crateTallMat = new THREE.MeshLambertMaterial({ color: PALETTE.crateTall });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const [x1, z1, x2, z2, h] of WALLS) {
    const w = x2 - x1;
    const d = z2 - z1;
    const mesh = new THREE.Mesh(
      boxGeo,
      h >= 3.5 ? wallMat : h >= 2.5 ? crateTallMat : h >= 2 ? wallDarkMat : crateMat,
    );
    mesh.scale.set(w, h, d);
    mesh.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    group.add(mesh);
    // A darker cap line on tall walls so lanes read at a glance.
    if (h >= 3.5) {
      const cap = new THREE.Mesh(boxGeo, wallDarkMat);
      cap.scale.set(w, 0.18, d);
      cap.position.set((x1 + x2) / 2, h + 0.09, (z1 + z2) / 2);
      group.add(cap);
    }
  }

  // Site markers: flat rings with A / B on the floor.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(s.r * 2, s.r * 2),
      new THREE.MeshBasicMaterial({
        map: siteMarkerTexture(key, key === 'A' ? '#d5543a' : '#3a7bd5'),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(s.x, 0.02, s.z);
    group.add(marker);
  }

  scene.add(group);
  return group;
}
