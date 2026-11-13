// The pull-back view: the camera leaves the walker and drifts far out into the most
// open direction, until the walker is a speck against the structure.

export const PULL_MAX = 400;
export const IDLE_BEFORE_PULL = 8;

function dirOf(az, el) {
  const c = Math.cos(el);
  return [c * Math.sin(az), Math.sin(el), c * Math.cos(az)];
}

export function makePullback() {
  const p = { amount: 0, dist: 0, az: 0, el: 0.5, target: 0, active: false, auto: false };

  function choose(walker, world) {
    const fw = walker.forward();
    let best = -Infinity;
    for (const elDeg of [10, 30, 55]) {
      const el = elDeg * Math.PI / 180;
      for (let a = 0; a < 16; a++) {
        const az = a * Math.PI / 8, d = dirOf(az, el);
        const free = world.freeDistance(walker.x, walker.eyeY, walker.z, d[0], d[1], d[2], PULL_MAX);
        const behind = -(d[0] * fw[0] + d[2] * fw[2]);
        const score = free + 60 * behind + (elDeg === 30 ? 20 : 0);
        if (score > best) { best = score; p.az = az; p.el = el; }
      }
    }
  }

  // st: {held, idleSeconds, moved, orbitDX, orbitDY}
  p.update = (dt, st, walker, world) => {
    if (!p.auto && !st.held && st.idleSeconds >= IDLE_BEFORE_PULL) p.auto = true;
    if (p.auto && st.moved) p.auto = false;
    const want = !!st.held || p.auto;
    if (want && !p.active) choose(walker, world);
    p.active = want;
    if (want) {
      p.az -= st.orbitDX || 0;
      p.el = Math.max(-0.35, Math.min(1.45, p.el + (st.orbitDY || 0)));
      const d = dirOf(p.az, p.el);
      const free = world.freeDistance(walker.x, walker.eyeY, walker.z, d[0], d[1], d[2], PULL_MAX);
      p.target = Math.max(0, Math.min(PULL_MAX, free - 2));
      const tau = p.target < p.dist ? 0.25 : 1.5;
      p.dist += (p.target - p.dist) * (1 - Math.exp(-dt / tau));
      p.amount = Math.min(1, p.amount + dt / 0.6);
    } else if (p.dist > 0 || p.amount > 0) {
      p.dist = p.dist * Math.exp(-dt / 0.45) - 6 * dt;
      p.amount = Math.max(0, p.amount - dt);
      if (p.dist < 0.02) { p.dist = 0; p.amount = 0; }
    }
  };

  p.camera = (walker) => {
    const fp = walker.forward();
    if (p.dist <= 0) return { pos: [walker.x, walker.eyeY, walker.z], fwd: fp, figureVisible: false, dist: 0 };
    const d = dirOf(p.az, p.el);
    const pos = [walker.x + d[0] * p.dist, walker.eyeY + d[1] * p.dist, walker.z + d[2] * p.dist];
    let lx = walker.x - pos[0], ly = walker.y + 0.95 - pos[1], lz = walker.z - pos[2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    let b = Math.min(1, p.dist / 6);
    b = b * b * (3 - 2 * b);
    let fx = fp[0] + (lx - fp[0]) * b, fy = fp[1] + (ly - fp[1]) * b, fz = fp[2] + (lz - fp[2]) * b;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 0.15) { fx = lx; fy = ly; fz = lz; } else { fx /= fl; fy /= fl; fz /= fl; }
    return { pos, fwd: [fx, fy, fz], figureVisible: p.dist >= 1, dist: p.dist };
  };

  return p;
}
