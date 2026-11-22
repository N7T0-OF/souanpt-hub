import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DAY = 86400000;
function load(data = {}, extra = {}) {
  const store = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  const ctx = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { href: '' }, showToast() {}, document: { getElementById: () => null, hidden: false },
    Date, Math, JSON, Number, String, Array, Object, encodeURIComponent, parseInt, ...extra,
  };
  ctx.window = ctx;
  ctx.window.open = () => ({ document: { open() {}, write(h) { ctx.__html = h; }, close() {} } });
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/business.js', import.meta.url), 'utf8'), ctx);
  return { B: ctx.Biz, store, ctx };
}
const plain = v => JSON.parse(JSON.stringify(v));

test('old single-line invoices keep working; lines are cleaned and totals rounded to the cent', () => {
  const { B } = load();
  assert.deepEqual(plain(B.linesOf({ name: 'Logo', price: 500 })), [{ label: 'Logo', qty: 1, unit: 500 }]);
  const clean = plain(B.cleanLines([{ label: ' Logo ', qty: '1', unit: '600' }, { label: '', qty: 2, unit: 9 }, { label: 'Réseaux', qty: '3', unit: '45,50' }, { label: 'x', qty: -2, unit: 'abc' }]));
  assert.deepEqual(clean, [{ label: 'Logo', qty: 1, unit: 600 }, { label: 'Réseaux', qty: 3, unit: 45.5 }, { label: 'x', qty: 0, unit: 0 }]);
  assert.equal(B.totalOf([{ qty: 3, unit: 0.1 }]), 0.3, 'no 0.30000000000000004');
  assert.equal(B.totalOf(clean), 736.5);
});

test('updating an invoice recomputes its total and keeps other fields bounded', () => {
  const now = Date.now();
  const { B } = load({ hub_invoices: [{ id: 'i1', number: 'FA-2026-001', name: 'Logo', client: 'Nova', price: 500, status: 'pending', createdAt: now }] });
  const inv = B.updateInvoice('i1', { lines: [{ label: 'Logo', qty: 1, unit: 600 }, { label: 'Retouches', qty: 2, unit: 30 }], notes: 'Commande 42', dueAt: now + 10 * DAY });
  assert.equal(inv.price, 660); assert.equal(inv.name, 'Logo'); assert.equal(inv.notes, 'Commande 42'); assert.equal(inv.lines.length, 2);
  assert.equal(B.updateInvoice('i1', { lines: [{ label: '', qty: 1, unit: 5 }] }), null, 'an invoice needs at least one labelled line');
  assert.equal(B.invoices()[0].price, 660, 'refused update leaves it unchanged');
});

test('templates are saved, deduplicated by name and capped', () => {
  const { B } = load();
  assert.equal(B.saveTemplate('', [{ label: 'x', qty: 1, unit: 1 }]), null);
  assert.equal(B.saveTemplate('Pack', [{ label: '', qty: 1, unit: 1 }]), null);
  B.saveTemplate('Pack identité', [{ label: 'Logo', qty: 1, unit: 600 }]);
  B.saveTemplate('pack IDENTITÉ', [{ label: 'Logo v2', qty: 1, unit: 650 }], 'note');
  assert.equal(B.templates().length, 1); assert.equal(B.templates()[0].lines[0].label, 'Logo v2');
  for (let i = 0; i < 40; i++) B.saveTemplate('T' + i, [{ label: 'a', qty: 1, unit: 1 }]);
  assert.equal(B.templates().length, 30);
});

test('drafts never count as money to collect; duplicates keep their lines', () => {
  const now = Date.now();
  const { B, store } = load({ hub_business: { terms: 30 }, hub_invoices: [
    { id: 'd', price: 0, status: 'pending', draft: true, createdAt: now - 90 * DAY },
    { id: 'i', number: 'FA-2026-001', name: 'Logo', price: 660, status: 'paid', createdAt: now, lines: [{ label: 'Logo', qty: 1, unit: 600 }, { label: 'Retouches', qty: 2, unit: 30 }], notes: 'n' },
  ] });
  assert.equal(B.isOpen(B.invoices()[0]), false); assert.equal(B.isLate(B.invoices()[0]), false);
  B.duplicate('i');
  const copy = JSON.parse(store.get('hub_invoices')).slice(-1)[0];
  assert.equal(copy.lines.length, 2); assert.equal(copy.notes, 'n'); assert.equal(copy.status, 'pending'); assert.equal(copy.number, 'FA-2026-002');
});

test('the printed invoice lists every line, the note, and escapes them', () => {
  const { B, ctx } = load({ hub_business: { name: 'Studio', terms: 30 }, hub_invoices: [{ id: 'i', number: 'FA-2026-001', client: 'Nova', status: 'pending', createdAt: Date.now(), price: 736.5,
    lines: [{ label: 'Logo', qty: 1, unit: 600 }, { label: '<img src=x onerror=alert(1)>', qty: 3, unit: 45.5 }], notes: 'Bon <b>42</b>' }] });
  B.print('i');
  const h = ctx.__html;
  assert.equal((h.match(/<tr><td>/g) || []).length, 2);
  assert.match(h, /736,50/, 'cents shown with two digits');
  assert.match(h, /class="note">Bon &lt;b&gt;42&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<img src=x/);
});

test('due-date reminders: one per day for overdue invoices, one per invoice due soon, never duplicated', () => {
  const now = Date.now(); let saved = [];
  const Notify = { _sysAll: () => saved, _sysSave: l => { saved = l; }, loadInbox: () => Promise.resolve(), renderInbox() {} };
  const { B } = load({ hub_business: { terms: 30 }, hub_invoices: [
    { id: 'late', number: 'FA-1', name: 'A', price: 100, status: 'pending', createdAt: now - 40 * DAY },
    { id: 'soon', number: 'FA-2', name: 'B', price: 50, status: 'acompte', createdAt: now, dueAt: now + 2 * DAY },
    { id: 'far', number: 'FA-3', name: 'C', price: 70, status: 'pending', createdAt: now, dueAt: now + 20 * DAY },
    { id: 'paid', number: 'FA-4', name: 'D', price: 90, status: 'paid', createdAt: now - 60 * DAY },
  ] }, { Notify });
  assert.equal(B.dueReminders(now), 2);
  assert.deepEqual(plain(saved.map(n => n.event).sort()), ['invoice.due', 'invoice.late']);
  assert.ok(saved.every(n => n.category === 'payments' && n.page === 'facturation' && n.local));
  assert.equal(B.dueReminders(now), 0, 'idempotent');
  assert.equal(B.dueReminders(now + DAY), 1, 'next day: one new overdue summary only');
  const quote = readFileSync(new URL('../js/quote.js', import.meta.url), 'utf8');
  assert.match(quote, /\['facturation', 'avis', 'devis', 'cp'\]\.includes\(n\.page\)/, 'notification page button is allowlisted');
});
