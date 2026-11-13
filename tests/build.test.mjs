import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('build produces one self-contained page', () => {
  execFileSync('node', ['build.mjs'], { cwd: root });
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const line of html.split('\n')) {
    assert.ok(!/^\s*import\s/.test(line), 'import left in: ' + line);
    assert.ok(!/^\s*export\s/.test(line), 'export left in: ' + line);
  }
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(html.includes('<canvas') || html.includes('<script'));
});
