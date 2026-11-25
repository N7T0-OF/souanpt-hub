import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { galleryUrl, cleanTitle, userOf, onRequest } from '../functions/api/behance.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));

test('relay /api/behance: only Behance project links, official oEmbed, allowed origins, honest client', async () => {
  assert.deepEqual(galleryUrl('https://www.behance.net/gallery/241392957/Miniatures-2026?tracking=x'), { id: '241392957', url: 'https://www.behance.net/gallery/241392957/Miniatures-2026' });
  assert.deepEqual(galleryUrl('behance.net/gallery/123456'), null, 'scheme required');
  for (const bad of ['https://evil.test/gallery/123456/x', 'https://www.behance.net/studio-demo', 'https://www.behance.net/gallery/12/x', 'https://www.behance.net.evil.test/gallery/123456/x', 'javascript:alert(1)']) assert.equal(galleryUrl(bad), null, bad);
  assert.equal(cleanTitle('Miniatures | 2026 - 𝑺𝑶𝑼𝑨𝑵𝑷𝑻 ⠀', '𝑺𝑶𝑼𝑨𝑵𝑷𝑻 ⠀'), 'Miniatures | 2026', 'the author suffix added by oEmbed is removed');
  assert.equal(cleanTitle('Logo - Nova', 'Quelqu’un'), 'Logo - Nova', 'a dash in the real title is kept');
  assert.equal(userOf('https://www.behance.net/studio-demo'), 'studio-demo');
  assert.equal(userOf('https://evil.test/x'), '');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, ua: init.headers['user-agent'] }); return new Response(JSON.stringify({ title: 'Affiche - Moi', author_name: 'Moi', author_url: 'https://www.behance.net/moi' }), { status: 200 }); };
  try {
    const req = (u, origin) => new Request('https://souanptjub.pages.dev/api/behance?url=' + encodeURIComponent(u), { headers: origin ? { origin } : {} });
    let r = await onRequest({ request: req('https://www.behance.net/gallery/111222/Affiche', 'https://n7t0-of.github.io'), env: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: '111222', url: 'https://www.behance.net/gallery/111222/Affiche', title: 'Affiche', author: 'Moi', user: 'moi' });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://n7t0-of.github.io');
    assert.match(calls[0].url, /^https:\/\/www\.behance\.net\/services\/oembed\?format=json&url=https%3A%2F%2Fwww\.behance\.net%2Fgallery%2F111222%2FAffiche$/, 'target rebuilt here, official endpoint');
    assert.doesNotMatch(calls[0].ua, /Mozilla|Chrome|Safari/, 'never pretends to be a browser');
    r = await onRequest({ request: req('https://www.behance.net/gallery/111222/Affiche', 'https://evil.test'), env: {} });
    assert.equal(r.status, 403, 'third-party sites cannot use the relay');
    r = await onRequest({ request: req('https://example.com/x', 'https://n7t0-of.github.io'), env: {} });
    assert.equal(r.status, 400, 'not a generic proxy');
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = realFetch; }
});

test('quick-add: pasted links (any text, duplicates removed), fallback names, already-added detection', () => {
  const store = new Map();
  const ctx = { window: null, document: {}, location: { hostname: 'n7t0-of.github.io', origin: 'https://n7t0-of.github.io' }, Date, Math, String, Number, Map, Set, Array, Object, JSON, Promise, decodeURIComponent,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    getProjects: () => JSON.parse(store.get('hub_projects') || '[]') };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/behance-quick.js'), ctx);
  const B = ctx.BehanceQuick;
  const text = 'Mes projets : https://www.behance.net/gallery/241392957/Miniatures-2026 et\nwww.behance.net/gallery/111222/Affiche-Festival?x=1 puis encore https://www.behance.net/gallery/241392957/Miniatures-2026 et https://www.behance.net/moi';
  assert.deepEqual(plain(B.extractLinks(text)), ['https://www.behance.net/gallery/241392957/Miniatures-2026', 'https://www.behance.net/gallery/111222/Affiche-Festival']);
  assert.equal(B.extractLinks('rien ici').length, 0);
  assert.equal(B.titleFromUrl('https://www.behance.net/gallery/111222/Affiche-Festival_2026'), 'Affiche Festival 2026');
  assert.equal(B.relayOrigin(), 'https://souanptjub.pages.dev', 'GitHub Pages hub uses the Cloudflare relay');
  store.set('hub_projects', JSON.stringify([{ id: 'p1', title: 'Ancien', url: 'https://www.behance.net/gallery/241392957/Miniatures-2026' }]));
  const items = B.plan(B.extractLinks(text).map(url => ({ title: B.titleFromUrl(url), url })), ctx.getProjects());
  assert.deepEqual(plain(items.map(i => [i.title, i.exists])), [['Miniatures 2026', true], ['Affiche Festival', false]]);
  items[1].best = 'data:image/webp;base64,AAAA';
  assert.equal(B.apply(items.filter(i => !i.exists), { tags: false }), 1);
  assert.equal(ctx.getProjects()[0].cover, 'data:image/webp;base64,AAAA', 'dropped cover kept');
  const src = read('js/behance-quick.js');
  assert.doesNotMatch(src, /Behance\.fetchProjects|allorigins|corsproxy|codetabs/, 'no dead RSS feed, no third-party proxy');
  assert.deepEqual(src.match(/fetch\([^,]+/g), ["fetch(relayOrigin() + '/api/behance?url=' + encodeURIComponent(url)"], 'the only network call is our relay');
  assert.match(src, /async checkNew\(\) \{ return 0; \}/);
  assert.match(src, /if \(low\(SiteConfig\.get\(\)\.behance\) !== low\(users\[0\]\)\) SiteConfig\.set\('behance', users\[0\]\)/, 'the real Behance username (project author) is remembered');
});

test('tags: the window says when the live site will change; accents never split a tag', () => {
  const canvas = read('js/canvas.js');
  assert.match(canvas, /function edTagPubNote\(\)/);
  assert.match(canvas, /<p class="tg-mh">\$\{ED_TAG_MODES\.find\(x => x\[0\] === m\)\[3\]\}<\/p>\s*\$\{edTagPubNote\(\)\}/);
  assert.match(canvas, /onclick="EdWin\.close\(\);edDeploy\(\)">🚀 Publier<\/button>/, 'one click to put it online when auto-publish is off');
  const core = read('js/core.js');
  const chunk = core.slice(core.indexOf('function siteTagMode('), core.indexOf('function renderBentoGrid('));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(chunk + ';this.f={siteTagMode,cardTags};', ctx);
  const decomposed = 'Vidéo';   // « Vidéo » avec accent séparé (copié depuis certains sites)
  assert.equal(ctx.f.siteTagMode({ tagDisplay: { 'vidéo': 'bar' } }, decomposed), 'bar');
  assert.deepEqual(plain(ctx.f.cardTags({ tags: [decomposed, 'Motion'] }, { tagDisplay: { 'vidéo': 'bar' } }, 3)), ['Motion'], 'a filter-bar-only tag never reaches the cards');
  assert.match(read('js/site-seo.js'), /siteTagMode\(cfg, t\) !== 'bar'/, 'project pages follow the same rule');
});
