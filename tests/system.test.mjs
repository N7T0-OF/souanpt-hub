import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load({ online, store = {} } = {}) {
  const ls = new Map(Object.entries(store));
  const toasts = [], added = [];
  const classes = new Set();
  const ctx = {
    localStorage: { get length() { return ls.size; }, key: i => [...ls.keys()][i], getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    document: {
      documentElement: { classList: { toggle: (c, on) => on ? classes.add(c) : classes.delete(c) } },
      getElementById: () => null, addEventListener() {}, createElement: () => ({ setAttribute() {}, querySelector: () => ({}), set innerHTML(v) { this._h = v; } }),
      body: { appendChild: el => added.push(el) }, hidden: false,
    },
    navigator: { userAgent: 'Chrome/150.0', language: 'fr', onLine: true, serviceWorker: null },
    screen: { width: 1920, height: 1080 }, innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: false }),
    fetch: async () => online ? { ok: true, json: async () => online } : { ok: false },
    showToast: (m) => toasts.push(m), setInterval() {}, setTimeout() {}, addEventListener() {},
    HUB_VERSIONS: [['3.22.0', 'x'], ['3.21.0', 'y']], HubData: { LIST: [{ key: 'invoices', ls: 'hub_invoices', type: 'array' }, { key: 'config', ls: 'souanpt_site_cfg', type: 'raw' }] },
    Date, Math, JSON, String, Number, Array, Object, Map, Set, parseInt, location: { reload() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/system.js', import.meta.url), 'utf8'), ctx);
  return { S: ctx.HubSystem, toasts, added, classes, ls };
}

test('version comparison is numeric, not alphabetical', () => {
  const { S } = load();
  assert.ok(S.cmp('3.22.0', '3.21.9') > 0);
  assert.ok(S.cmp('3.10.0', '3.9.0') > 0, '3.10 is newer than 3.9');
  assert.equal(S.cmp('3.21.0', '3.21.0'), 0);
  assert.ok(S.cmp('3.21', '3.21.1') < 0);
});

test('an update banner appears only when the online version is newer', async () => {
  let r = load({ online: { version: '3.23.0', commit: 'abc' } });
  assert.deepEqual(JSON.parse(JSON.stringify(await r.S.check(false))), { running: '3.22.0', online: '3.23.0', newer: true });
  assert.equal(r.added.length, 1, 'banner shown');
  r = load({ online: { version: '3.22.0' } });
  assert.equal((await r.S.check(true)).newer, false); assert.equal(r.added.length, 0);
  assert.match(r.toasts[0], /dernière version/);
  r = load({ online: null });
  assert.equal((await r.S.check(true)).online, null, 'no build-info (local dev) → nothing shown');
  assert.equal(r.added.length, 0);
});

test('device preferences and storage report', () => {
  const { S, classes } = load({ store: { hub_invoices: JSON.stringify([{ id: 1 }, { id: 2 }]), souanpt_auth_v2: JSON.stringify({ token: 'ghp_SECRET123' }) } });
  S.setPref('calm', true); assert.ok(classes.has('hub-calm'));
  S.setPref('calm', false); assert.ok(!classes.has('hub-calm'));
  S.setPref('start', 'facturation'); assert.equal(S.prefs().start, 'facturation');
  const st = S.storage();
  assert.ok(st.total > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(st.rows.find(r => r.key === 'Factures'))).count, 2, 'French label and item count');
  assert.doesNotMatch(S.diagnostic(), /ghp_SECRET123/, 'the diagnostic never contains a token');
});

test('settings: no fake switch, real Google switch, System tab, working domain', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<div class="toggle on" onclick="this\.classList\.toggle\('on'\)"><\/div>/, 'the decorative « Portfolio public » switch is gone');
  assert.match(app, /id="tog-seo-index"[^>]*onclick="settingsToggleIndex\(this\)"/);
  assert.match(app, /settingsTab\('system',this\)">🖥 Système/);
  assert.match(app, /id="set-tab-system"/);
  assert.equal((app.match(/onclick="hubSignOut\(\)"/g) || []).length, 1, 'sign-out button no longer duplicated');
  const fn = app.slice(app.indexOf('function hubCleanDomain'), app.indexOf('function settingsRenderDomain'));
  const clean = new Function(fn + '; return hubCleanDomain;')();
  assert.equal(clean('https://www.Souanpt.fr/portfolio'), 'www.souanpt.fr');
  assert.equal(clean('souanpt.fr.'), 'souanpt.fr');
  for (const bad of ['', 'pas un domaine', 'localhost', 'n7t0-of.github.io', '-x.fr', 'a..fr']) assert.equal(clean(bad), '', bad);
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.match(core, /cnameFiles\.push\(\{ path: 'CNAME', content: customDomain \+ '\\n' \}\)/);
  assert.match(core, /else if \(publicCfg\.customDomainRemoved\)/, 'CNAME deleted only after an explicit removal in the hub');
  assert.match(core, /siteUrl: customDomain \? `https:\/\/\$\{customDomain\}\/`/, 'canonical address uses the custom domain');
  assert.match(app, /<script src="js\/system\.js"><\/script>/);
});
