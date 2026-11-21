import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../js/behance-viewer.js', import.meta.url), 'utf8'), ctx);
const BV = ctx.BehanceViewer;
const plain = v => JSON.parse(JSON.stringify(v));

test('only real Behance project addresses yield an id', () => {
  assert.equal(BV.projectId('https://www.behance.net/gallery/241392957/Miniatures-2026'), '241392957');
  assert.equal(BV.projectId('https://behance.net/gallery/241392957'), '241392957');
  assert.equal(BV.projectId('https://www.behance.net/embed/project/241392957?ilo0=1'), '241392957');
  for (const bad of [
    'https://www.behance.net.evil.test/gallery/241392957/x',
    'https://evil.test/www.behance.net/gallery/241392957',
    'https://user:pw@www.behance.net/gallery/241392957',
    'https://www.behance.net:8443/gallery/241392957',
    'https://cdn.behance.net/gallery/241392957',
    'https://www.behance.net/gallery/abc/x',
    'https://www.behance.net/souanpt',
    'javascript:alert(1)//www.behance.net/gallery/241392957',
    'ftp://www.behance.net/gallery/241392957',
    '',
  ]) assert.equal(BV.projectId(bad), null, bad);
});

test('the iframe source is always the official embed format', () => {
  assert.equal(BV.embedUrl('241392957'), 'https://www.behance.net/embed/project/241392957?ilo0=1');
  assert.equal(BV.embedUrl('241392957"><script>'), null);
  assert.equal(BV.embedUrl('12'), null);
});

test('a pasted embed code only gives back a validated id, never its HTML', () => {
  const official = '<iframe src="https://www.behance.net/embed/project/241392957?ilo0=1" height="316" width="404" allowfullscreen lazyload frameborder="0" allow="clipboard-write" refererPolicy="strict-origin-when-cross-origin"></iframe>';
  assert.equal(BV.idFromEmbedCode(official), '241392957');
  assert.equal(BV.idFromEmbedCode('<iframe src="https://evil.test/embed/project/241392957"></iframe>'), null);
  assert.equal(BV.idFromEmbedCode('<iframe src="javascript:alert(1)"></iframe>'), null);
  assert.equal(BV.idFromEmbedCode('<script src="https://www.behance.net/embed/project/241392957"></script>'), null);
  assert.equal(BV.idFromEmbedCode('https://www.behance.net/gallery/241392957/x'), '241392957');
});

test('settings and crop values are bounded, with backward-compatible defaults', () => {
  const d = plain(BV.sanitizeConfig(undefined));
  assert.equal(d.enabled, false, 'existing sites stay unchanged until enabled');
  assert.equal(d.style, 'perspective');
  const c = plain(BV.sanitizeConfig({ enabled: true, style: 'neon<script>', width: 500, tilt: -40, radius: 'x', effects: { intensity: 900, grain: 0 },
    crop: { desk: { zoom: 9, x: -999, y: 1e6 }, mob: { zoom: 'a' } } }));
  assert.equal(c.style, 'perspective');
  assert.equal(c.width, 100); assert.equal(c.tilt, 0); assert.equal(c.radius, 16);
  assert.equal(c.effects.intensity, 100); assert.equal(c.effects.grain, false); assert.equal(c.effects.streaks, true);
  assert.deepEqual(c.crop, { desk: { zoom: 3, x: -50, y: 600 }, mob: { zoom: 1, x: 0, y: 0 } });
});

test('published data cannot break out of its script tag and only carries safe images', () => {
  const projects = [
    { id: 'p1', title: '</script><script>alert(1)</script>', url: 'https://www.behance.net/gallery/241392957/x',
      cover: 'javascript:alert(1)', preview: { png: 'data:text/html;base64,PHNjcmlwdD4=', crop: { desk: { zoom: 2 } } } },
    { id: 'p2', title: 'Image', url: 'https://www.behance.net/gallery/123456789/y', cover: 'https://mir-s3-cdn-cf.behance.net/x.png',
      preview: { png: 'data:image/png;base64,iVBORw0KGgo=' } },
    { id: 'p3', title: 'Pas Behance', url: 'https://example.test/p3' },
  ];
  assert.equal(BV.dataScript(projects, { enabled: false }), '', 'nothing is published while disabled');
  const html = BV.dataScript(projects, { enabled: true });
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'only the closing tag of the data block');
  const data = JSON.parse(html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  assert.deepEqual(Object.keys(data.projects), ['p1', 'p2']);
  assert.equal(data.projects.p1.title, '</script><script>alert(1)</script>', 'kept as data, decoded safely by JSON.parse');
  assert.equal(data.projects.p1.cover, '');
  assert.equal(data.projects.p1.crop.desk.zoom, 2);
  // Mode PNG supprimé : une ancienne image d'aperçu enregistrée n'est plus publiée.
  assert.equal('png' in data.projects.p2, false);
  assert.equal(JSON.stringify(data).includes('iVBORw0KGgo'), false);
  assert.equal(data.projects.p2.cover, 'https://mir-s3-cdn-cf.behance.net/x.png');
});

test('the inlined runtime is self-contained and keeps decorations click-through', () => {
  const tag = BV.scriptTag();
  assert.doesNotMatch(tag.slice(8, -9), /<\/script/i);
  const src = BV.runtime.toString();
  assert.match(src, /'https:\/\/www\.behance\.net\/embed\/project\/' \+ cur\.be \+ '\?ilo0=1'/, 'iframe src built only from the validated id');
  assert.match(src, /sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'/);
  assert.match(src, /rel="noopener noreferrer"/);
  const css = BV.css();
  for (const sel of ['.bv-fx{', '.bv-grain{', '.bv-streak{', '.bv-sides{'])
    assert.match(css, new RegExp(sel.replace(/[.{]/g, m => '\\' + m) + '[^}]*pointer-events:none'), `${sel} never blocks the project`);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /max-width:760px/);
});

test('text on the accent stays readable for every tested brand colour', () => {
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  const fn = core.slice(core.indexOf('function accentTokens('), core.indexOf('\n}\n', core.indexOf('function accentTokens(')) + 2);
  const accentTokens = vm.runInNewContext(fn + '; accentTokens');
  const lum = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  // Le texte retenu est celui qui contraste le plus : sur le violet #8B5CF6, le
  // sombre donne 5,2:1 et le blanc 3,9:1 (insuffisant) — d'où #060606.
  const expected = { '#C8FF00': '#060606', '#8B5CF6': '#060606', '#00D4FF': '#060606', '#2563EB': '#ffffff', '#F97316': '#060606' };
  for (const [acc, ink] of Object.entries(expected)) {
    const t = accentTokens(acc);
    assert.equal(t.ink, ink, acc);
    assert.ok(ratio(acc, t.ink) >= 4.5, `${acc} on-accent contrast ${ratio(acc, t.ink).toFixed(2)}`);
    assert.match(t.soft, /^rgba\(\d+,\d+,\d+,0\.12\)$/);
  }
});

test('the window has a single live mode', () => {
  const src = BV.runtime.toString();
  assert.doesNotMatch(src, /data-mode|Aperçu PNG|bv-png/, 'no PNG toggle or image mode left');
  assert.equal('mode' in plain(BV.sanitizeConfig({ mode: 'png' })), false, 'an old "mode" setting is ignored');
  assert.equal(typeof BV.exportComposition, 'undefined');
});
