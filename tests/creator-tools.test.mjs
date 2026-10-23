import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Charge un script navigateur classique dans un contexte isolé. */
function load(file) {
  const ctx = vm.createContext({ URL });
  vm.runInContext(readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
  return ctx;
}
const { ProjectTags } = load('tags.js');
const { SiteTheme } = load('site-theme.js');
const { HarveyBridge } = load('harvey-bridge.js');

test('project tags are trimmed, deduplicated case-insensitively and capped', () => {
  assert.deepEqual([...ProjectTags.clean(' Branding ,branding, motion  design,,3D ')], ['Branding', 'motion design', '3D']);
  const many = Array.from({ length: 12 }, (_, i) => 't' + i);
  assert.equal(ProjectTags.clean(many).length, ProjectTags.MAX_TAGS);
  assert.equal(ProjectTags.clean(['x'.repeat(40)])[0].length, ProjectTags.MAX_LEN);
});

test('renaming a tag onto an existing one merges them; removing never drops projects', () => {
  const ps = [
    { id: 1, tags: ['Logo', 'Print'] },
    { id: 2, tags: ['logo'] },
    { id: 3, tags: ['Branding', 'Logo'] },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(ProjectTags.counts(ps).map(t => [t.name, t.n]))), [['Logo', 3], ['Branding', 1], ['Print', 1]]);
  assert.equal(ProjectTags.rename(ps, 'LOGO', 'Branding'), 3);
  assert.deepEqual([...ps[2].tags], ['Branding'], 'merged without a duplicate');
  assert.equal(ProjectTags.remove(ps, 'branding'), 3);
  assert.equal(ps.length, 3);
  assert.deepEqual([...ps[0].tags], ['Print']);
});

test('theme import keeps only known visual settings', () => {
  const theme = SiteTheme.parse(JSON.stringify({ kind: 'souanpt-theme', theme: {
    accentColor: '#38BDF8', theme: '#060606', font: 'inter', radius: 'round', layout: 4,
    fx: { tilt: true, intensity: 99, evil: true },
    siteName: 'Hijack', heroImage: 'javascript:alert(1)', accentColorX: 'x',
  } }));
  assert.deepEqual(JSON.parse(JSON.stringify(theme)), {
    accentColor: '#38BDF8', theme: '#060606', layout: '4', font: 'inter', radius: 'round', fx: { tilt: true, intensity: 16 },
  });
  assert.throws(() => SiteTheme.parse('{"accentColor":"red;}body{display:none"}'), /Aucun réglage/);
  assert.throws(() => SiteTheme.parse('not json'), /illisible/);
  const round = SiteTheme.parse(SiteTheme.serialize({ accentColor: '#FF6B6B', theme: '#f8f8f8', siteName: 'x' }));
  assert.equal(round.accentColor, '#FF6B6B');
  assert.equal(round.siteName, undefined);
});

test('contrast check matches WCAG ratios and flags weak accents', () => {
  assert.equal(SiteTheme.contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(SiteTheme.checkContrast({ accentColor: '#C8FF00', theme: '#060606' }).ok, true);
  assert.equal(SiteTheme.checkContrast({ accentColor: '#1a1a1a', theme: '#060606' }).ok, false);
  for (const p of SiteTheme.PRESETS) assert.ok([SiteTheme.DARK, SiteTheme.LIGHT].includes(p.theme), `${p.id} uses a background the generator understands`);
});

test('Harvey config is a complete, escaped YAML with sending safeguards forced', () => {
  const yaml = HarveyBridge.buildConfig({
    name: 'Kai "K" Dupont', company: 'Studio\nInjected: true', email: 'kai@studio.test',
    offer: 'Identité visuelle', benefits: 'Rapide\nSur mesure', industries: 'restaurants, boutiques',
    bookingUrl: 'javascript:alert(1)', maxDailySends: 500, postalAddress: '1 rue Test, Paris',
  });
  for (const section of ['persona:', 'product:', 'icp:', 'channels:', 'usage:', 'compliance:']) assert.match(yaml, new RegExp('^' + section, 'm'));
  assert.match(yaml, /name: "Kai \\"K\\" Dupont"/);
  assert.match(yaml, /company: "Studio\\nInjected: true"/, 'a newline cannot create a YAML key');
  assert.doesNotMatch(yaml, /^Injected/m);
  assert.match(yaml, /require_approval: true/);
  assert.match(yaml, /linkedin:\n    enabled: false/);
  assert.match(yaml, /max_daily_sends: 50/);
  assert.match(yaml, /booking_url: ""/, 'only http(s) booking links are kept');
  assert.match(yaml, /industries:\n    - "restaurants"\n    - "boutiques"/);
  assert.match(yaml, /timezone: "Europe\/Paris"/);
});

test('Harvey CSV import keeps qualified prospects and never overwrites a client', () => {
  const csv = '﻿email,first_name,last_name,company_name,title,website,linkedin_url,industry,personalization,email_status,score,seniority,source,status,created_at\r\n'
    + 'ana@bistro.test,Ana,Roy,"Bistro ""Chez Ana""",Gérante,https://bistro.test,,Restauration,"Menu refait,\nsite daté",verified,82,,,meeting,2026-10-01\r\n'
    + 'ANA@bistro.test,Ana,Roy,Bistro,,,,,,verified,80,,,meeting,2026-10-01\r\n'
    + 'cold@x.test,Bo,Li,X Corp,CEO,javascript:alert(1),,,,risky,10,,,contacted,2026-10-02\r\n'
    + 'old@client.test,Léa,M,Client SA,,,,,,verified,50,,,replied,2026-10-03\r\n';
  const leads = HarveyBridge.leadsFromCsv(csv);
  assert.equal(leads.length, 2, 'contacted is excluded by default and duplicates collapse');
  assert.equal(leads[0].company, 'Bistro "Chez Ana"');
  assert.equal(leads[0].personalization, 'Menu refait,\nsite daté');
  assert.equal(HarveyBridge.leadsFromCsv(csv, { statuses: ['contacted'] })[0].website, '', 'non-http links are dropped');

  const roster = [{ id: 'c1', name: 'Client SA (mon nom)', email: 'old@client.test', status: 'active' }];
  const res = HarveyBridge.mergeLeads(roster, leads, 1000);
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.roster[0].name, 'Client SA (mon nom)', 'existing client keeps its name');
  assert.equal(res.roster[0].leadStatus, 'replied');
  assert.equal(res.roster[1].source, 'harvey');
  assert.equal(roster[0].leadStatus, undefined, 'input roster is not mutated');
  const again = HarveyBridge.mergeLeads(res.roster, leads, 2000);
  assert.equal(again.added + again.updated, 0, 'importing the same file twice changes nothing');

  assert.throws(() => HarveyBridge.leadsFromCsv('name,phone\nA,1\n'), /export Harvey/);
});
