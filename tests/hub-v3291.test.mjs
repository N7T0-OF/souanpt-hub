import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('site: with the glowing bar, the default scrollbar is hidden on phones too (body scrolls on touch screens)', () => {
  const ctx = { window: null, document: {}, globalThis: null, JSON, String, Number, Math, Array, Object };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/site-ambiance.js'), ctx);
  const A = ctx.SiteAmbiance;
  const on = A.css(A.sanitize({ progress: true }));
  assert.match(on, /html\{scrollbar-width:none!important/);
  assert.match(on, /@media \(hover:none\) and \(pointer:coarse\)\{html\{height:100%;overflow:hidden!important\}body\{height:100%;overflow-y:auto!important[^}]*scrollbar-width:none!important[^}]*\}body::-webkit-scrollbar\{display:none!important/);
  assert.doesNotMatch(A.css(A.sanitize({ grain: true })), /pointer:coarse\)\{html/, 'nothing changes when the glowing bar is off');
  const src = read('js/site-ambiance.js');
  assert.match(src, /body\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/, 'the glowing bar follows the body scroll');
  assert.match(read('js/behance-viewer.js'), /document\.documentElement\.style\.overflow = 'hidden'; document\.body\.style\.overflow = 'hidden';/, 'the project window also freezes body');
});

test('dashboard follows the site accent colour (theme window, palette, sync, reload) and stays readable', () => {
  const core = read('js/core.js');
  assert.match(core, /save\(d\)  \{ localStorage\.setItem\(SiteConfig\._K, JSON\.stringify\(d\)\); try \{ HubAccent\.sync\(\); \} catch \{\} \}/, 'every config save re-applies the accent');
  assert.match(core, /HubAccent\.sync\(\);\s*window\.addEventListener\('storage'/, 'applied at load and when another tab changes it');
  const chunk = core.slice(core.indexOf('function accentTokens('), core.indexOf("if (typeof window !== 'undefined') window.HubAccent = HubAccent;"));
  const ctx = { Math, parseInt, String }; vm.createContext(ctx);
  vm.runInContext(chunk + ';this.HA=HubAccent;', ctx);
  const H = ctx.HA;
  assert.equal(H.readable('#FF3B7F'), '#FF3B7F', 'a bright accent is kept as is');
  assert.equal(H.readable('#c8ff00'), '#C8FF00');
  const dark = H.readable('#101820');
  assert.notEqual(dark, '#101820'); assert.match(dark, /^#[0-9A-F]{6}$/);
  const lum = h => { const n = parseInt(h.slice(1), 16), f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  assert.ok((lum(dark) + 0.05) / (0.0024 + 0.05) >= 3, 'very dark accents are lightened for the dark dashboard (≥ 3:1)');
  assert.equal(H.readable('nope'), null);
  const sc = read('js/install-shortcut.js');
  assert.doesNotMatch(sc, /#C8FF00;|:#C8FF00\}/, 'the install button follows the accent');
  assert.match(sc, /background:var\(--accent,#C8FF00\)/);
  assert.match(read('app.html'), /#sh-btn\{bottom:calc\(88px \+ env\(safe-area-inset-bottom\)\)!important\}/, 'never under the bottom bar');
});
