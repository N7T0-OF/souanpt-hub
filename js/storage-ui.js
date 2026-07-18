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
        : `<button onclick="StorageUI.open('${f.id}')" title="Ouvrir">👁</button>
             <button onclick="StorageUI.toggleVis('${f.id}')" title="${f.visibility === 'public' ? 'Rendre privé' : 'Rendre public'}">${f.visibility === 'public' ? '🔒' : '🌍'}</button>
             <button onclick="StorageUI.replace('${f.id}')" title="Remplacer (garde le même lien)">⇄</button>
             <button onclick="StorageUI.trash('${f.id}')" title="Mettre à la corbeille">🗑</button>`}
    </div>`;
  },
  _card(f) {
    const thumb = (f.kind === 'image' || f.kind === 'gif') && f.visibility === 'public'
      ? `<div class="st-th" style="background:url('${this._esc(HubFiles.publicUrl(f))}') center/cover"></div>`
      : `<div class="st-th"><span>${this.ICONS[f.kind] || '📃'}</span></div>`;
    return `<article class="st-card" data-f="${this._esc(f.id)}" ondblclick="StorageUI.open('${f.id}')">
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
    return `<div class="st-row" data-f="${this._esc(f.id)}" ondblclick="StorageUI.open('${f.id}')">
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
    if (!window.Auth || !Auth.ok()) { showToast?.('Connecte GitHub (Paramètres → Intégrations) pour stocker tes fichiers', '#e4b24a', 4500); return; }
    for (const f of files) {
      try {
        showToast?.('⟳ Envoi de ' + f.name + '…', '#666', 2500);
        await HubFiles.upload(f, { visibility: 'private' });   // privé par défaut
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
    showToast?.('🗑 Mis à la corbeille — restaurable', '#666', 3000);
  },
  restore(id) { HubFiles.restore(id); this.render(); showToast?.('↩ Restauré', '#2e9a63', 2000); },
  async destroy(id) {
    const f = HubFiles.get(id); if (!f) return;
    if (!confirm('Supprimer DÉFINITIVEMENT « ' + (f.displayName || f.name) + ' » ?\n\nLe fichier sera retiré de GitHub. Cette action est irréversible.')) return;
    try { await HubFiles.destroy(id); this.render(); showToast?.('Supprimé définitivement', '#666', 2500); }
    catch (e) { showToast?.('✗ ' + (e.message || 'échec'), '#c0392b', 4000); }
  },

  /** Glisser-déposer sur la zone */
  init() {
    const dz = document.getElementById('st-drop'); if (!dz || dz._ready) return;
    dz._ready = true;
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || !dz.contains(e.relatedTarget)) dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => this.add([...(e.dataTransfer?.files || [])]));
  },
};
window.StorageUI = StorageUI;
