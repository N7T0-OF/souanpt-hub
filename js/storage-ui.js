'use strict';
/**
 * storage-ui.js — Explorateur de fichiers (page Stockage).
 * S'appuie sur HubFiles (core.js) : les fichiers vivent sur GitHub
 * (public = dépôt du site, privé = dépôt privé), les métadonnées dans hub_files.
 * Aucun fichier n'est stocké dans le navigateur : pas de plafond 5 Mo.
 */
const StorageUI = {
  view: 'grid', filter: 'all',
  ICONS: { image: '🖼️', gif: '🎞️', video: '🎬', audio: '🎵', pdf: '📄', document: '📃', archive: '🗜️' },
  FILTERS: [
    ['all', 'Tous'], ['image', 'Images'], ['gif', 'GIF'], ['video', 'Vidéos'],
    ['audio', 'Audio'], ['pdf', 'PDF'], ['document', 'Documents'], ['archive', 'Archives'],
    ['trash', '🗑 Corbeille'],
  ],

  _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  _size(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko'; },
  _date(t) { try { return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }); } catch (e) { return ''; } },

  setView(v) { this.view = v; document.querySelectorAll('#st-view button').forEach(b => b.classList.toggle('active', b.dataset.v === v)); this.render(); },
  setFilter(f) { this.filter = f; this.render(); },
  pick() { document.getElementById('st-input')?.click(); },

  /** Normalise pour une recherche INSENSIBLE AUX ACCENTS (« banniere » trouve « Bannière ») */
  _norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },

  /** Fichiers correspondant au filtre + à la recherche */
  _visible() {
    const q = this._norm(document.getElementById('st-search')?.value);
    return HubFiles.list().filter(f => {
      const inTrash = f.status === 'trash';
      if (this.filter === 'trash' ? !inTrash : inTrash) return false;
      if (this.filter !== 'all' && this.filter !== 'trash' && f.kind !== this.filter) return false;
      if (q && !this._norm((f.displayName || f.name || '') + ' ' + (f.folder || '') + ' ' + (f.tags || []).join(' ')).includes(q)) return false;
      return true;
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  render() {
    const wrap = document.getElementById('st-files'); if (!wrap) return;
    // filtres (avec compteurs)
    const all = HubFiles.list();
    const fbox = document.getElementById('st-filters');
    if (fbox) fbox.innerHTML = this.FILTERS.map(([k, label]) => {
      const n = k === 'all' ? all.filter(f => f.status !== 'trash').length
        : k === 'trash' ? all.filter(f => f.status === 'trash').length
          : all.filter(f => f.status !== 'trash' && f.kind === k).length;
      if (!n && k !== 'all' && k !== 'trash') return '';
      return `<button class="st-f${this.filter === k ? ' on' : ''}" onclick="StorageUI.setFilter('${k}')">${label}${n ? ` <b>${n}</b>` : ''}</button>`;
    }).join('');

    const files = this._visible();
    const empty = document.getElementById('st-empty');
    if (empty) empty.style.display = files.length ? 'none' : 'block';
    wrap.className = this.view === 'grid' ? 'st-grid' : 'st-list';
    wrap.innerHTML = files.map(f => this.view === 'grid' ? this._card(f) : this._row(f)).join('');
    this._summary(all);
    this._paint();          // état sélectionné + barre d'actions groupées
  },

  _badge(f) {
    return f.visibility === 'public'
      ? '<span class="st-b pub">🌍 Public</span>'
      : '<span class="st-b prv">🔒 Privé</span>';
  },
  _menu(f) {
    const t = f.status === 'trash';
    return `<div class="st-act">
      ${t ? `<button onclick="StorageUI.restore('${f.id}')" title="Restaurer">↩</button>
             <button onclick="StorageUI.destroy('${f.id}')" title="Supprimer définitivement">✕</button>`
        : `<button onclick="StorageUI.preview('${f.id}')" title="Aperçu rapide (Espace)">👁</button>
             <button onclick="StorageUI.addToSite('${f.id}')" title="Ajouter à mon site">＋</button>
             <button onclick="StorageUI.toggleVis('${f.id}')" title="${f.visibility === 'public' ? 'Rendre privé' : 'Rendre public'}">${f.visibility === 'public' ? '🔒' : '🌍'}</button>
             <button onclick="StorageUI.replace('${f.id}')" title="Remplacer (garde le même lien)">⇄</button>
             <button onclick="StorageUI.trash('${f.id}')" title="Mettre à la corbeille">🗑</button>`}
    </div>`;
  },
  _card(f) {
    const thumb = (f.kind === 'image' || f.kind === 'gif') && f.visibility === 'public'
      ? `<div class="st-th" style="background:url('${this._esc(HubFiles.publicUrl(f))}') center/cover"></div>`
      : `<div class="st-th"><span>${this.ICONS[f.kind] || '📃'}</span></div>`;
    return `<article class="st-card${this.sel.has(f.id) ? ' on' : ''}" data-f="${this._esc(f.id)}" onclick="StorageUI.toggle('${f.id}',event)" ondblclick="StorageUI.preview('${f.id}')">
      ${thumb}
      <div class="st-meta">
        <div class="st-n" title="${this._esc(f.displayName || f.name)}">${this._esc(f.displayName || f.name)}</div>
        <div class="st-s">${this._size(f.size)} · ${this._esc(f.ext || f.kind)}</div>
        ${this._badge(f)}
      </div>
      ${this._menu(f)}
    </article>`;
  },
  _row(f) {
    return `<div class="st-row${this.sel.has(f.id) ? ' on' : ''}" data-f="${this._esc(f.id)}" onclick="StorageUI.toggle('${f.id}',event)" ondblclick="StorageUI.preview('${f.id}')">
      <span class="st-ri">${this.ICONS[f.kind] || '📃'}</span>
      <span class="st-rn" title="${this._esc(f.displayName || f.name)}">${this._esc(f.displayName || f.name)}</span>
      <span class="st-rk">${this._esc(f.ext || f.kind)}</span>
      <span>${this._badge(f)}</span>
      <span class="st-rs">${this._size(f.size)}</span>
      <span class="st-rd">${this._date(f.updatedAt)}</span>
      ${this._menu(f)}
    </div>`;
  },
  _summary(all) {
    const box = document.getElementById('st-summary'); if (!box) return;
    const act = all.filter(f => f.status !== 'trash');
    const tot = act.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const pub = act.filter(f => f.visibility === 'public').length;
    const by = {}; act.forEach(f => { by[f.kind] = (by[f.kind] || 0) + (Number(f.size) || 0); });
    const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, v]) => `${this.ICONS[k] || '📃'} ${this._size(v)}`).join(' · ');
    box.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:10px;color:var(--muted2)">
      <span><b style="color:var(--text);font-size:12px">${act.length}</b> fichier${act.length > 1 ? 's' : ''}</span>
      <span><b style="color:var(--text);font-size:12px">${this._size(tot)}</b> au total</span>
      <span>🌍 ${pub} public${pub > 1 ? 's' : ''} · 🔒 ${act.length - pub} privé${act.length - pub > 1 ? 's' : ''}</span>
      ${parts ? `<span style="margin-left:auto">${parts}</span>` : ''}
    </div>
    <div style="font-size:9px;color:var(--muted2);margin-top:7px;line-height:1.6">
      Stocké sur <b style="color:var(--text)">ton GitHub</b> — gratuit, sans limite de navigateur.
      Les fichiers privés sont dans un dépôt privé : GitHub applique l'accès côté serveur.
    </div>`;
  },


  /* ── actions ── */
  async onPick(ev) { await this.add([...(ev.target.files || [])]); ev.target.value = ''; },
  async add(files) {
    if (!files.length) return;
    const acc = HubFiles.access();
    if (!acc.ok && acc.reason !== 'no-login') {
      // ⚠ Être connecté au Hub (Google/Discord) ne donne PAS accès à GitHub :
      // les fichiers y sont stockés, il faut donc le connecter séparément.
      const msg = acc.reason === 'cloud-only'
        ? 'Tu es connecté au Hub, mais pas à GitHub — c\'est là que tes fichiers sont stockés. Je t\'ouvre la page pour le connecter.'
        : 'Connecte GitHub pour stocker tes fichiers — je t\'ouvre la page.';
      showToast?.(msg, '#e4b24a', 6000);
      setTimeout(() => { try { showPage('github'); } catch (e) {} }, 900);   // → Paramètres → Intégrations → GitHub
      return;
    }
    for (const f of files) {
      try {
        // Doublon ? (empreinte SHA-256 locale, avant tout envoi → quota préservé)
        const sha = await HubFiles.hash(f);
        const dup = HubFiles.findDuplicate(sha);
        if (dup && !confirm('« ' + f.name +' » semble déjà présent :\n\n' +
            (dup.displayName || dup.name) + ' (' + this._size(dup.size) + ')\n\n' +
            'Importer quand même une copie ?')) { showToast?.('Import ignoré — fichier déjà présent', '#666', 3000); continue; }
        showToast?.('⟳ Envoi de ' + f.name + '…', '#666', 2500);
        await HubFiles.upload(f, { visibility: 'private', sha });   // privé par défaut
        this.render();
        showToast?.('✓ ' + f.name + ' ajouté (privé)', '#2e9a63', 2500);
      } catch (e) { showToast?.('✗ ' + f.name + ' — ' + (e.message || 'échec'), '#c0392b', 5000); }
    }
  },
  async open(id) {
    try {
      const url = await HubFiles.objectUrl(id);
      if (url) window.open(url, '_blank', 'noopener');
      else showToast?.('Fichier indisponible', '#c0392b', 2500);
    } catch (e) { showToast?.('✗ ' + (e.message || 'ouverture impossible'), '#c0392b', 4000); }
  },
  async toggleVis(id) {
    const f = HubFiles.get(id); if (!f) return;
    const toPublic = f.visibility !== 'public';
    if (toPublic && !confirm('Rendre « ' + (f.displayName || f.name) + ' » PUBLIC ?\n\nIl sera accessible par n\'importe qui via son lien, et publié avec ton site.')) return;
    showToast?.('⟳ Changement de visibilité…', '#666', 2000);
    try { await HubFiles.setVisibility(id, toPublic ? 'public' : 'private'); this.render();
      showToast?.(toPublic ? '🌍 Fichier public' : '🔒 Fichier privé', '#2e9a63', 2500); }
    catch (e) { showToast?.('✗ ' + (e.message || 'échec'), '#c0392b', 4000); }
  },
  replace(id) {
    const inp = document.createElement('input'); inp.type = 'file';
    inp.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try { showToast?.('⟳ Remplacement…', '#666', 2500);
        await HubFiles.replace(id, file); this.render();
        showToast?.('✓ Remplacé — le lien public et les blocs du site restent valides', '#2e9a63', 4500); }
      catch (err) { showToast?.('✗ ' + (err.message || 'échec'), '#c0392b', 4000); }
    };
    inp.click();
  },
  trash(id) {
    const f = HubFiles.get(id); if (!f) return;
    const used = (f.usages || []).length;
    if (used && !confirm('Ce fichier est utilisé à ' + used + ' endroit(s). Le mettre à la corbeille peut casser ces contenus.\n\nContinuer ?')) return;
    HubFiles.trash(id); this.render();
    // barre « Annuler » aussi sur une suppression simple (pas seulement en groupe)
    this._undo('« ' + (f.displayName || f.name) + ' » mis à la corbeille',
               () => { HubFiles.restore(id); this.render(); });
  },
  restore(id) { HubFiles.restore(id); this.render(); showToast?.('↩ Restauré', '#2e9a63', 2000); },
  async destroy(id) {
    const f = HubFiles.get(id); if (!f) return;
    if (!confirm('Supprimer DÉFINITIVEMENT « ' + (f.displayName || f.name) + ' » ?\n\nLe fichier sera retiré de GitHub. Cette action est irréversible.')) return;
    try { await HubFiles.destroy(id); this.render(); showToast?.('Supprimé définitivement', '#666', 2500); }
    catch (e) { showToast?.('✗ ' + (e.message || 'échec'), '#c0392b', 4000); }
  },

  /* ══ Sélection multiple ══ */
  sel: new Set(),
  _lastId: null,
  clearSel() { this.sel.clear(); this._paint(); },
  selectAll() { this._visible().forEach(f => this.sel.add(f.id)); this._paint(); },
  toggle(id, ev) {
    const ids = this._visible().map(f => f.id);
    if (ev && ev.shiftKey && this._lastId) {                 // plage
      const a = ids.indexOf(this._lastId), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(i => this.sel.add(i));
    } else if (ev && (ev.ctrlKey || ev.metaKey)) {           // ajout / retrait
      this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id);
    } else {
      this.sel.clear(); this.sel.add(id);
    }
    this._lastId = id; this._paint();
  },
  /** Met à jour l'état visuel + la barre d'actions, sans re-rendre toute la liste */
  _paint() {
    document.querySelectorAll('#st-files [data-f]').forEach(el =>
      el.classList.toggle('on', this.sel.has(el.getAttribute('data-f'))));
    const bar = document.getElementById('st-bulk'); if (!bar) return;
    const n = this.sel.size;
    bar.style.display = n ? 'flex' : 'none';
    if (n) bar.querySelector('#st-bulk-n').textContent = n + ' élément' + (n > 1 ? 's' : '') + ' sélectionné' + (n > 1 ? 's' : '');
  },
  async bulk(action) {
    const ids = [...this.sel];
    if (!ids.length) return;
    if (action === 'trash') {
      ids.forEach(id => HubFiles.trash(id));
      this.clearSel(); this.render();
      this._undo('« ' + ids.length + ' élément(s) » mis à la corbeille', () => { ids.forEach(id => HubFiles.restore(id)); this.render(); });
      return;
    }
    if (action === 'private' || action === 'public') {
      if (action === 'public' && !confirm('Rendre ' + ids.length + ' fichier(s) PUBLIC(s) ?\n\nIls seront accessibles par n\'importe qui via leur lien.')) return;
      showToast?.('⟳ Changement de visibilité…', '#666', 2500);
      for (const id of ids) { try { await HubFiles.setVisibility(id, action); } catch (e) {} }
      this.render(); showToast?.('✓ Visibilité mise à jour', '#2e9a63', 2500);
      return;
    }
    if (action === 'download') { for (const id of ids) await this.download(id); return; }
  },

  /* ══ Annulation (quelques secondes) ══ */
  _undo(msg, fn) {
    const box = document.getElementById('st-undo'); if (!box) return;
    clearTimeout(this._undoT);
    box.innerHTML = `<span>${this._esc(msg)}</span><button id="st-undo-b">Annuler</button>`;
    box.style.display = 'flex';
    box.querySelector('#st-undo-b').onclick = () => { clearTimeout(this._undoT); box.style.display = 'none'; fn(); showToast?.('↩ Annulé', '#2e9a63', 1800); };
    this._undoT = setTimeout(() => { box.style.display = 'none'; }, 7000);
  },

  /* ══ Aperçu rapide (Espace), comme le Finder ══ */
  async preview(id) {
    const f = HubFiles.get(id); if (!f) return;
    const ov = document.getElementById('st-prev'); if (!ov) return;
    const body = ov.querySelector('#st-prev-body');
    ov.querySelector('#st-prev-t').textContent = f.displayName || f.name;
    ov.querySelector('#st-prev-s').textContent = this._size(f.size) + ' · ' + (f.ext || f.kind) + ' · ' + (f.visibility === 'public' ? '🌍 public' : '🔒 privé');
    body.innerHTML = '<div class="st-load">Chargement…</div>';
    ov.style.display = 'flex';
    this._prevId = id;
    try {
      const url = await HubFiles.objectUrl(id);
      if (f.kind === 'image' || f.kind === 'gif') body.innerHTML = `<img src="${this._esc(url)}" alt="">`;
      else if (f.kind === 'pdf')   body.innerHTML = `<iframe src="${this._esc(url)}"></iframe>`;   // lecteur PDF natif
      else if (f.kind === 'video') body.innerHTML = `<video src="${this._esc(url)}" controls autoplay muted></video>`;
      else if (f.kind === 'audio') body.innerHTML = `<audio src="${this._esc(url)}" controls autoplay></audio>`;
      else body.innerHTML = `<div class="st-noprev"><div style="font-size:44px">${this.ICONS[f.kind] || '📃'}</div>
        <p>Pas d'aperçu pour ce format.</p><a class="btn btn-accent" href="${this._esc(url)}" download="${this._esc(f.name)}">⬇ Télécharger</a></div>`;
    } catch (e) { body.innerHTML = `<div class="st-noprev"><p>✗ ${this._esc(e.message || 'Impossible d\'ouvrir')}</p></div>`; }
  },
  closePreview() { const ov = document.getElementById('st-prev'); if (ov) { ov.style.display = 'none'; ov.querySelector('#st-prev-body').innerHTML = ''; } this._prevId = null; },
  async download(id) {
    const f = HubFiles.get(id); if (!f) return;
    try {
      const url = await HubFiles.objectUrl(id);
      const a = document.createElement('a'); a.href = url; a.download = f.displayName || f.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { showToast?.('✗ ' + (e.message || 'échec'), '#c0392b', 3000); }
  },
  /** ＋ Ajouter au site : crée un bloc relié au fichier, visible dans les 3 thèmes.
      Un fichier PRIVÉ n'est pas lisible par les visiteurs → on propose de le publier. */
  async addToSite(id) {
    const f = HubFiles.get(id); if (!f) return;
    if (f.visibility !== 'public') {
      if (!confirm('« ' + (f.displayName || f.name) + ' » est privé.\n\n' +
                   'Pour l\'afficher sur ton site public, il doit devenir PUBLIC (accessible par lien).\n\nLe rendre public et l\'ajouter ?')) return;
      try { showToast?.('⟳ Publication du fichier…', '#666', 2500); await HubFiles.setVisibility(id, 'public'); }
      catch (e) { return showToast?.('✗ ' + (e.message || 'échec'), '#c0392b', 4000); }
    }
    const meta = HubFiles.get(id);
    const url = HubFiles.publicUrl(meta);
    if (!url) return showToast?.('✗ Lien public indisponible', '#c0392b', 3000);
    const isImg = meta.kind === 'image' || meta.kind === 'gif';
    const blocks = getBlocks(SiteConfig.get());
    if (isImg) {
      // image → couverture d'un bloc texte visuel n'a pas de sens : on crée un bloc
      // Document illustré (le bloc Image dédié viendra avec la galerie).
      blocks.push(normalizeBlock({ id: blockUid('file'), type: 'file', w: 2, h: 1,
        props: { fileId: id, url, title: meta.displayName || meta.name, sub: 'Image · ' + this._size(meta.size), icon: this.ICONS[meta.kind], kind: meta.kind } }));
    } else {
      const isCV = /cv|curriculum/i.test(meta.displayName || meta.name);
      blocks.push(normalizeBlock({ id: blockUid('file'), type: 'file', w: 2, h: 1,
        props: { fileId: id, url, title: isCV ? 'Mon CV' : (meta.displayName || meta.name),
                 sub: (meta.ext || '').toUpperCase() + ' · ' + this._size(meta.size), icon: this.ICONS[meta.kind] || '📄', kind: meta.kind } }));
    }
    SiteConfig.set('blocks', placeBlocks(blocks));
    // enregistre l'usage (avertissement avant suppression)
    const l = HubFiles.list().map(x => x.id === id ? { ...x, usages: [...new Set([...(x.usages || []), 'Site public'])] } : x);
    localStorage.setItem('hub_files', JSON.stringify(l));
    this.render();
    showToast?.('✓ Bloc ajouté à ton site — ouvre l\'Éditeur pour le placer', '#2e9a63', 4500);
  },

  rename(id) {
    const f = HubFiles.get(id); if (!f) return;
    const n = prompt('Nouveau nom :', f.displayName || f.name);
    if (n && n.trim()) { HubFiles.rename(id, n); this.render(); showToast?.('✓ Renommé', '#2e9a63', 1800); }
  },

  /* ══ Raccourcis clavier ══ */
  _keys(e) {
    if (!document.getElementById('page-storage')?.classList.contains('active')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === 'Escape') { if (this._prevId) return this.closePreview(); return this.clearSel(); }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); return this.selectAll(); }
    const id = [...this.sel][0];
    if (!id) return;
    if (k === ' ')       { e.preventDefault(); return this._prevId ? this.closePreview() : this.preview(id); }
    if (k === 'Enter')   { e.preventDefault(); return this.open(id); }
    if (k === 'F2')      { e.preventDefault(); return this.rename(id); }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return this.bulk('trash'); }
  },

  /** Glisser-déposer + clavier + clics */
  init() {
    const dz = document.getElementById('st-drop'); if (!dz || dz._ready) return;
    dz._ready = true;
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || !dz.contains(e.relatedTarget)) dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => this.add([...(e.dataTransfer?.files || [])]));
    // sélection : clic sur une carte (les boutons d'action gardent leur rôle)
    dz.addEventListener('click', e => {
      if (e.target.closest('.st-act')) return;
      const card = e.target.closest('[data-f]');
      if (card) this.toggle(card.getAttribute('data-f'), e);
      else this.clearSel();
    });
    document.addEventListener('keydown', e => this._keys(e));
  },
};
window.StorageUI = StorageUI;
