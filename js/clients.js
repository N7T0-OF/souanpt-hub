/* ══════════════════════════════════════════════════════════════════════════
   CP — « Clients & Projets »  (fusion Portails clients + Demandes & Devis)

   Une seule section, trois vues (Pipeline / Liste / Clients), pilotée par le
   registre `public_links` (voir js/registry.js). Chaque projet = UN jeton
   canonique qui suit son cycle : Demande → Devis → Mission → Terminé.

   PREMIÈRE TRANCHE. Cette vue unifiée est la « porte d'entrée » : elle recense
   et route. Les outils détaillés existants (analyse de message, grille
   tarifaire, formulaire de portail, acceptations) restent joignables et seront
   progressivement absorbés dans un atelier client unique (ClientWorkspace) au
   fil des tranches suivantes. Rien n'est retiré tant qu'un équivalent n'existe
   pas ici — on ne casse aucune fonction.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const STAGE_ORDER = ['request', 'estimate', 'mission', 'done'];
  const STAGE = {
    request:  { label: 'Demande', short: 'Demandes', icon: '📥', color: '#7f9cff' },
    estimate: { label: 'Devis',   short: 'Devis',    icon: '📄', color: '#e4b24a' },
    mission:  { label: 'Mission', short: 'Missions', icon: '🚀', color: '#4a9de4' },
    done:     { label: 'Terminé', short: 'Terminés', icon: '✅', color: '#2e9a63' },
  };
  const STATUS = {
    active:   { label: 'Actif',    color: '#2e9a63' },
    inactive: { label: 'En pause', color: '#999' },
    archived: { label: 'Archivé',  color: '#b98a3a' },
    trashed:  { label: 'Corbeille', color: '#c0392b' },
  };

  const CP = {
    _view: 'pipeline',
    _links: [],
    _loading: false,
    _creating: false,

    /* ── Chargement ──────────────────────────────────────────────────────── */
    async render() {
      const body = document.getElementById('cp-body'); if (!body) return;
      if (!(window.Cloud && Cloud.enabled && Cloud.user())) {
        this._loading = false; this._links = [];
        body.innerHTML = this._msg('⚠️ <b>Connecte-toi avec Google ou Discord</b> pour retrouver ici tous tes clients et projets.');
        this._badge();
        return;
      }
      this._loading = true; this._paint();
      let links = [];
      try { links = await (window.Registry ? Registry.list() : []); } catch (e) { links = []; }
      // Filet : si le registre est vide (projets créés avant lui), on force un
      // backfill puis on relit — le socle se remplit tout seul.
      if (!links.length && window.Registry) {
        try { await Registry.sync(true); links = await Registry.list(); } catch (e) {}
      }
      this._links = links;
      this._loading = false;
      this._paint();
      this._badge();
    },

    setView(v) {
      this._view = v;
      document.querySelectorAll('#cp-views button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
      this._paint();
    },

    /* ── Rendu ───────────────────────────────────────────────────────────── */
    _paint() {
      const body = document.getElementById('cp-body'); if (!body) return;
      let head = this._creating ? this._createPanel() : '';
      if (this._loading) { body.innerHTML = head + this._msg('Chargement de tes projets…'); return; }
      if (!this._links.length) { body.innerHTML = head + this._empty(); return; }
      const view = this._view === 'list' ? this._list()
                 : this._view === 'clients' ? this._clients()
                 : this._pipeline();
      body.innerHTML = head + view;
    },

    _pipeline() {
      const cols = STAGE_ORDER.map(stage => {
        const items = this._links.filter(l => (l.stage || 'request') === stage);
        const cards = items.length
          ? items.map(l => this._card(l, true)).join('')
          : `<div class="cp-empty-col">—</div>`;
        const meta = STAGE[stage];
        return `<div class="cp-col">
          <div class="cp-col-h" style="border-color:${meta.color}55">
            <span>${meta.icon} ${meta.short}</span><span class="cp-col-n">${items.length}</span>
          </div>
          <div class="cp-col-body">${cards}</div>
        </div>`;
      }).join('');
      return `<div class="cp-pipeline">${cols}</div>`;
    },

    _list() {
      const rows = this._links.map(l => {
        const s = STAGE[l.stage || 'request'], st = STATUS[l.status || 'active'];
        return `<div class="cp-row">
          <div class="cp-row-main">
            <div class="cp-row-title">${this._esc(l.projectName) || '<span style="opacity:.5">Projet sans nom</span>'}</div>
            <div class="cp-row-sub">${l.clientName ? '👤 ' + this._esc(l.clientName) + ' · ' : ''}${this._rel(l.updatedAt || l.createdAt)}</div>
          </div>
          <div class="cp-badge" style="background:${s.color}22;color:${s.color};border-color:${s.color}55">${s.icon} ${s.label}</div>
          <div class="cp-row-total">${this._money(l.total, l.currency)}</div>
          ${(l.status && l.status !== 'active') ? `<div class="cp-badge" style="background:${st.color}22;color:${st.color};border-color:${st.color}55">${st.label}</div>` : ''}
          <div class="cp-row-act">${this._actions(l)}</div>
        </div>`;
      }).join('');
      return `<div class="cp-list">${rows}</div>`;
    },

    _clients() {
      const groups = new Map();
      this._links.forEach(l => {
        const key = (l.clientName || '').trim() || '__none';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(l);
      });
      const cards = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, items]) => {
        const name = key === '__none' ? 'Sans nom de client' : key;
        const total = items.reduce((s, l) => s + (Number(l.total) || 0), 0);
        const cur = (items.find(l => l.currency) || {}).currency || '€';
        const chips = items.map(l => { const s = STAGE[l.stage || 'request'];
          return `<span class="cp-chip" style="border-color:${s.color}66" title="${this._esc(l.projectName)}" onclick="CP.openLink('${this._esc(l.token)}')">${s.icon} ${this._esc(l.projectName) || s.label}</span>`;
        }).join('');
        return `<div class="cp-client-card">
          <div class="cp-client-h"><span class="cp-client-name">👤 ${this._esc(name)}</span>
            <span class="cp-client-meta">${items.length} projet${items.length > 1 ? 's' : ''} · ${this._money(total, cur)}</span></div>
          <div class="cp-client-projects">${chips}</div>
        </div>`;
      }).join('');
      return `<div class="cp-clients">${cards}</div>`;
    },

    _card(l, compact) {
      const s = STAGE[l.stage || 'request'];
      return `<div class="cp-pcard" style="border-left:3px solid ${s.color}">
        <div class="cp-pcard-title">${this._esc(l.projectName) || '<span style="opacity:.5">Sans nom</span>'}</div>
        ${l.clientName ? `<div class="cp-pcard-client">👤 ${this._esc(l.clientName)}</div>` : ''}
        <div class="cp-pcard-foot">
          <span class="cp-pcard-total">${this._money(l.total, l.currency)}</span>
          <span class="cp-pcard-time">${this._rel(l.updatedAt || l.createdAt)}</span>
        </div>
        <div class="cp-pcard-act">${this._actions(l)}</div>
      </div>`;
    },

    _actions(l) {
      const t = this._esc(l.token);
      return `<button class="cp-a" title="Ouvrir le lien client" onclick="CP.openLink('${t}')">🔗</button>
        <button class="cp-a" title="Copier le lien" onclick="CP.copyLink('${t}')">📋</button>
        <button class="cp-a" title="Gérer ce projet" onclick="CP.manage('${t}')">⚙</button>`;
    },

    /* ── Actions ─────────────────────────────────────────────────────────── */
    openLink(token) { if (token) window.open(location.origin + '/c/' + token, '_blank'); },
    copyLink(token) {
      if (!token) return;
      navigator.clipboard?.writeText(location.origin + '/c/' + token)
        .then(() => window.showToast?.('Lien client copié ✓', '#2e9a63', 2000))
        .catch(() => {});
    },
    // Route vers l'outil détaillé adapté à l'étape (en attendant l'atelier unifié).
    manage(token) {
      const l = this._links.find(x => x.token === token);
      const stage = l ? (l.stage || 'request') : 'request';
      if (stage === 'mission' || stage === 'done') { window.showPage?.('portals'); }
      else { window.showPage?.('devis'); }
    },

    /* ── Création : petit sélecteur, pas encore l'assistant 5 étapes ─────── */
    newProject() { this._creating = !this._creating; this._paint(); },
    _createPanel() {
      return `<div class="cp-create">
        <div class="cp-create-h">Démarrer un client / projet</div>
        <div class="cp-create-opts">
          <button class="cp-create-opt" onclick="CP.startRequest()">
            <span class="cp-create-ic">📥</span><b>Envoyer un lien de demande</b>
            <small>Le client décrit son besoin et dépose ses références. Un projet apparaît ici.</small></button>
          <button class="cp-create-opt" onclick="CP.startDevis()">
            <span class="cp-create-ic">📄</span><b>Analyser un message / faire un devis</b>
            <small>Colle le message du client, obtiens une estimation et un lien.</small></button>
          <button class="cp-create-opt" onclick="CP.startPortal()">
            <span class="cp-create-ic">🚀</span><b>Créer un portail directement</b>
            <small>Tu as déjà l'accord : ouvre l'espace mission tout de suite.</small></button>
        </div>
        <button class="btn btn-ghost" style="font-size:10px;margin-top:8px" onclick="CP.newProject()">Fermer</button>
      </div>`;
    },
    startRequest() { this._creating = false; this._paint();
      if (window.QuoteUI && QuoteUI.newRequestLink) QuoteUI.newRequestLink().then?.(() => setTimeout(() => this.render(), 600));
      else window.showPage?.('devis');
    },
    startDevis()  { this._creating = false; window.showPage?.('devis'); },
    startPortal() { this._creating = false; window.showPage?.('portals'); if (window.portalOpenForm) setTimeout(portalOpenForm, 120); },

    /* ── Badge de navigation : nombre de projets actifs (hors terminés) ──── */
    _badge() {
      const el = document.getElementById('cp-badge'); if (!el) return;
      const n = this._links.filter(l => (l.stage || 'request') !== 'done' && (l.status || 'active') === 'active').length;
      el.textContent = n || ''; el.style.display = n ? '' : 'none';
    },

    /* ── Helpers ─────────────────────────────────────────────────────────── */
    _empty() {
      return `<div class="cp-empty">
        <div style="font-size:34px;margin-bottom:8px">🗂️</div>
        <div style="font-weight:700;margin-bottom:4px">Aucun client ni projet pour l'instant</div>
        <div style="font-size:12px;color:var(--muted);max-width:420px;margin:0 auto 12px;line-height:1.6">
          Chaque demande, devis et mission apparaîtra ici, sur un seul lien qui suit ton client de bout en bout.</div>
        <button class="btn btn-accent" style="font-size:11px" onclick="CP.newProject()">+ Nouveau client / projet</button>
      </div>`;
    },
    _msg(html) { return `<div class="cp-empty" style="color:var(--muted)">${html}</div>`; },
    _money(v, cur) { const n = Number(v) || 0; if (!n) return '<span style="opacity:.4">—</span>';
      return n.toLocaleString('fr-FR') + ' ' + (cur || '€'); },
    _rel(ts) {
      if (!ts) return '';
      const d = Date.now() - ts, m = 60000, h = 3600000, day = 86400000;
      if (d < m) return "à l'instant";
      if (d < h) return Math.floor(d / m) + ' min';
      if (d < day) return Math.floor(d / h) + ' h';
      if (d < 30 * day) return Math.floor(d / day) + ' j';
      return new Date(ts).toLocaleDateString('fr-FR');
    },
    _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  };

  window.CP = CP;
})();
