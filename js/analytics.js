'use strict';
/**
 * analytics.js — Statistiques natives intégrées à « Vue d'ensemble »
 * (Firebase Spark, sans service tiers). Lit users/{uid}/analytics/* et rend :
 * cartes vues/visiteurs, graphe SVG, pays (drapeaux), projets populaires,
 * sources, appareils. Drapeaux : SVG intégrés (rendu identique Windows/Mac/Linux/
 * Android/iOS) avec repli emoji ou pastille code — jamais de carré vide.
 */

/* ══ Drapeaux ══ */
function emojiFlag(cc) {
  return String(cc || '').toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
let _flagEmojiOK = null;
function supportsFlagEmoji() {
  if (_flagEmojiOK !== null) return _flagEmojiOK;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
    ctx.font = '16px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
    ctx.fillText(emojiFlag('GB'), -2, 0); // drapeau GB = rouge/bleu ; sur Windows = lettres noires "GB"
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let colored = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 40 || Math.abs(d[i + 1] - d[i + 2]) > 40 || Math.abs(d[i] - d[i + 2]) > 40)) { colored = true; break; }
    }
    _flagEmojiOK = colored;
  } catch (e) { _flagEmojiOK = false; }
  return _flagEmojiOK;
}
const _fV  = (a, b, c) => `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="2" fill="${b}"/><rect width="1" height="2" fill="${a}"/><rect x="2" width="1" height="2" fill="${c}"/></svg>`;
const _fH  = (a, b, c) => `<svg viewBox="0 0 3 3" preserveAspectRatio="none"><rect width="3" height="3" fill="${b}"/><rect width="3" height="1" fill="${a}"/><rect y="2" width="3" height="1" fill="${c}"/></svg>`;
const _fH2 = (a, b)    => `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="1" fill="${a}"/><rect y="1" width="3" height="1" fill="${b}"/></svg>`;
function _fUS() {
  let s = ''; for (let i = 0; i < 13; i++) s += `<rect y="${(i * 20 / 13).toFixed(2)}" width="38" height="${(20 / 13).toFixed(2)}" fill="${i % 2 ? '#fff' : '#B22234'}"/>`;
  let st = ''; for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) st += `<circle cx="${(1.6 + c * 2.9).toFixed(1)}" cy="${(1.4 + r * 2).toFixed(1)}" r="0.5" fill="#fff"/>`;
  return `<svg viewBox="0 0 38 20" preserveAspectRatio="none"><rect width="38" height="20" fill="#fff"/>${s}<rect width="15.2" height="10.77" fill="#3C3B6E"/>${st}</svg>`;
}
const FLAG_SVG = {
  FR: _fV('#0055A4', '#fff', '#EF4135'), BE: _fV('#000', '#FFD90C', '#F31830'), IT: _fV('#009246', '#fff', '#CE2B37'),
  IE: _fV('#169B62', '#fff', '#FF883E'), RO: _fV('#002B7F', '#FCD116', '#CE1126'), CI: _fV('#F77F00', '#fff', '#009E60'),
  DE: _fH('#000', '#D00', '#FFCE00'), NL: _fH('#AE1C28', '#fff', '#21468B'), LU: _fH('#ED2939', '#fff', '#00A1DE'),
  RU: _fH('#fff', '#0039A6', '#D52B1E'), AT: _fH('#ED2939', '#fff', '#ED2939'),
  PL: _fH2('#fff', '#DC143C'), UA: _fH2('#0057B7', '#FFD700'), MC: _fH2('#CE1126', '#fff'),
  ES: `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/></svg>`,
  PT: `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="2" fill="#DA291C"/><rect width="1.2" height="2" fill="#046A38"/><circle cx="1.2" cy="1" r="0.3" fill="#FFE900" stroke="#fff" stroke-width="0.05"/></svg>`,
  CH: `<svg viewBox="0 0 20 20" preserveAspectRatio="none"><rect width="20" height="20" fill="#D52B1E"/><rect x="8" y="4" width="4" height="12" fill="#fff"/><rect x="4" y="8" width="12" height="4" fill="#fff"/></svg>`,
  JP: `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r="0.6" fill="#BC002D"/></svg>`,
  SE: `<svg viewBox="0 0 16 10" preserveAspectRatio="none"><rect width="16" height="10" fill="#006AA7"/><rect x="5" width="2" height="10" fill="#FECC00"/><rect y="4" width="16" height="2" fill="#FECC00"/></svg>`,
  FI: `<svg viewBox="0 0 18 11" preserveAspectRatio="none"><rect width="18" height="11" fill="#fff"/><rect x="5" width="3" height="11" fill="#003580"/><rect y="4" width="18" height="3" fill="#003580"/></svg>`,
  NO: `<svg viewBox="0 0 22 16" preserveAspectRatio="none"><rect width="22" height="16" fill="#BA0C2F"/><rect x="6" width="4" height="16" fill="#fff"/><rect y="6" width="22" height="4" fill="#fff"/><rect x="7" width="2" height="16" fill="#00205B"/><rect y="7" width="22" height="2" fill="#00205B"/></svg>`,
  DK: `<svg viewBox="0 0 20 15" preserveAspectRatio="none"><rect width="20" height="15" fill="#C8102E"/><rect x="6" width="2" height="15" fill="#fff"/><rect y="6.5" width="20" height="2" fill="#fff"/></svg>`,
  GB: `<svg viewBox="0 0 60 30" preserveAspectRatio="none"><rect width="60" height="30" fill="#012169"/><path d="M0,0 60,30 M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30" stroke="#C8102E" stroke-width="2.5"/><path d="M60,0 0,30" stroke="#C8102E" stroke-width="2.5"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg>`,
  US: _fUS(),
  MA: `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="3" height="2" fill="#C1272D"/><polygon points="1.5,0.5 1.612,0.845 1.975,0.845 1.681,1.059 1.794,1.404 1.5,1.191 1.206,1.404 1.319,1.059 1.025,0.845 1.388,0.845" fill="none" stroke="#006233" stroke-width="0.09"/></svg>`,
  SN: `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="1" height="2" fill="#00853F"/><rect x="1" width="1" height="2" fill="#FDEF42"/><rect x="2" width="1" height="2" fill="#E31B23"/><polygon points="1.5,0.6 1.59,0.876 1.88,0.876 1.645,1.047 1.735,1.323 1.5,1.152 1.265,1.323 1.355,1.047 1.12,0.876 1.41,0.876" fill="#00853F"/></svg>`,
};
const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', CA: 'Canada', LU: 'Luxembourg', MC: 'Monaco', US: 'États-Unis',
  GB: 'Royaume-Uni', DE: 'Allemagne', ES: 'Espagne', IT: 'Italie', NL: 'Pays-Bas', PT: 'Portugal', IE: 'Irlande',
  AT: 'Autriche', PL: 'Pologne', UA: 'Ukraine', RU: 'Russie', RO: 'Roumanie', MA: 'Maroc', DZ: 'Algérie',
  TN: 'Tunisie', SN: 'Sénégal', CI: "Côte d'Ivoire", JP: 'Japon', CN: 'Chine', BR: 'Brésil', IN: 'Inde',
  AU: 'Australie', SE: 'Suède', FI: 'Finlande', NO: 'Norvège', DK: 'Danemark', GR: 'Grèce', TR: 'Turquie',
  MX: 'Mexique', AR: 'Argentine', ZA: 'Afrique du Sud', EG: 'Égypte', KR: 'Corée du Sud', TH: 'Thaïlande',
  VN: 'Vietnam', ID: 'Indonésie', PH: 'Philippines', NZ: 'Nouvelle-Zélande', CM: 'Cameroun', LB: 'Liban',
  IL: 'Israël', AE: 'Émirats A. U.', SA: 'Arabie saoudite', CD: 'RD Congo',
};
const NAME_TO_CC = (() => { const m = {}; for (const cc in COUNTRY_NAMES) m[COUNTRY_NAMES[cc].toLowerCase()] = cc; m['usa'] = 'US'; m['etats-unis'] = 'US'; m['uk'] = 'GB'; m['angleterre'] = 'GB'; return m; })();

const Analytics = {
  data: null, demo: false, _loaded: false,
  _lastSync: 0, _live: null, _tick: null,

  async refresh() {
    if (this.demo) { this.render(); return; }
    let d = null;
    try { d = await (window.Cloud && Cloud.loadAnalytics ? Cloud.loadAnalytics() : null); }
    catch (e) { console.warn('[analytics]', e); }
    this.data = d; this._loaded = true;
    this._lastSync = Date.now();
    this.render();
    this._syncLabel();
  },

  /* ══ Mise à jour automatique (plus de bouton « Actualiser ») ══
     Sondage UNIQUEMENT si l'onglet est visible ET qu'on est sur Vue d'ensemble :
     chaque rafraîchissement = ~6 lectures Firestore, il faut ménager le quota
     gratuit (Spark). Retour sur l'onglet → rafraîchissement immédiat. */
  _onOverview() { return !!document.getElementById('page-overview')?.classList.contains('active'); },
  startLive() {
    this.stopLive();
    this._live = setInterval(() => {
      if (document.hidden || !this._onOverview() || this.demo) return;
      this.refresh();
    }, 60000);
    this._tick = setInterval(() => this._syncLabel(), 5000);
    document.addEventListener('visibilitychange', this._onVis = () => {
      if (!document.hidden && this._onOverview() && !this.demo) this.refresh();
      else this._syncLabel();
    });
  },
  stopLive() {
    clearInterval(this._live); clearInterval(this._tick);
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
  },
  _syncLabel() {
    const e = document.getElementById('an-sync'); if (!e) return;
    if (this.demo) { e.classList.add('off'); e.innerHTML = '<i></i><b>Aperçu démo</b>'; return; }
    if (!this._lastSync) { e.classList.add('off'); e.innerHTML = '<i></i><b>En attente…</b>'; return; }
    e.classList.remove('off');
    const s = Math.round((Date.now() - this._lastSync) / 1000);
    const ago = s < 10 ? 'à l\'instant' : s < 60 ? 'il y a ' + s + ' s' : 'il y a ' + Math.round(s / 60) + ' min';
    e.innerHTML = '<i></i><b>En direct</b> · synchronisé ' + ago;
  },
  toggleDemo() {
    this.demo = !this.demo;
    const b = document.getElementById('an-demo-btn');
    if (b) b.textContent = this.demo ? '✕ Quitter la démo' : '👁 Aperçu démo';
    if (!this.demo) { this.refresh(); return; }   // sortie de démo → vraies données
    this.render(); this._syncLabel();
  },

  /* Message d'état vide : dit précisément CE QU'IL MANQUE (sinon échec silencieux) */
  _emptyMsg() {
    const logged = !!(window.Cloud && Cloud.enabled && Cloud.user());
    if (!logged) return '⚠️ <b>Connecte-toi avec Google ou Discord</b> pour activer les statistiques : elles sont rattachées à ton compte. Tout le reste est automatique.';
    const btn = '<button class="btn btn-accent" style="margin-top:10px" onclick="Analytics.activate()">⚡ Activer les statistiques sur mon site</button>';
    return 'Aucune visite enregistrée pour l\'instant.<br>Un site déjà en ligne ne peut pas installer le compteur tout seul : il faut le <b>republier une fois</b>. Un clic suffit — ensuite tout est automatique, à vie.<br>' + btn;
  },

  /* Installe le compteur : republie le site avec la config ENREGISTRÉE.
     Sûr même hors éditeur (edGetConfig renvoie SiteConfig tant que le formulaire
     n'a pas été chargé) → aucun risque de publier un site vide. */
  async activate() {
    if (!(window.Cloud && Cloud.enabled && Cloud.user())) { showToast('Connecte-toi d\'abord (Google ou Discord)', '#e4b24a', 3500); return; }
    if (!window.Auth || !Auth.ok()) { showToast('Connecte GitHub (Paramètres → Intégrations) pour publier', '#e4b24a', 4000); showPage('settings'); return; }
    try { SiteConfig.set('ownerUid', Cloud.user().uid); } catch (e) {}
    showToast('⚡ Installation du compteur — publication en cours…', '#666', 3000);
    try { await edDeploy(); showToast('✓ Statistiques activées — les visites vont remonter ici', '#2e9a63', 4000); }
    catch (e) { showToast('✗ ' + (e.message || 'Publication impossible'), '#c0392b', 4000); }
    setTimeout(() => this.refresh(), 1500);
  },

  _fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); },
  _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  _cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); },

  _demoData() {
    const days = {}; const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const dt = new Date(today); dt.setDate(dt.getDate() - i);
      const k = dt.toISOString().slice(0, 10);
      const base = 30 + Math.round(40 * Math.sin(i / 6) + (90 - i) * 0.7 + Math.random() * 22);
      days[k] = { views: Math.max(4, base), visitors: Math.max(3, Math.round(base * 0.62)), clicks: Math.round(base * 0.2) };
    }
    let tv = 0, tu = 0; Object.values(days).forEach(d => { tv += d.views; tu += d.visitors; });
    return {
      summary: { views: tv, visitors: tu, clicks: Math.round(tv * 0.18) }, days,
      referrers: { direct: 820, google: 610, discord: 430, behance: 295, instagram: 180, linkedin: 95, other: 120 },
      devices: { desktop: 1520, mobile: 980, tablet: 145 },
      countries: { FR: 1240, BE: 340, CA: 280, CH: 190, US: 160, GB: 95, DE: 70, MA: 120, ES: 55 },
      projects: {
        'Identité de marque': { views: 640, clicks: 88 }, 'Site portfolio': { views: 520, clicks: 60 },
        'Motion reel': { views: 410, clicks: 95 }, 'Illustration': { views: 300, clicks: 22 }
      }
    };
  },

  render() {
    const d = this.demo ? this._demoData() : this.data;
    const has = d && d.summary && (Number(d.summary.views) || 0) > 0;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const html = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
    const empty = document.getElementById('an-empty');
    const live = document.getElementById('an-live');

    set('ov-views', has ? this._fmt(d.summary.views) : '—');
    set('ov-uniq', has ? this._fmt(d.summary.visitors) : '—');

    if (!has) {
      if (empty) { empty.style.display = 'block'; empty.innerHTML = this._emptyMsg(); }
      if (live) live.style.display = 'none';
      html('an-trend', '');
      const t0 = document.getElementById('an-trend-sub'); if (t0) t0.textContent = '';
      html('an-co', '<div class="an-empty-mini">Aucune donnée pour l\'instant</div>');
      html('an-proj', '<div class="an-empty-mini">Aucune vue projet pour l\'instant</div>');
      html('an-ref', '<div class="an-empty-mini">Aucune donnée</div>');
      html('an-dev', '<div class="an-empty-mini">Aucune donnée</div>');
      return;
    }
    if (empty) empty.style.display = 'none';

    const days = d.days || {};
    const range = parseInt(document.getElementById('an-range')?.value || '30');
    html('an-trend', this._lineChart(this._series(days, range)));
    const t = document.getElementById('an-trend-sub'); if (t) t.textContent = range >= 365 ? 'depuis le début' : range + ' derniers jours';

    html('an-co', this._countries(d.countries));
    html('an-proj', this._projects(d.projects));
    html('an-ref', this._bars(d.referrers, this._refIcons));
    html('an-dev', this._bars(d.devices, { desktop: '🖥️ Ordinateur', mobile: '📱 Mobile', tablet: '📲 Tablette' }));
  },

  _series(days, n) {
    const out = []; const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(today); dt.setDate(dt.getDate() - i);
      const k = dt.toISOString().slice(0, 10); const v = days[k] || {};
      out.push({ k, views: v.views || 0, visitors: v.visitors || 0 });
    }
    return out;
  },

  _lineChart(series) {
    const W = 820, H = 170, pad = 10, n = series.length;
    const max = Math.max(1, ...series.map(s => s.views));
    const x = i => pad + (W - 2 * pad) * (n <= 1 ? 0 : i / (n - 1));
    const y = v => H - 16 - (H - 30) * (v / max);
    const pts = series.map((s, i) => [x(i), y(s.views)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L ${x(n - 1).toFixed(1)} ${H - 16} L ${x(0).toFixed(1)} ${H - 16} Z`;
    let grid = ''; for (let g = 0; g <= 3; g++) { const gy = 14 + (H - 30) * g / 3; grid += `<line class="an-grid" x1="${pad}" y1="${gy.toFixed(1)}" x2="${W - pad}" y2="${gy.toFixed(1)}"/>`; }
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;height:170px">
      <defs><linearGradient id="an-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.26"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#an-grad)"/><path class="an-line" d="${line}"/>
      <circle class="an-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5"/></svg>`;
  },

  /* ── Pays : drapeau + nom + nombre (trié desc, sans pourcentage) ── */
  _isCC(k) { return /^[A-Za-z]{2}$/.test(String(k || '')); },
  _toCC(k) { const s = String(k || '').trim(); if (this._isCC(s)) return s.toUpperCase(); return NAME_TO_CC[s.toLowerCase()] || null; },
  _flag(cc, rawKey) {
    if (cc && FLAG_SVG[cc]) return `<span class="an-flag">${FLAG_SVG[cc]}</span>`;
    if (cc && supportsFlagEmoji()) return `<span class="an-flag emoji">${emojiFlag(cc)}</span>`;
    const code = (cc || String(rawKey || '').replace(/[^A-Za-z]/g, '').slice(0, 2) || '??').toUpperCase();
    return `<span class="an-flag chip">${this._esc(code)}</span>`;
  },
  _countries(mapObj) {
    const entries = Object.entries(mapObj || {}).filter(([, v]) => (Number(v) || 0) > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!entries.length) return '<div class="an-empty-mini">Aucune donnée pour l\'instant</div>';
    return entries.map(([k, v]) => {
      const cc = this._toCC(k);
      const name = (cc && COUNTRY_NAMES[cc]) || (this._isCC(k) ? String(k).toUpperCase() : this._cap(k));
      return `<div class="an-co-row">${this._flag(cc, k)}<span class="an-co-name">${this._esc(name)}</span><span class="an-co-n"><b>${this._fmt(v)}</b> visiteur${v > 1 ? 's' : ''}</span></div>`;
    }).join('');
  },

  _refIcons: { direct: '↗ Direct', google: '🔍 Google', discord: '🎮 Discord', behance: '🎨 Behance', instagram: '📸 Instagram', linkedin: '💼 LinkedIn', twitter: '🐦 Twitter', youtube: '▶ YouTube', other: '🌐 Autres' },
  _bars(mapObj, icons) {
    const entries = Object.entries(mapObj || {}).filter(([, v]) => (Number(v) || 0) > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div class="an-empty-mini">Aucune donnée</div>';
    const max = Math.max(...entries.map(e => e[1]));
    return entries.map(([k, v]) => {
      const lbl = icons && icons[k] ? icons[k] : this._cap(k);
      return `<div class="an-bar-row"><div class="lbl">${this._esc(lbl)}</div><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round(100 * v / max)}%"></div></div><div class="an-bar-val">${this._fmt(v)}</div></div>`;
    }).join('');
  },

  _projects(mapObj) {
    const entries = Object.entries(mapObj || {})
      .map(([k, v]) => ({ name: k, views: v.views || 0, clicks: v.clicks || 0 }))
      .filter(p => p.views > 0).sort((a, b) => b.views - a.views).slice(0, 8);
    if (!entries.length) return '<div class="an-empty-mini">Aucune vue projet pour l\'instant</div>';
    const max = Math.max(...entries.map(p => p.views));
    return entries.map(p => {
      return `<div class="an-bar-row" style="grid-template-columns:150px 1fr 96px"><div class="lbl">${this._esc(p.name)}</div><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round(100 * p.views / max)}%"></div></div><div class="an-bar-val" style="font-weight:400;color:var(--muted)"><b style="color:var(--text)">${this._fmt(p.views)}</b> · ${this._fmt(p.clicks)} clics</div></div>`;
    }).join('');
  }
};
window.Analytics = Analytics;
document.addEventListener('DOMContentLoaded', () => Analytics.startLive());
