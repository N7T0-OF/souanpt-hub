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
  startDiscord() {
    if (!this.discordReady()) return;
    // le Worker gère l'échange puis nous renvoie avec #ct=<jeton>
    location.href = window.DISCORD_LOGIN_URL;
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
};

Cloud.init();
window.Cloud = Cloud;
