'use strict';
/**
 * canvas.js — Canvas vivant : l'aperçu du site DEVIENT l'interface d'édition.
 *
 * L'aperçu est un iframe Blob → même origine → on peut injecter une couche
 * d'édition dans son document et y attacher les interactions depuis le dashboard.
 * ⚠ Rien de tout ceci n'est publié : la couche est injectée à l'exécution dans
 * l'iframe, jamais dans le HTML produit par generateSite().
 *
 * Remplace le panneau « Propriétés » : tout se fait autour du bloc sélectionné.
 * (Seul le panneau de l'ÉDITEUR disparaît — la barre latérale du dashboard reste.)
 */
const EdCanvas = {
  mode: 'edit', sel: null, doc: null,
  _hist: [], _redo: [], _saveT: null,

  fine() { try { return matchMedia('(hover:hover) and (pointer:fine)').matches; } catch (e) { return true; } },

  /* ══ données & historique ══ */
  blocks() { return JSON.parse(JSON.stringify(getBlocks(SiteConfig.get()))); },
  commit(blocks) {
    this._hist.push(JSON.stringify(getBlocks(SiteConfig.get())));
    if (this._hist.length > 60) this._hist.shift();
    this._redo.length = 0;
    this._save(blocks);
    this._btns();
  },
  _save(blocks) {
    SiteConfig.set('blocks', blocks);      // → localStorage → miroir Firestore (debounce)
    this._status('Sauvegarde…');
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this._status('Sauvegardé'), 800);
  },
  undo() {
    if (!this._hist.length) return;
    this._redo.push(JSON.stringify(getBlocks(SiteConfig.get())));
    this._save(JSON.parse(this._hist.pop()));
    this.sel = null; this._btns(); this.rerender();
  },
  redo() {
    if (!this._redo.length) return;
    this._hist.push(JSON.stringify(getBlocks(SiteConfig.get())));
    this._save(JSON.parse(this._redo.pop()));
    this.sel = null; this._btns(); this.rerender();
  },
  _btns() {
    const u = document.getElementById('ed-undo'), r = document.getElementById('ed-redo');
    if (u) u.disabled = !this._hist.length;
    if (r) r.disabled = !this._redo.length;
  },
  _status(t) { const e = document.getElementById('ed-canvas-status'); if (e) e.textContent = t; },
  rerender() { if (typeof edRefreshPreview === 'function') edRefreshPreview(); },

  /* ══ attache la couche d'édition à l'aperçu ══ */
  attach(doc) {
    if (!doc || !doc.body) return;
    this.doc = doc; this.sel = null;
    this._css(doc);
    this._decorate(doc);
    doc.body.classList.toggle('ed-on', this.mode === 'edit');
    // capture : en mode Édition, un clic sélectionne au lieu d'ouvrir le lien
    doc.addEventListener('click', e => {
      if (this.mode !== 'edit') return;
      if (this._ui(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const t = e.target.closest && e.target.closest('[data-b]');
      if (t && t.getAttribute('data-b')) this.select(t.getAttribute('data-b')); else this.deselect();
    }, true);
    doc.addEventListener('keydown', e => this._key(e));
    doc.addEventListener('scroll', () => { if (this.sel) this._place(); }, true);
    // Clic droit : menu Souanpt DANS LE CANVAS UNIQUEMENT (le reste du navigateur
    // garde son menu natif — on ne bloque rien ailleurs). En Aperçu : menu natif.
    doc.addEventListener('contextmenu', e => this._ctx(e));
    // Appui long = clic droit sur mobile/tablette
    let lp = null;
    doc.addEventListener('touchstart', e => {
      if (this.mode !== 'edit') return;
      const t = e.target.closest && e.target.closest('[data-b]');
      lp = setTimeout(() => { const to = e.touches[0];
        this._ctx({ preventDefault(){}, clientX: to.clientX, clientY: to.clientY, target: e.target }); }, 480);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(ev => doc.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    this._btns();
  },

  /* ══ Menu contextuel personnalisé ══ */
  _clip: null,
  _ctx(e) {
    if (this.mode !== 'edit') return;          // Aperçu → menu natif du navigateur
    if (this._dragging) return;                // jamais pendant un déplacement
    e.preventDefault();
    const doc = this.doc;
    const el = e.target.closest && e.target.closest('[data-b]');
    const id = el && el.getAttribute('data-b');
    if (id) this.select(id); else this.deselect();
    const b = id ? this.blocks().find(x => x.id === id) : null;
    const items = b ? [
      ['edit', '✎ Modifier', ''], ['dup', '⧉ Dupliquer', 'Ctrl+D'], ['copy', '⧉ Copier', 'Ctrl+C'],
      ['paste', '📋 Coller', 'Ctrl+V'], null,
      ['front', '↑ Déplacer vers l\'avant', ''], ['back', '↓ Déplacer vers l\'arrière', ''], null,
      ['lock', b.locked ? '🔓 Déverrouiller' : '🔒 Verrouiller', ''],
      ['hide', b.hidden ? '👁 Réafficher' : '👁 Masquer', ''],
      ['del', '🗑 Supprimer', 'Suppr'],
    ] : [
      ['add', '＋ Ajouter un bloc', ''], ['paste', '📋 Coller', 'Ctrl+V'], null,
      ['undo', '↶ Annuler', 'Ctrl+Z'], ['redo', '↷ Rétablir', 'Ctrl+Maj+Z'], null,
      ['struct', '☰ Afficher la structure', ''],
    ];
    doc.getElementById('ed-ctx')?.remove();
    const m = doc.createElement('div'); m.id = 'ed-ctx'; m.className = 'ed-ctx';
    m.innerHTML = items.map(it => it
      ? `<button data-a="${it[0]}"><span>${it[1]}</span><i>${it[2]}</i></button>`
      : '<div class="ed-ctx-sep"></div>').join('');
    doc.body.appendChild(m);
    const sx = doc.documentElement.scrollLeft || 0, sy = doc.documentElement.scrollTop || 0;
    const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    m.style.left = Math.min(e.clientX, vw - m.offsetWidth - 6) + sx + 'px';
    m.style.top = Math.min(e.clientY, vh - m.offsetHeight - 6) + sy + 'px';
    m.onclick = ev => { const btn = ev.target.closest('button'); if (!btn) return;
      ev.stopPropagation(); m.remove(); this._ctxAct(btn.dataset.a); };
    const close = () => { m.remove(); doc.removeEventListener('mousedown', close); };
    setTimeout(() => doc.addEventListener('mousedown', close), 0);
  },
  _ctxAct(a) {
    const blocks = this.blocks();
    const i = blocks.findIndex(b => b.id === this.sel);
    if (a === 'copy') { if (i >= 0) { this._clip = JSON.parse(JSON.stringify(blocks[i])); showToast?.('Bloc copié', '#666', 1400); } return; }
    if (a === 'paste') { return this.paste(); }
    if (a === 'undo') return this.undo();
    if (a === 'redo') return this.redo();
    if (a === 'add') return showToast?.('Palette « + » : étape 3c 🚧', '#e4b24a', 2400);
    if (a === 'struct') return showToast?.('Fenêtre Structure : étape 3c 🚧', '#e4b24a', 2400);
    if (i < 0) return;
    if (a === 'lock') {
      blocks[i].locked = !blocks[i].locked; this.commit(blocks);
      showToast?.(blocks[i].locked ? '🔒 Bloc verrouillé' : '🔓 Bloc déverrouillé', '#666', 1600);
      this.select(this.sel); return;
    }
    if (a === 'front' || a === 'back') {
      const j = a === 'front' ? i - 1 : i + 1;
      if (j < 0 || j >= blocks.length) return;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      this.commit(blocks); this.rerender(); return;
    }
    this._act(a);   // edit / dup / hide / del
  },
  paste() {
    if (!this._clip) return showToast?.('Rien à coller', '#666', 1400);
    const blocks = this.blocks();
    const c = JSON.parse(JSON.stringify(this._clip)); c.id = blockUid(c.type || 'b');
    const i = blocks.findIndex(b => b.id === this.sel);
    blocks.splice(i >= 0 ? i + 1 : blocks.length, 0, c);
    this.commit(blocks); this.rerender();
    showToast?.('Bloc collé ✓', '#2e9a63', 1600);
  },
  _ui(t) { return !!(t && t.closest && t.closest('#ed-tb,.ed-rz,.ed-h')); },

  _css(doc) {
    if (doc.getElementById('ed-canvas-css')) return;
    const s = doc.createElement('style'); s.id = 'ed-canvas-css';
    s.textContent = `
/* Même scrollbar que le Hub (l'aperçu est un document séparé : la scrollbar du
   dashboard ne s'y applique pas, on voyait celle native du navigateur). */
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:2px}
html{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
.ed-on [data-b]{cursor:default}
.ed-on [data-b]:hover{outline:1px dashed rgba(200,255,0,.55);outline-offset:2px}
.ed-on [data-b].ed-sel{outline:2px solid #C8FF00;outline-offset:2px}
/* Bloc masqué : visible mais grisé EN ÉDITION (déplaçable/modifiable), absent en Aperçu.
   La transition joue dans les deux sens → retour immédiat des couleurs au réaffichage. */
.ed-on .bn.bl-hidden{display:flex!important}
.ed-on .pc.bl-hidden{display:block!important}
.ed-on .bl-hidden{opacity:.42;filter:grayscale(1);border-style:dashed!important}
[data-b]{transition:opacity .2s ease,filter .2s ease}
.ed-on .bl-hidden::after{content:'Masqué sur le site public';position:absolute;top:6px;right:6px;z-index:59;
  background:rgba(15,15,15,.9);color:#f0ece4;border:1px solid rgba(255,255,255,.18);border-radius:5px;
  padding:2px 6px;font:700 8px system-ui;letter-spacing:.4px;filter:grayscale(0);pointer-events:none}
.ed-on .bl-hidden *{pointer-events:none}
.ed-on .bl-hidden>.ed-h{pointer-events:auto}
.ed-h{display:none;position:absolute;top:6px;left:6px;z-index:60;background:rgba(15,15,15,.88);color:#f0ece4;
      border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:3px 5px;cursor:grab;font:600 11px/1 system-ui;align-items:center;letter-spacing:-1px}
.ed-h:active{cursor:grabbing}
.ed-on [data-b]:hover>.ed-h,.ed-on [data-b].ed-sel>.ed-h{display:flex}
.ed-drag{opacity:.5;box-shadow:0 22px 55px rgba(0,0,0,.55)!important;z-index:50}
.ed-tb{position:absolute;z-index:9999;display:flex;gap:2px;align-items:center;background:rgba(15,15,15,.94);
      -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);
      border-radius:10px;padding:4px;box-shadow:0 12px 34px rgba(0,0,0,.5);font-family:system-ui,sans-serif}
.ed-tb button{background:none;border:none;color:#f0ece4;font:600 11px system-ui;padding:5px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.ed-tb button:hover{background:rgba(255,255,255,.1);color:#C8FF00}
.ed-tb .ed-ty{font:700 9px system-ui;color:rgba(240,236,228,.5);padding:0 6px;text-transform:uppercase;letter-spacing:1px}
.ed-tb .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.14);margin:2px}
.ed-rz{position:absolute;z-index:9998;width:11px;height:11px;background:#C8FF00;border-radius:3px;
      box-shadow:0 0 0 2px rgba(0,0,0,.4);cursor:nwse-resize}
.ed-size{position:absolute;z-index:10000;background:#C8FF00;color:#060606;font:800 10px system-ui;padding:3px 7px;border-radius:6px;pointer-events:none}
/* Menu contextuel (clic droit) — canvas uniquement */
.ed-ctx{position:absolute;z-index:10001;min-width:196px;padding:5px;background:rgba(18,18,18,.96);
  -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.14);
  border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:edCtx .18s cubic-bezier(.2,.9,.3,1)}
@keyframes edCtx{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:none}}
.ed-ctx button{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;background:none;border:none;
  color:#f0ece4;font:600 11px system-ui;padding:7px 9px;border-radius:7px;cursor:pointer;text-align:left}
.ed-ctx button:hover{background:rgba(255,255,255,.09);color:#C8FF00}
.ed-ctx button i{font-style:normal;font-size:9px;color:rgba(240,236,228,.4)}
.ed-ctx-sep{height:1px;background:rgba(255,255,255,.1);margin:4px 6px}
/* Déplacement : le bloc flotte (soulevé + agrandi + ombre), retour élastique */
.ed-drag{opacity:.92!important;transform:scale(1.04);box-shadow:0 26px 60px rgba(0,0,0,.6)!important;z-index:50;cursor:grabbing}
[data-b]{transition:transform .22s cubic-bezier(.2,.9,.3,1),box-shadow .22s ease}
.ed-lock{position:absolute;top:6px;right:6px;z-index:59;font-size:10px;opacity:.75;pointer-events:none}
@media (hover:hover) and (pointer:fine){}`;
    doc.head.appendChild(s);
  },

  /* poignée ⋮⋮ sur chaque bloc (le drag ne part QUE de là → pas de conflit avec les textes/liens) */
  _decorate(doc) {
    doc.querySelectorAll('[data-b]').forEach(el => {
      if (!el.getAttribute('data-b') || el.querySelector(':scope>.ed-h')) return;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const h = doc.createElement('div'); h.className = 'ed-h'; h.textContent = '⋮⋮'; h.title = 'Glisser pour déplacer';
      h.addEventListener('pointerdown', e => this._drag(e, el));
      el.insertBefore(h, el.firstChild);
    });
  },

  /* ══ sélection + barre flottante ══ */
  select(id) {
    const doc = this.doc; if (!doc || !id) return this.deselect();
    const el = doc.querySelector('[data-b="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!el) return this.deselect();
    this.sel = id;
    doc.querySelectorAll('[data-b].ed-sel').forEach(e => e.classList.remove('ed-sel'));
    el.classList.add('ed-sel');
    this._toolbar(el);
    this._handles(el);
  },
  deselect() {
    const doc = this.doc; this.sel = null; if (!doc) return;
    doc.querySelectorAll('[data-b].ed-sel').forEach(e => e.classList.remove('ed-sel'));
    doc.getElementById('ed-tb')?.remove();
    doc.querySelectorAll('.ed-rz').forEach(e => e.remove());
  },

  _TYPES: { profile: 'Profil', project: 'Projet', link: 'Lien', text: 'Texte', reviews: 'Avis', contact: 'Contact' },
  /** URL configurée sur un bloc (neutralisée en Édition, mais testable) */
  _linkOf(b) {
    if (!b) return '';
    if (b.type === 'link')    return (getLinks().find(x => String(x.id) === String(b.ref)) || {}).url || '';
    if (b.type === 'project') return (getProjects().find(x => String(x.id) === String(b.ref)) || {}).url || '';
    if (b.type === 'contact') { const e = SiteConfig.get().email; return e ? 'mailto:' + e : ''; }
    return '';
  },
  _toolbar(el) {
    const doc = this.doc;
    let tb = doc.getElementById('ed-tb');
    if (!tb) { tb = doc.createElement('div'); tb.id = 'ed-tb'; tb.className = 'ed-tb'; doc.body.appendChild(tb); }
    const b = this.blocks().find(x => x.id === this.sel) || {};
    const url = this._linkOf(b);
    const inGrid = el.parentElement && el.parentElement.classList.contains('bn-grid');
    tb.innerHTML = `<span class="ed-ty">${this._TYPES[b.type] || 'Bloc'}${b.locked ? ' 🔒' : ''}</span><span class="sep"></span>` +
      `<button data-a="move">⋮⋮ Déplacer</button><button data-a="edit">✎ Modifier</button>` +
      (inGrid ? `<button data-a="size">⤢ Taille</button>` : '') +
      `<button data-a="style">🎨 Style</button><button data-a="fx">⚡ Effets</button>` +
      `<button data-a="dup">⧉ Dupliquer</button><button data-a="hide">${b.hidden ? '👁 Afficher' : '👁 Masquer'}</button>` +
      `<button data-a="lock">${b.locked ? '🔓' : '🔒'}</button><button data-a="del" title="Supprimer">🗑</button>` +
      // Le lien est neutralisé en Édition : on le signale et on offre de le tester.
      (url ? `<span class="sep"></span><button data-a="testlink" title="${_eesc(url)}">🔗 Tester le lien</button>` : '');
    tb.onclick = e => { const btn = e.target.closest('button'); if (btn) { e.stopPropagation(); this._act(btn.dataset.a); } };
    this._place();
  },
  /* repositionne la barre : au-dessus du bloc, sinon dessous ; jamais hors écran */
  _place() {
    const doc = this.doc, tb = doc && doc.getElementById('ed-tb');
    if (!tb || !this.sel) return;
    const el = doc.querySelector('[data-b="' + (window.CSS && CSS.escape ? CSS.escape(this.sel) : this.sel) + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = doc.documentElement.scrollLeft || doc.body.scrollLeft || 0;
    const sy = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
    const vw = doc.documentElement.clientWidth || 0;
    tb.style.visibility = 'hidden'; tb.style.left = '0px'; tb.style.top = '0px';
    const tw = tb.offsetWidth, th = tb.offsetHeight;
    let top = r.top + sy - th - 8;
    if (r.top - th - 8 < 0) top = r.bottom + sy + 8;             // trop haut → sous le bloc
    let left = Math.max(sx + 6, Math.min(r.left + sx, sx + vw - tw - 6));  // jamais hors écran
    tb.style.left = left + 'px'; tb.style.top = top + 'px'; tb.style.visibility = 'visible';
    this._handles(el);
  },
  /* poignée de redimensionnement (grille Bento uniquement) */
  _handles(el) {
    const doc = this.doc;
    doc.querySelectorAll('.ed-rz').forEach(e => e.remove());
    if (!this.fine()) return;
    if (!el.parentElement || !el.parentElement.classList.contains('bn-grid')) return;
    const r = el.getBoundingClientRect();
    const sx = doc.documentElement.scrollLeft || 0, sy = doc.documentElement.scrollTop || 0;
    const h = doc.createElement('div'); h.className = 'ed-rz'; h.title = 'Redimensionner';
    h.style.left = (r.right + sx - 6) + 'px'; h.style.top = (r.bottom + sy - 6) + 'px';
    h.addEventListener('pointerdown', e => this._resize(e, el));
    doc.body.appendChild(h);
  },

  /* ══ actions de la barre ══ */
  _act(a) {
    const blocks = this.blocks();
    const i = blocks.findIndex(b => b.id === this.sel);
    if (i < 0) return;
    if (a === 'dup') {
      const c = JSON.parse(JSON.stringify(blocks[i])); c.id = blockUid(c.type || 'b');
      blocks.splice(i + 1, 0, c); this.commit(blocks); this.rerender();
      showToast?.('Bloc dupliqué ✓', '#2e9a63', 1800);
    } else if (a === 'hide') {
      blocks[i].hidden = !blocks[i].hidden;
      this.commit(blocks);
      // bascule la classe en local : pas de reconstruction du canvas (la transition
      // CSS fait le gris ↔ couleurs en ~200 ms), la sélection est conservée.
      const el = this.doc.querySelector('[data-b="' + (window.CSS && CSS.escape ? CSS.escape(this.sel) : this.sel) + '"]');
      if (el) el.classList.toggle('bl-hidden', !!blocks[i].hidden);
      this._toolbar(el);
      showToast?.(blocks[i].hidden ? 'Bloc masqué — grisé ici, absent du site public' : 'Bloc réaffiché ✓', '#666', 2200);
    } else if (a === 'del') {
      blocks.splice(i, 1); this.commit(blocks); this.sel = null; this.rerender();
      showToast?.('Bloc supprimé — Ctrl+Z pour annuler', '#666', 2600);
    } else if (a === 'move') {
      showToast?.('Glisse la poignée ⋮⋮ en haut à gauche du bloc', '#666', 2600);
    } else if (a === 'edit') {
      edWinEdit(this.sel);
    } else if (a === 'size') {
      this._winSize();
    } else if (a === 'lock') {
      this._ctxAct('lock');
    } else if (a === 'style') {
      edWinTheme(null);
    } else if (a === 'fx') {
      edWinFx(null);
    } else if (a === 'testlink') {
      const u = this._linkOf(blocks[i]);
      if (u) window.open(u, '_blank', 'noopener');
    }
  },

  /* ══ déplacement (grille magnétique, réorganisation en direct) ══ */
  _drag(e, el) {
    if (!this.fine() || this.mode !== 'edit') return;
    const bl = this.blocks().find(x => x.id === el.getAttribute('data-b'));
    if (bl && bl.locked) return showToast?.('🔒 Bloc verrouillé — clic droit pour déverrouiller', '#e4b24a', 2400);
    e.preventDefault(); e.stopPropagation();
    const doc = this.doc;
    const grid = el.parentElement;
    this._dragging = true;
    el.classList.add('ed-drag');
    this.deselect();
    const move = ev => {
      const under = doc.elementFromPoint(ev.clientX, ev.clientY);
      const t = under && under.closest ? under.closest('[data-b]') : null;
      if (!t || t === el || t.parentElement !== grid) return;
      const r = t.getBoundingClientRect();
      const after = (ev.clientX - r.left) > r.width / 2;
      grid.insertBefore(el, after ? t.nextSibling : t);   // les voisins se replacent tout seuls (CSS grid)
    };
    const up = () => {
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up);
      el.classList.remove('ed-drag');
      this._dragging = false;
      this._order(grid);
      this.select(el.getAttribute('data-b'));
    };
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up);
  },

  /* ══ Tailles Bento : 3 formats seulement (pas de redimensionnement libre) ══ */
  SIZES: [{ k: 'S', n: 'Petit', w: 1, h: 1 }, { k: 'M', n: 'Moyen', w: 2, h: 1 }, { k: 'L', n: 'Grand', w: 2, h: 2 }],
  _nearestSize(w, h) {
    let best = this.SIZES[0], d = 1e9;
    this.SIZES.forEach(s => { const x = Math.abs(s.w - w) + Math.abs(s.h - h); if (x < d) { d = x; best = s; } });
    return best;
  },
  setSize(k) {
    const s = this.SIZES.find(x => x.k === k); if (!s) return;
    const blocks = this.blocks();
    const b = blocks.find(x => x.id === this.sel); if (!b) return;
    if (b.locked) return showToast?.('🔒 Bloc verrouillé', '#e4b24a', 2000);
    b.w = s.w; b.h = s.h; this.commit(blocks);
    const el = this.doc.querySelector('[data-b="' + (window.CSS && CSS.escape ? CSS.escape(this.sel) : this.sel) + '"]');
    if (el) { el.style.setProperty('--w', s.w); el.style.setProperty('--h', s.h); }
    this.select(this.sel);
  },
  _winSize(anchorRect) {
    const b = this.blocks().find(x => x.id === this.sel) || {};
    const cur = this._nearestSize(b.w || 1, b.h || 1).k;
    EdWin.open(null, '⤢ Taille du bloc',
      '<div class="edw-row">' + this.SIZES.map(s =>
        `<button class="edw-st${s.k === cur ? ' on' : ''}" data-s="${s.k}">${s.n}<br><span style="opacity:.5">${s.w}×${s.h}</span></button>`).join('') + '</div>',
      w => w.querySelectorAll('[data-s]').forEach(x => x.onclick = () => {
        w.querySelectorAll('[data-s]').forEach(y => y.classList.toggle('on', y === x));
        this.setSize(x.dataset.s);
      }));
  },
  _order(grid) {
    const ids = [...grid.querySelectorAll(':scope>[data-b]')].map(e => e.getAttribute('data-b'));
    const blocks = this.blocks();
    const shown = new Set(ids);
    const by = new Map(blocks.map(b => [b.id, b]));
    const next = ids.map(id => by.get(id)).filter(Boolean);
    // Certains blocs existent sans être rendus (masqués, ou « Avis » quand aucun avis
    // n'est approuvé). Les réinsérer à leur index d'origine plutôt qu'à la fin, sinon
    // leur position dériverait à chaque déplacement.
    blocks.forEach((b, i) => { if (!shown.has(b.id)) next.splice(Math.min(i, next.length), 0, b); });
    this.commit(next);
  },

  /* ══ redimensionnement (aimanté à la grille, sauvegarde au relâchement) ══ */
  _resize(e, el) {
    if (this.mode !== 'edit') return;
    e.preventDefault(); e.stopPropagation();
    const doc = this.doc, grid = el.parentElement;
    const cs = getComputedStyle(grid);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 4;
    const gap = parseFloat(cs.columnGap || cs.gap) || 14;
    const cellW = (grid.clientWidth - gap * (cols - 1)) / cols;
    const cellH = 150, r0 = el.getBoundingClientRect();
    const tip = doc.createElement('div'); tip.className = 'ed-size'; doc.body.appendChild(tip);
    const move = ev => {
      const w = Math.max(1, Math.min(cols, Math.round((ev.clientX - r0.left + gap) / (cellW + gap))));
      const h = Math.max(1, Math.min(3, Math.round((ev.clientY - r0.top + gap) / (cellH + gap))));
      el.style.setProperty('--w', w); el.style.setProperty('--h', h);
      tip.textContent = w + ' × ' + h;
      const rr = el.getBoundingClientRect();
      tip.style.left = (rr.left + (doc.documentElement.scrollLeft || 0) + 6) + 'px';
      tip.style.top = (rr.top + (doc.documentElement.scrollTop || 0) + 6) + 'px';
    };
    const up = () => {
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up);
      tip.remove();
      // aimante au format le plus proche parmi Petit / Moyen / Grand
      const s = this._nearestSize(+el.style.getPropertyValue('--w') || 1, +el.style.getPropertyValue('--h') || 1);
      el.style.setProperty('--w', s.w); el.style.setProperty('--h', s.h);
      const blocks = this.blocks();
      const b = blocks.find(x => x.id === el.getAttribute('data-b'));
      if (b) { b.w = s.w; b.h = s.h; this.commit(blocks); }
      this.select(el.getAttribute('data-b'));
      showToast?.('Taille : ' + s.n, '#666', 1200);
    };
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up);
  },

  /* ══ modes Édition / Aperçu ══ */
  setMode(m) {
    this.mode = m;
    if (this.doc && this.doc.body) this.doc.body.classList.toggle('ed-on', m === 'edit');
    if (m !== 'edit') this.deselect();
    document.getElementById('ed-mode-edit')?.classList.toggle('active', m === 'edit');
    document.getElementById('ed-mode-prev')?.classList.toggle('active', m !== 'edit');
  },

  _key(e) {
    // jamais pendant une saisie dans un champ
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    const k = String(e.key).toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
    if (this.mode !== 'edit') return;
    if (k === 'escape') { e.preventDefault(); window.EdWin && EdWin.close(); return this.deselect(); }
    if (!this.sel) return;
    if (mod && k === 'c') { e.preventDefault(); return this._ctxAct('copy'); }
    if (mod && k === 'v') { e.preventDefault(); return this.paste(); }
    if (mod && k === 'd') { e.preventDefault(); return this._act('dup'); }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); return this._act('del'); }
  },
};
window.EdCanvas = EdCanvas;
document.addEventListener('keydown', e => EdCanvas._key(e));

/* ══════════════════════════════════════════════════════════════
   EdWin — micro-fenêtres flottantes (remplacent le panneau Propriétés).
   Ancrées au bouton déclencheur, jamais hors écran, Échap + clic extérieur.
══════════════════════════════════════════════════════════════ */
const EdWin = {
  el: null, _out: null, _esc: null,
  open(anchor, title, html, onMount) {
    this.close();
    const w = document.createElement('div');
    w.className = 'edwin';
    w.innerHTML = `<div class="edwin-h"><span>${title}</span><button class="edwin-x" title="Fermer (Échap)">✕</button></div><div class="edwin-b">${html}</div>`;
    document.body.appendChild(w);
    this.el = w;
    const ww = w.offsetWidth, wh = w.offsetHeight;
    let left, top;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      left = Math.min(Math.max(8, r.right - ww), innerWidth - ww - 8);
      top = r.bottom + 8;
      if (top + wh > innerHeight - 8) top = Math.max(8, r.top - wh - 8);
    } else { left = (innerWidth - ww) / 2; top = (innerHeight - wh) / 2; }
    w.style.left = Math.max(8, left) + 'px'; w.style.top = Math.max(8, top) + 'px';
    w.querySelector('.edwin-x').onclick = () => this.close();
    setTimeout(() => document.addEventListener('mousedown', this._out = e => {
      if (!w.contains(e.target) && !(anchor && anchor.contains(e.target))) this.close();
    }), 0);
    document.addEventListener('keydown', this._esc = e => { if (e.key === 'Escape') this.close(); });
    if (onMount) onMount(w);
    return w;
  },
  close() {
    if (this._out) { document.removeEventListener('mousedown', this._out); this._out = null; }
    if (this._esc) { document.removeEventListener('keydown', this._esc); this._esc = null; }
    if (this.el) { this.el.remove(); this.el = null; }
  },
};
window.EdWin = EdWin;

const _eesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** applique une clé de config + rafraîchit (debounce pour les saisies continues) */
function edSet(k, v, live) { SiteConfig.set(k, v); live ? edUpdatePreview() : edRefreshPreview(); }

/* ── 🎨 Thème (ex-groupe « Thème » du panneau) ── */
function edWinTheme(btn) {
  const c = SiteConfig.get();
  // aperçus miniatures : on voit la structure du style, pas seulement son nom
  const styles = [
    ['float', '📱 Barre flottante', '<b class="p1"></b><b class="p2"></b><b class="p2"></b>'],
    ['sidebar', '🖥 Barre latérale', '<b class="s1"></b><b class="s2"></b><b class="s3"></b>'],
    ['bento', '🧩 Bento', '<b class="b1"></b><b class="b2"></b><b class="b3"></b><b class="b4"></b>'],
  ];
  const html = `
    <div class="edw-l">Style du site</div>
    <div class="edw-styles">${styles.map(([v, n, mini]) =>
      `<button class="edw-sty${c.layoutStyle === v ? ' on' : ''}" data-v="${v}"><span class="edw-mini m-${v}">${mini}</span>${n}</button>`).join('')}</div>
    <div class="edw-l">Couleur d'accent</div>
    <input type="color" class="edw-color" id="edw-accent" value="${_eesc(c.accentColor || '#C8FF00')}">
    <div class="edw-l">Fond</div>
    <div class="edw-row"><button class="edw-st${c.theme !== '#f8f8f8' ? ' on' : ''}" data-t="#060606">Sombre</button><button class="edw-st${c.theme === '#f8f8f8' ? ' on' : ''}" data-t="#f8f8f8">Clair</button></div>
    <div class="edw-l">Colonnes de projets</div>
    <div class="edw-row">${['2', '3', '4'].map(n => `<button class="edw-st${String(c.layout) === n ? ' on' : ''}" data-c="${n}">${n}</button>`).join('')}</div>`;
  EdWin.open(btn, '🎨 Thème', html, w => {
    const pick = (sel, key) => w.querySelectorAll(sel).forEach(b => b.onclick = () => {
      w.querySelectorAll(sel).forEach(x => x.classList.toggle('on', x === b));
      edSet(key, b.dataset.v || b.dataset.t || b.dataset.c);
    });
    pick('[data-v]', 'layoutStyle'); pick('[data-t]', 'theme'); pick('[data-c]', 'layout');
    const a = w.querySelector('#edw-accent');
    a.oninput = () => edSet('accentColor', a.value, true);
  });
}

/* ── ⚡ Effets (ex-groupe « Animations & effets ») ── */
function edWinFx(btn) {
  const c = SiteConfig.get(), fx = c.fx || {};
  const lv = [['none', 'Aucune'], ['light', 'Légères'], ['smooth', 'Fluides'], ['premium', 'Premium']];
  const tg = [['tilt', '✨ Effet 3D interactif'], ['shine', '🌟 Brillance'], ['lift', '↑ Hover Lift'], ['glow', '💡 Reflet lumineux'], ['mouseglow', '🔦 Halo qui suit la souris']];
  const html = `
    <div class="edw-l">Animations d'apparition</div>
    <div class="edw-row">${lv.map(([v, n]) => `<button class="edw-st${(c.animLevel || 'smooth') === v ? ' on' : ''}" data-a="${v}">${n}</button>`).join('')}</div>
    <div class="edw-l">Effets au survol <span class="edw-hint">ordinateur uniquement</span></div>
    ${tg.map(([k, n]) => `<label class="edw-tog"><input type="checkbox" data-f="${k}"${fx[k] ? ' checked' : ''}> ${n}</label>`).join('')}
    <div class="edw-l" id="edw-int-l" style="${fx.tilt ? '' : 'display:none'}">Intensité 3D — <b id="edw-int-v">${fx.intensity || 7}</b>°</div>
    <input type="range" id="edw-int" min="3" max="16" value="${fx.intensity || 7}" style="${fx.tilt ? '' : 'display:none'};width:100%">`;
  EdWin.open(btn, '⚡ Animations & effets', html, w => {
    w.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      w.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('on', x === b));
      edSet('animLevel', b.dataset.a);
    });
    const sync = () => {
      const f = { ...(SiteConfig.get().fx || {}) };
      w.querySelectorAll('[data-f]').forEach(i => f[i.dataset.f] = i.checked);
      f.intensity = parseInt(w.querySelector('#edw-int').value) || 7;
      edSet('fx', f);
      const on = !!f.tilt;
      w.querySelector('#edw-int-l').style.display = on ? '' : 'none';
      w.querySelector('#edw-int').style.display = on ? '' : 'none';
    };
    w.querySelectorAll('[data-f]').forEach(i => i.onchange = sync);
    const r = w.querySelector('#edw-int');
    r.oninput = () => { w.querySelector('#edw-int-v').textContent = r.value; };
    r.onchange = sync;
  });
}

/* ── ✎ Modifier : contenu du bloc sélectionné (ex-groupes « Contenu » / « Portfolio ») ── */
function edWinEdit(blockId) {
  const b = getBlocks(SiteConfig.get()).find(x => x.id === blockId);
  if (!b) return;
  const c = SiteConfig.get();
  const F = (id, label, val, type) => `<div class="edw-l">${label}</div>` +
    (type === 'area' ? `<textarea class="edw-in" id="${id}" rows="3">${_eesc(val)}</textarea>`
                     : `<input class="edw-in" id="${id}" value="${_eesc(val)}">`);
  let title = 'Modifier', html = '', save = null;

  if (b.type === 'profile') {
    title = '✎ Profil';
    html = F('e1', 'Nom du site', c.siteName) + F('e2', 'Accroche (hero)', c.heroText) + F('e3', 'Bio', c.bio, 'area');
    save = w => { const g = i => w.querySelector('#' + i).value;
      SiteConfig.set('siteName', g('e1')); SiteConfig.set('heroText', g('e2')); SiteConfig.set('bio', g('e3')); };
  } else if (b.type === 'text') {
    title = '✎ Texte';
    html = F('e1', 'Titre', (b.props || {}).title || '') + F('e2', 'Texte', (b.props || {}).text || '', 'area');
    save = w => { const bl = getBlocks(SiteConfig.get()); const x = bl.find(y => y.id === blockId);
      x.props = { ...(x.props || {}), title: w.querySelector('#e1').value, text: w.querySelector('#e2').value };
      SiteConfig.set('blocks', bl);
      if (x.props.title === 'À propos') SiteConfig.set('about', x.props.text); };
  } else if (b.type === 'contact') {
    title = '✎ Contact';
    html = F('e1', 'Adresse e-mail', c.email);
    save = w => SiteConfig.set('email', w.querySelector('#e1').value);
  } else if (b.type === 'link') {
    const l = getLinks().find(x => String(x.id) === String(b.ref)) || {};
    title = '✎ Lien';
    html = F('e1', 'Libellé', l.title || '') + F('e2', 'URL', l.url || '');
    save = w => { const ls = getLinks(); const x = ls.find(y => String(y.id) === String(b.ref));
      if (x) { x.title = w.querySelector('#e1').value; x.url = w.querySelector('#e2').value;
               localStorage.setItem('hub_links', JSON.stringify(ls)); } };
  } else if (b.type === 'project') {
    const p = getProjects().find(x => String(x.id) === String(b.ref)) || {};
    title = '✎ Projet';
    html = F('e1', 'Titre', p.title || '') + F('e2', 'Tags (séparés par une virgule)', (p.tags || []).join(', '))
         + F('e3', 'Lien du projet', p.url || '') + F('e4', 'Couverture — URL image', p.cover || '');
    save = w => { const ps = getProjects(); const x = ps.find(y => String(y.id) === String(b.ref));
      if (x) { x.title = w.querySelector('#e1').value;
               x.tags = w.querySelector('#e2').value.split(',').map(t => t.trim()).filter(Boolean);
               x.url = w.querySelector('#e3').value; x.cover = w.querySelector('#e4').value;
               localStorage.setItem('hub_projects', JSON.stringify(ps));
               if (typeof renderProjects === 'function') renderProjects(); } };
  } else if (b.type === 'reviews') {
    title = '✎ Avis';
    const m = c.avisMode || 'defile';
    html = `<div class="edw-l">Affichage</div><div class="edw-row">
      <button class="edw-st${m === 'defile' ? ' on' : ''}" data-m="defile">Défilement</button>
      <button class="edw-st${m === 'grille' ? ' on' : ''}" data-m="grille">Grille</button></div>`;
    save = null;
  }

  html += save ? `<button class="edw-ok" id="edw-save">Appliquer</button>` : '';
  EdWin.open(null, title, html, w => {
    w.querySelectorAll('[data-m]').forEach(x => x.onclick = () => {
      w.querySelectorAll('[data-m]').forEach(y => y.classList.toggle('on', y === x));
      edSet('avisMode', x.dataset.m);
    });
    const ok = w.querySelector('#edw-save');
    if (ok) ok.onclick = () => { save(w); EdWin.close(); edRefreshPreview(); showToast?.('Modifié ✓', '#2e9a63', 1500); };
  });
}
window.edWinTheme = edWinTheme; window.edWinFx = edWinFx; window.edWinEdit = edWinEdit;
