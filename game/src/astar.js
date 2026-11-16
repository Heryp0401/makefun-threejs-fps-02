// astar.js — A* pathfinding on the map's nav grid.
// The grid is a flat Uint8Array (1 = blocked). Paths are arrays of [x, z]
// waypoints in world coordinates, reused across repaths: findPath writes
// into a caller-owned array so the hot loop never allocates.

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

// Small binary heap of grid indices, keyed by f-score. Reused per call.
class Heap {
  constructor(cap) {
    this.f = new Float32Array(cap);
    this.i = new Int32Array(cap);
    this.n = 0;
  }
  clear() { this.n = 0; }
  push(idx, score) {
    let n = this.n++;
    this.f[n] = score;
    this.i[n] = idx;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.f[p] <= this.f[n]) break;
      const tf = this.f[p]; this.f[p] = this.f[n]; this.f[n] = tf;
      const ti = this.i[p]; this.i[p] = this.i[n]; this.i[n] = ti;
      n = p;
    }
  }
  pop() {
    const top = this.i[0];
    const lastF = this.f[--this.n];
    const lastI = this.i[this.n];
    if (this.n > 0) {
      this.f[0] = lastF;
      this.i[0] = lastI;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < this.n && this.f[l] < this.f[m]) m = l;
        if (r < this.n && this.f[r] < this.f[m]) m = r;
        if (m === n) break;
        const tf = this.f[m]; this.f[m] = this.f[n]; this.f[n] = tf;
        const ti = this.i[m]; this.i[m] = this.i[n]; this.i[n] = ti;
        n = m;
      }
    }
    return top;
  }
}

export class NavGrid {
  // blocked: Uint8Array, w/h in cells, cell: world metres per cell,
  // originX/originZ: world coords of cell (0,0) corner.
  constructor(w, h, cell, originX, originZ, blocked) {
    this.w = w;
    this.h = h;
    this.cell = cell;
    this.originX = originX;
    this.originZ = originZ;
    this.blocked = blocked;
    const n = w * h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.mark = new Int32Array(n); // generation stamp per cell (no clearing)
    this.openMark = new Int32Array(n); // generation stamp: in the open heap
    this.heap = new Heap(n);
    this._gen = 0;
  }

  cellAt(x, z) {
    const cx = Math.floor((x - this.originX) / this.cell);
    const cz = Math.floor((z - this.originZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }

  cellCenter(idx) {
    const cx = idx % this.w;
    const cz = (idx / this.w) | 0;
    return [this.originX + (cx + 0.5) * this.cell, this.originZ + (cz + 0.5) * this.cell];
  }

  isBlocked(idx) {
    return idx < 0 || idx >= this.w * this.h || this.blocked[idx] === 1;
  }

  // Nearest walkable cell to idx (itself when walkable), or -1.
  // A bot can stand at a legal position whose cell centre is inside a
  // wall's margin (e.g. a spawn hugging a crate) — pathfinding must snap
  // to the nearest open cell instead of failing outright.
  nearestWalkable(idx) {
    if (idx < 0 || idx >= this.w * this.h) return -1;
    if (this.blocked[idx] === 0) return idx;
    const cx = idx % this.w;
    const cz = (idx / this.w) | 0;
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
          const ni = nz * this.w + nx;
          if (this.blocked[ni] === 0) return ni;
        }
      }
    }
    return -1;
  }

  // Straight-line check on the 2D grid (DDA): true when no blocked cell
  // lies between the two world points. Used for line of sight.
  hasLineOfSight(x0, z0, x1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const steps = Math.ceil(dist / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const idx = this.cellAt(x0 + dx * t, z0 + dz * t);
      if (idx >= 0 && this.blocked[idx] === 1) return false;
    }
    return true;
  }

  // A* from world (sx, sz) to world (tx, tz). Writes waypoints (world x/z
  // pairs) into `out` (cleared first) and returns the waypoint count.
  // Returns 0 when no path exists.
  findPath(sx, sz, tx, tz, out) {
    out.length = 0;
    const start = this.nearestWalkable(this.cellAt(sx, sz));
    const goal = this.nearestWalkable(this.cellAt(tx, tz));
    if (start < 0 || goal < 0) return 0;
    if (start === goal) {
      out.push([tx, tz]);
      return 1;
    }
    const { w, h, g, f, came, mark, openMark, heap } = this;
    // Generation stamp avoids clearing the big arrays every call.
    const gen = ++this._gen;
    heap.clear();
    g[start] = 0;
    f[start] = Math.abs(tx - sx) + Math.abs(tz - sz);
    came[start] = -1;
    mark[start] = gen;
    openMark[start] = gen;
    heap.push(start, f[start]);
    const gx = goal % w;
    const gz = (goal / w) | 0;
    let found = false;
    while (heap.n > 0) {
      const cur = heap.pop();
      openMark[cur] = 0;
      if (cur === goal) { found = true; break; }
      const cx = cur % w;
      const cz = (cur / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0];
        const nz = cz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx;
        if (this.blocked[ni] === 1) continue;
        // No cutting corners through two blocked orthogonal neighbours.
        if (d >= 4) {
          if (this.blocked[cz * w + nx] === 1 || this.blocked[nz * w + cx] === 1) continue;
        }
        const ng = g[cur] + DIRS[d][2];
        if (mark[ni] === gen && ng >= g[ni]) continue;
        g[ni] = ng;
        came[ni] = cur;
        const hx = Math.abs(nx - gx) + Math.abs(nz - gz);
        f[ni] = ng + hx;
        mark[ni] = gen;
        if (openMark[ni] !== gen) {
          openMark[ni] = gen;
          heap.push(ni, f[ni]);
        }
      }
    }
    if (!found) return 0;
    // Reconstruct, then simplify: drop collinear intermediate nodes.
    const raw = [];
    let cur = goal;
    while (cur !== -1) {
      raw.push(cur);
      cur = came[cur];
    }
    raw.reverse();
    const pts = [];
    for (let i = 0; i < raw.length; i++) pts.push(this.cellCenter(raw[i]));
    // Simplify with line-of-sight string-pulling.
    let anchor = 0;
    out.push(pts[0]);
    while (anchor < pts.length - 1) {
      let far = anchor + 1;
      for (let j = anchor + 2; j < pts.length; j++) {
        if (this.hasLineOfSight(pts[anchor][0], pts[anchor][1], pts[j][0], pts[j][1])) far = j;
        else break;
      }
      out.push(pts[far]);
      anchor = far;
    }
    // End exactly on the target, not the cell centre.
    out[out.length - 1] = [tx, tz];
    return out.length;
  }
}
