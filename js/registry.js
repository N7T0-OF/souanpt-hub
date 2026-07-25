/* ══════════════════════════════════════════════════════════════════════════
   Registry — registre central des liens publics  (collection `public_links`)

   POURQUOI. Aujourd'hui un projet client vit dans TROIS collections successives
   qui partagent le MÊME jeton : requests/<T> → estimates/<T> → portals/<T>. Le
   jeton est donc déjà « canonique » de fait, mais rien ne le recense : impossible
   de lister tous les projets d'un créateur, de connaître leur étape, ni de gérer
   leur cycle de vie (actif / archivé / corbeille).

   `public_links/<T>` comble ce manque : UN document par projet, dont l'id EST le
   jeton canonique. C'est la source de vérité que la future section « Clients &
   Projets » parcourt, et le point d'ancrage du cycle de vie (Terminer, archiver,
   corbeille, suppression, détection des liens fantômes).

   RÈGLES. Lisible publiquement (le résolveur /c/<token>, sans compte, peut y lire
   l'étape et le statut), écrit UNIQUEMENT par le propriétaire (champ `owner`).
   On n'y met QUE des champs déjà publics ailleurs (nom du projet, client, total) —
   jamais de prix plancher, de note interne ni d'URL de stockage privée.

   INVARIANTS. L'étape ne régresse jamais (request < estimate < mission < done) ;
   createdAt est préservé ; toutes les écritures sont idempotentes et silencieuses
   hors-ligne (dégradation douce, jamais d'exception qui remonte).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  // Ordre de progression d'un projet. Le rang sert à ne jamais rétrograder.
  const STAGES = ['request', 'estimate', 'mission', 'done'];
  // Cycle de vie. `active` par défaut ; la corbeille est LOGIQUE (statut), pas
  // une suppression — la suppression réelle (deleteWorkspace) viendra ensuite.
  const STATUSES = ['active', 'inactive', 'archived', 'trashed'];

  const Registry = {
    COL: 'public_links',
    STAGES, STATUSES,
    _synced: false,

    _ok()  { return !!(window.Cloud && Cloud.enabled && Cloud.user() && Cloud._db); },
    _uid() { return Cloud.user().uid; },
    _rank(stage) { const i = STAGES.indexOf(stage); return i < 0 ? 0 : i; },

    /* Enregistre OU fait progresser le lien canonique d'un projet.
       - idempotent : rappelé avec la même étape, ne change rien d'essentiel ;
       - monotone   : conserve toujours l'étape la plus avancée ;
       - conservateur : ne remplace un champ d'affichage que si une valeur non
         vide est fournie, et préserve createdAt / status existants.
       Renvoie le document écrit, ou null si hors-ligne / erreur. */
    async register(token, patch) {
      if (!this._ok() || !token) return null;
      patch = patch || {};
      const ref = Cloud._db.collection(this.COL).doc(token), now = Date.now();
      try {
        const snap = await ref.get();
        const cur = snap.exists ? snap.data() : null;
        // Étape : la plus avancée entre l'existante et celle demandée.
        let stage = patch.stage || (cur && cur.stage) || 'request';
        if (cur && cur.stage && this._rank(cur.stage) > this._rank(stage)) stage = cur.stage;
        const keep = (k, def) => (patch[k] != null && patch[k] !== '') ? patch[k]
                                : (cur && cur[k] != null ? cur[k] : def);
        const data = {
          token, owner: this._uid(), workspaceId: token, stage,
          status:      (cur && cur.status) || 'active',
          clientName:  keep('clientName', ''),
          projectName: keep('projectName', ''),
          total:       keep('total', 0),
          currency:    keep('currency', '€'),
          createdAt:   (cur && cur.createdAt) || now,
          updatedAt:   now,
        };
        await ref.set(data, { merge: true });
        return data;
      } catch (e) { console.warn('[registry] register', token, e); return null; }
    },

    /* Change le statut de cycle de vie (active / inactive / archived / trashed). */
    async setStatus(token, status) {
      if (!this._ok() || !token || !STATUSES.includes(status)) return false;
      try {
        await Cloud._db.collection(this.COL).doc(token)
          .set({ status, updatedAt: Date.now() }, { merge: true });
        return true;
      } catch (e) { console.warn('[registry] setStatus', e); return false; }
    },

    async get(token) {
      if (!this._ok() || !token) return null;
      try { const d = await Cloud._db.collection(this.COL).doc(token).get();
            return d.exists ? { token: d.id, ...d.data() } : null; }
      catch (e) { return null; }
    },

    /* Tous les liens du créateur, plus récemment actifs d'abord.
       Par défaut la corbeille est exclue (opts.includeTrashed pour l'inclure). */
    async list(opts) {
      opts = opts || {};
      if (!this._ok()) return [];
      try {
        const snap = await Cloud._db.collection(this.COL)
          .where('owner', '==', this._uid()).limit(300).get();
        let out = []; snap.forEach(d => out.push({ token: d.id, ...d.data() }));
        if (!opts.includeTrashed) out = out.filter(l => l.status !== 'trashed');
        return out.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      } catch (e) { console.warn('[registry] list', e); return []; }
    },

    /* Backfill : reconstruit public_links à partir des collections existantes
       (requests / estimates / portals) pour les projets créés AVANT le registre.
       Silencieux, idempotent, une seule fois par session. N'écrit QUE ce qui
       manque ou dont l'étape a avancé — pour ménager le quota Firestore (Spark). */
    async sync(force) {
      if (!this._ok()) return;
      if (this._synced && !force) return;
      this._synced = true;
      const db = Cloud._db, uid = this._uid();
      const empty = { forEach() {} };
      const merged = new Map();   // token → {stage, clientName, projectName, total, currency, createdAt}
      const bump = (token, stage, fields, createdAt) => {
        if (!token) return;
        const cur = merged.get(token) || { stage: 'request' };
        if (this._rank(stage) >= this._rank(cur.stage)) cur.stage = stage;
        for (const k in fields) if (fields[k] != null && fields[k] !== '' && !cur[k]) cur[k] = fields[k];
        if (createdAt && (!cur.createdAt || createdAt < cur.createdAt)) cur.createdAt = createdAt;
        merged.set(token, cur);
      };
      try {
        const [rq, es, po] = await Promise.all([
          db.collection('requests').where('owner', '==', uid).limit(300).get().catch(() => empty),
          db.collection('estimates').where('owner', '==', uid).limit(300).get().catch(() => empty),
          db.collection('portals').where('owner', '==', uid).limit(300).get().catch(() => empty),
        ]);
        rq.forEach(d => { const v = d.data();
          bump(d.id, 'request', { clientName: (v.contact && (v.contact.name || v.contact.email)) || '',
                                  projectName: v.service || v.description || '' }, v.createdAt); });
        es.forEach(d => { const v = d.data();
          bump(d.id, 'estimate', { projectName: v.projectName || v.title || '',
                                   total: v.total, currency: v.currency }, v.createdAt); });
        po.forEach(d => { const v = d.data();
          bump(d.id, 'mission', { clientName: v.client || '', projectName: v.mission || '',
                                  total: v.total }, v.createdAt); });
      } catch (e) { console.warn('[registry] sync scan', e); return; }
      if (!merged.size) return;
      // Ce qui est déjà enregistré (une seule lecture groupée, pas un get par jeton).
      const existing = new Map();
      try { const snap = await db.collection(this.COL).where('owner', '==', uid).limit(300).get();
            snap.forEach(d => existing.set(d.id, d.data())); } catch (e) {}
      const now = Date.now(), writes = [];
      for (const [token, m] of merged) {
        const ex = existing.get(token);
        // À (ré)écrire seulement si absent ou si l'étape a progressé.
        if (ex && this._rank(m.stage) <= this._rank(ex.stage || 'request')) continue;
        const data = {
          token, owner: uid, workspaceId: token, stage: m.stage,
          status:      (ex && ex.status) || 'active',
          clientName:  (ex && ex.clientName)  || m.clientName  || '',
          projectName: (ex && ex.projectName) || m.projectName || '',
          total:       (ex && ex.total != null ? ex.total : (m.total != null ? m.total : 0)),
          currency:    (ex && ex.currency) || m.currency || '€',
          createdAt:   (ex && ex.createdAt) || m.createdAt || now,
          updatedAt:   now,
        };
        writes.push(db.collection(this.COL).doc(token).set(data, { merge: true }).catch(() => {}));
      }
      if (writes.length) {
        try { await Promise.all(writes); } catch (e) {}
        console.log('[registry] backfill —', writes.length, 'lien(s) recensé(s)');
      }
    },
  };

  window.Registry = Registry;
})();
