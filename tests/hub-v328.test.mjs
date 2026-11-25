import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function storage() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

test('shortcuts: folders are created, renamed, reordered, removed without losing a link; drag moves keep order', () => {
  const ctx = { window: null, document: { getElementById: () => null }, Math, Number, String, Map, Set, Array, Object, Promise, URL, JSON, Date, localStorage: storage() };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/toolbox.js'), ctx);
  const L = ctx.Toolbox.links;
  const names = () => plain(L.folders().map(f => f.name + ':' + f.items.map(l => l.id).join(',')));
  assert.deepEqual(names(), ['Outils sans envoi:ihate,neverupload,animg', 'Interfaces open source:opensourceui,pinui,wensity,easyui,wobli,ryanaque,nexvyn']);
  const fav = L.addFolder('Favoris');
  assert.equal(L.addFolder('favoris'), fav, 'same name (any case) → same folder');
  assert.ok(L.move('pinui', fav, 0)); assert.ok(L.move('ihate', fav, 0));
  assert.deepEqual(plain(L.folders().find(f => f.id === fav).items.map(l => l.id)), ['ihate', 'pinui'], 'dropped at the chosen position');
  assert.ok(L.move('ihate', fav, Infinity)); assert.deepEqual(plain(L.folders().find(f => f.id === fav).items.map(l => l.id)), ['pinui', 'ihate']);
  assert.ok(L.renameFolder(fav, 'Mes favoris')); assert.equal(L.renameFolder(fav, 'Outils sans envoi'), false, 'no duplicate folder names');
  assert.ok(L.moveFolder(fav, 0)); assert.equal(L.folders()[0].name, 'Mes favoris');
  const c = L.add({ name: 'Coolors', url: 'coolors.co', folder: fav });
  assert.equal(L.folders()[0].items.at(-1).id, c.id, 'a new shortcut lands in the chosen folder');
  const before = L.all().length;
  assert.ok(L.removeFolder(fav));
  assert.equal(L.all().length, before, 'removing a folder keeps its shortcuts');
  assert.ok(!L.folders().some(f => f.name === 'Mes favoris'));
  assert.ok(L.all().some(l => l.id === c.id && l.custom));
  // les anciens appels restent valides
  L.remove('wobli'); assert.ok(!L.all().some(l => l.id === 'wobli')); L.restore(); assert.ok(L.all().some(l => l.id === 'wobli'));
});

test('shortcuts: profile detected from job, bio and tags; picks follow the profile and skip what is already there', () => {
  const store = storage();
  const ctx = { window: null, document: { getElementById: () => null }, Math, Number, String, Map, Set, Array, Object, Promise, URL, JSON, Date, localStorage: store,
    SiteConfig: { get: () => ({ seo: { jobTitle: 'Photographe et vidéaste' }, bio: 'Rendus 3D sous Blender', projectTags: [] }) }, getProjects: () => [{ tags: ['Miniatures YouTube'] }] };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/toolbox.js'), ctx);
  const L = ctx.Toolbox.links;
  assert.deepEqual(plain(L.detectProfile('Graphiste — logos et miniatures')), ['graphiste']);
  assert.deepEqual(plain(L.detectProfile('Designer UI/UX, motion design')), ['motion', 'uiux']);
  assert.deepEqual(plain(L.detectProfile('')), []);
  const p = L.profile();
  assert.equal(p.auto, true);
  for (const id of ['photo', 'video', '3d', 'graphiste']) assert.ok(p.ids.includes(id), id + ' detected (SiteConfig is a const: read without window.)');
  L.setProfile(['3d']); assert.deepEqual(plain(L.profile()), { ids: ['3d'], auto: false });
  const recos = L.recommend();
  assert.ok(recos.length && recos.every(r => r.for.includes('3d')));
  assert.ok(L.catalog.every(r => /^https:\/\//.test(r.url)), 'every pick is https');
  const added = L.addReco(recos[0].id);
  assert.equal(added.cat, '3D', 'added into the folder of its profile');
  assert.ok(!L.recommend().some(r => r.id === recos[0].id), 'an added pick is no longer proposed');
  L.dismissReco(recos[1].id); assert.ok(!L.recommend().some(r => r.id === recos[1].id));
  L.setProfile(null); assert.equal(L.profile().auto, true);
  assert.deepEqual(plain(L.recommend([])), []);
});

test('tags: per-tag presentation (filter bar, cards, both) and bar order from the catalogue', () => {
  const src = read('js/core.js');
  const chunk = src.slice(src.indexOf('function siteTagMode('), src.indexOf('function renderBentoGrid('));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(chunk + ';this.f={siteTagMode,cardTags,barTags};', ctx);
  const { siteTagMode, cardTags, barTags } = ctx.f;
  const cfg = { projectTags: ['Motion', 'Branding', '3D'], tagDisplay: { branding: 'bar', motion: 'card' } };
  assert.equal(siteTagMode(cfg, 'BRANDING'), 'bar'); assert.equal(siteTagMode(cfg, 'Autre'), 'both'); assert.equal(siteTagMode({ tagDisplay: { x: 'nope' } }, 'x'), 'both');
  const ps = [{ tags: ['Branding', 'Motion', '3D'] }, { tags: ['Print', '3d'] }];
  assert.deepEqual(plain(cardTags(ps[0], cfg, 3)), ['Motion', '3D'], 'bar-only tags never show on cards');
  assert.deepEqual(plain(barTags(ps, cfg)), ['Branding', '3D', 'Print'], 'card-only tags stay out of the bar; catalogue order first');
  assert.match(src, /const tagList = barTags\(projects\.filter\(p=>editor\|\|!pHid\(p\)\), cfg\);/);
  assert.equal((src.match(/cardTags\(p, cfg, [23]\)/g) || []).length, 2, 'both card layouts use the filter');
  const canvas = read('js/canvas.js');
  assert.match(canvas, /function edWinTags\(focusTag\)/);
  assert.match(canvas, /\['both', '◫', 'Barre et cartes'[\s\S]*\['bar', '▤', 'Barre de filtres'[\s\S]*\['card', '▣', 'Cartes seulement'/);
  assert.match(canvas, /data-proj="\$\{_eesc\(p\.id\)\}"/, 'projects are added to a tag from its window');
  assert.match(canvas, /SiteConfig\.set\('tagDisplay', d\)/);
});

test('drop zones replace the native file button and keep the existing change handlers', () => {
  const ctx = { window: null, document: { readyState: 'complete', querySelectorAll: () => [], body: {} }, MutationObserver: class { observe() {} }, String, Number, Math, Array };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/hub-drop.js'), ctx);
  const D = ctx.HubDrop;
  const inp = accept => ({ accept });
  assert.equal(D.accepts(inp('image/*'), { name: 'a.PNG', type: 'image/png' }), true);
  assert.equal(D.accepts(inp('audio/*'), { name: 'a.png', type: 'image/png' }), false);
  assert.equal(D.accepts(inp('.json'), { name: 'backup.JSON', type: '' }), true);
  assert.equal(D.accepts(inp(''), { name: 'x', type: '' }), true);
  assert.equal(D.kindOf('image/png,image/jpeg,image/webp'), 'Images'); assert.equal(D.kindOf('audio/*'), 'Audio'); assert.equal(D.kindOf('.json'), 'JSON');
  const src = read('js/hub-drop.js');
  assert.match(src, /input\.files = dt\.files;[\s\S]*dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/, 'a drop fires the same change event as the picker');
  assert.match(src, /!input\.hidden && !input\.dataset\.hd && !input\.closest\('label'\)/, 'custom zones and hidden inputs are left alone');
  const app = read('app.html');
  assert.match(app, /<script src="js\/hub-drop\.js"><\/script>/);
  const canvas = read('js/canvas.js');
  for (const id of ['brand-logo-file', 'brand-icon-file', 'audio-music-file', 'audio-click-file']) assert.match(canvas, new RegExp(`id="${id}" accept="[a-z]+/\\*" data-max="\\d+"`), id);
});

test('Behance quick-add: profile found, projects proposed (new vs already added), covers upgraded, selection added', () => {
  const store = storage();
  let projects = [{ id: 'p1', title: 'Ancien', url: 'https://www.behance.net/gallery/241392957/Miniatures-2026' }];
  store.setItem('hub_projects', JSON.stringify(projects));
  let cfg = { behance: '', projectTags: ['Logo'] };
  const ctx = { window: null, document: {}, localStorage: store, Date, Math, String, Number, Map, Set, Array, Object, JSON, Promise,
    getProjects: () => JSON.parse(store.getItem('hub_projects') || '[]'), SiteConfig: { get: () => cfg, set: (k, v) => { cfg = { ...cfg, [k]: v }; } } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/behance-quick.js'), ctx);
  const B = ctx.BehanceQuick;
  assert.equal(B.parseUser('@souanpt'), 'souanpt'); assert.equal(B.parseUser('https://www.behance.net/souanpt/projects'), 'souanpt');
  assert.equal(B.parseUser('https://www.behance.net/gallery/1/x'), ''); assert.equal(B.parseUser('https://evil.test/x'), ''); assert.equal(B.parseUser('a b'), '');
  assert.equal(B.userFrom({}, [{ url: 'https://instagram.com/x' }, { url: 'https://www.behance.net/studio-x' }]), 'studio-x', 'found from the site links');
  assert.equal(B.userFrom({ behance: '@moi' }, []), 'moi');
  assert.deepEqual(plain(B.coverCandidates('https://mir-s3-cdn-cf.behance.net/projects/404/abc.123.png')), [
    'https://mir-s3-cdn-cf.behance.net/projects/max_808/abc.123.png', 'https://mir-s3-cdn-cf.behance.net/projects/808/abc.123.png', 'https://mir-s3-cdn-cf.behance.net/projects/404/abc.123.png']);
  assert.deepEqual(plain(B.coverCandidates('https://other.cdn/x.png')), ['https://other.cdn/x.png']);
  assert.equal(B.cleanTitle('  Logo &amp; identité   2026 '), 'Logo & identité 2026');
  const items = B.plan([
    { title: 'Miniatures', url: 'https://www.behance.net/gallery/241392957/Miniatures-2026?tracking=1', cover: '', tags: [] },
    { title: 'Affiche', url: 'https://www.behance.net/gallery/111/Affiche', cover: 'https://mir-s3-cdn-cf.behance.net/projects/404/a.png', tags: ['Print', 'print', 'Logo'] },
    { title: 'Affiche (doublon)', url: 'https://www.behance.net/gallery/111/Affiche-2', cover: '', tags: [] },
    { title: 'Reel', url: 'https://www.behance.net/gallery/222/Reel', cover: '', tags: ['Motion'] },
  ], ctx.getProjects());
  assert.equal(items.length, 3, 'same gallery number = same project');
  assert.equal(items[0].exists, true); assert.equal(items[0].existingId, 'p1');
  assert.deepEqual(plain(items[1].tags), ['Print', 'Logo']);
  items[1].best = items[1].covers[0];
  const n = B.apply([items[1], items[2], items[0]], { tags: true });
  assert.equal(n, 2, 'only new projects are added');
  const after = ctx.getProjects();
  assert.deepEqual(plain(after.map(p => p.title)), ['Affiche', 'Reel', 'Ancien'], 'added on top, Behance order kept');
  assert.equal(after[0].cover, 'https://mir-s3-cdn-cf.behance.net/projects/max_808/a.png', 'large cover kept');
  assert.ok(after[0].behance);
  assert.deepEqual(plain(cfg.projectTags), ['Logo', 'Print', 'Motion'], 'tag catalogue merged (SiteConfig read without window.)');
  assert.equal(B.apply([items[1]], {}), 0, 'never twice');
  const app = read('app.html'), ui = read('js/ui.js');
  assert.doesNotMatch(app, /BehanceQuick\.checkNew\(\)/, '3.29.2: Behance removed profile feeds — no automatic sync any more');
  assert.doesNotMatch(app, /behanceSyncNow\(true\)/);
  assert.match(ui, /function syncBehance\(\)\{\s*if \(window\.BehanceQuick\) return BehanceQuick\.open\(\);/);
  assert.match(read('js/quote.js'), /n\.action === 'behance-quick'/, 'the notification opens the picker');
});

test('site editor: one space — no Édition/Aperçu switch, double-click opens like a visitor, site controls stay live', () => {
  const app = read('app.html'), canvas = read('js/canvas.js');
  assert.doesNotMatch(app, /id="ed-mode-prev"/); assert.doesNotMatch(app, /id="ed-mode-edit"/);
  assert.match(app, /class="edtb-hint"/);
  assert.match(canvas, /if \(this\._pass \|\| this\._visitor\(e\)\) return;\s*e\.preventDefault\(\); e\.stopPropagation\(\);/);
  assert.match(canvas, /inBlock && \(e\.detail >= 2 \|\| e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(canvas, /\.tag-filters,\.sb-tags/, 'tag filters work without leaving editing');
  assert.match(canvas, /\['visit', '↗ Ouvrir comme un visiteur', 'Double-clic'\]/);
  assert.match(canvas, /a\.target !== '_blank'\) \{ e && e\.preventDefault\(\); window\.open\(a\.href, '_blank', 'noopener,noreferrer'\)/, 'the preview never navigates away');
  assert.doesNotMatch(canvas, /s’active qu’en Aperçu|s’active en Aperçu/);
});

test('const globals are never read through window. (SiteConfig, SiteAutoPublish)', () => {
  for (const f of ['app.html', 'js/toolbox.js', 'js/behance-quick.js', 'js/hub-drop.js', 'js/canvas.js']) {
    assert.doesNotMatch(read(f), /window\.(SiteConfig|SiteAutoPublish)\b(?! *=)/, f);
  }
});
