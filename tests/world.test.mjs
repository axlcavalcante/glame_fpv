import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, CELL, LEVEL, LAYER, MAX_RISE } from '../src/world.js';

const STAIRS = ['stair', 'stairBare', 'stairWalled', 'stairEnclosed'];
const FLATS = ['catwalk', 'bare', 'corridor'];

test('heights are level multiples and depend only on the seed', () => {
  const a = makeWorld(7), b = makeWorld(7), c = makeWorld(8);
  let differs = false;
  for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) {
    const h = a.nodeHeight(i, j);
    assert.equal(Math.abs(h % LEVEL), 0);
    assert.equal(h, b.nodeHeight(i, j));
    if (h !== c.nodeHeight(i, j)) differs = true;
  }
  assert.ok(differs);
});

test('heights span hundreds of metres across the world', () => {
  const w = makeWorld(7);
  let lo = Infinity, hi = -Infinity;
  for (let i = -200; i < 200; i += 3) for (let j = -200; j < 200; j += 3) {
    const h = w.nodeHeight(i, j);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  assert.ok(hi - lo > 200, 'span ' + (hi - lo));
});

test('links respect the maximum rise and their type matches their slope', () => {
  const w = makeWorld(7);
  let present = 0, possible = 0, stairs = 0, long = 0;
  for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) for (let axis = 0; axis < 2; axis++) {
    possible++;
    const l = w.link(i, j, axis, 0);
    if (!l) continue;
    present++;
    assert.ok(Math.abs(l.rise) <= MAX_RISE);
    assert.equal(l.rise, l.hB - l.hA);
    assert.equal(l.hA, w.nodeHeight(i, j));
    if (l.rise === 0) assert.ok(FLATS.includes(l.type), l.type);
    else { assert.ok(STAIRS.includes(l.type), l.type); stairs++; if (Math.abs(l.rise) >= 12) long++; }
  }
  const frac = present / possible;
  assert.ok(frac > 0.4 && frac < 0.95, 'link fraction ' + frac);
  assert.ok(stairs / present > 0.2, 'stairs fraction ' + stairs / present);
  assert.ok(long > 50, 'long stairs ' + long);
});

test('layers are stacked LAYER apart', () => {
  const w = makeWorld(7);
  for (let i = 0; i < 40; i++) {
    const l0 = w.link(i, 3, 0, 0), l2 = w.link(i, 3, 0, 2);
    if (l0) assert.equal(l0.hA, w.nodeHeight(i, 3));
    if (l2) assert.equal(l2.hA, w.nodeHeight(i, 3) + 2 * LAYER);
  }
});

test('megablocks keep clear of the grid lines and leave open voids', () => {
  const w = makeWorld(7);
  let blocks = 0, cells = 0;
  for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
    cells++;
    const b = w.block(i, j);
    if (!b) continue;
    blocks++;
    assert.ok(b.x0 >= i * CELL + 3.2 - 1e-9 && b.x1 <= (i + 1) * CELL - 3.2 + 1e-9);
    assert.ok(b.z0 >= j * CELL + 3.2 - 1e-9 && b.z1 <= (j + 1) * CELL - 3.2 + 1e-9);
    assert.ok(b.y1 - b.y0 > 20);
  }
  const frac = blocks / cells;
  assert.ok(frac > 0.25 && frac < 0.8, 'block fraction ' + frac);
});

test('closures only exist between two megablocks', () => {
  const w = makeWorld(7);
  let n = 0;
  for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
    const c = w.closure(i, j, 0);
    if (!c) continue;
    n++;
    assert.ok(w.block(i, j - 1) && w.block(i, j));
    assert.ok(c.y1 - c.y0 >= 20);
  }
  assert.ok(n > 20, 'closures ' + n);
});

test('the start junction has somewhere to go', () => {
  const w = makeWorld(7);
  const s = w.startNode();
  const links = [w.link(s.i, s.j, 0, 0), w.link(s.i - 1, s.j, 0, 0), w.link(s.i, s.j, 1, 0), w.link(s.i, s.j - 1, 1, 0)];
  assert.ok(links.filter(Boolean).length >= 2);
});
