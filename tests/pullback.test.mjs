import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, CELL } from '../src/world.js';
import { makePullback } from '../src/pullback.js';

const DT = 1 / 60;

function stubWalker() {
  const w = { x: 0, y: 0, z: 0, eyeY: 1.62, yaw: 0, pitch: 0 };
  w.forward = () => [Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch)];
  return w;
}
// A wall 10 m to the east (+x); open everywhere else.
const wallEast = { freeDistance: (ox, oy, oz, dx, dy, dz, max) => (dx > 1e-6 ? Math.min(max, 10 / dx) : max) };
const open = { freeDistance: (ox, oy, oz, dx, dy, dz, max) => max };

test('freeDistance finds the exact distance to a megablock face', () => {
  const world = makeWorld(7);
  let checked = 0;
  for (let i = -10; i < 10 && checked < 20; i++) for (let j = -10; j < 10; j++) {
    const b = world.block(i, j);
    if (!b || world.closure(i, j, 1)) continue;
    const y = b.H0 + 1.3;
    if (y < b.y0 || y > b.y1) continue;
    const d = world.freeDistance(b.x0 - 2, y, (b.z0 + b.z1) / 2, 1, 0, 0, 400);
    assert.ok(Math.abs(d - 2) < 1e-6, 'distance ' + d);
    checked++;
  }
  assert.ok(checked >= 10);
});

test('freeDistance never exceeds max and reaches it in open voids', () => {
  const world = makeWorld(7);
  let voids = 0, clear = 0;
  for (let i = -15; i < 15; i++) for (let j = -15; j < 15; j++) {
    if (world.block(i, j)) continue;
    voids++;
    const d = world.freeDistance((i + 0.5) * CELL, world.nodeHeight(i, j), (j + 0.5) * CELL, 0, 1, 0, 40);
    assert.ok(d <= 40);
    if (d === 40) clear++;
  }
  assert.ok(voids > 50 && clear > voids / 2, `${clear} of ${voids}`);
});

test('the camera pulls away from a nearby wall', () => {
  const p = makePullback(), w = stubWalker();
  p.update(DT, { held: true, idleSeconds: 0 }, w, wallEast);
  assert.ok(Math.sin(p.az) <= 1e-6, 'azimuth points east: ' + p.az);
});

test('holding pulls out to the free distance; releasing comes back', () => {
  const p = makePullback(), w = stubWalker();
  for (let t = 0; t < 20; t += DT) p.update(DT, { held: true, idleSeconds: 0 }, w, open);
  assert.ok(Math.abs(p.dist - 398) / 398 < 0.05, 'dist ' + p.dist);
  assert.equal(p.amount, 1);
  for (let t = 0; t < 4; t += DT) p.update(DT, { held: false, idleSeconds: 0 }, w, open);
  assert.equal(p.amount, 0);
  assert.equal(p.dist, 0);
});

test('standing still for 8 seconds starts it; moving ends it', () => {
  const p = makePullback(), w = stubWalker();
  p.update(DT, { held: false, idleSeconds: 7.9 }, w, open);
  assert.equal(p.amount, 0);
  p.update(DT, { held: false, idleSeconds: 8 }, w, open);
  assert.ok(p.amount > 0);
  for (let t = 0; t < 3; t += DT) p.update(DT, { held: false, idleSeconds: 8 + t }, w, open);
  assert.ok(p.dist > 50);
  for (let t = 0; t < 4; t += DT) p.update(DT, { held: false, idleSeconds: 0, moved: true }, w, open);
  assert.equal(p.dist, 0);
});

test('camera sits at the eye when not pulled back, and aims at the walker when it is', () => {
  const p = makePullback(), w = stubWalker();
  w.yaw = 0.4; w.pitch = -0.2;
  let c = p.camera(w);
  assert.deepEqual(c.pos, [0, 1.62, 0]);
  assert.deepEqual(c.fwd, w.forward());
  assert.equal(c.figureVisible, false);
  for (let t = 0; t < 10; t += DT) p.update(DT, { held: true, idleSeconds: 0 }, w, open);
  c = p.camera(w);
  const to = [w.x - c.pos[0], w.y + 0.95 - c.pos[1], w.z - c.pos[2]];
  const len = Math.hypot(...to);
  const cos = (to[0] * c.fwd[0] + to[1] * c.fwd[1] + to[2] * c.fwd[2]) / len;
  assert.ok(Math.acos(Math.min(1, cos)) < Math.PI / 180);
  assert.equal(c.figureVisible, true);
  assert.ok(len > 300);
});

test('the figure stays hidden until the camera is a metre away', () => {
  const p = makePullback(), w = stubWalker();
  p.update(0.001, { held: true, idleSeconds: 0 }, w, open);
  assert.ok(p.dist < 1);
  assert.equal(p.camera(w).figureVisible, false);
});
