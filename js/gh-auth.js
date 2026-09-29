'use strict';
/**
 * gh-auth.js — T5 : se connecter à GitHub SANS rien garder dans le navigateur.
 *
 * Deux entrées, même résultat (une session RELAIS) :
 *
 *   1. DEVICE FLOW — l'utilisateur saisit un code à 8 caractères sur
 *      github.com/login/device. Aucune PAT à générer, à copier, à coller.
 *      Nécessite un relais configuré (GH_CLIENT_ID côté Cloudflare).
 *
 *   2. MIGRATION — pour les comptes qui ont déjà collé une PAT : le jeton part
 *      UNE fois vers le relais, y devient un cookie HttpOnly, et le localStorage
 *      est vidé. Après ça, plus aucun secret lisible en JS.
 *
 * Le relais est résolu par sondage (probe) : origine déclarée d'abord, origine
 * courante ensuite. Sans relais, ce module se tait et le hub reste exactement en
 * mode token (historique) : aucun changement de comportement.
 *
 * Ordre des scripts : core.js (GH, Auth) PUIS gh-auth.js.
 */

const GhSession = {
  base: null,        // origine du relais (null = non résolu)
  available: false,  // le relais répond
  configured: false, // device flow activé (GH_CLIENT_ID monté)
  user: null,        // profil déjà ouvert côté relais (cookie encore valide)
  onChange: null,    // rendu UI (posé par app.html)
  _probe: null,

  /* ─────────────── relais ─────────────── */

  /**
   * Ordre des origines à sonder, de la plus probable à la moins probable :
   *   1. base déjà mémorisée — c'est là que vit le cookie de session ;
   *   2. origine courante (hub servi par Cloudflare → relais sur le même site,
   *      cookie premier ordre, jamais bloqué) — sauf sur GitHub Pages qui
   *      n'exécute jamais de Functions ;
   *   3. origine déclarée (`window.GH_RELAY`, puis `GH_RELAY_DEFAULT`) ;
   *   4. variantes du nom de projet Cloudflare (le nom a changé entre les
   *      déploiements).
   * On s'arrête au premier relais qui répond : la page ne sonde donc que ce
   * qu'il faut, et une origine morte est abandonnée en 3 s maximum.
   */
  _candidates() {
    const out = [];
    const push = v => {
      if (!v || v === 'null') return;
      const s = String(v).replace(/\/+$/, '');
      if (s && out.indexOf(s) < 0) out.push(s);
    };
    let stored = null;
    try { stored = localStorage.getItem('souanpt_relay_base'); } catch {}
    if (stored && /^https?:\/\//.test(stored)) push(stored);
    try {
      if (location.origin && !/\.github\.io$/i.test(location.hostname)) push(location.origin);
    } catch {}
    try { push(window.GH_RELAY || (typeof GH_RELAY_DEFAULT !== 'undefined' ? GH_RELAY_DEFAULT : '')); } catch {}
    ['https://souanpt-hub.pages.dev', 'https://souanpthub.pages.dev',
     'https://souanptjub.pages.dev', 'https://souanpt-hub.fr'].forEach(push);
    return out;
  },

  /** Sonde silencieuse : « y a-t-il un relais, et une session encore valide ? ».
      Bornée à 7 s au total : un relais absent ne retarde jamais l'application. */
  probe() {
    if (this._probe) return this._probe;
    this._probe = (async () => {
      const deadline = Date.now() + 7000;
      for (const base of this._candidates()) {
        if (Date.now() > deadline) break;
        let d = null;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3000);
          const r = await fetch(base + '/api/auth?op=status', {
            credentials: 'include',
            headers: { accept: 'application/json' },
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (!r.ok) continue;
          d = await r.json();
        } catch { continue; }
        if (!d || d.relay !== true) continue;
        this.base = base;
        this.available = true;
        this.configured = !!d.configured;
        this.user = d.user || null;
        try { localStorage.setItem('souanpt_relay_base', base); } catch {}
        this._reconcile();
        this._emit();
        return this;
      }
      this.available = false;
      this.configured = false;
      this.user = null;
      this._emit();
      return this;
    })();
    return this._probe;
  },

  /** Alignement entre le cookie du relais et ce que le navigateur croit savoir. */
  _reconcile() {
    if (typeof Auth === 'undefined') return;
    if (Auth.isRelay()) {
      if (!this.user) {
        // Session relais encore présente localement mais le cookie a disparu :
        // les appels échoueraient un par un. Mieux vaut re-montrer la porte.
        Auth.clear();
        this._toast('Session GitHub expirée — reconnecte-toi', '#e4b24a');
      }
    } else if (!Auth.ok() && this.user) {
      // Cookie encore valide, localStorage vidé (nettoyage, autre onglet…) :
      // la session revient toute seule, sans nouveau code.
      Auth.setSession({ login: this.user.login, name: this.user.name || '', avatar_url: this.user.avatar_url || '' });
      this._toast('✓ Session GitHub restaurée (@' + this.user.login + ')', '#2e9a63');
    }
  },

  _emit() { try { if (typeof this.onChange === 'function') this.onChange(this); } catch {} },
  _toast(msg, color) {
    try { if (typeof showToast === 'function') showToast(msg, color, 3000); } catch {}
  },

  async _post(op, body) {
    if (!this.base) await this.probe();
    if (!this.base) throw new Error('Relais GitHub injoignable — utilise un token (mode avancé)');
    const r = await fetch(this.base + '/api/auth?op=' + op, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.error || ('Relais (HTTP ' + r.status + ')'));
      e.status = r.status; e.code = d.code;
      throw e;
    }
    return d;
  },

  /* ─────────────── device flow ─────────────── */

  /**
   * Ouvre une session par code GitHub. `onStep` reçoit les étapes :
   *   { phase:'code',    user_code, uri, expires }  → afficher le code
   *   { phase:'pending', attempt }                  → en attente de validation
   * @returns {Promise<object>} le profil utilisateur
   */
  async deviceFlow(onStep) {
    await this.probe();
    if (!this.available) throw new Error('Relais GitHub indisponible — utilise un token (mode avancé)');
    let dev;
    try {
      dev = await this._post('device', {});
    } catch (e) {
      // 501 = relais sans GH_CLIENT_ID ; device_flow_disabled = app GitHub mal réglée.
      if (e.status === 501 || e.code === 'device_flow_disabled') {
        throw new Error('Connexion 1 clic non activée : monte GH_CLIENT_ID sur le relais Cloudflare');
      }
      throw e;
    }
    if (!dev.configured) {
      throw new Error('Connexion 1 clic non activée : monte GH_CLIENT_ID sur le relais Cloudflare');
    }
    onStep?.({ phase: 'code', user_code: dev.user_code, uri: dev.verification_uri, expires: Date.now() + (dev.expires_in || 900) * 1000 });

    let interval = (dev.interval || 5) * 1000;
    const deadline = Date.now() + (dev.expires_in || 900) * 1000;
    let attempt = 0, misses = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      let d;
      try {
        d = await this._post('poll', { device_code: dev.device_code });
        misses = 0;
      } catch (e) {
        // Panne transitoire du relais : on réessaie. Les erreurs métier (code
        // expiré, refus) arrivent en 4xx avec `code` → on sort tout de suite.
        if (e.status && e.status >= 400 && e.status < 500) throw e;
        if (++misses >= 5) throw e;
        continue;
      }
      if (d.pending) {
        interval = (d.interval || 5) * 1000;
        onStep?.({ phase: 'pending', attempt: ++attempt });
        continue;
      }
      if (d.user) {
        const user = await connectGitHubRelay(d.user, this.base);
        this.user = d.user;
        this._emit();
        return user;
      }
      throw new Error(d.error || 'Réponse inattendue du relais');
    }
    throw new Error('Code expiré — relance la connexion');
  },

  /* ─────────────── migration d'une PAT ─────────────── */

  /**
   * Vide le navigateur : la PAT existante est envoyée au relais, vérifiée, puis
   * remplacée par un cookie HttpOnly. Échec = on ne touche RIEN (le token local
   * reste en place, la connexion continue de marcher).
   * @returns {Promise<object>} le profil
   */
  async migrate() {
    const token = typeof Auth !== 'undefined' ? Auth.token() : '';
    if (!token) throw new Error('Aucun token local à sécuriser');
    const d = await this._post('import', { token });
    if (!d || !d.user) throw new Error('Le relais a refusé ce token');
    const u = { login: d.user.login, name: d.user.name || '', avatar_url: d.user.avatar_url || '' };
    // `save` écrase { token } en entier : le jeton disparaît du localStorage.
    Auth.setSession(u);
    this.user = d.user;
    this.available = true;
    this._emit();
    return u;
  },

  /** Déconnexion : referme le cookie ET la session locale. */
  async logout() {
    this.user = null;
    try {
      if (this.base) await fetch(this.base + '/api/auth?op=logout', { method: 'POST', credentials: 'include' });
    } catch {}
  },
};

window.GhSession = GhSession;

/* Sondage au démarrage : silencieux, sans jamais bloquer l'application. */
(function () {
  if (typeof document === 'undefined') return;
  const go = () => { try { GhSession.probe(); } catch {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
