/* ══════════════════════════════════════════════════════════════
   RECHERCHE GLOBALE + ACTIONS RAPIDES (v3.21) — Ctrl/⌘ + K
   Une seule entrée pour retrouver un client, un dossier, un projet du
   portfolio, une facture (numéro, montant), un avis, une page ou lancer
   une action (nouveau client, nouvelle prestation, lien de demande…),
   depuis n'importe quelle page. Inspiré des palettes de commandes des
   outils libres (Plane, Twenty, Linear-like).
   Lecture seule des données locales ; chaque action passe par les
   fonctions existantes du hub. Récents mémorisés sur cet appareil.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const RECENT_KEY = 'hub_cmdk_recent';
  const DIAC = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(DIAC, '').toLowerCase();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } };
  const arr = k => { const v = read(k, []); return Array.isArray(v) ? v : []; };
  const eur = n => (Number(n) || 0).toLocaleString('fr-FR') + ' €';
  const later = (fn, ms) => setTimeout(() => { try { fn(); } catch (e) { console.warn('[recherche]', e); } }, ms || 0);
  const page = p => { try { window.showPage && showPage(p); } catch (e) { console.warn(e); } };

  /* ── Ce que la palette sait ouvrir ── */
  const PAGES = [
    ['overview', '🏠', 'Vue d\'ensemble'], ['editor', '✏️', 'Éditeur de site'], ['storage', '💾', 'Stockage'],
    ['cp', '🗂️', 'Clients & Projets'], ['devis', '📥', 'Demandes & Devis'], ['portals', '🔗', 'Portails'],
    ['facturation', '💶', 'Facturation'], ['avis', '⭐', 'Avis'], ['settings', '⚙️', 'Paramètres'], ['tools', '🧰', 'Outils (image, palette, contraste, QR)'],
  ];
  const ACTIONS = [
    { ic: '👤', t: 'Nouveau client', k: 'creer ajouter client fiche', run: () => window.openClientForm && openClientForm() },
    { ic: '💶', t: 'Nouvelle prestation / facture', k: 'facture facturer prestation creer', run: () => { page('facturation'); later(() => window.toggleForm && toggleForm('add-inv-form', true), 120); } },
    { ic: '🗂️', t: 'Nouveau projet client', k: 'projet dossier mission creer', run: () => { page('cp'); later(() => window.CP && CP.newProject && CP.newProject(), 150); } },
    { ic: '🔗', t: 'Créer un lien de demande', k: 'demande lien brief client', run: () => { page('devis'); later(() => window.QuoteUI && QuoteUI.newRequestLink && QuoteUI.newRequestLink(), 150); } },
    { ic: '🚀', t: 'Publier le site', k: 'publier deployer mettre en ligne site', run: () => window.edDeploy && edDeploy() },
    { ic: '↻', t: 'Synchroniser Behance', k: 'behance sync importer projets rss', run: () => window.syncBehance && syncBehance() },
    { ic: '🧾', t: 'Mes infos de facturation', k: 'siret adresse mentions iban facturation reglages', run: () => { page('facturation'); later(() => window.Biz && Biz.openSettings(), 150); } },
    { ic: '🧾', t: 'Facture détaillée (plusieurs lignes)', k: 'facture lignes quantite modele devis', run: () => { page('facturation'); later(() => window.Biz && Biz.newDetailed(), 150); } },
    { ic: '📉', t: 'Ajouter une dépense', k: 'depense charge achat frais', run: () => { page('facturation'); later(() => window.Biz && Biz.openExpense && Biz.openExpense(), 150); } },
    { ic: '🔎', t: 'Référencement (SEO)', k: 'seo google referencement partage', run: () => { page('editor'); later(() => window.edWinSEO && edWinSEO(), 500); } },
    { ic: '👻', t: 'Relier haunt.gg', k: 'haunt profil liens folio', run: () => { page('editor'); later(() => window.edWinHaunt && edWinHaunt(), 500); } },
    { ic: '🎨', t: 'Thème du site', k: 'theme couleur style design accent', run: () => { page('editor'); later(() => window.edWinTheme && edWinTheme(), 500); } },
    { ic: '🗜', t: 'Compresser une image', k: 'image compresser redimensionner convertir webp jpg exif filigrane', run: () => { page('tools'); later(() => window.Toolbox && Toolbox.go('image'), 120); } },
    { ic: '🎨', t: 'Palette de couleurs d\'une image', k: 'palette couleur extraire logo accent', run: () => { page('tools'); later(() => window.Toolbox && Toolbox.go('palette'), 120); } },
    { ic: '◐', t: 'Vérifier un contraste', k: 'contraste lisibilite wcag accessibilite', run: () => { page('tools'); later(() => window.Toolbox && Toolbox.go('contrast'), 120); } },
    { ic: '⌨', t: 'Raccourcis clavier', k: 'raccourcis clavier aide touches', run: () => window.Shortcuts && Shortcuts.help() },
    { ic: '⬇', t: 'Exporter les prestations (CSV)', k: 'export csv excel comptable', run: () => window.exportInvoicesCSV && exportInvoicesCSV() },
  ];

  function index() {
    const out = [];
    PAGES.forEach(([id, ic, t]) => out.push({ g: 'Pages', ic, t, s: '', k: norm(t), id: 'page:' + id, run: () => page(id) }));
    ACTIONS.forEach((a, i) => out.push({ g: 'Actions', ic: a.ic, t: a.t, s: '', k: norm(a.t + ' ' + a.k), id: 'act:' + i, run: a.run }));
    arr('hub_clients').forEach(c => {
      if (!c || !c.name) return;
      out.push({ g: 'Clients', ic: '👤', t: c.name, s: [c.type, c.email].filter(Boolean).join(' · '), k: norm([c.name, c.type, c.email].join(' ')), id: 'cl:' + c.id,
        run: () => { page('cp'); later(() => { window.CP && CP.setView && CP.setView('clients'); const i = document.getElementById('cp-search'); if (i) { i.value = c.name; window.CP && CP.setSearch && CP.setSearch(c.name); } }, 150); } });
    });
    arr('hub_workspaces').forEach(w => {
      if (!w || !w.token || (!w.projectName && !w.clientName)) return;
      const st = { request: 'Demande', estimate: 'Devis', mission: 'Mission', done: 'Terminé' }[w.stage] || '';
      out.push({ g: 'Dossiers clients', ic: '📁', t: w.projectName || 'Projet sans nom', s: [w.clientName, st, w.total ? eur(w.total) : ''].filter(Boolean).join(' · '),
        k: norm([w.projectName, w.clientName, st].join(' ')), id: 'ws:' + w.token,
        run: () => { page('cp'); later(() => window.ClientWorkspace && ClientWorkspace.open(w.token), 200); } });
    });
    arr('hub_projects').forEach(p => {
      if (!p || !p.title) return;
      out.push({ g: 'Portfolio', ic: '🖼', t: p.title, s: (Array.isArray(p.tags) ? p.tags.slice(0, 3).join(', ') : '') + (p.hidden ? ' · masqué' : ''),
        k: norm([p.title, (p.tags || []).join(' '), p.sub].join(' ')), id: 'pj:' + p.id,
        run: () => { page('editor'); later(() => {
          try { const b = getBlocks().find(x => x.type === 'project' && String(bRef(x)) === String(p.id)); if (b && window.edWinEdit) edWinEdit(b.id); } catch (e) { console.warn(e); }
        }, 600); } });
    });
    arr('hub_invoices').forEach(i => {
      if (!i) return;
      const late = window.Biz && Biz.isLate(i);
      const st = { pending: 'En attente', acompte: 'Acompte', paid: 'Payée', cancelled: 'Annulée' }[i.status] || 'En attente';
      out.push({ g: 'Factures', ic: '🧾', t: (i.number ? i.number + ' · ' : '') + (i.name || 'Prestation'), s: [i.client, eur(i.price), late ? 'en retard' : st].filter(Boolean).join(' · '),
        k: norm([i.number, i.name, i.client, i.price, st, late ? 'retard impaye' : ''].join(' ')), id: 'inv:' + i.id, bad: late,
        run: () => { page('facturation'); later(() => { const s = document.getElementById('inv-search'); if (s) { s.value = i.number || i.name || ''; window._invPage = 1; window.renderInvoices && renderInvoices(); } }, 150); } });
    });
    // Raccourcis de la page Outils (défauts + personnels) : ouverture dans un nouvel onglet.
    try { (window.Toolbox && Toolbox.links ? Toolbox.links.all() : []).forEach(l => out.push({ g: 'Raccourcis', ic: l.icon || '🔗', t: l.name, s: l.desc || l.url, k: norm([l.name, l.desc, l.cat, l.url].join(' ')), id: 'lk:' + l.id, run: () => Toolbox.links.open(l.url) })); } catch {}
    arr('hub_reviews').forEach(r => {
      if (!r || !r.author) return;
      out.push({ g: 'Avis', ic: '⭐', t: r.author + (r.rating ? ' · ' + '★'.repeat(Math.min(5, r.rating | 0)) : ''), s: String(r.text || '').slice(0, 70) + (r.status === 'pending' ? ' · à valider' : ''),
        k: norm([r.author, r.text, r.project, r.status === 'pending' ? 'a valider attente' : ''].join(' ')), id: 'rv:' + r.id, run: () => page('avis') });
    });
    return out;
  }

  /** Tous les mots doivent apparaître ; le titre qui commence par la requête passe devant. */
  function search(items, q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return items.map(it => {
      if (!words.every(w => it.k.includes(w))) return null;
      const t = norm(it.t);
      let score = 0;
      if (t.startsWith(words[0])) score += 3; else if (t.includes(words[0])) score += 2;
      if (it.g === 'Actions' || it.g === 'Pages') score += 0.5;
      return { it, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.it);
  }

  const Palette = {
    _items: [], _shown: [], _sel: 0,
    open(prefill) {
      if (document.getElementById('cmdk')) return this.close();
      this._items = index();
      const box = document.createElement('div'); box.id = 'cmdk'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Recherche globale');
      box.innerHTML = `<div class="cmdk-card"><div class="cmdk-in"><span aria-hidden="true">🔍</span>
        <input id="cmdk-q" type="search" autocomplete="off" spellcheck="false" placeholder="Client, dossier, facture, projet, action…" role="combobox" aria-expanded="true" aria-controls="cmdk-list">
        <kbd>Échap</kbd></div><div class="cmdk-list" id="cmdk-list" role="listbox"></div>
        <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ouvrir / fermer</span></div></div>`;
      document.body.appendChild(box);
      const q = box.querySelector('#cmdk-q');
      q.value = prefill || '';
      q.oninput = () => { this._sel = 0; this.render(q.value); };
      q.onkeydown = ev => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); this.move(ev.key === 'ArrowDown' ? 1 : -1); }
        else if (ev.key === 'Enter') { ev.preventDefault(); this.pick(this._sel); }
        else if (ev.key === 'Escape') { ev.preventDefault(); this.close(); }
      };
      box.addEventListener('mousedown', ev => { if (ev.target === box) this.close(); });
      this.render(q.value);
      setTimeout(() => q.focus(), 10);
    },
    close() { document.getElementById('cmdk')?.remove(); },
    recent() { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } },
    remember(id) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...this.recent().filter(x => x !== id)].slice(0, 6))); } catch {} },
    render(q) {
      const list = document.getElementById('cmdk-list'); if (!list) return;
      let shown;
      if (q.trim()) shown = search(this._items, q);
      else {
        const byId = new Map(this._items.map(i => [i.id, i]));
        const rec = this.recent().map(id => byId.get(id)).filter(Boolean).map(i => ({ ...i, g: 'Récents' }));
        shown = [...rec, ...this._items.filter(i => i.g === 'Actions').slice(0, 6)];
      }
      // 6 résultats max par groupe, ordre des groupes = ordre d'apparition
      const per = {}; shown = shown.filter(i => (per[i.g] = (per[i.g] || 0) + 1) <= 6).slice(0, 40);
      const groups = []; shown.forEach(i => { if (!groups.includes(i.g)) groups.push(i.g); });
      shown = groups.flatMap(g => shown.filter(i => i.g === g));
      this._shown = shown; if (this._sel >= shown.length) this._sel = 0;
      if (!shown.length) { list.innerHTML = `<div class="cmdk-empty">Aucun résultat pour « ${esc(q)} »</div>`; return; }
      let n = -1;
      list.innerHTML = groups.map(g => `<div class="cmdk-g">${esc(g)}</div>` + shown.filter(i => i.g === g).map(i => { n++;
        return `<div class="cmdk-i${n === this._sel ? ' on' : ''}${i.bad ? ' bad' : ''}" role="option" aria-selected="${n === this._sel}" data-n="${n}"><span class="cmdk-ic">${i.ic}</span><span class="cmdk-t"><b>${esc(i.t)}</b>${i.s ? `<small>${esc(i.s)}</small>` : ''}</span><span class="cmdk-go">↵</span></div>`; }).join('')).join('');
      list.querySelectorAll('.cmdk-i').forEach(el => {
        el.onmousemove = () => { const k = +el.dataset.n; if (k !== this._sel) { this._sel = k; this.highlight(); } };
        el.onclick = () => this.pick(+el.dataset.n);
      });
    },
    highlight() {
      document.querySelectorAll('#cmdk-list .cmdk-i').forEach(el => { const on = +el.dataset.n === this._sel; el.classList.toggle('on', on); el.setAttribute('aria-selected', on); if (on) el.scrollIntoView({ block: 'nearest' }); });
    },
    move(d) { if (!this._shown.length) return; this._sel = (this._sel + d + this._shown.length) % this._shown.length; this.highlight(); },
    pick(n) {
      const it = this._shown[n]; if (!it) return;
      this.remember(it.id); this.close();
      try { it.run(); } catch (e) { console.error(e); showToast?.('Action impossible : ' + e.message, '#c0392b', 3000); }
    },
  };

  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      if (document.getElementById('login-gate')?.classList.contains('on')) return;   // pas avant connexion
      Palette.open();
    }
  });
  window.HubSearch = Palette;
  window.HubSearch._search = search; window.HubSearch._index = index; window.HubSearch._norm = norm;
})();
