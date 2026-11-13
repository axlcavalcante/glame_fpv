import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, CELL } from '../src/world.js';
import { moveBody } from '../src/collide.js';
import { makeWalker } from '../src/walker.js';

function box(x0, y0, z0, x1, y1, z1) {
  return new Float32Array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0, 0]);
}
const body = (x, y, z) => ({ x, y, z, vy: 0, onGround: false });
const DT = 1 / 60;

test('a dropped body lands exactly on the box below', () => {
  const b = body(0, 5, 0), solids = [box(-2, -1, -2, 2, 0, 2)];
  for (let i = 0; i < 120; i++) moveBody(b, 0, 0, DT, solids);
  assert.equal(b.y, 0);
  assert.ok(b.onGround);
});

test('a fast fall does not pass through a thin floor', () => {
  const b = body(0, 400, 0), solids = [box(-2, -0.3, -2, 2, 0, 2)];
  for (let i = 0; i < 60 * 20; i++) moveBody(b, 0, 0, DT, solids);
  assert.equal(b.y, 0);
});

test('a 0.25 m ledge is climbed, a 0.5 m ledge blocks', () => {
  const floor = box(-10, -1, -10, 10, 0, 10);
  const low = body(0, 0, 0); low.onGround = true;
  for (let i = 0; i < 120; i++) moveBody(low, 3 * DT, 0, DT, [floor, box(1, 0, -2, 6, 0.25, 2)]);
  assert.ok(low.x > 3);
  assert.equal(low.y, 0.25);
  const high = body(0, 0, 0); high.onGround = true;
  for (let i = 0; i < 120; i++) moveBody(high, 3 * DT, 0, DT, [floor, box(1, 0, -2, 6, 0.5, 2)]);
  assert.ok(high.x < 0.71);
  assert.equal(high.y, 0);
});

test('a wall stops the body and lets it slide', () => {
  const b = body(0, 0, 0); b.onGround = true;
  const solids = [box(-10, -1, -10, 10, 0, 10), box(1, 0, -10, 1.2, 3, 10)];
  for (let i = 0; i < 120; i++) moveBody(b, 3 * DT, 2 * DT, DT, solids);
  assert.ok(b.x <= 0.7 + 1e-6);
  assert.ok(b.z > 3.5);
});

test('long frame does not tunnel', () => {
  const world = makeWorld(7), w = makeWalker(world);
  const y = w.y;
  w.update(5, { fwd: 0, strafe: 0 }, world.solidsNear(w.x, w.y, w.z));
  assert.equal(w.y, y);
  assert.ok(w.onGround);
});

test('walk and run speeds', () => {
  const world = makeWorld(7), w = makeWalker(world);
  const solids = [box(-500, -1, -500, 500, 0, 500)];
  w.x = 0; w.y = 0; w.z = 0; w.yaw = 0.7;
  for (let i = 0; i < 300; i++) w.update(DT, { fwd: 1 }, solids);
  assert.ok(Math.abs(Math.hypot(w.x, w.z) / 5 - 3) < 0.1);
  w.x = 0; w.z = 0;
  for (let i = 0; i < 300; i++) w.update(DT, { fwd: 1, strafe: 1, run: true }, solids);
  assert.ok(Math.abs(Math.hypot(w.x, w.z) / 5 - 7) < 0.2);
});

test('a long fall fades out and returns to the last junction', () => {
  const world = makeWorld(7), w = makeWalker(world);
  const solids = [box(-2, -1, -2, 2, 0, 2)];
  w.x = 0; w.y = 0; w.z = 0; w.yaw = 0; w.lastSafe = { x: 0, y: 0, z: 0 };
  w.update(DT, {}, solids);
  let sawFade = false, t = 0;
  for (; t < 6; t += DT) { w.update(DT, { fwd: 1, run: true }, solids); }
  assert.ok(w.y < -50, 'fell');
  assert.equal(w.fade, 0, 'no fade in the first 6 s of falling');
  for (let i = 0; i < 60 * 5; i++) {
    w.update(DT, {}, solids);
    if (w.fade > 0.5) sawFade = true;
  }
  assert.ok(sawFade);
  assert.equal(w.y, 0);
  assert.equal(w.x, 0);
  assert.equal(w.vy, 0);
  assert.equal(w.fade, 0);
});

test('every kind of link can be walked from end to end, both ways', () => {
  const world = makeWorld(7);
  const want = { catwalk: 6, bare: 6, corridor: 6, stair: 6, stairBare: 6, stairWalled: 6, stairEnclosed: 6 };
  let done = 0;
  for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) for (let axis = 0; axis < 2; axis++) for (const L of [0, 1]) {
    const l = world.link(i, j, axis, L);
    if (!l || !want[l.type]) continue;
    want[l.type]--; done++;
    const A = [i * CELL, l.hA, j * CELL], B = [(i + (axis === 0)) * CELL, l.hB, (j + (axis === 1)) * CELL];
    for (const [from, to] of [[A, B], [B, A]]) {
      const w = makeWalker(world);
      w.x = from[0]; w.y = from[1]; w.z = from[2]; w.vy = 0; w.onGround = true;
      w.yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
      let reached = false;
      for (let t = 0; t < 60 && !reached; t += DT) {
        w.update(DT, { fwd: 1, run: true }, world.solidsNear(w.x, w.y, w.z));
        reached = Math.hypot(w.x - to[0], w.z - to[2]) < 1.5;
      }
      const where = `${l.type} at ${i},${j} axis ${axis} layer ${L}: stopped at ${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
      assert.ok(reached, 'did not arrive — ' + where);
      assert.ok(Math.abs(w.y - to[1]) < 0.01, 'wrong height — ' + where);
    }
  }
  assert.ok(done >= 40, 'links walked: ' + done);
});
