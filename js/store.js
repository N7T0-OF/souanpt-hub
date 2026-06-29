/**
 * store.js — Local data store
 * Every user gets their own namespace: hub_<username>_<key>
 * Structure mirrors a private GitHub repo directory
 */
'use strict';

const Store = {
  _user: null,

  // ── Auth ──────────────────────────────────────────
  login(username) {
    this._user = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    localStorage.setItem('hub_current_user', this._user);
    // init structure if new user
    if (!this.get('profile')) {
      this.initNewUser(this._user);
    }
    return this._user;
  },

  logout() {
    localStorage.removeItem('hub_current_user');
    this._user = null;
    window.location.reload();
  },

  currentUser() {
    if (!this._user) this._user = localStorage.getItem('hub_current_user');
    return this._user;
  },

  isLoggedIn() {
    return !!this.currentUser();
  },

  // ── Namespace key ─────────────────────────────────
  _key(section) {
    return `hub_${this.currentUser()}_${section}`;
  },

  // ── Read / Write ──────────────────────────────────
  get(section) {
    try {
      const raw = localStorage.getItem(this._key(section));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  set(section, data) {
    try {
      localStorage.setItem(this._key(section), JSON.stringify(data));
      return true;
    } catch { return false; }
  },

  // ── Init new user ─────────────────────────────────
  initNewUser(username) {
    const now = Date.now();

    // profile
    this.set('profile', {
      username,
      displayName: username,
      bio: '',
      creatorCode: username.toUpperCase(),
      avatar: username[0].toUpperCase(),
      avatarColor: '#c9922a',
      level: 1,
      xp: 0,
      plan: 'free',
      createdAt: now,
    });

    // storage structure (mirrors private repo)
    this.set('storage', {
      used: 0, // bytes
      limit: 1073741824, // 1 GB free
      structure: {
        'sites/portfolio': [],
        'sites/links': [],
        'cv': [],
        'factures': [],
        'images': [],
        'videos': [],
        'outils': [],
        'avis': [],
        'analytics': [],
      }
    });

    // links
    this.set('links', []);

    // projects
    this.set('projects', []);

    // reviews
    this.set('reviews', []);

    // invoices
    this.set('invoices', []);

    // clients
    this.set('clients', []);

    // notifications
    this.set('notifications', [
      { id: 1, text: 'Bienvenue sur souanpt.hub ! 🎉', type: 'gold', time: now, read: false },
    ]);

    // analytics
    this.set('analytics', {
      totalViews: 0, uniqueVisitors: 0, clicks: 0, qrScans: 0,
      history: [],
      sources: { direct: 0, google: 0, discord: 0, github: 0, behance: 0, other: 0 },
      countries: {},
      devices: { mobile: 0, desktop: 0, tablet: 0 },
    });

    // settings
    this.set('settings', {
      behanceUsername: '',
      behanceConnected: false,
      githubRepo: '',
      kofiUsername: '',
      lang: 'fr',
      portfolioPublic: true,
      noindex: false,
      linksPublic: true,
      seoTitle: `${username} — Creator Hub`,
      seoDesc: `Portfolio et projets de ${username}.`,
      seoImage: '',
    });

    // cv
    this.set('cv', {
      versions: [],
      stats: { views: 0, downloads: 0, shares: 0 }
    });

    // xp log
    this.set('xp_log', []);

    // media
    this.set('media', []);
  },

  // ── Helpers ───────────────────────────────────────
  addNotification(text, type = 'gold') {
    const notifs = this.get('notifications') || [];
    notifs.unshift({ id: Date.now(), text, type, time: Date.now(), read: false });
    if (notifs.length > 50) notifs.length = 50;
    this.set('notifications', notifs);
  },

  addXPLog(action, xp) {
    const log = this.get('xp_log') || [];
    log.unshift({ action, xp, time: Date.now() });
    if (log.length > 100) log.length = 100;
    this.set('xp_log', log);
  },

  // ── Storage size simulation ────────────────────────
  addFile(folder, file) {
    const st = this.get('storage');
    if (!st.structure[folder]) st.structure[folder] = [];
    file.id = Date.now();
    file.uploadedAt = Date.now();
    st.structure[folder].push(file);
    st.used = (st.used || 0) + (file.size || 0);
    this.set('storage', st);
    return file;
  },

  // ── Export all user data (for backup) ─────────────
  exportAll() {
    const user = this.currentUser();
    const keys = ['profile','storage','links','projects','reviews','invoices',
                  'clients','notifications','analytics','settings','cv','xp_log','media'];
    const data = {};
    keys.forEach(k => { data[k] = this.get(k); });
    return JSON.stringify({ user, exportedAt: new Date().toISOString(), data }, null, 2);
  },

  importAll(jsonStr) {
    try {
      const { data } = JSON.parse(jsonStr);
      Object.entries(data).forEach(([k, v]) => this.set(k, v));
      return true;
    } catch { return false; }
  }
};

window.Store = Store;
