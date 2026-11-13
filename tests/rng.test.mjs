import test from 'node:test';
import assert from 'node:assert/strict';
import { hash2, hash3, noise2 } from '../src/rng.js';

test('hash2 is deterministic and in range', () => {
  assert.equal(hash2(3, -7, 1), hash2(3, -7, 1));
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const v = hash2(i % 100, (i / 100) | 0, 9);
    assert.ok(v >= 0 && v < 1);
    sum += v;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
  assert.notEqual(hash2(1, 2, 5), hash2(2, 1, 5));
  assert.notEqual(hash2(1, 2, 5), hash2(1, 2, 6));
});

test('hash3 depends on every argument', () => {
  const a = hash3(1, 2, 3, 4);
  assert.equal(a, hash3(1, 2, 3, 4));
  assert.notEqual(a, hash3(1, 2, 4, 4));
  assert.notEqual(a, hash3(2, 2, 3, 4));
  assert.ok(a >= 0 && a < 1);
});

test('noise2 matches hash at integers and is smooth', () => {
  assert.equal(noise2(4, 9, 3), hash2(4, 9, 3));
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37, y = i * 0.21;
    assert.ok(Math.abs(noise2(x + 0.05, y, 3) - noise2(x, y, 3)) < 0.2);
  }
});
