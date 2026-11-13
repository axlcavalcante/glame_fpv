import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput } from '../src/input.js';

const down = (code, repeat = false) => ({ type: 'keydown', code, repeat });
const up = (code) => ({ type: 'keyup', code });

test('movement keys', () => {
  const inp = makeInput(null);
  inp.handle(down('KeyW'));
  assert.equal(inp.state.fwd, 1);
  inp.handle(down('KeyS'));
  assert.equal(inp.state.fwd, 0);
  inp.handle(up('KeyW'));
  assert.equal(inp.state.fwd, -1);
  inp.handle(down('KeyD'));
  assert.equal(inp.state.strafe, 1);
  inp.handle(down('ShiftLeft'));
  assert.equal(inp.state.run, true);
  inp.handle(down('ArrowLeft'));
  assert.equal(inp.state.turn, -1);
});

test('space and the right mouse button pull back', () => {
  const inp = makeInput(null);
  inp.handle(down('Space'));
  assert.equal(inp.state.pull, true);
  inp.handle(up('Space'));
  assert.equal(inp.state.pull, false);
  inp.handle({ type: 'mousedown', button: 2 });
  assert.equal(inp.state.pull, true);
  inp.handle({ type: 'mouseup', button: 2 });
  assert.equal(inp.state.pull, false);
});

test('blur clears keys', () => {
  const inp = makeInput(null);
  for (const c of ['KeyW', 'KeyD', 'ShiftLeft', 'Space', 'ArrowRight']) inp.handle(down(c));
  inp.handle({ type: 'mousedown', button: 2 });
  inp.handle({ type: 'blur' });
  assert.deepEqual(inp.state, { fwd: 0, strafe: 0, run: false, turn: 0, pull: false });
});

test('toggles fire once, not on key repeat', () => {
  const inp = makeInput(null);
  const seen = [];
  inp.onToggle = (c) => seen.push(c);
  inp.handle(down('KeyL'));
  inp.handle(down('KeyL', true));
  inp.handle(down('KeyL', true));
  inp.handle(up('KeyL'));
  inp.handle(down('KeyH'));
  assert.deepEqual(seen, ['KeyL', 'KeyH']);
});

test('looking needs mouse capture or a drag', () => {
  const inp = makeInput(null);
  inp.handle({ type: 'mousemove', movementX: 5, movementY: 2 });
  assert.deepEqual(inp.consumeLook(), { dx: 0, dy: 0 });
  inp.handle({ type: 'mousedown', button: 0 });
  inp.handle({ type: 'mousemove', movementX: 5, movementY: 2 });
  assert.deepEqual(inp.consumeLook(), { dx: 5, dy: 2 });
  assert.deepEqual(inp.consumeLook(), { dx: 0, dy: 0 });
  inp.handle({ type: 'mouseup', button: 0 });
  inp.locked = true;
  inp.handle({ type: 'mousemove', movementX: -3, movementY: 1 });
  assert.deepEqual(inp.consumeLook(), { dx: -3, dy: 1 });
});
