import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, STEP_RISE } from '../src/world.js';

const w = makeWorld(7);

function eachBox(arr, fn) {
  for (let k = 0; k < arr.length; k += 8) fn(arr[k], arr[k + 1], arr[k + 2], arr[k + 3], arr[k + 4], arr[k + 5], arr[k + 6], arr[k + 7]);
}

test('pieces are deterministic and well formed', () => {
  const w2 = makeWorld(7);
  for (let i = -4; i < 4; i++) for (let j = -4; j < 4; j++) {
    for (const lod of [1, 2, 3]) {
      const a = w.common(i, j, lod), b = w2.common(i, j, lod);
      assert.deepEqual(a.boxes, b.boxes);
      assert.deepEqual(a.lights, b.lights);
      assert.equal(a.boxes.length % 8, 0);
      assert.equal(a.lights.length % 4, 0);
      eachBox(a.boxes, (cx, cy, cz, hx, hy, hz) => assert.ok(hx > 0 && hy > 0 && hz > 0));
    }
    for (const detail of [0, 1, 2]) {
      const a = w.layer(i, j, 0, detail), b = w2.layer(i, j, 0, detail);
      assert.deepEqual(a.boxes, b.boxes);
      assert.equal(a.boxes.length % 8, 0);
      assert.equal(a.lights.length % 4, 0);
      eachBox(a.boxes, (cx, cy, cz, hx, hy, hz) => assert.ok(hx > 0 && hy > 0 && hz > 0, `${hx} ${hy} ${hz}`));
      if (detail === 0) assert.ok(a.boxes.length / 8 < 6000, 'boxes ' + a.boxes.length / 8);
    }
  }
});

test('every stair is a run of 0.25 m steps joining its two junctions', () => {
  let checked = 0;
  for (let i = -25; i < 25 && checked < 200; i++) for (let j = -25; j < 25; j++) for (let axis = 0; axis < 2; axis++) {
    const l = w.link(i, j, axis, 0);
    if (!l || l.rise === 0) continue;
    const tops = w.stepTops(i, j, axis, 0);
    const n = Math.abs(l.rise) / STEP_RISE;
    assert.equal(tops.length, n);
    const sorted = [...tops].sort((a, b) => a - b);
    const lo = Math.min(l.hA, l.hB), hi = Math.max(l.hA, l.hB);
    for (let k = 0; k < n; k++) assert.ok(Math.abs(sorted[k] - (lo + (k + 1) * STEP_RISE)) < 1e-9);
    assert.ok(Math.abs(sorted[n - 1] - hi) < 1e-9);
    checked++;
  }
  assert.ok(checked >= 100);
});

test('nothing intrudes into the space a walker needs', () => {
  const eps = 0.01;
  let volumes = 0;
  for (let i = -8; i < 8; i++) for (let j = -8; j < 8; j++) for (const L of [-1, 0, 1]) {
    const vols = w.walkVolumes(i, j, L);
    if (!vols.length) continue;
    volumes += vols.length;
    const pieces = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      pieces.push(w.common(i + di, j + dj, 1).boxes);
      for (let dl = -1; dl <= 1; dl++) pieces.push(w.layer(i + di, j + dj, L + dl, 0).boxes);
    }
    for (const b of w.beamsNear(i, j)) pieces.push(b);
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const v of vols) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], v[a]); bb[a + 3] = Math.max(bb[a + 3], v[a + 3]); }
    for (const arr of pieces) eachBox(arr, (cx, cy, cz, hx, hy, hz, mat) => {
      if (cx - hx > bb[3] || cx + hx < bb[0] || cy - hy > bb[4] || cy + hy < bb[1] || cz - hz > bb[5] || cz + hz < bb[2]) return;
      for (const v of vols) {
        const hit = cx - hx < v[3] - eps && cx + hx > v[0] + eps && cy - hy < v[4] - eps && cy + hy > v[1] + eps && cz - hz < v[5] - eps && cz + hz > v[2] + eps;
        assert.ok(!hit, `box mat ${mat} at ${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)} half ${hx.toFixed(2)},${hy.toFixed(2)},${hz.toFixed(2)} intrudes into walk volume ${v.map((n) => n.toFixed(2))} of cell ${i},${j},${L}`);
      }
    });
  }
  assert.ok(volumes > 1000);
});

test('solidsNear returns the pieces around a point', () => {
  const s = w.startNode();
  const solids = w.solidsNear(s.i * 40, w.nodeHeight(s.i, s.j), s.j * 40);
  assert.ok(solids.length >= 9);
  let n = 0;
  for (const a of solids) n += a.length / 8;
  assert.ok(n > 50);
});
