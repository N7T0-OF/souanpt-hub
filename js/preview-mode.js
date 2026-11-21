'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   HubPreview — aperçu local du tableau de bord, SANS connexion.

   But : le propriétaire tape un code et voit les nouveautés tout de suite, sur
   n'importe quel site (y compris souanptjub.pages.dev), sans se connecter.

   Ce N'EST PAS un accès administrateur à de vraies données :
     · le localStorage est remplacé par une mémoire volatile garnie de données
       FICTIVES (rien de réel n'est lu, rien n'est écrit sur le vrai stockage) ;
     · Firebase est neutralisé (FIREBASE_CONFIG forcé à null) : aucune session,
       aucune lecture Firestore ;
     · tout appel réseau de l'app vers un AUTRE domaine est bloqué (fetch, XHR,
       sendBeacon) — l'intégration Behance (iframe) reste permise pour la démo ;
     · rien n'est publié.

   ⚠ Le code n'est PAS un secret : ce site est statique, son JavaScript est
   lisible par tous, et le mode aperçu n'expose de toute façon que des données
   de démonstration. Le code sert seulement à ne pas afficher l'entrée aux
   visiteurs ordinaires. La sécurité des vraies données vient des règles
   Firestore (liées au compte connecté), pas de ce code.

   Chargé AVANT firebase/cloud/core : l'échange du localStorage et la
   neutralisation de Firebase doivent précéder toute lecture par l'app, d'où
   un contrôle de code SYNCHRONE (hash cyrb53, non cryptographique — suffisant
   puisque ce n'est pas une barrière de sécurité) et l'entrée par l'URL
   `?apercu=<code>` suivie d'un rechargement.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const PARAM = 'apercu';
  const CODE_KEY = 'souanpt_preview_code';        // hash d'un code personnalisé (facultatif)
  const DEFAULT_CODE_HASH = '56edf72d6b57c';      // cyrb53('souanpt-apercu')

  /* Hash 53 bits synchrone (cyrb53). Non cryptographique : ne protège rien,
     il évite seulement d'écrire le code en clair dans la source. */
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  /** Lecture du VRAI localStorage (avant l'échange) pour un code personnalisé. */
  function expectedHash() {
    try { return localStorage.getItem(CODE_KEY) || DEFAULT_CODE_HASH; } catch { return DEFAULT_CODE_HASH; }
  }
  function codeOk(code) { return !!code && cyrb53(String(code)) === expectedHash(); }

  const d0 = 1795000000000;   // dates relatives fixes (démo déterministe)
  const day = 86400000;
  function demoData() {
    return {
      hub_projects: [
        { id: 'demo-be', title: 'Miniatures | 2026', tags: ['miniatures', '3D'], url: 'https://www.behance.net/gallery/241392957/Miniatures-2026', behance: true, cover: '', views: 214, createdAt: d0 },
        { id: 'demo-p2', title: 'Identité — Atelier Nova', tags: ['branding', 'logo'], url: 'https://example.com', cover: '', views: 128, createdAt: d0 - 3 * day },
        { id: 'demo-p3', title: 'Kit réseaux sociaux', tags: ['social', 'motion'], url: 'https://example.org', cover: '', views: 76, createdAt: d0 - 6 * day },
      ],
      hub_clients: [
        { id: 'demo-c1', name: 'Atelier Nova', type: 'Studio indépendant', status: 'active', progress: 65, revenue: 2400, createdAt: d0 },
        { id: 'demo-c2', name: 'Camille Martin', type: 'Créatrice', status: 'active', progress: 30, revenue: 850, createdAt: d0 - 4 * day },
      ],
      hub_workspaces: [
        { token: 'demo-ws1', clientName: 'Atelier Nova', projectName: 'Identité visuelle', total: 2400, currency: '€', stage: 'mission', status: 'active', createdAt: d0, updatedAt: d0, refs: {} },
        { token: 'demo-ws2', clientName: 'Camille Martin', projectName: 'Miniatures vidéo', total: 850, currency: '€', stage: 'estimate', status: 'active', createdAt: d0 - 4 * day, updatedAt: d0 - 2 * day, refs: {} },
      ],
      hub_reviews: [
        { id: 'demo-r1', author: 'Camille Martin', text: 'Très belle collaboration, le rendu correspond parfaitement à mon univers.', rating: 5, status: 'approved', project: 'Miniatures vidéo', source: 'manual', createdAt: d0 },
        { id: 'demo-r2', author: 'Atelier Nova', text: 'Communication fluide et livraison soignée.', rating: 5, status: 'pending', source: 'manual', createdAt: d0 - 3 * day },
      ],
      hub_invoices: [], hub_estimates: [], hub_portals: [], hub_catalog: [], hub_links: [],
      hub_media: [], hub_files: [], hub_pricing: {}, hub_ws_runs: [],
      souanpt_site_cfg: {
        siteName: 'Portfolio démo', bio: 'Créatif · Designer · Motion', accentColor: '#C8FF00',
        theme: '#060606', layout: '3', heroText: 'Créatif · Designer · Motion', repo: '',
        behancePreview: { enabled: true, style: 'perspective' },
      },
    };
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function activate() {
    // 1. localStorage volatile garni de données fictives.
    const memory = new Map(Object.entries(demoData()).map(([k, v]) => [k, JSON.stringify(v)]));
    const store = {
      get length() { return memory.size; },
      key(i) { return [...memory.keys()][i] ?? null; },
      getItem(k) { k = String(k); return memory.has(k) ? memory.get(k) : null; },
      setItem(k, v) { memory.set(String(k), String(v)); },
      removeItem(k) { memory.delete(String(k)); },
      clear() { memory.clear(); },
    };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
      if (window.localStorage !== store) return false;
    } catch { return false; }

    // 2. Firebase neutralisé : l'affectation de firebase/firebase-config.js
    //    (exécuté après ce script) est ignorée.
    try { Object.defineProperty(window, 'FIREBASE_CONFIG', { configurable: true, get() { return null; }, set() {} }); } catch {}
    window.DISCORD_LOGIN_URL = '';
    window.HUB_PREVIEW_MODE = true;

    // 3. Aucune requête de l'app vers un autre domaine (l'iframe Behance, qui
    //    n'est pas un fetch, reste permise pour la démonstration).
    const blocked = () => Promise.reject(new Error('Réseau externe désactivé dans l’aperçu.'));
    if (nativeFetch) window.fetch = function (input) {
      let u; try { u = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return blocked(); }
      return u.origin === location.origin ? nativeFetch.apply(this, arguments) : blocked();
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (new URL(url, location.href).origin !== location.origin) throw new DOMException('Réseau externe désactivé dans l’aperçu.', 'NetworkError');
      return open.apply(this, arguments);
    };
    if (navigator.sendBeacon) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => (new URL(url, location.href).origin === location.origin) && beacon(url, data);
    }

    document.documentElement.classList.add('hub-preview');
    return true;
  }

  // Entrée par l'URL : ?apercu=<code> valide → bac à sable, puis l'URL est
  // nettoyée (le code ne reste pas dans la barre d'adresse ni l'historique).
  let active = false;
  try {
    const code = new URLSearchParams(location.search).get(PARAM);
    if (code !== null) {
      if (codeOk(code)) { active = activate(); }
      const url = new URL(location.href);
      url.searchParams.delete(PARAM);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch {}

  window.HubPreview = {
    sandbox: active,
    check(code) { return codeOk(code); },
    /** Code valide → recharge en mode aperçu. Retourne false si le code est faux. */
    enter(code) {
      if (!codeOk(code)) return false;
      const url = new URL(location.href);
      url.searchParams.set(PARAM, String(code));
      location.assign(url.href);
      return true;
    },
    exit() {
      const url = new URL(location.href);
      url.searchParams.delete(PARAM);
      url.hash = '';
      location.assign(url.href);
    },
    /** Change le code (hash stocké sur CET appareil). '' rétablit le code par défaut. */
    setCode(code) {
      try {
        if (code) localStorage.setItem(CODE_KEY, cyrb53(String(code)));
        else localStorage.removeItem(CODE_KEY);
        return true;
      } catch { return false; }
    },
  };
})();
