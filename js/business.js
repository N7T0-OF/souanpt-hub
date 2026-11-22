/* ══════════════════════════════════════════════════════════════
   BUSINESS (v3.20) — facturation complète pour indépendant, inspirée des
   outils libres Invoice Ninja, Crater, InvoiceShelf et Akaunting :
     • informations d'émetteur (nom, SIRET, adresse, mentions, IBAN facultatif)
       dans `hub_business` (sauvegarde GitHub privée, pas de miroir Firestore) ;
     • numérotation continue FA-AAAA-NNN, échéance (délai de paiement),
       date d'encaissement ;
     • facture imprimable / PDF aux mentions françaises usuelles ;
     • relance par e-mail pré-rédigée, duplication ;
     • tableau de bord : CA du mois / de l'année, en attente, en retard,
       12 derniers mois, progression vers le plafond micro-entreprise.
   Tout reste local au hub (aucun service tiers).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const DAY = 86400000;
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 796,50 € (centimes sur 2 chiffres), 1 200 € pour un montant rond.
  const eur = n => { const v = Math.round((Number(n) || 0) * 100) / 100; return v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) + ' €'; };
  const fr = t => new Date(t).toLocaleDateString('fr-FR');
  const readJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } };

  const DEFAULTS = {
    name: '', siret: '', address: '', email: '', phone: '',
    mentions: 'TVA non applicable, art. 293 B du CGI',
    terms: 30, iban: '', ceiling: 77700, b2b: true, seq: {},
  };

  const Biz = {
    KEY: 'hub_business',
    get() { const v = readJSON(this.KEY, {}); return { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}), seq: { ...((v && v.seq) || {}) } }; },
    save(patch) {
      const cur = this.get();
      const next = { ...cur, ...patch };
      next.terms = Math.min(120, Math.max(0, Math.round(Number(next.terms)) || 0));
      next.ceiling = Math.max(0, Math.round(Number(next.ceiling)) || 0);
      for (const k of ['name', 'siret', 'address', 'email', 'phone', 'mentions', 'iban']) next[k] = String(next[k] || '').slice(0, k === 'address' || k === 'mentions' ? 300 : 80).trim();
      try { localStorage.setItem(this.KEY, JSON.stringify(next)); return true; } catch { return false; }
    },
    invoices() { const v = readJSON('hub_invoices', []); return Array.isArray(v) ? v : []; },
    saveInvoices(list) { localStorage.setItem('hub_invoices', JSON.stringify(list)); },

    /** Numéro continu par année d'émission : FA-2026-001. Attribué une seule fois. */
    nextNumber(at) {
      const s = this.get(), y = String(new Date(at || Date.now()).getFullYear());
      const used = this.invoices().map(i => String(i.number || '')).filter(n => n.startsWith('FA-' + y + '-')).map(n => parseInt(n.slice(8), 10) || 0);
      const n = Math.max(s.seq[y] || 0, ...used, 0) + 1;
      s.seq[y] = n; this.save({ seq: s.seq });
      return 'FA-' + y + '-' + String(n).padStart(3, '0');
    },
    ensureNumber(id) {
      const list = this.invoices(), inv = list.find(i => i.id === id); if (!inv) return null;
      if (!inv.number) { inv.number = this.nextNumber(inv.createdAt); this.saveInvoices(list); }
      return inv;
    },
    dueAt(inv) { return Number(inv.dueAt) || (Number(inv.createdAt) || Date.now()) + this.get().terms * DAY; },
    isOpen(inv) { return !inv.draft && (inv.status === 'pending' || inv.status === 'acompte' || !inv.status); },
    isLate(inv) { return this.isOpen(inv) && Date.now() > this.dueAt(inv); },
    clientOf(inv) {
      const cls = readJSON('hub_clients', []);
      return (Array.isArray(cls) ? cls : []).find(c => String(c.name || '').toLowerCase() === String(inv.client || '').toLowerCase()) || null;
    },

    /* ── Facture imprimable / PDF ── */
    print(id) {
      const inv = this.ensureNumber(id); if (!inv) return;
      const s = this.get(), c = this.clientOf(inv) || {};
      if (!s.name) { showToast?.('Renseigne d\'abord tes informations de facturation', '#e4b24a', 3500); return this.openSettings(); }
      const accent = (window.hubAccentHex && hubAccentHex()) || '#C8FF00';
      const paid = inv.status === 'paid';
      const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture ${e(inv.number)} — ${e(s.name)}</title>
<style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#141414;margin:0;padding:24px}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid ${accent};padding-bottom:16px;margin-bottom:22px}
h1{font-size:26px;margin:0;letter-spacing:.04em}.num{font-size:13px;color:#555;margin-top:4px}
.meta{text-align:right;font-size:12px;color:#333}.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
.box h3{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#777;margin:0 0 6px}.box p{margin:0;white-space:pre-line}
table{width:100%;border-collapse:collapse;margin-bottom:18px}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#777;border-bottom:1px solid #ddd;padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid #eee}td.n,th.n{text-align:right;white-space:nowrap}
.tot{margin-left:auto;width:260px}.tot div{display:flex;justify-content:space-between;padding:6px 0}.tot .g{font-size:16px;font-weight:800;border-top:2px solid #141414;margin-top:4px;padding-top:8px}
.stamp{display:inline-block;margin-top:10px;padding:4px 10px;border:2px solid #1d7a46;color:#1d7a46;font-weight:800;border-radius:6px;transform:rotate(-3deg)}
.note{margin:18px 0 0;padding:10px 12px;border-left:3px solid ${accent};background:#f7f7f7;white-space:pre-line}
.legal{margin-top:26px;font-size:10px;color:#555;border-top:1px solid #eee;padding-top:10px}.legal p{margin:2px 0}
.bar{position:fixed;bottom:14px;right:14px}.bar button{font:600 12px system-ui;padding:8px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}
@media print{.bar{display:none}body{padding:0}}
</style></head><body>
<div class="bar"><button onclick="print()">🖨 Imprimer / PDF</button></div>
<div class="top"><div><h1>FACTURE</h1><div class="num">N° ${e(inv.number)}</div></div>
<div class="meta">Date d'émission : <b>${fr(inv.createdAt || Date.now())}</b><br>Échéance : <b>${fr(this.dueAt(inv))}</b>${paid && inv.paidAt ? `<br>Payée le : <b>${fr(inv.paidAt)}</b>` : ''}</div></div>
<div class="parties">
<div class="box"><h3>Émetteur</h3><p><b>${e(s.name)}</b>${s.address ? '\n' + e(s.address) : ''}${s.siret ? '\nSIRET : ' + e(s.siret) : ''}${s.email ? '\n' + e(s.email) : ''}${s.phone ? '\n' + e(s.phone) : ''}</p></div>
<div class="box"><h3>Client</h3><p><b>${e(inv.client || '—')}</b>${c.email ? '\n' + e(c.email) : ''}${c.address ? '\n' + e(c.address) : ''}</p></div>
</div>
<table><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Total</th></tr></thead>
<tbody>${this.linesOf(inv).map(l => `<tr><td>${e(l.label)}</td><td class="n">${String(l.qty).replace('.', ',')}</td><td class="n">${eur(l.unit)}</td><td class="n">${eur(Math.round(l.qty * l.unit * 100) / 100)}</td></tr>`).join('')}</tbody></table>
<div class="tot"><div><span>Total HT</span><span>${eur(inv.price)}</span></div><div class="g"><span>Net à payer</span><span>${eur(inv.price)}</span></div>${paid ? '<span class="stamp">PAYÉE</span>' : ''}</div>
${inv.notes ? `<p class="note">${e(inv.notes)}</p>` : ''}
<div class="legal">
${s.mentions ? `<p>${e(s.mentions)}</p>` : ''}
<p>Paiement ${s.terms ? 'à ' + s.terms + ' jours' : 'à réception'} — échéance le ${fr(this.dueAt(inv))}.${s.iban ? ' IBAN : ' + e(s.iban) : ''}</p>
${s.b2b ? '<p>En cas de retard de paiement : pénalités au taux de trois fois le taux d\'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d\'escompte pour paiement anticipé.</p>' : ''}
</div>
<script>setTimeout(function(){try{print()}catch(e){}},400)</script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { showToast?.('Autorise les fenêtres pour ce site pour imprimer la facture', '#e4b24a', 4000); return; }
      w.document.open(); w.document.write(html); w.document.close();
      if (typeof renderInvoices === 'function') renderInvoices();
    },

    /* ── Relance par e-mail (brouillon dans ta messagerie, rien n'est envoyé seul) ── */
    remind(id) {
      const inv = this.ensureNumber(id); if (!inv) return;
      const s = this.get(), c = this.clientOf(inv) || {};
      const late = this.isLate(inv);
      const subject = (late ? 'Relance — ' : 'Rappel — ') + 'facture ' + inv.number + ' (' + inv.name + ')';
      const body = `Bonjour${inv.client ? ' ' + inv.client : ''},\n\n${late
        ? 'Sauf erreur de ma part, la facture ' + inv.number + ' d\'un montant de ' + eur(inv.price) + ', arrivée à échéance le ' + fr(this.dueAt(inv)) + ', reste à régler.'
        : 'Petit rappel : la facture ' + inv.number + ' d\'un montant de ' + eur(inv.price) + ' arrive à échéance le ' + fr(this.dueAt(inv)) + '.'}\n${s.iban ? '\nIBAN : ' + s.iban + '\n' : ''}\nMerci par avance,\n${s.name || ''}`;
      const href = 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      const list = this.invoices(), i = list.find(x => x.id === id);
      if (i) { i.remindedAt = Date.now(); i.reminders = (i.reminders || 0) + 1; this.saveInvoices(list); }
      location.href = href;
      if (typeof renderInvoices === 'function') setTimeout(renderInvoices, 200);
    },

    duplicate(id) {
      const list = this.invoices(), src = list.find(i => i.id === id); if (!src) return;
      const copy = { id: Date.now().toString(), name: src.name, client: src.client, price: src.price, status: 'pending', createdAt: Date.now() };
      if (Array.isArray(src.lines) && src.lines.length) copy.lines = src.lines.map(l => ({ ...l }));
      if (src.notes) copy.notes = src.notes;
      copy.number = this.nextNumber(copy.createdAt); copy.dueAt = copy.createdAt + this.get().terms * DAY;
      list.push(copy); this.saveInvoices(list);
      if (copy.client && window.ClientWorkspace) { try { ClientWorkspace.bindByClient(copy.client, copy.id, 'invoice'); } catch {} }
      showToast?.('Prestation dupliquée — ' + copy.number + ' ✓', 'var(--green)', 2200);
      if (typeof renderInvoices === 'function') renderInvoices();
      if (typeof syncKPIs === 'function') syncKPIs();
    },

    /* ── Tableau de bord du chiffre d'affaires ── */
    stats(now) {
      now = now || Date.now();
      const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
      const list = this.invoices().filter(i => i.status !== 'cancelled');
      const paidAt = i => Number(i.paidAt) || Number(i.createdAt) || 0;
      const paid = list.filter(i => i.status === 'paid');
      const sum = a => a.reduce((n, i) => n + (Number(i.price) || 0), 0);
      const months = [];
      for (let k = 11; k >= 0; k--) {
        const md = new Date(y, m - k, 1), next = new Date(y, m - k + 1, 1);
        months.push({ label: md.toLocaleDateString('fr-FR', { month: 'short' }), total: sum(paid.filter(i => paidAt(i) >= +md && paidAt(i) < +next)),
          spent: this.expenses().filter(x => Number(x.date) >= +md && Number(x.date) < +next).reduce((n, x) => n + (Number(x.amount) || 0), 0) });
      }
      const open = list.filter(i => this.isOpen(i)), late = open.filter(i => this.isLate(i));
      const year = sum(paid.filter(i => new Date(paidAt(i)).getFullYear() === y));
      return {
        month: months[11].total, year, pending: sum(open), pendingCount: open.length,
        late: sum(late), lateCount: late.length, months, ceiling: this.get().ceiling,
      };
    },
    /* ── Dépenses (3.21, inspiré d'Akaunting / Crater) : hub_expenses ── */
    EXP_CATS: ['Logiciels & abonnements', 'Matériel', 'Formation', 'Déplacements', 'Publicité', 'Frais bancaires', 'Sous-traitance', 'Autre'],
    expenses() { const v = readJSON('hub_expenses', []); return Array.isArray(v) ? v.filter(x => x && Number(x.amount) > 0) : []; },
    saveExpenses(list) { localStorage.setItem('hub_expenses', JSON.stringify(list)); },
    addExpense(x) {
      const amount = Math.round((Number(String(x.amount).replace(',', '.')) || 0) * 100) / 100;
      const label = String(x.label || '').trim().slice(0, 120);
      if (!label || !(amount > 0)) return null;
      const date = Number(x.date) || Date.now();
      const item = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, amount, date,
        category: this.EXP_CATS.includes(x.category) ? x.category : 'Autre', createdAt: Date.now() };
      const list = this.expenses(); list.push(item); this.saveExpenses(list);
      return item;
    },
    removeExpense(id) { this.saveExpenses(this.expenses().filter(x => x.id !== id)); },

    /* ── Périodes ── */
    PERIODS: [['month', 'Ce mois'], ['quarter', 'Ce trimestre'], ['year', 'Cette année'], ['12m', '12 mois'], ['custom', 'Personnalisé']],
    period() { try { const p = JSON.parse(localStorage.getItem('hub_biz_period') || '{}'); return p && p.k ? p : { k: 'year' }; } catch { return { k: 'year' }; } },
    setPeriod(k, from, to) { try { localStorage.setItem('hub_biz_period', JSON.stringify({ k, from, to })); } catch {} this.renderDash(); },
    range(p, now) {
      const d = new Date(now || Date.now()), y = d.getFullYear(), m = d.getMonth();
      if (p.k === 'month') return [+new Date(y, m, 1), +new Date(y, m + 1, 1)];
      if (p.k === 'quarter') { const q = Math.floor(m / 3) * 3; return [+new Date(y, q, 1), +new Date(y, q + 3, 1)]; }
      if (p.k === '12m') return [+new Date(y, m - 11, 1), +new Date(y, m + 1, 1)];
      if (p.k === 'custom' && p.from && p.to) { const a = Date.parse(p.from), b = Date.parse(p.to); if (a && b && b >= a) return [a, b + DAY]; }
      return [+new Date(y, 0, 1), +new Date(y + 1, 0, 1)];
    },
    periodStats(p, now) {
      const [from, to] = this.range(p || this.period(), now);
      const inP = t => t >= from && t < to;
      const paid = this.invoices().filter(i => i.status === 'paid' && inP(Number(i.paidAt) || Number(i.createdAt) || 0));
      const exps = this.expenses().filter(x => inP(Number(x.date) || 0));
      const sum = (a, f) => a.reduce((n, x) => n + (Number(x[f]) || 0), 0);
      const cents = n => Math.round(n * 100) / 100;   // 29,99 + 10 = 39,99 (pas 39,989999…)
      const income = cents(sum(paid, 'price')), spent = cents(sum(exps, 'amount'));
      const byClient = new Map();
      paid.forEach(i => { const k = String(i.client || '').trim() || '—'; const c = byClient.get(k) || { name: k, total: 0, n: 0 }; c.total += Number(i.price) || 0; c.n++; byClient.set(k, c); });
      const allByClient = new Map(); this.invoices().filter(i => i.status !== 'cancelled').forEach(i => { const k = String(i.client || '').trim(); if (k) allByClient.set(k, (allByClient.get(k) || 0) + 1); });
      const top = [...byClient.values()].sort((a, b) => b.total - a.total).slice(0, 5).map(c => ({ ...c, recurring: (allByClient.get(c.name) || 0) >= 2 }));
      const cats = {}; exps.forEach(x => { cats[x.category] = (cats[x.category] || 0) + (Number(x.amount) || 0); });
      return { from, to, income, spent, result: Math.round((income - spent) * 100) / 100, paidCount: paid.length, expenses: exps, paid, top, cats };
    },

    renderDash() {
      const box = document.getElementById('biz-dash'); if (!box) return;
      const st = this.stats(), p = this.period(), ps = this.periodStats(p);
      const max = Math.max(1, ...st.months.map(x => Math.max(x.total, x.spent || 0)));
      const pct = st.ceiling ? Math.min(100, Math.round(st.year / st.ceiling * 100)) : 0;
      const s = this.get();
      const dIso = t => new Date(t).toISOString().slice(0, 10);
      box.innerHTML = `
        <div class="biz-d-bar1"><div class="biz-d-per" role="tablist" aria-label="Période">${this.PERIODS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${p.k === k}" class="${p.k === k ? 'on' : ''}" onclick="Biz.setPeriod('${k}')">${l}</button>`).join('')}</div>
          ${p.k === 'custom' ? `<span class="biz-d-cus"><input type="date" class="prop-input" id="biz-from" value="${e(p.from || dIso(ps.from))}"> → <input type="date" class="prop-input" id="biz-to" value="${e(p.to || dIso(ps.to - DAY))}"> <button class="btn btn-ghost" style="font-size:10px" onclick="Biz.setPeriod('custom',document.getElementById('biz-from').value,document.getElementById('biz-to').value)">OK</button></span>` : ''}
          <span class="biz-d-sp"></span><button class="btn btn-ghost" style="font-size:10px" onclick="Biz.openExpense()">＋ Dépense</button><button class="btn btn-ghost" style="font-size:10px" onclick="Biz.exportReport()" title="Rapport CSV de la période (encaissements + dépenses)">⬇ Rapport</button></div>
        <div class="biz-d-kpis">
          <div><span>Encaissé</span><b>${eur(ps.income)}</b><small>${ps.paidCount} paiement${ps.paidCount > 1 ? 's' : ''}</small></div>
          <div><span>Dépenses</span><b>${eur(ps.spent)}</b><small>${ps.expenses.length} ligne${ps.expenses.length > 1 ? 's' : ''}</small></div>
          <div class="${ps.result < 0 ? 'is-late' : 'is-good'}"><span>Résultat</span><b>${eur(ps.result)}</b><small>encaissé − dépenses</small></div>
          <div class="${st.lateCount ? 'is-late' : ''}"><span>À encaisser</span><b>${eur(st.pending)}</b><small>${st.lateCount ? st.lateCount + ' en retard · ' + eur(st.late) : st.pendingCount + ' en attente'}</small></div>
        </div>
        <div class="biz-d-chart" role="img" aria-label="Encaissements et dépenses des 12 derniers mois">${st.months.map(x => `<div class="biz-d-col" title="${e(x.label)} : encaissé ${eur(x.total)}${x.spent ? ' · dépenses ' + eur(x.spent) : ''}"><span class="biz-d-pair"><i style="height:${Math.round(x.total / max * 100)}%"></i>${x.spent ? `<i class="sp" style="height:${Math.round(x.spent / max * 100)}%"></i>` : ''}</span><span>${e(x.label.replace('.', ''))}</span></div>`).join('')}</div>
        <div class="biz-d-two">
          <div><div class="biz-d-h">Meilleurs clients <small>sur la période</small></div>${ps.top.length ? ps.top.map(c => `<div class="biz-d-li"><span>${e(c.name)}${c.recurring ? ' <em class="biz-rec">récurrent</em>' : ''}</span><b>${eur(c.total)}</b><small>${c.n} paiement${c.n > 1 ? 's' : ''}</small></div>`).join('') : '<p class="biz-d-none">Aucun encaissement sur la période.</p>'}</div>
          <div><div class="biz-d-h">Dépenses <small>sur la période</small></div>${ps.expenses.length ? ps.expenses.slice().sort((a, b) => b.date - a.date).slice(0, 6).map(x => `<div class="biz-d-li"><span>${e(x.label)} <em>${e(x.category)}</em></span><b>${eur(x.amount)}</b><small>${fr(x.date)} <button type="button" class="biz-x" onclick="if(confirm('Supprimer cette dépense ?')){Biz.removeExpense('${e(x.id)}');Biz.renderDash()}" aria-label="Supprimer la dépense">✕</button></small></div>`).join('') + (ps.expenses.length > 6 ? `<p class="biz-d-none">+ ${ps.expenses.length - 6} autre(s) dans le rapport</p>` : '') : '<p class="biz-d-none">Aucune dépense. <button type="button" class="biz-link" onclick="Biz.openExpense()">En ajouter une</button></p>'}</div>
        </div>
        ${st.ceiling ? `<div class="biz-d-ceil"><div class="biz-d-ceil-h"><span>Plafond micro-entreprise ${new Date().getFullYear()}</span><span>${eur(st.year)} / ${eur(st.ceiling)} · ${pct} %</span></div><div class="biz-d-bar"><i style="width:${pct}%;${pct >= 90 ? 'background:var(--red)' : ''}"></i></div></div>` : ''}
        ${!s.name ? '<div class="biz-d-warn">⚠ Ajoute tes informations de facturation pour générer des factures. <button class="btn btn-ghost" style="font-size:10px" onclick="Biz.openSettings()">Compléter</button></div>' : ''}`;
    },

    openExpense() {
      document.getElementById('biz-modal')?.remove();
      const box = document.createElement('div'); box.id = 'biz-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<div class="biz-card"><div class="biz-card-h"><b>📉 Nouvelle dépense</b><button class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        <label class="biz-f"><span>Libellé *</span><input class="prop-input" id="bx-label" maxlength="120" placeholder="Abonnement Adobe, tablette…"></label>
        <div class="biz-row"><label class="biz-f"><span>Montant (€) *</span><input class="prop-input" id="bx-amount" inputmode="decimal" placeholder="29,99"></label>
          <label class="biz-f"><span>Date</span><input class="prop-input" id="bx-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <label class="biz-f"><span>Catégorie</span><select class="prop-input" id="bx-cat">${this.EXP_CATS.map(c => `<option>${e(c)}</option>`).join('')}</select></label>
        <div class="biz-card-f"><button class="btn btn-accent" data-ok>Ajouter</button></div></div>`;
      document.body.appendChild(box);
      const v = id => box.querySelector('#bx-' + id);
      const close = () => box.remove();
      box.querySelector('[data-x]').onclick = close;
      box.addEventListener('click', ev => { if (ev.target === box) close(); });
      box.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') box.querySelector('[data-ok]').click(); });
      box.querySelector('[data-ok]').onclick = () => {
        const it = this.addExpense({ label: v('label').value, amount: v('amount').value, date: Date.parse(v('date').value) || Date.now(), category: v('cat').value });
        if (!it) return showToast?.('Libellé et montant positif requis', '#c0392b', 2500);
        close(); this.renderDash(); showToast?.('Dépense ajoutée ✓', 'var(--green)', 1800);
      };
      setTimeout(() => v('label').focus(), 30);
    },

    /** Rapport CSV de la période : résumé, encaissements, dépenses (Excel, « ; »). */
    reportCSV(p) {
      const ps = this.periodStats(p || this.period());
      const d = t => new Date(t).toLocaleDateString('fr-FR'), n = x => String(Math.round((Number(x) || 0) * 100) / 100).replace('.', ',');
      const rows = [
        ['Rapport', 'Du ' + d(ps.from), 'au ' + d(ps.to - DAY)],
        ['Encaissé', n(ps.income)], ['Dépenses', n(ps.spent)], ['Résultat', n(ps.result)], [],
        ['Encaissements'], ['Numéro', 'Date d\'encaissement', 'Client', 'Prestation', 'Montant'],
        ...ps.paid.map(i => [i.number || '', d(Number(i.paidAt) || Number(i.createdAt)), i.client || '', i.name || '', n(i.price)]), [],
        ['Dépenses'], ['Date', 'Catégorie', 'Libellé', 'Montant'],
        ...ps.expenses.map(x => [d(x.date), x.category, x.label, n(x.amount)]),
      ];
      return '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    },
    exportReport() {
      const blob = new Blob([this.reportCSV()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'rapport-souanpt-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast?.('Rapport CSV téléchargé ✓', 'var(--green)', 2200);
    },

    /* ── Dossier client → facture, sans ressaisie (3.21) ──
       mode 'balance' : reste à facturer (mission − déjà facturé) ;
       mode 'deposit' : acompte du portail (%). Le formulaire est prérempli,
       l'utilisateur valide ; la facture est rattachée AU dossier (jeton),
       jamais par simple correspondance de nom. */
    workspaceAmounts(token) {
      const ws = (readJSON('hub_workspaces', []) || []).find(w => w && w.token === token); if (!ws) return null;
      const por = (readJSON('hub_portals', []) || []).find(p => p && (p.id === token || p.workspaceId === token)) || null;
      const inv = this.invoices().filter(i => i.workspaceId === token && i.status !== 'cancelled');
      const invoiced = inv.reduce((n, i) => n + (Number(i.price) || 0), 0);
      const mission = Number(por && por.total) || Number(ws.total) || 0;
      const pct = Math.max(0, Math.min(100, Number(por && por.acomptePct) || 0));
      return { ws, mission, invoiced, balance: Math.max(0, mission - invoiced), pct, deposit: pct ? Math.round(mission * pct) / 100 : 0 };
    },
    fromWorkspace(token, mode) {
      const a = this.workspaceAmounts(token); if (!a) return showToast?.('Dossier introuvable', '#c0392b', 2500);
      const deposit = mode === 'deposit' && a.deposit > 0;
      const name = (a.ws.projectName || 'Prestation') + (deposit ? ' — acompte ' + a.pct + ' %' : (a.invoiced > 0 ? ' — solde' : ''));
      const price = deposit ? a.deposit : (a.balance || a.mission || '');
      window._invFromWorkspace = token;
      try { window.ClientWorkspace && ClientWorkspace.close(); } catch {}
      if (typeof showPage === 'function') showPage('facturation');
      setTimeout(() => {
        try { window.toggleForm && toggleForm('add-inv-form', true); } catch {}
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('inv-name', name); set('inv-client', a.ws.clientName || ''); set('inv-price', price);
        const h = document.getElementById('inv-price-hint');
        if (h) h.textContent = '📁 Dossier « ' + (a.ws.projectName || 'projet') + ' » — mission ' + eur(a.mission) + (a.invoiced ? ', déjà facturé ' + eur(a.invoiced) : '');
        document.getElementById('inv-price')?.focus();
      }, 160);
    },
    /** Fiche client : ce qu'il a réglé, ce qu'il doit, ses dernières factures (3.21). */
    clientSummary(name) {
      const k = String(name || '').trim().toLowerCase(); if (!k) return null;
      const list = this.invoices().filter(i => i.status !== 'cancelled' && String(i.client || '').trim().toLowerCase() === k);
      const sum = a => a.reduce((n, i) => n + (Number(i.price) || 0), 0);
      const open = list.filter(i => this.isOpen(i)), late = open.filter(i => this.isLate(i));
      return { count: list.length, paid: sum(list.filter(i => i.status === 'paid')), open: sum(open), late: sum(late), lateCount: late.length,
        last: list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3) };
    },
    clientBlock(name) {
      const s = this.clientSummary(name); if (!s) return '';
      const st = i => i.status === 'paid' ? 'Payée' : this.isLate(i) ? 'En retard' : i.status === 'acompte' ? 'Acompte' : 'En attente';
      return `<h4>Facturation (${s.count})</h4>`
        + (s.count ? `<div class="client-biz"><span>Réglé <b>${eur(s.paid)}</b></span><span>À encaisser <b>${eur(s.open)}</b></span>${s.lateCount ? `<span class="late">En retard <b>${eur(s.late)}</b></span>` : ''}</div>`
          + s.last.map(i => `<div class="client-item">${i.number ? `<span style="color:var(--muted2);font-size:9px">${e(i.number)}</span> ` : ''}<b>${e(i.name)}</b> · ${eur(i.price)} · <span style="color:${i.status === 'paid' ? 'var(--accent)' : this.isLate(i) ? 'var(--red)' : 'var(--muted2)'}">${st(i)}</span></div>`).join('')
          : '<div class="client-sub">Aucune facture.</div>');
    },
    newForClient(name) {
      window._invFromWorkspace = null;
      if (typeof showPage === 'function') showPage('facturation');
      setTimeout(() => { try { window.toggleForm && toggleForm('add-inv-form', true); } catch {} const c = document.getElementById('inv-client'); if (c) c.value = name || ''; document.getElementById('inv-name')?.focus(); }, 160);
    },

    /** Appelé par addInvoice : rattache la facture au dossier d'origine. */
    consumeWorkspace(inv) {
      const token = window._invFromWorkspace; window._invFromWorkspace = null;
      if (!token || !inv || !window.ClientWorkspace) return false;
      try { return ClientWorkspace.attach(inv.id, token, 'invoice'); } catch { return false; }
    },

    /* ── Lignes de facture (3.24) ──
       Ancienne facture sans `lines` = une ligne (nom × 1 × prix). Le total
       (`price`) est toujours recalculé depuis les lignes, arrondi au centime. */
    linesOf(inv) {
      const ls = Array.isArray(inv && inv.lines) ? inv.lines.filter(l => l && String(l.label || '').trim()) : [];
      return ls.length ? ls.map(l => ({ label: String(l.label).slice(0, 160), qty: Math.max(0, Number(l.qty) || 0), unit: Number(l.unit) || 0 }))
        : [{ label: String((inv && inv.name) || 'Prestation'), qty: 1, unit: Number(inv && inv.price) || 0 }];
    },
    totalOf(lines) { return Math.round(lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0) * 100) / 100; },
    /** Lignes saisies → lignes propres (libellé requis, quantité ≥ 0, prix numérique). */
    cleanLines(raw) {
      return (Array.isArray(raw) ? raw : []).map(l => ({
        label: String((l && l.label) || '').trim().slice(0, 160),
        qty: Math.max(0, Math.round((Number(String(l && l.qty).replace(',', '.')) || 0) * 100) / 100),
        unit: Math.round((Number(String(l && l.unit).replace(',', '.')) || 0) * 100) / 100,
      })).filter(l => l.label).slice(0, 50);
    },
    updateInvoice(id, patch) {
      const list = this.invoices(), inv = list.find(i => i.id === id); if (!inv) return null;
      if (patch.lines) {
        const lines = this.cleanLines(patch.lines); if (!lines.length) return null;
        inv.lines = lines; inv.price = this.totalOf(lines);
      }
      if (typeof patch.name === 'string' && patch.name.trim()) inv.name = patch.name.trim().slice(0, 160);
      else if (patch.lines) inv.name = inv.lines[0].label;
      if (typeof patch.client === 'string') inv.client = patch.client.trim().slice(0, 120);
      if (Number(patch.createdAt) > 0) inv.createdAt = Number(patch.createdAt);
      if (Number(patch.dueAt) > 0) inv.dueAt = Number(patch.dueAt);
      if (typeof patch.notes === 'string') inv.notes = patch.notes.trim().slice(0, 600);
      this.saveInvoices(list);
      return inv;
    },

    /* ── Modèles de facture (hub_inv_templates) ── */
    templates() { const v = readJSON('hub_inv_templates', []); return Array.isArray(v) ? v.filter(t => t && t.name && Array.isArray(t.lines)) : []; },
    saveTemplate(name, lines, notes) {
      const clean = this.cleanLines(lines); name = String(name || '').trim().slice(0, 80);
      if (!name || !clean.length) return null;
      const list = this.templates().filter(t => t.name.toLowerCase() !== name.toLowerCase());
      const t = { id: 't' + Date.now().toString(36), name, lines: clean, notes: String(notes || '').slice(0, 600) };
      list.unshift(t); localStorage.setItem('hub_inv_templates', JSON.stringify(list.slice(0, 30)));
      return t;
    },
    removeTemplate(id) { localStorage.setItem('hub_inv_templates', JSON.stringify(this.templates().filter(t => t.id !== id))); },

    /** Nouvelle facture détaillée : créée vide puis ouverte dans l'éditeur (supprimée si abandonnée vide). */
    newDetailed(client) {
      const list = this.invoices(), now = Date.now();
      const inv = { id: now.toString(), name: 'Nouvelle facture', client: client || '', price: 0, status: 'pending', createdAt: now, lines: [], draft: true };
      inv.number = this.nextNumber(now); inv.dueAt = now + this.get().terms * DAY;
      list.push(inv); this.saveInvoices(list);
      this.editInvoice(inv.id);
    },

    editInvoice(id) {
      const inv = this.invoices().find(i => i.id === id); if (!inv) return;
      document.getElementById('biz-modal')?.remove();
      const box = document.createElement('div'); box.id = 'biz-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      const iso = t => new Date(t).toISOString().slice(0, 10);
      const cat = (readJSON('hub_catalog', []) || []).filter(c => c && c.name);
      const tpls = this.templates();
      const clients = (readJSON('hub_clients', []) || []).map(c => c && c.name).filter(Boolean);
      const lines = inv.draft && !(inv.lines || []).length ? [{ label: '', qty: 1, unit: '' }] : this.linesOf(inv);
      box.innerHTML = `<div class="biz-card biz-card-w"><div class="biz-card-h"><b>✎ ${e(inv.number || 'Facture')}</b><button class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        ${inv.status === 'paid' ? '<div class="biz-d-warn" style="margin:0 0 8px">Facture déjà payée : ne la modifie que pour corriger une erreur.</div>' : ''}
        <div class="biz-row"><label class="biz-f"><span>Client</span><input class="prop-input" id="be-client" list="be-clients" value="${e(inv.client || '')}" maxlength="120"></label>
          <label class="biz-f"><span>Émise le</span><input class="prop-input" type="date" id="be-date" value="${iso(inv.createdAt || Date.now())}"></label>
          <label class="biz-f"><span>Échéance</span><input class="prop-input" type="date" id="be-due" value="${iso(this.dueAt(inv))}"></label></div>
        <datalist id="be-clients">${clients.map(c => `<option value="${e(c)}">`).join('')}</datalist>
        <div class="be-lines"><div class="be-lh"><span>Désignation</span><span>Qté</span><span>Prix unit.</span><span>Total</span><span></span></div><div id="be-rows"></div></div>
        <div class="sys-row" style="margin-top:6px"><button class="btn btn-ghost" style="font-size:10px" data-add>＋ Ligne</button>
          ${cat.length ? `<select class="prop-input" id="be-cat" style="width:auto;font-size:10px"><option value="">＋ Depuis le catalogue…</option>${cat.map((c, i) => `<option value="${i}">${e(c.name)} — ${eur(c.price)}</option>`).join('')}</select>` : ''}
          ${tpls.length ? `<select class="prop-input" id="be-tpl" style="width:auto;font-size:10px"><option value="">Appliquer un modèle…</option>${tpls.map(t => `<option value="${e(t.id)}">${e(t.name)}</option>`).join('')}</select>` : ''}
          <span class="biz-d-sp"></span><b class="be-total" id="be-total"></b></div>
        <label class="biz-f" style="margin-top:8px"><span>Note imprimée sur la facture (facultatif)</span><textarea class="prop-input" id="be-notes" rows="2" maxlength="600" placeholder="Modalités, référence de commande…">${e(inv.notes || '')}</textarea></label>
        <div class="biz-card-f" style="gap:8px"><button class="btn btn-ghost" data-tplsave title="Réutiliser ces lignes pour une prochaine facture">☆ Enregistrer comme modèle</button><button class="btn btn-accent" data-ok>Enregistrer</button></div></div>`;
      document.body.appendChild(box);
      const rows = box.querySelector('#be-rows'), tot = box.querySelector('#be-total');
      const row = l => `<div class="be-row"><input class="prop-input" data-k="label" value="${e(l.label)}" maxlength="160" placeholder="Prestation"><input class="prop-input" data-k="qty" value="${e(l.qty)}" inputmode="decimal"><input class="prop-input" data-k="unit" value="${e(l.unit)}" inputmode="decimal" placeholder="0"><span class="be-lt"></span><button type="button" class="biz-x" data-del aria-label="Retirer la ligne">✕</button></div>`;
      const read = () => [...rows.querySelectorAll('.be-row')].map(r => ({ label: r.querySelector('[data-k=label]').value, qty: r.querySelector('[data-k=qty]').value, unit: r.querySelector('[data-k=unit]').value }));
      const recalc = () => {
        rows.querySelectorAll('.be-row').forEach(r => { const q = Number(String(r.querySelector('[data-k=qty]').value).replace(',', '.')) || 0, u = Number(String(r.querySelector('[data-k=unit]').value).replace(',', '.')) || 0; r.querySelector('.be-lt').textContent = eur(Math.round(q * u * 100) / 100); });
        tot.textContent = 'Total ' + eur(this.totalOf(this.cleanLines(read())));
      };
      const draw = ls => { rows.innerHTML = ls.map(row).join(''); recalc(); };
      draw(lines);
      rows.addEventListener('input', recalc);
      rows.addEventListener('click', ev => { if (ev.target.closest('[data-del]')) { ev.target.closest('.be-row').remove(); if (!rows.children.length) draw([{ label: '', qty: 1, unit: '' }]); recalc(); } });
      box.querySelector('[data-add]').onclick = () => { rows.insertAdjacentHTML('beforeend', row({ label: '', qty: 1, unit: '' })); rows.lastElementChild.querySelector('input').focus(); recalc(); };
      const catSel = box.querySelector('#be-cat'); if (catSel) catSel.onchange = () => { const c = cat[+catSel.value]; if (c) { const cur = read().filter(l => l.label.trim()); draw([...cur, { label: c.name, qty: 1, unit: c.price }]); } catSel.value = ''; };
      const tplSel = box.querySelector('#be-tpl'); if (tplSel) tplSel.onchange = () => { const t = tpls.find(x => x.id === tplSel.value); if (t) { draw(t.lines); if (t.notes && !box.querySelector('#be-notes').value) box.querySelector('#be-notes').value = t.notes; } tplSel.value = ''; };
      const close = () => {
        const cur = this.invoices().find(i => i.id === id);
        if (cur && cur.draft) { this.saveInvoices(this.invoices().filter(i => i.id !== id)); if (typeof renderInvoices === 'function') renderInvoices(); }   // brouillon abandonné
        box.remove();
      };
      box.querySelector('[data-x]').onclick = close;
      box.addEventListener('click', ev => { if (ev.target === box) close(); });
      box.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
      box.querySelector('[data-tplsave]').onclick = () => {
        const name = prompt('Nom du modèle :', (read()[0] || {}).label || 'Modèle');
        if (name === null) return;
        const t = this.saveTemplate(name, read(), box.querySelector('#be-notes').value);
        showToast?.(t ? 'Modèle « ' + t.name + ' » enregistré ✓' : 'Ajoute au moins une ligne avec un libellé', t ? 'var(--green)' : '#c0392b', 2200);
      };
      box.querySelector('[data-ok]').onclick = () => {
        const ls = this.cleanLines(read());
        if (!ls.length) return showToast?.('Ajoute au moins une ligne avec un libellé', '#c0392b', 2500);
        const date = Date.parse(box.querySelector('#be-date').value) || inv.createdAt, due = Date.parse(box.querySelector('#be-due').value) || 0;
        if (due && due < date) return showToast?.('L\'échéance doit suivre la date d\'émission', '#c0392b', 2500);
        const saved = this.updateInvoice(id, { lines: ls, client: box.querySelector('#be-client').value, createdAt: date, dueAt: due || undefined, notes: box.querySelector('#be-notes').value });
        if (!saved) return;
        const list = this.invoices(), cur = list.find(i => i.id === id); if (cur && cur.draft) { delete cur.draft; this.saveInvoices(list); }
        box.remove();
        if (saved.client && window.ClientWorkspace && !saved.workspaceId) { try { ClientWorkspace.bindByClient(saved.client, saved.id, 'invoice'); } catch {} }
        if (typeof renderInvoices === 'function') renderInvoices();
        if (typeof syncKPIs === 'function') syncKPIs();
        showToast?.((saved.number || 'Facture') + ' enregistrée — ' + eur(saved.price) + ' ✓', 'var(--green)', 2200);
      };
      setTimeout(() => rows.querySelector('input')?.focus(), 30);
    },

    /* ── Rappels d'échéance dans la cloche (3.24), sans envahir ──
       • une notification PAR JOUR pour l'ensemble des factures en retard ;
       • une notification par facture qui arrive à échéance dans ≤ 3 jours. */
    dueReminders(now) {
      now = now || Date.now();
      if (typeof Notify === 'undefined' || !Notify._sysAll || !Notify._sysSave) return 0;
      const all = Notify._sysAll(), has = id => all.some(n => n.id === id);
      const add = [];
      const late = this.invoices().filter(i => this.isLate(i));
      const day = new Date(now).toISOString().slice(0, 10);
      if (late.length && !has('due-late-' + day)) {
        const sum = late.reduce((n, i) => n + (Number(i.price) || 0), 0);
        add.push({ id: 'due-late-' + day, local: true, event: 'invoice.late', category: 'payments', page: 'facturation',
          title: '⏰ ' + late.length + ' facture' + (late.length > 1 ? 's' : '') + ' en retard', message: eur(sum) + ' à encaisser — ' + late.slice(0, 3).map(i => i.number || i.name).join(', ') + (late.length > 3 ? '…' : ''), createdAt: now });
      }
      this.invoices().filter(i => this.isOpen(i) && !this.isLate(i) && this.dueAt(i) - now <= 3 * DAY).forEach(i => {
        const id = 'due-soon-' + i.id + '-' + new Date(this.dueAt(i)).toISOString().slice(0, 10);
        if (!has(id)) add.push({ id, local: true, event: 'invoice.due', category: 'payments', page: 'facturation',
          title: '📅 Échéance le ' + fr(this.dueAt(i)), message: (i.number ? i.number + ' · ' : '') + (i.name || '') + ' — ' + eur(i.price) + (i.client ? ' (' + i.client + ')' : ''), createdAt: now });
      });
      if (!add.length) return 0;
      Notify._sysSave([...add, ...all]);
      try { Notify.loadInbox().then(() => Notify.renderInbox()); } catch {}
      return add.length;
    },

    /* ── Vue d'ensemble : ce qui attend une action, toutes pages confondues ── */
    renderTodo() {
      const box = document.getElementById('ov-todo'); if (!box) return;
      const inv = this.invoices(), now = Date.now();
      const sum = a => a.reduce((n, i) => n + (Number(i.price) || 0), 0);
      const late = inv.filter(i => this.isLate(i));
      const soon = inv.filter(i => this.isOpen(i) && !this.isLate(i) && this.dueAt(i) - now < 7 * DAY);
      const revs = (readJSON('hub_reviews', []) || []).filter(r => r && r.status === 'pending');
      const reqs = (readJSON('hub_workspaces', []) || []).filter(w => w && w.stage === 'request' && (w.status || 'active') === 'active');
      const items = [];
      const pl = (n, a, b) => n + ' ' + (n > 1 ? b : a);
      if (late.length) items.push({ ic: '⏰', t: pl(late.length, 'facture en retard', 'factures en retard'), s: eur(sum(late)) + ' à relancer', go: "showPage('facturation')", cls: 'bad' });
      if (soon.length) items.push({ ic: '📅', t: pl(soon.length, 'échéance cette semaine', 'échéances cette semaine'), s: eur(sum(soon)), go: "showPage('facturation')" });
      if (revs.length) items.push({ ic: '⭐', t: pl(revs.length, 'avis à valider', 'avis à valider'), s: 'avant publication sur le site', go: "showPage('avis')" });
      if (reqs.length) items.push({ ic: '📥', t: pl(reqs.length, 'demande à traiter', 'demandes à traiter'), s: 'nouveau projet client', go: "showPage('cp')" });
      box.innerHTML = `<div class="an-card-h"><span>⚡ À traiter</span><span class="an-card-sub">${items.length ? items.length + ' point' + (items.length > 1 ? 's' : '') : 'tout est à jour'}</span></div>`
        + (items.length ? `<div class="ov-todo-l">${items.map(x => `<button type="button" class="ov-todo-i ${x.cls || ''}" onclick="${x.go}"><span class="ov-todo-ic">${x.ic}</span><span class="ov-todo-t"><b>${e(x.t)}</b><small>${e(x.s)}</small></span><span class="ov-todo-go">→</span></button>`).join('')}</div>`
          : '<p class="ov-hint" style="margin:0">Rien en attente ✓</p>');
      const badge = document.getElementById('fac-badge');
      if (badge) { badge.textContent = late.length || ''; badge.style.display = late.length ? '' : 'none'; badge.title = late.length ? pl(late.length, 'facture à relancer', 'factures à relancer') : ''; }
    },

    /* ── Réglages de facturation ── */
    openSettings() {
      document.getElementById('biz-modal')?.remove();
      const s = this.get();
      const box = document.createElement('div'); box.id = 'biz-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      const f = (id, label, val, attrs) => `<label class="biz-f"><span>${label}</span><input class="prop-input" id="bz-${id}" value="${e(val)}" ${attrs || ''}></label>`;
      box.innerHTML = `<div class="biz-card"><div class="biz-card-h"><b>⚙ Informations de facturation</b><button class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        ${f('name', 'Nom ou raison sociale *', s.name, 'maxlength="80" placeholder="Souanpt — Prénom Nom"')}
        ${f('siret', 'SIRET', s.siret, 'maxlength="20" inputmode="numeric" placeholder="123 456 789 00012"')}
        <label class="biz-f"><span>Adresse</span><textarea class="prop-input" id="bz-address" rows="2" maxlength="300">${e(s.address)}</textarea></label>
        <div class="biz-row">${f('email', 'E-mail', s.email, 'type="email" maxlength="80"')}${f('phone', 'Téléphone', s.phone, 'maxlength="30"')}</div>
        ${f('mentions', 'Mention TVA', s.mentions, 'maxlength="300"')}
        <div class="biz-row">${f('terms', 'Délai de paiement (jours)', s.terms, 'type="number" min="0" max="120"')}${f('ceiling', 'Plafond annuel (€)', s.ceiling, 'type="number" min="0" step="100"')}</div>
        ${f('iban', 'IBAN (facultatif, affiché sur la facture)', s.iban, 'maxlength="40" autocomplete="off"')}
        <label class="edw-tog" style="font-size:11px"><input type="checkbox" id="bz-b2b"${s.b2b ? ' checked' : ''}> Mentions de retard pour clients professionnels</label>
        <div class="biz-card-f"><button class="btn btn-accent" data-ok>Enregistrer</button></div></div>`;
      document.body.appendChild(box);
      const v = id => box.querySelector('#bz-' + id);
      box.querySelector('[data-x]').onclick = () => box.remove();
      box.addEventListener('click', ev => { if (ev.target === box) box.remove(); });
      box.addEventListener('keydown', ev => { if (ev.key === 'Escape') box.remove(); });
      box.querySelector('[data-ok]').onclick = () => {
        if (!v('name').value.trim()) { v('name').focus(); return showToast?.('Le nom est obligatoire sur une facture', '#c0392b', 2500); }
        const ok = this.save({ name: v('name').value, siret: v('siret').value, address: v('address').value, email: v('email').value, phone: v('phone').value,
          mentions: v('mentions').value, terms: v('terms').value, ceiling: v('ceiling').value, iban: v('iban').value, b2b: v('b2b').checked });
        if (!ok) return showToast?.('Stockage plein — non enregistré', '#c0392b', 3000);
        box.remove(); this.renderDash(); showToast?.('Informations de facturation enregistrées ✓', 'var(--green)', 2000);
      };
      setTimeout(() => v('name').focus(), 30);
    },
  };

  window.Biz = Biz;
  // Rappels d'échéance : peu après le chargement, puis toutes les 6 h onglet visible (idempotents).
  if (typeof window.addEventListener === 'function') window.addEventListener('load', () => setTimeout(() => { try { Biz.dueReminders(); } catch {} }, 6000));
  if (typeof setInterval === 'function') setInterval(() => { try { if (!document.hidden) Biz.dueReminders(); } catch {} }, 6 * 3600 * 1000);
})();
