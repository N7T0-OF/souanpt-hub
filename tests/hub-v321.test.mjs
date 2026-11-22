import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DAY = 86400000;
function ctxWith(data = {}) {
  const store = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  const ctx = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { href: '' }, showToast() {}, setTimeout: fn => fn(),
    document: { getElementById: () => null, addEventListener() {}, querySelector: () => null, body: { classList: { contains: () => false } } },
    Date, Math, JSON, Number, String, Array, Object, Map, Set, encodeURIComponent, parseInt, Blob: class {}, URL,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, store };
}
const load = (ctx, f) => vm.runInContext(readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'), ctx);

test('global search finds clients, folders, invoices and actions, accent-insensitive', () => {
  const { ctx } = ctxWith({
    hub_clients: [{ id: 'c1', name: 'Atelier Nova', type: 'Studio' }],
    hub_workspaces: [{ token: 'w1', projectName: 'Identité visuelle', clientName: 'Atelier Nova', stage: 'mission', total: 2400 }],
    hub_invoices: [{ id: 'i1', number: 'FA-2026-004', name: 'Bannière Twitch', client: 'Camille', price: 180, status: 'pending', createdAt: Date.now() - 90 * DAY }],
    hub_projects: [{ id: 'p1', title: 'Miniatures 2026', tags: ['youtube'] }],
    hub_reviews: [{ id: 'r1', author: 'Camille', text: 'Super', rating: 5, status: 'pending' }],
  });
  load(ctx, 'business.js'); load(ctx, 'command-palette.js');
  const S = ctx.HubSearch, items = S._index();
  const titles = q => S._search(items, q).map(i => i.g + ':' + i.t);
  assert.ok(titles('nova').includes('Clients:Atelier Nova'));
  assert.ok(titles('nova').some(t => t.startsWith('Dossiers clients:Identité')));
  assert.ok(titles('identite').some(t => /Identité/.test(t)), 'accents ignored');
  assert.deepEqual(JSON.parse(JSON.stringify(titles('FA-2026-004'))), ['Factures:FA-2026-004 · Bannière Twitch']);
  assert.ok(titles('retard').includes('Factures:FA-2026-004 · Bannière Twitch'), 'overdue invoices findable by « retard »');
  assert.ok(titles('nouveau client').some(t => t === 'Actions:Nouveau client'));
  assert.ok(titles('valider').some(t => t.startsWith('Avis:')), 'pending reviews findable');
  assert.equal(titles('zzz introuvable').length, 0);
  const src = readFileSync(new URL('../js/command-palette.js', import.meta.url), 'utf8');
  assert.match(src, /\(ev\.ctrlKey \|\| ev\.metaKey\) && !ev\.altKey && \(ev\.key === 'k'/, 'Ctrl/⌘+K');
  assert.doesNotMatch(src, /innerHTML = [^;]*\$\{i\.t\}/, 'titles are escaped');
});

test('a client folder pre-fills the invoice with the remaining amount, then attaches it to the folder', () => {
  const now = Date.now();
  const { ctx } = ctxWith({
    hub_workspaces: [{ token: 'w1', projectName: 'Miniatures', clientName: 'Camille', total: 850 }],
    hub_portals: [{ id: 'w1', total: 850, acomptePct: 30 }],
    hub_invoices: [{ id: 'a', workspaceId: 'w1', price: 500, status: 'paid', createdAt: now }, { id: 'b', workspaceId: 'w1', price: 999, status: 'cancelled', createdAt: now }],
  });
  load(ctx, 'business.js');
  const a = ctx.Biz.workspaceAmounts('w1');
  assert.equal(a.mission, 850); assert.equal(a.invoiced, 500, 'cancelled invoices ignored'); assert.equal(a.balance, 350);
  assert.equal(a.pct, 30); assert.equal(a.deposit, 255);
  const attached = [];
  ctx.ClientWorkspace = { attach: (id, token, kind) => { attached.push([id, token, kind]); return true; }, close() {} };
  ctx.window._invFromWorkspace = 'w1';
  assert.equal(ctx.Biz.consumeWorkspace({ id: 'new1' }), true);
  assert.deepEqual(attached, [['new1', 'w1', 'invoice']]);
  assert.equal(ctx.window._invFromWorkspace, null, 'consumed once — a later invoice is not attached by mistake');
  assert.equal(ctx.Biz.consumeWorkspace({ id: 'new2' }), false);
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /const fromWs = !!\(window\.Biz && Biz\.consumeWorkspace\(newInv\)\);/);
  assert.match(app, /window\._invFromWorkspace=null/, 'cancel forgets the folder');
  assert.match(readFileSync(new URL('../js/client-workspace.js', import.meta.url), 'utf8'), /Biz\.fromWorkspace\('\$\{t\}','balance'\)/);
});

test('expenses: validated entries, periods, result and recurring clients', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const { ctx } = ctxWith({ hub_business: { terms: 30 }, hub_invoices: [
    { id: '1', client: 'Nova', price: 1000, status: 'paid', createdAt: Date.UTC(2026, 9, 1), paidAt: Date.UTC(2026, 10, 5) },
    { id: '2', client: 'Nova', price: 400, status: 'paid', createdAt: Date.UTC(2026, 1, 1), paidAt: Date.UTC(2026, 1, 20) },
    { id: '3', client: 'Camille', price: 300, status: 'paid', createdAt: Date.UTC(2026, 10, 2), paidAt: Date.UTC(2026, 10, 10) },
  ] });
  load(ctx, 'business.js');
  const B = ctx.Biz;
  assert.equal(B.addExpense({ label: '', amount: 10 }), null);
  assert.equal(B.addExpense({ label: 'x', amount: -1 }), null);
  assert.ok(B.addExpense({ label: 'Logiciel', amount: '29,99', category: 'Logiciels & abonnements', date: Date.UTC(2026, 10, 3) }));
  assert.equal(B.addExpense({ label: 'Divers', amount: 10, category: 'inconnue', date: Date.UTC(2026, 3, 3) }).category, 'Autre');
  const month = B.periodStats({ k: 'month' }, now);
  assert.equal(month.income, 1300); assert.equal(month.spent, 29.99); assert.equal(month.result, 1270.01);
  assert.equal(month.top[0].name, 'Nova'); assert.equal(month.top[0].recurring, true, '2 invoices overall = recurring');
  assert.equal(month.top[1].recurring, false);
  const year = B.periodStats({ k: 'year' }, now);
  assert.equal(year.income, 1700); assert.equal(year.spent, 39.99);
  const custom = B.periodStats({ k: 'custom', from: '2026-02-01', to: '2026-02-28' }, now);
  assert.equal(custom.income, 400); assert.equal(custom.spent, 0);
  const q = B.range({ k: 'quarter' }, now); assert.equal(new Date(q[0]).getMonth(), 9);
  const csv = B.reportCSV({ k: 'month' });
  assert.match(csv, /"Dépenses";"29,99"/); assert.match(csv, /"Logiciel"/);
});

test('client card summary: paid, outstanding, overdue, latest invoices', () => {
  const now = Date.now();
  const { ctx } = ctxWith({ hub_business: { terms: 30 }, hub_invoices: [
    { id: '1', client: 'Camille Martin', price: 320, status: 'paid', createdAt: now - 9 * DAY },
    { id: '2', client: 'camille martin ', price: 180, status: 'pending', createdAt: now - 40 * DAY },
    { id: '3', client: 'Autre', price: 50, status: 'pending', createdAt: now },
  ] });
  load(ctx, 'business.js');
  const s = ctx.Biz.clientSummary('Camille Martin');
  assert.equal(s.count, 2); assert.equal(s.paid, 320); assert.equal(s.open, 180); assert.equal(s.lateCount, 1);
  assert.match(ctx.Biz.clientBlock('<script>'), /Aucune facture/);
  assert.doesNotMatch(ctx.Biz.clientBlock('Camille Martin'), /<script/);
});

test('phone and tablet: the sidebar becomes a drawer opened by ☰', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /class="btn btn-ghost tb-menu" onclick="HubNav\.toggle\(\)"/);
  assert.match(app, /@media\(max-width:820px\)\{\s*\.sidebar\{position:fixed/);
  assert.match(app, /\.topbar \.tb-menu\{display:none/, 'hidden on desktop');
  assert.match(app, /<script src="js\/mobile-nav\.js"><\/script>/);
  const nav = readFileSync(new URL('../js/mobile-nav.js', import.meta.url), 'utf8');
  assert.match(nav, /e\.key === 'Escape'/); assert.match(nav, /\.sidebar \.ni'\)\) HubNav\.close\(\)/, 'closes after choosing a page');
  const reg = readFileSync(new URL('../js/hub-data.js', import.meta.url), 'utf8');
  assert.match(reg, /key: 'expenses',\s+ls: 'hub_expenses',\s+file: 'expenses\.json',\s+sync: null/);
});
