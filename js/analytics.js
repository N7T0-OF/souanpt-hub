'use strict';
/**
 * analytics.js — Tableau Analytics natif (Firebase Spark, sans service tiers).
 * Lit les agrégats users/{uid}/analytics/* (alimentés par le mouchard des sites
 * publiés). Rendu 100% local : KPIs + graphe SVG + barres. Aucune dépendance externe.
 * Tant que la collecte n'est pas branchée / sans visites : état vide + « Aperçu démo ».
 */
const Analytics = {
  data: null, demo: false, _loaded: false,

  async refresh() {
    if (this.demo) { this.render(); return; }
    let d = null;
    try { d = await (window.Cloud && Cloud.loadAnalytics ? Cloud.loadAnalytics() : null); }
    catch (e) { console.warn('[analytics]', e); }
    this.data = d; this._loaded = true;
    this.render();
  },

  toggleDemo() {
    this.demo = !this.demo;
    const b = document.getElementById('an-demo-btn');
    if (b) b.textContent = this.demo ? '✕ Quitter la démo' : '👁 Aperçu démo';
    this.render();
  },

  _fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); },
  _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  _cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); },

  /* ── données de démonstration (aperçu du rendu, non enregistrées) ── */
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
      browsers: { chrome: 1580, safari: 520, firefox: 240, edge: 210, opera: 60, other: 35 },
      countries: { France: 1240, Belgique: 340, Canada: 280, Suisse: 190, 'États-Unis': 160, Maroc: 120, Autres: 310 },
      projects: {
        'Identité de marque': { views: 640, clicks: 88 }, 'Site portfolio': { views: 520, clicks: 60 },
        'Motion reel': { views: 410, clicks: 95 }, 'Illustration': { views: 300, clicks: 22 }
      }
    };
  },

  render() {
    const d = this.demo ? this._demoData() : this.data;
    const dash = document.getElementById('an-dash'), empty = document.getElementById('an-empty');
    if (!dash || !empty) return;
    const has = d && d.summary && (Number(d.summary.views) || 0) > 0;
    if (!has) { dash.style.display = 'none'; empty.style.display = 'block'; return; }
    dash.style.display = ''; empty.style.display = 'none';

    const days = d.days || {};
    const range = parseInt(document.getElementById('an-range')?.value || '30');
    const todayK = new Date().toISOString().slice(0, 10);
    const sumViews = n => this._series(days, n).reduce((s, x) => s + (x.views || 0), 0);

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('an-k-views', this._fmt(d.summary.views));
    set('an-k-uniq', this._fmt(d.summary.visitors));
    set('an-k-today', this._fmt(days[todayK]?.views || 0));
    set('an-k-7', this._fmt(sumViews(7)));
    set('an-k-30', this._fmt(sumViews(30)));

    document.getElementById('an-trend').innerHTML = this._lineChart(this._series(days, range));
    const t = document.getElementById('an-trend-sub'); if (t) t.textContent = range + ' derniers jours';

    document.getElementById('an-ref').innerHTML = this._bars(d.referrers, this._refIcons);
    document.getElementById('an-dev').innerHTML = this._bars(d.devices, { desktop: '🖥️ Ordinateur', mobile: '📱 Mobile', tablet: '📲 Tablette' });
    document.getElementById('an-br').innerHTML = this._bars(d.browsers);
    document.getElementById('an-co').innerHTML = this._bars(d.countries, null, 7);
    document.getElementById('an-proj').innerHTML = this._projects(d.projects);
  },

  /* n derniers jours (comble les trous à 0) */
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
    const W = 820, H = 180, pad = 10, n = series.length;
    const max = Math.max(1, ...series.map(s => s.views));
    const x = i => pad + (W - 2 * pad) * (n <= 1 ? 0 : i / (n - 1));
    const y = v => H - 16 - (H - 30) * (v / max);
    const pts = series.map((s, i) => [x(i), y(s.views)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L ${x(n - 1).toFixed(1)} ${H - 16} L ${x(0).toFixed(1)} ${H - 16} Z`;
    let grid = '';
    for (let g = 0; g <= 3; g++) { const gy = 14 + (H - 30) * g / 3; grid += `<line class="an-grid" x1="${pad}" y1="${gy.toFixed(1)}" x2="${W - pad}" y2="${gy.toFixed(1)}"/>`; }
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;height:180px">
      <defs><linearGradient id="an-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.26"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#an-grad)"/><path class="an-line" d="${line}"/>
      <circle class="an-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5"/></svg>`;
  },

  _refIcons: { direct: '↗ Direct', google: '🔍 Google', discord: '🎮 Discord', behance: '🎨 Behance', instagram: '📸 Instagram', linkedin: '💼 LinkedIn', twitter: '🐦 Twitter', youtube: '▶ YouTube', other: '🌐 Autres' },

  _bars(mapObj, icons, limit) {
    const entries = Object.entries(mapObj || {}).filter(([, v]) => (Number(v) || 0) > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div class="an-empty-mini">Aucune donnée</div>';
    const top = limit ? entries.slice(0, limit) : entries;
    const max = Math.max(...top.map(e => e[1]));
    return top.map(([k, v]) => {
      const lbl = icons && icons[k] ? icons[k] : this._cap(k);
      const pct = Math.round(100 * v / max);
      return `<div class="an-bar-row"><div class="lbl">${this._esc(lbl)}</div><div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div><div class="an-bar-val">${this._fmt(v)}</div></div>`;
    }).join('');
  },

  _projects(mapObj) {
    const entries = Object.entries(mapObj || {})
      .map(([k, v]) => ({ name: k, views: v.views || 0, clicks: v.clicks || 0 }))
      .filter(p => p.views > 0).sort((a, b) => b.views - a.views).slice(0, 8);
    if (!entries.length) return '<div class="an-empty-mini">Aucune vue projet pour l\'instant</div>';
    const max = Math.max(...entries.map(p => p.views));
    return entries.map(p => {
      const ctr = p.views ? Math.round(1000 * p.clicks / p.views) / 10 : 0;
      return `<div class="an-bar-row" style="grid-template-columns:150px 1fr 118px"><div class="lbl">${this._esc(p.name)}</div><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round(100 * p.views / max)}%"></div></div><div class="an-bar-val" style="font-weight:400;color:var(--muted)"><b style="color:var(--text)">${this._fmt(p.views)}</b> · ${this._fmt(p.clicks)} · ${ctr}%</div></div>`;
    }).join('');
  }
};
window.Analytics = Analytics;
