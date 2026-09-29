'use strict';
/**
 * cloud.js — Firebase (Auth Google + Firestore).
 * 100% défensif : si Firebase n'est pas configuré ou indisponible, Cloud.enabled reste
 * false et le Hub continue de fonctionner exactement comme avant (mode localStorage).
 * Aucune erreur ne doit jamais bloquer le dashboard.
 */
const Cloud = {
  enabled: false,
  _auth: null, _db: null, _user: null, _resolved: false, _cbs: [],

  init() {
    try {
      const cfg = window.FIREBASE_CONFIG;
      if (!cfg || !cfg.apiKey || String(cfg.apiKey).startsWith('TON_')) return; // placeholder → local
      if (typeof firebase === 'undefined' || !firebase.initializeApp) { console.warn('[cloud] SDK Firebase absent — mode local'); return; }
      firebase.initializeApp(cfg);
      this._auth = firebase.auth();
      this._db   = firebase.firestore();
      this.enabled = true;
      this._auth.onAuthStateChanged(u => {
        this._user = u; this._resolved = true;
        // mémorise l'uid dans la config du site → le mouchard analytics l'embarque au déploiement
        // ⚠ SiteConfig est un const → absent de window : le test window.SiteConfig
        // était toujours faux et ownerUid n'était JAMAIS enregistré (attribution
        // des statistiques cassée en silence).
        if (u) { try { if (typeof SiteConfig !== 'undefined') SiteConfig.set('ownerUid', u.uid); } catch (e) {} }
        this._cbs.forEach(cb => { try { cb(u); } catch (e) { console.error('[cloud] cb', e); } });
      });
    } catch (e) { console.error('[cloud] init', e); this.enabled = false; }
  },

  /** S'abonner à l'état de connexion ; rappelle immédiatement si déjà résolu */
  onAuth(cb) {
    this._cbs.push(cb);
    if (this._resolved) { try { cb(this._user); } catch (e) { console.error(e); } }
  },
  user() { return this._user || null; },

  async signInGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return this._auth.signInWithPopup(provider);
  },
  async signOut() { try { await this._auth.signOut(); } catch {} },

  /* ── Discord (via Cloudflare Worker qui fabrique un jeton Firebase) ── */
  discordReady() { return this.enabled && !!window.DISCORD_LOGIN_URL; },
  /** URL de login Discord + retour AUTOMATIQUE vers le site actuel (V2, local, domaine perso…) */
  discordLoginUrl() {
    const base = window.DISCORD_LOGIN_URL;
    if (!base) return '';
    let path = location.pathname;
    if (!/app(\.html)?$/.test(path)) path = path.replace(/[^/]*$/, '') + 'app.html'; // gère /app (Pages) et /app.html
    const here = location.origin + path;
    return base + (base.includes('?') ? '&' : '?') + 'return=' + encodeURIComponent(here);
  },
  startDiscord() {
    if (!this.discordReady()) return;
    // le Worker gère l'échange puis nous renvoie ICI avec #ct=<jeton>
    location.href = this.discordLoginUrl();
  },
  /** Au retour de Discord : #ct=<customToken> → connexion Firebase */
  async handleRedirectToken() {
    if (!this.enabled) return false;
    const m = location.hash.match(/[#&]ct=([^&]+)/);
    if (!m) return false;
    const token = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search); // nettoie l'URL
    try { await this._auth.signInWithCustomToken(token); return true; }
    catch (e) { console.error('[cloud] discord token', e); showToast?.('Connexion Discord échouée', '#c0392b', 3000); return false; }
  },

  // ── Profil utilisateur (users/{uid}) ──
  async loadProfile(uid) {
    const d = await this._db.collection('users').doc(uid).get();
    return d.exists ? d.data() : null;
  },
  async saveProfile(uid, data) {
    await this._db.collection('users').doc(uid).set(data, { merge: true });
  },
  /** true si le pseudo est libre (lecture publique de la collection users) */
  async pseudoAvailable(pseudo) {
    const q = await this._db.collection('users').where('pseudo', '==', pseudo).limit(1).get();
    return q.empty;
  },

  /* ══════════════════════════════════════════════════════
     SYNC — Firestore = source de vérité, localStorage = cache.
     Miroir des collections business (instantané, cross-appareil, sauvegardé).
  ══════════════════════════════════════════════════════ */
  /* Clé localStorage → nom de sous-collection Firestore.
     Construit à partir du registre unique (js/hub-data.js) : les 3 listes
     n'existent plus qu'une fois. Fallback conservé si le registre n'a pas
     été chargé (ordre de <script> modifié par erreur). */
  SYNC_KEYS: (typeof HubData !== 'undefined' ? HubData.syncMap() : {
    hub_clients: 'clients', hub_invoices: 'invoices', hub_catalog: 'catalog',
    hub_reviews: 'reviews', hub_links: 'links', hub_media: 'media', hub_portals: 'portals',
    hub_files: 'files',   // métadonnées des fichiers stockés sur GitHub (HubFiles)
    // Grille tarifaire — vit dans users/{uid}/data, donc PRIVÉE (règles Firestore).
    // Elle ne doit jamais atteindre une page vue par un client.
    hub_pricing: 'pricing',
  }),
  _pushTimers: {}, _mirroring: false, _origSet: null,

  /** Intercepte les écritures localStorage hub_* pour pousser vers Firestore (débouncé) */
  startMirror() {
    if (this._mirroring || !this.enabled) return;
    this._mirroring = true;
    this._origSet = localStorage.setItem.bind(localStorage);
    const self = this;
    try {
      localStorage.setItem = function (k, v) {
        self._origSet(k, v);
        if (!(self.enabled && self._user)) return;
        if (self.SYNC_KEYS[k]) self._schedulePush(k);
        else if (k === 'souanpt_site_cfg') self._scheduleConfigPush();
      };
    } catch (e) { console.warn('[sync] mirror', e); }
  },
  _scheduleConfigPush() {
    clearTimeout(this._pushTimers._cfg);
    this._pushTimers._cfg = setTimeout(() => {
      try { this.pushConfig(JSON.parse(localStorage.getItem('souanpt_site_cfg') || '{}')); } catch {}
    }, 1500);
  },
  _schedulePush(k) {
    clearTimeout(this._pushTimers[k]);
    this._pushTimers[k] = setTimeout(() => this._pushKey(k), 1200);
  },
  async _pushKey(k) {
    if (!this._user) return;
    const name = this.SYNC_KEYS[k]; if (!name) return;
    // Certaines clés sont des LISTES (clients, factures…), d'autres un OBJET de
    // réglages (grille tarifaire). Les deux doivent voyager, sinon la clé est
    // poussée mais jamais relue au login → perte silencieuse sur un 2e appareil.
    let items = null; try { items = JSON.parse(localStorage.getItem(k) || 'null'); } catch {}
    if (items === null) items = [];
    try {
      await this._db.collection('users').doc(this._user.uid).collection('data').doc(name)
        .set({ items, updatedAt: Date.now() });
    } catch (e) { console.warn('[sync] push ' + name, e); }
  },
  /** Tire les données du cloud vers le cache local (au login) ; renvoie true si qqch a changé */
  async syncPull() {
    if (!this._user) return false;
    const setRaw = this._origSet || localStorage.setItem.bind(localStorage);
    let changed = false;
    for (const [k, name] of Object.entries(this.SYNC_KEYS)) {
      try {
        const d = await this._db.collection('users').doc(this._user.uid).collection('data').doc(name).get();
        const it = d.exists ? d.data().items : undefined;
        if (Array.isArray(it) || (it && typeof it === 'object')) {
          setRaw(k, JSON.stringify(it));  // écrit sans re-déclencher un push
          changed = true;
        }
      } catch (e) { console.warn('[sync] pull ' + name, e); }
    }
    // Config du site (thème, etc.)
    try {
      const c = await this._db.collection('users').doc(this._user.uid).collection('data').doc('config').get();
      if (c.exists && c.data().cfg) { setRaw('souanpt_site_cfg', JSON.stringify(c.data().cfg)); changed = true; }
    } catch {}
    return changed;
  },
  async pushConfig(cfg) {
    if (!this._user) return;
    try { await this._db.collection('users').doc(this._user.uid).collection('data').doc('config').set({ cfg, updatedAt: Date.now() }); } catch {}
  },

  /* ── Analytics natif : lit les agrégats users/{uid}/analytics/* ──
     Alimentés par le mouchard des sites publiés (via le Worker souanpt-analytics).
     Retourne un objet normalisé, ou null si non connecté / rien encore. */
  async loadAnalytics(uid) {
    uid = uid || (this._user && this._user.uid);
    if (!this.enabled || !uid) return null;
    try {
      const col = this._db.collection('users').doc(uid).collection('analytics');
      // « referrers » a été retiré : plus affiché, plus collecté → une lecture
      // Firestore de moins à chaque rafraîchissement (quota gratuit Spark).
      const names = ['summary', 'daily', 'devices', 'countries', 'projects'];
      const snaps = await Promise.all(names.map(n => col.doc(n).get().catch(() => null)));
      const g = s => (s && s.exists ? s.data() : {}) || {};
      const [sum, daily, dev, co, pr] = snaps.map(g);
      return {
        summary: sum || {}, days: daily.days || {},
        devices: dev.map || {}, countries: co.map || {}, projects: pr.map || {},
      };
    } catch (e) { console.warn('[cloud] loadAnalytics', e); return null; }
  },

  /* ── Portails sur Firestore (lecture publique → instantané, sans 404) ── */
  async savePortalDoc(p) {
    if (!this._user) throw new Error('Non connecté');
    // P0 #2 — ce document est LISIBLE PAR TOUS (le lien du client n'a pas de
    // compte) et le miroir `allow read: if true` le rendait consultable avec
    // n'importe quelle clé Web publique. On n'y écrit donc JAMAIS le mot de
    // passe en clair : seulement son hachage itéré salé.
    // FieldValue.delete() efface l'éventuel `password` déposé par une version
    // antérieure — un set(..., {merge:true}) ne supprime jamais un champ.
    const gate = typeof portalGate === 'function' ? portalGate(p) : null;
    if ((p.password || p.passwordHash) && !gate) throw new Error('Hachage du mot de passe indisponible');
    const doc = {
      id: p.id, owner: this._user.uid,
      mission: p.mission || '', client: p.client || '',
      total: Number(p.total) || 0, acomptePct: Number(p.acomptePct) || 0,
      stepIndex: Number(p.stepIndex) || 0, paymentLink: p.paymentLink || '',
      note: p.note || '', deliverables: p.deliverables || [],
      // Pièces jointes = RÉFÉRENCES (id + url + méta), jamais le binaire.
      attachments: Array.isArray(p.attachments) ? p.attachments : [],
      password: firebase.firestore.FieldValue.delete(),
      passwordHash: gate ? gate.hash : '', passwordSalt: gate ? gate.salt : '',
      hashRounds: gate ? gate.rounds : 0,
      active: p.active !== false,
      siteName: p.siteName || '', accent: p.accent || '#C8FF00', theme: p.theme || '#060606',
      updatedAt: Date.now(),
    };
    await this._db.collection('portals').doc(p.id).set(doc, { merge: true });
    return doc;
  },
  async deletePortalDoc(id) {
    if (!this._user) return;
    try { await this._db.collection('portals').doc(id).delete(); } catch {}
  },

  /* ══════════════════════════════════════════════════════════════════
     P0 — purge des secrets déjà écrites en PUBLIC (à chaque connexion)
     ────────────────────────────────────────────────────────────────────
     · users/{uid}  → champ `email` retiré. Ce profil est lisible par tous
       (annuaire, API REST sans auth) : l'y laisser le rendait récupérable en
       deux requêtes. L'e-mail reste dans Auth Google et la page Compte le lit
       sur Cloud.user().email.
     · portals/{id} → un éventuel `password` en clair est remplacé par son
       hachage salé (document publié par une version antérieure).
     Idempotent : chaque objet nettoyé est marqué localement (secretScrubbedAt)
     puis plus rien n'est écrit au login suivant.
     → { cleaned, stale } : `stale` = portails dont la PAGE GitHub publiée
       (HTML public) date d'avant la correction et doit être republiée.
  ══════════════════════════════════════════════════════════════════ */
  async scrubPublicSecrets() {
    const out = { cleaned: 0, stale: 0 };
    if (!this.enabled || !this._user) return out;

    try {
      const ref = this._db.collection('users').doc(this._user.uid);
      const snap = await ref.get();
      if (snap.exists && snap.data().email) {
        await ref.set({ email: firebase.firestore.FieldValue.delete() }, { merge: true });
        out.cleaned++;
        console.info('[sécurité] e-mail retiré du profil public');
      }
    } catch (e) { console.warn('[sync] purge e-mail', e); }

    try {
      if (typeof portalGate !== 'function') return out;          // core.js absent
      const list = JSON.parse(localStorage.getItem('hub_portals') || '[]');
      if (!Array.isArray(list)) return out;
      const todo = list.filter(p => p && p.id && p.publishedAt && !p.secretScrubbedAt
                                && (p.password || p.passwordHash));
      if (!todo.length) return out;
      // Avant mutation : un portail sans hachage local est une donnée d'avant
      // la correction. Publié sur GitHub Pages → son HTML public embarque
      // encore le mot de passe en clair jusqu'à la prochaine publication.
      out.stale = todo.filter(p => !p.passwordHash && p.url
                                && String(p.url).includes('github.io')).length;
      for (const p of todo) {
        const g = portalGate(p);
        if (!g) continue;
        p.passwordSalt = g.salt; p.passwordHash = g.hash; p.hashRounds = g.rounds;
      }
      for (const p of todo) {
        try {
          await this._db.collection('portals').doc(p.id).set({
            owner: this._user.uid,
            password: firebase.firestore.FieldValue.delete(),
            passwordHash: p.passwordHash || '', passwordSalt: p.passwordSalt || '',
            hashRounds: p.hashRounds || 0,
            updatedAt: Date.now(),
          }, { merge: true });
          p.secretScrubbedAt = Date.now();
          out.cleaned++;
          console.info('[sécurité] mot de passe de portail haché : ' + p.id);
        } catch (e) { console.warn('[sync] purge portail ' + p.id, e); }
      }
      if (todo.some(p => p.secretScrubbedAt)) localStorage.setItem('hub_portals', JSON.stringify(list));
    } catch (e) { console.warn('[sync] purge portails', e); }
    return out;
  },
};

Cloud.init();
window.Cloud = Cloud;
