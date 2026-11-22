/* ══════════════════════════════════════════════════════════════
   BARRE D'ONGLETS MOBILE (v3.29) — téléphone et tablette en portrait.
   Sous 820 px, la barre latérale laisse la place à une barre FLOTTANTE en
   bas, coins arrondis, fond givré (façon iOS / One UI), une icône par
   section : Accueil · Contenu · Business · Rechercher · Réglages.
   Une section qui contient plusieurs pages affiche ses onglets en haut
   (Éditeur · Stockage · Outils ; Clients & Projets · Facturation · Avis).
   Toucher la section active revient à sa première page, en haut.
   La barre se cache quand le clavier est ouvert (sinon elle masque le champ).
   Au-delà de 820 px rien ne change (barre latérale, ou rail d'icônes sur
   tablette paysage, géré en CSS).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MQ = window.matchMedia ? matchMedia('(max-width: 820px)') : { matches: false, addEventListener() {} };
  const I = p => `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const GROUPS = [
    { id: 'home', label: 'Accueil', icon: I('<path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z"/>'), pages: ['overview'] },
    { id: 'content', label: 'Contenu', icon: I('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>'), pages: ['editor', 'storage', 'tools'],
      tabs: [['editor', 'Éditeur'], ['storage', 'Stockage'], ['tools', 'Outils']] },
    { id: 'business', label: 'Business', icon: I('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18"/>'), pages: ['cp', 'devis', 'portals', 'facturation', 'avis'],
      tabs: [['cp', 'Clients & Projets'], ['facturation', 'Facturation'], ['avis', 'Avis']], badges: ['cp-req-badge', 'devis-badge', 'fac-badge', 'avis-badge'] },
    { id: 'search', label: 'Rechercher', icon: I('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), action: () => window.HubSearch && HubSearch.open() },
    { id: 'system', label: 'Réglages', icon: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'), pages: ['settings', 'github'] },
  ];
  const groupOf = page => GROUPS.find(g => (g.pages || []).includes(page)) || null;
  const last = {};   // dernière page vue par section (retour au même endroit)

  const Tabbar = {
    groups: GROUPS, groupOf,
    mount() {
      if (document.getElementById('hub-tabbar')) return;
      const bar = document.createElement('nav');
      bar.id = 'hub-tabbar'; bar.setAttribute('aria-label', 'Sections');
      bar.innerHTML = GROUPS.map(g => `<button type="button" class="tbb" data-group="${g.id}" aria-label="${g.label}" title="${g.label}">${g.icon}<span class="tbb-dot" hidden></span></button>`).join('');
      document.body.appendChild(bar);
      bar.addEventListener('click', e => { const b = e.target.closest('[data-group]'); if (b) this.go(b.dataset.group); });
      const area = document.querySelector('.scroll-area');
      if (area && !document.getElementById('grp-tabs')) {
        const strip = document.createElement('div'); strip.id = 'grp-tabs'; strip.setAttribute('role', 'tablist'); strip.hidden = true;
        area.insertBefore(strip, area.firstChild);
        strip.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && typeof showPage === 'function') showPage(b.dataset.tab); });
      }
      this.badges();
      GROUPS.forEach(g => (g.badges || []).forEach(id => {
        const el = document.getElementById(id);
        if (el) new MutationObserver(() => this.badges()).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] });
      }));
    },
    go(id) {
      const g = GROUPS.find(x => x.id === id); if (!g) return;
      try { navigator.vibrate && navigator.vibrate(6); } catch {}
      if (g.action) return g.action();
      const cur = (document.querySelector('.page.active') || {}).id || '';
      const here = cur.replace(/^page-/, '');
      const target = g.pages.includes(here) ? g.pages[0] : (last[g.id] || g.pages[0]);
      if (typeof showPage === 'function') showPage(target);
      const area = document.querySelector('.scroll-area'); if (area && g.pages.includes(here)) area.scrollTo({ top: 0, behavior: 'smooth' });
    },
    sync(page) {
      const g = groupOf(page);
      if (g) last[g.id] = page;
      document.querySelectorAll('#hub-tabbar [data-group]').forEach(b => {
        const on = !!g && b.dataset.group === g.id;
        b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const strip = document.getElementById('grp-tabs'); if (!strip) return;
      if (!g || !g.tabs) { strip.hidden = true; strip.innerHTML = ''; return; }
      const activeTab = g.tabs.some(t => t[0] === page) ? page : (g.id === 'business' ? 'cp' : g.tabs[0][0]);   // devis / portails = onglets de Clients & Projets
      strip.innerHTML = g.tabs.map(([p, label]) => `<button type="button" role="tab" data-tab="${p}" class="${p === activeTab ? 'on' : ''}" aria-selected="${p === activeTab}">${label}</button>`).join('');
      strip.hidden = false;
    },
    badges() {
      GROUPS.forEach(g => {
        const dot = document.querySelector(`#hub-tabbar [data-group="${g.id}"] .tbb-dot`); if (!dot || !g.badges) return;
        dot.hidden = !g.badges.some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none' && !el.hidden && String(el.textContent || '').trim(); });
      });
    },
  };

  /* Clavier ouvert : la barre se retire (visualViewport bien plus petit que la fenêtre). */
  function watchKeyboard() {
    const vv = window.visualViewport; if (!vv) return;
    const upd = () => document.body.classList.toggle('kb-open', MQ.matches && vv.height < window.innerHeight * 0.72);
    vv.addEventListener('resize', upd); upd();
  }
  function install() {
    Tabbar.mount();
    if (typeof window.showPage === 'function' && !window.showPage.__tabbar) {
      const orig = window.showPage;
      const wrapped = function (id) { const r = orig.apply(this, arguments); try { Tabbar.sync(id); } catch {} return r; };
      wrapped.__tabbar = true;
      Object.keys(orig).forEach(k => { if (k.startsWith('__')) wrapped[k] = orig[k]; });
      window.showPage = wrapped;
    }
    const active = document.querySelector('.page.active');
    if (active) Tabbar.sync(active.id.replace(/^page-/, ''));
    watchKeyboard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.HubTabbar = Tabbar;
})();
