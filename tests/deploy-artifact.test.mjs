import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDistribution, validateDistribution } from '../scripts/prepare-deploy.mjs';

for (const channel of ['github-pages', 'cloudflare']) {
  test(`${channel} artifact is allowlisted, complete, and carries its source SHA`, t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'souanpt-artifact-test-'));
    const output = path.join(parent, channel);
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const result = buildDistribution({ channel, output, commitSha: 'a'.repeat(40), builtAt: '2026-10-21T00:00:00.000Z' });
    assert.equal(result.commit, 'a'.repeat(40));
    assert.equal(result.version, '3.20.0');
    assert.equal(validateDistribution(output, channel).info.channel, channel);
    assert.equal(fs.existsSync(path.join(output, 'docs')), false);
    assert.equal(fs.existsSync(path.join(output, 'README.md')), false);
    assert.equal(fs.existsSync(path.join(output, '.freebuff')), false);
    assert.equal(fs.existsSync(path.join(output, 'functions')), channel === 'cloudflare');
    assert.equal(fs.existsSync(path.join(output, 'firebase/edge-config.js')), channel === 'cloudflare',
      'the Functions import firebase/edge-config.js: without it Wrangler cannot build them');
    for (const file of ['manifest.webmanifest', 'sw.js', 'offline.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'])
      assert.equal(fs.existsSync(path.join(output, file)), true, `${file} ships for the home-screen shortcut`);
  });
}

test('the web app manifest is installable and the service worker never caches pages', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './app.html');
  const sizes = manifest.icons.filter(i => i.type === 'image/png').map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'Chrome needs 192 and 512 PNG icons');
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));

  const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
  assert.match(sw, /req\.mode !== 'navigate'/, 'only page navigations are intercepted');
  assert.doesNotMatch(sw, /cache\.put|caches\.open\([^)]*\)\.then\([^)]*put/, 'no response is written to the cache at runtime');
  assert.match(sw, /fetch\(req\)\.catch\(\(\) => caches\.match\('offline\.html'\)\)/, 'network first, offline page as fallback');

  for (const page of ['index.html', 'app.html']) {
    const html = fs.readFileSync(new URL(page, root), 'utf8');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, `${page} links the manifest`);
    assert.match(html, /<script src="js\/install-shortcut\.js" defer><\/script>/, `${page} loads the shortcut button`);
  }
});
