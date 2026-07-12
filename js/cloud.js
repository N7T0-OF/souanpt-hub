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
        if (u) { try { window.SiteConfig && SiteConfig.set('ownerUid', u.uid); } catch (e) {} }
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
  SYNC_KEYS: {                    // clé localStorage → nom de collection Firestore
    hub_clients: 'clients', hub_invoices: 'invoices', hub_catalog: 'catalog',
    hub_reviews: 'reviews', hub_links: 'links', hub_media: 'media', hub_portals: 'portals',
  },
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
    let items = []; try { items = JSON.parse(localStorage.getItem(k) || '[]'); } catch {}
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
        if (d.exists && Array.isArray(d.data().items)) {
          setRaw(k, JSON.stringify(d.data().items));  // écrit sans re-déclencher un push
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
      const names = ['summary', 'daily', 'referrers', 'devices', 'countries', 'projects'];
      const snaps = await Promise.all(names.map(n => col.doc(n).get().catch(() => null)));
      const g = s => (s && s.exists ? s.data() : {}) || {};
      const [sum, daily, ref, dev, co, pr] = snaps.map(g);
      return {
        summary: sum || {}, days: daily.days || {}, referrers: ref.map || {},
        devices: dev.map || {}, countries: co.map || {}, projects: pr.map || {},
      };
    } catch (e) { console.warn('[cloud] loadAnalytics', e); return null; }
  },

  /* ── Portails sur Firestore (lecture publique → instantané, sans 404) ── */
  async savePortalDoc(p) {
    if (!this._user) throw new Error('Non connecté');
    const doc = {
      id: p.id, owner: this._user.uid,
      mission: p.mission || '', client: p.client || '',
      total: Number(p.total) || 0, acomptePct: Number(p.acomptePct) || 0,
      stepIndex: Number(p.stepIndex) || 0, paymentLink: p.paymentLink || '',
      note: p.note || '', deliverables: p.deliverables || [],
      password: p.password || '', active: p.active !== false,
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
};

Cloud.init();
window.Cloud = Cloud;
