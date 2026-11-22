import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadToolbox() {
  const ctx = { window: null, document: { getElementById: () => null }, Math, Number, String, Map, Array, Object, Promise, URL };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/toolbox.js', import.meta.url), 'utf8'), ctx);
  return ctx.Toolbox;
}

test('toolbox calculations: WCAG contrast, dominant colours, proportional resize', () => {
  const T = loadToolbox(), { contrast, palette, fit } = T.calc;
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(Math.round(contrast('#777777', '#777777') * 100) / 100, 1);
  // image synthétique : 3/4 violet, 1/4 orange, pixels transparents ignorés
  const px = [];
  for (let i = 0; i < 400; i++) px.push(...(i >= 300 ? [249, 115, 22, 255] : [139, 92, 246, 255]));   // blocs, comme une vraie image
  for (let i = 0; i < 100; i++) px.push(0, 255, 0, 0);
  const pal = JSON.parse(JSON.stringify(palette(new Uint8ClampedArray(px), 6)));
  assert.equal(pal[0], '#8B5CF6', 'most frequent colour first');
  assert.ok(pal.includes('#F97316')); assert.ok(!pal.includes('#00FF00'), 'transparent pixels ignored');
  assert.deepEqual(JSON.parse(JSON.stringify(fit(1200, 800, 600))), [600, 400]);
  assert.deepEqual(JSON.parse(JSON.stringify(fit(400, 300, 600))), [400, 300], 'never upscales');
  assert.deepEqual(JSON.parse(JSON.stringify(fit(400, 300, ''))), [400, 300]);
  // les onglets restent des fonctions (bug évité : les calculs écrasaient _palette / _contrast)
  for (const tab of ['_image', '_palette', '_contrast', '_qr']) assert.equal(typeof T[tab], 'function', tab);
  const src = readFileSync(new URL('../js/toolbox.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendBeacon/, 'no file ever leaves the browser');
});

test('keyboard shortcuts: G + letter, / and ?, never while typing or behind a dialog', () => {
  const shown = [];
  const els = {};
  const ctx = {
    window: null, Date, String, setTimeout: fn => fn(),
    document: { getElementById: id => els[id] || null, createElement: () => ({ setAttribute() {}, querySelector: () => ({}), addEventListener() {}, set innerHTML(v) {} }), body: { appendChild() {} } },
    showPage: id => shown.push(id),
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  ['page-facturation', 'page-tools', 'page-editor', 'page-overview'].forEach(id => { els[id] = { classList: { contains: () => false } }; });
  let opened = 0; ctx.HubSearch = { open: () => opened++ };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/shortcuts.js', import.meta.url), 'utf8'), ctx);
  const S = ctx.Shortcuts, k = (key, target) => S.handle({ key, target: target || { tagName: 'BODY' } });
  assert.equal(k('g'), true); assert.equal(k('f'), true); assert.deepEqual(shown, ['facturation']);
  k('g'); k('t'); assert.equal(shown.at(-1), 'tools');
  assert.equal(k('f'), false, 'a letter alone does nothing');
  k('/'); assert.equal(opened, 1);
  const input = { tagName: 'INPUT' };
  assert.equal(k('g', input), false); assert.equal(k('o', input), false); assert.equal(shown.length, 2, 'never while typing');
  els['login-gate'] = { classList: { contains: c => c === 'on' } };
  assert.equal(k('/'), false, 'nothing on the login screen'); delete els['login-gate'];
  assert.equal(S.handle({ key: 'k', ctrlKey: true, target: { tagName: 'BODY' } }), false, 'Ctrl+K left to the search module');
  const src = readFileSync(new URL('../js/shortcuts.js', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('keydown', ev => \{ if \(Shortcuts\.handle\(ev\)\)[\s\S]*?\}, true\)/, 'capture phase, before the editor shortcuts');
});

test('the Outils page is reachable from the sidebar, the search and G then T', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /data-page="tools" onclick="showPage\('tools'\)"/);
  assert.match(app, /<div class="page" id="page-tools">/);
  for (const s of ['toolbox', 'shortcuts']) assert.match(app, new RegExp(`<script src="js/${s}\\.js"></script>`));
  assert.match(readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8'), /if \(id === 'tools'\) window\.Toolbox && Toolbox\.render\(\);/);
  assert.match(readFileSync(new URL('../js/command-palette.js', import.meta.url), 'utf8'), /\['tools', '🧰'/);
});

test('open-source shortcuts: https-only addresses, defaults can be hidden and restored, custom ones edited', () => {
  const store = new Map();
  const opened = [];
  const ctx = { window: null, document: { getElementById: () => null }, Math, Number, String, Map, Set, Array, Object, Promise, URL, JSON, Date,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) } };
  ctx.window = ctx; ctx.window.open = (u, t, f) => opened.push([u, t, f]);
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/toolbox.js', import.meta.url), 'utf8'), ctx);
  const L = ctx.Toolbox.links, safe = ctx.Toolbox.safeUrl;
  assert.equal(safe('coolors.co'), 'https://coolors.co/');
  for (const bad of ['http://x.fr', 'javascript:alert(1)', 'https://user:pw@x.fr', 'ftp://x.fr', '']) assert.equal(safe(bad), '', bad);
  const ids = L.all().map(l => l.id);
  for (const id of ['ihate', 'neverupload', 'animg', 'opensourceui', 'pinui', 'wensity', 'easyui', 'wobli', 'ryanaque', 'nexvyn']) assert.ok(ids.includes(id), id + ' by default');
  assert.ok(L.all().every(l => l.url.startsWith('https://')));
  assert.equal(L.add({ name: 'X', url: 'http://insecure.test' }), null);
  const c = L.add({ name: 'Coolors', url: 'coolors.co', icon: '🎨', cat: 'Couleurs' });
  assert.equal(c.url, 'https://coolors.co/');
  L.add({ id: c.id, name: 'Coolors palettes', url: 'https://coolors.co/' });
  assert.equal(L.all().filter(l => l.custom).length, 1); assert.equal(L.all().find(l => l.custom).name, 'Coolors palettes');
  L.remove('pinui'); assert.ok(!L.all().some(l => l.id === 'pinui')); assert.equal(L.hiddenCount(), 1);
  L.restore(); assert.ok(L.all().some(l => l.id === 'pinui'));
  L.remove(c.id); assert.equal(L.all().filter(l => l.custom).length, 0);
  L.open('https://neverupload.lol/'); L.open('javascript:alert(1)');
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [['https://neverupload.lol/', '_blank', 'noopener,noreferrer']], 'unsafe address never opened');
  const src = readFileSync(new URL('../js/toolbox.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /s2\/favicons|favicon\.ico|icon\.horse|<img src="https:/i, 'no icon fetched from third parties');
  assert.match(readFileSync(new URL('../js/hub-data.js', import.meta.url), 'utf8'), /key: 'shortcuts', ls: 'hub_shortcuts'/);
  assert.match(readFileSync(new URL('../js/command-palette.js', import.meta.url), 'utf8'), /g: 'Raccourcis'/);
});
