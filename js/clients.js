/* ══════════════════════════════════════════════════════════════════════════
   CP — « Clients & Projets »  (fusion Portails clients + Demandes & Devis)

   Une seule section, trois vues (Pipeline / Liste / Clients), pilotée par le
   registre `public_links` (voir js/registry.js). Chaque projet = UN jeton
   canonique qui suit son cycle : Demande → Devis → Mission → Terminé.

   La vue Clients absorbe aussi l'**ancienne page « Clients »** (annuaire
   `hub_clients` + formulaire) : un seul menu, un seul endroit, et l'annuaire
   partage le même nom de client que les projets regroupés. `showPage('clients')`
   redirige ici — aucun raccourci enregistré ne casse.

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
    _clientFormOpen: false,
    _clientDraft: { name: '', type: '' },
    _manualClientId: '',
    sortMode: localStorage.getItem('cp_sort') === 'az' ? 'az' : 'recent',

    setSort() {
      this.sortMode = this.sortMode === 'recent' ? 'az' : 'recent';
      localStorage.setItem('cp_sort', this.sortMode);
      const btn = document.getElementById('cp-sort');
      if (btn) btn.textContent = 'Trier : ' + (this.sortMode === 'az' ? 'A-Z' : 'Plus récent');
      this._paint();
    },
    _time(item) { return Number(item.updatedAt || item.createdAt) || Date.parse(item.updatedAt || item.createdAt || '') || 0; },
    orderedLinks(list = this._links) {
      return list.slice().sort((a,b) => this.sortMode === 'az'
        ? String(a.projectName || '').localeCompare(String(b.projectName || ''), 'fr')
        : this._time(b) - this._time(a));
    },
    checkClientDuplicate() {
      const name = document.getElementById('cl-name')?.value.trim().toLocaleLowerCase('fr') || '';
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      const existing = name && clients.find(c => String(c.name || '').trim().toLocaleLowerCase('fr') === name);
      const box = document.getElementById('cl-duplicate'); if (!box) return existing || null;
      box.replaceChildren(); box.hidden = !existing;
      if (existing) {
        const label = document.createElement('span'); label.textContent = 'Ce client existe déjà : ' + existing.name + '. ';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = 'Voir la fiche →';
        button.onclick = () => this.viewClient(existing.id);
        box.append(label, button);
      }
      return existing || null;
    },
    viewClient(id) {
      this.toggleClientForm(false); this.setView('clients');
      const card = document.getElementById('client-card-' + id);
      if (card) { card.open = true; card.scrollIntoView({ behavior:'smooth', block:'center' }); card.focus({ preventScroll:true }); card.style.outline = '2px solid var(--accent)'; setTimeout(() => { card.style.outline = ''; }, 2500); }
    },
    _localLinks() {
      try { return (window.ClientWorkspace ? ClientWorkspace.all() : [])
        .filter(w => w && w.token && w.status !== 'trashed').map(w => ({ ...w })); }
      catch { return []; }
    },
    _mergeLinks(remote = []) {
      const byToken = new Map(this._localLinks().map(w => [w.token, w]));
      remote.forEach(l => { if (l?.token) byToken.set(l.token, { ...byToken.get(l.token), ...l, localOnly: false }); });
      return [...byToken.values()];
    },

    toggleClientForm(open) {
      this._clientFormOpen = open === undefined ? !this._clientFormOpen : !!open;
      const form = document.getElementById('add-client-form');
      if (form) form.classList.toggle('visible', this._clientFormOpen);
      if (this._clientFormOpen) {
        form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('cl-name')?.focus();
        this.checkClientDuplicate();
      }
    },

    /* ── Chargement ──────────────────────────────────────────────────────── */
    async render() {
      const body = document.getElementById('cp-body'); if (!body) return;
      const sortButton = document.getElementById('cp-sort');
      if (sortButton) sortButton.textContent = 'Trier : ' + (this.sortMode === 'az' ? 'A-Z' : 'Plus récent');
      if (!(window.Cloud && Cloud.enabled && Cloud.user())) {
        this._loading = false; this._links = this._mergeLinks();
        this._paint();
        this._badge();
        if (window.ClientWorkspace) ClientWorkspace.migrate().then(() => {
          this._links = this._mergeLinks(); this._paint(); this._badge();
        }).catch(() => {});
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
      this._links = this._mergeLinks(links);
      this._loading = false;
      this._paint();
      this._badge();
      // Recense les projets + rattache factures/portails sans jeton (1×/session,
      // non destructif) : le dossier n'affiche rien d'autre que ce qui existe.
      if (window.ClientWorkspace) ClientWorkspace.migrate().then(() => {
        this._links = this._mergeLinks(links); this._paint(); this._badge();
      }).catch(() => {});
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
      if (!(window.Cloud && Cloud.enabled && Cloud.user())) head += '<div class="infobox" style="margin:10px 0">Mode local : tes fiches et dossiers de ce navigateur restent accessibles. La synchronisation attend une connexion Google ou Discord valide.</div>';
      if (this._loading) { body.innerHTML = head + this._msg('Chargement de tes projets…'); return; }
      // Sans projet, la vue Clients montre quand même l'annuaire (sinon on
      // perdrait l'accès aux fiches en fusionnant l'ancienne page).
      if (!this._links.length && this._view !== 'clients') { body.innerHTML = head + this._empty(); return; }
      const view = this._view === 'list' ? this._list()
                 : this._view === 'clients' ? this._clients()
                 : this._pipeline();
      body.innerHTML = head + view;
      this._after();
    },

    /* Ce qu'il faut peindre après coup : l'annuaire est rendu par renderClients()
       (app.html) et non par ce module. */
    _after() {
      if (this._view !== 'clients') return;
      try { window.renderClients?.(); } catch {}
    },

    _pipeline() {
      const cols = STAGE_ORDER.map(stage => {
        const items = this.orderedLinks(this._links.filter(l => (l.stage || 'request') === stage));
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
      const rows = this.orderedLinks().map(l => {
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
      /* ── Annuaire (hub_clients) — l'ancienne page « Clients » est fusionnée
             ici : mêmes fiches, même formulaire, plus les projets du client. */
      let roster = [];
      try { roster = JSON.parse(localStorage.getItem('hub_clients') || '[]') || []; } catch { roster = []; }
      if (!Array.isArray(roster)) roster = [];
      const withProject = new Set(this._links
        .map(l => (l.clientName || '').trim().toLowerCase()).filter(Boolean));
      const rosterHtml = `<div class="cp-roster">
        <div class="cp-roster-h">
          <span><b>📇 Annuaire</b>
            <span class="cp-roster-sub">${roster.length} fiche${roster.length > 1 ? 's' : ''}${withProject.size ? ' · ' + withProject.size + ' avec projet' : ''}</span></span>
          <button class="btn btn-ghost" style="font-size:10px;margin-left:auto" onclick="CP.toggleClientForm()">+ Client</button>
        </div>
        <div class="form-box${this._clientFormOpen ? ' visible' : ''}" id="add-client-form">
          <div class="biz-form">
            <div><div class="prop-label">Nom</div><input class="prop-input" id="cl-name" placeholder="Entreprise" value="${this._esc(this._clientDraft.name)}" oninput="CP._clientDraft.name=this.value;CP.checkClientDuplicate()"></div>
            <div><div class="prop-label">Type</div><input class="prop-input" id="cl-type" placeholder="Design, Dev..." value="${this._esc(this._clientDraft.type)}" oninput="CP._clientDraft.type=this.value"></div>
          </div>
          <div id="cl-duplicate" role="alert" style="color:var(--gold-l);font-size:11px;margin-top:8px" hidden></div>
          <div class="hintbox" style="margin-top:10px">💡 La fiche est partagée : <strong style="color:var(--text)">Facturation</strong> et <strong style="color:var(--text)">Portails</strong> proposent ce nom automatiquement — et créent la fiche si elle n'existe pas.</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-accent" onclick="addClient()">Ajouter</button>
            <button class="btn btn-ghost" onclick="CP.toggleClientForm(false)">Annuler</button>
          </div>
        </div>
        <div class="cp-roster-grid" id="clients-list"></div>
      </div>`;

      const groups = new Map();
      this.orderedLinks().forEach(l => {
        const key = (l.clientName || '').trim() || '__none';
        if (key !== '__none' && roster.some(c => String(c.name || '').trim().toLocaleLowerCase('fr') === key.toLocaleLowerCase('fr'))) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(l);
      });
      const cards = [...groups.entries()].sort((a, b) => this.sortMode === 'az'
        ? a[0].localeCompare(b[0], 'fr')
        : Math.max(...b[1].map(x=>this._time(x))) - Math.max(...a[1].map(x=>this._time(x)))).map(([key, items]) => {
        const name = key === '__none' ? 'Sans nom de client' : key;
        const total = items.reduce((s, l) => s + (Number(l.total) || 0), 0);
        const cur = (items.find(l => l.currency) || {}).currency || '€';
        const chips = items.map(l => { const s = STAGE[l.stage || 'request'];
          return `<span class="cp-chip" style="border-color:${s.color}66" title="Dossier de ${this._esc(l.projectName)}" onclick="${window.ClientWorkspace ? 'ClientWorkspace.open' : 'CP.openLink'}('${this._esc(l.token)}')">${s.icon} ${this._esc(l.projectName) || s.label}</span>`;
        }).join('');
        return `<div class="cp-client-card">
          <div class="cp-client-h"><span class="cp-client-name">👤 ${this._esc(name)}</span>
            <span class="cp-client-meta">${items.length} projet${items.length > 1 ? 's' : ''} · ${this._money(total, cur)}</span></div>
          <div class="cp-client-projects">${chips}</div>
        </div>`;
      }).join('');
      return (window.ClientWorkspace ? ClientWorkspace.valPanel() : '') + rosterHtml + (cards
        ? `<div class="cp-roster-sub" style="margin:12px 0 8px">Projets sans fiche client</div><div class="cp-clients">${cards}</div>`
        : `<div class="cp-empty" style="padding:20px 16px">
             <div style="font-size:12px;color:var(--muted);max-width:430px;margin:0 auto">Aucun projet rattaché pour l'instant. Crée une demande ou un devis : il viendra se ranger ici sous le nom de son client.</div>
           </div>`);
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
      if (l.localOnly) return `<span class="cp-badge" title="Projet interne conservé dans ce navigateur ; aucun lien public pour le moment">Local</span>
        <button class="cp-a" title="Gérer ce projet" onclick="CP.manage('${t}')">⚙</button>`;
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
    // Ouvre le DOSSIER unique du projet (ClientWorkspace). L'ancien routage
    // vers l'outil détaillé reste le repli si le module n'est pas chargé.
    manage(token) {
      if (window.ClientWorkspace) { ClientWorkspace.open(token); return; }
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
          <button class="cp-create-opt" onclick="CP.startManual()">
            <span class="cp-create-ic">✎</span><b>Ajouter un projet manuellement</b>
            <small>Renseigne le client, le type et le nom du projet, même sans connexion cloud.</small></button>
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
    startManual(clientId = '') {
      this._manualClientId = clientId;
      this._creating = true;
      this._paint();
      const panel = document.querySelector('.cp-create');
      if (!panel) return;
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      const chosen = clients.find(c => c.id === clientId);
      panel.innerHTML = `<div class="cp-create-h">Nouveau projet manuel</div>
        <div class="biz-form"><div><div class="prop-label">Client *</div><input class="prop-input" id="cp-manual-client" list="dl-clients" value="${this._esc(chosen?.name || '')}" placeholder="Nom du client"></div>
        <div><div class="prop-label">Nom du projet *</div><input class="prop-input" id="cp-manual-name" placeholder="Ex. Identité visuelle"></div>
        <div><div class="prop-label">Type de projet</div><input class="prop-input" id="cp-manual-type" placeholder="Ex. Design, site web"></div></div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-accent" onclick="CP.saveManual()">Créer le projet</button><button class="btn btn-ghost" onclick="CP.newProject()">Annuler</button></div>`;
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.querySelector('#cp-manual-name')?.focus();
    },
    saveManual() {
      const clientName = document.getElementById('cp-manual-client')?.value.trim() || '';
      const projectName = document.getElementById('cp-manual-name')?.value.trim() || '';
      const projectType = document.getElementById('cp-manual-type')?.value.trim() || '';
      if (!clientName || !projectName) return window.showToast?.('Client et nom du projet requis', '#c0392b', 2500);
      if (!window.ClientWorkspace) return window.showToast?.('Dossier client indisponible', '#c0392b', 2500);
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      let client = clients.find(c => String(c.name || '').trim().toLocaleLowerCase('fr') === clientName.toLocaleLowerCase('fr'));
      if (!client) {
        client = { id: crypto.randomUUID(), name: clientName, type: '', status: 'active', progress: 0, revenue: 0, createdAt: Date.now() };
        clients.push(client); localStorage.setItem('hub_clients', JSON.stringify(clients));
      }
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const w = ClientWorkspace.ensure(token, { clientId: client.id, clientName: client.name, projectName, projectType, stage: 'request' });
      w.localOnly = true;
      const workspaces = ClientWorkspace.all();
      const index = workspaces.findIndex(item => item.token === token);
      if (index >= 0) { workspaces[index] = w; ClientWorkspace.save(workspaces); }
      this._creating = false; this._manualClientId = '';
      this._links = this._mergeLinks(); this._view = 'clients';
      document.querySelectorAll('#cp-views button').forEach(b => b.classList.toggle('active', b.dataset.v === 'clients'));
      this._paint(); this._badge(); this.viewClient(client.id);
      window.showToast?.('Projet créé dans ce navigateur ✓', '#2e9a63', 2500);
    },

    /* ── Badge de navigation : nombre de projets actifs (hors terminés) ──── */
    _badge() {
      const el = document.getElementById('cp-badge'); if (!el) return;
      const n = this._links.filter(l => (l.stage || 'request') !== 'done' && (l.status || 'active') === 'active').length;
      el.textContent = n || ''; el.style.display = n ? '' : 'none';
    },

    /* ── Helpers ─────────────────────────────────────────────────────────── */
    _empty() {
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      const hasClients = Array.isArray(clients) && clients.length > 0;
      return `<div class="cp-empty">
        <div style="font-size:34px;margin-bottom:8px">🗂️</div>
        <div style="font-weight:700;margin-bottom:4px">${hasClients ? 'Aucun projet pour l’instant' : 'Aucun client ni projet pour l’instant'}</div>
        <div style="font-size:12px;color:var(--muted);max-width:420px;margin:0 auto 12px;line-height:1.6">
          Tes dossiers enregistrés dans ce navigateur apparaissent ici même sans connexion Google. Ouvre l’onglet Clients pour voir tes fiches.</div>
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
