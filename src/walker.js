// The walker: the only person in the world.
import { CELL } from './world.js';
import { moveBody } from './collide.js';

export const WALK = 3, RUN = 7, EYE = 1.62;

export function makeWalker(world) {
  const s = world.startNode();
  const w = {
    x: s.i * CELL, y: world.nodeHeight(s.i, s.j), z: s.j * CELL,
    yaw: 0, pitch: 0, vy: 0, onGround: true,
    eyeY: 0, light: false, fallTime: 0, fade: 0, fadeDir: 0,
    stepPhase: 0, speed: 0, lastSafe: null,
  };
  w.eyeY = w.y + EYE;
  w.lastSafe = { x: w.x, y: w.y, z: w.z };

  // Face along a way out, preferring the longest open view.
  const ways = [
    [world.link(s.i, s.j, 1, 0), 0], [world.link(s.i, s.j, 0, 0), Math.PI / 2],
    [world.link(s.i, s.j - 1, 1, 0), Math.PI], [world.link(s.i - 1, s.j, 0, 0), -Math.PI / 2],
  ];
  let best = -1;
  for (const [l, yaw] of ways) {
    if (!l) continue;
    const d = world.openness(w.x, w.eyeY, w.z, yaw);
    if (d > best) { best = d; w.yaw = yaw; }
  }

  w.forward = () => {
    const c = Math.cos(w.pitch);
    return [Math.sin(w.yaw) * c, Math.sin(w.pitch), Math.cos(w.yaw) * c];
  };

  w.look = (dx, dy) => {
    w.yaw -= dx;
    w.pitch = Math.max(-1.5, Math.min(1.5, w.pitch - dy));
  };

  // input: {fwd, strafe, run, turn}. Returns what happened, for sound.
  w.update = (dt, input, solids) => {
    dt = Math.min(dt, 0.25); // a long frame (hidden tab) must not become a long jump
    const out = { stepped: false, landed: false };
    w.yaw -= (input.turn || 0) * 1.8 * dt;
    let f = input.fwd || 0, st = input.strafe || 0;
    const len = Math.hypot(f, st);
    const speed = len > 0 ? (input.run ? RUN : WALK) : 0;
    if (len > 0) { f /= len; st /= len; }
    const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
    const px = w.x, pz = w.z, wasGround = w.onGround;
    moveBody(w, (fx * f - fz * st) * speed * dt, (fz * f + fx * st) * speed * dt, dt, solids);
    const moved = Math.hypot(w.x - px, w.z - pz);
    w.speed = dt > 0 ? moved / dt : 0;

    if (w.onGround) {
      if (!wasGround && w.fallTime > 0.4) out.landed = true;
      w.fallTime = 0;
      const stride = input.run ? 1.05 : 0.75;
      if (Math.floor((w.stepPhase + moved) / stride) > Math.floor(w.stepPhase / stride)) out.stepped = true;
      w.stepPhase += moved;
      const nx = Math.round(w.x / CELL) * CELL, nz = Math.round(w.z / CELL) * CELL;
      if ((w.x - nx) * (w.x - nx) + (w.z - nz) * (w.z - nz) < 4) w.lastSafe = { x: nx, y: w.y, z: nz };
    } else {
      w.fallTime += dt;
      if (w.fallTime > 6 && w.fadeDir === 0) w.fadeDir = 1;
    }

    // A long fall fades out and returns the walker to the last junction crossed.
    if (w.fadeDir > 0) {
      w.fade += dt / 1.2;
      if (w.fade >= 1) {
        w.fade = 1; w.fadeDir = -1;
        w.x = w.lastSafe.x; w.y = w.lastSafe.y; w.z = w.lastSafe.z;
        w.vy = 0; w.fallTime = 0; w.onGround = true; w.eyeY = w.y + EYE;
      }
    } else if (w.fadeDir < 0) {
      w.fade -= dt / 1.5;
      if (w.fade <= 0) { w.fade = 0; w.fadeDir = 0; }
    }

    const target = w.y + EYE, diff = target - w.eyeY;
    if (Math.abs(diff) > 1.2) w.eyeY = target - Math.sign(diff) * 1.2;
    else w.eyeY += diff * (1 - Math.exp(-dt * 12));
    return out;
  };

  return w;
}
