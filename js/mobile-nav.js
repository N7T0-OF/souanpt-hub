/* ══════════════════════════════════════════════════════════════
   Navigation mobile / tablette (v3.21)
   Sous 820 px, la barre latérale devient un tiroir ouvert par ☰ :
   fond assombri, Échap, fermeture après le choix d'une page. Au-delà,
   rien ne change (la barre reste une colonne fixe).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MQ = window.matchMedia ? matchMedia('(max-width: 820px)') : { matches: false, addEventListener() {} };
  const HubNav = {
    isOpen() { return document.body.classList.contains('nav-open'); },
    open() {
      if (!MQ.matches) return;
      document.body.classList.add('nav-open');
      document.querySelector('.tb-menu')?.setAttribute('aria-expanded', 'true');
      setTimeout(() => document.querySelector('.sidebar .ni.active, .sidebar .ni')?.focus({ preventScroll: true }), 50);
    },
    close() {
      if (!this.isOpen()) return;
      document.body.classList.remove('nav-open');
      const b = document.querySelector('.tb-menu'); if (b) { b.setAttribute('aria-expanded', 'false'); }
    },
    toggle() { this.isOpen() ? this.close() : this.open(); },
  };
  document.addEventListener('click', e => {
    if (!HubNav.isOpen()) return;
    if (e.target.closest('#nav-backdrop') || e.target.closest('.sidebar .ni')) HubNav.close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && HubNav.isOpen()) { HubNav.close(); document.querySelector('.tb-menu')?.focus(); } });
  const onChange = () => { if (!MQ.matches) HubNav.close(); };
  if (MQ.addEventListener) MQ.addEventListener('change', onChange); else if (MQ.addListener) MQ.addListener(onChange);
  window.HubNav = HubNav;
})();
