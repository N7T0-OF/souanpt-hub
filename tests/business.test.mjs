import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DAY = 86400000;
function load(data = {}) {
  const store = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  const opened = [];
  const ctx = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { href: '' }, showToast() {}, document: { getElementById: () => null },
    window: null, Date, Math, JSON, Number, String, Array, Object, encodeURIComponent, parseInt, setTimeout,
  };
  ctx.window = ctx;
  ctx.window.open = () => ({ document: { open() {}, write(h) { opened.push(h); }, close() {} } });
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/business.js', import.meta.url), 'utf8'), ctx);
  return { Biz: ctx.Biz, store, opened, ctx };
}

test('invoice numbers are continuous per year and never reused', () => {
  const { Biz } = load({ hub_invoices: [{ id: 'a', number: 'FA-2026-007', createdAt: Date.UTC(2026, 3, 1) }] });
  assert.equal(Biz.nextNumber(Date.UTC(2026, 5, 1)), 'FA-2026-008', 'continues after the highest existing number');
  assert.equal(Biz.nextNumber(Date.UTC(2026, 5, 2)), 'FA-2026-009');
  assert.equal(Biz.nextNumber(Date.UTC(2027, 0, 3)), 'FA-2027-001', 'restarts each year');
});

test('late means past the due date, from the payment term', () => {
  const now = Date.now();
  const { Biz } = load({ hub_business: { terms: 30 } });
  assert.equal(Biz.isLate({ status: 'pending', createdAt: now - 31 * DAY }), true);
  assert.equal(Biz.isLate({ status: 'pending', createdAt: now - 10 * DAY }), false);
  assert.equal(Biz.isLate({ status: 'paid', createdAt: now - 90 * DAY }), false);
  assert.equal(Biz.isLate({ status: 'pending', createdAt: now - 90 * DAY, dueAt: now + DAY }), false, 'explicit due date wins');
});

test('revenue stats use the payment date and ignore cancelled work', () => {
  const now = Date.now();
  const { Biz } = load({ hub_business: { terms: 30, ceiling: 1000 }, hub_invoices: [
    { id: '1', price: 300, status: 'paid', createdAt: now - 50 * DAY, paidAt: now },
    { id: '2', price: 200, status: 'pending', createdAt: now - 40 * DAY },
    { id: '3', price: 999, status: 'cancelled', createdAt: now },
    { id: '4', price: 100, status: 'acompte', createdAt: now },
  ] });
  const s = Biz.stats(now);
  assert.equal(s.month, 300); assert.equal(s.pending, 300); assert.equal(s.late, 200); assert.equal(s.lateCount, 1);
  assert.equal(s.months.length, 12); assert.equal(s.months[11].total, 300); assert.equal(s.ceiling, 1000);
});

test('printed invoice carries the legal French mentions and escapes everything', () => {
  const { Biz, opened, store } = load({
    hub_business: { name: 'Studio <b>X</b>', siret: '123 456 789 00012', terms: 30, mentions: 'TVA non applicable, art. 293 B du CGI', b2b: true },
    hub_invoices: [{ id: 'i1', name: '<img src=x onerror=alert(1)>', client: 'Nova', price: 1200, status: 'pending', createdAt: Date.UTC(2026, 10, 1) }],
  });
  Biz.print('i1');
  const html = opened[0];
  assert.match(html, /N° FA-2026-001/, 'a number is assigned on first print');
  assert.match(JSON.parse(store.get('hub_invoices'))[0].number, /^FA-2026-001$/, 'and saved');
  assert.match(html, /SIRET : 123 456 789 00012/);
  assert.match(html, /293 B du CGI/);
  assert.match(html, /indemnité forfaitaire pour frais de recouvrement de 40 €/);
  assert.match(html, /Échéance/);
  assert.doesNotMatch(html, /<img src=x/); assert.doesNotMatch(html, /<b>X<\/b>/);
});

test('reminder opens a pre-written e-mail draft and is counted; duplicate gets a fresh number', () => {
  const now = Date.now();
  const { Biz, ctx, store } = load({
    hub_business: { name: 'Souanpt', terms: 30 },
    hub_clients: [{ name: 'Nova', email: 'nova@example.com' }],
    hub_invoices: [{ id: 'i1', number: 'FA-2026-001', name: 'Logo', client: 'Nova', price: 500, status: 'pending', createdAt: now - 40 * DAY }],
  });
  Biz.remind('i1');
  assert.match(ctx.location.href, /^mailto:nova%40example\.com\?subject=Relance/);
  assert.equal(JSON.parse(store.get('hub_invoices'))[0].reminders, 1);
  Biz.duplicate('i1');
  const list = JSON.parse(store.get('hub_invoices'));
  assert.equal(list.length, 2); assert.equal(list[1].number, 'FA-2026-002'); assert.equal(list[1].status, 'pending');
});

test('billing details are backed up privately, never mirrored nor published', () => {
  const registry = readFileSync(new URL('../js/hub-data.js', import.meta.url), 'utf8');
  assert.match(registry, /key: 'business',\s+ls: 'hub_business',\s+file: 'business\.json',\s+sync: null/);
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /hub_business/, 'the site generator never reads billing details');
});

test('client quote pages follow the creator accent colour', async () => {
  for (const f of ['../functions/estimate/[code].js', '../functions/request/[token].js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /function accentVars\(hex\)/);
    assert.match(src, /<style>\$\{CSS\}\$\{accentVars\(accent\)\}<\/style>/);
    assert.match(src, /d\.accent\)/, 'the stored accent is passed to the page');
    assert.match(src, /color:var\(--on-a,#060606\)/, 'text on the accent stays readable');
    const fn = src.slice(src.indexOf('function accentVars'), src.indexOf('\nfunction shell'));
    const accentVars = new Function(fn + '; return accentVars;')();
    assert.equal(accentVars('nope'), '', 'invalid value keeps the default');
    assert.match(accentVars('#8B5CF6'), /--a:#8B5CF6;--on-a:#060606/);
    assert.match(accentVars('#1E3A8A'), /--on-a:#ffffff/, 'dark accent gets white text');
  }
  const quote = readFileSync(new URL('../js/quote.js', import.meta.url), 'utf8');
  assert.equal((quote.match(/accent: hubPublicAccent\(\)/g) || []).length, 2, 'stored on estimates and requests');
});

test('dashboard success colour follows the accent', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /--green:var\(--accent\);/);
  assert.equal((app.match(/#2e9a63/gi) || []).length, 0, 'no fixed green left in the dashboard');
});
