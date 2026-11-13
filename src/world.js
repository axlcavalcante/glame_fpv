// What exists where. Everything is a function of the seed and integer coordinates,
// so the world is endless and always the same for one seed.
//
// Layout: space is cut into CELL-sized cells. Junctions sit on the grid corners, walkways
// run along the grid lines, megablocks fill the inside of cells. Walkway layers repeat
// every LAYER metres vertically.
import { hash2, hash3, noise2, sequence } from './rng.js';

export const CELL = 40;        // metres between junctions
export const LEVEL = 4;        // one level
export const LAYER = 96;       // vertical distance between walkway layers
export const STEP_RISE = 0.25;
export const STEP_RUN = 0.36;
export const MAX_RISE = 20;    // tallest single stair flight (80 steps)
export const PLATFORM = 3;     // half-size of a junction platform
export const WALK_HALF = 1;    // half-width of a walkway

const BIG = 4000;              // "runs out of sight"
const MIN_INSET = 3.2;         // megablocks stay this far from grid lines
const SEGN = 8;                // stepped segments each side of a block's reference height
const ZERO4 = [0, 0, 0, 0];

function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

function builder() {
  const b = [], l = [];
  return {
    box(x0, y0, z0, x1, y1, z1, mat, sd) {
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
      b.push((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat, sd);
    },
    light(x, y, z, s) { l.push(x, y, z, s); },
    done() { return { boxes: new Float32Array(b), lights: new Float32Array(l) }; },
  };
}

// Maps "along the link / across the link" to x and z.
function placer(g, axis, ox, oz) {
  const put = axis === 0
    ? (a0, a1, y0, y1, c0, c1, mat, sd) => g.box(ox + a0, y0, oz + c0, ox + a1, y1, oz + c1, mat, sd)
    : (a0, a1, y0, y1, c0, c1, mat, sd) => g.box(ox + c0, y0, oz + a0, ox + c1, y1, oz + a1, mat, sd);
  put.light = axis === 0
    ? (a, y, c, s) => g.light(ox + a, y, oz + c, s)
    : (a, y, c, s) => g.light(ox + c, y, oz + a, s);
  return put;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return Infinity;
    } else {
      let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function makeWorld(seed) {
  const S = seed | 0;
  const K = (i, j) => (i + 32768) * 65536 + (j + 32768);
  const hMap = new Map(), bMap = new Map(), cMap = new Map(), mMap = new Map();
  const beamCache = new Map(), solidCache = new Map();
  let pieces = new Map();
  let start = null;

  // ---------------------------------------------------------------- heights

  function nodeHeight(i, j) {
    const k = K(i, j);
    let h = hMap.get(k);
    if (h !== undefined) return h;
    const a = noise2(i / 14, j / 14, S + 11) * 2 - 1;
    const b = noise2(i / 5, j / 5, S + 12) * 2 - 1;
    let base = a * 190 + b * 26;
    // Terraces: long flat stretches joined by steep flights.
    const t = base / 20, f = Math.floor(t);
    base = (f + smooth((t - f - 0.3) / 0.4)) * 20;
    h = Math.round(base / LEVEL) * LEVEL + 0; // "+ 0" turns -0 into 0
    if (hMap.size > 200000) hMap.clear();
    hMap.set(k, h);
    return h;
  }

  // ------------------------------------------------------------------ links

  // axis 0 joins (i,j)-(i+1,j); axis 1 joins (i,j)-(i,j+1).
  function link(i, j, axis, L) {
    const h0 = nodeHeight(i, j);
    const h1 = axis === 0 ? nodeHeight(i + 1, j) : nodeHeight(i, j + 1);
    const rise = h1 - h0;
    if (Math.abs(rise) > MAX_RISE) return null;
    // Dense regions are well connected. Open voids are crossed only by a few long bridges:
    // whole rows or columns of links, different on each layer.
    const open = axis === 0 ? !block(i, j - 1) && !block(i, j) : !block(i - 1, j) && !block(i, j);
    if (open && hash3(axis === 0 ? j : i, L, axis, S + 23) > 0.16) return null;
    if (hash3(i, j, L * 2 + axis, S + 21) < (open ? 0.06 : 0.16)) return null;
    const t = hash3(i, j, L * 2 + axis, S + 22);
    let type;
    if (rise === 0) type = t < 0.35 ? 'catwalk' : t < 0.6 ? 'bare' : 'corridor';
    else type = t < 0.3 ? 'stair' : t < 0.5 ? 'stairBare' : t < 0.8 ? 'stairWalled' : 'stairEnclosed';
    return { type, rise, hA: h0 + L * LAYER, hB: h1 + L * LAYER };
  }

  function stairPlan(l) {
    const n = Math.round(Math.abs(l.rise) / STEP_RISE);
    const run = n * STEP_RUN, s0 = (CELL - run) / 2;
    const up = l.rise > 0;
    return {
      n, s0, s1: s0 + run, up,
      a(k) { return s0 + k * STEP_RUN; },
      top(k) { return up ? l.hA + (k + 1) * STEP_RISE : l.hA - k * STEP_RISE; },
    };
  }

  function stepTops(i, j, axis, L) {
    const l = link(i, j, axis, L);
    if (!l || l.rise === 0) return [];
    const p = stairPlan(l), out = [];
    for (let k = 0; k < p.n; k++) out.push(p.top(k));
    return out;
  }

  // ------------------------------------------------------------- megablocks

  function block(i, j) {
    const k = K(i, j);
    let b = bMap.get(k);
    if (b !== undefined) return b;
    b = null;
    const d = noise2(i / 13, j / 13, S + 31);
    const p = 0.07 + 0.74 * smooth((d - 0.33) / 0.22);   // lone towers stand in the open voids
    if (hash2(i, j, S + 32) < p) {
      const r = sequence(i, j, 0, S + 33);
      const ins = () => MIN_INSET + 5.8 * Math.pow(r(), 2.2);
      const H0 = nodeHeight(i, j);
      const x0 = i * CELL + ins(), x1 = (i + 1) * CELL - ins();
      const z0 = j * CELL + ins(), z1 = (j + 1) * CELL - ins();
      const v = r(), u = r();
      let y0 = H0 - BIG, y1 = H0 + BIG;
      if (v < 0.36) { /* runs out of sight both ways */ }
      else if (v < 0.57) y1 = H0 + 24 + Math.round(150 * u * u) * 4;       // top visible
      else if (v < 0.77) y0 = H0 - 24 - Math.round(150 * u * u) * 4;       // underside visible
      else if (v < 0.89) y0 = H0 + 16 + Math.round(30 * u) * 4;            // hangs from above
      else y1 = H0 - 8 - Math.round(25 * u) * 4;                           // stump below
      b = { i, j, H0, x0, x1, z0, z1, y0, y1, seed: r(), segH: 48 + Math.round(24 * r()) * 4 };
    }
    if (bMap.size > 200000) bMap.clear();
    bMap.set(k, b);
    return b;
  }

  // Stepped segments: each band of a block may be set back a little.
  function segShrink(b, k) {
    if (hash3(b.i, b.j, k, S + 35) < 0.4) return ZERO4;
    const r = sequence(b.i * 31 + k, b.j, k, S + 36);
    return [r() * 2.4, r() * 2.4, r() * 2.4, r() * 2.4];
  }

  function faceAt(b, y) {
    const k = Math.floor((y - b.H0) / b.segH);
    if (k < -SEGN || k >= SEGN) return { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, ya: -Infinity, yb: Infinity };
    const s = segShrink(b, k);
    return { x0: b.x0 + s[0], x1: b.x1 - s[1], z0: b.z0 + s[2], z1: b.z1 - s[3], ya: b.H0 + k * b.segH, yb: b.H0 + (k + 1) * b.segH };
  }

  // A mass closing the canyon over a link, slotted where walkways pass.
  function closure(i, j, axis) {
    const k = K(i, j) * 2 + axis;
    let c = cMap.get(k);
    if (c !== undefined) return c;
    c = null;
    const A = axis === 0 ? block(i, j - 1) : block(i - 1, j), B = block(i, j);
    if (A && B && hash3(i, j, axis, S + 51) < 0.3) {
      const r = sequence(i, j, axis, S + 52);
      const H = nodeHeight(i, j);
      let y0 = H - LAYER * Math.floor(r() * 6) - 20 - r() * 40;
      let y1 = H + LAYER * Math.floor(r() * 6) + 30 + r() * 40;
      y0 = Math.max(y0, A.y0, B.y0); y1 = Math.min(y1, A.y1, B.y1);
      if (y1 - y0 >= 20) {
        const hB = axis === 0 ? nodeHeight(i + 1, j) : nodeHeight(i, j + 1);
        c = { y0, y1, hLo: Math.min(H, hB), hHi: Math.max(H, hB), seed: r() };
        if (axis === 0) { c.x0 = Math.max(A.x0, B.x0); c.x1 = Math.min(A.x1, B.x1); c.z0 = A.z1 - 3; c.z1 = B.z0 + 3; }
        else { c.z0 = Math.max(A.z0, B.z0); c.z1 = Math.min(A.z1, B.z1); c.x0 = A.x1 - 3; c.x1 = B.x0 + 3; }
      }
    }
    if (cMap.size > 200000) cMap.clear();
    cMap.set(k, c);
    return c;
  }

  function closureBoxes(g, c, lod) {
    if (lod >= 2) { g.box(c.x0, c.y0, c.z0, c.x1, c.y1, c.z1, 2, c.seed); return; }
    let y = c.y0;
    for (let L = Math.floor((c.y0 - c.hHi - 9) / LAYER); ; L++) {
      const s0 = c.hLo + L * LAYER - 5, s1 = c.hHi + L * LAYER + 9;
      if (s0 >= c.y1) break;
      if (s1 <= y) continue;
      if (s0 > y) g.box(c.x0, y, c.z0, c.x1, Math.min(s0, c.y1), c.z1, 2, c.seed);
      y = Math.max(y, s1);
      if (y >= c.y1) break;
    }
    if (y < c.y1) g.box(c.x0, y, c.z0, c.x1, c.y1, c.z1, 2, c.seed);
  }

  // Giant beams crossing several cells, placed between walkway layers.
  function megabeam(i, j) {
    const k = K(i, j);
    let m = mMap.get(k);
    if (m !== undefined) return m;
    m = null;
    if (hash2(i, j, S + 41) < 0.07) {
      const r = sequence(i, j, 1, S + 42);
      const axis = r() < 0.5 ? 0 : 1;
      let n = 2 + Math.floor(r() * 6);
      const hy = 2 + 5 * r() * r(), hc = 2 + 5 * r() * r();
      const c = CELL / 2 + (r() - 0.5) * 8;
      const yc = nodeHeight(i, j) + LAYER * (Math.floor(r() * 10) - 5 + 0.5) + (r() - 0.5) * 16;
      for (let q = 1; q < n; q++) {
        const hA = axis === 0 ? nodeHeight(i + q, j) : nodeHeight(i, j + q);
        const hB = axis === 0 ? nodeHeight(i + q, j + 1) : nodeHeight(i + 1, j + q);
        const lo = Math.min(hA, hB) - 3, hi = Math.max(hA, hB) + 5;
        const first = Math.floor((yc - hy - hi) / LAYER) + 1;
        if (first < (yc + hy - lo) / LAYER) { n = q; break; }
      }
      const a0 = 6, a1 = n * CELL - 6;
      m = axis === 0
        ? [i * CELL + a0, yc - hy, j * CELL + c - hc, i * CELL + a1, yc + hy, j * CELL + c + hc, r()]
        : [i * CELL + c - hc, yc - hy, j * CELL + a0, i * CELL + c + hc, yc + hy, j * CELL + a1, r()];
    }
    if (mMap.size > 200000) mMap.clear();
    mMap.set(k, m);
    return m;
  }

  // Beams overlapping the cell range [i0..i1] x [j0..j1], as [x0,y0,z0,x1,y1,z1,seed].
  function beamsIn(i0, i1, j0, j1) {
    const key = i0 + ',' + i1 + ',' + j0 + ',' + j1;
    let out = beamCache.get(key);
    if (out) return out;
    out = [];
    const X0 = i0 * CELL, X1 = (i1 + 1) * CELL, Z0 = j0 * CELL, Z1 = (j1 + 1) * CELL;
    for (let i = i0 - 8; i <= i1; i++) for (let j = j0 - 8; j <= j1; j++) {
      const m = megabeam(i, j);
      if (m && m[0] < X1 && m[3] > X0 && m[2] < Z1 && m[5] > Z0) out.push(m);
    }
    if (beamCache.size > 32) beamCache.clear();
    beamCache.set(key, out);
    return out;
  }

  function beamsNear(ci, cj) {
    return beamsIn(ci - 1, ci + 1, cj - 1, cj + 1).map((m) => {
      const g = builder();
      g.box(m[0], m[1], m[2], m[3], m[4], m[5], 2, m[6]);
      return g.done().boxes;
    });
  }

  // ----------------------------------------------------------------- pieces

  function cached(key, make) {
    let p = pieces.get(key);
    if (!p) { p = make(); pieces.set(key, p); }
    return p;
  }

  // Megablock, junction pillar, giant beam and closures of one cell.
  function common(i, j, lod) {
    return cached('c' + lod + ',' + i + ',' + j, () => {
      const g = builder();
      const b = block(i, j), H0 = nodeHeight(i, j);
      if (b) {
        if (lod >= 2) g.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, 0, b.seed);
        else {
          const lo = b.H0 - SEGN * b.segH, hi = b.H0 + SEGN * b.segH;
          if (b.y0 < lo) g.box(b.x0, b.y0, b.z0, b.x1, Math.min(lo, b.y1), b.z1, 0, b.seed);
          if (b.y1 > hi) g.box(b.x0, Math.max(hi, b.y0), b.z0, b.x1, b.y1, b.z1, 0, b.seed);
          for (let k = -SEGN; k < SEGN; k++) {
            const ya = Math.max(b.y0, b.H0 + k * b.segH), yb = Math.min(b.y1, b.H0 + (k + 1) * b.segH);
            if (yb - ya < 0.01) continue;
            const s = segShrink(b, k);
            g.box(b.x0 + s[0], ya, b.z0 + s[2], b.x1 - s[1], yb, b.z1 - s[3], 0, b.seed);
          }
        }
        // Masses hanging under a visible underside, masts on a visible top.
        // Far cells keep only the first few, so nothing changes as they come closer.
        const rs = sequence(i, j, 7, S + 66);
        const growths = lod === 1 ? 16 : lod === 2 ? 7 : 3;
        if (b.y0 > b.H0 - BIG + 1) {
          for (let n = 0; n < growths; n++) {
            const w = 0.6 + 4.5 * rs() * rs(), d = 0.6 + 4.5 * rs() * rs(), len = 5 + 90 * rs() * rs(), u = rs(), v = rs();
            const px = b.x0 + 2.4 + w + u * (b.x1 - b.x0 - 4.8 - 2 * w), pz = b.z0 + 2.4 + d + v * (b.z1 - b.z0 - 4.8 - 2 * d);
            g.box(px - w, b.y0 - len, pz - d, px + w, b.y0 + 0.5, pz + d, n % 3 === 0 ? 2 : 0, b.seed + n * 0.07);
          }
        }
        if (b.y1 < b.H0 + BIG - 1) {
          for (let n = 0; n < growths; n++) {
            const w = 0.25 + 3 * rs() * rs(), d = 0.25 + 3 * rs() * rs(), len = 3 + 60 * rs() * rs(), u = rs(), v = rs();
            const px = b.x0 + 2.4 + w + u * (b.x1 - b.x0 - 4.8 - 2 * w), pz = b.z0 + 2.4 + d + v * (b.z1 - b.z0 - 4.8 - 2 * d);
            g.box(px - w, b.y1 - 0.5, pz - d, px + w, b.y1 + len, pz + d, n % 3 === 0 ? 2 : 0, b.seed + n * 0.05);
          }
        }
        // Pin-point lights on the faces. Far cells keep only the first few.
        const r = sequence(i, j, 2, S + 61);
        const count = lod === 3 ? 2 : lod === 2 ? 6 : 22;
        for (let n = 0; n < count; n++) {
          const side = Math.floor(r() * 4), t = r(), v = r(), sz = 0.25 + 0.5 * r();
          const y = H0 + (v - 0.5) * (n < 2 ? 1400 : n < 6 ? 900 : 520);
          if (y < b.y0 + 1 || y > b.y1 - 1) continue;
          const f = lod === 1 ? faceAt(b, y) : b;
          if (side === 0) g.light(f.x0 - 0.15, y, f.z0 + 1 + t * (f.z1 - f.z0 - 2), sz);
          else if (side === 1) g.light(f.x1 + 0.15, y, f.z0 + 1 + t * (f.z1 - f.z0 - 2), sz);
          else if (side === 2) g.light(f.x0 + 1 + t * (f.x1 - f.x0 - 2), y, f.z0 - 0.15, sz);
          else g.light(f.x0 + 1 + t * (f.x1 - f.x0 - 2), y, f.z1 + 0.15, sz);
        }
      }
      // Junction pillar: beside megablocks always, in open voids only now and then.
      if (lod <= 2 && (b || block(i - 1, j) || block(i, j - 1) || block(i - 1, j - 1) || hash2(i, j, S + 65) < 0.1)) {
        const sx = hash2(i, j, S + 62) < 0.5 ? -1 : 1, sz = hash2(i, j, S + 63) < 0.5 ? -1 : 1;
        const px = i * CELL + sx * 2.2, pz = j * CELL + sz * 2.2;
        g.box(px - 0.6, H0 - BIG, pz - 0.6, px + 0.6, H0 + BIG, pz + 0.6, 1, hash2(i, j, S + 64));
      }
      const m = megabeam(i, j);
      if (m) g.box(m[0], m[1], m[2], m[3], m[4], m[5], 2, m[6]);
      for (let axis = 0; axis < 2; axis++) {
        const c = closure(i, j, axis);
        if (c) closureBoxes(g, c, lod);
      }
      return g.done();
    });
  }

  function rail(put, a0, a1, c, y, sd) {
    put(a0, a1, y + 0.95, y + 1.02, c - 0.03, c + 0.03, 3, sd);
    put(a0, a1, y + 0.47, y + 0.52, c - 0.03, c + 0.03, 3, sd);
    const n = Math.max(1, Math.round((a1 - a0) / 1.6));
    for (let q = 0; q <= n; q++) {
      const a = a0 + (a1 - a0 - 0.06) * q / n;
      put(a, a + 0.06, y, y + 0.95, c - 0.03, c + 0.03, 3, sd);
    }
  }

  function corridor(put, a0, a1, h, sd) {
    for (const s of [-1, 1]) {
      const c0 = s < 0 ? -1 : 0.8, c1 = s < 0 ? -0.8 : 1;
      put(a0, a1, h, h + 1.0, c0, c1, 2, sd);
      put(a0, a1, h + 1.8, h + 2.6, c0, c1, 2, sd);
      // Slit windows every 6 m.
      let a = a0;
      for (let w = a0 + 3; w + 0.7 < a1; w += 6) {
        put(a, w - 0.7, h + 1.0, h + 1.8, c0, c1, 2, sd);
        a = w + 0.7;
      }
      put(a, a1, h + 1.0, h + 1.8, c0, c1, 2, sd);
    }
    put(a0, a1, h + 2.6, h + 2.9, -1, 1, 2, sd);
    put(a0, a1, h + 0.2, h + 0.4, 1.0, 1.2, 3, sd);
    put(a0, a1, h + 2.9, h + 3.05, -0.5, -0.3, 3, sd);
    for (let a = a0 + 5; a < a1 - 2; a += 9) put.light(a, h + 2.5, 0, 0.12);
  }

  function buildLink(g, i, j, axis, L, l, detail) {
    const put = placer(g, axis, i * CELL, j * CELL);
    const sd = hash3(i * 2 + axis, j, L, S + 73);
    const a0 = PLATFORM, a1 = CELL - PLATFORM, hA = l.hA, hB = l.hB;
    if (l.rise === 0) {
      put(a0, a1, hA - 0.3, hA, -1, 1, 1, sd);
      if (detail === 2) return;
      if (detail === 1) { if (l.type === 'corridor') put(a0 + 0.4, a1 - 0.4, hA, hA + 2.9, -1, 1, 2, sd); return; }
      put(a0, a1, hA - 0.8, hA - 0.3, -0.75, -0.6, 3, sd);
      put(a0, a1, hA - 0.8, hA - 0.3, 0.6, 0.75, 3, sd);
      // Rods and cables hanging below the deck.
      const rr = sequence(i * 2 + axis, j, L, S + 74);
      for (let q = 0; q < 9; q++) {
        const a = a0 + 0.5 + rr() * (a1 - a0 - 1), c = rr() < 0.5 ? -0.85 : 0.85, len = 1 + 26 * rr() * rr(), t = 0.03 + 0.07 * rr();
        put(a - t, a + t, hA - 0.3 - len, hA - 0.3, c - t, c + t, 3, sd);
        if (rr() < 0.4) put(a - 0.25, a + 0.25, hA - 0.3 - len - 0.5, hA - 0.3 - len, c - 0.25, c + 0.25, 3, sd);
      }
      if (l.type === 'catwalk') { rail(put, a0, a1, -0.95, hA, sd); rail(put, a0, a1, 0.95, hA, sd); }
      else if (l.type === 'corridor') corridor(put, a0 + 0.4, a1 - 0.4, hA, sd);
      return;
    }
    const p = stairPlan(l), absRise = Math.abs(l.rise);
    put(a0, p.s0, hA - 0.3, hA, -1, 1, 1, sd);
    put(p.s1, a1, hB - 0.3, hB, -1, 1, 1, sd);
    if (detail > 0) {
      const M = Math.min(p.n, detail === 1 ? 10 : 4), run = p.s1 - p.s0;
      for (let m = 0; m < M; m++) {
        const top = p.up ? hA + l.rise * (m + 1) / M : hA + l.rise * m / M;
        put(p.s0 + run * m / M, p.s0 + run * (m + 1) / M, top - absRise / M - 0.5, top, -1, 1, 1, sd);
        if (detail === 1 && l.type === 'stairEnclosed') put(p.s0 + run * m / M, p.s0 + run * (m + 1) / M, top, top + 3.9, -1, 1, 2, sd);
      }
      return;
    }
    const walled = l.type === 'stairWalled' || l.type === 'stairEnclosed';
    const enclosed = l.type === 'stairEnclosed';
    const w = walled ? 0.8 : 1.0;
    for (let k = 0; k < p.n; k++) put(p.a(k), p.a(k + 1), p.top(k) - 0.5, p.top(k), -w, w, 1, sd);
    if (l.type !== 'stairBare') {
      for (const c of [-0.95, 0.95]) {
        if (p.s0 - a0 > 0.1) rail(put, a0, p.s0, c, hA, sd);
        if (a1 - p.s1 > 0.1) rail(put, p.s1, a1, c, hB, sd);
      }
    }
    if (l.type === 'stair') {
      for (let k = 0; k < p.n; k += 2) {
        const ke = Math.min(p.n, k + 2);
        const lowTop = Math.min(p.top(k), p.top(ke - 1)), highTop = Math.max(p.top(k), p.top(ke - 1));
        for (const c of [-0.95, 0.95]) {
          put(p.a(k), p.a(ke), highTop + 0.95, highTop + 1.02, c - 0.03, c + 0.03, 3, sd);
          put(p.a(k), p.a(ke), highTop + 0.45, highTop + 0.5, c - 0.03, c + 0.03, 3, sd);
          put(p.a(k), p.a(k) + 0.06, lowTop - 0.25, highTop + 0.95, c - 0.03, c + 0.03, 3, sd);
        }
      }
    } else if (walled) {
      for (let k = 0; k < p.n; k += 4) {
        const ke = Math.min(p.n, k + 4);
        const lowTop = Math.min(p.top(k), p.top(ke - 1)), highTop = Math.max(p.top(k), p.top(ke - 1));
        const wallTop = highTop + (enclosed ? 3.9 : 1.3);
        put(p.a(k), p.a(ke), lowTop - 0.8, wallTop, -1, -0.8, 2, sd);
        put(p.a(k), p.a(ke), lowTop - 0.8, wallTop, 0.8, 1, 2, sd);
        if (enclosed) {
          put(p.a(k), p.a(ke), highTop + 2.6, highTop + 3.9, -0.8, 0.8, 2, sd);
          if (k % 16 === 8) put.light((p.a(k) + p.a(ke)) / 2, highTop + 2.5, 0, 0.12);
        }
      }
    }
  }

  // Thin beams between two megablocks, above or below the walkway.
  function crossBeams(g, i, j, axis, L) {
    const A = axis === 0 ? block(i, j - 1) : block(i - 1, j), B = block(i, j);
    if (!A || !B || closure(i, j, axis)) return;
    const r = sequence(i * 2 + axis, j, L, S + 81);
    const count = Math.floor(r() * 3.5);
    const h0 = nodeHeight(i, j), h1 = axis === 0 ? nodeHeight(i + 1, j) : nodeHeight(i, j + 1);
    const lo = (axis === 0 ? Math.max(A.x0, B.x0) : Math.max(A.z0, B.z0)) + 1;
    const hi = (axis === 0 ? Math.min(A.x1, B.x1) : Math.min(A.z1, B.z1)) - 1;
    const org = axis === 0 ? i * CELL : j * CELL;
    for (let q = 0; q < count; q++) {
      const a = org + 6 + r() * 28, hy = 0.2 + 1.2 * r() * r(), wa = 0.2 + 1.5 * r(), up = r() < 0.6, dy = r(), sd = r();
      const y = up ? Math.max(h0, h1) + L * LAYER + 6 + dy * 36 : Math.min(h0, h1) + L * LAYER - 4 - dy * 36;
      if (a - wa < lo || a + wa > hi) continue;
      if (y - hy < Math.max(A.y0, B.y0) || y + hy > Math.min(A.y1, B.y1)) continue;
      const fa = faceAt(A, y), fb = faceAt(B, y);
      if (axis === 0) g.box(a - wa, y - hy, fa.z1 - 0.5, a + wa, y + hy, fb.z0 + 0.5, 3, sd);
      else g.box(fa.x1 - 0.5, y - hy, a - wa, fb.x0 + 0.5, y + hy, a + wa, 3, sd);
    }
  }

  // Ledges, ribs, boxes and pipes on the faces of a megablock near one walkway layer.
  function greebles(g, i, j, L) {
    const b = block(i, j);
    if (!b) return;
    const yc = nodeHeight(i, j) + L * LAYER;
    const r = sequence(i, j, L, S + 91);
    for (let side = 0; side < 4; side++) {
      const count = 34 + Math.floor(r() * 30);
      for (let n = 0; n < count; n++) {
        const kind = r(), y = yc + (r() - 0.5) * LAYER, t = r(), q = r(), q2 = r(), q3 = r(), sd = r();
        if (y < b.y0 + 2 || y > b.y1 - 2) continue;
        const f = faceAt(b, y);
        const yLo = Math.max(f.ya, b.y0), yHi = Math.min(f.yb, b.y1);
        const lo = (side < 2 ? f.z0 : f.x0) + 0.5, hi = (side < 2 ? f.z1 : f.x1) - 0.5, span = hi - lo;
        if (span < 12) continue;
        const emit = (aLo, aHi, y0, y1, p, mat) => {
          y0 = Math.max(y0, yLo); y1 = Math.min(y1, yHi);
          if (side === 0) g.box(f.x0 - p, y0, aLo, f.x0 + 0.05, y1, aHi, mat, sd);
          else if (side === 1) g.box(f.x1 - 0.05, y0, aLo, f.x1 + p, y1, aHi, mat, sd);
          else if (side === 2) g.box(aLo, y0, f.z0 - p, aHi, y1, f.z0 + 0.05, mat, sd);
          else g.box(aLo, y0, f.z1 - 0.05, aHi, y1, f.z1 + p, mat, sd);
        };
        if (kind < 0.25) {
          const len = 8 + q * (span - 9), a = lo + t * (span - len);
          emit(a, a + len, y, y + 0.15 + 0.35 * q3, 0.3 + 0.7 * q2, 0);
        } else if (kind < 0.6) {
          const w = 0.25 + 0.5 * q, a = lo + t * (span - w), h = 10 + 80 * q3 * q3;
          emit(a, a + w, y - h / 2, y + h / 2, 0.2 + 0.45 * q2, 3);
        } else if (kind < 0.85) {
          const w = 2 + 5 * q, a = lo + t * (span - w), h = 2 + 7 * q3;
          emit(a, a + w, y - h / 2, y + h / 2, 0.4 + 0.8 * q2, 0);
          if (q3 > 0.6) {
            const px = side === 0 ? f.x0 - 0.5 - 0.8 * q2 : side === 1 ? f.x1 + 0.5 + 0.8 * q2 : a + w / 2;
            const pz = side === 2 ? f.z0 - 0.5 - 0.8 * q2 : side === 3 ? f.z1 + 0.5 + 0.8 * q2 : a + w / 2;
            g.light(px, y, pz, 0.14);
          }
        } else {
          const len = 10 + q * (span - 11), a = lo + t * (span - len);
          for (let m = 0; m < 3; m++) emit(a, a + len, y + m * 0.4, y + m * 0.4 + 0.18, 0.25, 3);
        }
      }
    }
  }

  // Junction platform and the two links owned by cell (i,j) on layer L.
  function layer(i, j, L, detail) {
    return cached('l' + detail + ',' + i + ',' + j + ',' + L, () => {
      const g = builder();
      const ox = i * CELL, oz = j * CELL, H = nodeHeight(i, j) + L * LAYER;
      const lx = link(i, j, 0, L), lz = link(i, j, 1, L), lxm = link(i - 1, j, 0, L), lzm = link(i, j - 1, 1, L);
      const sd = hash3(i, j, L, S + 71);
      if (lx || lz || lxm || lzm) {
        g.box(ox - 3, H - 0.5, oz - 3, ox + 3, H, oz + 3, 1, sd);
        const sx = hash2(i, j, S + 62) < 0.5 ? -1 : 1, sz = hash2(i, j, S + 63) < 0.5 ? -1 : 1;
        if (detail < 2 || sd < 0.35) g.light(ox + sx * 1.5, H + 2.8, oz + sz * 1.5, 0.3);
        if (detail === 0 && hash3(i, j, L, S + 72) > 0.3) {
          const px = placer(g, 0, ox, oz), pz = placer(g, 1, ox, oz);
          const side = (put, c, open) => {
            if (open) { rail(put, -3, -1, c, H, sd); rail(put, 1, 3, c, H, sd); }
            else rail(put, -3, 3, c, H, sd);
          };
          side(pz, 2.95, lx); side(pz, -2.95, lxm); side(px, 2.95, lz); side(px, -2.95, lzm);
        }
      }
      if (lx) buildLink(g, i, j, 0, L, lx, detail);
      if (lz) buildLink(g, i, j, 1, L, lz, detail);
      if (detail <= 1) { crossBeams(g, i, j, 0, L); crossBeams(g, i, j, 1, L); }
      if (detail === 0) greebles(g, i, j, L);
      return g.done();
    });
  }

  // The space a walker needs on the cell's platform and links.
  function walkVolumes(i, j, L) {
    const out = [];
    const ox = i * CELL, oz = j * CELL, H = nodeHeight(i, j) + L * LAYER;
    const lx = link(i, j, 0, L), lz = link(i, j, 1, L), lxm = link(i - 1, j, 0, L), lzm = link(i, j - 1, 1, L);
    if (!(lx || lz || lxm || lzm)) return out;
    const y0 = H + 0.05, y1 = H + 2.2;
    out.push([ox - 0.7, y0, oz - 0.7, ox + 0.7, y1, oz + 0.7]);
    if (lx) out.push([ox + 0.7, y0, oz - 0.7, ox + 3, y1, oz + 0.7]);
    if (lxm) out.push([ox - 3, y0, oz - 0.7, ox - 0.7, y1, oz + 0.7]);
    if (lz) out.push([ox - 0.7, y0, oz + 0.7, ox + 0.7, y1, oz + 3]);
    if (lzm) out.push([ox - 0.7, y0, oz - 3, ox + 0.7, y1, oz - 0.7]);
    for (let axis = 0; axis < 2; axis++) {
      const l = axis === 0 ? lx : lz;
      if (!l) continue;
      const vol = (a0, a1, h) => out.push(axis === 0
        ? [ox + a0, h + 0.05, oz - 0.7, ox + a1, h + 2.2, oz + 0.7]
        : [ox - 0.7, h + 0.05, oz + a0, ox + 0.7, h + 2.2, oz + a1]);
      if (l.rise === 0) { vol(PLATFORM, CELL - PLATFORM, l.hA); continue; }
      const p = stairPlan(l);
      vol(PLATFORM, p.s0, l.hA);
      vol(p.s1, CELL - PLATFORM, l.hB);
      for (let k = 0; k < p.n; k++) vol(p.a(k), p.a(k + 1), p.top(k));
    }
    return out;
  }

  // -------------------------------------------------------------- queries

  function layerAt(x, y, z) {
    return Math.round((y - nodeHeight(Math.round(x / CELL), Math.round(z / CELL))) / LAYER);
  }

  // Everything solid around a point: used for walking.
  function solidsNear(x, y, z) {
    const gi = Math.floor(x / CELL), gj = Math.floor(z / CELL), Lc = layerAt(x, y, z);
    const key = gi + ',' + gj + ',' + Lc;
    let list = solidCache.get(key);
    if (list) return list;
    list = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      list.push(common(gi + di, gj + dj, 1).boxes);
      for (let dl = -1; dl <= 1; dl++) list.push(layer(gi + di, gj + dj, Lc + dl, 0).boxes);
    }
    for (const b of beamsNear(gi, gj)) list.push(b);
    if (solidCache.size > 16) solidCache.clear();
    solidCache.set(key, list);
    return list;
  }

  // Distance to the first megablock, closure or giant beam along a ray. Walkways are ignored.
  function freeDistance(ox, oy, oz, dx, dy, dz, max) {
    let best = max;
    const seen = new Set();
    for (let t = 0; t <= best + CELL; t += CELL / 2) {
      const ci = Math.floor((ox + dx * t) / CELL), cj = Math.floor((oz + dz * t) / CELL);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const i = ci + di, j = cj + dj, k = K(i, j);
        if (seen.has(k)) continue;
        seen.add(k);
        const b = block(i, j);
        if (b) best = Math.min(best, rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1));
        for (let axis = 0; axis < 2; axis++) {
          const c = closure(i, j, axis);
          if (c) best = Math.min(best, rayBox(ox, oy, oz, dx, dy, dz, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1));
        }
      }
    }
    const ci = Math.floor(ox / CELL), cj = Math.floor(oz / CELL), n = Math.ceil(max / CELL) + 1;
    for (const m of beamsIn(ci - n, ci + n, cj - n, cj + n)) {
      best = Math.min(best, rayBox(ox, oy, oz, dx, dy, dz, m[0], m[1], m[2], m[3], m[4], m[5]));
    }
    return best;
  }

  // How open the view is from a point looking along 'yaw': mean free distance over a fan of rays.
  function openness(x, y, z, yaw) {
    let sum = 0;
    for (let q = -3; q <= 3; q++) {
      const a = yaw + q * 0.2;
      sum += freeDistance(x, y, z, Math.sin(a), 0, Math.cos(a), 900);
    }
    return sum / 7;
  }

  // A junction near the origin with several ways out, on the edge of an open void.
  function startNode() {
    if (start) return start;
    let best = null, bestScore = -Infinity;
    for (let i = -16; i <= 16; i++) for (let j = -16; j <= 16; j++) {
      const links = [link(i, j, 0, 0), link(i - 1, j, 0, 0), link(i, j, 1, 0), link(i, j - 1, 1, 0)].filter(Boolean).length;
      if (links < 2) continue;
      const nb = [block(i - 1, j - 1), block(i, j - 1), block(i - 1, j), block(i, j)].filter(Boolean).length;
      if (nb < 1) continue;
      const y = nodeHeight(i, j) + 1.6;
      let vista = 0;
      for (const [yaw, l] of [[Math.PI / 2, link(i, j, 0, 0)], [-Math.PI / 2, link(i - 1, j, 0, 0)], [0, link(i, j, 1, 0)], [Math.PI, link(i, j - 1, 1, 0)]]) {
        if (l) vista = Math.max(vista, openness(i * CELL, y, j * CELL, yaw));
      }
      const score = links * 20 + vista - 0.3 * (i * i + j * j);
      if (score > bestScore) { bestScore = score; best = { i, j }; }
    }
    start = best || { i: 0, j: 0 };
    return start;
  }

  return {
    seed: S,
    nodeHeight, link, block, closure, megabeam, stepTops, faceAt,
    common, layer, walkVolumes, beamsNear, solidsNear, layerAt, freeDistance, openness, startNode,
    cacheSize() { return pieces.size; },
    clearCache() { pieces = new Map(); solidCache.clear(); },
  };
}
