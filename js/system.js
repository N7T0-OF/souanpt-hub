/* ══════════════════════════════════════════════════════════════
   SYSTÈME (v3.22) — mises à jour, préférences, état du hub
   • Mise à jour automatique : `build-info.json` (publié avec chaque
     version) est comparé à la version en cours ; si une nouvelle version
     est en ligne, un bandeau propose de recharger. Vérifié au démarrage,
     toutes les 30 min quand l'onglet est visible, et au retour sur l'onglet.
   • Préférences de l'appareil : page au démarrage (dont « dernière page »),
     animations réduites dans le tableau de bord.
   • Onglet Paramètres → Système : version, notes de version, stockage par
     collection, sauvegarde GitHub, diagnostic copiable (sans aucun secret).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PREF = 'hub_prefs';
  const LABELS = { projects: 'Projets', config: 'Réglages du site', invoices: 'Factures', workspaces: 'Dossiers clients', reviews: 'Avis', clients: 'Clients',
    expenses: 'Dépenses', business: 'Infos de facturation', links: 'Liens', wsruns: 'Journal de migration', catalog: 'Catalogue', portals: 'Portails',
    media: 'Médias', files: 'Fichiers', estimates: 'Devis', pricing: 'Grille tarifaire', settings: 'Préférences images' };
  const START_PAGES = [['overview', 'Vue d\'ensemble'], ['last', 'Dernière page ouverte'], ['cp', 'Clients & Projets'], ['facturation', 'Facturation'], ['devis', 'Demandes & Devis'], ['editor', 'Éditeur de site']];
  const ago = t => { if (!t) return 'jamais'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j'; };
  const kb = n => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1).replace('.', ',') + ' Ko' : (n / 1048576).toFixed(2).replace('.', ',') + ' Mo';

  const HubSystem = {
    running() { try { return (typeof HUB_VERSIONS !== 'undefined' && HUB_VERSIONS[0] && HUB_VERSIONS[0][0]) || ''; } catch { return ''; } },
    prefs() { try { const p = JSON.parse(localStorage.getItem(PREF) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } },
    setPref(k, v) { const p = this.prefs(); p[k] = v; try { localStorage.setItem(PREF, JSON.stringify(p)); } catch {} this.applyPrefs(); },
    applyPrefs() { document.documentElement.classList.toggle('hub-calm', !!this.prefs().calm); },

    /* ── Mise à jour automatique ── */
    _info: null, _shownFor: '',
    /** Comparaison de versions « 3.21.0 » : >0 si a est plus récente que b. */
    cmp(a, b) {
      const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0), pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
      return 0;
    },
    async check(manual) {
      let info = null;
      try {
        const r = await fetch('build-info.json?ts=' + Date.now(), { cache: 'no-store' });
        if (r.ok) info = await r.json();
      } catch {}
      this._info = info;
      const run = this.running(), online = info && info.version;
      const newer = online && run && this.cmp(online, run) > 0;
      if (newer) this.banner(online);
      if (manual) {
        if (!online) showToast?.('Version en ligne inconnue (hors des sites publiés)', '#e4b24a', 3000);
        else if (newer) showToast?.('Nouvelle version ' + online + ' disponible', 'var(--green)', 3000);
        else showToast?.('Tu as la dernière version (' + run + ') ✓', 'var(--green)', 2500);
      }
      this.renderSystem();
      return { running: run, online: online || null, newer: !!newer };
    },
    banner(v) {
      if (this._shownFor === v || document.getElementById('hub-update')) return;
      this._shownFor = v;
      const b = document.createElement('div'); b.id = 'hub-update'; b.setAttribute('role', 'status');
      b.innerHTML = `<span>✨ Version <b>${e(v)}</b> disponible</span><button type="button" class="btn btn-accent" data-go>Recharger</button><button type="button" class="btn btn-ghost" data-x aria-label="Plus tard">✕</button>`;
      document.body.appendChild(b);
      b.querySelector('[data-x]').onclick = () => b.remove();
      b.querySelector('[data-go]').onclick = () => this.update();
    },
    async update() {
      try { if (typeof edSaveConfig === 'function' && document.getElementById('page-editor')?.classList.contains('active')) edSaveConfig(true); } catch {}
      try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch {}
      location.reload();
    },

    /* ── Onglet Système ── */
    storage() {
      const rows = [];
      let total = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); total += (k.length + (localStorage.getItem(k) || '').length) * 2; }
      } catch {}
      const list = (typeof HubData !== 'undefined' && HubData.LIST) || [];
      list.forEach(c => {
        let size = 0, count = null;
        try { const raw = localStorage.getItem(c.ls) || ''; size = raw.length * 2; if (c.type === 'array') { const v = JSON.parse(raw || '[]'); count = Array.isArray(v) ? v.length : 0; } } catch {}
        rows.push({ key: LABELS[c.key] || c.key, size, count });
      });
      return { total, rows: rows.sort((a, b) => b.size - a.size) };
    },
    diagnostic() {
      const std = window.matchMedia && matchMedia('(display-mode: standalone)').matches;
      const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      const ua = (navigator.userAgent.match(/(Edg|OPR|Chrome|Firefox|Safari)\/[\d.]+/) || ['?'])[0];
      return [
        'souanpt.hub ' + this.running() + (this._info && this._info.commit ? ' (' + String(this._info.commit).slice(0, 7) + ')' : ''),
        'Version en ligne : ' + ((this._info && this._info.version) || 'inconnue'),
        'Navigateur : ' + ua + ' · ' + (navigator.language || ''),
        'Écran : ' + screen.width + '×' + screen.height + ' · fenêtre ' + innerWidth + '×' + innerHeight,
        'Application installée : ' + (std ? 'oui' : 'non') + ' · service worker : ' + (sw ? 'actif' : 'non'),
        'En ligne : ' + (navigator.onLine ? 'oui' : 'non') + ' · stockage local : ' + kb(this.storage().total),
        'Dernière sauvegarde GitHub : ' + ago(parseInt(localStorage.getItem('souanpt_last_backup') || '0', 10)),
      ].join('\n');
    },
    async copyDiagnostic() {
      const t = this.diagnostic();
      try { await navigator.clipboard.writeText(t); showToast?.('Diagnostic copié ✓ (aucune donnée personnelle)', 'var(--green)', 2500); }
      catch { prompt('Diagnostic à copier :', t); }
    },
    async renderSystem() {
      const box = document.getElementById('sys-panel'); if (!box) return;
      const st = this.storage();
      let quota = '';
      try { if (navigator.storage && navigator.storage.estimate) { const q = await navigator.storage.estimate(); if (q && q.quota) quota = kb(q.usage || 0) + ' utilisés sur ' + kb(q.quota) + ' disponibles pour ce site'; } } catch {}
      const info = this._info, run = this.running();
      const newer = info && info.version && this.cmp(info.version, run) > 0;
      const max = Math.max(1, ...st.rows.map(r => r.size));
      const notes = (typeof HUB_VERSIONS !== 'undefined' ? HUB_VERSIONS : []).slice(0, 6);
      const lastBackup = parseInt(localStorage.getItem('souanpt_last_backup') || '0', 10);
      const lastPull = parseInt(localStorage.getItem('souanpt_last_pull') || '0', 10);
      box.innerHTML = `
        <div class="setting-group"><div class="setting-group-title">Version</div>
          <div class="sys-ver"><div><b>${e(run || '—')}</b><span>installée sur cet appareil</span></div>
            <div><b class="${newer ? 'sys-new' : ''}">${e((info && info.version) || '—')}</b><span>${info ? 'en ligne' + (info.builtAt ? ' · ' + new Date(info.builtAt).toLocaleDateString('fr-FR') : '') : 'en ligne (inconnue ici)'}</span></div></div>
          <div class="sys-row"><button class="btn ${newer ? 'btn-accent' : 'btn-ghost'}" style="font-size:10px" onclick="${newer ? 'HubSystem.update()' : 'HubSystem.check(true)'}">${newer ? '✨ Installer la version ' + e(info.version) : '↻ Vérifier les mises à jour'}</button></div>
          <details class="sys-notes"><summary>Nouveautés récentes</summary>${notes.map(([v, t]) => `<div><b>${e(v)}</b> ${e(t)}</div>`).join('')}</details></div>
        <div class="setting-group"><div class="setting-group-title">Données sur cet appareil</div>
          <div class="sys-sub">${kb(st.total)} au total${quota ? ' · ' + e(quota) : ''}</div>
          <div class="sys-bars">${st.rows.filter(r => r.size > 0).slice(0, 10).map(r => `<div class="sys-bar"><span>${e(r.key)}${r.count != null ? ' <em>' + r.count + '</em>' : ''}</span><i><b style="width:${Math.max(2, Math.round(r.size / max * 100))}%"></b></i><small>${kb(r.size)}</small></div>`).join('') || '<div class="sys-sub">Aucune donnée locale.</div>'}</div>
          <div class="sys-kv"><span>Sauvegarde GitHub</span><b>${ago(lastBackup)}</b></div>
          <div class="sys-kv"><span>Dernière récupération</span><b>${ago(lastPull)}</b></div>
          <div class="sys-row"><button class="btn btn-accent" style="font-size:10px" onclick="exportDataFull()">⬇ Exporter mon Hub</button><button class="btn btn-ghost" style="font-size:10px" onclick="importDataFull()">⬆ Importer</button><button class="btn btn-ghost" style="font-size:10px" onclick="restoreV1()">☁ Restaurer depuis GitHub</button></div></div>
        <div class="setting-group"><div class="setting-group-title">Diagnostic</div>
          <pre class="sys-diag">${e(this.diagnostic())}</pre>
          <div class="sys-row"><button class="btn btn-ghost" style="font-size:10px" onclick="HubSystem.copyDiagnostic()">📋 Copier le diagnostic</button></div></div>`;
    },

    /* ── Onglet Général : préférences ── */
    renderPrefs() {
      const box = document.getElementById('sys-prefs'); if (!box) return;
      const p = this.prefs();
      box.innerHTML = `
        <div class="prop-row"><div class="prop-label">Page au démarrage</div><select class="prop-input prop-select" id="pref-start" onchange="HubSystem.setPref('start',this.value)">${START_PAGES.map(([v, l]) => `<option value="${v}"${(p.start || 'overview') === v ? ' selected' : ''}>${e(l)}</option>`).join('')}</select></div>
        <div class="setting-row"><div class="setting-info"><div class="setting-name">Animations réduites</div><div class="setting-desc">Tableau de bord plus sobre (le site publié n'est pas concerné)</div></div><div class="toggle${p.calm ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${!!p.calm}" onclick="HubSystem.setPref('calm',!this.classList.contains('on'));HubSystem.renderPrefs()" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div></div>
        <div class="setting-group-title" style="margin-top:14px">Raccourcis clavier</div>
        <div class="sys-keys"><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ou <kbd>/</kbd> Recherche globale</span><span><kbd>G</kbd> puis <kbd>F</kbd> Facturation (O, E, C, D, A, S, T, L, P)</span><span><kbd>N</kbd> Nouvelle prestation</span><span><kbd>?</kbd> Tous les raccourcis</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> Annuler (éditeur)</span><span><kbd>T</kbd> Thème</span><span><kbd>E</kbd> Effets</span><span><kbd>B</kbd> Bannière</span><span><kbd>S</kbd> Sections</span><span><kbd>Échap</kbd> Fermer</span></div>`;
    },
  };

  /* Démarrage : préférences, page d'accueil, vérification de version. */
  HubSystem.applyPrefs();
  window.addEventListener('load', () => {
    setTimeout(() => {
      const p = HubSystem.prefs();
      let start = p.start || 'overview';
      if (start === 'last') start = localStorage.getItem('hub_last_page') || 'overview';
      const gate = document.getElementById('login-gate');
      const onOverview = document.getElementById('page-overview')?.classList.contains('active');
      if (start !== 'overview' && onOverview && !(gate && gate.classList.contains('on')) && typeof showPage === 'function' && document.getElementById('page-' + start)) showPage(start);
    }, 400);
    setTimeout(() => HubSystem.check(false), 8000);
  });
  setInterval(() => { if (!document.hidden) HubSystem.check(false); }, 30 * 60 * 1000);
  let lastVis = Date.now();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastVis > 10 * 60 * 1000) { lastVis = Date.now(); HubSystem.check(false); } });
  /* « Dernière page ouverte » : mémorisée à chaque changement de page. */
  if (typeof window.showPage === 'function') {
    const orig = window.showPage;
    window.showPage = function (id) { const r = orig.apply(this, arguments); try { if (document.getElementById('page-' + id)) localStorage.setItem('hub_last_page', id); } catch {} return r; };
  }
  window.HubSystem = HubSystem;
})();
