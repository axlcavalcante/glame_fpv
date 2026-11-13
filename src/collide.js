// Moving a box-shaped body through solid boxes: slide along walls, climb small steps,
// land exactly on whatever is below.

export const BODY = { half: 0.3, height: 1.75, step: 0.3, gravity: 20, maxFall: 60 };

const scratch = [];

// Collects the boxes near a point as [x0,y0,z0,x1,y1,z1, ...].
export function gather(solids, x, y, z, rh, rv, out) {
  out.length = 0;
  for (const arr of solids) {
    for (let k = 0; k < arr.length; k += 8) {
      if (Math.abs(arr[k] - x) > arr[k + 3] + rh) continue;
      if (Math.abs(arr[k + 2] - z) > arr[k + 5] + rh) continue;
      if (Math.abs(arr[k + 1] - y) > arr[k + 4] + rv) continue;
      out.push(arr[k] - arr[k + 3], arr[k + 1] - arr[k + 4], arr[k + 2] - arr[k + 5],
        arr[k] + arr[k + 3], arr[k + 1] + arr[k + 4], arr[k + 2] + arr[k + 5]);
    }
  }
  return out;
}

function hit(near, x, y, z, half, height) {
  const e = 1e-4;
  const x0 = x - half + e, x1 = x + half - e, z0 = z - half + e, z1 = z + half - e, y0 = y + 0.02, y1 = y + height;
  for (let k = 0; k < near.length; k += 6) {
    if (near[k] < x1 && near[k + 3] > x0 && near[k + 2] < z1 && near[k + 5] > z0 && near[k + 1] < y1 && near[k + 4] > y0) return true;
  }
  return false;
}

// Highest surface under the body between yTop and yBottom, or -Infinity.
function ground(near, x, z, half, yTop, yBottom) {
  const e = 1e-4;
  const x0 = x - half + e, x1 = x + half - e, z0 = z - half + e, z1 = z + half - e;
  let best = -Infinity;
  for (let k = 0; k < near.length; k += 6) {
    const top = near[k + 4];
    if (top > yTop + e || top < yBottom || top <= best) continue;
    if (near[k] < x1 && near[k + 3] > x0 && near[k + 2] < z1 && near[k + 5] > z0) best = top;
  }
  return best;
}

// body: {x, y, z, vy, onGround}; y is the feet. dx, dz: horizontal move wanted over dt.
export function moveBody(body, dx, dz, dt, solids, opts) {
  const o = opts || BODY;
  const dist = Math.hypot(dx, dz);
  const fall = Math.abs(body.vy) * dt + o.gravity * dt * dt + 1;
  const near = gather(solids, body.x, body.y, body.z, dist + o.half + 1, fall + o.height + 1, scratch);
  const n = Math.max(1, Math.ceil(dist / 0.15));
  const sx = dx / n, sz = dz / n, sdt = dt / n;
  for (let s = 0; s < n; s++) {
    let lifted = false;
    if (sx !== 0) {
      if (!hit(near, body.x + sx, body.y, body.z, o.half, o.height)) body.x += sx;
      else if (body.onGround && !hit(near, body.x, body.y + o.step, body.z, o.half, o.height)
        && !hit(near, body.x + sx, body.y + o.step, body.z, o.half, o.height)) { body.x += sx; body.y += o.step; lifted = true; }
    }
    if (sz !== 0) {
      if (!hit(near, body.x, body.y, body.z + sz, o.half, o.height)) body.z += sz;
      else if (body.onGround && !lifted && !hit(near, body.x, body.y + o.step, body.z, o.half, o.height)
        && !hit(near, body.x, body.y + o.step, body.z + sz, o.half, o.height)) { body.z += sz; body.y += o.step; lifted = true; }
    }
    body.vy = Math.max(-o.maxFall, body.vy - o.gravity * sdt);
    const dy = body.vy * sdt;
    const reach = body.onGround || lifted ? o.step + 0.02 : 0;
    const g = ground(near, body.x, body.z, o.half, body.y, body.y + dy - reach);
    if (g !== -Infinity) { body.y = g; body.vy = 0; body.onGround = true; }
    else { body.y += dy; body.onGround = false; }
  }
}
