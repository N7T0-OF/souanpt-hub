import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ URL, URLSearchParams });
vm.runInContext(readFileSync(new URL('../js/site-seo.js', import.meta.url), 'utf8'), ctx);
const SEO = ctx.SiteSEO;
const cfg = { siteName: 'Souanpt', bio: 'Miniatures YouTube et identités visuelles', accentColor: '#C8FF00', email: 'a@b.fr',
  siteUrl: 'https://souanpt.github.io/site', hauntUser: 'souanpt', seo: { jobTitle: 'Graphiste', city: 'Lyon' } };
const projects = [{ id: 'p1', title: 'Miniatures 2026', cover: 'https://cdn.test/a.webp', tags: ['miniatures'], url: 'https://www.behance.net/gallery/1/x' }];
const reviews = [{ author: 'Camille', text: 'Top', rating: 5, status: 'approved' }, { author: 'X', text: 'secret', rating: 1, status: 'pending' }];

test('head carries title, description, canonical, share preview and structured data', () => {
  const h = SEO.head(cfg, projects, reviews, [{ url: 'https://instagram.com/souanpt' }]);
  assert.match(h, /<title>Souanpt — Graphiste — Lyon<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/souanpt\.github\.io\/site\/">/);
  assert.match(h, /<meta property="og:image" content="https:\/\/cdn\.test\/a\.webp">/);
  assert.match(h, /name="robots" content="index,follow/);
  assert.match(h, /<link rel="me" href="https:\/\/haunt\.gg\/souanpt">/);
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const person = ld['@graph'].find(n => n['@type'] === 'Person');
  assert.equal(person.jobTitle, 'Graphiste');
  assert.deepEqual(person.sameAs, ['https://haunt.gg/souanpt', 'https://instagram.com/souanpt']);
  const service = ld['@graph'].find(n => n['@type'] === 'Service');
  assert.equal(service.aggregateRating.reviewCount, 1, 'only approved reviews');
  assert.equal(JSON.stringify(ld).includes('secret'), false, 'pending reviews never published');
});

test('texts are escaped and cannot break out of the head or the JSON-LD block', () => {
  const evil = '</script><script>alert(1)</script>"';
  const h = SEO.head({ ...cfg, siteName: evil, bio: evil, seo: { jobTitle: evil } }, [{ title: evil, cover: 'javascript:alert(1)' }], [], []);
  assert.equal((h.match(/<\/script>/g) || []).length, 1, 'only the JSON-LD closing tag');
  assert.doesNotMatch(h, /javascript:/);
  assert.doesNotMatch(h.replace(/<script type="application\/ld\+json">[\s\S]*<\/script>/, ''), /<script>alert/);
});

test('noindex is honoured and the sitemap lists project images', () => {
  const off = SEO.head({ ...cfg, seo: { index: false } }, [], [], []);
  assert.match(off, /content="noindex,nofollow"/);
  const files = Object.fromEntries(SEO.files(cfg, projects).map(f => [f.path, f.content]));
  assert.match(files['sitemap.xml'], /<loc>https:\/\/souanpt\.github\.io\/site\/<\/loc>/);
  assert.match(files['sitemap.xml'], /<image:loc>https:\/\/cdn\.test\/a\.webp<\/image:loc>/);
  assert.match(files['robots.txt'], /Sitemap: https:\/\/souanpt\.github\.io\/site\/sitemap\.xml/);
  assert.match(Object.fromEntries(SEO.files({ ...cfg, seo: { index: false } }, []).map(f => [f.path, f.content]))['robots.txt'], /Disallow: \//);
  assert.equal(SEO.files({ siteName: 'x' }, projects).length, 0, 'no files without a known address');
});

test('the audit scores the setup and explains what is missing', () => {
  const a = SEO.audit(cfg, projects, reviews);
  assert.ok(a.score > 0 && a.score <= 100);
  assert.ok(a.checks.some(c => !c.ok && /3 projets/.test(c.label)), 'asks for more projects');
  assert.ok(a.checks.find(c => /haunt/.test(c.label)).ok);
});

test('haunt.gg link: valid usernames only, back button only for haunt visitors by default', () => {
  assert.equal(SEO.hauntUrl('https://haunt.gg/souanpt'), 'https://haunt.gg/souanpt');
  assert.equal(SEO.hauntUrl('@souanpt'), 'https://haunt.gg/souanpt');
  assert.equal(SEO.hauntUrl('evil"><script>'), '');
  assert.deepEqual(JSON.parse(JSON.stringify(SEO.hauntBack({ hauntUser: '' }))), { css: '', body: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(SEO.hauntBack({ hauntUser: 'souanpt', hauntBack: 'off' }))), { css: '', body: '' });
  const b = SEO.hauntBack({ hauntUser: 'souanpt' });
  assert.match(b.body, /href="https:\/\/haunt\.gg\/souanpt"/);
  assert.match(b.body, /var m="auto"/);
  assert.match(b.body, /q\.get\('from'\)==='haunt'/);
  const links = JSON.parse(JSON.stringify(SEO.hauntLinks(cfg).map(l => l.url)));
  assert.deepEqual(links, ['https://souanpt.github.io/site/?from=haunt', 'https://souanpt.github.io/site/?from=haunt#projects',
    'https://souanpt.github.io/site/?from=haunt#contact', 'https://souanpt.github.io/site/?from=haunt#avis']);
});

test('the generator uses only visible projects, shown reviews and visible links', () => {
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.match(core, /SiteSEO\.head\(cfg, bvVisible, sec\.avis \? approved : \[\], socItems\)/);
  assert.match(core, /SiteSEO\.files\(pubCfg,/, 'sitemap and robots published');
});
