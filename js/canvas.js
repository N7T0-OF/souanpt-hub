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
    window.DismissLayer?.onFrameReload();
    this.doc = doc; this.sel = null;
    this._css(doc);
    this._decorate(doc);
    doc.body.classList.toggle('ed-on', this.mode === 'edit');
    // capture : en mode Édition, un clic sélectionne au lieu d'ouvrir le lien
    doc.addEventListener('click', e => {
      if (this.mode !== 'edit') return;
      if (this._ui(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.target.closest && e.target.closest('[data-add]')) { this.deselect(); return edAddBlock(); }
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
      ['lock', bLocked(b) ? '🔓 Déverrouiller' : '🔒 Verrouiller', ''],
      ['hide', bHidden(b) ? '👁 Réafficher' : '👁 Masquer', ''],
      ['del', '🗑 Supprimer', 'Suppr'],
    ] : [
      ['add', '＋ Ajouter un bloc', ''], ['paste', '📋 Coller', 'Ctrl+V'], null,
      ['undo', '↶ Annuler', 'Ctrl+Z'], ['redo', '↷ Rétablir', 'Ctrl+Maj+Z'], null,
      ['struct', '☰ Afficher la structure', ''],
    ];
    DismissLayer.close('replaced');   // referme une micro-fenêtre encore ouverte
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
      ev.stopPropagation(); const a = btn.dataset.a; DismissLayer.close('action'); this._ctxAct(a); };
    // Même couche que les micro-fenêtres : clic extérieur (y compris HORS de
    // l'iframe, dans le dashboard) et Échap le ferment aussi.
    DismissLayer.open({ el: m });
  },
  _ctxAct(a) {
    const blocks = this.blocks();
    const i = blocks.findIndex(b => b.id === this.sel);
    if (a === 'copy') { if (i >= 0) { this._clip = JSON.parse(JSON.stringify(blocks[i])); showToast?.('Bloc copié', '#666', 1400); } return; }
    if (a === 'paste') { return this.paste(); }
    if (a === 'undo') return this.undo();
    if (a === 'redo') return this.redo();
    if (a === 'add') return edAddBlock();
    if (a === 'struct') return showToast?.('Fenêtre Structure : étape 3c 🚧', '#e4b24a', 2400);
    if (i < 0) return;
    if (a === 'lock') {
      blocks[i].layout.locked = !bLocked(blocks[i]); this.commit(blocks);
      showToast?.(bLocked(blocks[i]) ? '🔒 Bloc verrouillé' : '🔓 Bloc déverrouillé', '#666', 1600);
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
/* Déplacement façon écran d'accueil : la carte décolle et suit le curseur.
   transform est piloté en inline par _follow → pas de transition dessus ici. */
.ed-drag{box-shadow:0 30px 70px rgba(0,0,0,.65)!important;cursor:grabbing;pointer-events:none;transition:none!important;will-change:transform}
.ed-drag::after{display:none!important}
/* La bulle « + » n'existe que pendant l'ÉDITION : en Aperçu elle disparaît
   totalement (comme sur le site publié, où elle n'est même pas générée). */
body:not(.ed-on) [data-add]{display:none!important}
/* Fantôme laissé à l'ancienne place */
.ed-ph{border:1px dashed rgba(200,255,0,.5)!important;border-radius:14px;background:rgba(200,255,0,.05)!important;pointer-events:none}
/* Retour visuel dès le pointerdown (avant décollage) : léger enfoncement + grab,
   et déjà plus de sélection de texte pendant l'attente (fin du bug signalé). */
.ed-hold{transform:scale(.995);cursor:grab;transition:transform .1s ease}
.ed-hold,.ed-hold *{user-select:none!important;-webkit-user-select:none!important}
/* Pendant le déplacement : plus aucune sélection de texte ni interaction publique */
.ed-dragging,.ed-dragging *{user-select:none!important;-webkit-user-select:none!important;cursor:grabbing!important}
[data-b]{touch-action:none}
[data-b]{transition:box-shadow .22s ease}
.ed-lock{position:absolute;top:6px;right:6px;z-index:59;font-size:10px;opacity:.75;pointer-events:none}
@media (hover:hover) and (pointer:fine){}`;
    doc.head.appendChild(s);
  },

  /* poignée ⋮⋮ sur chaque bloc (le drag ne part QUE de là → pas de conflit avec les textes/liens) */
  _decorate(doc) {
    doc.querySelectorAll('[data-b]').forEach(el => {
      if (!el.getAttribute('data-b') || el.querySelector(':scope>.ed-h')) return;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      // maintien n'importe où sur la carte → déplacement (sauf zones éditables)
      el.addEventListener('pointerdown', e => this._press(e, el));
      // la poignée reste comme repère visuel, mais décolle immédiatement
      const h = doc.createElement('div'); h.className = 'ed-h'; h.textContent = '⋮⋮'; h.title = 'Glisser pour déplacer';
      h.addEventListener('pointerdown', e => {
        if (this.mode !== 'edit') return;
        const bl = this.blocks().find(x => x.id === el.getAttribute('data-b'));
        if (bl && bLocked(bl)) return showToast?.('🔒 Bloc verrouillé', '#e4b24a', 2000);
        e.preventDefault(); e.stopPropagation();
        const doc2 = this.doc;
        this._lift(el, e.clientX, e.clientY);
        const mv = ev => { ev.preventDefault(); this._follow(ev); };
        const up = () => { this._drop(); doc2.removeEventListener('pointermove', mv); doc2.removeEventListener('pointerup', up); };
        doc2.addEventListener('pointermove', mv, { passive: false });
        doc2.addEventListener('pointerup', up);
      });
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

  _TYPES: { profile: 'Profil', project: 'Projet', link: 'Lien', text: 'Texte', reviews: 'Avis', contact: 'Contact', file: 'Document' },
  /** URL configurée sur un bloc (neutralisée en Édition, mais testable) */
  _linkOf(b) {
    if (!b) return '';
    if (b.type === 'link')    return (getLinks().find(x => String(x.id) === String(bRef(b))) || {}).url || '';
    if (b.type === 'project') return (getProjects().find(x => String(x.id) === String(bRef(b))) || {}).url || '';
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
    tb.innerHTML = `<span class="ed-ty">${this._TYPES[b.type] || 'Bloc'}${bLocked(b) ? ' 🔒' : ''}</span><span class="sep"></span>` +
      `<button data-a="move">⋮⋮ Déplacer</button><button data-a="edit">✎ Modifier</button>` +
      (inGrid ? `<button data-a="size">⤢ Taille</button>` : '') +
      `<button data-a="style">🎨 Style</button><button data-a="fx">⚡ Effets</button>` +
      `<button data-a="dup">⧉ Dupliquer</button><button data-a="hide">${bHidden(b) ? '👁 Afficher' : '👁 Masquer'}</button>` +
      `<button data-a="lock">${bLocked(b) ? '🔓' : '🔒'}</button><button data-a="del" title="Supprimer">🗑</button>` +
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
      blocks[i].visibility.public = bHidden(blocks[i]);   // masqué ⇄ public
      this.commit(blocks);
      // bascule la classe en local : pas de reconstruction du canvas (la transition
      // CSS fait le gris ↔ couleurs en ~200 ms), la sélection est conservée.
      const el = this.doc.querySelector('[data-b="' + (window.CSS && CSS.escape ? CSS.escape(this.sel) : this.sel) + '"]');
      if (el) el.classList.toggle('bl-hidden', bHidden(blocks[i]));
      this._toolbar(el);
      showToast?.(bHidden(blocks[i]) ? 'Bloc masqué — grisé ici, absent du site public' : 'Bloc réaffiché ✓', '#666', 2200);
    } else if (a === 'del') {
      const b = blocks[i];
      // Un bloc projet/lien référence une donnée réelle : la supprimer aussi,
      // sinon la réconciliation de getBlocks recréerait le bloc aussitôt.
      if (b.type === 'project' || b.type === 'link') {
        const key = b.type === 'project' ? 'hub_projects' : 'hub_links';
        const list = b.type === 'project' ? getProjects() : getLinks();
        const item = list.find(x => String(x.id) === String(bRef(b)));
        const nom = item ? (item.title || 'sans titre') : '';
        if (!confirm('Supprimer définitivement ' + (b.type === 'project' ? 'le projet' : 'le lien') + ' « ' + nom + ' » ?\n\nCette donnée sera retirée du Hub, pas seulement du site.')) return;
        localStorage.setItem(key, JSON.stringify(list.filter(x => String(x.id) !== String(bRef(b)))));
        if (typeof renderProjects === 'function') renderProjects();
        if (typeof syncKPIs === 'function') syncKPIs();
      }
      blocks.splice(i, 1); this.commit(blocks); this.sel = null; this.rerender();
      showToast?.('Supprimé — Ctrl+Z pour annuler', '#666', 2600);
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

  /* ══════════════════════════════════════════════════════════
     DÉPLACEMENT — maintien puis décollage, façon écran d'accueil mobile.
     Clic court = sélection. Maintien ~200 ms sans bouger = la carte décolle,
     se détache du flux, suit le curseur ; un fantôme garde sa place et les
     voisines se réorganisent avec une animation FLIP.
  ══════════════════════════════════════════════════════════ */
  // Délais de maintien avant décollage, par type de pointeur (§20).
  // Souris quasi immédiate ; tactile plus long pour ne pas voler un scroll.
  HOLD: { mouse: 120, pen: 160, touch: 260 },
  EARLY_AT: 70, EARLY_MOVE: 3, MOVE_TOL: 5, SCROLL_CANCEL: 12,
  /** éléments où le maintien ne doit PAS lancer un déplacement */
  _editable(t) {
    return !!(t && t.closest && t.closest('input,textarea,select,[contenteditable="true"],[data-no-drag],#ed-tb,.ed-rz,.ed-ctx'));
  },
  _press(e, el) {
    if (this.mode !== 'edit' || e.button === 2) return;
    if (this._ui(e.target) || this._editable(e.target)) return;
    // Décollage réservé à la grille Bento. En Flottante/Latérale le clic sélectionne
    // (barre flottante, édition) mais la réorganisation en flux viendra ensuite.
    if (!el.parentElement || !el.parentElement.classList.contains('bn-grid')) return;
    const bl = this.blocks().find(x => x.id === el.getAttribute('data-b'));
    if (bl && bLocked(bl)) return;
    const type = e.pointerType || 'mouse';
    const delay = this.HOLD[type] || this.HOLD.mouse;
    // Souris/stylet : on coupe tout de suite la sélection de texte (bug signalé).
    // Tactile : on NE bloque PAS encore (laisse le scroll possible tant que non décollé).
    if (type !== 'touch') e.preventDefault();
    const doc = this.doc, sx = e.clientX, sy = e.clientY, t0 = performance.now();
    el.classList.add('ed-hold');                 // retour visuel immédiat (scale .995)
    let live = false;
    const start = () => { if (live) return; live = true; clearTimeout(tmr); el.classList.remove('ed-hold'); this._lift(el, sx, sy); };
    const tmr = setTimeout(start, delay);
    const move = ev => {
      if (live) { ev.preventDefault(); this._follow(ev); return; }
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      const elapsed = performance.now() - t0;
      // Activation anticipée : maintenu ≥70 ms puis mouvement volontaire ≥3 px.
      if (elapsed >= this.EARLY_AT && dist >= this.EARLY_MOVE) { start(); ev.preventDefault(); this._follow(ev); return; }
      // Mouvement franc AVANT le seuil = scroll (tactile) ou clic-glissé : on abandonne.
      if (dist > (type === 'touch' ? this.SCROLL_CANCEL : this.MOVE_TOL)) { clearTimeout(tmr); el.classList.remove('ed-hold'); done(); }
    };
    const up = () => { clearTimeout(tmr); el.classList.remove('ed-hold'); if (live) this._drop(); done(); };
    const done = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up); };
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
  },

  /** la carte décolle : sortie du flux + fantôme à sa place */
  _lift(el, sx, sy) {
    const doc = this.doc, grid = el.parentElement;
    const r = el.getBoundingClientRect();
    this._dragging = true;
    this.deselect();
    doc.body.classList.add('ed-dragging');           // coupe user-select partout
    try { navigator.vibrate && navigator.vibrate(20); } catch (err) {}
    const ph = doc.createElement('article');          // fantôme = même empreinte
    ph.className = 'ed-ph'; ph.style.cssText = el.getAttribute('style') || '';
    grid.insertBefore(ph, el);
    Object.assign(el.style, {
      position: 'fixed', left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '9997',
    });
    el.classList.add('ed-drag');
    const b = this.blocks().find(x => x.id === el.getAttribute('data-b')) || {};
    const cs = getComputedStyle(grid);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || BLOCK_COLS;
    this._d = { el, ph, grid, sx, sy, dx: 0, dy: 0,
                w: Math.min(bW(b), BLOCK_COLS), h: bH(b),
                x: bX(b), y: bY(b), mobile: cols < BLOCK_COLS };
  },
  /** Cellule de grille sous le curseur (pixels → col/row). Adapté d'OpenBento. */
  _cellFromPointer(grid, clientX, clientY) {
    const r = grid.getBoundingClientRect(), cs = getComputedStyle(grid);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || BLOCK_COLS;
    const gapC = parseFloat(cs.columnGap || cs.gap) || 14;
    const gapR = parseFloat(cs.rowGap || cs.gap) || 14;
    const rowH = parseFloat(cs.gridAutoRows) || 150;
    const colW = (grid.clientWidth - gapC * (cols - 1)) / cols || 1;
    const col = Math.min(cols, Math.max(1, Math.floor((clientX - r.left) / (colW + gapC)) + 1));
    const row = Math.max(1, Math.floor((clientY - r.top) / (rowH + gapR)) + 1);
    return { col, row, cols };
  },
  _follow(ev) {
    const d = this._d; if (!d) return;
    d.dx = ev.clientX - d.sx; d.dy = ev.clientY - d.sy;
    const tilt = Math.max(-2, Math.min(2, d.dx / 40));   // rotation très légère
    d.el.style.transform = `translate(${d.dx}px,${d.dy}px) scale(1.02) rotate(${tilt}deg)`;
    if (d.mobile) {   // sous 820px la grille est en flux : on retombe sur l'échange de place
      const under = this.doc.elementFromPoint(ev.clientX, ev.clientY);
      const t = under && under.closest ? under.closest('[data-b]') : null;
      if (!t || t === d.el || t.parentElement !== d.grid) return;
      const r = t.getBoundingClientRect();
      const next = (ev.clientX - r.left) > r.width / 2 ? t.nextSibling : t;
      if (next !== d.ph) this._flip(d.grid, () => d.grid.insertBefore(d.ph, next));
      return;
    }
    // Placement absolu : le fantôme se pose sur la cellule visée, bornée à la grille
    const { col, row, cols } = this._cellFromPointer(d.grid, ev.clientX, ev.clientY);
    const w = Math.min(d.w, cols);
    const x = Math.max(1, Math.min(col, cols - w + 1)), y = Math.max(1, row);
    if (x === d.x && y === d.y) return;
    d.x = x; d.y = y;
    d.ph.style.gridColumn = x + '/span ' + w;
    d.ph.style.gridRow = y + '/span ' + d.h;
  },
  /** FLIP : réorganisation animée des voisines (sinon la grille saute) */
  _flip(grid, mutate) {
    const cells = [...grid.children].filter(c => c !== this._d.el);
    const before = new Map(cells.map(c => [c, c.getBoundingClientRect()]));
    mutate();
    cells.forEach(c => {
      const a = before.get(c), b = c.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => {
        c.style.transition = 'transform .26s cubic-bezier(.2,.9,.3,1)';
        c.style.transform = '';
      });
    });
  },
  /** dépose la carte à la place du fantôme */
  _drop() {
    const d = this._d; if (!d) return;
    const { el, ph, grid } = d;
    grid.insertBefore(el, ph); ph.remove();
    ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'transform'].forEach(p => el.style.removeProperty(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase())));
    el.classList.remove('ed-drag');
    this.doc.body.classList.remove('ed-dragging');
    this._dragging = false;
    const id = el.getAttribute('data-b');
    if (d.mobile) { this._order(grid); }
    else {
      // Pose le bloc à ses nouvelles coordonnées. Il PASSE EN TÊTE du tableau :
      // placeBlocks respecte l'ordre, donc c'est lui qui garde la place voulue et
      // ce sont les blocs gênants qui sont délogés (jamais de chevauchement).
      const blocks = this.blocks();
      const i = blocks.findIndex(b => b.id === id);
      if (i >= 0 && d.x && d.y) {
        const [b] = blocks.splice(i, 1);
        b.layout.x = d.x; b.layout.y = d.y;
        blocks.unshift(b);
        this.commit(placeBlocks(blocks));
        this.rerender();
        this._say('Bloc déplacé en colonne ' + d.x + ', ligne ' + d.y);
        this._d = null;
        return;
      }
    }
    this._d = null;
    this.select(id);
    this._say('Bloc déplacé');
  },
  /** annonce pour lecteurs d'écran */
  _say(msg) {
    const doc = this.doc; if (!doc) return;
    let l = doc.getElementById('ed-live');
    if (!l) { l = doc.createElement('div'); l.id = 'ed-live'; l.setAttribute('aria-live', 'polite');
      l.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'; doc.body.appendChild(l); }
    l.textContent = msg;
  },
  /** déplacement au clavier : Alt + flèches */
  _moveKey(dir) {
    const blocks = this.blocks();
    const i = blocks.findIndex(b => b.id === this.sel);
    if (i < 0) return;
    if (bLocked(blocks[i])) return showToast?.('🔒 Bloc verrouillé', '#e4b24a', 1800);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    this.commit(blocks); this.rerender();
    this._say('Bloc déplacé en position ' + (j + 1) + ' sur ' + blocks.length);
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
    if (bLocked(b)) return showToast?.('🔒 Bloc verrouillé', '#e4b24a', 2000);
    const i = blocks.indexOf(b);
    blocks.splice(i, 1); b.layout.w = s.w; b.layout.h = s.h; blocks.unshift(b);
    this.commit(placeBlocks(blocks));   // aucun chevauchement
    this.rerender();
  },
  _winSize(anchorRect) {
    const b = this.blocks().find(x => x.id === this.sel) || {};
    const cur = this._nearestSize(bW(b), bH(b)).k;
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
      const i = blocks.findIndex(x => x.id === el.getAttribute('data-b'));
      if (i >= 0) {
        const [b] = blocks.splice(i, 1);      // prioritaire : il garde sa place
        b.layout.w = s.w; b.layout.h = s.h;
        blocks.unshift(b);
        this.commit(placeBlocks(blocks));     // les voisins gênés sont délogés
        this.rerender();
      }
      showToast?.('Taille : ' + s.n, '#666', 1200);
    };
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up);
  },

  /* ══ modes Édition / Aperçu ══ */
  setMode(m) {
    this.mode = m;
    // Passer en Aperçu ferme toute couche flottante : sinon une micro-fenêtre
    // d'édition resterait par-dessus l'aperçu, qu'elle ne concerne plus.
    window.DismissLayer?.close('mode');
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
    // Échap ferme d'abord la couche flottante ; il faut un SECOND Échap pour
    // désélectionner le bloc (sinon fermer une fenêtre perd la sélection).
    if (k === 'escape') {
      e.preventDefault();
      if (window.DismissLayer?.close('escape')) return;
      return this.deselect();
    }
    if (!this.sel) return;
    // Alt + flèches : déplacer le bloc au clavier (accessibilité)
    if (e.altKey && (k === 'arrowleft' || k === 'arrowup')) { e.preventDefault(); return this._moveKey(-1); }
    if (e.altKey && (k === 'arrowright' || k === 'arrowdown')) { e.preventDefault(); return this._moveKey(1); }
    if (mod && k === 'c') { e.preventDefault(); return this._ctxAct('copy'); }
    if (mod && k === 'v') { e.preventDefault(); return this.paste(); }
    if (mod && k === 'd') { e.preventDefault(); return this._act('dup'); }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); return this._act('del'); }
  },
};
window.EdCanvas = EdCanvas;
document.addEventListener('keydown', e => EdCanvas._key(e));

/* Résumé de migration : affiché UNE fois, quand les projets de l'ancienne page
   Portfolio deviennent des blocs de l'éditeur. Aucune donnée n'est touchée. */
function edMigrationNotice() {
  try {
    if (localStorage.getItem('hub_migr_portfolio')) return;
    const projs = getProjects(), links = getLinks();
    if (!projs.length && !links.length) return;
    const gifs = projs.filter(p => /^data:image\/gif|\.gif($|\?)/i.test(p.cover || '')).length;
    localStorage.setItem('hub_migr_portfolio', '1');
    const parts = [];
    if (projs.length) parts.push(projs.length + ' projet' + (projs.length > 1 ? 's' : ''));
    if (links.length) parts.push(links.length + ' lien' + (links.length > 1 ? 's' : ''));
    if (gifs) parts.push(gifs + ' GIF');
    setTimeout(() => showToast?.(
      '✓ Portfolio & Profil Links migrés dans l\'Éditeur — ' + parts.join(' · ') + ' · 0 donnée perdue',
      '#2e9a63', 6000), 1200);
  } catch (e) {}
}
document.addEventListener('DOMContentLoaded', edMigrationNotice);

/* ══════════════════════════════════════════════════════════════
   DismissLayer — UNE SEULE couche flottante ouverte à la fois.

   Toutes les micro-fenêtres (Thème, Effets, Taille, Visibilité, palette
   « + », menu contextuel…) passent par ici. Règles : clic extérieur ferme,
   Échap ferme, ouvrir une autre ferme la précédente, changer de page ou
   passer en Aperçu ferme, et le focus revient au bouton d'origine.

   ⚠ POURQUOI UN MODULE DÉDIÉ : l'éditeur vit dans une IFRAME. Un clic dans
   le canvas ne remonte donc PAS jusqu'au document parent — les fenêtres
   restaient ouvertes quand on cliquait sur le site, c'est-à-dire dans le
   cas le plus fréquent. On écoute le parent ET les iframes de même origine.

   `pointerdown` (et non `mousedown`) pour couvrir souris, tactile et stylet.
══════════════════════════════════════════════════════════════ */
const DismissLayer = {
  _cur: null,

  /** Le document parent + toute iframe accessible (même origine). */
  _docs() {
    const out = [document];
    document.querySelectorAll('iframe').forEach(f => {
      let d = null;
      try { d = f.contentDocument; } catch (e) {}   // cross-origin → inaccessible, on ignore
      if (d) out.push(d);
    });
    return out;
  },

  /** el : l'élément flottant · anchor : le bouton qui l'a ouvert · onClose(raison) */
  open({ el, anchor, onClose }) {
    this.close('replaced');
    const layer = { el, anchor: anchor || null, onClose: onClose || null, docs: this._docs() };

    layer.down = e => {
      if (el.contains(e.target)) return;                                   // dans la fenêtre
      if (layer.anchor && layer.anchor.contains && layer.anchor.contains(e.target)) return;  // sur son bouton
      this.close('outside');
    };
    layer.key = e => { if (e.key === 'Escape') { e.preventDefault(); this.close('escape'); } };

    // Différé : sinon le clic qui vient d'ouvrir la fenêtre la referme aussitôt.
    setTimeout(() => {
      if (this._cur !== layer) return;
      layer.docs.forEach(d => {
        d.addEventListener('pointerdown', layer.down, true);
        d.addEventListener('keydown', layer.key);
      });
    }, 0);

    this._cur = layer;
    return layer;
  },

  close(reason) {
    const l = this._cur; if (!l) return false;
    this._cur = null;
    l.docs.forEach(d => {
      try {
        d.removeEventListener('pointerdown', l.down, true);
        d.removeEventListener('keydown', l.key);
      } catch (e) {}
    });
    if (l.el && l.el.remove) l.el.remove();
    if (l.onClose) { try { l.onClose(reason); } catch (e) { console.warn('[dismiss]', e); } }
    // Le focus revient au bouton d'origine : sans ça, Échap laisse le focus dans
    // le vide et la navigation au clavier repart du haut de la page.
    // Sauf si une AUTRE fenêtre vient de prendre la place ('replaced').
    if (l.anchor && l.anchor.focus && reason !== 'replaced') {
      try { l.anchor.focus({ preventScroll: true }); } catch (e) {}
    }
    return true;
  },

  isOpen() { return !!this._cur; },

  /* L'iframe d'aperçu vient d'être rechargée. Deux cas très différents :
     – la couche vivait DEDANS (menu contextuel) : elle a été détruite avec
       l'ancien document sans passer par close() → on purge le registre ;
     – la couche vit dans le PARENT (micro-fenêtre) : elle doit SURVIVRE —
       on tape justement dedans, et chaque frappe recharge l'aperçu. On se
       contente de rebrancher ses écouteurs sur le nouveau document, sinon
       cliquer dans le canvas ne la fermerait plus. */
  onFrameReload() {
    const l = this._cur; if (!l) return;
    if (l.el && !document.contains(l.el)) { this.close('reload'); return; }
    l.docs.forEach(d => {
      try { d.removeEventListener('pointerdown', l.down, true); d.removeEventListener('keydown', l.key); } catch (e) {}
    });
    l.docs = this._docs();
    l.docs.forEach(d => {
      d.addEventListener('pointerdown', l.down, true);
      d.addEventListener('keydown', l.key);
    });
  },
};
window.DismissLayer = DismissLayer;

/* ══════════════════════════════════════════════════════════════
   EdWin — micro-fenêtres flottantes (remplacent le panneau Propriétés).
   Ancrées au bouton déclencheur, jamais hors écran. Fermeture : DismissLayer.
══════════════════════════════════════════════════════════════ */
const EdWin = {
  el: null,
  /** cls : classe optionnelle (ex. 'wide') — appliquée AVANT la mesure, sinon
      la fenêtre serait positionnée d'après une largeur qui n'est plus la sienne. */
  open(anchor, title, html, onMount, cls) {
    // Fermer AVANT de créer la suivante : l'ancienne remet `this.el` à null en
    // se fermant, donc la fermer après l'avoir remplacée effacerait la nouvelle.
    this.close();
    const w = document.createElement('div');
    w.className = 'edwin' + (cls ? ' ' + cls : '');
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
    DismissLayer.open({ el: w, anchor, onClose: () => { this.el = null; } });
    if (onMount) onMount(w);
    // Focus au premier champ : la fenêtre devient utilisable au clavier sans
    // repasser par la souris (et Échap rend le focus au bouton d'origine).
    const first = w.querySelector('input,select,textarea,button:not(.edwin-x)');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
    return w;
  },
  close() { return DismissLayer.close('edwin'); },
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
  // La valeur 'premium' est conservée (configs déjà enregistrées) : seul le
  // LIBELLÉ change — plus aucun rapport avec un plan payant, qui n'existe plus.
  const lv = [['none', 'Aucune'], ['light', 'Légères'], ['smooth', 'Fluides'], ['premium', 'Intenses']];
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

/* ══════════════════════════════════════════════════════════════
   ☰ Sections — les noms ne sont plus imposés.

   Chaque section se renomme, se décrit, change d'icône, se masque et se
   réordonne. Ce qui n'est PAS modifié garde sa valeur d'origine (voir
   SEC_DEFAULTS dans core.js) : un site publié avant cette version ne
   change pas d'apparence tant qu'on n'y touche pas.
══════════════════════════════════════════════════════════════ */
const ED_SEC_DEFAULTS = {
  about:    { title: 'À propos',    heading: 'Qui suis-je ?',        icon: '◈' },
  projects: { title: 'Portfolio',   heading: 'Mes projets',          icon: '▦' },
  avis:     { title: 'Témoignages', heading: 'Avis clients',         icon: '★' },
  contact:  { title: 'Contact',     heading: 'Travaillons ensemble', icon: '✉' },
};
const ED_SEC_KEYS = ['about', 'projects', 'avis', 'contact'];

/** Métadonnées effectives d'une section : valeurs d'origine + personnalisation. */
function edSecMeta(k) {
  const c = SiteConfig.get();
  return { ...(ED_SEC_DEFAULTS[k] || {}), ...(((c.sectionMeta || {})[k]) || {}) };
}
/** Écrit UN champ d'UNE section sans toucher aux autres. */
function edSecSet(k, field, value, live) {
  const c = SiteConfig.get();
  const all = { ...(c.sectionMeta || {}) };
  all[k] = { ...(all[k] || {}), [field]: value };
  edSet('sectionMeta', all, live);
}
/** Ordre courant, complété si la config est partielle ou ancienne. */
function edSecOrder() {
  const c = SiteConfig.get();
  const o = (Array.isArray(c.sectionOrder) && c.sectionOrder.length ? c.sectionOrder.slice() : ED_SEC_KEYS.slice())
            .filter(k => ED_SEC_KEYS.includes(k));
  ED_SEC_KEYS.forEach(k => { if (!o.includes(k)) o.push(k); });
  return o;
}

function edWinSections(btn) {
  const draw = () => {
    const c = SiteConfig.get();
    const vis = { projects: true, avis: true, contact: true, about: true, ...(c.sections || {}) };
    const ord = edSecOrder();
    return ord.map((k, i) => {
      const m = edSecMeta(k), off = vis[k] === false;
      return `
      <div class="edw-sec${off ? ' off' : ''}">
        <div class="edw-sec-h">
          <button class="edw-sec-mv" data-mv="up"   data-k="${k}"${i === 0 ? ' disabled' : ''} title="Monter">↑</button>
          <button class="edw-sec-mv" data-mv="down" data-k="${k}"${i === ord.length - 1 ? ' disabled' : ''} title="Descendre">↓</button>
          <input class="edw-sec-ic" data-k="${k}" data-f="icon" value="${_eesc(m.icon || '')}" maxlength="2" title="Icône">
          <input class="edw-sec-t"  data-k="${k}" data-f="title" value="${_eesc(m.title || '')}" placeholder="Nom de la section">
          <button class="edw-sec-eye" data-eye="${k}" title="${off ? 'Afficher' : 'Masquer'} la section">${off ? '◌' : '👁'}</button>
        </div>
        <div class="edw-sec-b">
          <input class="edw-sec-t" data-k="${k}" data-f="heading" value="${_eesc(m.heading || '')}" placeholder="Grand titre affiché">
          <textarea class="edw-sec-d" data-k="${k}" data-f="desc" rows="2" placeholder="Description (facultative)">${_eesc(m.desc || '')}</textarea>
          <label class="edw-tog"><input type="checkbox" data-k="${k}" data-f="showTitle"${m.showTitle === false ? '' : ' checked'}> Afficher le titre</label>
          <label class="edw-tog"><input type="checkbox" data-k="${k}" data-f="showDesc"${m.showDesc === false ? '' : ' checked'}> Afficher la description</label>
          <button class="edw-sec-rst" data-rst="${k}">↺ Revenir au nom d'origine</button>
        </div>
      </div>`;
    }).join('');
  };

  EdWin.open(btn, '☰ Sections', `<div id="edw-sec-list">${draw()}</div>
    <p class="edw-hint" style="margin-top:10px">Une section sans contenu (aucun texte « À propos », aucun projet…) ne s'affiche pas, même visible.</p>`, w => {
    const list = w.querySelector('#edw-sec-list');
    // Redessine SANS refermer la fenêtre (l'ordre et les icônes changent).
    const redraw = () => { list.innerHTML = draw(); bind(); };
    const bind = () => {
      list.querySelectorAll('input[data-f], textarea[data-f]').forEach(el => {
        if (el.type === 'checkbox') el.onchange = () => edSecSet(el.dataset.k, el.dataset.f, el.checked);
        // `live` : la frappe met à jour l'aperçu sans recharger toute l'iframe,
        // sinon on perdrait le focus du champ à chaque lettre.
        else el.oninput = () => edSecSet(el.dataset.k, el.dataset.f, el.value, true);
      });
      list.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
        const o = edSecOrder(), i = o.indexOf(b.dataset.k), j = b.dataset.mv === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= o.length) return;
        [o[i], o[j]] = [o[j], o[i]];
        edSet('sectionOrder', o); redraw();
      });
      list.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
        const k = b.dataset.eye, c = SiteConfig.get();
        const s = { projects: true, avis: true, contact: true, about: true, ...(c.sections || {}) };
        s[k] = s[k] === false;
        edSet('sections', s); redraw();
      });
      list.querySelectorAll('[data-rst]').forEach(b => b.onclick = () => {
        const k = b.dataset.rst, c = SiteConfig.get();
        const all = { ...(c.sectionMeta || {}) };
        delete all[k];
        edSet('sectionMeta', all); redraw();
        showToast?.('Section « ' + ED_SEC_DEFAULTS[k].title + ' » réinitialisée', '#666', 1800);
      });
    };
    bind();
  }, 'wide');
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
    html = F('e1', 'Titre', bProps(b).title || '') + F('e2', 'Texte', bProps(b).text || '', 'area');
    save = w => { const bl = getBlocks(SiteConfig.get()); const x = bl.find(y => y.id === blockId);
      x.content = { ...(x.content || {}), title: w.querySelector('#e1').value, text: w.querySelector('#e2').value };
      SiteConfig.set('blocks', bl);
      if (x.content.title === 'À propos') SiteConfig.set('about', x.content.text); };
  } else if (b.type === 'file') {
    const pr = bProps(b);
    title = '✎ Document';
    html = F('e1', 'Titre affiché', pr.title || '') + F('e2', 'Sous-titre', pr.sub || '')
         + `<div class="edw-l">Fichier</div><div class="edw-hint" style="font-size:9px">${_eesc(pr.url || '(aucun)')}</div>`;
    save = w => {
      const bl = getBlocks(SiteConfig.get()); const x = bl.find(y => y.id === blockId);
      x.content = { ...(x.content || {}), title: w.querySelector('#e1').value, sub: w.querySelector('#e2').value };
      SiteConfig.set('blocks', bl);
    };
  } else if (b.type === 'contact') {
    title = '✎ Contact';
    html = F('e1', 'Adresse e-mail', c.email);
    save = w => SiteConfig.set('email', w.querySelector('#e1').value);
  } else if (b.type === 'link') {
    const l = getLinks().find(x => String(x.id) === String(bRef(b))) || {};
    title = '✎ Lien';
    html = F('e1', 'Libellé', l.title || '') + F('e2', 'URL', l.url || '');
    save = w => { const ls = getLinks(); const x = ls.find(y => String(y.id) === String(bRef(b)));
      if (x) { x.title = w.querySelector('#e1').value; x.url = w.querySelector('#e2').value;
               localStorage.setItem('hub_links', JSON.stringify(ls)); } };
  } else if (b.type === 'project') {
    const p = getProjects().find(x => String(x.id) === String(bRef(b))) || {};
    const f = bFocal(b);
    title = '✎ Projet';
    html = F('e1', 'Titre', p.title || '') + F('e2', 'Tags (séparés par une virgule)', (p.tags || []).join(', '))
         + F('e3', 'Lien du projet', p.url || '') + F('e4', 'Couverture — URL image', p.cover || '')
         // Cadrage NON destructif : on ne touche jamais au fichier (les GIF restent animés)
         + (p.cover ? `<div class="edw-l">Cadrage de la couverture <span class="edw-hint">le fichier n'est pas modifié</span></div>
             <div class="edw-focal" id="fz"><div id="fp" style="background:url('${_eesc(p.cover)}') ${f.x}% ${f.y}%/cover"></div></div>
             <div class="edw-fx2">
               <label>Horizontal <input type="range" id="fx" min="0" max="100" value="${f.x}"></label>
               <label>Vertical <input type="range" id="fy" min="0" max="100" value="${f.y}"></label>
             </div>` : '');
    save = w => {
      const ps = getProjects(); const x = ps.find(y => String(y.id) === String(bRef(b)));
      if (x) { x.title = w.querySelector('#e1').value;
               x.tags = w.querySelector('#e2').value.split(',').map(t => t.trim()).filter(Boolean);
               x.url = w.querySelector('#e3').value; x.cover = w.querySelector('#e4').value;
               localStorage.setItem('hub_projects', JSON.stringify(ps));
               if (typeof renderProjects === 'function') renderProjects(); }
      const fx = w.querySelector('#fx'), fy = w.querySelector('#fy');
      if (fx && fy) {   // le point focal vit dans le bloc (modèle V3), pas dans le fichier
        const bl = getBlocks(SiteConfig.get()); const y = bl.find(z => z.id === blockId);
        if (y) { y.content = { ...(y.content || {}), mediaPosition: { x: +fx.value, y: +fy.value } };
                 SiteConfig.set('blocks', bl); }
      }
    };
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
    // aperçu du cadrage en direct (aucun ré-encodage, juste du CSS)
    const fx = w.querySelector('#fx'), fy = w.querySelector('#fy'), fp = w.querySelector('#fp');
    if (fx && fy && fp) {
      const upd = () => { fp.style.backgroundPosition = fx.value + '% ' + fy.value + '%'; };
      fx.oninput = upd; fy.oninput = upd;
    }
    const ok = w.querySelector('#edw-save');
    if (ok) ok.onclick = () => { save(w); EdWin.close(); edRefreshPreview(); showToast?.('Modifié ✓', '#2e9a63', 1500); };
  });
}
/* ── ＋ Ajouter un projet (remplace toute l'ancienne page Portfolio) ── */
function edAddProject() {
  const projs = getProjects();
  const html = `
    <div class="edw-l">Couverture</div>
    <div class="edw-drop" id="ap-drop">
      <input type="file" id="ap-file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" hidden>
      <div id="ap-dz"><b>Glisse une image ou un GIF ici</b><span>ou clique pour choisir</span></div>
      <img id="ap-prev" alt="">
    </div>
    <div id="ap-info" class="edw-fileinfo"></div>
    <div class="edw-l">…ou coller une URL d'image</div>
    <input class="edw-in" id="ap-url" placeholder="https://…/image.jpg">
    <div class="edw-l">Titre</div>
    <input class="edw-in" id="ap-title" placeholder="Nom du projet">
    <div class="edw-l">Tags (séparés par une virgule)</div>
    <input class="edw-in" id="ap-tags" placeholder="branding, motion">
    <div class="edw-l">Lien du projet</div>
    <input class="edw-in" id="ap-link" placeholder="https://behance.net/…">
    ${projs.length ? `<div class="edw-l">…ou dupliquer un projet existant</div>
      <select class="edw-in" id="ap-dup"><option value="">— choisir —</option>${projs.map(p => `<option value="${_eesc(p.id)}">${_eesc(p.title || 'Sans titre')}</option>`).join('')}</select>` : ''}
    <button class="edw-ok" id="ap-ok">Créer le projet</button>`;
  EdWin.open(null, '＋ Nouveau projet', html, w => {
    let cover = '';
    const dz = w.querySelector('#ap-dz'), prev = w.querySelector('#ap-prev'),
          info = w.querySelector('#ap-info'), drop = w.querySelector('#ap-drop'), file = w.querySelector('#ap-file');
    const ko = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.round(n / 1024) + ' Ko';
    const take = f => {
      if (!f || !/^image\//.test(f.type)) return showToast?.('Format non supporté', '#c0392b', 2200);
      const gif = f.type === 'image/gif';
      info.textContent = f.name + ' · ' + ko(f.size) + ' · ' + f.type.replace('image/', '').toUpperCase() + ' · lecture…';
      const rd = new FileReader();
      rd.onload = e => {
        const raw = e.target.result;
        const done = (src, note) => {
          cover = src; prev.src = src; drop.classList.add('has');
          info.textContent = f.name + ' · ' + ko(f.size) + ' → ' + ko(Math.round(src.length * 0.75)) + ' · ' + note;
        };
        // ⚠ Un GIF ne doit JAMAIS passer par la compression WebP : elle le figerait.
        if (gif) return done(raw, 'GIF conservé animé (non compressé)');
        compressImageSrc(raw, out => done(out || raw, out ? 'optimisé en WebP' : 'original conservé'));
      };
      rd.readAsDataURL(f);
    };
    dz.onclick = () => file.click();
    file.onchange = e => take(e.target.files[0]);
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => take(e.dataTransfer.files[0]));
    const dup = w.querySelector('#ap-dup');
    if (dup) dup.onchange = () => {
      const p = projs.find(x => String(x.id) === dup.value); if (!p) return;
      w.querySelector('#ap-title').value = (p.title || '') + ' (copie)';
      w.querySelector('#ap-tags').value = (p.tags || []).join(', ');
      w.querySelector('#ap-link').value = p.url || '';
      if (p.cover) { cover = p.cover; prev.src = p.cover; drop.classList.add('has'); info.textContent = 'Couverture reprise du projet dupliqué'; }
    };
    w.querySelector('#ap-ok').onclick = () => {
      const title = w.querySelector('#ap-title').value.trim();
      if (!title) return showToast?.('Donne un titre au projet', '#c0392b', 2000);
      const src = cover || w.querySelector('#ap-url').value.trim();
      const p = { id: Date.now().toString(), title,
        tags: w.querySelector('#ap-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        url: w.querySelector('#ap-link').value.trim(), cover: src, views: 0, createdAt: Date.now() };
      const ps = getProjects(); ps.push(p);
      try { localStorage.setItem('hub_projects', JSON.stringify(ps)); }
      catch (err) { return showToast?.('⚠ Image trop lourde pour le stockage local — utilise une URL', '#c0392b', 4000); }
      // getBlocks réconcilie → le bloc du nouveau projet apparaît tout seul
      EdWin.close();
      if (typeof renderProjects === 'function') renderProjects();
      if (typeof syncKPIs === 'function') syncKPIs();
      edRefreshPreview();
      showToast?.('Projet « ' + title + ' » ajouté ✓', '#2e9a63', 2200);
    };
  });
}
window.edAddProject = edAddProject;

/* ── ＋ Palette d'ajout de blocs (multi-types) ── */
function edPushBlock(raw) {
  const blocks = getBlocks(SiteConfig.get());
  blocks.push(normalizeBlock(raw));
  EdCanvas.commit(placeBlocks(blocks));
  EdCanvas.rerender();
}
function edCreateText() {
  edPushBlock({ id: blockUid('text'), type: 'text', props: { title: '', text: 'Nouveau texte — double-clic pour modifier' }, w: 2, h: 1 });
  EdWin.close();
  showToast?.('Bloc texte ajouté ✓', '#2e9a63', 1800);
}
function edCreateSocial(pid) {
  const p = socialById(pid);
  EdWin.open(null, p.icon + ' ' + p.label, `
    <div class="edw-l">${p.label} — identifiant / lien</div>
    <input class="edw-in" id="soc-h" placeholder="${_eesc(p.placeholder)}">
    <div class="edw-hint" style="margin-top:6px">L'URL est construite automatiquement.</div>
    <button class="edw-ok" id="soc-ok">Ajouter le bloc ${_eesc(p.label)}</button>`, w => {
    const inp = w.querySelector('#soc-h'); setTimeout(() => inp.focus(), 30);
    const go = () => {
      const v = inp.value.trim(); if (!v) return showToast?.('Renseigne ton ' + p.label, '#c0392b', 1800);
      const links = getLinks(); const id = Date.now().toString();
      links.push({ id, title: p.label, url: p.buildUrl(v), clicks: 0, platform: p.id });
      localStorage.setItem('hub_links', JSON.stringify(links));
      EdCanvas.commit(placeBlocks(getBlocks(SiteConfig.get())));   // réconcilie → bloc lien créé
      EdCanvas.rerender(); EdWin.close();
      showToast?.('Bloc ' + p.label + ' ajouté ✓', '#2e9a63', 2000);
    };
    w.querySelector('#soc-ok').onclick = go;
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
function edAddBlock() {
  const soc = SOCIAL_PLATFORMS.map(p =>
    `<button class="edp-b" data-soc="${p.id}" title="${_eesc(p.label)}"><span style="color:${p.color}">${p.icon}</span>${_eesc(p.label)}</button>`).join('');
  const html = `
    <div class="edw-l">Portfolio</div>
    <div class="edp-grid"><button class="edp-b" data-a="project"><span>🗂️</span>Projet</button></div>
    <div class="edw-l">Réseaux & liens</div>
    <div class="edp-grid">${soc}</div>
    <div class="edw-l">Contenu</div>
    <div class="edp-grid"><button class="edp-b" data-a="text"><span>✍️</span>Texte</button></div>`;
  EdWin.open(null, '＋ Ajouter un bloc', html, w => {
    w.querySelectorAll('[data-soc]').forEach(b => b.onclick = () => edCreateSocial(b.dataset.soc));
    w.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      if (b.dataset.a === 'project') { EdWin.close(); edAddProject(); }
      else if (b.dataset.a === 'text') edCreateText();
    });
  });
}
window.edAddBlock = edAddBlock;
window.edWinTheme = edWinTheme; window.edWinFx = edWinFx; window.edWinEdit = edWinEdit;
