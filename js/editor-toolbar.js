/* ══════════════════════════════════════════════════════════════
   Barre de l'éditeur (v3.19) — menus groupés 🎨 Design · 🧱 Contenu ·
   🚀 Visibilité, et fenêtre « Performance » repliée.
   Les fenêtres existantes (edWinTheme, edWinFx…) sont appelées telles
   quelles ; celles qui se positionnent reçoivent le bouton du menu.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const EdMenu = {
    _open: null, _anchor: null,
    toggle(name, btn) {
      if (this._open === name) return this.close();
      this.close();
      const pop = document.getElementById('edm-' + name); if (!pop || !btn) return;
      pop.hidden = false; this._open = name; this._anchor = btn;
      btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on');
      this.place(pop, btn);
      const first = pop.querySelector('button,a'); if (first && name !== 'perf') first.focus({ preventScroll: true });
    },
    place(pop, btn) {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth || 260;
      let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
      pop.style.left = left + 'px'; pop.style.top = (r.bottom + 6) + 'px';
    },
    close() {
      if (!this._open) return;
      const pop = document.getElementById('edm-' + this._open); if (pop) pop.hidden = true;
      if (this._anchor) { this._anchor.setAttribute('aria-expanded', 'false'); this._anchor.classList.remove('on'); }
      this._open = null;
    },
    /** run('edWinTheme', true) — `withAnchor` : la fenêtre se place sous le bouton du menu. */
    run(path, withAnchor) {
      const anchor = this._anchor; this.close();
      const parts = String(path).split('.'); let ctx = window, fn = window;
      for (const p of parts) { ctx = fn; fn = fn && fn[p]; }
      if (typeof fn !== 'function') return console.warn('[menu] fonction introuvable :', path);
      try { withAnchor ? fn.call(ctx, anchor) : fn.call(ctx); } catch (e) { console.error(e); showToast?.('Action impossible : ' + e.message, '#c0392b', 3000); }
    },
  };
  document.addEventListener('click', e => {
    if (!EdMenu._open) return;
    const pop = document.getElementById('edm-' + EdMenu._open);
    if (pop && !pop.contains(e.target) && !(EdMenu._anchor && EdMenu._anchor.contains(e.target))) EdMenu.close();
  }, true);
  document.addEventListener('keydown', e => {
    if (!EdMenu._open) return;
    if (e.key === 'Escape') { const a = EdMenu._anchor; EdMenu.close(); a && a.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...document.querySelectorAll('#edm-' + EdMenu._open + ' [role=menuitem]')]; if (!items.length) return;
      e.preventDefault(); const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  addEventListener('resize', () => EdMenu.close());
  window.EdMenu = EdMenu;
})();
