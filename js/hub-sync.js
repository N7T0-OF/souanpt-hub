'use strict';
/**
 * hub-sync.js — T3 : GitHub devient la SOURCE DE VÉRITÉ au login.
 *
 * Avant ce module, le hub ne tirait du dépôt privé que sur clic manuel
 * (« Restaurer »), et le miroir Firestore tirait de son côté — deux sources
 * qui se marchaient dessus selon l'ordre des promesses.
 *
 * Maintenant, à chaque session :
 *
 *   Firestore.syncPull()   →  HubSync.boot()   →  autoBackup()
 *   (1. temps réel)           (2. GitHub gagne)    (3. pousse le local)
 *
 * Le tirage est INCRÉMENTAL et en 3 voies, grâce à une baseline
 * (`souanpt_sync_hashes` = sha256 de chaque fichier au dernier accord) :
 *
 *   local == distant                          → rien à faire
 *   local == baseline, distant != baseline    → ON TIRE (GitHub a bougé ailleurs)
 *   local != baseline, distant == baseline    → ON POUSSE (autoBackup)
 *   les deux ont bougé / pas de baseline      → CONFLIT : le local gagne,
 *                                                la baseline est conservée pour
 *                                                ne pas répéter l'erreur, et un
 *                                                avertissement s'affiche.
 *
 * ⚠ Une seule règle à ne jamais casser : HubSync DOIT se terminer avant
 * autoBackup (celui-ci attend `HubSync.pending`), sinon on pousserait une
 * copie locale périmée par-dessus la sauvegarde.
 */
const HubSync = {
  KEY: 'souanpt_sync_hashes',
  BLOCK_KEY: 'souanpt_sync_blocked',
  pending: null,          // promesse du tirage en cours — autoBackup l'attend
  _done: false,           // 1 tirage automatique par session
  _owner: null,
  _hold: new Set(),       // chemins SANS accord : leur baseline ne bouge pas

  blocked(owner) {
    try {
      const state = JSON.parse(localStorage.getItem(this.BLOCK_KEY) || 'null');
      return state && state.owner === String(owner || '').toLowerCase() ? state : null;
    } catch { return null; }
  },
  _block(owner, reason, conflicts = []) {
    localStorage.setItem(this.BLOCK_KEY, JSON.stringify({
      owner: String(owner || '').toLowerCase(), reason, conflicts,
    }));
  },
  _unblock() { localStorage.removeItem(this.BLOCK_KEY); },

  async _remoteFile(token, owner, repo, path) {
    const file = await GH.api(token, `/repos/${owner}/${repo}/contents/${path}`);
    if (typeof file?.content !== 'string') throw new Error('GitHub file has no content: ' + path);
    return GH.b64dec(file.content);
  },

  /* ─────────── baseline (accord local ↔ distant) ─────────── */
  hashes() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; }
    catch { return {}; }
  },
  /**
   * @param {Array} files        fichiers locaux (HubData.buildFiles())
   * @param {boolean} [keepHeld] true = ne PAS bouger la baseline des fichiers
   *   sans accord (conflit, ou « seul le local a bougé » — la poussée n'a pas
   *   encore eu lieu, on ne peut pas dire qu'on est d'accord). false (défaut,
   *   appelé par autoBackup après une poussée/skip) = accord rétabli partout.
   */
  record(files, keepHeld) {
    if (!keepHeld) this._hold = new Set();
    try {
      const h = this.hashes();
      const keep = new Set(files.map(f => f.path));
      Object.keys(h).forEach(p => { if (!keep.has(p)) delete h[p]; });
      files.forEach(f => {
        if (keepHeld && this._hold.has(f.path)) return;
        h[f.path] = f.sha256;
      });
      localStorage.setItem(this.KEY, JSON.stringify(h));
    } catch (e) { console.warn('[sync] baseline', e); }
  },

  /* ─────────── indexation fichier → collection ─────────── */
  _entryOfPath(path) {
    if (!path || !path.startsWith(HubData.PATH)) return null;
    const name = path.slice(HubData.PATH.length).replace(/\.part\d+\.json$/, '.json');
    return HubData.LIST.find(e => e.file === name) || null;
  },
  /** empreinte d'un ensemble de fichiers d'une collection (ordre indifférent) */
  _sig(list) {
    if (!list || !list.length) return null;
    return list.map(f => f.sha256).sort().join('|');
  },
  /** dernière baseline connue pour ces fichiers — undefined = jamais synchronisé */
  _lastSig(list, last) {
    if (!list || !list.length) return null;
    const parts = [];
    for (const f of list) {
      if (!last[f.path]) return undefined;
      parts.push(last[f.path]);
    }
    return parts.sort().join('|');
  },

  /* ─────────── tirage ─────────── */
  /** @returns {Promise<{pulled?:string[],conflicts?:string[],none?:boolean,skipped?:string}>} */
  async run() {
    const token = Auth.token(); const user = Auth.user();
    if (!Auth.ok() || !user) return { skipped: 'auth' };
    const owner = user.login;
    const repo  = owner.toLowerCase() + REPO_DATA_SUFFIX;

    let manifestRaw;
    try { manifestRaw = await this._remoteFile(token, owner, repo, 'data/manifest.json'); }
    catch (error) {
      if (error.status !== 404) throw error;
      // Un ancien backup.json ne doit jamais être remplacé par un dépôt vide.
      try {
        await this._remoteFile(token, owner, repo, 'backup.json');
        this._block(owner, 'legacy');
        return { legacy: true };
      } catch (legacyError) {
        if (legacyError.status !== 404) throw legacyError;
      }
      this._unblock();
      return { none: true };
    }
    let manifest;
    try { manifest = JSON.parse(manifestRaw); } catch { throw new Error('Invalid GitHub backup manifest'); }
    if (manifest?.hub !== 'souanpt-hub' || !Array.isArray(manifest.files)) {
      throw new Error('Invalid GitHub backup manifest');
    }

    const localFiles = await HubData.buildFiles();
    const last = this.hashes();

    // Regroupement des deux côtés par collection
    const byEntry = files => {
      const m = new Map();
      (files || []).forEach(f => {
        const e = this._entryOfPath(f.path);
        if (!e) return;
        if (!m.has(e)) m.set(e, []);
        m.get(e).push(f);
      });
      return m;
    };
    const remoteFiles = manifest.files;
    const seen = new Set();
    for (const f of remoteFiles) {
      if (!f || !this._entryOfPath(f.path) || !/^[a-f0-9]{64}$/i.test(f.sha256 || '') || seen.has(f.path)) {
        throw new Error('Invalid GitHub backup file list');
      }
      seen.add(f.path);
    }
    const L = byEntry(localFiles);
    const R = byEntry(remoteFiles);

    const pull = [], conflicts = [], hold = new Set();
    // `hold` = chemins SANS accord : leur baseline ne doit surtout pas bouger.
    const addHold = e => (L.get(e) || []).forEach(f => hold.add(f.path));
    const keys = new Set([...L.keys(), ...R.keys()]);
    for (const e of keys) {
      const localGroup = L.get(e) || [];
      const remoteSig = this._sig(R.get(e));
      const localSig  = this._sig(localGroup);

      if (!remoteSig) { addHold(e); continue; }                 // jamais sauvegardé → pas d'accord
      if (localSig && localSig === remoteSig) continue;          // déjà d'accord → baseline à jour

      const lastSig = this._lastSig(localGroup, last);
      if (lastSig === null)      { pull.push(e); continue; }     // local vide → GitHub gagne
      if (lastSig === undefined) {
        const value = HubData.read(e);
        if (value === null || (Array.isArray(value) && !value.length)) pull.push(e);
        else { conflicts.push(e); addHold(e); }
        continue;
      }
      if (lastSig === localSig)  { pull.push(e); continue; }     // seul GitHub a bougé → tiré = accord
      if (lastSig === remoteSig) { addHold(e); continue; }       // seul le local : la poussée tranchera
      conflicts.push(e); addHold(e);                             // les 2 ont bougé
    }

    const conflictKeys = conflicts.map(e => e.key);

    /* Rien à tirer : on n'écrit une baseline que pour ce qui EST d'accord,
       sinon un « seul le local a bougé » non poussé serait pris pour un
       accord, et la session suivante écraserait les données locales. */
    if (!pull.length) {
      this._hold = hold;
      this.record(localFiles, true);
      if (conflictKeys.length) this._block(owner, 'conflict', conflictKeys);
      else this._unblock();
      localStorage.setItem('souanpt_last_pull', Date.now().toString());
      return { pulled: [], conflicts: conflictKeys };
    }

    // Tirage séquentiel (Accept: raw) : une cascade de requêtes parallèles
    // se prend le rate-limit GitHub (5 000 requêtes/heure) dans la figure.
    const map = {};
    for (const e of pull) {
      for (const f of (R.get(e) || [])) {
        const c = await this._remoteFile(token, owner, repo, f.path);
        if (await HubData._sha256(c) !== f.sha256) throw new Error('GitHub backup checksum mismatch: ' + f.path);
        const parsed = JSON.parse(c);
        if (e.type === 'array' && !Array.isArray(parsed)) throw new Error('Invalid GitHub backup collection: ' + f.path);
        map[f.path] = c;
      }
    }
    const restored = HubData.applyFiles(map);
    if (restored.length !== pull.length) throw new Error('GitHub backup restoration was incomplete');

    // Nouvelle baseline = ce qui vient d'être écrit (accord rétabli), sauf les
    // chemins en `hold` (conflit / à pousser) qui gardent leur ancienne baseline.
    // Un tirage PARTIEL (un fichier en rate-limit) n'est pas non plus un accord.
    let expected = 0;
    pull.forEach(e => { expected += (R.get(e) || []).length; });
    this._hold = hold;
    if (restored.length && Object.keys(map).length >= expected) {
      this.record(await HubData.buildFiles(), true);
    }
    if (conflictKeys.length) this._block(owner, 'conflict', conflictKeys);
    else this._unblock();
    localStorage.setItem('souanpt_last_pull', Date.now().toString());
    return { pulled: restored, conflicts: conflictKeys };
  },

  /**
   * Point d'entrée unique, inévitable (appels multiples = 1 seul tirage).
   * @param {{force?:boolean}} [opts] force = tirer même si déjà fait cette session
   */
  boot(opts) {
    if (typeof Auth === 'undefined' || !Auth.ok()) return Promise.resolve({ skipped: 'auth' });
    const owner = Auth.user()?.login;
    if (this._owner !== owner) { this._owner = owner; this._done = false; }
    if (this.pending) return this.pending;
    if (this._done && !(opts && opts.force)) return Promise.resolve({ skipped: 'done' });

    this.pending = this.run()
      .then(res => {
        this._done = true;
        const toast = (m, c, ms) => { try { window.showToast && showToast(m, c, ms); } catch {} };
        if (res && res.pulled && res.pulled.length) {
          try { window.reloadAllData && reloadAllData(); } catch {}
          toast('☁ ' + res.pulled.length + ' collection(s) récupérée(s) depuis ton GitHub privé',
                '#2e9a63', 3500);
        }
        if (res && res.conflicts && res.conflicts.length) {
          toast('⚠ ' + res.conflicts.length + ' donnée(s) modifiées sur 2 appareils : ' +
                'sauvegarde automatique arrêtée pour protéger les deux versions (' + res.conflicts.join(', ') + ')',
                '#e4b24a', 8000);
        }
        if (res?.legacy) toast('⚠ Ancienne sauvegarde détectée : sauvegarde automatique arrêtée avant restauration', '#e4b24a', 8000);
        return res;
      })
      .catch(e => {
        console.warn('[sync]', e);
        this._block(owner, 'read');
        this._done = false;
        return { error: String(e && e.message || e) };
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  },
};

window.HubSync = HubSync;
