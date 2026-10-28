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
    expandedClientIds: new Set(),
    setClientExpanded(id, open) { if (open) this.expandedClientIds.add(String(id)); else this.expandedClientIds.delete(String(id)); },
    sortMode: localStorage.getItem('cp_sort') === 'az' ? 'az' : 'recent',
    search: '', searchKind: 'all', statusFilter: '', _searchRows: null, _searchTimer: null,
    _migrationPromise: null,
    selectedTokens: new Set(), _trashOpen: false,
    toggleSelect(token, checked) { checked ? this.selectedTokens.add(token) : this.selectedTokens.delete(token); this._paint(); },
    toggleTrash() { this._trashOpen = !this._trashOpen; this._paint(); },
    _trashPanel() {
      if (!this._trashOpen || !window.ClientWorkspace) return '';
      const trashed = ClientWorkspace.all().filter(w => w.localOnly && w.status === 'trashed');
      return `<section class="cp-bulk"><b>Corbeille — ${trashed.length} projet(s) privé(s)</b>
        ${trashed.length ? trashed.map(w => `<span class="cp-result">${this._esc(w.projectName || 'Projet')} · ${this._esc(w.clientName || '')}<button class="btn btn-ghost" type="button" data-cp-restore="${this._esc(w.token)}">Restaurer</button></span>`).join('') : '<small>Aucun dossier dans la corbeille.</small>'}</section>`;
    },
    _bulkToolbar() {
      if (!this.selectedTokens.size) return '';
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      if (!Array.isArray(clients)) clients = [];
      return `<div class="cp-bulk" role="group" aria-label="Actions groupées"><b>${this.selectedTokens.size} projet(s) privé(s)</b>
        <select id="cp-bulk-status" aria-label="Statut"><option value="active">En cours</option><option value="done">Terminé</option><option value="archived">Archivé</option></select><button class="btn btn-ghost" onclick="CP.bulk('status')">Appliquer le statut</button>
        <input id="cp-bulk-type" maxlength="100" placeholder="Type de prestation" aria-label="Type de prestation"><button class="btn btn-ghost" onclick="CP.bulk('type')">Changer le type</button>
        <select id="cp-bulk-client" aria-label="Client"><option value="">Choisir un client</option>${clients.map(c => `<option value="${this._esc(c.id)}">${this._esc(c.name)}</option>`).join('')}</select><button class="btn btn-ghost" onclick="CP.bulk('client')">Rattacher</button>
        <button class="btn btn-ghost" onclick="CP.bulk('trash')">Corbeille</button></div>`;
    },
    _insights() {
      const idx = this._index(), byName = new Map(), notes = [];
      idx.clients.forEach(r => {
        const key = this.normalize(r.item.name);
        if (!key) return;
        if (byName.has(key) && byName.get(key) !== r.item.id) notes.push(`Fiches clientes possiblement en double : ${r.item.name}`);
        else byName.set(key, r.item.id);
      });
      if (idx.clients.length <= 500) for (let i=0;i<idx.clients.length;i++) for (let j=i+1;j<idx.clients.length;j++) {
        const a = this.normalize(idx.clients[i].item.name), b = this.normalize(idx.clients[j].item.name);
        if (a && b && a !== b && Math.min(a.length,b.length) >= 5 && (a.includes(b) || b.includes(a)))
          notes.push(`Noms de clients proches : ${idx.clients[i].item.name} / ${idx.clients[j].item.name}`);
      }
      const clients = new Set(idx.clients.map(r => this.normalize(r.item.name)).filter(Boolean));
      const byProject = new Set();
      idx.projects.forEach(r => {
        const p = r.item, client = this.normalize(p.clientName), name = this.normalize(p.projectName);
        if (!client) notes.push(`Projet sans client : ${p.projectName || p.token}`);
        else if (!clients.has(client)) notes.push(`Fiche client à rattacher : ${p.clientName} — ${p.projectName || 'projet'}`);
        const key = client + '/' + name;
        if (name && byProject.has(key)) notes.push(`Projets similaires chez ${p.clientName || 'un client'} : ${p.projectName}`);
        byProject.add(key);
      });
      if (!notes.length) return '';
      return `<details class="infobox"><summary style="cursor:pointer">🧩 ${notes.length} suggestion(s) de cohérence locale</summary><ul>${notes.slice(0,25).map(n => `<li>${this._esc(n)}</li>`).join('')}</ul><small>Ouvre une fiche ou un dossier pour vérifier avant de rattacher. Aucun changement automatique.</small></details>`;
    },
    bulk(action) {
      if (!window.ClientWorkspace || !this.selectedTokens.size) return;
      const workspaces = ClientWorkspace.all(), selected = workspaces.filter(w => w.localOnly && this.selectedTokens.has(w.token) && w.status !== 'trashed');
      if (!selected.length) { this.selectedTokens.clear(); this._paint(); return; }
      const type = document.getElementById('cp-bulk-type')?.value.trim() || '';
      const stage = document.getElementById('cp-bulk-status')?.value;
      const clientId = document.getElementById('cp-bulk-client')?.value;
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      const client = Array.isArray(clients) ? clients.find(c => String(c.id) === String(clientId)) : null;
      if (action === 'type' && !type) return window.showToast?.('Indique un type', '#c0392b', 2200);
      if (action === 'client' && !client) return window.showToast?.('Choisis un client', '#c0392b', 2200);
      if (action === 'trash' && !window.confirm(`Placer ${selected.length} projet(s) privé(s) dans la corbeille récupérable ?`)) return;
      selected.forEach(w => {
        if (action === 'type') w.projectType = type;
        if (action === 'client') { w.clientId = client.id; w.clientName = client.name; }
        if (action === 'status') {
          if (stage === 'done') { if (w.stage !== 'done') w.lastStage = w.stage; w.stage = 'done'; w.closedAt = Date.now(); w.status = 'active'; }
          else if (stage === 'archived') w.status = 'archived';
          else { w.status = 'active'; if (w.stage === 'done') { w.stage = w.lastStage || 'request'; w.closedAt = null; } }
        }
        if (action === 'trash') w.status = 'trashed';
        w.updatedAt = Date.now();
      });
      ClientWorkspace.save(workspaces);
      this.selectedTokens.clear(); this._links = this._mergeLinks(this._links.filter(l => !l.localOnly));
      this.invalidateSearch(); this._paint(); this._badge();
      if (typeof syncKPIs === 'function') syncKPIs();
      window.showToast?.(`${selected.length} projet(s) mis à jour ✓`, '#2e9a63', 2400);
    },
    restoreTrash(token) {
      const list = ClientWorkspace.all(), w = list.find(item => item.token === token && item.localOnly && item.status === 'trashed');
      if (!w) return;
      w.status = 'active'; w.updatedAt = Date.now(); ClientWorkspace.save(list);
      this._links = this._mergeLinks(this._links.filter(l => !l.localOnly)); this.invalidateSearch(); this._paint(); this._badge();
      if (typeof syncKPIs === 'function') syncKPIs();
    },
    normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim().replace(/\s+/g, ' '); },
    setSearch(value) {
      this.search = this.normalize(value);
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._paint(), 90);
    },
    clearSearch() { this.search = ''; const input = document.getElementById('cp-search'); if (input) { input.value = ''; input.focus(); } this._paint(); },
    setSearchKind(kind) { this.searchKind = ['clients','projects'].includes(kind) ? kind : 'all'; this._paint(); },
    setStatusFilter(kind) { this.statusFilter = this.statusFilter === kind ? '' : kind; this.setView('list'); },
    invalidateSearch() { this._searchRows = null; },
    _index() {
      if (this._searchRows) return this._searchRows;
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      if (!Array.isArray(clients)) clients = [];
      const projectRows = this._links.map(p => ({ item:p, text:this.normalize([p.projectName,p.projectType,p.type,p.clientName,p.description,p.mission].join(' ')) }));
      this._searchRows = { clients: clients.map(c => ({ item:c, text:this.normalize([c.name,c.type,c.description].join(' ')) })), projects:projectRows };
      return this._searchRows;
    },
    _matches(text) { return !this.search || this.search.split(' ').every(part => text.includes(part)); },
    _filteredLinks() {
      const rows = this._index().projects;
      return rows.filter(r => (!this.search || this.searchKind !== 'clients' && this._matches(r.text))
        && (!this.statusFilter || (this.statusFilter === 'active' ? r.item.stage !== 'done' && r.item.status !== 'archived' && r.item.status !== 'trashed' : r.item.stage === 'done'))).map(r => r.item);
    },
    matchesClient(client) {
      if (!this.search) return true;
      if (this.searchKind === 'projects') return false;
      return this._matches(this.normalize([client.name,client.type,client.description].join(' ')))
        || this._index().projects.some(r => (r.item.clientId === client.id || !r.item.clientId && this.normalize(r.item.clientName) === this.normalize(client.name)) && this._matches(r.text));
    },
    _searchResults() {
      if (!this.search) return '';
      const idx = this._index();
      const clients = this.searchKind === 'projects' ? [] : idx.clients.filter(r => this._matches(r.text));
      const projects = this.searchKind === 'clients' ? [] : idx.projects.filter(r => this._matches(r.text));
      const row = (label, kind, id, subtitle) => `<div class="cp-result"><span><b>${this._esc(label)}</b><small style="display:block;color:var(--muted2)">${this._esc(subtitle || '')}</small></span><button class="btn btn-ghost" type="button" data-cp-result="${kind}" data-id="${this._esc(id)}">Ouvrir</button></div>`;
      return `<section class="cp-search-results" aria-live="polite"><b>Résultats — ${clients.length} client${clients.length > 1 ? 's' : ''} · ${projects.length} projet${projects.length > 1 ? 's' : ''}</b>
        ${clients.length ? `<h4>Clients</h4>${clients.map(r => row(r.item.name, 'client', r.item.id, r.item.type)).join('')}` : ''}
        ${projects.length ? `<h4>Projets</h4>${projects.map(r => row(r.item.projectName || 'Projet sans nom', 'project', r.item.token, r.item.clientName)).join('')}` : ''}
        ${!clients.length && !projects.length ? '<div class="cp-empty-col">Aucun résultat</div>' : ''}</section>`;
    },
    _metrics() {
      const target = document.getElementById('cp-metrics'); if (!target || !window.ClientMetrics) return;
      const m = ClientMetrics.collect(this._links);
      target.innerHTML = `<button class="cp-metric" onclick="CP.setView('clients')"><b>${m.clients}</b><small>Clients</small></button>
        <button class="cp-metric" onclick="CP.statusFilter='';CP.setView('list')"><b>${m.professionalProjects}</b><small>Projets professionnels</small></button>
        <button class="cp-metric" onclick="CP.setStatusFilter('active')"><b>${m.activeProjects}</b><small>En cours</small></button>
        <button class="cp-metric" onclick="CP.setStatusFilter('done')"><b>${m.completedProjects}</b><small>Terminés</small></button>`;
    },

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
    checkManualClient() {
      const name = document.getElementById('cp-manual-client')?.value.trim().toLocaleLowerCase('fr') || '';
      let clients = []; try { clients = JSON.parse(localStorage.getItem('hub_clients') || '[]'); } catch {}
      if (!Array.isArray(clients)) clients = [];
      const existing = name && clients.find(c => String(c.name || '').trim().toLocaleLowerCase('fr') === name);
      const box = document.getElementById('cp-manual-match');
      if (box) {
        box.replaceChildren(); box.hidden = !existing;
        if (existing) {
          const label = document.createElement('span');
          label.textContent = 'Client déjà existant : ' + existing.name + '. Le projet sera lié à sa fiche. ';
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = 'Voir la fiche →';
          button.onclick = () => { this._creating = false; this.viewClient(existing.id); };
          box.append(label, button);
        }
      }
      return existing || null;
    },
    viewClient(id) {
      this.expandedClientIds.add(String(id));
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
    prefillClient(name) {
      this._clientDraft = { name, type: '' };
      this._clientFormOpen = true;
      this._view = 'clients';
      this._paint();
      this.toggleClientForm(true);
    },

    /* ── Chargement ──────────────────────────────────────────────────────── */
    async render() {
      const body = document.getElementById('cp-body'); if (!body) return;
      this.invalidateSearch();
      const sortButton = document.getElementById('cp-sort');
      if (sortButton) sortButton.textContent = 'Trier : ' + (this.sortMode === 'az' ? 'A-Z' : 'Plus récent');
      if (!(window.Cloud && Cloud.enabled && Cloud.user())) {
        this._loading = false; this._links = this._mergeLinks();
        this.invalidateSearch();
        this._paint();
        this._badge();
        if (window.ClientWorkspace) (this._migrationPromise ||= ClientWorkspace.migrate()).then(() => {
          this._links = this._mergeLinks(); this.invalidateSearch(); this._paint(); this._badge();
        }).catch(() => {}).finally(() => { this._migrationPromise = null; });
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
      this.invalidateSearch();
      this._loading = false;
      this._paint();
      this._badge();
      // Recense les projets + rattache factures/portails sans jeton (1×/session,
      // non destructif) : le dossier n'affiche rien d'autre que ce qui existe.
      if (window.ClientWorkspace) (this._migrationPromise ||= ClientWorkspace.migrate()).then(() => {
        this._links = this._mergeLinks(links); this.invalidateSearch(); this._paint(); this._badge();
      }).catch(() => {}).finally(() => { this._migrationPromise = null; });
    },

    setView(v) {
      this._view = v;
      document.querySelectorAll('#cp-views button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
      this._paint();
    },

    /* ── Rendu ───────────────────────────────────────────────────────────── */
    _paint() {
      const body = document.getElementById('cp-body'); if (!body) return;
      this._metrics();
      let head = this._trashPanel() + this._bulkToolbar() + this._insights() + (this._creating ? this._createPanel() : '') + this._searchResults();
      if (!(window.Cloud && Cloud.enabled && Cloud.user())) head += '<div class="infobox" style="margin:10px 0">Mode local : tes fiches et dossiers de ce navigateur restent accessibles. La synchronisation attend une connexion Google ou Discord valide.</div>';
      if (this._loading) { body.innerHTML = head + this._msg('Chargement de tes projets…'); this._after(); return; }
      // Sans projet, la vue Clients montre quand même l'annuaire (sinon on
      // perdrait l'accès aux fiches en fusionnant l'ancienne page).
      if (!this._links.length && this._view !== 'clients') { body.innerHTML = head + this._empty(); this._after(); return; }
      const view = this._view === 'list' ? this._list()
                 : this._view === 'clients' ? this._clients()
                 : this._pipeline();
      body.innerHTML = head + view;
      this._after();
    },

    /* Ce qu'il faut peindre après coup : l'annuaire est rendu par renderClients()
       (app.html) et non par ce module. */
    _after() {
      document.querySelectorAll('#cp-body [data-cp-result]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.cpResult === 'client') this.viewClient(button.dataset.id);
        else this.manage(button.dataset.id);
      }));
      document.querySelectorAll('#cp-body [data-cp-restore]').forEach(button => button.addEventListener('click', () => this.restoreTrash(button.dataset.cpRestore)));
      if (this._view !== 'clients') return;
      try { window.renderClients?.(); } catch {}
    },

    _pipeline() {
      const cols = STAGE_ORDER.map(stage => {
        const items = this.orderedLinks(this._filteredLinks().filter(l => (l.stage || 'request') === stage));
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
      const rows = this.orderedLinks(this._filteredLinks()).map(l => {
        const s = STAGE[l.stage || 'request'], st = STATUS[l.status || 'active'];
        return `<div class="cp-row">
          ${l.localOnly ? `<input type="checkbox" aria-label="Sélectionner ${this._esc(l.projectName || 'Projet')}" data-token="${this._esc(l.token)}" onchange="CP.toggleSelect(this.dataset.token,this.checked)"${this.selectedTokens.has(l.token) ? ' checked' : ''}>` : ''}
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
        <form class="form-box${this._clientFormOpen ? ' visible' : ''}" id="add-client-form" onsubmit="event.preventDefault();addClient()">
          <div class="biz-form">
            <div><div class="prop-label">Nom</div><input class="prop-input" id="cl-name" placeholder="Entreprise" value="${this._esc(this._clientDraft.name)}" oninput="CP._clientDraft.name=this.value;CP.checkClientDuplicate()"></div>
            <div><div class="prop-label">Type</div><input class="prop-input" id="cl-type" placeholder="Design, Dev..." value="${this._esc(this._clientDraft.type)}" oninput="CP._clientDraft.type=this.value"></div>
          </div>
          <div id="cl-duplicate" role="alert" style="color:var(--gold-l);font-size:11px;margin-top:8px" hidden></div>
          <div class="hintbox" style="margin-top:10px">💡 La fiche est partagée : <strong style="color:var(--text)">Facturation</strong> et <strong style="color:var(--text)">Portails</strong> proposent ce nom automatiquement — et créent la fiche si elle n'existe pas.</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-accent" type="submit">Ajouter</button>
            <button class="btn btn-ghost" type="button" onclick="CP.toggleClientForm(false)">Annuler</button>
          </div>
        </form>
        <div class="cp-roster-grid" id="clients-list"></div>
      </div>`;

      const groups = new Map();
      this.orderedLinks(this._filteredLinks()).forEach(l => {
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
          ${key !== '__none' ? `<button class="btn btn-ghost" style="font-size:10px;margin-top:8px" onclick="CP.prefillClient(${this._esc(JSON.stringify(name))})">+ Créer la fiche client</button>` : ''}
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
      panel.innerHTML = `<div class="cp-create-h">Nouveau dossier de projet</div>
        <div class="biz-form"><div><div class="prop-label">Client *</div><input class="prop-input" id="cp-manual-client" list="dl-clients" value="${this._esc(chosen?.name || '')}" placeholder="Nom du client" oninput="CP.checkManualClient()"></div>
        <div><div class="prop-label">Nom du projet *</div><input class="prop-input" id="cp-manual-name" placeholder="Ex. Identité visuelle"></div>
        <div><div class="prop-label">Type de projet</div><input class="prop-input" id="cp-manual-type" placeholder="Ex. Design, site web"></div></div>
        <div id="cp-manual-match" role="status" style="color:var(--gold-l);font-size:11px;margin-top:8px" hidden></div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-accent" onclick="CP.saveManual()">Créer et ouvrir le dossier</button><button class="btn btn-ghost" onclick="CP.newProject()">Annuler</button></div>`;
      this.checkManualClient();
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
      if (!Array.isArray(clients)) clients = [];
      const normalizedName = clientName.toLocaleLowerCase('fr');
      const selectedClient = clients.find(c => String(c.id) === String(this._manualClientId));
      let client = selectedClient && String(selectedClient.name || '').trim().toLocaleLowerCase('fr') === normalizedName
        ? selectedClient : clients.find(c => String(c.name || '').trim().toLocaleLowerCase('fr') === normalizedName);
      let createdClient = false;
      if (!client) {
        client = { id: crypto.randomUUID(), name: clientName, type: '', status: 'active', progress: 0, revenue: 0, createdAt: Date.now() };
        clients.push(client);
        createdClient = true;
      }
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      try {
        if (createdClient) localStorage.setItem('hub_clients', JSON.stringify(clients));
        ClientWorkspace.ensure(token, { clientId: client.id, clientName: client.name, projectName, projectType, stage: 'request', localOnly: true });
      } catch (error) {
        if (createdClient) try { localStorage.setItem('hub_clients', JSON.stringify(clients.filter(c => c.id !== client.id))); } catch {}
        window.showToast?.('Impossible d’enregistrer le dossier sur cet appareil', '#c0392b', 3500);
        return;
      }
      this._creating = false; this._manualClientId = '';
      this._links = this._mergeLinks(this._links.filter(l => !l.localOnly)); this._view = 'clients';
      this.invalidateSearch();
      document.querySelectorAll('#cp-views button').forEach(b => b.classList.toggle('active', b.dataset.v === 'clients'));
      this._paint(); this._badge(); this.viewClient(client.id);
      if (typeof syncKPIs === 'function') syncKPIs();
      if (createdClient && typeof SiteAutoPublish !== 'undefined') {
        try { SiteAutoPublish.queue(); } catch (error) { console.warn('[client] publication automatique', error); }
      }
      try { Promise.resolve(ClientWorkspace.open(token)).catch(error => console.warn('[client] ouverture du dossier', error)); }
      catch (error) { console.warn('[client] ouverture du dossier', error); }
      window.showToast?.('Dossier de projet créé ✓', '#2e9a63', 2500);
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
