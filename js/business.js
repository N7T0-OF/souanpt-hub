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
  const eur = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
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
    isOpen(inv) { return inv.status === 'pending' || inv.status === 'acompte' || !inv.status; },
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
<tbody><tr><td>${e(inv.name)}</td><td class="n">1</td><td class="n">${eur(inv.price)}</td><td class="n">${eur(inv.price)}</td></tr></tbody></table>
<div class="tot"><div><span>Total HT</span><span>${eur(inv.price)}</span></div><div class="g"><span>Net à payer</span><span>${eur(inv.price)}</span></div>${paid ? '<span class="stamp">PAYÉE</span>' : ''}</div>
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
        months.push({ label: md.toLocaleDateString('fr-FR', { month: 'short' }), total: sum(paid.filter(i => paidAt(i) >= +md && paidAt(i) < +next)) });
      }
      const open = list.filter(i => this.isOpen(i)), late = open.filter(i => this.isLate(i));
      const year = sum(paid.filter(i => new Date(paidAt(i)).getFullYear() === y));
      return {
        month: months[11].total, year, pending: sum(open), pendingCount: open.length,
        late: sum(late), lateCount: late.length, months, ceiling: this.get().ceiling,
      };
    },
    renderDash() {
      const box = document.getElementById('biz-dash'); if (!box) return;
      const st = this.stats(), max = Math.max(1, ...st.months.map(x => x.total));
      const pct = st.ceiling ? Math.min(100, Math.round(st.year / st.ceiling * 100)) : 0;
      const s = this.get();
      box.innerHTML = `
        <div class="biz-d-kpis">
          <div><span>Encaissé ce mois</span><b>${eur(st.month)}</b></div>
          <div><span>Encaissé ${new Date().getFullYear()}</span><b>${eur(st.year)}</b></div>
          <div><span>En attente</span><b>${eur(st.pending)}</b><small>${st.pendingCount} prestation${st.pendingCount > 1 ? 's' : ''}</small></div>
          <div class="${st.lateCount ? 'is-late' : ''}"><span>En retard</span><b>${eur(st.late)}</b><small>${st.lateCount ? st.lateCount + ' à relancer' : 'aucune'}</small></div>
        </div>
        <div class="biz-d-chart" role="img" aria-label="Encaissements des 12 derniers mois">${st.months.map(x => `<div class="biz-d-col" title="${e(x.label)} : ${eur(x.total)}"><i style="height:${Math.round(x.total / max * 100)}%"></i><span>${e(x.label.replace('.', ''))}</span></div>`).join('')}</div>
        ${st.ceiling ? `<div class="biz-d-ceil"><div class="biz-d-ceil-h"><span>Plafond micro-entreprise</span><span>${eur(st.year)} / ${eur(st.ceiling)} · ${pct} %</span></div><div class="biz-d-bar"><i style="width:${pct}%;${pct >= 90 ? 'background:var(--red)' : ''}"></i></div></div>` : ''}
        ${!s.name ? '<div class="biz-d-warn">⚠ Ajoute tes informations de facturation pour générer des factures. <button class="btn btn-ghost" style="font-size:10px" onclick="Biz.openSettings()">Compléter</button></div>' : ''}`;
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
})();
