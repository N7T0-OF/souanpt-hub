/* ══════════════════════════════════════════════════════════════
   BUSINESS FUSIONNÉ (v3.27) — « Clients & Projets » devient un seul espace
   à onglets : 🗂 Projets · 📥 Demandes & Devis · 🔗 Portails.
   Ce sont les étapes d'un même projet client (demande → devis → mission →
   livraison) ; elles vivaient sur 3 pages séparées de la barre latérale.
   Les pages restent (`cp`, `devis`, `portals`) : raccourcis, recherche,
   notifications et liens existants continuent de fonctionner. Une seule
   entrée dans la barre latérale ; les pastilles gardent leurs identifiants.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const TABS = [['cp', '🗂', 'Projets'], ['devis', '📥', 'Demandes & Devis'], ['portals', '🔗', 'Portails']];
  const IDS = TABS.map(t => t[0]);
  const TITLES = { cp: 'Clients & Projets', devis: 'Clients & Projets', portals: 'Clients & Projets' };   // l'onglet actif précise la section

  const BizNav = {
    is(id) { return IDS.includes(id); },
    /** Barre d'onglets unique, placée avant les pages ; les pastilles existantes y sont déplacées. */
    mount() {
      if (document.getElementById('biz-tabs')) return;
      const first = document.getElementById('page-cp'); if (!first) return;
      const bar = document.createElement('div'); bar.id = 'biz-tabs'; bar.className = 'biz-tabs'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Clients et projets'); bar.hidden = true;
      bar.innerHTML = TABS.map(([id, ic, label]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="false" onclick="showPage('${id}')"><span>${ic}</span> ${label}<span class="biz-tab-b" data-slot="${id}"></span></button>`).join('');
      first.parentNode.insertBefore(bar, first);
      // Pastilles d'origine (mises à jour par leurs modules) déplacées dans les onglets.
      [['devis', 'devis-badge'], ['portals', 'portals-badge']].forEach(([tab, bid]) => {
        const b = document.getElementById(bid), slot = bar.querySelector(`[data-slot="${tab}"]`);
        if (b && slot) slot.appendChild(b);
      });
      // Entrées fusionnées : retirées de la barre latérale (les pages restent).
      ['devis', 'portals'].forEach(id => { const n = document.querySelector(`.sidebar .ni[data-page="${id}"]`); if (n) { n.hidden = true; n.classList.add('ni-merged'); } });
      // Une nouvelle demande reste visible depuis la barre latérale.
      const cpNav = document.querySelector('.sidebar .ni[data-page="cp"]');
      const src = document.getElementById('devis-badge');
      if (cpNav && src && !document.getElementById('cp-req-badge')) {
        const m = document.createElement('span'); m.id = 'cp-req-badge'; m.className = 'nbadge nb-warn'; m.style.display = 'none'; m.title = 'Demandes à traiter';
        cpNav.appendChild(m);
        const sync = () => { m.textContent = src.textContent; m.style.display = src.style.display === 'none' || !src.textContent ? 'none' : ''; };
        sync(); new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      }
      const cpTitle = cpNav && cpNav.getAttribute('title');
      if (cpNav) cpNav.setAttribute('title', (cpTitle ? cpTitle + ' — ' : '') + 'demandes, devis et portails inclus');
    },
    sync(id) {
      const bar = document.getElementById('biz-tabs'); if (!bar) return;
      const on = this.is(id);
      bar.hidden = !on;
      if (!on) return;
      bar.querySelectorAll('[data-tab]').forEach(b => { const a = b.dataset.tab === id; b.classList.toggle('on', a); b.setAttribute('aria-selected', a); });
      document.querySelector('.sidebar .ni[data-page="cp"]')?.classList.add('active');
      const t = document.getElementById('topbar-title'); if (t) t.textContent = TITLES[id];
    },
  };

  function install() {
    BizNav.mount();
    if (typeof window.showPage === 'function' && !window.showPage.__bizNav) {
      const orig = window.showPage;
      const wrapped = function (id) { const r = orig.apply(this, arguments); try { BizNav.sync(id); } catch {} return r; };
      wrapped.__bizNav = true;
      window.showPage = wrapped;
    }
    const active = document.querySelector('.page.active');
    if (active) BizNav.sync(active.id.replace(/^page-/, ''));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.BizNav = BizNav;
})();
