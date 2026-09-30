/* ══════════════════════════════════════════════════════════════════════════
   ClientWorkspace — la couche canonique « un projet = UN dossier »

   POURQUOI. Un projet client est aujourd'hui éclaté entre plusieurs
   collections qui ne partagent pas la même clé :

     public_links/<token>   pivot (Registry)         ← jeton  ✅
     requests/<token>       demande + questions      ← jeton  ✅
     estimates/<code>       devis + offers           ← jeton  ✅
     portals/<id>           (créé depuis un devis)   ← jeton  ✅
     hub_portals[].id       (créé dans l'app)        ← id aléatoire  ❌
     hub_invoices[]         factures                 ← nom du client  ❌
     hub_clients[]          annuaire                 ← nom (partagé)

   Ce module introduit `hub_workspaces` : UN document par projet, dont l'id EST
   le jeton, qui RÉFÉRENCE les pièces (refs) au lieu de les recopier. Rien n'est
   supprimé ni déplacé : chaque collection reste la source de lecture de sa
   page (Facturation lit toujours hub_invoices, Portails lit hub_portals…).

   RÔLES (cf. js/hub-data.js)
     localStorage hub_workspaces → cache local = ce que le dossier lit
     GitHub data/workspaces.json → source de vérité (sauvegarde, multi-appareil)
     Firestore users/{uid}/data/workspaces → miroir temps réel
     Firestore public_links/<token>       → pivot PUBLIC (résolveur /c/)

   RATTACHEMENT. Une pièce est rattachée si elle porte déjà le jeton ; sinon,
   seulement si UN SEUL dossier porte le nom de client — avec la trace
   `linkVia: 'token' | 'name' | 'manual'` : jamais d'attribution ambiguë, tout
   est réversible. Si le nom correspond à plusieurs dossiers, la pièce reste
   libre et apparaît dans le dossier sous « à rattacher ».

   CYCLE DE VIE. `closeMission()` est LOGIQUE (étape `done` + `closedAt`),
   jamais une suppression : le nettoyage physique viendra dans une tranche
   ultérieure, après validation de cette migration.

   INVARIANTS. Lecture/écriture SANS double relecture du localStorage (une
   seule entrée, une seule sortie) — sinon les mutations intermédiaires sont
   perdues. Toutes les écritures sont idempotentes ; la migration tourne une
   fois par session et se relance sans effet de bord.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const LS = 'hub_workspaces';
  const STAGES = ['request', 'estimate', 'mission', 'done'];
  const STAGE_META = {
    request:  { label: 'Demande',  icon: '📥', color: '#7f9cff' },
    estimate: { label: 'Devis',    icon: '📄', color: '#e4b24a' },
    mission:  { label: 'Mission',  icon: '🚀', color: '#4a9de4' },
    done:     { label: 'Terminé',  icon: '✅', color: '#2e9a63' },
  };

  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ClientWorkspace = {
    LS, STAGES, STAGE_META,
    _migrated: false,
    _lastReport: null,

    _cloudOk() { return !!(window.Cloud && Cloud.enabled && Cloud.user() && Cloud._db); },
    _rank(s) { const i = STAGES.indexOf(s); return i < 0 ? 0 : i; },

    /* ── stockage : UNE lecture, UNE écriture par opération ─────────────── */
    all() { const v = read(LS, []); return Array.isArray(v) ? v : []; },
    save(list) { write(LS, list || []); },
    get(token) { return token ? this.all().find(w => w.token === token) || null : null; },
    /** Tous les dossiers d'un nom de client (jointure tolérante à la casse). */
    forClient(name) {
      const n = norm(name); if (!n) return [];
      return this.all().filter(w => norm(w.clientName) === n);
    },

    /* Crée OU fait progresser un dossier DANS la liste passée (mono-entrée).
       Monotone sur l'étape : on ne régresse jamais, on ne perd jamais un champ
       d'affichage déjà renseigné. Idempotent. */
    _ensureIn(list, token, patch) {
      if (!token) return null;
      patch = patch || {};
      let w = list.find(x => x.token === token);
      const now = Date.now();
      if (!w) { w = { token, stage: 'request', status: 'active', refs: {}, createdAt: now }; list.unshift(w); }
      if (patch.stage && this._rank(patch.stage) >= this._rank(w.stage)) w.stage = patch.stage;
      for (const k of ['clientName', 'projectName', 'total', 'currency'])
        if (patch[k] != null && patch[k] !== '') w[k] = patch[k];
      if (patch.status && ['active', 'inactive', 'archived', 'trashed'].includes(patch.status)) {
        if (!w.status || patch.status !== 'active' || w.status === 'active') w.status = patch.status;
      }
      if (patch.createdAt && (!w.createdAt || patch.createdAt < w.createdAt)) w.createdAt = patch.createdAt;
      w.refs = w.refs || {};
      w.updatedAt = now;
      return w;
    },
    ensure(token, patch) { const list = this.all(); const w = this._ensureIn(list, token, patch); this.save(list); return w; },

    /* Empreinte de ce qui a déjà été poussé vers `public_links` : on n'écrit
       dans le cloud QUE si le dossier a réellement changé (quota Spark).
       Les défauts sont ceux de Registry.register (stage 'request', status
       'active') pour que « lu dans le cloud » et « local » comparent pareil. */
    _sig(o) {
      return [o.stage || 'request', o.status || 'active', o.clientName || '', o.projectName || '', o.total || 0].join('|');
    },

    /* ── références (refs) et rattachement ──────────────────────────────── */
    /** `refs` = { estimate, portal, invoices[] } : des RÉFÉRENCES, jamais des
        copies. Une pièce n'appartient qu'à UN dossier. */
    _setRef(w, kind, id) {
      if (!w) return;
      w.refs = w.refs || {};
      if (kind === 'invoices') {
        if (!Array.isArray(w.refs.invoices)) w.refs.invoices = [];
        if (id && !w.refs.invoices.includes(id)) w.refs.invoices.push(id);
      } else if (id) { w.refs[kind] = id; }
    },
    /** Écrit `workspaceId` sur la pièce (additif, réversible) + trace `via`. */
    _stamp(item, token, via) {
      if (!item || !token || item.workspaceId === token) return false;
      item.workspaceId = token;
      item.linkVia = via || 'manual';
      item.linkedAt = Date.now();
      return true;
    },

    /** Rattachement par nom de client — SEULEMENT si UN SEUL dossier porte ce
        nom. Renvoie 'name', 'token' (déjà fait) ou null (ambigu / inconnu). */
    bindByClient(name, itemId, kind) {
      const key = kind === 'portal' ? 'hub_portals' : 'hub_invoices';
      const refKind = kind === 'portal' ? 'portal' : 'invoices';
      const cands = this.forClient(name);
      if (cands.length !== 1) return null;
      const wToken = cands[0].token;
      const store = read(key, []);
      const item = store.find(x => x.id === itemId);
      if (!item) return null;
      if (item.workspaceId) return item.workspaceId === wToken ? 'token' : null;
      this._stamp(item, wToken, 'name');
      write(key, store);
      const list = this.all();
      this._setRef(list.find(w => w.token === wToken), refKind, itemId);
      this.save(list);
      return 'name';
    },

    /** Rattachement MANUEL depuis le dossier (pièce laissée libre par la
        migration : nom de client partagé par plusieurs projets). */
    attach(itemId, token, kind) {
      if (!itemId || !token) return false;
      const key = kind === 'portal' ? 'hub_portals' : 'hub_invoices';
      const refKind = kind === 'portal' ? 'portal' : 'invoices';
      const store = read(key, []);
      const item = store.find(x => x.id === itemId);
      if (!item) return false;
      this._stamp(item, token, 'manual');
      write(key, store);
      const list = this.all();
      this._setRef(list.find(w => w.token === token), refKind, itemId);
      this.save(list);
      return true;
    },

    /* ── migration : recensement + références, SANS suppression ─────────── */
    /**
     * @param {Object} [opts] {force:true} pour relancer dans la session
     * @returns {Promise<{tokens,created,invoices,portals,ambiguous,skipped,already,cloud}>}
     */
    async migrate(opts) {
      opts = opts || {};
      if (this._migrated && !opts.force)
        return this._lastReport || { tokens: 0, created: 0, invoices: 0, portals: 0, ambiguous: 0, skipped: 0, already: 0, cloud: 0 };
      this._migrated = true;
      const rep = { tokens: 0, created: 0, invoices: 0, portals: 0, ambiguous: 0, skipped: 0, already: 0, cloud: 0 };

      /* 1 — les jetons déjà connus du pivot public (Registry) */
      let links = [];
      if (this._cloudOk() && window.Registry) {
        try { links = await Registry.list({ includeTrashed: true }); } catch { links = []; }
      }

      const list = this.all();           // UNE lecture
      const before = list.length;
      const ensure = (token, patch) => { rep.tokens++; return this._ensureIn(list, token, patch); };

      links.forEach(l => {
        const w = ensure(l.token, {
          stage: l.stage, status: l.status, clientName: l.clientName,
          projectName: l.projectName, total: l.total, currency: l.currency, createdAt: l.createdAt,
        });
        // Empreinte = l'état EXACT lu dans le cloud : si le dossier local est
        // identique, rien n'y sera renvoyé (économie de quota Spark).
        if (w) w._cloudSig = this._sig(l);
      });

      /* 2 — les devis locaux : leur `code` EST le jeton (/c/<code>) */
      read('hub_estimates', []).forEach(e => {
        if (!e || !e.code) return;
        const w = ensure(e.code, {
          stage: e.launched ? 'mission' : 'estimate',
          projectName: e.project, total: e.total, currency: e.currency, createdAt: e.createdAt,
        });
        this._setRef(w, 'estimate', e.code);
      });

      /* 3 — les portails : `id` = jeton s'ils viennent d'un devis, sinon
             pièce libre (traitée au point 4 comme une facture) */
      const portals = read('hub_portals', []);
      portals.forEach(p => {
        if (!p || !p.id) return;
        const isToken = /\/c\//.test(p.url || '') || !!list.find(x => x.token === p.id) || !!links.find(l => l.token === p.id);
        if (!isToken) return;
        const w = ensure(p.id, { stage: 'mission', clientName: p.client, projectName: p.mission, total: p.total, createdAt: p.createdAt });
        this._setRef(w, 'portal', p.id);
      });

      rep.created = list.length - before;
      rep.tokens = list.length;

      /* 4 — rattachement par nom UNIQUE ; le reste reste « à rattacher » */
      const byName = new Map();
      list.forEach(w => {
        const k = norm(w.clientName); if (!k) return;
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(w.token);
      });
      const bind = (key, arr, repKey, refKind) => {
        let changed = false;
        arr.forEach(item => {
          if (!item) return;
          if (item.workspaceId) { rep.already++; return; }
          const cands = byName.get(norm(item.client)) || [];
          if (cands.length === 1) {
            this._stamp(item, cands[0], 'name');
            this._setRef(list.find(w => w.token === cands[0]), refKind, item.id);
            rep[repKey]++; changed = true;
          } else if (cands.length > 1) { rep.ambiguous++; }
          else if (norm(item.client)) { rep.skipped++; }
        });
        if (changed) write(key, arr);
      };
      bind('hub_invoices', read('hub_invoices', []), 'invoices', 'invoices');
      bind('hub_portals', portals, 'portals', 'portal');

      /* 5 — pousser VERS le pivot public ce qui a changé (étape monotone) */
      if (this._cloudOk() && window.Registry) {
        for (const w of list) {
          if (!w.token || w._cloudSig === this._sig(w)) continue;   // rien à écrire
          try {
            await Registry.register(w.token, {
              stage: w.stage, clientName: w.clientName, projectName: w.projectName,
              total: w.total, currency: w.currency,
            });
            w._cloudSig = this._sig(w);
            rep.cloud++;
          } catch { /* dégradation douce */ }
        }
      }
      this.save(list);                   // UNE écriture
      this._lastReport = rep;
      this._pushRun(rep);
      if (rep.created || rep.invoices || rep.portals || rep.ambiguous)
        console.log('[client-workspace] migration', JSON.stringify(rep));
      return rep;
    },

    /* Journal des passes (max 20) : c'est CE que la migration a fait, alors
       que `audit()` décrit l'état ACTUEL — les deux se lisent dans le panneau
       de validation. */
    _pushRun(rep) {
      try {
        const runs = read('hub_ws_runs', []);
        runs.unshift({ at: Date.now(), rep: Object.assign({}, rep) });
        write('hub_ws_runs', runs.slice(0, 20));
      } catch { /* diagnostic : jamais bloquant */ }
    },
    runs() { return read('hub_ws_runs', []); },

    /* ── le dossier ─────────────────────────────────────────────────────── */
    /** Rassemble toutes les pièces d'un projet : local d'abord, cloud en
        mieux (meilleur effort, jamais bloquant — le dossier s'ouvre hors-ligne). */
    async build(token) {
      if (!token) return null;
      // Auto-réparation : un jeton déjà exposé par CP (Registry) n'a pas
      // toujours de dossier local (projet créé avant ce module) — on le crée
      // plutôt que d'ouvrir un dossier vide. Les écritures suivantes (clôture,
      // rattachement) reposent sur la même règle.
      let w = this.get(token);
      if (!w) w = this.ensure(token, {});

      const invoices = read('hub_invoices', []);
      const portals  = read('hub_portals', []);
      const ests     = read('hub_estimates', []);
      const roster   = read('hub_clients', []);

      /* Lecture PAR RÉFÉRENCE : `workspaceId` (écrit sur la pièce) ∪ `refs`
         (écrit sur le dossier) — `audit()` signale ceux des deux signaux qui
         divergent, `resync()` les remet d'accord.
         Le filtre par nom qui suit ne sert plus qu'aux pièces ENCORE LIBRES :
         c'est l'ancienne jointure, tolérée pendant la transition et appelée à
         disparaître en v3.9 — jamais la voie normale de lecture. */
      const refIds = new Set((w.refs && Array.isArray(w.refs.invoices)) ? w.refs.invoices : []);
      const attached = invoices.filter(i => i.workspaceId === token || (refIds.has(i.id) && !i.workspaceId));
      const candidates = invoices.filter(i => !i.workspaceId && !refIds.has(i.id)
        && norm(i.client) && norm(i.client) === norm(w.clientName));
      const portal = portals.find(p => p.id === token || p.workspaceId === token) || null;
      const est = ests.find(e => e.code === token) || null;
      const client = roster.find(c => norm(c.name) === norm(w.clientName)) || null;
      const siblings = this.all().filter(x => x.token !== token && norm(x.clientName) === norm(w.clientName));

      /* Références du dossier dont la pièce n'existe plus (signalées, jamais
         supprimées d'elles-mêmes : retrait = action explicite de l'utilisateur) */
      const known = new Set(invoices.map(i => i.id));
      const broken = [];
      if (w.refs && w.refs.portal && !portals.some(p => p.id === w.refs.portal))
        broken.push({ kind: 'portal', id: w.refs.portal });
      refIds.forEach(id => { if (!known.has(id)) broken.push({ kind: 'invoice', id }); });

      let req = null, estDoc = null;
      if (this._cloudOk()) {
        const get = async col => {
          try { const d = await Cloud._db.collection(col).doc(token).get(); return d.exists ? d.data() : null; } catch { return null; }
        };
        [req, estDoc] = await Promise.all([get('requests'), get('estimates')]);
      }

      const paid = attached.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.price) || 0), 0);
      const due  = attached.filter(i => i.status !== 'paid').reduce((s, i) => s + (Number(i.price) || 0), 0);
      const vias = [...attached.map(i => i.linkVia), portal && portal.linkVia].filter(Boolean);
      vias.push('token');
      return {
        w, client, portal, est, estDoc, req, siblings,
        invoices: attached, candidates, broken,
        stage: STAGE_META[w.stage] || STAGE_META.request,
        via: [...new Set(vias)].join(' + '),
        totals: {
          invoiced: paid + due, paid, due,
          mission: Number(portal && portal.total) || Number(w.total) || 0,
        },
      };
    },

    /** Ouvre le tiroir latéral du dossier. */
    async open(token) {
      const d = await this.build(token);
      if (!d) return null;
      this._current = d;
      const root = document.getElementById('cw-root');
      if (root) {
        root.innerHTML = this.render(d);
        root.classList.add('on');
        root.setAttribute('aria-hidden', 'false');
        try { root.querySelector('.cw-close')?.focus(); } catch {}
      }
      return d;
    },
    close() {
      const root = document.getElementById('cw-root');
      if (root) { root.classList.remove('on'); root.setAttribute('aria-hidden', 'true'); }
      this._current = null;
    },

    /* Clôture LOGIQUE : étape `done` + horodatage. Aucune suppression, rien
       n'est déplacé : le nettoyage physique (dossiers réellement terminés)
       viendra dans une tranche ultérieure, après validation de cette migration. */
    async closeMission(token) {
      const list = this.all();
      const w = this._ensureIn(list, token, {});
      if (w.stage !== 'done') w.lastStage = w.stage;
      w.stage = 'done';
      w.closedAt = Date.now();
      this.save(list);
      if (this._cloudOk() && window.Registry) {
        let ok = false;
        try { ok = !!(await Registry.register(token, { stage: 'done' })); } catch {}
        if (ok) { w._cloudSig = this._sig(w); this.save(list); }   // resynchronisé
      }
      return this.open(token);
    },
    /* Rouvre : retour à l'étape d'avant la clôture. C'est la SEULE écriture qui
       a le droit de régresser une étape — action explicite de l'utilisateur,
       jamais automatique (Registry reste monotone partout ailleurs). */
    async reopen(token) {
      const list = this.all();
      const w = this._ensureIn(list, token, {});
      w.stage = STAGES.includes(w.lastStage) ? w.lastStage : 'mission';
      w.closedAt = null;
      this.save(list);
      if (this._cloudOk()) {
        try {
          await Cloud._db.collection('public_links').doc(token)
            .set({ stage: w.stage, updatedAt: Date.now() }, { merge: true });
          w._cloudSig = this._sig(w);
          this.save(list);
        } catch { /* dégradation douce : le prochain push de migration rattrapera */ }
      }
      return this.open(token);
    },

    /* ── validation (v3.8) : ce que les VRAIES données donnent ───────────── */
    /**
     * État ACTUEL, non destructif. `_pushRun()` raconte ce que la migration a
     * FAIT ; `audit()` répond « qu'est-ce qui reste à traiter » — c'est ce que
     * le panneau affiche et ce qu'on te demandera de copier pour la validation
     * sur données réelles.
     * @returns {Object} rapport JSON copiable
     */
    audit() {
      const ws  = this.all();
      const inv = read('hub_invoices', []);
      const por = read('hub_portals', []);
      const tokens = new Set(ws.map(w => w.token));

      // Nom de client → dossiers portant ce nom (la vieille jointure, mesurée).
      const byName = new Map();
      ws.forEach(w => {
        const k = norm(w.clientName); if (!k) return;
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(w.token);
      });

      /* Pièces : rattachées (workspaceId → dossier existant) vs encore libres,
         et POURQUOI elles le sont (aucun dossier / nom partagé / en attente). */
      const classify = arr => {
        const out = { total: arr.length, rattachees: 0, via: { token: 0, name: 0, manual: 0, ref: 0 },
                      libres: 0, aAttacher: 0, orphelines: [], ambigues: [] };
        arr.forEach(it => {
          if (!it) return;
          if (it.workspaceId) {
            if (tokens.has(it.workspaceId)) {
              out.rattachees++;
              const v = it.linkVia || 'token';
              out.via[v] = (out.via[v] || 0) + 1;
            }
            return;                       // dossier fantôme → traité dans refs
          }
          out.libres++;
          const c = norm(it.client) ? (byName.get(norm(it.client)) || []) : [];
          if (!norm(it.client)) return;   // sans client : rien à joindre
          if (c.length === 1) out.aAttacher++;
          else if (c.length > 1) out.ambigues.push({ id: it.id, name: it.name, n: c.length });
          else out.orphelines.push({ id: it.id, name: it.name, client: it.client });
        });
        return out;
      };

      /* Les deux signaux de référence, confrontés pièce par pièce :
         cassees   = refs pointant vers une pièce qui n'existe plus (retrait
                     EXPLICITE via dropRef, jamais automatique)
         manquantes= pièce rattachée mais absente de refs (resync l'ajoute)
         conflits  = refs dit A, la pièce dit B (jamais corrigé tout seul)   */
      const invById = new Map(inv.map(i => [i.id, i]));
      const porById = new Map(por.map(p => [p.id, p]));
      const refs = { cassees: [], manquantes: [], conflits: [], sansWorkspaceId: [] };
      ws.forEach(w => {
        const r = w.refs || {};
        const inRef = Array.isArray(r.invoices) ? r.invoices : [];
        if (r.portal && !porById.has(r.portal)) refs.cassees.push({ token: w.token, kind: 'portal', id: r.portal });
        inRef.forEach(id => {
          const it = invById.get(id);
          if (!it) refs.cassees.push({ token: w.token, kind: 'invoice', id });
          else if (!it.workspaceId) refs.sansWorkspaceId.push({ token: w.token, kind: 'invoice', id });
          else if (it.workspaceId !== w.token) refs.conflits.push({ token: w.token, kind: 'invoice', id, autre: it.workspaceId });
        });
        const set = new Set(inRef);
        inv.forEach(i => { if (i.workspaceId === w.token && !set.has(i.id)) refs.manquantes.push({ token: w.token, kind: 'invoice', id: i.id }); });
        const p = por.find(x => x.id === w.token || x.workspaceId === w.token);
        if (p && r.portal !== p.id) refs.manquantes.push({ token: w.token, kind: 'portal', id: p.id });
      });
      // Pièce marquée d'un dossier qui n'existe (plus) nulle part.
      const fantomes = [
        ...inv.filter(i => i.workspaceId && !tokens.has(i.workspaceId)).map(i => ({ kind: 'invoice', id: i.id, token: i.workspaceId })),
        ...por.filter(p => p.workspaceId && !tokens.has(p.workspaceId)).map(p => ({ kind: 'portal', id: p.id, token: p.workspaceId })),
      ];

      const byStage = {};
      ws.forEach(w => { byStage[w.stage || 'request'] = (byStage[w.stage || 'request'] || 0) + 1; });

      return {
        at: Date.now(),
        ws:   { total: ws.length, byStage,
                sansClient: ws.filter(w => !norm(w.clientName)).length,
                sansProjet: ws.filter(w => !norm(w.projectName)).length },
        inv:  classify(inv),
        por:  classify(por),
        refs, fantomes,
        runs: this.runs(),
        ok: !refs.cassees.length && !refs.conflits.length && !fantomes.length,
      };
    },

    /** Complète / répare les références. AJOUTE UNIQUEMENT : ne supprime ni
        pièce ni référence (le retrait d'une référence cassée est `dropRef`,
        un clic explicite de l'utilisateur). */
    resync() {
      const rep = { refsAjoutees: 0, wsRestaurees: 0, conflits: 0, introuvables: 0 };
      const list = this.all();
      const inv = read('hub_invoices', []);
      const por = read('hub_portals', []);
      let invDirty = false, porDirty = false;

      list.forEach(w => {
        w.refs = w.refs || {};
        const set = new Set(Array.isArray(w.refs.invoices) ? w.refs.invoices : []);

        // a) toute pièce marquée de ce dossier doit figurer dans ses refs
        inv.forEach(i => { if (i.workspaceId === w.token && !set.has(i.id)) { set.add(i.id); rep.refsAjoutees++; } });
        const p = por.find(x => x.id === w.token || x.workspaceId === w.token);
        if (p) {
          if (w.refs.portal !== p.id) { w.refs.portal = p.id; rep.refsAjoutees++; }
          if (p.id === w.token && !p.workspaceId) { this._stamp(p, w.token, 'token'); rep.wsRestaurees++; porDirty = true; }
        }

        // b) toute référence dont la pièce n'a AUCUN dossier → workspaceId restauré
        [...set].forEach(id => {
          const it = inv.find(x => x.id === id);
          if (!it) { rep.introuvables++; return; }              // cassée : à trancher à la main
          if (it.workspaceId && it.workspaceId !== w.token) { rep.conflits++; return; }
          if (!it.workspaceId) { this._stamp(it, w.token, 'ref'); rep.wsRestaurees++; invDirty = true; }
        });
        w.refs.invoices = [...set];
      });

      if (invDirty) write('hub_invoices', inv);
      if (porDirty) write('hub_portals', por);
      this.save(list);
      this._pushRun({ at: Date.now(), resync: rep });
      return rep;
    },

    /** Retrait EXPLICITE d'une référence cassée (aucune écriture ailleurs). */
    dropRef(token, kind, id) {
      const list = this.all();
      const w = list.find(x => x.token === token); if (!w) return false;
      w.refs = w.refs || {};
      if (kind === 'portal') { if (w.refs.portal !== id) return false; w.refs.portal = ''; }
      else {
        if (!Array.isArray(w.refs.invoices) || !w.refs.invoices.includes(id)) return false;
        w.refs.invoices = w.refs.invoices.filter(x => x !== id);
      }
      w.updatedAt = Date.now();
      this.save(list);
      this._pushRun({ at: Date.now(), dropRef: { token, kind, id } });
      return true;
    },

    /* ── panneau de validation (vue « Clients ») ──────────────────────────── */
    valPanel() {
      if (!this.all().length) return '';     // rien à valider = pas de bruit
      return `<div class="cw-val" id="cw-val">${this._valInner(this.audit())}</div>`;
    },
    paintValidation() {
      const el = document.getElementById('cw-val');
      if (el) el.innerHTML = this._valInner(this.audit());
    },
    _valInner(a) {
      const n = x => `<b>${x}</b>`;
      const li = (arr, txt) => arr.length
        ? arr.slice(0, 3).map(x => `<div class="cw-val-li">• ${txt(x)}</div>`).join('')
          + (arr.length > 3 ? `<div class="cw-val-li">… et ${arr.length - 3}</div>` : '')
        : '';
      const attached = a.inv.rattachees + a.por.rattachees;
      const viaTxt = ['token', 'name', 'manual', 'ref'].filter(k => a.inv.via[k] || a.por.via[k])
        .map(k => `${k} ${a.inv.via[k] + a.por.via[k]}`).join(' · ');

      const issues = [
        li(a.inv.orphelines, x => `${n(esc(x.name || x.id))} — client <i>${esc(x.client)}</i> sans dossier`),
        li(a.por.orphelines, x => `portail ${n(esc(x.id))} — client <i>${esc(x.client)}</i> sans dossier`),
        li(a.inv.ambigues,   x => `facture ${n(esc(x.name || x.id))} — ${x.n} dossiers portent ce nom`),
        li(a.refs.cassees,   x => `${x.kind === 'portal' ? 'portail' : 'facture'} <code>${esc(x.id)}</code> introuvable`
            + ` <button class="cw-mini-btn" onclick="ClientWorkspace.dropRef('${esc(x.token)}','${esc(x.kind)}','${esc(x.id)}');ClientWorkspace.paintValidation()">retirer</button>`),
        li(a.refs.conflits,  x => `<code>${esc(x.id)}</code> porte déjà le dossier <code>${esc(x.autre)}</code>`),
        li(a.fantomes,       x => `${x.kind === 'portal' ? 'portail' : 'facture'} <code>${esc(x.id)}</code> → dossier <code>${esc(x.token)}</code> absent`),
      ].join('');

      const last = a.runs[0];
      return `
        <div class="cw-val-h">
          <span><b>🔍 Validation des rattachements</b>
            <span class="cw-val-sub">${n(a.ws.total)} dossier${a.ws.total > 1 ? 's' : ''} ·
              ${a.inv.total} facture${a.inv.total > 1 ? 's' : ''} · ${a.por.total} portail${a.por.total > 1 ? 's' : ''}</span></span>
          <span class="cw-val-ok ${a.ok ? 'yes' : 'no'}">${a.ok ? '✔ cohérent' : '⚠ à vérifier'}</span>
        </div>
        <div class="cw-val-b">
          <div class="cw-val-li">• ${n(attached)} pièce${attached > 1 ? 's' : ''} rattachée${attached > 1 ? 's' : ''}${viaTxt ? ` <span class="cw-val-via">(${esc(viaTxt)})</span>` : ''}</div>
          ${a.inv.aAttacher + a.por.aAttacher ? `<div class="cw-val-li">• ${n(a.inv.aAttacher + a.por.aAttacher)} à rattacher à la prochaine passe <span class="cw-val-via">(nom de client à dossier unique)</span></div>` : ''}
          ${a.inv.libres && !a.inv.aAttacher && !a.inv.orphelines.length && !a.inv.ambigues.length ? `<div class="cw-val-li">• ${n(a.inv.libres)} facture${a.inv.libres > 1 ? 's' : ''} sans client</div>` : ''}
          ${issues}
          ${a.refs.manquantes.length ? `<div class="cw-val-li">• ${n(a.refs.manquantes.length)} référence${a.refs.manquantes.length > 1 ? 's' : ''} manquante${a.refs.manquantes.length > 1 ? 's' : ''} dans les dossiers</div>` : ''}
          ${a.refs.sansWorkspaceId.length ? `<div class="cw-val-li">• ${n(a.refs.sansWorkspaceId.length)} pièce${a.refs.sansWorkspaceId.length > 1 ? 's' : ''} référencée${a.refs.sansWorkspaceId.length > 1 ? 's' : ''} mais sans <code>workspaceId</code></div>` : ''}
        </div>
        <div class="cw-val-a">
          <button class="cw-btn sm" onclick="ClientWorkspace.rerunMigration()">↻ Relancer la migration</button>
          ${(a.refs.manquantes.length || a.refs.sansWorkspaceId.length) ? `<button class="cw-btn sm" onclick="ClientWorkspace.resyncRefs()">🧩 Compléter les références</button>` : ''}
          <button class="cw-btn sm" onclick="ClientWorkspace.copyReport()">📋 Copier le rapport</button>
        </div>
        <div class="cw-val-f">${last ? `dernière passe ${window.timeAgo ? timeAgo(last.at) : new Date(last.at).toLocaleString('fr-FR')}` : 'aucune passe enregistrée'} —
          jointures par nom tolérées jusqu'en v3.9, où <code>workspaceId</code> + <code>refs</code> deviennent la seule voie.</div>`;
    },
    async rerunMigration() {
      const rep = await this.migrate({ force: true });
      this.paintValidation();
      window.showToast?.(`Migration : ${rep.created} dossier(s) créé(s), ${rep.invoices + rep.portals} rattaché(s), ${rep.ambiguous} ambigu(s)`, rep.ambiguous ? '#e4b24a' : '#2e9a63', 3500);
      window.CP?.render?.();
      return rep;
    },
    resyncRefs() {
      const rep = this.resync();
      this.paintValidation();
      window.showToast?.(`Références : ${rep.refsAjoutees} ajoutée(s), ${rep.wsRestaurees} workspaceId restauré(s)${rep.conflits ? ', ' + rep.conflits + ' conflit(s) non touchés' : ''}`, rep.conflits ? '#e4b24a' : '#2e9a63', 3500);
      return rep;
    },
    copyReport() {
      const a = this.audit();
      const runs = a.runs || []; delete a.runs;
      const txt = JSON.stringify({ audit: a, runs }, null, 2);
      const done = ok => window.showToast?.(ok ? 'Rapport copié ✓ — colle-le tel quel' : 'Copie impossible', ok ? '#2e9a63' : '#c0392b', 2500);
      try { navigator.clipboard?.writeText(txt).then(() => done(true)).catch(() => done(false)); }
      catch { done(false); }
      return txt;
    },

    /* ── rendu du dossier ───────────────────────────────────────────────── */
    _money(v, cur) {
      const n = Number(v) || 0;
      if (!n) return '<span style="opacity:.4">—</span>';
      return n.toLocaleString('fr-FR') + ' ' + (cur || '€');
    },
    _date(ts) { return ts ? new Date(ts).toLocaleDateString('fr-FR') : '—'; },
    _sec(title, icon, body, action) {
      return `<section class="cw-sec">
        <div class="cw-sec-h"><span>${icon} ${title}</span>${action || ''}</div>
        <div class="cw-sec-b">${body}</div>
      </section>`;
    },
    _none(txt) { return `<div class="cw-none">${esc(txt)}</div>`; },

    render(d) {
      const w = d.w, meta = d.stage;

      /* 1 · Client */
      const client = d.client
        ? `<div class="cw-kv"><span>Type</span><b>${esc(d.client.type) || '—'}</b></div>
           <div class="cw-kv"><span>Avancement</span><b>${Number(d.client.progress) || 0} %</b></div>
           <div class="cw-kv"><span>Fiche annuaire</span><b>${esc(d.client.name)}</b></div>`
        : this._none('Pas de fiche annuaire pour ce nom — la prochaine facture la créera.');
      const sib = d.siblings.length
        ? `<div class="cw-sib"><span class="cw-sib-l">Autres projets de ce client :</span>${
            d.siblings.map(s => `<button class="cw-chip" onclick="ClientWorkspace.open('${esc(s.token)}')">${esc(s.projectName || s.token)}</button>`).join('')}</div>`
        : '';

      /* 2 · Demande */
      const req = d.req
        ? `<div class="cw-kv"><span>Statut</span><b>${esc(d.req.status || 'ouverte')}</b></div>
           <div class="cw-kv"><span>Reçue le</span><b>${this._date(d.req.createdAt)}</b></div>`
        : this._none('Aucune demande sur ce lien.');

      /* 3 · Devis */
      const estTotal = d.estDoc ? d.estDoc.total : (d.est ? d.est.total : null);
      const est = (d.estDoc || d.est)
        ? `<div class="cw-kv"><span>Montant</span><b>${this._money(estTotal, (d.estDoc && d.estDoc.currency) || (d.est && d.est.currency))}</b></div>
           <div class="cw-kv"><span>Lignes</span><b>${(d.estDoc && d.estDoc.lines && d.estDoc.lines.length) || '—'}</b></div>
           <div class="cw-kv"><span>Statut</span><b>${esc((d.estDoc && d.estDoc.status) || (d.est && d.est.launched ? 'lancée' : 'envoyée'))}</b></div>
           ${d.estDoc && d.estDoc.deadline ? `<div class="cw-kv"><span>Échéance</span><b>${esc(d.estDoc.deadline)}</b></div>` : ''}`
        : this._none('Aucun devis sur ce lien.');

      /* 4 · Mission / Portail */
      const steps = ['Brief', 'Devis', 'Acompte', 'Production', 'Livraison', 'Terminé'];
      const portal = d.portal
        ? `<div class="cw-kv"><span>Étape</span><b>${esc(steps[d.portal.stepIndex] || '—')} · ${(Number(d.portal.stepIndex) || 0) + 1}/6</b></div>
           <div class="cw-kv"><span>Total</span><b>${this._money(d.portal.total)}</b></div>
           <div class="cw-kv"><span>Acompte</span><b>${Number(d.portal.acomptePct) || 0} %</b></div>
           <div class="cw-kv"><span>Livrables</span><b>${(d.portal.deliverables || []).length}</b></div>`
        : this._none('Aucun portail mission rattaché.');

      /* 5 · Facturation */
      const inv = d.invoices.length
        ? d.invoices.map(i => `<div class="cw-inv">
            <span class="cw-inv-n">${esc(i.name)}</span>
            <span class="cw-inv-p">${this._money(i.price)}</span>
            <span class="cw-st ${i.status === 'paid' ? 'ok' : 'w'}">${i.status === 'paid' ? 'Payée' : 'En attente'}</span>
          </div>`).join('') +
          `<div class="cw-tot"><span>Payé&nbsp;: ${this._money(d.totals.paid)}</span><span>Reste&nbsp;: ${this._money(d.totals.due)}</span></div>`
        : this._none('Aucune facture rattachée à ce dossier.');
      const cand = d.candidates.length
        ? `<div class="cw-cand-h">À rattacher (même nom de client, choix à confirmer)</div>` +
          d.candidates.map(i => `<div class="cw-inv">
            <span class="cw-inv-n">${esc(i.name)}${i.client ? ' · ' + esc(i.client) : ''}</span>
            <span class="cw-inv-p">${this._money(i.price)}</span>
            <button class="cw-mini-btn" onclick="ClientWorkspace.attach('${esc(i.id)}','${esc(w.token)}','invoice');ClientWorkspace.open('${esc(w.token)}')">Rattacher</button>
          </div>`).join('')
        : '';

      /* 6 · Livraison */
      const deliv = d.portal && (d.portal.deliverables || []).length
        ? d.portal.deliverables.map(x => `<div class="cw-kv"><span>${esc(x.label)}</span><b>${x.url ? '📎 lien' : '—'}</b></div>`).join('')
        : this._none('Aucun livrable déposé pour l\'instant.');

      const closed = w.stage === 'done';
      return `
      <div class="cw-backdrop" onclick="ClientWorkspace.close()"></div>
      <aside class="cw-drawer" role="dialog" aria-label="Dossier client">
        <header class="cw-head" style="border-left-color:${meta.color}">
          <div class="cw-head-top">
            <span class="cw-stage" style="color:${meta.color}">${meta.icon} ${meta.label}</span>
            <button class="cw-close" onclick="ClientWorkspace.close()" aria-label="Fermer">✕</button>
          </div>
          <div class="cw-title">${esc(w.projectName) || '<span style="opacity:.5">Projet sans nom</span>'}</div>
          <div class="cw-sub">${w.clientName ? '👤 ' + esc(w.clientName) : '<span style="opacity:.5">Client non renseigné</span>'} · ${this._money(w.total, w.currency)}</div>
          <div class="cw-act">
            <button class="cw-btn" onclick="ClientWorkspace.copyLink('${esc(w.token)}')" title="Copier le lien client">📋 Copier</button>
            <button class="cw-btn" onclick="ClientWorkspace.showLink('${esc(w.token)}')" title="Ouvrir /c/">🔗 Ouvrir</button>
            ${closed
              ? `<button class="cw-btn" onclick="ClientWorkspace.reopen('${esc(w.token)}')">↺ Rouvrir</button>`
              : `<button class="cw-btn go" onclick="ClientWorkspace.closeMission('${esc(w.token)}')" title="Passe le dossier en Terminé — rien n'est supprimé">✅ Terminer</button>`}
          </div>
        </header>

        ${this._sec('Client', '🧑', client + sib, `<button class="cw-sec-a" onclick="ClientWorkspace.toRoster()">Annuaire</button>`)}
        ${this._sec('Demande', '📥', req, `<button class="cw-sec-a" onclick="ClientWorkspace.newRequest()">+ Lien</button>`)}
        ${this._sec('Devis', '📄', est, `<button class="cw-sec-a" onclick="ClientWorkspace.go('devis')">Ouvrir</button>`)}
        ${this._sec('Mission / Portail', '🚀', portal, `<button class="cw-sec-a" onclick="ClientWorkspace.editPortal('${esc(d.portal ? d.portal.id : '')}')">${d.portal ? 'Modifier' : 'Créer'}</button>`)}
        ${this._sec('Facturation', '💶', inv + cand, `<button class="cw-sec-a" onclick="ClientWorkspace.go('facturation', true)">+ Facture</button>`)}
        ${this._sec('Livraison', '✅', deliv, `<button class="cw-sec-a" onclick="ClientWorkspace.go('portals')">Portail</button>`)}

        <footer class="cw-foot">
          dossier <code>${esc(w.token)}</code> · ouvert le ${this._date(w.createdAt)}${w.closedAt ? ' · clôturé le ' + this._date(w.closedAt) : ''}
          <br><span class="cw-via">rattachement : ${esc(d.via)} — pièces référencées, rien n'a été déplacé ni supprimé</span>
          ${(d.broken && d.broken.length) ? `<div class="cw-warn">⚠ ${d.broken.length} référence${d.broken.length > 1 ? 's' : ''} vers une pièce introuvable :
            ${d.broken.map(b => `<button class="cw-mini-btn" onclick="ClientWorkspace.dropRef('${esc(w.token)}','${esc(b.kind)}','${esc(b.id)}')">${b.kind === 'portal' ? 'Portail' : 'Facture'} ${esc(b.id)} — retirer</button>`).join(' ')}</div>` : ''}
        </footer>
      </aside>`;
    },

    /* ── actions du dossier ─────────────────────────────────────────────── */
    copyLink(t) { window.CP ? CP.copyLink(t) : navigator.clipboard?.writeText(location.origin + '/c/' + t); },
    showLink(t) { window.CP ? CP.openLink(t) : window.open(location.origin + '/c/' + t, '_blank'); },
    go(page, openForm) {
      this.close();
      window.showPage?.(page);
      if (openForm) setTimeout(() => window.toggleForm?.('add-inv-form', true), 140);
    },
    toRoster() { this.close(); window.CP?.setView?.('clients'); window.showPage?.('cp'); },
    async newRequest() {
      this.close();
      if (window.QuoteUI && QuoteUI.newRequestLink) await QuoteUI.newRequestLink();
      else window.showPage?.('devis');
    },
    editPortal(id) {
      this.close();
      window.showPage?.('portals');
      setTimeout(() => { if (id && window.portalEdit) portalEdit(id); else window.portalOpenForm?.(); }, 150);
    },
  };

  window.ClientWorkspace = ClientWorkspace;
  // Échap ferme le tiroir (le clic sur le fond aussi).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('cw-root')?.classList.contains('on')) ClientWorkspace.close();
  });
})();
