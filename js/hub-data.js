'use strict';
/**
 * hub-data.js — REGISTRE UNIQUE des données du hub.
 *
 * Avant ce fichier, la liste des collections vivait à 3 endroits qui ne
 * concordaient pas :
 *   • l'export JSON      (HUB_COLLECTIONS, 8 clés)
 *   • la sauvegarde GitHub (autoBackup, 6 clés)
 *   • le miroir Firestore  (Cloud.SYNC_KEYS, 9 clés)
 * → `hub_projects` n'était sauvé nulle part en complet, `hub_portals`,
 *   `hub_catalog`, `hub_media`, `hub_files` et `hub_pricing` ne figuraient
 *   dans AUCUNE sauvegarde.
 *
 * Une seule liste décrit désormais chaque collection :
 *   ls     clé localStorage      = cache local, ce que l'UI lit et écrit
 *   file   chemin dans le dépôt GitHub privé {login}-hub-data
 *   sync   nom de sous-collection Firestore users/{uid}/data/<sync> (miroir)
 *   type   'array' (découpage possible en fichiers) | 'raw' (1 seul fichier)
 *
 * RÔLES
 *   GitHub  → source de vérité persistante (historique + export + multi-appareil)
 *   localStorage → cache de lecture, mode dégradé hors ligne
 *   Firestore → temps réel uniquement (ce que lisent les clients sans compte)
 *
 * Volontairement EXCLUES du registre (et donc de la sauvegarde) :
 *   hub_neg_seen, hub_q_added, hub_notified  → anti-doublon volatils, ils
 *     changent à chaque notification : les sauvegarder provoquerait un commit
 *     Git à chaque événement.
 *   souanpt_auth_v2 (PAT), souanpt_login_log, souanpt_last_*, _shv
 *     → secrets ou données de l'appareil.
 */
const HubData = {

  /* Version du schéma de sauvegarde (data/manifest.json) */
  VERSION: 3,

  /* Un fichier JSON doit rester largement sous la limite de l'API GitHub
     (1 Mo supportés en toutes fonctionnalités) une fois encodé en base64 :
     480 Ko × 4/3 ≈ 640 Ko de payload. Au-delà, une collection ARRAY est
     découpée en `*.partN.json` — les binaires ne sont jamais dans ces
     fichiers (HubFiles les garde sur GitHub). */
  MAX_CHARS: 440 * 1024,

  PATH: 'data/',

  LIST: [
    { key: 'projects',  ls: 'hub_projects',     file: 'projects.json',  sync: 'projects',  type: 'array',
      // T4 : les images pleine taille vivent sur GitHub (media/, js/hub-images.js),
      // il ne reste que des miniatures (~20 Ko) en base64. `mirror:'github'` reste
      // volontaire : 40 miniatures ≈ 800 Ko, déjà à la limite du document
      // Firestore de 1 Mo — le miroir ne servirait ici que le temps réel.
      mirror: 'github' },
    { key: 'links',     ls: 'hub_links',        file: 'links.json',     sync: 'links',     type: 'array' },
    { key: 'clients',   ls: 'hub_clients',      file: 'clients.json',   sync: 'clients',   type: 'array' },
    { key: 'invoices',  ls: 'hub_invoices',     file: 'invoices.json',  sync: 'invoices',  type: 'array' },
    // Couche canonique « un projet = UN dossier » (js/client-workspace.js) :
    // un document par jeton, qui RÉFÉRENCE les pièces (refs) sans les copier.
    { key: 'workspaces', ls: 'hub_workspaces',  file: 'workspaces.json', sync: 'workspaces', type: 'array' },
    // Journal des passes de migration (diagnostic de la validation, v3.8) :
    // sauvé comme le reste, mais PAS de miroir Firestore (rien à synchroniser,
    // c'est un journal local de ce que la migration a fait ici).
    { key: 'wsruns',     ls: 'hub_ws_runs',     file: 'wsruns.json',    sync: null,        type: 'array' },
    { key: 'catalog',   ls: 'hub_catalog',      file: 'catalog.json',   sync: 'catalog',   type: 'array' },
    { key: 'reviews',   ls: 'hub_reviews',      file: 'reviews.json',   sync: 'reviews',   type: 'array' },
    { key: 'portals',   ls: 'hub_portals',      file: 'portals.json',   sync: 'portals',   type: 'array' },
    { key: 'media',     ls: 'hub_media',        file: 'media.json',     sync: 'media',     type: 'array' },
    { key: 'files',     ls: 'hub_files',        file: 'files.json',     sync: 'files',     type: 'array' },
    { key: 'estimates', ls: 'hub_estimates',    file: 'estimates.json', sync: null,        type: 'array' },
    // Objet de réglages → 1 fichier, pas de découpage.
    { key: 'pricing',   ls: 'hub_pricing',      file: 'pricing.json',   sync: 'pricing',   type: 'raw' },
    // La config du site est poussée vers Firestore par pushConfig() dans un
    // champ `cfg` (pas `items`) : `mirror:false` évite de la traiter 2 fois.
    { key: 'config',    ls: 'souanpt_site_cfg', file: 'config.json',    sync: 'config',    mirror: 'cfg', type: 'raw' },
    // 'value' = scalaire stocké tel quel dans localStorage (pas du JSON) :
    // il est sérialisé en JSON dans le fichier pour rester valide.
    { key: 'settings',  ls: 'hub_img_quality',  file: 'settings.json',  sync: null,        type: 'value' },
  ],

  /* ── accès ── */
  byKey(key)   { return this.LIST.find(e => e.key === key) || null; },
  byLs(ls)     { return this.LIST.find(e => e.ls === ls)   || null; },
  /** { projet:'hub_projects', … } — compat HUB_COLLECTIONS (export/import JSON) */
  exportMap()  { const m = {}; this.LIST.forEach(e => m[e.key] = e.ls); return m; },
  /** { hub_clients:'clients', … } — compat Cloud.SYNC_KEYS (miroir Firestore) */
  syncMap()    {
    const m = {};
    this.LIST.forEach(e => { if (e.sync && !e.mirror) m[e.ls] = e.sync; });
    return m;
  },

  /** Lit une clé en renvoyant le type attendu (jamais null/nan) */
  read(e) {
    if (e.type === 'value') return localStorage.getItem(e.ls) || null;
    const raw = localStorage.getItem(e.ls);
    if (raw === null || raw === '') return e.type === 'array' ? [] : null;
    try {
      const v = JSON.parse(raw);
      if (e.type === 'array') return Array.isArray(v) ? v : [];
      return v;
    } catch { return e.type === 'array' ? [] : null; }
  },

  /* ── découpage : reste sous MAX_CHARS sans jamais scinder un objet de
        référence (une facture, un portail… reste entière dans un fichier) ── */
  _chunk(items, max) {
    const parts = []; let cur = [], size = 2;
    for (const it of items) {
      const s = (it === undefined ? 0 : JSON.stringify(it, null, 2).length) + 3;
      if (cur.length && size + s > max) { parts.push(cur); cur = []; size = 2; }
      cur.push(it); size += s;
    }
    parts.push(cur);
    return parts;
  },

  _sha256(str) {
    const enc = new TextEncoder().encode(str);
    if (globalThis.crypto?.subtle) {
      return crypto.subtle.digest('SHA-256', enc).then(b =>
        Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));
    }
    // Repli (contexte non sécurisé) : pas cryptographique, juste comparable.
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Promise.resolve('f' + (h >>> 0).toString(16) + ':' + str.length);
  },

  /**
   * Construit TOUS les fichiers de data/ à partir du localStorage.
   * Chaque fichier porte sha256 : deux builds identiques donnent exactement
   * les mêmes octets → la sauvegarde peut sauter le commit sans rien perdre.
   * @returns {Promise<Array<{path,content,key,sha256,bytes}>>}
   */
  async buildFiles() {
    const files = [];
    for (const e of this.LIST) {
      const v = this.read(e);
      if (e.type === 'value') {
        // Réglage absent → pas de fichier : rien à restaurer dessus.
        if (v === null || v === '') continue;
        const content = JSON.stringify(v);
        files.push({ path: this.PATH + e.file, content, key: e.key });
      } else if (e.type === 'array') {
        const parts = this._chunk(v, this.MAX_CHARS);
        parts.forEach((p, i) => {
          const name = parts.length > 1 ? e.file.replace(/\.json$/, `.part${i + 1}.json`) : e.file;
          const content = JSON.stringify(p, null, 2);
          files.push({ path: this.PATH + name, content, key: e.key });
        });
      } else {
        const content = JSON.stringify(v === undefined ? null : v, null, 2);
        if (content.length > this.MAX_CHARS * 1.5) {
          console.warn('[hub-data] ' + e.file + ' dépasse la taille conseillée (' +
            Math.round(content.length / 1024) + ' Ko) — pense à sortir les images du JSON.');
        }
        files.push({ path: this.PATH + e.file, content, key: e.key });
      }
    }
    for (const f of files) {
      f.sha256 = await this._sha256(f.content);
      f.bytes  = f.content.length;
    }
    /* Manifeste : déterministe (aucun horodatage) — il ne change que si les
       données changent, sinon la sauvegarde créerait un commit à chaque appel.
       Il sert aussi de table des matières pour la restauration. */
    const counts = {};
    this.LIST.forEach(e => { const v = this.read(e); counts[e.key] = Array.isArray(v) ? v.length : (v ? 1 : 0); });
    const manifest = {
      hub: 'souanpt-hub', version: this.VERSION,
      counts,
      files: files.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
    };
    const content = JSON.stringify(manifest, null, 2);
    files.push({
      path: this.PATH + 'manifest.json', content, key: 'manifest',
      sha256: await this._sha256(content), bytes: content.length,
    });
    return files;
  },

  /**
   * Applique une collection de fichiers { 'data/projects.json': '…json…' }
   * au localStorage. Découpe automatiquement les *.partN.json.
   * @returns {Array<string>} clés restaurées
   */
  applyFiles(map) {
    const buckets = {}, restored = [];
    for (const [path, content] of Object.entries(map)) {
      if (!path.startsWith(this.PATH) || path.endsWith('manifest.json')) continue;
      const name = path.slice(this.PATH.length);
      const base = name.replace(/\.part\d+\.json$/, '.json');
      (buckets[base] = buckets[base] || []).push({
        part: (/\.part(\d+)\.json$/.test(name) ? parseInt(RegExp.$1, 10) : 1), content,
      });
    }
    for (const e of this.LIST) {
      const parts = buckets[e.file];
      if (!parts) continue;
      parts.sort((a, b) => a.part - b.part);
      try {
        if (e.type === 'array') {
          const items = [];
          for (const p of parts) {
            const v = JSON.parse(p.content);
            if (Array.isArray(v)) items.push(...v);
          }
          localStorage.setItem(e.ls, JSON.stringify(items));
        } else if (e.type === 'value') {
          const v = JSON.parse(parts[0].content);
          if (typeof v === 'string' && v) localStorage.setItem(e.ls, v);
        } else {
          localStorage.setItem(e.ls, parts[0].content);   // déjà du JSON « raw »
        }
        restored.push(e.key);
      } catch (err) { console.warn('[hub-data] restauration ' + e.key, err); }
    }
    return restored;
  },
};

window.HubData = HubData;
/* Compat : HUB_COLLECTIONS vivait en dur dans app.html */
const HUB_COLLECTIONS = HubData.exportMap();
