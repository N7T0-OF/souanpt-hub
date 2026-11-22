/* ══════════════════════════════════════════════════════════════
   RACCOURCIS CLAVIER GLOBAUX (v3.25)
   « G » puis une lettre pour changer de page, « / » pour la recherche,
   « ? » pour la liste complète. Jamais pendant une saisie ; les raccourcis
   de l'éditeur (T, E, B, S) restent actifs sur sa page.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const GO = { o: ['overview', 'Vue d\'ensemble'], e: ['editor', 'Éditeur de site'], c: ['cp', 'Clients & Projets'], d: ['devis', 'Demandes & Devis'],
    f: ['facturation', 'Facturation'], a: ['avis', 'Avis'], s: ['storage', 'Stockage'], t: ['tools', 'Outils'], p: ['settings', 'Paramètres'], l: ['portals', 'Portails'] };
  const LIST = [
    ['Ctrl+K  ou  /', 'Recherche globale et actions'],
    ['G puis O · E · C · D · F', 'Vue d\'ensemble · Éditeur · Clients · Devis · Facturation'],
    ['G puis A · S · T · L · P', 'Avis · Stockage · Outils · Portails · Paramètres'],
    ['N', 'Nouvelle prestation (Facturation)'],
    ['T · E · B · S', 'Éditeur : Thème · Effets · Bannière · Sections'],
    ['Ctrl+Z  /  Ctrl+Maj+Z', 'Éditeur : annuler / rétablir'],
    ['?', 'Cette aide'], ['Échap', 'Fermer une fenêtre'],
  ];
  const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const blocked = () => !!(document.getElementById('login-gate')?.classList.contains('on') || document.getElementById('cmdk') || document.getElementById('biz-modal') || document.getElementById('pair-modal'));

  const Shortcuts = {
    _g: 0,
    help() {
      if (document.getElementById('kbd-help')) return this.close();
      const box = document.createElement('div'); box.id = 'kbd-help'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Raccourcis clavier');
      box.innerHTML = `<div class="kbd-card"><div class="pair-h"><b>⌨ Raccourcis clavier</b><button type="button" class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        ${LIST.map(([k, d]) => `<div class="kbd-row"><span>${k.split(/(\s·\s|\s+ou\s+|\s\/\s|\+|\s+puis\s+)/).map(p => /^\s*(·|ou|\/|\+|puis)\s*$/.test(p) ? `<i>${p.trim()}</i>` : `<kbd>${p}</kbd>`).join('')}</span><small>${d}</small></div>`).join('')}</div>`;
      document.body.appendChild(box);
      box.querySelector('[data-x]').onclick = () => this.close();
      box.addEventListener('click', ev => { if (ev.target === box) this.close(); });
    },
    close() { document.getElementById('kbd-help')?.remove(); },
    handle(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      if (ev.key === 'Escape' && document.getElementById('kbd-help')) { this.close(); return true; }
      if (typing(ev.target) || blocked()) { this._g = 0; return false; }
      const k = String(ev.key || '').toLowerCase();
      if (this._g && Date.now() - this._g < 1200) {
        this._g = 0;
        const dest = GO[k];
        if (dest && typeof showPage === 'function' && document.getElementById('page-' + dest[0])) { showPage(dest[0]); return true; }
        return false;
      }
      if (k === 'g') { this._g = Date.now(); return true; }
      if (ev.key === '/') { window.HubSearch && HubSearch.open(); return true; }
      if (ev.key === '?') { this.help(); return true; }
      if (k === 'n' && document.getElementById('page-facturation')?.classList.contains('active') && typeof toggleForm === 'function') {
        toggleForm('add-inv-form', true); setTimeout(() => document.getElementById('inv-name')?.focus(), 60); return true;
      }
      return false;
    },
  };
  // Capture sur window : passe avant les raccourcis de l'éditeur (G puis E ≠ « E » Effets).
  window.addEventListener('keydown', ev => { if (Shortcuts.handle(ev)) { ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); } }, true);
  window.Shortcuts = Shortcuts;
})();
