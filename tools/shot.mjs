// Headless Chrome helper for screenshots and browser checks (development only).
//   node tools/shot.mjs out.png "auto=1&still=1&pos=0,0,0&yaw=1" [width height]
// Needs Playwright and a Chrome it can drive; set CHROME to the browser's path if needed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* fall through */ }
  return import('/opt/npm-tools/node_modules/playwright/index.mjs');
}

export async function launch() {
  const { chromium } = await loadPlaywright();
  const exe = process.env.CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  return chromium.launch({
    executablePath: exe,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
}

// Opens the built page. Returns {page, errors}.
export async function open(browser, query = '', { width = 1280, height = 720, frames = 3, init = null, wait = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  if (init) await page.addInitScript(init);
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href + (query ? '?' + query : ''));
  if (wait) await page.waitForFunction((n) => window.__glame && (window.__glame.frames >= n || window.__glame.error), frames, { timeout: 180000 });
  return { page, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out = 'shot.png', query = 'auto=1', w = '1280', h = '720'] = process.argv.slice(2);
  execFileSync('node', ['build.mjs'], { cwd: root });
  const browser = await launch();
  const t = Date.now();
  const { page, errors } = await open(browser, query, { width: +w, height: +h });
  const info = await page.evaluate(() => ({
    error: window.__glame.error, frames: window.__glame.frames, boxes: window.__glame.renderer && window.__glame.renderer.boxCount,
    pos: window.__glame.walker && [window.__glame.walker.x, window.__glame.walker.y, window.__glame.walker.z, window.__glame.walker.yaw],
    pull: window.__glame.pullback && window.__glame.pullback.dist,
  }));
  await page.screenshot({ path: out });
  await browser.close();
  console.log(JSON.stringify({ ...info, errors, ms: Date.now() - t }));
  if (errors.length || info.error) process.exit(1);
}
