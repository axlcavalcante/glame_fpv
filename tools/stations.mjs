// Takes several screenshots in one browser session: node tools/stations.mjs outdir name=query ...
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './shot.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [outdir, ...specs] = process.argv.slice(2);
execFileSync('node', ['build.mjs'], { cwd: root });
const browser = await launch();
let bad = 0;
for (const spec of specs) {
  const k = spec.indexOf('=');
  const name = spec.slice(0, k), query = spec.slice(k + 1);
  const t = Date.now();
  const { page, errors } = await open(browser, query, { width: 960, height: 540 });
  const err = await page.evaluate(() => window.__glame.error);
  await page.screenshot({ path: path.join(outdir, name + '.png') });
  await page.close();
  if (errors.length || err) { bad++; console.log(name, 'ERROR', err, errors.join(' | ').slice(0, 600)); }
  else console.log(name, 'ok', Date.now() - t, 'ms');
}
await browser.close();
process.exit(bad ? 1 : 0);
