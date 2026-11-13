// Browser checks (development only): node tools/checks.mjs
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { launch, open } from './shot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', ['build.mjs'], { cwd: root });
const browser = await launch();
const results = [];
async function check(name, fn) {
  try { await fn(); results.push('ok   ' + name); }
  catch (e) { results.push('FAIL ' + name + ' — ' + String(e.message).split('\n')[0]); }
}

await check('picture is drawn, greyscale only, no console errors', async () => {
  const { page, errors } = await open(browser, 'auto=1&still=1&far=20&scale=1', { width: 640, height: 360 });
  const file = path.join(os.tmpdir(), 'glame-check.png');
  await page.screenshot({ path: file });
  const stats = JSON.parse(execFileSync('python3', ['-c', `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
px = list(im.getdata())
colour = sum(1 for r, g, b in px if not (r == g == b))
lum = [p[0] for p in px]
print(json.dumps({'colour': colour, 'min': min(lum), 'max': max(lum), 'levels': len(set(lum))}))
`, file]).toString());
  assert.deepEqual(errors, []);
  assert.equal(stats.colour, 0, 'coloured pixels: ' + stats.colour);
  assert.ok(stats.max - stats.min > 150 && stats.levels > 30, JSON.stringify(stats));
  await page.close();
});

await check('without WebGL2 the page says so', async () => {
  const { page } = await open(browser, 'auto=1', {
    wait: false,
    init: () => { HTMLCanvasElement.prototype.getContext = () => null; },
  });
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => getComputedStyle(document.getElementById('nogl')).display);
  const text = await page.evaluate(() => document.getElementById('nogl').textContent);
  assert.equal(shown, 'flex');
  assert.ok(text.includes('WebGL 2'));
  await page.close();
});

await check('resizing the window resizes the picture', async () => {
  const { page } = await open(browser, 'auto=1&still=1&far=20&scale=1', { width: 640, height: 360 });
  await page.setViewportSize({ width: 900, height: 400 });
  const before = await page.evaluate(() => window.__glame.frames);
  await page.waitForFunction((n) => window.__glame.frames >= n + 2, before, { timeout: 120000 });
  const s = await page.evaluate(() => {
    const c = document.getElementById('view');
    return { cw: c.clientWidth, ch: c.clientHeight, w: c.width, h: c.height, iw: innerWidth, ih: innerHeight, r: Math.min(devicePixelRatio, 1.5) };
  });
  assert.equal(s.cw, s.iw); assert.equal(s.ch, s.ih);
  assert.equal(s.w, Math.floor(s.cw * s.r)); assert.equal(s.h, Math.floor(s.ch * s.r));
  await page.close();
});

await check('when mouse capture is refused, dragging looks around', async () => {
  const { page, errors } = await open(browser, 'far=20&scale=1', {
    width: 640, height: 360,
    init: () => { Element.prototype.requestPointerLock = () => { throw new Error('refused'); }; },
  });
  await page.mouse.click(320, 180);
  const yaw0 = await page.evaluate(() => window.__glame.walker.yaw);
  await page.mouse.move(300, 180);
  await page.mouse.down();
  await page.mouse.move(420, 190, { steps: 6 });
  await page.mouse.up();
  const before = await page.evaluate(() => window.__glame.frames);
  await page.waitForFunction((n) => window.__glame.frames >= n + 2, before, { timeout: 120000 });
  const yaw1 = await page.evaluate(() => window.__glame.walker.yaw);
  assert.ok(Math.abs(yaw1 - yaw0) > 0.05, `yaw ${yaw0} -> ${yaw1}`);
  assert.deepEqual(errors, []);
  await page.close();
});

await check('keys walk, L toggles the light, Space pulls back', async () => {
  const { page } = await open(browser, 'far=20&scale=1', { width: 640, height: 360 });
  await page.mouse.click(320, 180);
  const a = await page.evaluate(() => ({ x: window.__glame.walker.x, z: window.__glame.walker.z, light: window.__glame.walker.light }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyL');
  await page.keyboard.down('Space');
  await page.waitForTimeout(2500);
  const b = await page.evaluate(() => ({ x: window.__glame.walker.x, z: window.__glame.walker.z, light: window.__glame.walker.light, pull: window.__glame.pullback.dist }));
  await page.keyboard.up('Space');
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 0.2, 'walker did not move');
  assert.equal(a.light, false); assert.equal(b.light, true);
  assert.ok(b.pull > 1, 'pull distance ' + b.pull);
  await page.close();
});

await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
