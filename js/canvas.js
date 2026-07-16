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
    this._btns();
  },
  _ui(t) { return !!(t && t.closest && t.closest('#ed-tb,.ed-rz,.ed-h')); },

  _css(doc) {
    if (doc.getElementById('ed-canvas-css')) return;
    const s = doc.createElement('style'); s.id = 'ed-canvas-css';
    s.textContent = `
.ed-on [data-b]{cursor:default}
.ed-on [data-b]:hover{outline:1px dashed rgba(200,255,0,.55);outline-offset:2px}
.ed-on [data-b].ed-sel{outline:2px solid #C8FF00;outline-offset:2px}
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
  _toolbar(el) {
    const doc = this.doc;
    let tb = doc.getElementById('ed-tb');
    if (!tb) { tb = doc.createElement('div'); tb.id = 'ed-tb'; tb.className = 'ed-tb'; doc.body.appendChild(tb); }
    const b = this.blocks().find(x => x.id === this.sel) || {};
    tb.innerHTML = `<span class="ed-ty">${this._TYPES[b.type] || 'Bloc'}</span><span class="sep"></span>` +
      `<button data-a="move">⋮⋮ Déplacer</button><button data-a="edit">✎ Modifier</button>` +
      `<button data-a="style">🎨 Style</button><button data-a="fx">⚡ Effets</button>` +
      `<button data-a="dup">⧉ Dupliquer</button><button data-a="hide">${b.hidden ? '👁 Afficher' : '👁 Masquer'}</button>` +
      `<button data-a="del" title="Supprimer">🗑</button>`;
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
      blocks[i].hidden = !blocks[i].hidden; this.commit(blocks); this.rerender();
      showToast?.(blocks[i].hidden ? 'Bloc masqué' : 'Bloc affiché', '#666', 1600);
    } else if (a === 'del') {
      blocks.splice(i, 1); this.commit(blocks); this.sel = null; this.rerender();
      showToast?.('Bloc supprimé — Ctrl+Z pour annuler', '#666', 2600);
    } else if (a === 'move') {
      showToast?.('Glisse la poignée ⋮⋮ en haut à gauche du bloc', '#666', 2600);
    } else {
      showToast?.('Menus Contenu / Style / Effets : étape 3 🚧', '#e4b24a', 2600);
    }
  },

  /* ══ déplacement (grille magnétique, réorganisation en direct) ══ */
  _drag(e, el) {
    if (!this.fine() || this.mode !== 'edit') return;
    e.preventDefault(); e.stopPropagation();
    const doc = this.doc;
    const grid = el.parentElement;
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
      this._order(grid);
      this.select(el.getAttribute('data-b'));
    };
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up);
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
      const blocks = this.blocks();
      const b = blocks.find(x => x.id === el.getAttribute('data-b'));
      if (b) { b.w = +el.style.getPropertyValue('--w') || 1; b.h = +el.style.getPropertyValue('--h') || 1; this.commit(blocks); }
      this.select(el.getAttribute('data-b'));
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
    const z = (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z';
    if (!z) return;
    e.preventDefault();
    if (e.shiftKey) this.redo(); else this.undo();
  },
};
window.EdCanvas = EdCanvas;
document.addEventListener('keydown', e => EdCanvas._key(e));
