import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pagesConfig, writePagesConfig } from '../scripts/write-pages-config.mjs';

test('Pages config binds HUB_PAIR and is written NEXT TO the published folder, never inside', () => {
  const tpl = fs.readFileSync(new URL('../cloudflare/pages.wrangler.toml', import.meta.url), 'utf8');
  assert.match(tpl, /name = "souanpthub"/);
  assert.match(tpl, /\[\[kv_namespaces\]\]\s*binding = "HUB_PAIR"\s*id = "[0-9a-f]{32}"/);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-cfg-'));
  const dist = path.join(parent, 'souanpt-cloudflare-abc');
  fs.mkdirSync(dist); fs.writeFileSync(path.join(dist, 'build-info.json'), '{}');
  const r = writePagesConfig(dist);
  assert.equal(r.file, path.join(parent, 'wrangler.toml'));
  assert.equal(fs.existsSync(path.join(dist, 'wrangler.toml')), false, 'not served with the site');
  assert.match(fs.readFileSync(r.file, 'utf8'), /pages_build_output_dir = "souanpt-cloudflare-abc"/);
  assert.throws(() => pagesConfig(path.join(parent, 'bad name;rm')), /inattendu/);
  assert.throws(() => writePagesConfig(path.join(parent, 'missing')), /introuvable/);
  fs.rmSync(parent, { recursive: true, force: true });
  const wf = fs.readFileSync(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8');
  assert.match(wf, /node scripts\/write-pages-config\.mjs "\$out"/, 'the GitHub workflow keeps the binding too');
  assert.match(wf, /workingDirectory: \$\{\{ runner\.temp \}\}\r?\n\s+command: pages deploy souanpt-cloudflare-\$\{\{ github\.sha \}\}/);
});

test('Business merged: one « Clients & Projets » entry with Projets / Demandes & Devis / Portails tabs', () => {
  const src = fs.readFileSync(new URL('../js/business-nav.js', import.meta.url), 'utf8');
  assert.match(src, /\['cp', '🗂', 'Projets'\], \['devis', '📥', 'Demandes & Devis'\], \['portals', '🔗', 'Portails'\]/);
  assert.match(src, /\['devis', 'portals'\]\.forEach\(id => \{ const n = document\.querySelector\(`\.sidebar \.ni\[data-page="\$\{id\}"\]`\); if \(n\) \{ n\.hidden = true;/, 'merged entries leave the sidebar');
  assert.match(src, /new MutationObserver\(sync\)\.observe\(src/, 'new requests stay visible on the sidebar entry');
  const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /\.ni\[hidden\]\{display:none!important\}/, 'hidden entries really disappear (.ni sets display)');
  assert.match(app, /<script src="js\/business-nav\.js"><\/script>/);
  for (const id of ['page-cp', 'page-devis', 'page-portals']) assert.match(app, new RegExp(`id="${id}"`), id + ' kept: old links keep working');
});
