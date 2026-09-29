'use strict';
/**
 * hub-images.js — les images SORTENT du localStorage.
 *
 * Constat : le navigateur refuse d'écrire au-delà d'environ 5 Mo de
 * localStorage. Les couvertures de projets en base64 (`data:image/webp;base64,…`)
 * pèsent 50 à 300 Ko chacunes : une quarantaine de projets et le quota est
 * épuisé → plus aucune écriture possible, sauvegarde qui échoue, import
 * impossible. Le découpage `.partN` de la sauvegarde déplace le problème, il
 * ne le résout pas.
 *
 * Contrat de stockage :
 *
 *   AVANT   p.cover      = base64 complet (50–300 Ko) dans localStorage
 *   APRÈS   p.cover      = miniature inline (≤ ~25 Ko) → affichage immédiat
 *           p.coverFile  = media/<empreinte>.webp      → dépôt privé GitHub
 *
 * Pourquoi un contrat compatible : TOUS les affichements lisent `p.cover`,
 * qui reste une chaîne utilisable dans un `<img src>`. Aucun composant n'a
 * bougé. Le plein format n'est remis à la volée que là où il compte
 * (publication, aperçu, export) via `resolveProjects()` / `resolveCfg()`.
 *
 * Pourquoi `media/` et pas `data/` : autoBackup supprime sous `data/` tout
 * fichier absent du manifeste — les images y seraient effacées au cycle
 * suivant. `media/` est hors de sa portée (GH.dataPaths ne liste que data/).
 *
 * Pourquoi le dépôt PRIVÉ : une couverture non publiée ne doit pas devenir
 * accessible à n'importe qui par une URL brute. Le plein format ne sort du
 * dépôt privé qu'au moment de la publication, inliné dans le HTML du site —
 * exactement comme aujourd'hui, mais sans peser sur le navigateur.
 *
 * Qualité : la miniature est à 420 px de large (cartes du tableau de bord),
 * le site publié reçoit lui le fichier d'origine (900–1600 px).
 */
const HubImages = {

  DIR: 'media/',                 // hors data/ → le ménage des orphelins ne l'atteint pas
  MIN_OFFLOAD: 32 * 1024,        // sous ce poids, garder l'image en local coûte moins cher
  THUMB_W: 420, THUMB_Q: 0.70,   // miniature d'affichage (cartes, portails, aperçu)
  CACHE_MAX: 32,                 // pleins formats gardés en mémoire (session uniquement)

  _cache: new Map(),             // 'media/x.webp' → dataUrl plein format

  /* ── dépôt cible : {login}-hub-data, le même que la sauvegarde ── */
  login() { try { return (Auth.user() && Auth.user().login) || Auth.owner() || ''; } catch { return ''; } },
  repo()  { return String(this.login()).toLowerCase() + REPO_DATA_SUFFIX; },
  ready() { return !!(typeof Auth !== 'undefined' && Auth.ok && Auth.ok() && this.login()); },

  /* ───────────────────────── codage ───────────────────────── */

  /** dataUrl → { b64, u8, mime, size } (base64 du vrai binaire) */
  decode(src) {
    const m = /^data:([^;,]*)((?:;[^,]*)*),([\s\S]*)$/.exec(String(src || ''));
    if (!m) throw new Error('source non reconnue (data: attendu)');
    const mime  = m[1] || 'application/octet-stream';
    const isB64 = /;base64/i.test(m[2] || '');
    const data  = m[3] || '';
    const bin   = isB64 ? atob(data) : decodeURIComponent(data);
    const u8    = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { b64: isB64 ? data : GH.b64encBytes(u8), u8, mime, size: u8.length };
  },

  extOf(mime) {
    return ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png',
              'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[mime]) || 'img';
  },
  mimeOf(path) {
    const e = String(path || '').toLowerCase().split('.').pop();
    return ({ webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
              gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' }[e]) || 'application/octet-stream';
  },

  /** Empreinte des OCTETS (SHA-256) : identique à celle de HubFiles → le même
      visuel importé deux fois n'est écrit qu'une fois. */
  async sha(u8) {
    if (globalThis.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest('SHA-256', u8);
      return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381;                                   // repli hors contexte sécurisé
    for (let i = 0; i < u8.length; i++) h = ((h << 5) + h + u8[i]) | 0;
    return 'f' + (h >>> 0).toString(16) + '-' + u8.length;
  },

  /** Miniature d'affichage. Un GIF y devient une image fixe : c'est voulu pour
      une carte — le plein format resté sur GitHub, lui, garde son animation. */
  async thumb(src, w, q) {
    w = w || this.THUMB_W; q = (q === undefined ? this.THUMB_Q : q);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image illisible'));
      i.src = src;
    });
    if (!img.width || !img.height) return src;
    const k = img.width > w ? w / img.width : 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * k));
    cv.height = Math.max(1, Math.round(img.height * k));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    let out = '';
    try { out = cv.toDataURL('image/webp', q); } catch {}
    if (!out.startsWith('data:image/webp')) { try { out = cv.toDataURL('image/jpeg', q + 0.04); } catch {} }
    return out || src;
  },

  /* ───────────────────────── écriture ───────────────────────── */

  /**
   * Écrit des images dans media/ — UN SEUL COMMIT pour tout le lot.
   * @param {Array<{dataUrl:string,label?:string}>} items
   * @returns {Promise<Array<{path,sha,size}>>}
   */
  async put(items) {
    if (!this.ready()) throw new Error('GitHub non connecté');
    const token = Auth.token();
    const login = this.login();
    const repo  = this.repo();

    // 1. empreintes → déduplication (déjà présent = aucun octet envoyé)
    const known = new Map();
    HubFiles.list().forEach(f => {
      if (f.repo === repo && f.sha && f.status !== 'trash') known.set(f.sha, f.path);
    });
    const prepared = [], seen = new Set();
    for (const it of items) {
      const d = this.decode(it.dataUrl);
      const sum = await this.sha(d.u8);
      const existed = known.has(sum) || seen.has(sum);
      const path = known.get(sum) || (this.DIR + sum.slice(0, 20) + '.' + this.extOf(d.mime));
      seen.add(sum);
      prepared.push({ path, b64: d.b64, size: d.size, mime: d.mime, sha: sum, existed, label: it.label || 'image' });
    }

    // 2. envoi groupé (verrou partagé avec la sauvegarde)
    const todo = prepared.filter(p => !p.existed);
    if (todo.length) {
      await GH.ensureRepo(token, login, repo, true);
      await withRepoLock(() => GH.commitFiles(
        token, login, repo, todo.map(p => ({ path: p.path, b64: p.b64 })),
        'media: ' + todo.length + ' image(s)'));
    }

    // 3. métadonnées → la bibliothèque Fichiers voit et gère les couvertures
    const list = HubFiles.list();
    let added = 0;
    for (const p of prepared) {
      if (list.some(f => f.repo === repo && f.path === p.path)) continue;
      list.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        owner: login, repo, path: p.path,
        name: p.path.split('/').pop(), displayName: p.label,
        mime: p.mime, ext: this.extOf(p.mime), size: p.size, kind: 'image',
        visibility: 'private', folder: 'media', tags: [], usages: [], fav: false,
        sha: p.sha, createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
      });
      added++;
    }
    if (added) HubFiles._save(list);
    return prepared.map(p => ({ path: p.path, sha: p.sha, size: p.size }));
  },

  /**
   * Sort UNE couverture du localStorage (appelé à la création/édition d'un
   * projet). Renvoie le projet mis à jour, ou null si rien n'a bougé
   * (pas connecté, image trop petite, GIF…). En cas d'échec réseau on garde
   * silencieusement le base64 : le mode dégradé reste fonctionnel.
   */
  async offloadProject(id) {
    try {
      if (!this.ready()) return null;
      const first = getProjects().find(x => String(x.id) === String(id));
      if (!first || typeof first.cover !== 'string' || first.coverFile) return null;
      if (!first.cover.startsWith('data:') || first.cover.length < this.MIN_OFFLOAD) return null;
      const mini = await this.thumb(first.cover);
      if (!mini || mini === first.cover) return null;
      const res = (await this.put([{ dataUrl: first.cover, label: first.title || 'couverture' }]))[0];
      if (!res) return null;
      const projs = getProjects();
      const p = projs.find(x => String(x.id) === String(id));
      if (!p) return null;
      p.cover = mini; p.coverFile = res.path;
      localStorage.setItem('hub_projects', JSON.stringify(projs));   // peut échouer : rattrapé par migrate()
      return p;
    } catch (e) { console.warn('[images] export couverture', e); return null; }
  },

  /* ───────────────────────── lecture ───────────────────────── */

  /** Plein format depuis le dépôt privé (jeton requis). null = indisponible
      → l'appelant garde la miniature. Mémorisé pour la session. */
  async full(path) {
    if (!path) return null;
    if (this._cache.has(path)) {
      const v = this._cache.get(path);
      this._cache.delete(path); this._cache.set(path, v);     // LRU
      return v;
    }
    if (!this.ready()) return null;
    let b64 = null;
    try {
      const res = await GH.req(`/repos/${this.login()}/${this.repo()}/contents/${path}`, {
        headers: { ...GH.authHeaders(Auth.token()), Accept: 'application/vnd.github.raw+json' },
      });
      if (res.ok) b64 = GH.b64encBytes(new Uint8Array(await res.arrayBuffer()));
    } catch {}
    if (b64 === null) return null;
    const url = 'data:' + this.mimeOf(path) + ';base64,' + b64;
    this._cache.set(path, url);
    while (this._cache.size > this.CACHE_MAX) this._cache.delete(this._cache.keys().next().value);
    return url;
  },

  /** Copie des projets avec le plein format restauré (jamais l'original). */
  async resolveProjects(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const idx = [];
    list.forEach((p, i) => { if (p && p.coverFile) idx.push(i); });
    if (!idx.length) return list;
    const out = list.map(p => (p ? { ...p } : p));
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(4, idx.length) }, async () => {
      while (k < idx.length) {                       // concurrence limitée (4) : limite secondaire GitHub
        const i = idx[k++];
        const full = await this.full(list[i].coverFile);
        if (full) out[i].cover = full;
      }
    }));
    return out;
  },

  /** Idem pour la config du site (image hero éventuelle). */
  async resolveCfg(cfg) {
    if (!cfg || !cfg.heroFile) return cfg;
    const full = await this.full(cfg.heroFile);
    return full ? { ...cfg, heroImage: full } : cfg;
  },

  /* ───────────────────────── migration ───────────────────────── */

  /** État du poids images resté dans le navigateur. */
  stats() {
    let heavy = 0, bytes = 0, offloaded = 0;
    getProjects().forEach(p => {
      if (!p || typeof p.cover !== 'string') return;
      if (p.coverFile) { offloaded++; return; }
      if (p.cover.startsWith('data:') && p.cover.length >= this.MIN_OFFLOAD) { heavy++; bytes += p.cover.length; }
    });
    const cfg = SiteConfig.get();
    if (typeof cfg.heroImage === 'string' && cfg.heroImage.startsWith('data:')
        && !cfg.heroFile && cfg.heroImage.length >= this.MIN_OFFLOAD) { heavy++; bytes += cfg.heroImage.length; }
    return { heavy, bytes, offloaded };
  },

  /**
   * Migration en masse : toutes les couvertures base64 deviennent
   * miniature + fichier media/. UN commit pour tout le lot.
   * @param {(done:number,total:number,phase:string)=>void} [onProgress]
   * @returns {Promise<{moved:number,freed:number,failed:number}>}
   */
  async migrate(onProgress) {
    if (!this.ready()) throw new Error('Connecte GitHub pour sortir les images du navigateur');
    const token = Auth.token();
    const login = this.login();
    const repo  = this.repo();

    const jobs = [];
    getProjects().forEach(p => {
      if (p && typeof p.cover === 'string' && p.cover.startsWith('data:') && !p.coverFile
          && p.cover.length >= this.MIN_OFFLOAD) jobs.push({ kind: 'project', id: String(p.id), src: p.cover });
    });
    const cfg = SiteConfig.get();
    if (typeof cfg.heroImage === 'string' && cfg.heroImage.startsWith('data:') && !cfg.heroFile
        && cfg.heroImage.length >= this.MIN_OFFLOAD) jobs.push({ kind: 'cfg', src: cfg.heroImage });
    if (!jobs.length) return { moved: 0, freed: 0, failed: 0 };

    // 1. miniature + empreinte pour chaque image (locale, pas de requête)
    let n = 0;
    for (const j of jobs) {
      try {
        j.thumb = await this.thumb(j.src);
        const d = this.decode(j.src);
        j.sha = await this.sha(d.u8);
        j.mime = d.mime; j.size = d.size; j.b64 = d.b64;
        if (j.thumb === j.src) { j.thumb = null; }   // encodage impossible → on ne perd pas l'original
      } catch (e) { console.warn('[images] miniature impossible', e); }
      onProgress?.(++n, jobs.length, 'analyse');
    }

    // 2. envoi groupé : ce qui existe déjà sur GitHub n'est pas renvoyé
    const known = new Map();
    HubFiles.list().forEach(f => {
      if (f.repo === repo && f.sha && f.status !== 'trash') known.set(f.sha, f.path);
    });
    const pathOf = j => known.get(j.sha) || (this.DIR + j.sha.slice(0, 20) + '.' + this.extOf(j.mime));
    const todo = [], seen = new Set();
    for (const j of jobs) {
      if (!j.thumb) continue;
      j.path = pathOf(j);
      if (known.has(j.sha) || seen.has(j.sha)) continue;
      seen.add(j.sha);
      todo.push({ path: j.path, b64: j.b64 });
    }
    if (todo.length) {
      onProgress?.(n, jobs.length, 'envoi');
      await GH.ensureRepo(token, login, repo, true);
      await withRepoLock(() => GH.commitFiles(
        token, login, repo, todo, 'media: ' + todo.length + ' image(s)'));
      const list = HubFiles.list();
      let added = 0;
      for (const j of jobs) {
        if (!j.thumb || list.some(f => f.repo === repo && f.path === j.path)) continue;
        list.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          owner: login, repo, path: j.path,
          name: j.path.split('/').pop(), displayName: j.kind === 'cfg' ? 'image hero' : 'couverture',
          mime: j.mime, ext: this.extOf(j.mime), size: j.size, kind: 'image',
          visibility: 'private', folder: 'media', tags: [], usages: [], fav: false,
          sha: j.sha, createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
        });
        added++;
      }
      if (added) HubFiles._save(list);
    }

    // 3. réécriture locale : miniature en mémoire d'affichage, fichier en réf.
    let moved = 0, freed = 0;
    const projs = getProjects();
    for (const j of jobs) {
      if (!j.thumb || !j.path) continue;
      if (j.kind === 'project') {
        const p = projs.find(x => String(x.id) === j.id);
        if (!p) continue;
        freed += Math.max(0, p.cover.length - j.thumb.length);
        p.cover = j.thumb; p.coverFile = j.path; moved++;
      } else {
        freed += Math.max(0, j.src.length - j.thumb.length);
        cfg.heroImage = j.thumb; cfg.heroFile = j.path; moved++;
      }
    }
    if (moved) {
      try { localStorage.setItem('hub_projects', JSON.stringify(projs)); }
      catch { throw new Error('localStorage toujours plein — réessaie après avoir supprimé un projet'); }
      if (cfg.heroFile) { SiteConfig.set('heroImage', cfg.heroImage); SiteConfig.set('heroFile', cfg.heroFile); }
      try { if (typeof autoBackup === 'function') await autoBackup({ force: true }); } catch (e) { console.warn('[images]', e); }
    }
    onProgress?.(jobs.length, jobs.length, 'fini');
    return { moved, freed, failed: jobs.length - moved };
  },
};

window.HubImages = HubImages;
