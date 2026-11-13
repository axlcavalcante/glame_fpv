// Bundles src/*.js into one self-contained index.html.
// A page opened by double-click cannot load modules, so imports and exports are stripped
// and every module shares one function scope.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const order = ['rng', 'world', 'collide', 'walker', 'pullback', 'input', 'render', 'audio', 'main'];

let code = '';
for (const name of order) {
  const file = path.join(root, 'src', name + '.js');
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n')
    .filter((l) => !/^\s*import\s.*from\s/.test(l))
    .map((l) => l.replace(/^export\s+/, ''));
  code += '// ---- ' + name + ' ----\n' + lines.join('\n') + '\n';
}

const pageFile = path.join(root, 'src', 'page.html');
const page = existsSync(pageFile)
  ? readFileSync(pageFile, 'utf8')
  : '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Glame!</title></head><body><script>/*SCRIPT*/</script></body></html>';

const out = page.replace('/*SCRIPT*/', () => '(function(){\n"use strict";\n' + code + '})();');
writeFileSync(path.join(root, 'index.html'), out);
console.log('index.html', (out.length / 1024).toFixed(1) + ' kB');
