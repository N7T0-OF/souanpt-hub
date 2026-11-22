import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const app = read('app.html');

test('phone: floating bottom bar, one icon per section, sub-tabs for multi-page sections', () => {
  const ctx = { window: null, document: { readyState: 'loading', addEventListener() {} }, matchMedia: () => ({ matches: true, addEventListener() {} }), navigator: {}, MutationObserver: class { observe() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/mobile-tabbar.js'), ctx);
  const T = ctx.HubTabbar;
  assert.deepEqual(plain(T.groups.map(g => g.id)), ['home', 'content', 'business', 'search', 'system'], '5 slots, like a real app');
  assert.equal(T.groupOf('devis').id, 'business'); assert.equal(T.groupOf('portals').id, 'business');
  assert.equal(T.groupOf('tools').id, 'content'); assert.equal(T.groupOf('github').id, 'system'); assert.equal(T.groupOf('nope'), null);
  // chaque page de la barre latérale a sa section
  for (const p of app.match(/data-page="([a-z-]+)"/g).map(x => x.slice(11, -1))) assert.ok(T.groupOf(p), p + ' reachable from the bottom bar');
  const src = read('js/mobile-tabbar.js');
  assert.match(src, /aria-label="\$\{g\.label\}" title="\$\{g\.label\}">\$\{g\.icon\}/, 'icons only, label for screen readers');
  assert.match(src, /vv\.height < window\.innerHeight \* 0\.72/, 'hidden while the keyboard is open');
  assert.match(app, /<script src="js\/mobile-tabbar\.js"><\/script>/);
  assert.match(app, /viewport-fit=cover/, 'safe areas (iPhone home indicator) are known');
  const phone = app.slice(app.indexOf('#hub-tabbar,#grp-tabs{display:none}'));
  assert.match(phone, /@media\(max-width:820px\)\{\s*\.sidebar,#nav-backdrop,\.topbar \.tb-menu,\.topbar \.tb-search\{display:none!important\}/, 'the left bar leaves phones');
  assert.match(phone, /#hub-tabbar\{display:flex;position:fixed;[^}]*bottom:calc\(12px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?border-radius:26px[\s\S]*?backdrop-filter:blur\(22px\)/, 'floating, rounded, frosted');
  assert.match(phone, /body\.kb-open #hub-tabbar\{/);
  assert.match(phone, /body:has\(#login-gate\.on\) #hub-tabbar/, 'never above the login screen');
  assert.match(phone, /\.scroll-area\{padding-bottom:calc\(98px \+ env\(safe-area-inset-bottom\)\)/, 'content never hidden behind the bar');
  assert.match(phone, /input\.prop-input,select\.prop-input,textarea\.prop-input,\.edw-in,\.cmdk-in\{font-size:16px\}/, 'no iOS zoom on focus');
});

test('tablet landscape: the sidebar becomes an icon rail', () => {
  assert.match(app, /@media\(min-width:821px\) and \(max-width:1100px\)\{\s*\.sidebar\{width:68px\}/);
  assert.match(app, /\.sidebar \.ni\{justify-content:center;padding:12px 0;font-size:0/);
});

test('phone editor: no live preview (memory), Linktree-style quick editing on the same data', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /async function edRefreshPreview\(\) \{\s*\/\/[^\n]*\n\s*if \(window\.EdLite && EdLite\.active\(\)\) return;/, 'the preview iframe is never generated on a phone');
  assert.match(ui, /if\(id==='editor'\) \{ edResetPanels\(\); edLoad\(\); if \(window\.EdLite\) EdLite\.sync\(\);/);
  assert.match(app, /<script src="js\/editor-lite\.js"><\/script>/);
  assert.match(app, /#page-editor\.ed-lite>:not\(#ed-lite\)\{display:none!important\}/);
  const src = read('js/editor-lite.js');
  for (const s of ["'links', '🔗', 'Liens'", "'projects', '📁', 'Projets'", "'tags', '🏷', 'Tags'", "'audio', '🎵', 'Musique & son'", "'profile', '✳', 'Profil'"]) assert.ok(src.includes(s), s);
  assert.match(src, /f\.src = 'about:blank'/, 'a preview loaded earlier is released');
  assert.match(src, /sessionStorage\.setItem\(FULL_KEY, '1'\)/, 'full editor still possible for the session');
  assert.match(src, /localStorage\.setItem\('hub_links'/); assert.match(src, /placeBlocks\(getBlocks\(cfg\(\)\)\)/, 'links get their site block like in the full editor');
  // normalisation des liens avec les vraies fonctions de core.js
  const core = read('js/core.js');
  const chunk = core.slice(core.indexOf('const _h = v =>'), core.indexOf("/** Plateforme d'un lien enregistré"));
  const ctx = { window: null, document: { readyState: 'complete' }, matchMedia: () => ({ matches: true, addEventListener() {} }), sessionStorage: { getItem: () => null }, URL, String, encodeURIComponent, decodeURIComponent };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(chunk + ';this.socialDetect=socialDetect;this.socialById=socialById;', ctx);
  vm.runInContext(read('js/editor-lite.js'), ctx);
  const n = ctx.EdLite.normalizeLink;
  assert.deepEqual(plain(n('instagram.com/demo.studio')), { url: 'https://instagram.com/demo.studio', platform: 'instagram', title: 'Instagram' });
  assert.equal(n('moi@exemple.fr').url, 'mailto:moi@exemple.fr');
  assert.equal(n('https://mon-site.fr/portfolio', 'Mon site').title, 'Mon site');
  assert.equal(n('javascript:alert(1)'), null); assert.equal(n('juste un pseudo'), null); assert.equal(n(''), null);
  assert.equal(ctx.EdLite.active(), true, 'active on a phone unless the full editor was asked');
});
