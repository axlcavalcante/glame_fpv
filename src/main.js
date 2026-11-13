// Start screen, main loop and wiring.
import { makeWorld, CELL, LEVEL } from './world.js';
import { makeWalker } from './walker.js';
import { makePullback } from './pullback.js';
import { makeInput } from './input.js';
import { makeRenderer } from './render.js';
import { makeAudio } from './audio.js';

const DEFAULT_SEED = 1984;
const LOOK = 0.0023;                 // radians per pixel of mouse travel
const FOV = 70 * Math.PI / 180;

// How far each ring of detail reaches, in cells: full detail, medium, slabs only, masses only.
const RINGS = [3, 7, 20, 70];

function concatArrays(list) {
  let total = 0;
  for (const a of list) total += a.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

// The walker as a small dark figure, in walker space (x right, y up from the feet, z forward).
function figureBoxes(phase) {
  const s = Math.sin(phase * 4.2) * 0.16;
  return new Float32Array([
    -0.1, 0.42, s, 0.085, 0.42, 0.09, 4, 0,
    0.1, 0.42, -s, 0.085, 0.42, 0.09, 4, 0,
    0, 1.13, 0, 0.21, 0.3, 0.13, 4, 0,
    -0.28, 1.1, -s * 0.8, 0.055, 0.32, 0.06, 4, 0,
    0.28, 1.1, s * 0.8, 0.055, 0.32, 0.06, 4, 0,
    0, 1.6, 0, 0.1, 0.12, 0.11, 4, 0,
  ]);
}

function boot() {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const num = (name, fallback) => (params.has(name) ? parseFloat(params.get(name)) : fallback);
  const dbg = { walker: null, pullback: null, world: null, frames: 0, error: null, frameMs: 0 };
  window.__glame = dbg;
  window.addEventListener('error', (e) => { dbg.error = String(e.message || e); });

  const canvas = $('view');
  let renderer = null;
  try { renderer = makeRenderer(canvas); } catch (e) { dbg.error = String(e.message || e); }
  if (!renderer) {
    $('start').style.display = 'none';
    $('nogl').style.display = 'flex';
    return;
  }

  const world = makeWorld(num('seed', DEFAULT_SEED) | 0);
  const walker = makeWalker(world);
  const pull = makePullback();
  const input = makeInput(window);
  const audio = makeAudio();
  dbg.walker = walker; dbg.pullback = pull; dbg.world = world; dbg.renderer = renderer;

  // Checks and screenshots drive the page through the address bar.
  if (params.has('pos')) {
    const p = params.get('pos').split(',').map(Number);
    walker.x = p[0]; walker.y = p[1]; walker.z = p[2]; walker.eyeY = p[1] + 1.62;
  }
  walker.yaw = num('yaw', walker.yaw);
  walker.pitch = num('pitch', walker.pitch);
  walker.light = num('light', 0) > 0;
  const still = num('still', 0) > 0, forcedPull = num('pull', 0) > 0;
  if (params.has('far')) RINGS[3] = Math.max(RINGS[2], num('far', 70) | 0);
  if (params.has('scale')) renderer.scale = num('scale', 1);
  let adaptive = !params.has('scale');

  // ---- rings of geometry around the walker ----
  let builtKey = '', pending = null;

  function ringData(n, ci, cj, Lc) {
    const boxes = [], lights = [];
    const add = (p) => { if (p.boxes.length) boxes.push(p.boxes); if (p.lights.length) lights.push(p.lights); };
    const R = RINGS[n], inner = n > 0 ? RINGS[n - 1] : -1;
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) <= inner) continue;
      const i = ci + di, j = cj + dj;
      add(world.common(i, j, n <= 1 ? 1 : n));
      if (n === 0) for (let dl = -3; dl <= 3; dl++) add(world.layer(i, j, Lc + dl, Math.abs(dl) <= 1 ? 0 : 1));
      else if (n === 1) for (let dl = -3; dl <= 3; dl++) add(world.layer(i, j, Lc + dl, 1));
      else if (n === 2) for (let dl = -2; dl <= 2; dl++) add(world.layer(i, j, Lc + dl, 2));
    }
    return { boxes: concatArrays(boxes), lights: concatArrays(lights) };
  }

  // Prepares one ring per frame, then swaps all four at once so nothing flickers.
  function ensureRings(all) {
    const ci = Math.floor(walker.x / CELL), cj = Math.floor(walker.z / CELL), Lc = world.layerAt(walker.x, walker.y, walker.z);
    const key = ci + ',' + cj + ',' + Lc;
    if (key === builtKey) { pending = null; return; }
    if (!pending || pending.key !== key) pending = { key, ci, cj, Lc, data: [] };
    do { pending.data.push(ringData(pending.data.length, pending.ci, pending.cj, pending.Lc)); }
    while (all && pending.data.length < 4);
    if (pending.data.length === 4) {
      pending.data.forEach((d, n) => renderer.setRing(n, d.boxes, d.lights));
      builtKey = key; pending = null;
      const open = [world.block(ci, cj), world.block(ci - 1, cj), world.block(ci, cj - 1), world.block(ci + 1, cj), world.block(ci, cj + 1)].filter((b) => !b).length / 5;
      audio.setOpen(open);
      if (world.cacheSize() > 160000) world.clearCache();
    }
  }

  // ---- page ----
  const hud = $('hud'), level = $('level'), hint = $('hint');
  let hudOn = num('hud', 1) > 0, running = false, lastLevel = null;
  hud.style.display = 'none';

  input.onToggle = (code) => {
    if (!running) return;
    if (code === 'KeyL') walker.light = !walker.light;
    else if (code === 'KeyH') { hudOn = !hudOn; hud.style.display = hudOn ? 'block' : 'none'; }
    else if (code === 'KeyM') audio.setMuted(!audio.isMuted());
  };

  function capture() {
    try {
      const r = canvas.requestPointerLock && canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* no capture here: dragging looks around instead */ }
  }
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; });

  function begin(silent) {
    if (running) return;
    running = true;
    $('start').classList.add('gone');
    hud.style.display = hudOn ? 'block' : 'none';
    if (!silent) { audio.start(); capture(); }
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 14000);
  }
  $('start').addEventListener('click', () => begin(false));
  window.addEventListener('keydown', (e) => { if (!running && (e.code === 'Enter' || e.code === 'Space')) begin(false); });
  canvas.addEventListener('click', () => { if (running && !input.locked) { audio.start(); capture(); } });
  window.addEventListener('resize', () => renderer.resize());

  // Label the movement keys the way this keyboard prints them.
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then((map) => {
      const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => (map.get(c) || '').toUpperCase());
      if (keys.every(Boolean)) $('movekeys').textContent = keys.join(' ');
    }).catch(() => {});
  }

  if (forcedPull) {
    pull.update(0.001, { held: true, idleSeconds: 0 }, walker, world);
    if (params.has('az')) pull.az = num('az', 0);
    if (params.has('el')) pull.el = num('el', 0.5);
    for (let i = 0; i < 6; i++) pull.update(10, { held: true, idleSeconds: 0 }, walker, world);
    if (params.has('dist')) pull.dist = Math.min(pull.dist, num('dist', 400));
  }
  ensureRings(true);
  if (num('auto', 0) > 0) begin(true);

  // ---- loop ----
  let last = performance.now(), idle = 0, ema = 1 / 60, sinceChange = 0;

  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const look = input.consumeLook();
    const st = input.state;
    let ev = null;

    if (running) {
      const orbiting = pull.active;
      if (!orbiting) walker.look(look.dx * LOOK, look.dy * LOOK);
      if (!still) ev = walker.update(dt, st, world.solidsNear(walker.x, walker.y, walker.z));
      const busy = st.fwd !== 0 || st.strafe !== 0 || st.turn !== 0 || (!orbiting && (look.dx !== 0 || look.dy !== 0));
      idle = busy || !walker.onGround ? 0 : idle + dt;
      if (!(forcedPull && params.has('dist'))) {
        pull.update(dt, {
          held: st.pull || forcedPull, idleSeconds: idle, moved: st.fwd !== 0 || st.strafe !== 0,
          orbitDX: orbiting ? look.dx * LOOK : 0, orbitDY: orbiting ? look.dy * LOOK : 0,
        }, walker, world);
      }
      if (ev && ev.stepped) audio.step(st.run);
      if (ev && ev.landed) audio.land();
    }
    ensureRings(false);

    const cam = pull.camera(walker);
    const f = walker.forward();
    renderer.draw({
      pos: cam.pos, fwd: cam.fwd, fovY: FOV,
      lightOn: walker.light,
      lightPos: [walker.x + Math.sin(walker.yaw) * 0.25, walker.y + 1.25, walker.z + Math.cos(walker.yaw) * 0.25],
      lampVisible: walker.light && cam.figureVisible,
      figure: cam.figureVisible ? figureBoxes(walker.stepPhase) : null,
      figurePos: [walker.x, walker.y, walker.z], figureYaw: walker.yaw,
      fade: walker.fade,
    });

    const lv = Math.floor(walker.y / LEVEL);
    if (lv !== lastLevel) {
      lastLevel = lv;
      level.textContent = (lv < 0 ? '-' : '+') + String(Math.abs(lv)).padStart(5, '0');
    }

    // Lower the drawing resolution in steps if this machine cannot keep up.
    ema += (dt - ema) * 0.05;
    dbg.frameMs = ema * 1000;
    sinceChange++;
    if (adaptive && sinceChange > 120 && ema > 1 / 38 && renderer.scale > 0.5) {
      renderer.scale = Math.max(0.5, renderer.scale * 0.82);
      sinceChange = 0;
    }
    dbg.frames++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
