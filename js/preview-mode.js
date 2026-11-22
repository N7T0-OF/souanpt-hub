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
  /* Planches de démonstration pour la galerie déroulante (nouveauté 3.15.0) :
     dessinées sur un canvas, en JPEG — aucune image réelle n'est utilisée. */
  function demoSlides() {
    const slides = [
      { h: 760, a: '#C8FF00', b: '#1d2b00', t: 'Miniatures | 2026', s: 'Galerie déroulante — démonstration' },
      { h: 1100, a: '#8B5CF6', b: '#140a2e', t: 'Processus', s: 'Croquis → composition → rendu' },
      { h: 900, a: '#F97316', b: '#2a1100', t: 'Recherches couleur', s: 'Palette, contrastes, lisibilité' },
      { h: 1200, a: '#00D4FF', b: '#00222b', t: 'Rendu final', s: 'Format vignette 16:9' },
      { h: 700, a: '#C8FF00', b: '#060606', t: 'Merci !', s: 'Fais défiler : c’est la nouveauté' },
    ];
    try {
      return slides.map((sl, i) => {
        const c = document.createElement('canvas'); c.width = 1200; c.height = sl.h;
        const g = c.getContext('2d'); if (!g) return '';
        const grd = g.createLinearGradient(0, 0, 1200, sl.h); grd.addColorStop(0, sl.b); grd.addColorStop(1, '#060606');
        g.fillStyle = grd; g.fillRect(0, 0, 1200, sl.h);
        g.globalAlpha = .18; g.fillStyle = sl.a;
        for (let k = 0; k < 7; k++) { g.beginPath(); g.arc((k * 233 + i * 97) % 1200, (k * 171 + i * 59) % sl.h, 60 + k * 22, 0, 6.3); g.fill(); }
        g.globalAlpha = 1; g.fillStyle = sl.a; g.fillRect(90, sl.h / 2 - 120, 14, 200);
        g.fillStyle = '#ffffff'; g.font = 'bold 84px system-ui, sans-serif'; g.fillText(sl.t, 140, sl.h / 2 - 20);
        g.fillStyle = 'rgba(255,255,255,.72)'; g.font = '36px system-ui, sans-serif'; g.fillText(sl.s, 142, sl.h / 2 + 50);
        g.fillStyle = sl.a; g.font = 'bold 30px system-ui, sans-serif'; g.fillText(String(i + 1).padStart(2, '0') + ' / ' + slides.length, 1040, sl.h - 60);
        return c.toDataURL('image/jpeg', .82);
      }).filter(src => /^data:image\/jpeg;base64,/.test(src));
    } catch { return []; }
  }

  function demoData() {
    const gallery = demoSlides();
    return {
      hub_projects: [
        { id: 'demo-be', title: 'Miniatures | 2026', tags: ['miniatures', '3D'], url: 'https://www.behance.net/gallery/241392957/Miniatures-2026', behance: true, cover: gallery[0] || '', views: 214, createdAt: d0, preview: gallery.length ? { gallery } : {} },
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
      // Facturation de démonstration (3.20) : encaissées, en attente, en retard.
      hub_invoices: (() => { const t = Date.now(); return [
        { id: 'demo-i1', number: 'FA-2026-001', name: 'Identité visuelle — logo', client: 'Atelier Nova', price: 1200, status: 'paid', createdAt: t - 75 * day, dueAt: t - 45 * day, paidAt: t - 60 * day },
        { id: 'demo-i2', number: 'FA-2026-002', name: 'Pack 4 miniatures YouTube', client: 'Camille Martin', price: 320, status: 'paid', createdAt: t - 9 * day, dueAt: t + 21 * day, paidAt: t - 2 * day },
        { id: 'demo-i3', number: 'FA-2026-003', name: 'Charte graphique', client: 'Atelier Nova', price: 1200, status: 'acompte', createdAt: t - 5 * day, dueAt: t + 25 * day },
        { id: 'demo-i4', number: 'FA-2026-004', name: 'Bannière Twitch', client: 'Camille Martin', price: 180, status: 'pending', createdAt: t - 40 * day, dueAt: t - 10 * day },
      ]; })(),
      hub_expenses: (() => { const t = Date.now(); return [
        { id: 'demo-e1', label: 'Abonnement logiciel de retouche', amount: 26.99, category: 'Logiciels & abonnements', date: t - 3 * day },
        { id: 'demo-e2', label: 'Tablette graphique', amount: 189, category: 'Matériel', date: t - 50 * day },
      ]; })(),
      hub_business: { name: 'Souanpt (démo)', siret: '000 000 000 00000', address: '1 rue de la Démo\n69000 Lyon', email: 'demo@example.com', terms: 30, ceiling: 77700, b2b: true, seq: { 2026: 4 } },
      hub_estimates: [], hub_portals: [], hub_catalog: [], hub_links: [],
      hub_media: [], hub_files: [], hub_pricing: {}, hub_ws_runs: [],
      souanpt_site_cfg: {
        siteName: 'Portfolio démo', bio: 'Créatif · Designer · Motion', accentColor: '#C8FF00',
        theme: '#060606', layout: '3', heroText: 'Créatif · Designer · Motion', repo: '',
        behancePreview: { enabled: true, style: 'perspective' },
        // Nouveautés 3.18 : référencement + liaison haunt.gg (adresse fictive de démo).
        siteUrl: 'https://demo-souanpt.github.io/portfolio/', hauntUser: 'souanpt', hauntBack: 'always',
        seo: { jobTitle: 'Graphiste · Miniatures YouTube', city: 'Lyon' },
        // Nouveautés 3.16 : ambiance type haunt.gg, visible dès l'aperçu.
        ambiance: {
          enter: { on: true, text: 'cliquer pour entrer', sub: 'Aperçu des nouveautés' },
          particles: 'embers', density: 2, pColor: 'mix', cursor: 'ring',
          typewriter: { on: true, lines: ['Créatif · Designer · Motion', 'Miniatures YouTube', 'Identités visuelles'], speed: 2 },
          progress: true, grain: true, corner: { on: true, text: '📍 FR · disponible' },
        },
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
