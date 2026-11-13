// Drawing. Three passes:
//   1. every box (instanced) into a tone + normal target with a depth texture;
//   2. composite to the screen: ink outlines, haze towards the void grey, paper grain;
//   3. pin-point lights on top.
// Everything is black, white and grey: the output is a single tone written to r, g and b.

export const NEAR = 0.12, FAR = 9000, HAZE = 1000;

const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCenter;
layout(location=3) in vec3 aHalf;
layout(location=4) in vec2 aMS;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uFigPos;
uniform vec3 uFigRot; // sin, cos, on
out vec3 vW;
out vec3 vN;
flat out vec2 vMS;
void main() {
  vec3 w = aCenter + aPos * aHalf;
  vec3 n = aNrm;
  if (uFigRot.z > 0.5) {
    // The figure is given in walker space (x right, z forward) and turned to face its heading.
    vec2 r = vec2(-uFigRot.y, uFigRot.x), f = vec2(uFigRot.x, uFigRot.y);
    w = vec3(uFigPos.xz + w.x * r + w.z * f, uFigPos.y + w.y).xzy;
    n = vec3(n.x * r + n.z * f, n.y).xzy;
  }
  vW = w; vN = n; vMS = aMS;
  gl_Position = uVP * vec4(w - uCam, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
flat in vec2 vMS;
uniform vec4 uLight;   // walker's light: xyz position, w on/off
uniform float uAmbient;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oNrm;

float h21(vec2 p) {
  p = mod(p, 1024.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Thin seams every 'period' metres; they stay about a pixel wide, then fade to their average.
float lines(float x, float period, float width, float fw) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  float w = max(width, min(fw, period * 0.06));
  float cov = clamp((w * 0.5 - d) / max(fw, 1e-5) + 0.5, 0.0, 1.0);
  return mix(cov, w / period, smoothstep(0.2, 0.8, fw / period));
}

// Pen hatching fixed to the surface, with a stroke spacing that stays near uniform on
// screen: every other stroke thins out and vanishes as the surface recedes.
float hatch(float x, float cover, float fw) {
  if (cover <= 0.003) return 0.0;
  fw = max(fw, 1e-4);
  float l = log2(fw * 4.0 / 0.04);
  float fl = floor(l), fr = l - fl;
  float p = 0.04 * exp2(fl);
  float xe = x / (2.0 * p);
  float de = abs(fract(xe) - 0.5) * 2.0 * p;
  float dn = abs(fract(xe + 0.5) - 0.5) * 2.0 * p;
  float we = cover * p * (1.0 + fr), wo = cover * p * (1.0 - fr);
  float a = clamp((we * 0.5 - de) / fw + 0.5, 0.0, 1.0);
  float b = clamp((wo * 0.5 - dn) / fw + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.3, 1.0 - fr);
  return max(a, b);
}

void main() {
  vec3 n = normalize(vN);
  vec3 an = abs(n);
  int mat = int(vMS.x + 0.5);
  float sd = vMS.y;
  vec2 uv;
  float base;
  bool side = an.y < 0.5;
  if (!side) { uv = vW.xz; base = n.y > 0.0 ? 0.86 : 0.04; }
  else if (an.x > 0.5) { uv = vec2(vW.z, vW.y); base = n.x > 0.0 ? 0.58 : 0.34; }
  else { uv = vec2(vW.x, vW.y); base = n.z > 0.0 ? 0.72 : 0.22; }
  float fwu = fwidth(uv.x), fwv = fwidth(uv.y);
  float fw = max(fwu, fwv);
  float h1c = side ? uv.x + uv.y * 0.5 : uv.x + uv.y;
  float h2c = side ? uv.x - uv.y * 0.5 : uv.x - uv.y;
  float h1w = fwidth(h1c), h2w = fwidth(h2c);

  float tone = base;
  float ink = 0.0;
  float strokes = 1.0;
  if (mat == 0 || mat == 2) {
    float sc = mat == 0 ? 1.0 : 2.0;
    tone *= 0.76 + 0.4 * h21(floor(uv / vec2(32.0, 64.0)) + sd * 17.0);
    if (side) {
      float row = floor(uv.y / (4.0 * sc));
      float off = h21(vec2(row, sd * 91.0)) * 8.0 * sc;
      vec2 pid = vec2(floor((uv.x + off) / (8.0 * sc)), row);
      float r = h21(pid + sd * 53.0);
      float vis = 1.0 - smoothstep(0.12, 0.5, fw / (4.0 * sc));
      tone *= mix(1.0, 0.8 + 0.34 * r, vis);
      // Some panels are cut into small plates with dark openings.
      if (h21(pid * 1.7 + 9.0 + sd * 11.0) > 0.5) {
        float r3 = h21(vec2(floor((uv.x + off) / (2.0 * sc)), floor(uv.y / sc)) + sd * 71.0);
        float vis2 = 1.0 - smoothstep(0.1, 0.45, fw / sc);
        tone *= mix(1.0, 0.84 + 0.28 * r3, vis2);
        if (r3 > 0.88) tone = mix(tone, 0.05, vis2);
        ink = max(ink, 0.7 * lines(uv.y, sc, 0.02, fwv));
        ink = max(ink, 0.7 * lines(uv.x + off, 2.0 * sc, 0.02, fwu));
      }
      if (r > 0.95) tone = mix(tone, 0.05, vis);
      ink = max(ink, lines(uv.y, 4.0 * sc, 0.04, fwv));
      ink = max(ink, lines(uv.x + off, 8.0 * sc, 0.04, fwu));
      float st = h21(vec2(floor(uv.x / 0.7), floor(uv.y / 48.0) + sd * 7.0));
      tone *= 1.0 - 0.3 * step(0.78, st) * (1.0 - smoothstep(0.1, 0.5, fwu / 0.7));
    } else {
      ink = max(ink, lines(uv.x, 8.0, 0.04, fwu));
      ink = max(ink, lines(uv.y, 8.0, 0.04, fwv));
    }
    if (mat == 2) tone *= 0.6;
  } else if (mat == 1) {
    ink = max(ink, 0.8 * lines(uv.x, 1.0, 0.015, fwu));
    ink = max(ink, 0.8 * lines(uv.y, 1.0, 0.015, fwv));
    tone *= 0.95 + 0.05 * h21(floor(uv) + sd * 31.0);
  } else if (mat == 3) {
    tone = 0.1 + 0.12 * base; strokes = 0.0;
  } else {
    tone = 0.02; strokes = 0.0;
  }
  tone *= uAmbient;

  // Flat screentone steps, then pen strokes over the mid and dark tones.
  tone = clamp(tone, 0.0, 1.0);
  float q = mix(tone, floor(tone * 6.0 + 0.5) / 6.0, 0.75);
  // The walker's light: a soft pool that lifts nearby surfaces.
  if (uLight.w > 0.5 && mat != 4) {
    vec3 lv = uLight.xyz - vW;
    float d2 = dot(lv, lv);
    float ndl = max(dot(n, lv * inversesqrt(d2 + 1e-4)), 0.0);
    float a = (0.25 + 0.75 * ndl) / (1.0 + d2 / 28.0);
    q += (0.96 - q) * clamp(a, 0.0, 0.8);
  }
  float D = 1.0 - q;
  float c1 = strokes * step(0.38, D) * clamp(D * 1.3 - 0.3, 0.24, 0.5);
  float c2 = strokes * step(0.66, D) * clamp((D - 0.6) * 1.6, 0.24, 0.55);
  float k1 = hatch(h1c, c1, h1w);
  float k2 = hatch(h2c, c2, h2w);
  float v = q * (1.0 - 0.55 * k1) * (1.0 - 0.6 * k2);
  v = min(v, 1.0 - 0.8 * ink);
  v *= 1.0 - smoothstep(0.88, 0.96, D);
  oCol = vec4(v, 0.0, 0.0, 1.0);
  oNrm = vec4(n * 0.5 + 0.5, 1.0);
}`;

const QUAD_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BG_GLSL = `
float bgTone(vec3 d) {
  return d.y > 0.0 ? mix(0.62, 0.28, pow(d.y, 0.8)) : mix(0.62, 0.03, pow(-d.y, 0.55));
}`;

const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uCol;
uniform sampler2D uNrm;
uniform highp sampler2D uDepth;
uniform vec2 uPx;
uniform vec3 uRight, uUp, uFwd;
uniform vec2 uTan;
uniform float uNear, uFar, uHaze, uFade;
in vec2 vUV;
out vec4 o;
${BG_GLSL}
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 ndc = vUV * 2.0 - 1.0;
  vec3 dir = normalize(uFwd + uRight * ndc.x * uTan.x + uUp * ndc.y * uTan.y);
  float bg = bgTone(dir);
  float z0 = texture(uDepth, vUV).r;
  float c = bg;
  if (z0 < 1.0) {
    float zv = uNear * uFar / (uFar - z0 * (uFar - uNear));
    float dist = zv * length(vec3(ndc * uTan, 1.0));
    float haze = 1.0 - exp(-dist / uHaze);
    float zl = texture(uDepth, vUV - vec2(uPx.x, 0.0)).r, zr = texture(uDepth, vUV + vec2(uPx.x, 0.0)).r;
    float zd = texture(uDepth, vUV - vec2(0.0, uPx.y)).r, zu = texture(uDepth, vUV + vec2(0.0, uPx.y)).r;
    // Depth is flat across a plane, so its curvature marks silhouettes; one-sided, so the
    // line sits on the nearer surface.
    float lap = max(zl + zr - 2.0 * z0, 0.0) + max(zu + zd - 2.0 * z0, 0.0);
    float thr = 0.012 * (1.0 - z0);
    float e = smoothstep(thr, thr * 2.5, lap);
    vec3 n0 = texture(uNrm, vUV).xyz;
    vec3 nr = texture(uNrm, vUV + vec2(uPx.x, 0.0)).xyz, nd = texture(uNrm, vUV - vec2(0.0, uPx.y)).xyz;
    float cr = dot(abs(n0 - nr), vec3(1.0)) * step(abs(zr - z0), thr * 4.0);
    float cd = dot(abs(n0 - nd), vec3(1.0)) * step(abs(zd - z0), thr * 4.0);
    e = max(e, step(0.3, max(cr, cd)));
    c = mix(texture(uCol, vUV).r, 0.0, e * 0.95);
    c = mix(c, bg, haze);
  }
  c += (h21(gl_FragCoord.xy) - 0.5) * 0.055;
  vec2 q = vUV - 0.5;
  c *= 1.0 - 0.5 * dot(q, q);
  c = mix(c, 0.0, uFade);
  o = vec4(vec3(clamp(c, 0.0, 1.0)), 1.0);
}`;

const POINT_VS = `#version 300 es
layout(location=0) in vec4 aP;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uPxScale, uMinSize;
out float vDist;
void main() {
  vec3 rel = aP.xyz - uCam;
  gl_Position = uVP * vec4(rel, 1.0);
  vDist = length(rel);
  gl_PointSize = clamp(aP.w * uPxScale / max(gl_Position.w, 0.01), uMinSize, 9.0);
}`;

const POINT_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uDepth;
uniform vec2 uPx;
uniform float uHaze, uFade;
in float vDist;
out vec4 o;
void main() {
  float zs = texture(uDepth, gl_FragCoord.xy * uPx).r;
  if (gl_FragCoord.z > zs + 2e-7 + 0.004 * (1.0 - zs)) discard;
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q);
  if (r > 0.25) discard;
  float haze = 1.0 - exp(-vDist / uHaze);
  o = vec4(vec3(1.0), (1.0 - haze * haze) * (1.0 - uFade) * smoothstep(0.25, 0.08, r));
}`;

function cubeMesh() {
  // 36 vertices: position (±1) and normal, counter-clockwise seen from outside.
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const out = [];
  for (const [n, u, v] of faces) {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      out.push(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b, n[0], n[1], n[2]);
    }
  }
  return new Float32Array(out);
}

export function makeRenderer(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (!gl) return null;

  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  const scene = program(SCENE_VS, SCENE_FS);
  const comp = program(QUAD_VS, COMP_FS);
  const points = program(POINT_VS, POINT_FS);

  const cube = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cube);
  gl.bufferData(gl.ARRAY_BUFFER, cubeMesh(), gl.STATIC_DRAW);

  function boxSet() {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cube);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 32, 24); gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    return { vao, buf, count: 0 };
  }
  function pointSet() {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
    return { vao, buf, count: 0 };
  }
  function fill(set, data, stride) {
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    set.count = data.length / stride;
  }

  const rings = [0, 1, 2, 3].map(() => ({ boxes: boxSet(), lights: pointSet() }));
  const figure = boxSet(), lamp = pointSet();
  const emptyVao = gl.createVertexArray();

  // Off-screen target: tone, normal, depth.
  const fbo = gl.createFramebuffer();
  const tCol = gl.createTexture(), tNrm = gl.createTexture(), tDepth = gl.createTexture();
  let W = 0, H = 0;
  function target(w, h) {
    W = w; H = h;
    const tex = (t, internal, format, type) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    tex(tCol, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    tex(tNrm, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    tex(tDepth, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tCol, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tNrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const R = { scale: 1, maxPixelRatio: 1.5, boxCount: 0 };

  R.resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, R.maxPixelRatio) * R.scale;
    const w = Math.max(2, Math.floor(canvas.clientWidth * ratio)), h = Math.max(2, Math.floor(canvas.clientHeight * ratio));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    if (w !== W || h !== H) target(w, h);
  };

  R.setRing = (n, boxes, lights) => {
    fill(rings[n].boxes, boxes, 8);
    fill(rings[n].lights, lights, 4);
    R.boxCount = rings.reduce((a, r) => a + r.boxes.count, 0);
  };

  const vp = new Float32Array(16);

  // s: {pos, fwd, fovY, lightOn, lightPos, lampVisible, figure, figurePos, figureYaw, fade}
  R.draw = (s) => {
    R.resize();
    const f = s.fwd;
    let rx = -f[2], rz = f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const right = [rx, 0, rz];
    const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const ty = Math.tan(s.fovY / 2), tx = ty * W / H;
    const a = 1 / tx, b = 1 / ty, c = (FAR + NEAR) / (NEAR - FAR), d = 2 * FAR * NEAR / (NEAR - FAR);
    // projection * view rotation (the camera position is subtracted in the shader)
    vp[0] = a * right[0]; vp[1] = b * up[0]; vp[2] = -c * f[0]; vp[3] = f[0];
    vp[4] = a * right[1]; vp[5] = b * up[1]; vp[6] = -c * f[1]; vp[7] = f[1];
    vp[8] = a * right[2]; vp[9] = b * up[2]; vp[10] = -c * f[2]; vp[11] = f[2];
    vp[12] = 0; vp[13] = 0; vp[14] = d; vp[15] = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 0.5, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1.0]);

    gl.useProgram(scene.p);
    gl.uniformMatrix4fv(scene.u.uVP, false, vp);
    gl.uniform3f(scene.u.uCam, s.pos[0], s.pos[1], s.pos[2]);
    gl.uniform4f(scene.u.uLight, s.lightPos[0], s.lightPos[1], s.lightPos[2], s.lightOn ? 1 : 0);
    gl.uniform1f(scene.u.uAmbient, s.ambient === undefined ? 0.92 : s.ambient);
    gl.uniform3f(scene.u.uFigRot, 0, 1, 0);
    for (const r of rings) {
      if (!r.boxes.count) continue;
      gl.bindVertexArray(r.boxes.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, r.boxes.count);
    }
    if (s.figure) {
      fill(figure, s.figure, 8);
      gl.uniform3f(scene.u.uFigPos, s.figurePos[0], s.figurePos[1], s.figurePos[2]);
      gl.uniform3f(scene.u.uFigRot, Math.sin(s.figureYaw), Math.cos(s.figureYaw), 1);
      gl.bindVertexArray(figure.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, figure.count);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tCol);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tNrm);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tDepth);
    gl.useProgram(comp.p);
    gl.uniform1i(comp.u.uCol, 0); gl.uniform1i(comp.u.uNrm, 1); gl.uniform1i(comp.u.uDepth, 2);
    gl.uniform2f(comp.u.uPx, 1 / W, 1 / H);
    gl.uniform3fv(comp.u.uRight, right); gl.uniform3fv(comp.u.uUp, up); gl.uniform3fv(comp.u.uFwd, f);
    gl.uniform2f(comp.u.uTan, tx, ty);
    gl.uniform1f(comp.u.uNear, NEAR); gl.uniform1f(comp.u.uFar, FAR); gl.uniform1f(comp.u.uHaze, HAZE);
    gl.uniform1f(comp.u.uFade, s.fade || 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(points.p);
    gl.uniformMatrix4fv(points.u.uVP, false, vp);
    gl.uniform3f(points.u.uCam, s.pos[0], s.pos[1], s.pos[2]);
    gl.uniform1i(points.u.uDepth, 2);
    gl.uniform2f(points.u.uPx, 1 / W, 1 / H);
    gl.uniform1f(points.u.uPxScale, H / (2 * ty));
    gl.uniform1f(points.u.uHaze, HAZE);
    gl.uniform1f(points.u.uFade, s.fade || 0);
    gl.uniform1f(points.u.uMinSize, 1.6 * (W / Math.max(1, canvas.clientWidth)));
    for (const r of rings) {
      if (!r.lights.count) continue;
      gl.bindVertexArray(r.lights.vao);
      gl.drawArrays(gl.POINTS, 0, r.lights.count);
    }
    if (s.lampVisible) {
      fill(lamp, new Float32Array([s.lightPos[0], s.lightPos[1], s.lightPos[2], 0.35]), 4);
      gl.uniform1f(points.u.uMinSize, 3.2 * (W / Math.max(1, canvas.clientWidth)));
      gl.bindVertexArray(lamp.vao);
      gl.drawArrays(gl.POINTS, 0, 1);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  };

  R.resize();
  return R;
}
