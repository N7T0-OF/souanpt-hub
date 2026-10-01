'use strict';
/**
 * core.js — GitHub API + Auth (PAT direct, 100% gratuit, zéro proxy)
 * Déploiement atomique (1 seul commit) + vérification Pages + sync Behance RSS
 */

/* ══════════════════════════════════════════════════════
   GITHUB API
══════════════════════════════════════════════════════ */
const GH = {
  BASE: 'https://api.github.com',

  /* ── T5 : relais d'authentification (functions/api/*.js sur Cloudflare) ──
     `souanpt_relay_base` est écrit par GhSession (js/gh-auth.js) au moment où
     le relais a répondu pour la première fois. Vide/null = aucun relais connu →
     on reste en accès direct avec un token (mode historique, inchangé).        */
  relayBase() {
    try {
      const v = localStorage.getItem('souanpt_relay_base');
      // Valeur fantôme possible si localStorage a été pollué (« undefined »…) :
      // seule une origine http(s) absolue est acceptée.
      return (v && /^https?:\/\//.test(v)) ? v : null;
    } catch { return null; }
  },
  /** Mode relais = session ouverte SANS jeton local : tout doit passer par /api/gh. */
  relayMode() {
    return !!(typeof Auth !== 'undefined' && Auth.isRelay && Auth.isRelay() && this.relayBase());
  },
  /** En-tête d'authentification : fabriqué ICI en mode token, fabriqué par le
      serveur (cookie HttpOnly) en mode relais — le jeton ne quitte alors jamais
      le relais. */
  authHeaders(token) {
    return (this.relayMode() || !token) ? {} : { 'Authorization': 'token ' + token };
  },
  /** TRANSPORT UNIQUE : la seule porte de sortie vers api.github.com. */
  async req(path, init) {
    init = init || {};
    if (this.relayMode()) {
      const headers = Object.assign({}, init.headers || {});
      delete headers.Authorization; delete headers.authorization;
      return fetch(this.relayBase() + '/api/gh?path=' + encodeURIComponent(path),
        Object.assign({}, init, { headers, credentials: 'include' }));
    }
    return fetch(this.BASE + path, init);
  },

  async api(token, path, opts) {
    const headers = {
      ...this.authHeaders(token),
      'Accept': 'application/vnd.github.v3+json',
      ...(opts?.headers || {}),
    };
    // Content-Type seulement quand il y a un corps : en mode relais, un GET
    // « application/json » déclencherait un preflight CORS pour rien.
    if (opts && opts.body != null && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await this.req(path, { ...opts, headers });
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'GitHub ' + res.status);
    return data;
  },

  b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  },
  b64dec(str) {
    const bin = atob(str.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },
  /** Base64 d'octets BRUTS (PDF, image, GIF…).
      ⚠ Ne JAMAIS passer un binaire par b64enc : TextEncoder le réinterprète en
      UTF-8 et corrompt le fichier. Découpé en tranches pour ne pas saturer la
      pile d'appels sur les gros fichiers. */
  b64encBytes(u8) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(bin);
  },

  async getUser(token)            { return this.api(token, '/user'); },
  async getRepo(token, owner, r)  { return this.api(token, `/repos/${owner}/${r}`); },

  async fileSha(token, owner, repo, path) {
    try { return (await this.api(token, `/repos/${owner}/${repo}/contents/${path}`)).sha || null; }
    catch { return null; }
  },

  async loadFile(token, owner, repo, path) {
    try {
      const res = await this.api(token, `/repos/${owner}/${repo}/contents/${path}`);
      return { data: this.b64dec(res.content), sha: res.sha };
    } catch { return { data: null, sha: null }; }
  },

  /** Lecture BRUTE d'un fichier (Accept: raw) — pas de base64 à décoder,
      utile quand on tire une vingtaine de fichiers pendant une restauration. */
  async rawFile(token, owner, repo, path) {
    try {
      const res = await this.req(`/repos/${owner}/${repo}/contents/${path}`, {
        headers: { ...this.authHeaders(token), 'Accept': 'application/vnd.github.raw+json' },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  },

  /** Crée le dépôt s'il n'existe pas */
  async ensureRepo(token, username, repoName, isPrivate = true) {
    try { await this.api(token, `/repos/${username}/${repoName}`); return; } catch {}
    await this.api(token, '/user/repos', { method: 'POST', body: JSON.stringify({
      name: repoName, private: isPrivate, auto_init: true,
      description: 'souanpt.hub — généré automatiquement',
      has_issues: true,
    })});
    await new Promise(r => setTimeout(r, 2500));
  },

  async putFile(token, owner, repo, path, content, sha, msg) {
    return this.api(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: msg || 'update', content: this.b64enc(content), ...(sha ? {sha} : {}) }),
    });
  },

  /** Supprime un fichier (nécessite le sha actuel). Silencieux si absent. */
  async deleteFile(token, owner, repo, path, msg) {
    try {
      const sha = await this.fileSha(token, owner, repo, path);
      if (!sha) return false;
      await this.api(token, `/repos/${owner}/${repo}/contents/${path}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: msg || 'remove', sha }),
      });
      return true;
    } catch { return false; }
  },

  /** Fichiers réellement présents sous data/ (1 requête, [] si dossier absent).
      Sert à repérer les orphelins qu'un manifeste en retard ne listerait plus. */
  async dataPaths(token, owner, repo) {
    try {
      const res = await this.api(token, `/repos/${owner}/${repo}/contents/data`);
      const list = Array.isArray(res) ? res : [res];
      return list.filter(f => f && f.type === 'file').map(f => f.path);
    } catch { return []; }
  },

  /**
   * Commit ATOMIQUE de plusieurs fichiers en un seul commit (Git Data API).
   * Évite les builds Pages concurrents → cause du "Deployment failed, try again later".
   * files: [{ path, content }]  texte UTF-8
   *        [{ path, b64 }]      BINAIRE (image, PDF) — le blob est créé à part
   *                             puis référencé par son sha : `content` de l'API
   *                             des arbres n'accepte que du texte, il corromprait
   *                             un octet hors UTF-8.
   */
  async commitFiles(token, owner, repo, files, message) {
    const info   = await this.api(token, `/repos/${owner}/${repo}`);
    const branch = info.default_branch || 'main';
    const ref    = await this.api(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const baseSha    = ref.object.sha;
    const baseCommit = await this.api(token, `/repos/${owner}/${repo}/git/commits/${baseSha}`);
    // Binaire d'abord (séquentiellement : GitHub limite les requêtes simultanées),
    // puis un seul arbre — les blobs sont réutilisés s'ils existent déjà.
    const entries = [];
    for (const f of files) {
      if (f.b64) {
        const blob = await this.api(token, `/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: f.b64, encoding: 'base64' }),
        });
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      } else {
        entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
      }
    }
    const tree = await this.api(token, `/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }),
    });
    const commit = await this.api(token, `/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
    });
    await this.api(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    return commit.sha;
  },

  /** Active GitHub Pages (branche main, racine). Idempotent. */
  async enablePages(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages`); } catch {}
    try {
      return await this.api(token, `/repos/${owner}/${repo}/pages`, {
        method: 'POST', body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
      });
    } catch { return null; } // 409 = déjà activé
  },

  async pagesInfo(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages`); } catch { return null; }
  },
  async pagesLatestBuild(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages/builds/latest`); } catch { return null; }
  },
  async pagesRequestBuild(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages/builds`, { method: 'POST' }); } catch { return null; }
  },

  async runs(token, owner, repo, n = 5) {
    try { return (await this.api(token, `/repos/${owner}/${repo}/actions/runs?per_page=${n}`)).workflow_runs || []; }
    catch { return []; }
  },
};

/* ══════════════════════════════════════════════════════
   AUTH — identité + session (T5 : le jeton peut vivre AILLEURS)

   Deux façons d'être « connecté GitHub » :
     • mode token  : { token, user } — jeton PAT dans localStorage (historique) ;
     • mode relais : { session:'relay', user } — AUCUN jeton dans le navigateur,
       le jeton dort dans le cookie HttpOnly du relais (functions/api/auth.js).
   `ok()` est le test de connexion à préférer ; `token()` peut être vide alors
   que la connexion est bonne, ce n'est plus un signal d'erreur.
══════════════════════════════════════════════════════ */
const Auth = {
  _K: 'souanpt_auth_v2',
  get()             { try { return JSON.parse(localStorage.getItem(this._K) || '{}'); } catch { return {}; } },
  /** Notifie l'UI qu'un état de session a changé (les boutons « non
      disponible » se revalident — voir refreshAvail dans ui.js). */
  _ping()           { try { window.dispatchEvent(new Event('hub-auth')); } catch {} },
  save(d)           { localStorage.setItem(this._K, JSON.stringify(d)); this._ping(); },
  token()           { const d = this.get(); return d.session ? '' : (d.token || ''); },
  user()            { return this.get().user  || null; },
  owner()           { return this.user()?.login || ''; },
  set(token, user)  { this.save({ token, user, ts: Date.now() }); },
  /** Ouvre une session RELAIS : l'identité reste locale, le jeton reste au bord. */
  setSession(user)  { this.save({ session: 'relay', user, ts: Date.now() }); },
  isRelay()         { return this.get().session === 'relay'; },
  ok()              { const d = this.get(); return !!(d.token || (d.session && d.user)); },
  clear() {
    const relay = this.isRelay();
    localStorage.removeItem(this._K);
    try { localStorage.removeItem('souanpt_relay_base'); } catch {}
    if (relay && typeof GhSession !== 'undefined') { try { GhSession.logout(); } catch {} }
    this._ping();
  },
};

/* ══════════════════════════════════════════════════════
   CONNEXION GITHUB
══════════════════════════════════════════════════════ */
const REPO_DATA_SUFFIX  = '-hub-data';   // {username}-hub-data (backup privé)
const REPO_FILES_SUFFIX = '-hub-files';  // {username}-hub-files (fichiers PRIVÉS)

/* ══════════════════════════════════════════════════════
   HubFiles — stockage de fichiers sur GitHub (gratuit à vie, sans carte).
     • PUBLIC  → dépôt du site  → URL stable servie par GitHub Pages
     • PRIVÉ   → dépôt privé    → GitHub applique l'accès côté SERVEUR
     • Versions → historique git (gratuit) ; remplacer garde le MÊME chemin/URL
   Les métadonnées (nom, dossier, tags, visibilité, usages) vivent dans
   localStorage `hub_files` et sont miroitées vers Firestore par Cloud.
══════════════════════════════════════════════════════ */
const FILE_BLOCKED_EXT = ['exe','msi','bat','cmd','scr','com','vbs','ps1','jar','dll'];
const FILE_MAX_BYTES   = 25 * 1024 * 1024;   // 25 Mo : marge sûre sous la limite API GitHub

/* ══════════════════════════════════════════════════════════════════════
   Thumbs — aperçus de couverture, générés DANS LE NAVIGATEUR.

   Pourquoi local : c'est gratuit et instantané. Le fichier complet est
   déjà dans la mémoire du navigateur au moment de l'envoi, donc fabriquer
   la vignette à ce moment-là ne coûte ni bande passante ni serveur.
   Aucun octet ne part vers un service tiers.

   Le but est de RECONNAÎTRE un fichier, pas de le reproduire : 320 px de
   côté maximum, WebP qualité 0.62 → typiquement 8 à 25 Ko, contre
   plusieurs Mo pour l'original. C'est ce qui remplace l'ancien affichage,
   qui téléchargeait l'image ENTIÈRE pour remplir une case de 150 px.
══════════════════════════════════════════════════════════════════════ */
const THUMB_MAX = 320;
const THUMB_Q   = 0.62;
/* pdf.js servi par jsDelivr, qui publie le PAQUET COMPLET — pas seulement les
   bundles JS. C'est indispensable : sans `standard_fonts/`, pdf.js ne peut pas
   peindre un PDF dont les polices ne sont pas embarquées (le cas de la plupart
   des CV faits sous Word ou LibreOffice) et le rendu reste bloqué sans erreur.
   Vérifié : cdnjs ne sert ni standard_fonts/ ni cmaps/. */
const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
const PDFJS_URL  = PDFJS_BASE + 'build/pdf.min.js';
const PDFJS_WK   = PDFJS_BASE + 'build/pdf.worker.min.js';

const Thumbs = {
  /** Réduit un canvas/bitmap en WebP (repli PNG si le navigateur refuse). */
  async _encode(canvas) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', THUMB_Q));
    if (blob && blob.size) return { blob, ext: 'webp' };
    const png = await new Promise(r => canvas.toBlob(r, 'image/png'));
    return png ? { blob: png, ext: 'png' } : null;
  },
  /** Dessine une source (bitmap/vidéo) réduite à THUMB_MAX. */
  async _draw(src, sw, sh) {
    if (!sw || !sh) return null;
    const s = Math.min(1, THUMB_MAX / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    const enc = await this._encode(c);
    return enc ? { ...enc, w, h } : null;
  },

  /** Image ou GIF — pour un GIF, createImageBitmap ne garde que la 1re image. */
  async fromImage(file) {
    const bmp = await createImageBitmap(file);
    try { return await this._draw(bmp, bmp.width, bmp.height); }
    finally { bmp.close && bmp.close(); }
  },

  /** Vidéo — image extraite à ~10 % de la durée (le début est souvent noir). */
  fromVideo(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      let done = false;
      const finish = async ok => {
        if (done) return; done = true;
        clearTimeout(timer);
        let out = null;
        if (ok) { try { out = await this._draw(v, v.videoWidth, v.videoHeight); } catch (e) {} }
        URL.revokeObjectURL(url); v.removeAttribute('src'); v.load?.();
        resolve(out);
      };
      // Garde-fou : un conteneur non décodable resterait bloqué pour toujours.
      const timer = setTimeout(() => finish(false), 12000);
      v.muted = true; v.preload = 'metadata'; v.playsInline = true;
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(Math.max(v.duration * 0.1, 0.1), 10); } catch (e) { finish(false); } };
      v.onseeked = () => finish(true);
      v.onerror = () => finish(false);
      v.src = url;
    });
  },

  /** PDF — première page. PDF.js n'est chargé QUE si un PDF est déposé (§11). */
  _pdfjs: null,
  loadPdfJs() {
    if (this._pdfjs) return this._pdfjs;
    this._pdfjs = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        if (!window.pdfjsLib) return reject(new Error('pdf.js indisponible'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WK;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('pdf.js : chargement impossible'));
      document.head.appendChild(s);
    }).catch(e => { this._pdfjs = null; throw e; });
    return this._pdfjs;
  },
  /* pdf.js peint la page via requestAnimationFrame. Or un onglet EN ARRIÈRE-PLAN
     ne reçoit plus de rAF : le rendu ne se termine jamais. Si l'utilisateur
     dépose un PDF puis change d'onglet, on attend simplement son retour au lieu
     d'abandonner. (C'est aussi ce qui bloquait le rendu en test : la page de
     test est masquée en permanence.) */
  whenVisible(maxMs) {
    if (!document.hidden) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { clearTimeout(t); document.removeEventListener('visibilitychange', h); resolve(ok); };
      const h = () => { if (!document.hidden) done(true); };
      const t = setTimeout(() => done(false), maxMs || 120000);
      document.addEventListener('visibilitychange', h);
    });
  },

  async fromPdf(file) {
    const lib = await this.loadPdfJs();
    if (!(await this.whenVisible(120000))) throw new Error('onglet en arrière-plan : rendu PDF impossible');
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({
      data: buf,
      standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',   // polices non embarquées
      cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true,      // textes CJK / encodages exotiques
    }).promise;
    try {
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, THUMB_MAX / Math.max(v1.width, v1.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // Fond blanc : un PDF sans fond donnerait une vignette transparente,
      // illisible sur l'interface sombre.
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      // Le délai ne couvre QUE la peinture : l'attente de visibilité ci-dessus
      // peut légitimement durer des minutes et ne doit pas compter dedans.
      await this._limit(page.render({ canvasContext: ctx, viewport: vp }).promise, 20000, 'rendu PDF');
      const enc = await this._encode(c);
      return enc ? { ...enc, w: c.width, h: c.height, pages: pdf.numPages } : null;
    } finally { pdf.destroy && pdf.destroy(); }
  },

  /** Durée d'un média audio (secondes), sans image. */
  duration(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('audio');
      const finish = d => { clearTimeout(t); URL.revokeObjectURL(url); resolve(d); };
      const t = setTimeout(() => finish(0), 8000);
      a.onloadedmetadata = () => finish(isFinite(a.duration) ? Math.round(a.duration) : 0);
      a.onerror = () => finish(0);
      a.preload = 'metadata'; a.src = url;
    });
  },

  /** Texte — premières lignes utiles, pour reconnaître le document. */
  async excerpt(file) {
    const slice = file.slice(0, 8192);
    const txt = await slice.text();
    const lines = txt.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    return lines.slice(0, 4).join(' · ').slice(0, 220);
  },

  /* ZIP — nombre d'entrées lu dans le « End Of Central Directory », les
     22 derniers octets du fichier. Aucune bibliothèque : on ne décompresse
     rien, on lit juste un compteur. */
  async zipCount(file) {
    try {
      const tail = new DataView(await file.slice(Math.max(0, file.size - 66000)).arrayBuffer());
      for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === 0x06054b50) return tail.getUint16(i + 10, true);
      }
    } catch (e) {}
    return 0;
  },

  /* Abandonne au bout de N ms. Un fichier corrompu ou un décodeur qui part en
     boucle ne doit pas laisser une promesse en suspens pour toujours : un PDF
     malformé suffit à bloquer pdf.js, et l'aperçu est un bonus, pas un dû. */
  _limit(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé : ' + label)), ms)),
    ]);
  },

  /** Point d'entrée : fabrique l'aperçu adapté au type. Jamais d'exception. */
  async build(file, kind, ext) {
    try {
      const T = (p, ms, l) => this._limit(p, ms, l);
      if (kind === 'image' || kind === 'gif') {
        const r = await T(this.fromImage(file), 15000, 'image');
        return r && { type: 'thumbnail', ...r };
      }
      if (kind === 'video') {
        const r = await this.fromVideo(file);          // garde-fou interne (12 s)
        return r && { type: 'thumbnail', ...r };
      }
      // Pas de délai global ici : fromPdf peut attendre le retour de l'onglet,
      // et borne lui-même la phase de peinture.
      if (ext === 'pdf') {
        const r = await this.fromPdf(file);
        return r && { type: 'thumbnail', ...r };
      }
      if (kind === 'audio')                            return { type: 'audio', seconds: await this.duration(file) };
      if (['txt','md','csv','json','srt','log'].includes(ext)) return { type: 'text', text: await T(this.excerpt(file), 10000, 'texte') };
      if (['zip','cbz'].includes(ext))                 return { type: 'zip', entries: await this.zipCount(file) };
    } catch (e) { console.warn('[thumbs] ' + (ext || kind), e); }
    return null;   // pas d'aperçu possible → l'icône de type suffit
  },
};

const HubFiles = {
  KEY: 'hub_files',
  list()      { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; } },
  _save(l)    { localStorage.setItem(this.KEY, JSON.stringify(l)); },
  get(id)     { return this.list().find(f => f.id === id) || null; },
  _safe(n)    { return String(n || 'fichier').replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'fichier'; },
  _ext(n)     { const m = String(n || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; },
  _kind(mime, ext) {
    if (/^image\/gif/.test(mime) || ext === 'gif') return 'gif';
    if (/^image\//.test(mime))  return 'image';
    if (/^video\//.test(mime))  return 'video';
    if (/^audio\//.test(mime))  return 'audio';
    if (ext === 'pdf')          return 'pdf';
    if (['zip','7z','rar'].includes(ext)) return 'archive';
    return 'document';
  },
  /** Diagnostic précis de l'accès GitHub (les fichiers y sont stockés).
      Renvoie {ok, reason}. « connecté » au Hub ≠ « GitHub connecté » : on peut
      entrer avec Google/Discord sans aucun jeton GitHub — d'où un message clair. */
  access() {
    // ⚠ `Auth` est déclaré avec const → il n'existe PAS sur window (contrairement
    // à var/function). Tester window.Auth renvoyait toujours undefined et affichait
    // « Connecte GitHub » alors que l'utilisateur était bien connecté.
    if (typeof Auth === 'undefined' || !Auth.ok()) {
      const viaCloud = !!(window.Cloud && Cloud.enabled && Cloud.user());
      return { ok: false, reason: viaCloud ? 'cloud-only' : 'none' };
    }
    return { ok: true, reason: Auth.owner() ? 'ok' : 'no-login' };
  },
  /** Répare le cas « jeton présent mais identité manquante » (login absent). */
  async ensureIdentity() {
    if (Auth.owner()) return Auth.owner();
    const token = Auth.token(); if (!Auth.ok()) return '';
    const user = await GH.getUser(token);          // /user
    if (user && user.login) {
      // En mode relais on ne doit JAMAIS réécrire { token:'' } : cela rendrait
      // Auth.ok() faux alors que la session est bonne.
      if (Auth.isRelay()) Auth.setSession(user); else Auth.set(token, user);
      return user.login;
    }
    return '';
  },

  /** Dépôt cible selon la visibilité */
  _repo(visibility) {
    const owner = Auth.owner();
    if (!owner) throw new Error('Identité GitHub introuvable — reconnecte GitHub dans Paramètres → Intégrations');
    if (visibility === 'public') {
      const cfg = SiteConfig.get();
      return { owner, repo: (cfg.repo || '').split('/')[1] || SITE_REPO_NAME, private: false };
    }
    return { owner, repo: owner.toLowerCase() + REPO_FILES_SUFFIX, private: true };
  },
  /** URL publique stable (inchangée si on remplace le fichier) */
  publicUrl(meta) {
    if (!meta || meta.visibility !== 'public') return '';
    return `https://${String(meta.owner).toLowerCase()}.github.io/${meta.repo}/${meta.path}`;
  },

  /** Envoie un File vers GitHub. visibility: 'private' (défaut) | 'public'. */
  async upload(file, opts) {
    opts = opts || {};
    const visibility = opts.visibility === 'public' ? 'public' : 'private';   // PRIVÉ par défaut
    const token = Auth.token();
    if (!Auth.ok()) throw new Error('GitHub non connecté');
    await this.ensureIdentity();               // répare un login manquant avant d'écrire
    const name = this._safe(file.name), ext = this._ext(name);
    if (FILE_BLOCKED_EXT.includes(ext)) throw new Error('Type de fichier interdit : .' + ext);
    if (file.size > FILE_MAX_BYTES) throw new Error('Fichier trop lourd (max 25 Mo)');

    const { owner, repo, private: isPriv } = this._repo(visibility);
    if (isPriv) await GH.ensureRepo(token, owner, repo, true);

    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const path = 'files/' + (opts.folder ? this._safe(opts.folder) + '/' : '') + id + '-' + name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // ⚠ binaire : surtout PAS b64enc (TextEncoder corromprait le fichier)
    const b64 = GH.b64encBytes(bytes);
    await GH.api(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: 'file: ' + name, content: b64 }),
    });

    const meta = {
      id, owner, repo, path, name, displayName: opts.displayName || file.name,
      mime: file.type || '', ext, size: file.size, kind: this._kind(file.type || '', ext),
      visibility, folder: opts.folder || '', tags: [], usages: [], fav: false,
      sha: opts.sha || await this.hash(file),   // empreinte → doublons
      createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
    };
    const l = this.list(); l.push(meta); this._save(l);
    // L'aperçu est fabriqué APRÈS coup, sans bloquer : si sa génération ou
    // son envoi échoue, le fichier est déjà en sécurité sur GitHub.
    this.attachPreview(meta.id, file).catch(() => {});
    return meta;
  },

  /** Remplace le contenu SANS changer l'URL publique ni l'identifiant (§8). */
  async replace(id, file) {
    const meta = this.get(id); if (!meta) throw new Error('Fichier introuvable');
    const token = Auth.token(); if (!Auth.ok()) throw new Error('Connecte GitHub');
    if (file.size > FILE_MAX_BYTES) throw new Error('Fichier trop lourd (max 25 Mo)');
    const sha = await GH.fileSha(token, meta.owner, meta.repo, meta.path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: 'replace: ' + meta.name, content: GH.b64encBytes(bytes), ...(sha ? { sha } : {}) }),
    });
    meta.size = file.size; meta.mime = file.type || meta.mime; meta.updatedAt = Date.now();
    const l = this.list().map(f => f.id === id ? meta : f); this._save(l);
    return meta;   // même path → même URL publique, blocs du site intacts
  },

  /** Change la visibilité = DÉPLACE réellement le fichier entre le dépôt public
      (site) et le dépôt privé. ⚠ L'URL publique change forcément (dépôt différent) :
      c'est le prix du vrai cloisonnement. Le contenu est recopié tel quel (base64
      de GitHub réutilisé sans décodage → aucun risque de corruption). */
  async setVisibility(id, visibility) {
    const meta = this.get(id); if (!meta) throw new Error('Fichier introuvable');
    if (meta.visibility === visibility) return meta;
    const token = Auth.token(); if (!Auth.ok()) throw new Error('Connecte GitHub');
    const cur = await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.path}`);
    const b64 = String(cur.content || '').replace(/\n/g, '');
    const oldRepo = meta.repo, oldSha = cur.sha;
    const target = this._repo(visibility);
    if (target.private) await GH.ensureRepo(token, target.owner, target.repo, true);
    await GH.api(token, `/repos/${target.owner}/${target.repo}/contents/${meta.path}`, {
      method: 'PUT', body: JSON.stringify({ message: 'move: ' + meta.name, content: b64 }),
    });
    if (oldSha) await GH.api(token, `/repos/${meta.owner}/${oldRepo}/contents/${meta.path}`, {
      method: 'DELETE', body: JSON.stringify({ message: 'move out: ' + meta.name, sha: oldSha }),
    }).catch(() => {});
    // La vignette DOIT suivre : laissée dans le dépôt public, la première
    // page d'un document redevenu privé resterait lisible par tout le monde.
    if (meta.preview && meta.preview.path) {
      try {
        const tp = meta.preview.path;
        const t = await GH.api(token, `/repos/${meta.owner}/${oldRepo}/contents/${tp}`);
        await GH.api(token, `/repos/${target.owner}/${target.repo}/contents/${tp}`, {
          method: 'PUT', body: JSON.stringify({ message: 'move thumb: ' + meta.name, content: String(t.content || '').replace(/\n/g, '') }),
        });
        await GH.api(token, `/repos/${meta.owner}/${oldRepo}/contents/${tp}`, {
          method: 'DELETE', body: JSON.stringify({ message: 'move thumb out: ' + meta.name, sha: t.sha }),
        }).catch(() => {});
      } catch (e) {
        // Impossible de déplacer l'aperçu : on l'oublie plutôt que de risquer
        // qu'il reste visible côté public ou qu'il pointe dans le vide.
        console.warn('[thumb] déplacement', e);
        delete meta.preview;
      }
    }
    meta.repo = target.repo; meta.visibility = visibility; meta.updatedAt = Date.now();
    this._save(this.list().map(f => f.id === id ? meta : f));
    return meta;
  },

  /* ══ Aperçus de couverture ══════════════════════════════════════════
     La vignette vit dans LE MÊME DÉPÔT que son fichier. C'est essentiel :
     la première page d'un CV privé est une donnée privée. La déposer dans
     le dépôt public reviendrait à publier le document tout en le croyant
     protégé. Elle suit donc le fichier quand il change de visibilité, et
     disparaît avec lui.                                                   */
  _thumbPath(meta, ext) { return 'thumbs/' + meta.id + '.' + (ext || 'webp'); },

  /** Génère l'aperçu et le stocke. Ne lève jamais : un aperçu est un bonus. */
  async attachPreview(id, file) {
    const meta = this.get(id); if (!meta) return null;
    const p = await Thumbs.build(file, meta.kind, meta.ext);
    if (!p) return null;
    const preview = { type: p.type, generatedAt: Date.now() };
    if (p.type === 'thumbnail' && p.blob) {
      try {
        const token = Auth.token(); if (!Auth.ok()) throw new Error('GitHub non connecté');
        const path = this._thumbPath(meta, p.ext);
        const u8 = new Uint8Array(await p.blob.arrayBuffer());
        const sha = await GH.fileSha(token, meta.owner, meta.repo, path);   // régénération
        await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${path}`, {
          method: 'PUT',
          body: JSON.stringify({ message: 'thumb: ' + meta.name, content: GH.b64encBytes(u8), ...(sha ? { sha } : {}) }),
        });
        Object.assign(preview, { path, width: p.w, height: p.h, sizeBytes: p.blob.size });
        if (p.pages) preview.pages = p.pages;
      } catch (e) { console.warn('[thumb] envoi', e); return null; }
    } else {
      // Aperçus non visuels : quelques octets de métadonnée, aucun fichier.
      if (p.seconds !== undefined) preview.seconds = p.seconds;
      if (p.text    !== undefined) preview.text    = p.text;
      if (p.entries !== undefined) preview.entries = p.entries;
    }
    const cur = this.get(id); if (!cur) return null;
    cur.preview = preview;
    this._save(this.list().map(f => f.id === id ? cur : f));
    return preview;
  },

  /** URL affichable de la vignette. Fichier privé → récupérée avec le jeton. */
  _thumbCache: {},
  async thumbUrl(id) {
    const meta = this.get(id);
    if (!meta || !meta.preview || !meta.preview.path) return '';
    if (meta.visibility === 'public') {
      return `https://${String(meta.owner).toLowerCase()}.github.io/${meta.repo}/${meta.preview.path}`;
    }
    // Privé : passe par l'API authentifiée. Mis en cache pour la session,
    // sinon chaque rendu de la grille relancerait un appel par fichier.
    const key = meta.id + ':' + meta.preview.generatedAt;
    if (this._thumbCache[key]) return this._thumbCache[key];
    const token = Auth.token(); if (!Auth.ok()) return '';
    try {
      const res = await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.preview.path}`);
      const url = 'data:image/webp;base64,' + String(res.content || '').replace(/\n/g, '');
      this._thumbCache[key] = url;
      return url;
    } catch (e) { return ''; }
  },

  /** Ouvre un fichier PRIVÉ : récupéré avec le jeton, jamais exposé publiquement. */
  async objectUrl(id) {
    const meta = this.get(id); if (!meta) throw new Error('Fichier introuvable');
    if (meta.visibility === 'public') return this.publicUrl(meta);
    const token = Auth.token(); if (!Auth.ok()) throw new Error('Connecte GitHub');
    const res = await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.path}`);
    const bin = atob(String(res.content || '').replace(/\n/g, ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: meta.mime || 'application/octet-stream' }));
  },

  /** Empreinte SHA-256 d'un fichier (crypto natif) → détection de doublons. */
  async hash(file) {
    try {
      const buf = await file.arrayBuffer();
      const d = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  },
  /** Fichier déjà présent ? (même empreinte, hors corbeille) */
  findDuplicate(sha) { return sha ? this.list().find(f => f.sha === sha && f.status !== 'trash') || null : null; },

  rename(id, displayName) {
    const n = String(displayName || '').trim(); if (!n) return null;
    const l = this.list().map(f => f.id === id ? { ...f, displayName: n, updatedAt: Date.now() } : f);
    this._save(l); return this.get(id);
  },
  toggleFav(id) {
    const l = this.list().map(f => f.id === id ? { ...f, fav: !f.fav, updatedAt: f.updatedAt } : f);
    this._save(l); return this.get(id);
  },

  /** Corbeille (réversible) puis suppression définitive côté GitHub. */
  trash(id)   { const l = this.list().map(f => f.id === id ? { ...f, status: 'trash',  deletedAt: Date.now() } : f); this._save(l); },
  restore(id) { const l = this.list().map(f => f.id === id ? { ...f, status: 'active', deletedAt: null } : f); this._save(l); },
  async destroy(id) {
    const meta = this.get(id); if (!meta) return;
    const token = Auth.token();
    if (Auth.ok()) {
      const sha = await GH.fileSha(token, meta.owner, meta.repo, meta.path);
      if (sha) await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.path}`, {
        method: 'DELETE', body: JSON.stringify({ message: 'delete: ' + meta.name, sha }),
      }).catch(() => {});
      // La vignette part avec le fichier : sinon la 1re page d'un document
      // supprimé resterait consultable dans le dépôt.
      if (meta.preview && meta.preview.path) {
        const ts = await GH.fileSha(token, meta.owner, meta.repo, meta.preview.path);
        if (ts) await GH.api(token, `/repos/${meta.owner}/${meta.repo}/contents/${meta.preview.path}`, {
          method: 'DELETE', body: JSON.stringify({ message: 'delete thumb: ' + meta.name, sha: ts }),
        }).catch(() => {});
      }
    }
    this._save(this.list().filter(f => f.id !== id));
  },
};
const HUB_REPO_NAME    = 'souanpt-hub'; // repo du dashboard — jamais utilisé comme cible de déploiement
const HUB_HOME_URL     = 'https://souanptjub.pages.dev/'; // accueil souanpt.hub V2 (Cloudflare Pages — cible du badge des sites publiés)
const ANALYTICS_URL    = 'https://souanpt-analytics.titaneolinne13.workers.dev/hit'; // mouchard des sites publiés → agrégats Firestore (Worker gratuit)
const SITE_REPO_NAME   = 'souanpt-folio'; // repo par défaut du site public

/* Origine candidate du relais d'authentification (T5) : le hub servi par
   Cloudflare Pages expose /api/… sur SA propre origine (candidat n°1), GitHub
   Pages y accède depuis une autre origine (candidat n°2). Vide = même origine.
   Surcharge possible : window.GH_RELAY = 'https://mon-relais.pages.dev'. */
const GH_RELAY_DEFAULT = 'https://souanpt-hub.pages.dev';

/** Routine commune à TOUTES les connexions GitHub (token OU relais). */
async function afterGithubConnect(user) {
  // Journal des connexions (local)
  try {
    const log = JSON.parse(localStorage.getItem('souanpt_login_log') || '[]');
    log.unshift({ ts: Date.now(), ua: (navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/) || ['Navigateur'])[0] });
    localStorage.setItem('souanpt_login_log', JSON.stringify(log.slice(0, 10)));
  } catch {}
  const cfg = SiteConfig.get();
  if (!cfg.repo || cfg.repo.split('/')[1]?.toLowerCase() === HUB_REPO_NAME) {
    cfg.repo = user.login + '/' + SITE_REPO_NAME;
    SiteConfig.save(cfg);
  }
  // Le dépôt existe peut-être déjà (ancienne session, autre appareil) :
  // on TIRE avant la première sauvegarde, sinon on écraserait son contenu.
  // autoBackup attend HubSync.pending — pas de course possible.
  try { window.HubSync && HubSync.boot({ force: true }); } catch {}
  return user;
}

async function connectGitHub(token) {
  const t = token.trim();
  if (!t) throw new Error('Token requis');
  const user = await GH.getUser(t);
  const dataRepo = user.login.toLowerCase() + REPO_DATA_SUFFIX;
  await GH.ensureRepo(t, user.login, dataRepo, true);
  Auth.set(t, { login: user.login, name: user.name, avatar_url: user.avatar_url });
  return afterGithubConnect(user);
}

/**
 * T5 — connexion par RELAIS : le jeton vient d'être posé dans le cookie HttpOnly
 * du relais (functions/api/auth.js), le navigateur ne le voit pas. Le dépôt de
 * sauvegarde est créé depuis le relais, comme en mode token.
 */
async function connectGitHubRelay(user, base) {
  if (!user || !user.login) throw new Error('Profil GitHub introuvable');
  const u = { login: user.login, name: user.name || '', avatar_url: user.avatar_url || '' };
  try { localStorage.setItem('souanpt_relay_base', base || location.origin); } catch {}
  Auth.setSession(u);                       // AVANT les appels API (mode relais actif)
  const dataRepo = u.login.toLowerCase() + REPO_DATA_SUFFIX;
  await GH.ensureRepo('', u.login, dataRepo, true);
  return afterGithubConnect(u);
}

/* ══════════════════════════════════════════════════════
   SITE CONFIG
══════════════════════════════════════════════════════ */
const SiteConfig = {
  _K: 'souanpt_site_cfg',
  defaults: () => ({
    siteName: 'FOLIO', bio: 'Designer & Motion Artist',
    accentColor: '#C8FF00', theme: '#060606', layout: '3',
    heroText: 'Créatif · Designer · Motion',
    behance: '', email: '', repo: '',
    sections: { projects: true, avis: true, contact: true, about: true },
    sectionOrder: ['about', 'projects', 'avis', 'contact'],
    // Personnalisation des sections. Vide = on garde les valeurs d'origine
    // (voir SEC_DEFAULTS) : un site déjà publié ne change pas d'apparence.
    // Par section : { title, heading, desc, icon, showTitle, showDesc }
    sectionMeta: {},
    avisMode: 'defile',
    about: '', goatcounter: '',
    layoutStyle: 'float', heroImage: '', projectsLimit: 0,
    // Bannière du thème Latérale : action au clic (voir heroLinkHref).
    // { type:'none'|'url'|'section'|'project'|'file'|'contact', url, section, projectId, blank }
    heroLink: { type: 'none' },
    // Moyens de contact. RIEN n'est publié sans `on: true` : une valeur saisie
    // puis désactivée n'apparaît pas dans le HTML généré.
    // [{ id:'email'|'discord'|'whatsapp'|'phone'|'telegram', on, value, label?, icon?, color? }]
    contactMethods: null,          // null = retombe sur l'email seul (compat)
    contactVariant: 'boutons',     // boutons · liste · cartes · icones · barre
    // Section Réseaux (v3.10) : présentation publique. Le défaut reprend
    // l'ancien rendu (icône + texte) → aucun site publié ne change d'apparence.
    socialsStyle: 'ic-texte',      // ic-texte · ic-seules · boutons · cartes · barre
    animLevel: 'smooth', fx: { tilt: false, intensity: 7, shine: false, lift: false, glow: false, mouseglow: false },
  }),
  get()    { try { return { ...SiteConfig.defaults(), ...JSON.parse(localStorage.getItem(SiteConfig._K) || '{}') }; } catch { return SiteConfig.defaults(); } },
  save(d)  { localStorage.setItem(SiteConfig._K, JSON.stringify(d)); },
  set(k,v) { const d = SiteConfig.get(); d[k] = v; SiteConfig.save(d); },
};

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getProjects() { try { return JSON.parse(localStorage.getItem('hub_projects') || '[]'); } catch { return []; } }
function getReviews()  { try { return JSON.parse(localStorage.getItem('hub_reviews')  || '[]'); } catch { return []; } }
function getLinks()    { try { return JSON.parse(localStorage.getItem('hub_links')    || '[]'); } catch { return []; } }

/* ══════════════════════════════════════════════════════
   MODÈLE DE BLOCS — source unique du contenu public.
   Un bloc = une PLACE (w/h sur la grille) + une PRÉSENTATION.
   Les données restent dans hub_projects / hub_links (via `ref`) pour ne rien
   casser (sync Behance, analytics, classement) ; les blocs libres (texte…)
   portent leurs données dans `props`.
   Même modèle pour TOUS les styles : la grille Bento le rend en grille,
   les styles flottant/latéral le regroupent en sections. Changer de style
   n'efface donc jamais un bloc.
     { id, type, w, h, ref?, props?, hidden?, locked? }
     type : profile | project | link | text | reviews | contact
══════════════════════════════════════════════════════ */
const BLOCK_COLS = 4;                       // colonnes de la grille (desktop)
const BLOCKS_VERSION = 3;
const blockUid = t => 'b_' + t + '_' + Math.random().toString(36).slice(2, 8);

/* ══ Registre des plateformes — une DONNÉE, pas du code par réseau.
   Adapté d'OpenBento (socialPlatforms.ts, cf. THIRD_PARTY_LICENSES.md) :
   {id, label, icon, color, placeholder, buildUrl(saisie)}. Ajouter un réseau =
   ajouter une ligne ici, rien d'autre à toucher. ══ */
const _h = v => String(v || '').trim().replace(/^@/, '');
const _url = (base, v) => /^https?:\/\//i.test(v) ? v : base + encodeURIComponent(_h(v));
const SOCIAL_PLATFORMS = [
  { id: 'discord',   label: 'Discord',   icon: '🎮', color: '#5865F2', placeholder: 'code d\'invitation', buildUrl: v => _url('https://discord.gg/', v) },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#E4405F', placeholder: 'pseudo',             buildUrl: v => _url('https://instagram.com/', v) },
  { id: 'behance',   label: 'Behance',   icon: '🎨', color: '#1769FF', placeholder: 'pseudo',             buildUrl: v => _url('https://www.behance.net/', v) },
  { id: 'github',    label: 'GitHub',    icon: '🐙', color: '#f0f6fc', placeholder: 'pseudo',             buildUrl: v => _url('https://github.com/', v) },
  { id: 'linkedin',  label: 'LinkedIn',  icon: '💼', color: '#0A66C2', placeholder: 'pseudo',             buildUrl: v => _url('https://www.linkedin.com/in/', v) },
  { id: 'tiktok',    label: 'TikTok',    icon: '🎵', color: '#ff0050', placeholder: 'pseudo',             buildUrl: v => /^https?:/i.test(v) ? v : 'https://www.tiktok.com/@' + encodeURIComponent(_h(v)) },
  { id: 'youtube',   label: 'YouTube',   icon: '▶',  color: '#FF0000', placeholder: 'chaîne',             buildUrl: v => /^https?:/i.test(v) ? v : 'https://www.youtube.com/@' + encodeURIComponent(_h(v)) },
  { id: 'twitch',    label: 'Twitch',    icon: '🟣', color: '#9146FF', placeholder: 'pseudo',             buildUrl: v => _url('https://twitch.tv/', v) },
  { id: 'modrinth',  label: 'Modrinth',  icon: '🧩', color: '#1bd96a', placeholder: 'pseudo',             buildUrl: v => _url('https://modrinth.com/user/', v) },
  { id: 'kofi',      label: 'Ko-fi',     icon: '☕', color: '#FF5E5B', placeholder: 'pseudo',             buildUrl: v => _url('https://ko-fi.com/', v) },
  { id: 'x',         label: 'X',         icon: '🐦', color: '#e7e9ea', placeholder: 'pseudo',             buildUrl: v => _url('https://x.com/', v) },
  { id: 'whatsapp',  label: 'WhatsApp',  icon: '💬', color: '#25D366', placeholder: 'numéro',             buildUrl: v => /^https?:\/\//i.test(v) ? v : 'https://wa.me/' + _h(v).replace(/[^\d]/g, '') },
  { id: 'telegram',  label: 'Telegram',  icon: '✈',  color: '#2AABEE', placeholder: 'pseudo',             buildUrl: v => _url('https://t.me/', v) },
  { id: 'email',     label: 'Email',     icon: '✉',  color: '#C8FF00', placeholder: 'toi@exemple.fr',     buildUrl: v => /^mailto:/i.test(v) ? v : 'mailto:' + _h(v) },
  { id: 'custom',    label: 'Lien perso', icon: '🔗', color: '#888',   placeholder: 'https://…',          buildUrl: v => /^https?:\/\//i.test(v) ? v : 'https://' + _h(v) },
];
const socialById = id => SOCIAL_PLATFORMS.find(p => p.id === id) || SOCIAL_PLATFORMS[SOCIAL_PLATFORMS.length - 1];

/* ── v3.10 : plateforme → domaine, pour RECONNAÎTRE une URL collée ──────
   On ne demande jamais l'URL complète quand le registre sait la construire :
   l'utilisateur colle, on devine d'où il vient, il valide le pseudo. */
const SOCIAL_HOSTS = {
  'instagram.com': 'instagram', 'tiktok.com': 'tiktok', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
  'behance.net': 'behance', 'github.com': 'github', 'linkedin.com': 'linkedin', 'twitch.tv': 'twitch',
  'modrinth.com': 'modrinth', 'ko-fi.com': 'kofi', 'kofi.com': 'kofi',
  'x.com': 'x', 'twitter.com': 'x', 'discord.gg': 'discord', 'discord.com': 'discord',
  'wa.me': 'whatsapp', 'whatsapp.com': 'whatsapp', 't.me': 'telegram', 'telegram.me': 'telegram',
};
/** Lit une saisie (URL, `@pseudo`, email) → plateforme + identifiant devinés. */
function socialDetect(v) {
  const s = String(v || '').trim();
  if (!s) return { platform: null, handle: '' };
  const mail = s.replace(/^mailto:/i, '');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { platform: 'email', handle: mail };
  const m = s.match(/^(?:https?:\/\/)?([^\/?#\s]+)(?:[\/?#].*)?$/i);
  if (!m) return { platform: null, handle: s };
  const host = m[1].replace(/^www\./i, '').toLowerCase();
  let platform = null;
  for (const h in SOCIAL_HOSTS) if (host === h || host.endsWith('.' + h)) { platform = SOCIAL_HOSTS[h]; break; }
  // Identifiant = PREMIER segment après le domaine (`instagram.com/souanpt`) ;
  // cas particuliers : invitation Discord, chemin LinkedIn `/in/…`.
  const segs = s.replace(/^[a-z]+:\/\//i, '').replace(/^[^\/?#\s]+[\/]?/, '').split(/[?#]/)[0].split('/').filter(Boolean);
  let handle = platform === 'discord'
    ? ((s.match(/discord\.(gg|com)\/([^\/?#\s]+)/i) || [])[2] || '')
    : platform === 'linkedin'
      ? (segs.filter(x => String(x).toLowerCase() !== 'in').pop() || '')
      : (segs[0] || '');
  if (!handle && platform) handle = host.split('.')[0];
  return { platform, handle: decodeURIComponent(handle).replace(/^@/, '') };
}
/** Plateforme d'un lien enregistré : id conservé à la création, sinon titre,
    sinon URL. Une SEULE résolution partagée par la section Réseaux, la zone
    Contact et la grille Bento → même icône, même couleur, partout. */
function socialOfLink(l) {
  if (!l) return null;
  if (l.platform) { const p = SOCIAL_PLATFORMS.find(x => x.id === l.platform); if (p) return p; }
  const t = String(l.title || '').trim().toLowerCase();
  const byLabel = SOCIAL_PLATFORMS.find(p => p.label.toLowerCase() === t);
  if (byLabel) return byLabel;
  const det = socialDetect(l.url);            // dernier recours : on lit l'URL
  return det.platform ? SOCIAL_PLATFORMS.find(x => x.id === det.platform) || null : null;
}

/** Icône d'une plateforme, déduite de son titre ou de son URL.
    Fonction unique partagée par la grille Bento et la section « Réseaux » :
    les deux doivent rendre EXACTEMENT la même icône pour le même lien. */
const platIconOf = (t, u) => {
  const s = (String(t || '') + ' ' + String(u || '')).toLowerCase();
  if (s.includes('discord')) return '🎮';   if (s.includes('instagram')) return '📸';
  if (s.includes('behance')) return '🎨';   if (s.includes('github')) return '🐙';
  if (s.includes('linkedin')) return '💼';  if (s.includes('tiktok')) return '🎵';
  if (s.includes('youtube')) return '▶';    if (s.includes('twitch')) return '🟣';
  if (s.includes('kofi') || s.includes('ko-fi')) return '☕';
  if (s.includes('modrinth')) return '🧩';  if (s.includes('whatsapp') || s.includes('wa.me')) return '💬';
  if (s.includes('telegram') || s.includes('t.me')) return '✈';
  if (s.includes('x.com') || s.includes('twitter')) return '🐦';
  if (s.includes('mailto') || s.includes('@')) return '✉';
  return '🔗';
};

/* ══════════════════════════════════════════════════════════════════════
   CHIFFRES CLÉS — les sources « auto » de la section Stats.

   Le site publié est un FICHIER STATIQUE : il ne lit PAS le localStorage du
   Hub (origin différente). Les valeurs sont donc calculées au moment de la
   GÉNÉRATION (aperçu ou publication) et figées dans le HTML. Pour un compteur
   qui continue de bouger après la publication, la section accepte une API
   publique relue à chaque visite (cf. `kind:'api'`, rendu + script plus bas).
   Aucun compte, aucun service payant : les chiffres viennent de chez toi.
══════════════════════════════════════════════════════════════════════ */
const STAT_SOURCES = {
  projects: 'Projets', clients: 'Clients', files: 'Fichiers en ligne',
  videos: 'Vidéos', images: 'Images', thumbs: 'Miniatures créées',
  reviews: 'Avis reçus', invoices: 'Factures émises', revenue: 'CA encaissé',
};
/** Valeurs brutes de toutes les sources, lues à l'instant T. */
function statValues() {
  const arr = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const files    = HubFiles.list();
  const invoices = arr('hub_invoices');
  const kind = f => HubFiles._kind(String((f && (f.mime || f.type)) || ''), HubFiles._ext((f && f.name) || ''));
  const n = k => files.filter(f => kind(f) === k).length;
  let thumbs = 0;
  try { if (window.HubImages) thumbs = HubImages.stats().offloaded; } catch {}
  return {
    projects: getProjects().length,
    clients:  arr('hub_clients').length,
    files:    files.length,
    videos:   n('video'),
    images:   n('image') + n('gif'),
    thumbs,                                       // couvertures sorties du navigateur (miniature + fichier)
    reviews:  getReviews().length,
    invoices: invoices.length,
    revenue:  invoices.reduce((s, i) => s + (i && i.status === 'paid' ? Number(i.price) || 0 : 0), 0),
  };
}
/** Formatage d'une source (le CA s'affiche en euros, le reste en nombre). */
const statFmt = (id, v) => id === 'revenue' ? (Number(v) || 0).toLocaleString('fr-FR') + ' €' : String(Number(v) || 0);
/** Liste NORMALISÉE des chiffres clés à afficher : sources auto, valeurs saisies, API publiques. */
function statItems(cfg) {
  const list = Array.isArray(cfg?.stats?.items) ? cfg.stats.items : [];
  const vals = statValues();
  return list.map(it => {
    if (!it || typeof it !== 'object') return null;
    if (it.kind === 'api') {
      const url = String(it.url || '').trim();
      if (!url) return null;
      return { kind: 'api', label: String(it.label || 'Compteur'), url, path: String(it.path || '').trim() || 'value',
               prefix: String(it.prefix || ''), suffix: String(it.suffix || ''),
               value: String(it.value != null ? it.value : '—') };
    }
    if (it.kind === 'value') {
      const label = String(it.label || '').trim(), value = String(it.value ?? '').trim();
      if (!label || !value) return null;
      return { kind: 'value', label, value, prefix: String(it.prefix || ''), suffix: String(it.suffix || '') };
    }
    const id = STAT_SOURCES[it.id] ? it.id : null;
    if (!id) return null;
    // Préfixe/suffixe aussi pour les sources auto (v3.10) : « +5 ans »,
    // « 35 k »… se configurent partout de la même façon.
    return { kind: 'auto', id, label: String(it.label || STAT_SOURCES[id]),
             value: statFmt(id, vals[id]),
             prefix: String(it.prefix || ''), suffix: String(it.suffix || '') };
  }).filter(Boolean);
}

/* ── Modèle V3 (unifié) ────────────────────────────────────────────────
   {
     id, type,
     content    : { ref?, ...données propres }      // ref → hub_projects / hub_links
     layout     : { w, h, x?, y?, mobileOrder?, locked? }
     style      : { background?, foreground?, borderRadius?, border?, shadow?, opacity? }
     effects    : { tilt3d?, shine?, hoverLift?, mouseGlow?, reveal? }
     visibility : { public, desktop, tablet, mobile }
     link       : { url?, newTab? }
     createdAt, updatedAt
   }
   Les DONNÉES restent dans hub_projects / hub_links (via content.ref) : c'est ce
   qui préserve la sync Behance, l'analytics (data-p) et le classement.
   ─────────────────────────────────────────────────────────────────────
   ACCESSEURS TOLÉRANTS : ils lisent indifféremment un bloc V2 (plat) ou V3.
   Toute lecture DOIT passer par eux — c'est ce qui rend la migration sans risque. */
const bW      = b => Math.max(1, (b.layout ? b.layout.w : b.w) || 1);
const bH      = b => Math.max(1, (b.layout ? b.layout.h : b.h) || 1);
const bLocked = b => !!(b.layout ? b.layout.locked : b.locked);
const bHidden = b => (b.visibility ? b.visibility.public === false : !!b.hidden);
const bRef    = b => (b.content && b.content.ref !== undefined ? b.content.ref : b.ref);
const bProps  = b => b.content || b.props || {};
/* Point focal du média (0-100 sur chaque axe), 50/50 = centré.
   Adapté d'OpenBento (voir THIRD_PARTY_LICENSES.md) : le cadrage est une DONNÉE
   appliquée en CSS, jamais un recadrage du fichier. C'est ce qui permet aux GIF
   de rester animés — ré-encoder une image (canvas → WebP/JPEG) les figerait. */
const bFocal  = b => { const m = (b && bProps(b).mediaPosition) || {}; return { x: Number(m.x ?? 50), y: Number(m.y ?? 50) }; };
const focalCss = f => `${f.x}% ${f.y}%`;

/* ══ PLACEMENT ABSOLU (x/y sur la grille) ══
   Maths adaptées d'OpenBento (voir THIRD_PARTY_LICENSES.md) — avec UNE différence
   volontaire : OpenBento TOLÈRE les chevauchements (z-index selon l'ordre du
   tableau) ; ici ils sont INTERDITS et résolus, conformément à l'exigence
   « absence de chevauchements ». Un bloc sans x/y est placé automatiquement dans
   le premier emplacement libre. Les trous, eux, sont autorisés (canvas libre). */
const bX = b => (b.layout && b.layout.x) || null;
const bY = b => (b.layout && b.layout.y) || null;

/** Test de chevauchement AABB entre deux blocs placés */
function blocksOverlap(a, b) {
  const ax = bX(a), ay = bY(a), bx = bX(b), by = bY(b);
  if (!ax || !ay || !bx || !by) return false;
  const aw = Math.min(bW(a), BLOCK_COLS), bw = Math.min(bW(b), BLOCK_COLS);
  return !(ax + aw <= bx || bx + bw <= ax || ay + bH(a) <= by || by + bH(b) <= ay);
}
/** Ensemble des cellules occupées « col-row » */
function occupiedCells(blocks, excludeIds) {
  const ex = new Set(excludeIds || []);
  const cells = new Set();
  blocks.forEach(b => {
    if (ex.has(b.id)) return;
    const x = bX(b), y = bY(b); if (!x || !y) return;
    const w = Math.min(bW(b), BLOCK_COLS);
    for (let c = x; c < x + w; c++) for (let r = y; r < y + bH(b); r++) cells.add(c + '-' + r);
  });
  return cells;
}
/** Première position libre pour un bloc w×h (balayage lignes puis colonnes) */
function findFreeSpot(w, h, occupied, fromRow) {
  const need = Math.min(w, BLOCK_COLS);
  for (let row = Math.max(1, fromRow || 1); row <= 400; row++) {
    for (let col = 1; col <= BLOCK_COLS - need + 1; col++) {
      let ok = true;
      for (let c = col; c < col + need && ok; c++)
        for (let r = row; r < row + h && ok; r++) if (occupied.has(c + '-' + r)) ok = false;
      if (ok) return { x: col, y: row };
    }
  }
  return { x: 1, y: 401 };
}
/** Donne une place à tout bloc qui n'en a pas, et déloge ceux qui se chevauchent.
    L'ordre du tableau fait foi (les premiers gardent leur place). */
function placeBlocks(blocks) {
  const placed = [];
  blocks.forEach(b => {
    const w = Math.min(bW(b), BLOCK_COLS), h = bH(b);
    let x = bX(b), y = bY(b);
    const fits = x && y && x >= 1 && x + w - 1 <= BLOCK_COLS;
    if (fits && !placed.some(o => blocksOverlap({ ...b, layout: { ...b.layout, x, y } }, o))) {
      b.layout.x = x; b.layout.y = y;
    } else {
      const spot = findFreeSpot(w, h, occupiedCells(placed));
      b.layout.x = spot.x; b.layout.y = spot.y;
    }
    placed.push(b);
  });
  return blocks;
}

/** Convertit n'importe quel bloc (V2 plat ou V3) vers la forme V3 canonique. */
function normalizeBlock(b) {
  if (!b || !b.id) return null;
  const now = Date.now();
  if (b.layout && b.visibility && b.content) {          // déjà V3
    b.layout.w = bW(b); b.layout.h = bH(b);
    return b;
  }
  const { ref, props, w, h, hidden, locked, ...rest } = b;
  return {
    id: b.id, type: b.type,
    content: { ...(props || {}), ...(ref !== undefined ? { ref } : {}) },
    layout: { w: Math.max(1, w || 1), h: Math.max(1, h || 1), locked: !!locked },
    style: rest.style || {},
    effects: rest.effects || {},
    visibility: { public: !hidden, desktop: true, tablet: true, mobile: true },
    link: rest.link || {},
    createdAt: rest.createdAt || now, updatedAt: now,
  };
}

/** Renvoie les blocs du site (toujours en V3) : enregistrés, sinon migrés.
    RÉCONCILIATION : tout projet/lien sans bloc en reçoit un — sinon un projet
    ajouté après coup (bulle « + », import Behance) resterait invisible. */
function getBlocks(cfg, projects, links) {
  cfg = cfg || SiteConfig.get();
  const raw = (Array.isArray(cfg.blocks) && cfg.blocks.length) ? cfg.blocks : null;
  /* On lit la visibilité AVANT normalisation : un bloc Profil « informe »
     (visibility posé mais sans layout/content) perdrait ce champ au passage
     par normalizeBlock, qui reconstruit `visibility` depuis `hidden`. */
  const legacy = raw ? raw.find(b => b && (b.type === 'profile' || b.id === 'b_profile')) : null;
  const legacyHidden = !!legacy && (legacy.hidden === true || (legacy.visibility && legacy.visibility.public === false));
  const base = raw ? raw.map(normalizeBlock).filter(Boolean) : migrateBlocks(cfg, projects, links);
  /* ── GARANTIE (v3.10) : la bannière EST le bloc Profil ───────────────
     Avant, un `cfg.blocks` enregistré sans `b_profile` (état ancien,
     suppression manuelle, bloc tombé hors de la forme V3) laissait les
     projets/liens en place mais SUPPRIMAIT la bannière — `heroHidden`
     prenait « absent » pour « masqué », et le bouton « Masquer la
     bannière » de 🖼 Bannière ne trouvait rien à basculer.
     On recrée donc TOUJOURS le bloc, en tête, sans toucher aux autres :
     la visibilité d'une ancienne configuration est conservée.          */
  const pi = base.findIndex(b => b.type === 'profile');
  if (pi < 0) {
    base.unshift(normalizeBlock({
      id: 'b_profile', type: 'profile', w: 2, h: 2, hidden: legacyHidden,
    }));
  } else {
    if (pi > 0) {
      const [p] = base.splice(pi, 1);
      base.unshift(p);                     // la bannière reste toujours en tête
    }
    if (legacyHidden && !bHidden(base[0]))
      base[0] = { ...base[0], visibility: { ...(base[0].visibility || {}), public: false } };
  }
  const have = new Set(base.filter(b => bRef(b) != null).map(b => b.type + ':' + bRef(b)));
  const add = (type, id, prefix) => normalizeBlock({ id: prefix + id, type, ref: id, w: 1, h: 1 });
  (projects || getProjects()).forEach(p => { if (!have.has('project:' + p.id)) base.push(add('project', p.id, 'b_proj_')); });
  (links    || getLinks()).forEach(l    => { if (!have.has('link:' + l.id))    base.push(add('link',    l.id, 'b_link_')); });
  return placeBlocks(base);   // x/y garantis, aucun chevauchement
}

/** Migration : projets → blocs Projet, liens → blocs Réseau, à propos → bloc Texte…
    Non destructif : ne touche à aucune donnée, construit seulement la disposition. */
function migrateBlocks(cfg, projects, links) {
  cfg      = cfg || SiteConfig.get();
  projects = projects || getProjects();
  links    = links || getLinks();
  const sec = { projects: true, avis: true, contact: true, about: true, ...(cfg.sections || {}) };
  // ⚠ identifiants DÉTERMINISTES (dérivés de la donnée référencée) : migrateBlocks
  // peut être rappelé à tout moment (getBlocks est un accesseur) et doit toujours
  // rendre les mêmes ids, sinon la sélection/le glisser-déposer ciblent des blocs fantômes.
  const out = [{ id: 'b_profile', type: 'profile', w: 2, h: 2 }];
  if (String(cfg.about || '').trim() && sec.about)
    out.push({ id: 'b_about', type: 'text', w: 2, h: 1, props: { title: 'À propos', text: String(cfg.about) } });
  links.forEach(l => out.push({ id: 'b_link_' + l.id, type: 'link', ref: l.id, w: 1, h: 1 }));
  if (sec.projects) projects.forEach((p, i) =>
    out.push({ id: 'b_proj_' + p.id, type: 'project', ref: p.id, w: i === 0 ? 2 : 1, h: i === 0 ? 2 : 1 }));
  if (sec.avis)    out.push({ id: 'b_reviews', type: 'reviews', w: 2, h: 1 });
  if (sec.contact) out.push({ id: 'b_contact', type: 'contact', w: 1, h: 1 });
  return out.map(normalizeBlock);   // toujours rendu en V3
}

/** Résumé de migration (affiché à l'utilisateur) */
function migrateBlocksSummary(cfg, projects, links) {
  const b = migrateBlocks(cfg, projects, links);
  const n = t => b.filter(x => x.type === t).length;
  return { total: b.length, projects: n('project'), links: n('link'), text: n('text'), reviews: n('reviews'), contact: n('contact') };
}

/* ══════════════════════════════════════════════════════
   SITE GENERATOR — navbar style haunt.gg + projets cliquables + avis visiteurs
══════════════════════════════════════════════════════ */
/** Rendu de la grille Bento depuis les blocs. Conserve data-p / data-l pour l'analytics. */
/* ══════════════════════════════════════════════════════════════
   Moyens de contact — registre unique (générateur + éditeur).

   `href(valeur)` renvoie null quand la valeur ne permet pas de construire
   une destination : on n'affiche alors PAS le moyen, plutôt qu'un lien
   mort. Aucun de ces liens n'expose de donnée que l'utilisateur n'a pas
   explicitement activée.
══════════════════════════════════════════════════════════════ */
const CONTACT_KINDS = {
  email: {
    label: 'Email', icon: '✉', color: '#C8FF00', placeholder: 'toi@exemple.fr',
    href: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'mailto:' + v : null,
  },
  discord: {
    label: 'Discord', icon: '🎮', color: '#5865F2', placeholder: 'discord.gg/xxxx ou pseudo',
    // Un pseudo Discord n'est pas cliquable : on ne fabrique un lien que
    // pour une vraie invitation, sinon le moyen ne s'affiche pas.
    href: v => /discord\.(gg|com)\//i.test(v) ? (/^https?:/i.test(v) ? v : 'https://' + v.replace(/^\/+/, '')) : null,
  },
  whatsapp: {
    label: 'WhatsApp', icon: '💬', color: '#25D366', placeholder: '+33 6 12 34 56 78',
    href: v => { const d = v.replace(/[^\d]/g, ''); return d.length >= 8 ? 'https://wa.me/' + d : null; },
  },
  phone: {
    label: 'Téléphone', icon: '📞', color: '#38bdf8', placeholder: '+33 6 12 34 56 78',
    href: v => { const d = v.replace(/[^\d+]/g, ''); return d.length >= 6 ? 'tel:' + d : null; },
  },
  telegram: {
    label: 'Telegram', icon: '✈', color: '#2AABEE', placeholder: '@pseudo',
    href: v => { const u = v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''); return u ? 'https://t.me/' + u : null; },
  },
};
const CONTACT_ORDER = ['email', 'discord', 'whatsapp', 'phone', 'telegram'];

function renderBentoGrid(blocks, ctx) {
  const { cfg, projects, links, approved, GRADS, editor } = ctx;
  // Bento n'a pas de <section> : ce sont les BLOCS qui portent les titres. On
  // reçoit quand même le résolveur de noms de sections pour que renommer
  // « Portfolio » dans ☰ Sections se voie AUSSI ici, et pas seulement dans
  // les thèmes Flottante et Latérale.
  const sT = ctx.secTitle || (k => k);
  const sTOr = ctx.secTitleOr || ((k, f) => f);
  const P = id => projects.find(p => String(p.id) === String(id));
  const L = id => links.find(l => String(l.id) === String(id));
  const platIcon = (t, u) => platIconOf(t, u);   // registre unique (voir platIconOf)
  const cell = (b, inner, extra) => {
    const w = Math.min(BLOCK_COLS, bW(b)), h = bH(b), x = bX(b), y = bY(b);
    // Placement absolu quand il existe ; sinon la grille place automatiquement.
    // Sur mobile, le CSS neutralise x/y et repasse en flux (voir media query).
    const pos = (x && y) ? `grid-column:${x}/span ${w};grid-row:${y}/span ${h};` : '';
    return `<article class="bn bn-${esc(b.type)}${bHidden(b) ? ' bl-hidden' : ''}" data-b="${esc(b.id)}" style="${pos}--w:${w};--h:${h}"${extra || ''}>${inner}</article>`;
  };

  // En mode éditeur les blocs masqués sont RENDUS (grisés par la couche d'édition) ;
  // à la publication ils ne sont pas émis du tout.
  const shown = blocks.filter(b => editor || !bHidden(b));
  const parts = shown.map(b => {
    if (b.type === 'profile')
      return cell(b, `<div class="bn-av">${esc(String(cfg.siteName || 'S')[0].toUpperCase())}</div>
        ${cfg.heroText ? `<div class="bn-htag">${esc(cfg.heroText)}</div>` : ''}
        <h1 class="bn-name">${esc(cfg.siteName || '')}</h1>
        ${cfg.bio ? `<p class="bn-bio">${esc(cfg.bio)}</p>` : ''}`);
    if (b.type === 'text') {
      const pr = bProps(b);
      // b_about EST la section « À propos » : son titre suit ☰ Sections.
      const t = b.id === 'b_about' ? sT('about') : pr.title;
      return cell(b, `${t ? `<div class="bn-t">${esc(t)}</div>` : ''}<p class="bn-txt">${esc(pr.text || '').replace(/\n/g, '<br>')}</p>`);
    }
    if (b.type === 'link') {
      const l = L(bRef(b)); if (!l) return '';
      return cell(b, `<span class="bn-ic">${platIcon(l.title || '', l.url || '')}</span><div class="bn-t">${esc(l.title || 'Lien')}</div><div class="bn-sub">${esc(String(l.url || '').replace(/^https?:\/\//, '').slice(0, 30))}</div>`,
        ` data-l="${esc(l.title || 'Lien')}" onclick="window.open('${esc(l.url)}','_blank')"`);
    }
    if (b.type === 'project') {
      const p = P(bRef(b)); if (!p) return '';
      const i = Math.max(0, projects.indexOf(p));
      return cell(b, `<div class="bn-cov" style="${p.cover ? `background:url('${esc(p.cover)}') ${focalCss(bFocal(b))}/cover` : `background:${GRADS[i % 6]}`}"></div>
        <div class="bn-pb"><div class="bn-t">${esc(p.title || 'Projet')}</div><div class="ptags">${(p.tags || []).slice(0, 2).map(t => `<span class="ptag">${esc(t)}</span>`).join('')}</div></div>`,
        ` data-p="${esc(p.title || 'Projet')}"${p.url ? ` onclick="window.open('${esc(p.url)}','_blank')"` : ''}`);
    }
    if (b.type === 'reviews') {
      if (!approved.length) return '';
      return cell(b, `<div class="bn-t">★ ${esc(sTOr('avis', 'Avis'))}</div><div class="bn-rv">${approved.slice(0, 3).map(r =>
        `<div class="bn-rvi"><b>${esc(r.author)}</b> <span class="bn-st">${'★'.repeat(r.rating || 5)}</span><p>${esc(r.text)}</p></div>`).join('')}</div>`);
    }
    if (b.type === 'contact') {
      // Bento : une carte compacte listant les moyens ACTIVÉS. Le premier sert
      // de destination au clic sur la carte ; les autres restent cliquables.
      const cl = ctx.contactList ? ctx.contactList() : [];
      if (!cl.length) return '';
      const first = cl[0];
      const rest = cl.slice(1);
      return cell(b, `<span class="bn-ic">${esc(first.icon)}</span>
        <div class="bn-t">${esc(sTOr('contact', 'Me contacter'))}</div>
        <div class="bn-sub">${esc(first.value)}</div>
        ${rest.length ? `<div class="bn-ct">${rest.map(it =>
          `<a href="${esc(it.href)}"${it.blank ? ' target="_blank" rel="noopener noreferrer"' : ''}
              title="${esc(it.label)}" aria-label="${esc(it.label)}"
              style="--ct:${esc(it.color)}" onclick="event.stopPropagation()">${esc(it.icon)}</a>`).join('')}</div>` : ''}`,
        ` onclick="location.href='${esc(first.href)}'"`);
    }
    if (b.type === 'file') {
      // Bloc Document / CV — l'URL est figée dans le bloc à la création : le site
      // exporté reste autonome (aucune dépendance au Hub).
      const p = bProps(b); if (!p.url) return '';
      return cell(b, `<span class="bn-ic">${esc(p.icon || '📄')}</span>
        <div class="bn-t">${esc(p.title || 'Document')}</div>
        ${p.sub ? `<div class="bn-sub">${esc(p.sub)}</div>` : ''}
        <div class="bn-dl">⬇ Télécharger</div>`,
        ` data-l="${esc(p.title || 'Document')}" onclick="window.open('${esc(p.url)}','_blank')"`);
    }
    return '';
  });
  // Bulle « + Ajouter un projet » : uniquement dans l'éditeur (jamais publiée,
  // jamais en mode Aperçu), placée juste après le dernier folio existant.
  if (editor) {
    let last = -1;
    shown.forEach((b, i) => { if (b.type === 'project' && parts[i]) last = i; });
    parts.splice(last + 1, 0,
      `<article class="bn bn-add" data-add="1" title="Ajouter un projet"><span class="bn-add-i">＋</span><span>Ajouter un projet</span></article>`);
  }
  return `<div class="bn-grid">${parts.join('')}</div>`;
}

/** opts.editor = true → rend AUSSI les blocs masqués (grisés par la couche d'édition).
    La publication ne passe jamais cette option : les blocs masqués y sont donc absents. */
function generateSite(cfg, projects, reviews, opts) {
  const editor = !!(opts && opts.editor);
  if (!cfg)      cfg      = SiteConfig.get();
  if (!projects) projects = getProjects();
  if (!reviews)  reviews  = getReviews();
  const approved = reviews.filter(r => r.status === 'approved');
  const aboutTxt = String(cfg.about || '').trim();
  /* Les deux NOUVELLES sections (Chiffres clés, Réseaux) sont Masquées par
     défaut : un site publié avant cette version garde exactement la même
     apparence tant que l'utilisateur ne les active pas depuis la colonne
     « Blocs » ou la fenêtre ☰ Sections. */
  const sec      = { projects: true, avis: true, contact: true, about: true, stats: false, socials: false, ...(cfg.sections || {}) };
  if (!aboutTxt) sec.about = false; // pas de texte → pas de section
  const SEC_KEYS = ['about', 'projects', 'avis', 'contact', 'stats', 'socials'];
  const order = (Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder.slice() : SEC_KEYS.slice())
                .filter(k => SEC_KEYS.includes(k));
  SEC_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const statsItems = statItems(cfg);            // chiffres clés (valeurs figées à la génération)
  if (!statsItems.length) sec.stats = false;    // activée mais vide → ni section, ni entrée de nav
  const avisMode = cfg.avisMode || 'defile';
  const cols   = parseInt(cfg.layout) || 3;
  const dark   = cfg.theme !== '#f8f8f8';
  const textC  = dark ? '#f0ece4' : '#111';
  const mutedC = dark ? 'rgba(240,236,228,.55)' : '#666';
  const sfcC   = dark ? 'rgba(255,255,255,.04)' : '#fff';
  const brdC   = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.1)';
  const navBg  = dark ? 'rgba(10,10,10,.75)' : 'rgba(255,255,255,.8)';
  const repoFull = cfg.repo || '';
  const behanceUser = (cfg.behance || '').replace('@','');
  const GRADS  = ['linear-gradient(135deg,#1a0533,#6B21A8)','linear-gradient(135deg,#0a1628,#1e40af)','linear-gradient(135deg,#0d1f0d,#166534)','linear-gradient(135deg,#2d0a0a,#991b1b)','linear-gradient(135deg,#1a1400,#854d0e)','linear-gradient(135deg,#0a0a1f,#1e1b4b)'];
  const layoutStyle = ['sidebar', 'bento'].includes(cfg.layoutStyle) ? cfg.layoutStyle : 'float';
  const links       = getLinks();
  const blocks      = getBlocks(cfg, projects, links);   // même modèle pour tous les styles
  const heroImage   = String(cfg.heroImage || '').trim();
  /* Section « Réseaux » : les blocs Lien VISIBLES, dans l'ordre des blocs —
     la même source que la grille Bento, donc un lien masqué disparaît aussi
     d'ici (aucun lien mort ni fuite d'un lien désactivé). */
  const socItems = blocks.filter(b => b.type === 'link' && (editor || !bHidden(b)))
    .map(b => links.find(l => String(l.id) === String(bRef(b))) || null)
    .filter(l => l && String(l.url || '').trim());
  if (!socItems.length) sec.socials = false;

  /* ── Une section n'est dans la NAVIGATION que si elle existe VRAIMENT ──
     Avant, la nav listait `sec[k]` seul : masquer le bloc Contact, retirer le
     bloc À propos ou n'avoir aucun projet laissait un lien d'ancre mort (le
     clic ne menait nulle part). On teste donc le contenu réellement rendu —
     et les deux nouvelles sections (Stats, Réseaux) de la même façon.
     Déclaré ICI, avant heroLinkHref() qui en dépend aussi. */
  const liveBlock = t => blocks.some(b => b.type === t && (editor || !bHidden(b)));
  const secLive = k => {
    if (!sec[k]) return false;
    if (k === 'about')    return !!aboutTxt;
    if (k === 'projects') return liveBlock('project');
    if (k === 'avis')     return liveBlock('reviews');
    if (k === 'contact')  return liveBlock('contact');
    if (k === 'stats')    return statsItems.length > 0;
    if (k === 'socials')  return socItems.length > 0;
    return true;
  };
  /* ── Visibilité de la bannière / du hero ──────────────────────────────
     Le hero était écrit EN DUR dans le gabarit, alors qu'il porte
     `data-b="b_profile"`. Résultat : masquer ou supprimer le bloc le
     retirait de la liste des blocs — donc de la sélection et de l'édition —
     mais il restait affiché. La bannière devenait « toujours là, mais plus
     modifiable ». Elle suit désormais son bloc, comme tous les autres.     */
  const heroBlock   = blocks.find(b => b.id === 'b_profile') || null;
  const heroHidden  = heroBlock ? bHidden(heroBlock) : true;   // absent = masqué
  // En mode éditeur on le garde, grisé, sinon on ne pourrait plus le réafficher.
  const heroShow    = editor ? !!heroBlock : (!!heroBlock && !heroHidden);
  const heroCls     = heroHidden ? ' bl-hidden' : '';
  /* ── Bannière cliquable (thème Latérale) ──────────────────────────────
     Résout l'action configurée en une simple destination. Retourne null si
     aucune action : la bannière reste alors un <div>, sans curseur main ni
     rôle de lien — une bannière « cliquable » qui ne mène nulle part est
     pire que pas de lien du tout.
     Dans l'éditeur, le clic est neutralisé en amont (mode Édition) : le lien
     ne s'active qu'en Aperçu et sur le site publié.                        */
  const heroLinkHref = () => {
    const L = cfg.heroLink || {};
    const t = L.type || 'none';
    if (t === 'none') return null;
    if (t === 'url') {
      const u = String(L.url || '').trim();
      if (!u) return null;
      // Une URL sans schéma ne doit pas devenir un lien relatif cassé.
      return /^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u;
    }
    if (t === 'section') return SEC_KEYS.includes(L.section) && secLive(L.section) ? '#' + L.section : null;
    if (t === 'project') {
      const p = projects.find(x => String(x.id) === String(L.projectId));
      return p && p.url ? String(p.url) : null;
    }
    if (t === 'file')    return String(L.url || '').trim() || null;
    if (t === 'contact') return cfg.email ? 'mailto:' + cfg.email : (secLive('contact') ? '#contact' : null);
    return null;
  };
  const heroHref = heroLinkHref();
  // Nouvel onglet uniquement pour ce qui sort du site (jamais pour une ancre).
  const heroBlank = heroHref && !heroHref.startsWith('#')
    && (cfg.heroLink || {}).blank !== false && !heroHref.startsWith('mailto:');
  const projLimit   = parseInt(cfg.projectsLimit) || 0;   // 0 = tous
  const hiddenCount = projLimit && projects.length > projLimit ? projects.length - projLimit : 0;
  const animLevel   = cfg.animLevel || 'smooth';
  const fx          = cfg.fx || {};
  const revDur      = { none: 0, light: .3, smooth: .6, premium: .8 }[animLevel] ?? .6;
  const revY        = animLevel === 'none' ? 0 : animLevel === 'premium' ? 26 : 18;

  const blkOf = p => blocks.find(b => b.type === 'project' && String(bRef(b)) === String(p.id)) || null;
  const pHid  = p => { const b = blkOf(p); return b ? bHidden(b) : false; };
  const cards = projects.filter(p => editor || !pHid(p)).map((p, i) => `
    <article class="pc${projLimit && i >= projLimit ? ' pc-hidden' : ''}${pHid(p) ? ' bl-hidden' : ''}" data-tags="${(p.tags||[]).join('|').toLowerCase()}" data-p="${esc(p.title||'Projet')}" data-b="${esc((blkOf(p) || {}).id || '')}"${p.url ? ` onclick="window.open('${esc(p.url)}','_blank')" title="Ouvrir le projet"` : ''}>
      <div class="pt" style="${p.cover ? `background:url('${esc(p.cover)}') ${focalCss(bFocal(blkOf(p)))}/cover` : `background:${GRADS[i%6]}`}">${p.url?'<span class="go">Voir le projet ↗</span>':''}</div>
      <div class="pb">
        <div class="pn">${esc(p.title||'Projet')}</div>
        <div class="ptags">${(p.tags||[]).slice(0,3).map(t=>`<span class="ptag">${esc(t)}</span>`).join('')}</div>
        <div class="pm">${p.views?`👁 ${p.views} · `:''}${p.behance?'<span style="color:#4a8cff">Behance</span>':''}</div>
      </div>
    </article>`).join('') || `<div style="grid-column:1/-1;text-align:center;color:${mutedC};padding:40px">Aucun projet pour le moment</div>`;

  const rvCard = r => `
    <div class="rc">
      <div class="rh"><div class="rav">${esc((r.author||'?')[0].toUpperCase())}</div>
        <div><div class="rn">${esc(r.author)}</div><div class="rs">${'★'.repeat(r.rating||5)}${'☆'.repeat(5-(r.rating||5))}</div></div>
      </div>
      <p class="rt">${esc(r.text)}</p>
      ${r.project?`<div class="rp">· ${esc(r.project)}</div>`:''}
    </div>`;
  const reviewCards = approved.length ? approved.map(rvCard).join('')
    : `<div style="grid-column:1/-1;text-align:center;color:${mutedC};padding:24px;font-size:13px">Sois le premier à laisser un avis ✨</div>`;
  // Défilement infini si assez d'avis, sinon grille
  const useMarquee = avisMode !== 'grille' && approved.length >= 3;
  const mqHalf = `<div class="mqhalf">${approved.map(rvCard).join('')}</div>`;
  const avisDisplay = useMarquee
    ? `<div class="mq"><div class="mqtrack" style="animation-duration:${Math.max(20, approved.length*7)}s">${mqHalf}${mqHalf}</div></div>`
    : `<div class="rg">${reviewCards}</div>`;

  // ── Sections modulaires : nom, description, icône, visibilité, ordre ──
  // Les noms ne sont plus imposés : `cfg.sectionMeta` peut redéfinir chaque
  // champ. Ce qui n'est PAS redéfini retombe sur ces valeurs d'origine, donc
  // un site publié avant cette version s'affiche exactement pareil.
  const SEC_DEFAULTS = {
    about:    { title: 'À propos',    heading: 'Qui suis-je ?',        icon: '◈' },
    projects: { title: 'Portfolio',   heading: 'Mes projets',          icon: '▦' },
    avis:     { title: 'Témoignages', heading: 'Avis clients',         icon: '★' },
    contact:  { title: 'Contact',     heading: 'Travaillons ensemble', icon: '✉' },
    stats:    { title: 'Chiffres clés', heading: 'Le hub en chiffres',  icon: '📊' },
    socials:  { title: 'Réseaux',     heading: 'Retrouve-moi ailleurs', icon: '🔗' },
  };
  const meta = k => ({ ...(SEC_DEFAULTS[k] || {}), ...((cfg.sectionMeta || {})[k] || {}) });
  const secTitle = k => String(meta(k).title || SEC_DEFAULTS[k]?.title || k);
  /* Titre PERSONNALISÉ s'il existe, sinon le libellé d'origine passé en second
     argument. Sert aux endroits (cartes Bento) dont le texte par défaut diffère
     du nom de la section — « Me contacter » plutôt que « Contact » — pour ne pas
     changer l'apparence d'un site que personne n'a renommé. */
  const secTitleOr = (k, fallback) => {
    const custom = ((cfg.sectionMeta || {})[k] || {}).title;
    return String(custom || fallback);
  };
  const secIcon  = k => String(meta(k).icon || '•');
  /** En-tête d'une section : surtitre + titre + description, chacun masquable. */
  const secHead = k => {
    const m = meta(k);
    const head = m.showTitle === false ? '' :
      `<div class="sl">${esc(m.title || '')}</div><h2>${esc(m.heading || m.title || '')}</h2>`;
    const desc = (m.showDesc === false || !String(m.desc || '').trim()) ? ''
      : `<p class="ssub">${esc(String(m.desc)).replace(/\n/g, '<br>')}</p>`;
    return head + desc;
  };

  /* ══ Moyens de contact ═══════════════════════════════════════════════
     Rien n'est publié sans activation explicite : un moyen dont `on` n'est
     pas vrai n'est PAS rendu, et sa valeur n'apparaît nulle part dans le
     HTML généré. Un numéro de téléphone saisi puis désactivé ne fuite donc
     pas dans le code source de la page.                                   */
  const contactList = () => {
    const conf = Array.isArray(cfg.contactMethods) ? cfg.contactMethods : null;
    // Config absente (site d'avant cette version) : on retombe sur l'email
    // seul, exactement ce qui était affiché auparavant.
    const src = conf || (cfg.email ? [{ id: 'email', on: true, value: cfg.email }] : []);
    const out = src
      .filter(m => m && m.on === true && String(m.value || '').trim())
      .map(m => {
        const k = CONTACT_KINDS[m.id]; if (!k) return null;
        const v = String(m.value).trim();
        const href = k.href(v);
        if (!href) return null;
        return {
          href, label: String(m.label || k.label), icon: String(m.icon || k.icon),
          color: String(m.color || k.color), value: v,
          blank: !/^(mailto:|tel:)/.test(href),
        };
      })
      .filter(Boolean);
    /* ── v3.10 : « ☑ Afficher dans Contact » ───────────────────────────
       Un RÉSEAU peut rejoindre la zone contact sans changer de système :
       on le lit depuis les blocs LIEN visibles (un lien masqué ne fuite
       donc jamais ici), et sans doublonner un moyen déjà configuré. */
    const seen = new Set(out.map(i => i.href));
    blocks.filter(b => b.type === 'link' && !bHidden(b))
      .map(b => links.find(l => String(l.id) === String(bRef(b))) || null)
      .filter(l => l && l.inContact && String(l.url || '').trim())
      .forEach(l => {
        const href = String(l.url).trim();
        if (seen.has(href)) return;
        seen.add(href);
        const pl = socialOfLink(l);
        out.push({
          href, label: String(l.title || (pl ? pl.label : 'Réseau')),
          icon: String(pl ? pl.icon : platIconOf(l.title, l.url)),
          color: String(pl ? pl.color : '#888'),
          value: String(l.handle || '').slice(0, 48),
          blank: !/^mailto:/i.test(href),
        });
      });
    return out;
  };
  const contactHtml = () => {
    const items = contactList();
    if (!items.length) return '';
    const variant = ['boutons', 'liste', 'cartes', 'icones', 'barre'].includes(cfg.contactVariant)
      ? cfg.contactVariant : 'boutons';
    const a = (it, inner, extra) =>
      `<a class="ct-i" href="${esc(it.href)}"${it.blank ? ' target="_blank" rel="noopener noreferrer"' : ''}` +
      ` style="--ct:${esc(it.color)}"${extra || ''}>${inner}</a>`;
    const body = items.map(it => {
      const ic = `<span class="ct-ic">${esc(it.icon)}</span>`;
      if (variant === 'icones') return a(it, ic, ` title="${esc(it.label)}" aria-label="${esc(it.label)}"`);
      if (variant === 'cartes') return a(it, `${ic}<span class="ct-l">${esc(it.label)}</span><span class="ct-v">${esc(it.value)}</span>`);
      if (variant === 'liste')  return a(it, `${ic}<span class="ct-l">${esc(it.label)}</span><span class="ct-v">${esc(it.value)}</span>`);
      return a(it, `${ic}<span class="ct-l">${esc(it.label)}</span>`);   // boutons & barre
    }).join('');
    return `<div class="ct ct-${variant}">${body}</div>`;
  };
  // Compat : le reste du générateur lit encore ces tables.
  const SEC_LABELS = {}; const SEC_ICONS = {};
  SEC_KEYS.forEach(k => { SEC_LABELS[k] = secTitle(k); SEC_ICONS[k] = secIcon(k); });
  const tagList = [...new Set(projects.flatMap(p => (p.tags || []).slice(0, 3)).filter(Boolean))].slice(0, 8);
  const secHtml = {
    about: `<section id="about" class="rev" style="max-width:760px">${secHead('about')}<p class="about-p">${esc(aboutTxt).replace(/\n/g,'<br>')}</p></section>`,
    projects: `<section id="projects" class="rev"><div class="prow"><div>${secHead('projects')}</div>${hiddenCount?`<button class="seeall" onclick="document.querySelectorAll('.pc-hidden').forEach(function(e){e.classList.remove('pc-hidden')});this.remove()">Voir tout (+${hiddenCount}) →</button>`:''}</div><div class="pg" style="margin-top:20px">${cards}</div></section>`,
    avis: `<section id="avis" class="rev">${secHead('avis')}
  ${avisDisplay}
  <div class="leave">
    ${repoFull?`<button class="bg" onclick="document.getElementById('revform').classList.toggle('open')">✎ Laisser un avis</button>
    <form id="revform" onsubmit="return revSend(event)">
      <label>Ton nom</label><input id="rv-n" required maxlength="60" placeholder="Prénom Nom">
      <label>Ta note</label><div id="rvstars"><span class="on">★</span><span class="on">★</span><span class="on">★</span><span class="on">★</span><span class="on">★</span></div>
      <label>Ton avis</label><textarea id="rv-t" required maxlength="600" placeholder="Raconte ton expérience…"></textarea>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button type="submit" class="bp" style="flex:1">Envoyer l'avis</button>
      </div>
      <p class="rhint">L'avis s'envoie via GitHub (compte gratuit requis, 1 clic).${cfg.email?` Ou par email : <a href="#" onclick="return revMail()" style="color:var(--a)">${esc(cfg.email)}</a>`:''}<br>Chaque avis est vérifié avant publication ✓</p>
    </form>`:''}
  </div>
</section>`,
    contact: `<section id="contact" class="ci rev">${secHead('contact')}${contactHtml()}${
      behanceUser ? `<div class="ctas" style="margin-top:16px"><a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" rel="noopener noreferrer" class="bg">Behance →</a></div>` : ''
    }</section>`,
    /* ── NOUVEAU (v3.9) : vitrine de chiffres clés ──
       Trois kinds de source, mêmes cartes : `auto` (calculées chez toi à la
       génération), `value` (saisies à la main) et `api` (compteur public relu
       à chaque visite, valeur de repli gravée dans la page). Le tout gratuit,
       sans compte ni service tiers obligatoire. */
    stats: `<section id="stats" class="rev">${secHead('stats')}
  <div class="kpis">${statsItems.map(it => `<div class="kpi"${it.kind === 'api' ? ` data-kpi-url="${esc(it.url)}" data-kpi-path="${esc(it.path)}" data-kpi-pre="${esc(it.prefix || '')}" data-kpi-suf="${esc(it.suffix || '')}"` : ''}><b class="kpi-v">${esc(String(it.prefix || '') + it.value + String(it.suffix || ''))}</b><span class="kpi-l">${esc(it.label)}</span></div>`).join('')}</div>
</section>`,
    /* ── NOUVEAU (v3.9) : les liens du profil, enfin visibles hors Bento ──
       Les thèmes Flottante et Latérale ignoraient les blocs Lien (« les liens
       restent dans la navigation » — or la navigation n'en contenait aucun).
       Cette section leur donne une place dédiée, avec l'icône du registre. */
    /* ── v3.10 : présentation au choix + icône issue du registre ──────
       Le registre (`SOCIAL_PLATFORMS`) fait foi : id enregistré à la
       création, sinon titre, sinon URL. La même couleur/le même symbole
       s'affiche ici, dans la zone Contact et dans la grille Bento. */
    socials: (() => {
      const variant = ['ic-texte', 'ic-seules', 'boutons', 'cartes', 'barre'].includes(cfg.socialsStyle)
        ? cfg.socialsStyle : 'ic-texte';
      const one = l => {
        const pl = socialOfLink(l);
        const ic = pl ? pl.icon : platIconOf(l.title, l.url);
        const label = String(l.title || (pl ? pl.label : 'Lien'));
        const handle = String(l.handle || '');
        const a = `class="soc-i" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="--sc:${esc(pl ? pl.color : '#888')}" data-l="${esc(label)}"`;
        const icon = `<span class="soc-ic">${esc(ic)}</span>`;
        if (variant === 'ic-seules') return `<a ${a} title="${esc(label)}" aria-label="${esc(label)}">${icon}</a>`;
        if (variant === 'cartes')    return `<a ${a}>${icon}<span class="soc-l">${esc(label)}</span>${handle ? `<span class="soc-h">${esc(handle)}</span>` : ''}</a>`;
        return `<a ${a}>${icon}<span class="soc-l">${esc(label)}</span></a>`;   // ic-texte · boutons · barre
      };
      return `<section id="socials" class="rev">${secHead('socials')}
  <div class="soc soc-${variant}">${socItems.map(one).join('')}</div>
</section>`;
    })(),
  };
  /* Corps des styles Flottante & Latérale rendu DEPUIS LES BLOCS (même moteur que
     Bento) : un bloc texte créé via la palette apparaît donc AUSSI ici, dans
     l'ordre des blocs. Les rendus riches existants (grille projets, avis, contact)
     sont réutilisés tels quels. Les liens restent dans la navigation. */
  const flowText = b => {
    const pr = bProps(b), t = esc(pr.title || ''), tx = esc(pr.text || '').replace(/\n/g, '<br>');
    return `<section class="rev${bHidden(b) ? ' bl-hidden' : ''}" data-b="${esc(b.id)}" style="max-width:760px">${t ? `<div class="sl">${t}</div><h2>${t}</h2>` : ''}<p class="about-p">${tx}</p></section>`;
  };
  /* Le corps des thèmes Flottante / Latérale est dérivé DES BLOCS. On le
     découpe en {k, html} pour pouvoir y INSÉRER les sections qui n'ont pas de
     bloc (Chiffres clés, Réseaux) à leur place dans l'ordre choisi. */
  const renderFlowBody = () => {
    let projectsShown = false;
    return blocks.filter(b => editor || !bHidden(b)).map(b => {
      if (b.type === 'profile' || b.type === 'link') return { k: null, html: '' };        // hero + nav
      if (b.type === 'project') { if (projectsShown || !sec.projects) return { k: null, html: '' }; projectsShown = true; return { k: 'projects', html: secHtml.projects }; }
      // « À propos » est un bloc texte particulier : c'est LA section about.
      // Sans ce cas, son titre viendrait des props du bloc (figées à
      // « À propos ») et la renommer dans ☰ Sections n'aurait aucun effet.
      if (b.id === 'b_about') return sec.about ? { k: 'about', html: secHtml.about } : { k: null, html: '' };
      if (b.type === 'text')    return { k: null, html: flowText(b) };
      if (b.type === 'file') {
        const p = bProps(b); if (!p.url) return { k: null, html: '' };
        return { k: null, html: `<section class="rev fdoc${bHidden(b) ? ' bl-hidden' : ''}" data-b="${esc(b.id)}">
          <span class="fdoc-i">${esc(p.icon || '📄')}</span>
          <div class="fdoc-tx"><div class="fdoc-t">${esc(p.title || 'Document')}</div>
            ${p.sub ? `<div class="fdoc-s">${esc(p.sub)}</div>` : ''}</div>
          <a class="bp" href="${esc(p.url)}" target="_blank" rel="noopener" data-l="${esc(p.title || 'Document')}">⬇ Télécharger</a>
        </section>` };
      }
      if (b.type === 'reviews') return sec.avis ? { k: 'avis', html: secHtml.avis } : { k: null, html: '' };
      if (b.type === 'contact') return sec.contact ? { k: 'contact', html: secHtml.contact } : { k: null, html: '' };
      return { k: null, html: '' };
    });
  };
  /* Insertion d'une section « sans bloc » : elle se place AVANT la première
     section connue qui vient après elle dans l'ordre, sinon en fin de page.
     L'ordre de la colonne « Blocs » / de ☰ Sections est donc respecté. */
  const placeExtra = (chunks, key) => {
    const pos = order.indexOf(key);
    if (pos < 0) return chunks;
    const at = chunks.findIndex(c => c.k && order.indexOf(c.k) > pos);
    chunks.splice(at < 0 ? chunks.length : at, 0, { k: key, html: secHtml[key] });
    return chunks;
  };
  /* Sections « sans bloc » (Chiffres clés, Réseaux) : elles n'ont pas de bloc
     à elles, on les place à leur rang. En thème Bento, la grille reste
     intacte : elles s'ajoutent entre la grille et le pied de page. */
  const extraKeys = order.filter(k => (k === 'stats' || k === 'socials') && secLive(k));
  const flowChunks = renderFlowBody();
  extraKeys.forEach(k => placeExtra(flowChunks, k));
  const bodySections = flowChunks.map(c => c.html).join('\n');
  const extraSections = extraKeys.map(k => secHtml[k]).join('\n');
  /* La nav du thème Bento pointe vers des ANCREs : la grille n'en a pas, seules
     ces deux sections en ont une. On ne propose donc que des liens qui mènent
     quelque part (le reste reste cliquable depuis la grille). */
  const bentoNav = extraKeys.map(k => `<a href="#${k}">${SEC_LABELS[k]}</a>`).join('\n    ');
  const navLinks = order.filter(k => secLive(k)).map(k => `<a href="#${k}">${SEC_LABELS[k]}</a>`).join('\n    ');
  const statsApi = statsItems.filter(i => i.kind === 'api');   // compteurs publics à rafraîchir à la visite

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${esc(cfg.bio)}">
<title>${esc(cfg.siteName)} — Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--a:${cfg.accentColor};--bg:${cfg.theme};--t:${textC};--m:${mutedC};--s:${sfcC};--b:${brdC};--cols:${cols}}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif}a{color:inherit;text-decoration:none}
${animLevel === 'none' ? '' : `/* ── DÉFILEMENT FLUIDE (v3.9) ── Les ancres de la navigation glissent au lieu
   de sauter. La barre est collante : scroll-padding-top évite de finir le
   titre de section dessous. Respecte prefers-reduced-motion. */
html{scroll-behavior:smooth;scroll-padding-top:92px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`}
/* ── NAVBAR (pilule flottante) ── */
.navwrap{position:sticky;top:14px;z-index:100;display:flex;justify-content:center;padding:0 16px}
nav{display:flex;align-items:center;gap:4px;width:100%;max-width:900px;padding:8px 8px 8px 16px;border-radius:999px;background:${navBg};border:1px solid var(--b);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 10px 40px rgba(0,0,0,.3)}
.logo{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;letter-spacing:-.4px;margin-right:6px;white-space:nowrap}
.logo .ic{width:24px;height:24px;border-radius:8px;background:var(--a);display:inline-flex;align-items:center;justify-content:center;color:#060606;font-size:13px;font-weight:800}
.logo span.d{color:var(--a)}
.nl{display:flex;gap:2px;margin:0 auto}
.nl a{padding:8px 14px;border-radius:999px;font-size:12px;color:var(--m);transition:.2s;white-space:nowrap}
.nl a:hover{color:var(--t);background:rgba(128,128,128,.12)}
.ncta{padding:9px 18px;border-radius:999px;background:var(--a);color:#060606;font-size:12px;font-weight:800;white-space:nowrap;transition:.2s}
.ncta:hover{opacity:.85}
/* ── HERO ── */
.hero{padding:88px 32px 56px;text-align:center;max-width:820px;margin:0 auto}
/* Bannière avec image (v3.9) : voile sombre pour que le texte reste lisible
   SUR N'IMPORTE QUELLE photo (une bannière claire rendrait un titre illisible),
   et couches explicites puisque le hero porte maintenant un fond. */
.hero-img{position:relative;isolation:isolate;border-radius:18px;padding-top:104px;padding-bottom:66px;overflow:hidden}
.hero-img::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,4,6,.34),rgba(4,4,6,.72));z-index:0}
.hero-img>*{position:relative;z-index:1}
.hero-img h1{color:#fff}
.hero-img .hsub{color:rgba(255,255,255,.86)}
.htag{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:16px}
h1{font-size:clamp(40px,7vw,76px);font-weight:800;letter-spacing:-2px;line-height:1.06;margin-bottom:16px}h1 span{color:var(--a)}
.hsub{font-size:15px;color:var(--m);margin-bottom:28px;line-height:1.7}
.ctas{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.bp{padding:12px 28px;background:var(--a);color:#060606;border-radius:10px;font-size:13px;font-weight:700;border:none;cursor:pointer;font-family:inherit;transition:.2s;text-decoration:none;display:inline-block}.bp:hover{opacity:.85}
.bg{padding:12px 28px;background:transparent;color:var(--t);border:1px solid var(--b);border-radius:10px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:.2s;text-decoration:none;display:inline-block}.bg:hover{border-color:var(--a);color:var(--a)}
section{padding:48px 32px;max-width:1100px;margin:0 auto}
.sl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:8px}
h2{font-size:24px;font-weight:800;letter-spacing:-.5px;margin-bottom:24px}
/* Description de section (facultative). La marge négative rattrape celle du h2
   pour rapprocher la description de son titre, sans dépendre de :has(). */
.ssub{font-size:13px;color:var(--m);line-height:1.7;max-width:640px;margin:-16px 0 26px}
/* ── MOYENS DE CONTACT (5 présentations) ── */
.ct{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.ct-i{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--t);
  border:1px solid var(--b2);border-radius:12px;padding:12px 16px;transition:.2s;background:var(--s1)}
.ct-i:hover{border-color:var(--ct);color:var(--ct);transform:translateY(-2px)}
.ct-i:focus-visible{outline:2px solid var(--ct);outline-offset:2px}
.ct-ic{font-size:16px;line-height:1}
.ct-l{font-size:13px;font-weight:700}
.ct-v{font-size:12px;color:var(--m)}
.ct-liste{flex-direction:column;gap:6px}
.ct-liste .ct-i{width:100%;padding:9px 13px;border-radius:10px}
.ct-liste .ct-v{margin-left:auto}
.ct-cartes{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.ct-cartes .ct-i{flex-direction:column;align-items:flex-start;gap:5px;padding:18px}
.ct-cartes .ct-ic{font-size:22px}
.ct-icones .ct-i{padding:0;width:46px;height:46px;justify-content:center;border-radius:50%}
.ct-icones .ct-ic{font-size:19px}
.ct-barre{flex-wrap:nowrap;overflow-x:auto;gap:8px;padding-bottom:4px}
.ct-barre .ct-i{flex:0 0 auto;padding:10px 14px}
@media(max-width:600px){.ct-cartes{grid-template-columns:1fr}}
/* ── CHIFFRES CLÉS (v3.9) : vitrine de compteurs, sans compte ni service payant ── */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
.kpi{background:var(--s);border:1px solid var(--b);border-radius:16px;padding:22px 16px;text-align:center;transition:.2s}
.kpi:hover{border-color:var(--a);transform:translateY(-3px)}
.kpi-v{display:block;font-size:clamp(24px,3.4vw,36px);font-weight:800;letter-spacing:-1.2px;color:var(--a);line-height:1.1;word-break:break-word}
.kpi-l{display:block;margin-top:7px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--m)}
/* ── RÉSEAUX (v3.9) : les liens du profil, enfin rendus hors thème Bento ── */
.soc{display:flex;flex-wrap:wrap;gap:10px}
.soc-i{display:inline-flex;align-items:center;gap:9px;padding:13px 17px;background:var(--s);border:1px solid var(--b);border-radius:12px;transition:.2s}
.soc-i:hover{border-color:var(--sc);color:var(--sc);transform:translateY(-2px)}
.soc-i:focus-visible{outline:2px solid var(--sc);outline-offset:2px}
.soc-ic{font-size:17px;line-height:1}
.soc-l{font-size:13px;font-weight:700}
/* ── v3.10 : présentations de la section Réseaux ──────────────────────
   Le défaut (icône + texte) est EXACTEMENT l'ancien rendu : un site déjà
   publié ne change pas d'apparence. */
.soc-h{display:block;font-size:11px;color:var(--m);opacity:.75;word-break:break-all}
.soc-cartes .soc-i{flex-direction:column;align-items:flex-start;gap:5px;min-width:150px}
.soc-ic-seules .soc-i{padding:12px;min-width:48px;justify-content:center}
.soc-ic-seules .soc-ic{font-size:20px}
.soc-boutons .soc-i{background:var(--a);border-color:var(--a);color:#060606;border-radius:999px;padding:11px 20px}
.soc-boutons .soc-i:hover{color:#060606;filter:brightness(1.1);transform:translateY(-2px)}
.soc-barre{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}
.soc-barre .soc-i{flex:0 0 auto}
@media(max-width:600px){.soc-cartes .soc-i{min-width:0;width:100%}}
.prow h2{margin-bottom:0}
.prow .ssub{margin:6px 0 0}
/* ── PROJETS ── */
.pg{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:16px}
.pc{background:var(--s);border:1px solid var(--b);border-radius:14px;overflow:hidden;cursor:pointer;transition:all .25s;position:relative}
.pc:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,.3);border-color:var(--a)}
.pt{aspect-ratio:16/10;background:var(--s);position:relative;display:flex;align-items:flex-end;justify-content:flex-end}
.go{opacity:0;transition:.2s;background:var(--a);color:#060606;font-size:10px;font-weight:800;padding:5px 12px;border-radius:999px;margin:10px}
.pc:hover .go{opacity:1}
.pb{padding:14px}.pn{font-size:13px;font-weight:700;margin-bottom:6px}
.ptags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}.ptag{font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(200,255,0,.1);color:var(--a);font-weight:600}
.pm{font-size:10px;color:var(--m)}
/* ── AVIS ── */
.rg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:24px}
.rc{background:var(--s);border:1px solid var(--b);border-radius:14px;padding:18px}
.rh{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.rav{width:34px;height:34px;border-radius:50%;background:rgba(200,255,0,.12);color:var(--a);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.rn{font-size:12px;font-weight:700}.rs{color:#e4b24a;font-size:12px}
.rt{font-size:12px;color:var(--m);line-height:1.7}.rp{font-size:10px;color:var(--m);margin-top:8px;opacity:.7}
/* ── FORM AVIS ── */
.leave{text-align:center}
#revform{display:none;max-width:440px;margin:18px auto 0;text-align:left;background:var(--s);border:1px solid var(--b);border-radius:14px;padding:20px}
#revform.open{display:block}
#revform label{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--m);display:block;margin:12px 0 5px}
#revform input,#revform textarea{width:100%;background:${dark?'rgba(255,255,255,.05)':'#f4f4f4'};border:1px solid var(--b);border-radius:8px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:13px;outline:none}
#revform input:focus,#revform textarea:focus{border-color:var(--a)}
#revform textarea{height:90px;resize:none}
#rvstars{display:flex;gap:4px;font-size:26px;cursor:pointer;color:${dark?'rgba(255,255,255,.2)':'#ddd'}}
#rvstars span{transition:.15s}#rvstars span.on{color:#e4b24a}
.rhint{font-size:10px;color:var(--m);margin-top:10px;line-height:1.6;text-align:center}
.ci{text-align:center;padding:60px 32px;max-width:600px;margin:0 auto}
footer{text-align:center;padding:24px;border-top:1px solid var(--b);font-size:10px;color:var(--m)}
/* ── BADGE "Made by Souanpt HUB" (style Framer) ── */
.made{position:fixed;bottom:16px;right:16px;z-index:200;display:flex;align-items:center;gap:7px;padding:7px 12px 7px 9px;border-radius:999px;background:rgba(10,10,10,.82);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 6px 22px rgba(0,0,0,.35);font-size:11px;font-weight:700;color:#f0ece4;text-decoration:none;transition:transform .2s,box-shadow .2s;font-family:'Syne',system-ui,sans-serif}
.made:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.45)}
.made .mic{width:18px;height:18px;border-radius:5px;background:var(--a);display:inline-flex;align-items:center;justify-content:center;color:#060606;font-size:11px;flex-shrink:0}
.made b{color:var(--a)}
@media(max-width:640px){.made{bottom:12px;right:12px;padding:6px 10px 6px 8px;font-size:10px}}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fuo{from{opacity:0}to{opacity:1}}
${animLevel==='none'?'':`.pc{animation:${fx.tilt?'fuo':'fu'} ${revDur*.7}s ease both}${projects.slice(0,12).map((_,i)=>`.pc:nth-child(${i+1}){animation-delay:${i*.05}s}`).join('')}`}
.pc{transition:transform .18s ease,box-shadow .25s ease}
/* Effets premium — UNIQUEMENT sur ordinateur (souris/trackpad détectés) */
@media (hover:hover) and (pointer:fine){
${fx.tilt?`.pc{transform-style:preserve-3d;transition:transform .1s ease,box-shadow .25s;will-change:transform}`:''}
${fx.lift&&!fx.tilt?`.pc:hover{transform:translateY(-7px)}`:''}
${fx.glow?`.pc:hover{box-shadow:0 16px 42px color-mix(in srgb,var(--a) 32%,transparent)!important}`:''}
${fx.shine?`.pc{position:relative}.pc::before{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.22) 48%,transparent 60%);transform:translateX(-130%);transition:transform .7s ease}.pc:hover::before{transform:translateX(130%)}`:''}
${fx.mouseglow?`.pc::after{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .3s;background:radial-gradient(180px circle at var(--mx,50%) var(--my,50%),color-mix(in srgb,var(--a) 22%,transparent),transparent 60%)}.pc:hover::after{opacity:1}`:''}
}
/* ── À PROPOS ── */
.about-p{font-size:14px;color:var(--m);line-height:1.95}
/* ── AVIS DÉFILEMENT INFINI ── */
.mq{overflow:hidden;margin-bottom:24px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
.mqtrack{display:flex;width:max-content;animation:mqs 40s linear infinite}
.mq:hover .mqtrack{animation-play-state:paused}
.mqhalf{display:flex;gap:14px;padding-right:14px}
.mq .rc{width:280px;flex-shrink:0}
@keyframes mqs{from{transform:translateX(0)}to{transform:translateX(-50%)}}
/* ── APPARITION AU SCROLL ── */
.rev{opacity:${animLevel==='none'?1:0};transform:translateY(${revY}px);transition:opacity ${revDur}s ease,transform ${revDur}s ease}
.rev.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.rev{opacity:1;transform:none;transition:none}.mqtrack{animation:none}}
/* ── MENU MOBILE ── */
.burger{display:none;flex-direction:column;gap:4px;background:none;border:none;cursor:pointer;padding:8px;margin-left:4px}
.burger span{width:20px;height:2px;background:var(--t);border-radius:2px;transition:.25s}
.burger.open span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.burger.open span:nth-child(2){opacity:0}
.burger.open span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.mobmenu{position:fixed;top:70px;left:16px;right:16px;z-index:99;display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:18px;background:${navBg};border:1px solid var(--b);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 20px 50px rgba(0,0,0,.5);opacity:0;transform:translateY(-12px);pointer-events:none;transition:.25s}
.mobmenu.open{opacity:1;transform:none;pointer-events:auto}
.mobmenu a{padding:13px 16px;border-radius:12px;font-size:14px;font-weight:600;color:var(--m)}
.mobmenu a:hover{color:var(--t);background:rgba(128,128,128,.12)}
/* ── Voir plus / catégories ── */
.pc-hidden{display:none}
.prow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.seeall{background:var(--a);color:#060606;border:none;border-radius:999px;padding:9px 18px;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;transition:.2s;white-space:nowrap}
.seeall:hover{opacity:.85}
/* ── STYLE BARRE LATÉRALE ── */
/* Bloc masqué : invisible par défaut (= rendu public exact, et mode Aperçu).
   !important car .bn/.pc déclarent leur propre display plus bas (spécificité égale
   → sinon la dernière règle gagnerait et le bloc resterait visible).
   La couche d'édition (canvas.js) le ré-affiche en gris quand body.ed-on. */
.bl-hidden{display:none!important}
/* ── Style Bento : tout le corps est une grille de blocs ── */
.bn-page{max-width:1080px;margin:0 auto;padding:0 16px 60px}
/* Rangées de hauteur FIXE : c'est ce qui donne un sens à la coordonnée y
   (sans ça, un placement absolu vertical serait imprévisible). */
.bn-grid{display:grid;grid-template-columns:repeat(${BLOCK_COLS},1fr);grid-auto-rows:150px;gap:14px;margin:34px 0}
.bn{grid-column:span var(--w,1);grid-row:span var(--h,1);position:relative;display:flex;flex-direction:column;gap:6px;justify-content:center;
    padding:18px;border:1px solid var(--b);border-radius:14px;background:${dark?'rgba(255,255,255,.025)':'#fafafa'};overflow:hidden}
.bn[onclick]{cursor:pointer}
.bn-t{font-size:14px;font-weight:800;letter-spacing:-.2px;color:var(--t)}
.bn-sub{font-size:11px;color:${mutedC};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bn-txt{font-size:12px;line-height:1.7;color:${mutedC}}
/* Moyens de contact secondaires dans la carte Bento */
.bn-ct{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.bn-ct a{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;
  border:1px solid var(--b2);font-size:12px;text-decoration:none;transition:.18s}
.bn-ct a:hover{border-color:var(--ct);transform:translateY(-1px)}
.bn-ic{font-size:22px;line-height:1}
.bn-av{width:52px;height:52px;border-radius:50%;background:var(--a);color:#060606;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;font-family:'Syne',sans-serif}
.bn-htag{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--a)}
.bn-name{font-size:clamp(20px,3vw,30px);font-weight:800;letter-spacing:-1px;color:var(--t)}
.bn-bio{font-size:12px;line-height:1.7;color:${mutedC}}
/* Bloc Document / CV */
.bn-dl{margin-top:6px;font-size:10px;font-weight:800;color:var(--a)}
.fdoc{display:flex;align-items:center;gap:16px;max-width:760px;padding:18px 20px;border:1px solid var(--b);
  border-radius:14px;background:${dark?'rgba(255,255,255,.025)':'#fafafa'};flex-wrap:wrap}
.fdoc-i{font-size:30px;line-height:1}
.fdoc-tx{flex:1;min-width:150px}
.fdoc-t{font-size:15px;font-weight:800;color:var(--t)}
.fdoc-s{font-size:12px;color:${mutedC};margin-top:3px}
/* Bulle « + Ajouter un projet » — éditeur uniquement (jamais publiée) */
.bn-add{align-items:center;justify-content:center;gap:8px;border-style:dashed!important;
  border-color:rgba(128,128,128,.4)!important;background:transparent!important;cursor:pointer;
  color:${mutedC};font-size:11px;font-weight:700;transition:transform .18s cubic-bezier(.2,.9,.3,1),border-color .18s,color .18s}
.bn-add:hover{border-color:var(--a)!important;color:var(--a);transform:translateY(-2px)}
.bn-add-i{font-size:26px;line-height:1;font-weight:400}
.bn-project{padding:0;justify-content:flex-start}
.bn-cov{flex:1;min-height:70px;width:100%}
.bn-pb{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.bn-rv{display:flex;flex-direction:column;gap:8px;overflow:hidden}
.bn-rvi{font-size:11px;color:${mutedC};line-height:1.5}
.bn-rvi b{color:var(--t)}
.bn-st{color:var(--a);font-size:10px}
/* 820px : au-dessus la grille garde ses 4 colonnes (~200px/carte, lisible) —
   ça couvre aussi l'aperçu de l'éditeur (~876px) qui doit montrer le vrai desktop.
   En dessous, le placement absolu (x/y) N'A PLUS DE SENS (moins de colonnes) :
   on le neutralise et la grille repasse en flux, dans l'ordre des blocs. */
@media(max-width:820px){
  .bn-grid{grid-template-columns:repeat(2,1fr);grid-auto-rows:minmax(150px,auto)}
  .bn{grid-column:auto/span min(var(--w,1),2)!important;grid-row:auto!important}
}
@media(max-width:560px){
  .bn-grid{grid-template-columns:1fr}
  .bn{grid-column:auto/span 1!important;grid-row:auto!important}
}
.sb-wrap{display:flex;min-height:100vh;gap:14px;padding:14px}
.sb-side{width:230px;flex-shrink:0;position:sticky;top:14px;height:calc(100vh - 28px);padding:24px 16px;display:flex;flex-direction:column;gap:6px;border:1px solid var(--b);border-radius:14px;background:${dark?'rgba(255,255,255,.025)':'#fafafa'};overflow-y:auto}
.sb-logo{display:flex;align-items:center;gap:9px;font-size:18px;font-weight:800;letter-spacing:-.5px;margin-bottom:20px}
.sb-logo .ic{width:28px;height:28px;border-radius:9px;background:var(--a);color:#060606;display:inline-flex;align-items:center;justify-content:center;font-size:15px}
.sb-nav{display:flex;flex-direction:column;gap:2px;background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding:0;border-radius:14px;max-width:none;width:100%}
.sb-nav a{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:600;color:var(--m);transition:.15s}
.sb-nav a:hover{background:rgba(128,128,128,.1);color:var(--t)}
.sb-nav .sbi{width:18px;text-align:center;opacity:.8}
.sb-cat{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--m);margin:20px 12px 8px}
.sb-tags{display:flex;flex-direction:column;gap:1px}
.sb-tags a{padding:8px 12px;border-radius:10px;font-size:12px;color:var(--m);transition:.15s;text-transform:capitalize}
.sb-tags a:hover,.sb-tags a.on{background:rgba(128,128,128,.1);color:var(--t)}
.sb-cta{margin-top:auto;padding:11px;border-radius:10px;background:var(--a);color:#060606;font-size:12px;font-weight:800;text-align:center;transition:.2s}
.sb-cta:hover{opacity:.85}
.sb-main{flex:1;min-width:0;padding:0 12px}
.sb-main section{padding:40px 4px;max-width:none}
.sb-hero{border-radius:14px;min-height:min(56vh,420px);display:flex;align-items:flex-end;padding:34px;position:relative;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.sb-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.72))}
.sb-hero-in{position:relative;z-index:1}
/* Bannière cliquable : seul cas où le curseur devient une main. */
.sb-hero-link{cursor:pointer;text-decoration:none;transition:transform .25s ease,box-shadow .25s ease}
.sb-hero-link:hover{transform:translateY(-3px);box-shadow:0 26px 60px rgba(0,0,0,.45)}
.sb-hero-link:focus-visible{outline:3px solid var(--a);outline-offset:3px}
.sb-hero-in .htag{color:#fff;opacity:.85}
.sb-hero-in h1{color:#fff;font-size:clamp(34px,5vw,60px)}
.sb-hero-in .hsub{color:rgba(255,255,255,.8);margin-bottom:0}
@media(max-width:820px){.sb-side{position:fixed;left:-260px;top:14px;transition:.25s;z-index:100}.sb-wrap.open .sb-side{left:14px}.sb-main{padding:0}}
@media(max-width:640px){.pg{grid-template-columns:1fr!important}.nl{display:none}.navcta{display:none}.burger{display:flex}}
</style></head><body>
${layoutStyle === 'bento' ? `
<div class="bn-page">
  <div class="navwrap"><nav>
    <a href="#" class="logo"><span class="ic">✳</span>${esc(cfg.siteName)}<span class="d">.</span></a>
    <div class="nl">${bentoNav}</div>
    ${cfg.email ? `<a class="ncta" href="mailto:${esc(cfg.email)}">Me contacter</a>` : ''}
  </nav></div>
  ${renderBentoGrid(blocks, { cfg, projects, links, approved, GRADS, editor, secTitle, secTitleOr, contactList })}
  ${extraSections}
  <footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
</div>` : layoutStyle === 'sidebar' ? `
<div class="sb-wrap" id="sbw">
  <aside class="sb-side">
    <a href="#" class="sb-logo"><span class="ic">✳</span>${esc(cfg.siteName)}</a>
    <nav class="sb-nav">
      ${order.filter(k=>secLive(k)).map(k=>`<a href="#${k}"><span class="sbi">${SEC_ICONS[k]||'•'}</span>${SEC_LABELS[k]}</a>`).join('')}
      ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank"><span class="sbi">↗</span>Behance</a>`:''}
    </nav>
    ${tagList.length&&secLive('projects')?`<div class="sb-cat">Catégories</div><div class="sb-tags"><a href="#projects" onclick="return filterTag('')" class="on" data-t="">Tous</a>${tagList.map(t=>`<a href="#projects" onclick="return filterTag('${esc(t.toLowerCase())}')" data-t="${esc(t.toLowerCase())}">${esc(t)}</a>`).join('')}</div>`:''}
    ${cfg.email?`<a class="sb-cta" href="mailto:${esc(cfg.email)}">Me contacter</a>`:''}
  </aside>
  <main class="sb-main">
    ${!heroShow ? '' : `<${heroHref ? 'a' : 'div'} class="sb-hero${heroHref ? ' sb-hero-link' : ''}${heroCls}" data-b="b_profile" data-no-drag${
        heroHref ? ` href="${esc(heroHref)}"${heroBlank ? ' target="_blank" rel="noopener noreferrer"' : ''}` : ''
      } style="${heroImage?`background:url('${esc(heroImage)}')center/cover`:`background:${GRADS[0]}`}">
      <div class="sb-hero-in"><div class="htag">${esc(cfg.heroText)}</div><h1>${esc(cfg.siteName)}</h1><p class="hsub">${esc(cfg.bio)}</p></div>
    </${heroHref ? 'a' : 'div'}>`}
    ${bodySections}
    <footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
  </main>
</div>` : `
<div class="navwrap"><nav>
  <a href="#" class="logo"><span class="ic">✳</span>${esc(cfg.siteName)}<span class="d">.</span></a>
  <div class="nl">
    ${navLinks}
    ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}
  </div>
  ${cfg.email||secLive('contact')?`<a class="ncta navcta" href="${cfg.email?`mailto:${esc(cfg.email)}`:'#contact'}">Me contacter</a>`:''}
  <button class="burger" aria-label="Menu" onclick="var m=document.getElementById('mm');m.classList.toggle('open');this.classList.toggle('open')"><span></span><span></span><span></span></button>
</nav></div>
<div class="mobmenu" id="mm" onclick="this.classList.remove('open');document.querySelector('.burger').classList.remove('open')">
  ${order.filter(k=>secLive(k)).map(k=>`<a href="#${k}">${SEC_LABELS[k]}</a>`).join('')}
  ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}
  ${cfg.email?`<a href="mailto:${esc(cfg.email)}">Me contacter</a>`:''}
</div>
${!heroShow ? '' : `<${heroHref ? 'a' : 'div'} class="hero${heroCls}${heroImage ? ' hero-img' : ''}"${heroHref ? ` href="${esc(heroHref)}"${heroBlank ? ' target="_blank" rel="noopener noreferrer"' : ''}` : ''} data-b="b_profile" data-no-drag${heroImage ? ` style="background:url('${esc(heroImage)}') center/cover"` : ''}><div class="htag">${esc(cfg.heroText)}</div><h1>${esc(cfg.siteName)}<span>.</span></h1><p class="hsub">${esc(cfg.bio)}</p>
${heroHref
  // Bannière cliquable : UN seul app à l'action (jamais d'<a> dans un <a>).
  ? `<div class="ctas"><span class="bp">${esc(String((cfg.heroLink || {}).label || 'Découvrir →'))} →</span></div>`
  : `<div class="ctas">${secLive('projects')?'<a href="#projects" class="bp">Voir les projets</a>':''}${cfg.email?`<a href="mailto:${esc(cfg.email)}" class="bg">Me contacter</a>`:''}</div>`}</${heroHref ? 'a' : 'div'}>`}
${bodySections}
<footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>`}
<a class="made" href="${HUB_HOME_URL}" target="_blank" rel="noopener" title="Créé avec Souanpt HUB — clique pour découvrir"><span class="mic">✳</span>Made by <b>Souanpt&nbsp;HUB</b></a>
<script>
var _rvN=5;
document.querySelectorAll('#rvstars span').forEach(function(s,i){
  s.onclick=function(){_rvN=i+1;document.querySelectorAll('#rvstars span').forEach(function(x,j){x.classList.toggle('on',j<_rvN);});};
});
function revSend(e){
  e.preventDefault();
  var n=document.getElementById('rv-n').value.trim(), t=document.getElementById('rv-t').value.trim();
  if(!n||!t)return false;
  var stars='★'.repeat(_rvN)+'☆'.repeat(5-_rvN);
  var title='[AVIS] '+stars+' — '+n;
  var body='Nom: '+n+'\\nNote: '+_rvN+'\\nAvis: '+t+'\\n\\n— envoyé depuis le portfolio';
  window.open('https://github.com/${repoFull}/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body),'_blank');
  return false;
}
function revMail(){
  var n=document.getElementById('rv-n').value.trim()||'', t=document.getElementById('rv-t').value.trim()||'';
  location.href='mailto:${esc(cfg.email||'')}?subject='+encodeURIComponent('[AVIS] '+_rvN+'/5 — '+n)+'&body='+encodeURIComponent(t);
  return false;
}
function filterTag(t){
  document.querySelectorAll('.sb-tags a').forEach(function(a){a.classList.toggle('on',(a.getAttribute('data-t')||'')===t);});
  document.querySelectorAll('.pc').forEach(function(c){
    var tags=(c.getAttribute('data-tags')||'');
    var show = !t || tags.split('|').indexOf(t)>-1;
    c.classList.remove('pc-hidden');
    c.style.display = show ? '' : 'none';
  });
  return false;
}
/* ── Chiffres clés alimentés par une API publique (v3.9) ──
   La valeur gravée dans la page sert de REPLI : la section reste lisible sans
   réseau, sans script tiers obligatoire. Essai en direct, puis deux relais CORS
   gratuits, puis on garde le chiffre d'origine (aucune erreur affichée). */
${statsApi.length ? `
(function(){var els=[].slice.call(document.querySelectorAll('.kpi[data-kpi-url]'));if(!els.length)return;
var PR=['https://api.allorigins.win/raw?url=','https://corsproxy.io/?url='];
function get(u){var i=0;return new Promise(function(res,rej){(function next(){var t=i?PR[i-1]+encodeURIComponent(u):u;
fetch(t).then(function(r){if(!r.ok)throw 0;return r.json();}).then(res).catch(function(){if(++i>PR.length)rej();else next();});})();});}
function pick(o,p){var ks=String(p||'value').split('.');for(var i=0;i<ks.length;i++){if(o==null)return null;o=o[ks[i]];}return o;}
els.forEach(function(el){get(el.getAttribute('data-kpi-url')).then(function(d){var v=pick(d,el.getAttribute('data-kpi-path'));
if(v==null||v==='')return;if(typeof v==='number')v=v.toLocaleString('fr-FR');
var t=el.querySelector('.kpi-v');if(t)t.textContent=(el.getAttribute('data-kpi-pre')||'')+v+(el.getAttribute('data-kpi-suf')||'');}).catch(function(){});});
})();` : ''}
/* Apparition au scroll */
${animLevel==='none'?`document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});`:`
if ('IntersectionObserver' in window) {
  var _io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_io.unobserve(en.target);}});},{threshold:.12});
  document.querySelectorAll('.rev').forEach(function(el){_io.observe(el);});
} else {
  document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});
}`}
${(fx.tilt||fx.mouseglow)?`
// Effets souris — UNIQUEMENT sur un vrai pointeur (PC/trackpad), jamais sur mobile
if (window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches) {
${fx.tilt?`
  // Effet 3D interactif (Gun.lol / Haunt.gg) — la carte suit la souris, retour doux au centre
  var _ti=${Math.max(3,Math.min(16,Number(fx.intensity)||7))};
  document.querySelectorAll('.pc').forEach(function(c){
    c.addEventListener('mousemove',function(e){var r=c.getBoundingClientRect();var x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;c.style.transform='perspective(700px) rotateY('+(x*_ti)+'deg) rotateX('+(-y*_ti)+'deg) translateY(-4px)';});
    c.addEventListener('mouseleave',function(){c.style.transform='';});
  });`:''}
${fx.mouseglow?`
  // Halo lumineux qui suit le curseur
  document.querySelectorAll('.pc').forEach(function(c){
    c.addEventListener('mousemove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px');});
  });`:''}
}`:''}
</script>
${cfg.ownerUid ? `<script>(function(){var U=${JSON.stringify(String(cfg.ownerUid))},EP=${JSON.stringify(ANALYTICS_URL)};if(!U||location.protocol.indexOf('http')!==0||location.hostname==='localhost'||location.hostname==='127.0.0.1'){return;}var td=new Date().toISOString().slice(0,10),vid,ld,uq=true;try{vid=localStorage.getItem('_shv');if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('_shv',vid);}ld=localStorage.getItem('_shd');uq=ld!==td;localStorage.setItem('_shd',td);}catch(e){}function S(p){p.uid=U;try{var b=JSON.stringify(p);if(navigator.sendBeacon){navigator.sendBeacon(EP,b);}else{fetch(EP,{method:'POST',body:b,keepalive:true,mode:'no-cors'});}}catch(e){}}S({t:'pv',u:uq?1:0,ua:navigator.userAgent});var seen={};try{var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){var t=en.target.getAttribute('data-p');if(t){seen[t]=1;}io.unobserve(en.target);}});},{threshold:.5});document.querySelectorAll('[data-p]').forEach(function(el){io.observe(el);});}catch(e){}function F(){var ps=Object.keys(seen);if(ps.length){S({t:'pj',projects:ps});seen={};}}setTimeout(F,4500);addEventListener('pagehide',F);document.querySelectorAll('[data-p]').forEach(function(el){el.addEventListener('click',function(){var t=el.getAttribute('data-p');if(t){S({t:'click',project:t});}});});})();</script>` : ''}
</body></html>`;
}

/* ══════════════════════════════════════════════════════
   DEPLOY PIPELINE — 1 commit atomique + vérification Pages
══════════════════════════════════════════════════════ */
async function deployPortfolio(onLog, onStep) {
  const token = Auth.token();
  if (!Auth.ok()) throw new Error('Non connecté — connecte GitHub d\'abord');
  const cfg   = SiteConfig.get();
  const owner = Auth.owner();
  if (!owner) throw new Error('Profil GitHub introuvable');

  let repoName = (cfg.repo && cfg.repo.includes('/')) ? cfg.repo.split('/')[1] : (cfg.repo || SITE_REPO_NAME);
  if (!repoName || repoName.toLowerCase() === HUB_REPO_NAME) {
    // Protection : ne JAMAIS écraser le dashboard avec le site généré
    repoName = SITE_REPO_NAME;
    onLog?.('⚠ "' + HUB_REPO_NAME + '" est le repo du dashboard — déploiement redirigé vers ' + owner + '/' + repoName, '#e4b24a');
  }

  onStep?.('behance', 'active'); onLog?.('Récupération des projets et avis…');
  const projects = getProjects();
  const approved = getReviews().filter(r => r.status === 'approved');
  onLog?.(`  → ${projects.length} projet(s) · ${approved.length} avis approuvé(s)`);
  onStep?.('behance', 'done');

  onStep?.('generate', 'active'); onLog?.('Génération du HTML…');
  const cfgToUse = { ...cfg, repo: owner + '/' + repoName };
  /* Les images vivent sur GitHub (media/) : localStorage ne garde qu'une
     miniature. Avant de générer, on remet le PLEIN FORMAT en mémoire — sinon
     le site publié recevrait les miniatures. `site-config.json` (lui, reste en
     miniature) reçoit `cfgToUse`, jamais l'objet résolu. */
  let pubProjects = projects, pubCfg = cfgToUse;
  if (window.HubImages) {
    try {
      pubProjects = await HubImages.resolveProjects(projects);
      pubCfg      = await HubImages.resolveCfg(cfgToUse);
    } catch (e) { console.warn('[images] résolution plein format', e); }
  }
  const siteHTML = generateSite(pubCfg, pubProjects);
  onLog?.(`  → ${Math.round(siteHTML.length/1024)} KB`);
  onStep?.('generate', 'done');

  onStep?.('commit', 'active'); onLog?.(`Envoi vers ${owner}/${repoName}…`);
  await GH.ensureRepo(token, owner, repoName, false);
  await GH.enablePages(token, owner, repoName); // activer Pages AVANT le push
  await GH.commitFiles(token, owner, repoName, [
    { path: 'index.html',       content: siteHTML },
    { path: 'site-config.json', content: JSON.stringify(cfgToUse, null, 2) },
    { path: '.nojekyll',        content: '' },
  ], 'deploy: ' + new Date().toISOString().slice(0,16).replace('T',' '));
  onLog?.('  → 1 commit (index.html + config)'); onStep?.('commit', 'done');

  onStep?.('pages', 'active'); onLog?.('Vérification GitHub Pages…');
  const pages = await GH.pagesInfo(token, owner, repoName);
  const url = pages?.html_url || `https://${owner.toLowerCase()}.github.io/${repoName}/`;

  // Poll du build Pages (max ~75s) — retry auto si erreur
  let ok = false, retried = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const b = await GH.pagesLatestBuild(token, owner, repoName);
    const st = b?.status || 'queued';
    if (st === 'built')  { ok = true; break; }
    if (st === 'errored') {
      if (!retried) { retried = true; onLog?.('  → build en erreur, nouvelle tentative…', '#e4b24a'); await GH.pagesRequestBuild(token, owner, repoName); }
      else throw new Error('Build Pages en erreur : ' + (b?.error?.message || 'réessaie dans 1 min'));
    } else {
      onLog?.('  → build ' + st + '…');
    }
  }
  if (ok) onLog?.('  → ✓ Site en ligne : ' + url);
  else    onLog?.('  → Build en cours — le site sera visible d\'ici 1-2 min : ' + url, '#e4b24a');
  onStep?.('pages', 'done');

  SiteConfig.set('lastDeploy', { url, ts: Date.now(), repo: owner + '/' + repoName });
  SiteConfig.set('repo', owner + '/' + repoName);

  /* L'adresse du site publié doit remonter dans le PROFIL Firestore, pas
     seulement dans localStorage. Sans ça, rien côté public ne sait où trouver
     le site : /u/<pseudo> répondait « site non publié » et le classement
     renvoyait vers « # ». Ces deux fonctionnalités lisent `siteUrl`/`repo`. */
  try {
    if (window.Cloud && Cloud.enabled && Cloud.user()) {
      await Cloud.saveProfile(Cloud.user().uid, {
        siteUrl: url, repo: owner + '/' + repoName, lastPublishedAt: Date.now(),
      });
    }
  } catch (e) { console.warn('[deploy] profil non mis à jour', e); }

  return url;
}

/* ══════════════════════════════════════════════════════
   PORTAIL CLIENT — page mission autonome, lien privé sans compte
   Publiée sur le repo du site à /p/{id}/ ; reprend le thème du portfolio.
   Lecture seule (le suivi 2 sens — messagerie, validation, signature —
   nécessitera un backend : c'est la V2 Supabase/Firebase).
══════════════════════════════════════════════════════ */
const PORTAL_STEPS = ['Brief', 'Devis', 'Acompte', 'Production', 'Livraison', 'Terminé'];

/* ══════════════════════════════════════════════════════════════════════════
   Pièces jointes unifiées — mêmes fichiers de la demande à la livraison.

   ⚠ On ne COPIE JAMAIS le binaire. Une pièce jointe n'est qu'une RÉFÉRENCE :
   l'id du fichier dans le Stockage (HubFiles) + son URL publique + des
   métadonnées. Retirer une pièce jointe d'une mission n'efface donc jamais le
   fichier du Stockage — seulement le lien.

   Modèle : { id, name, type, size, url, category, visibility, uploadedBy, createdAt }
══════════════════════════════════════════════════════════════════════════ */
const ATTACH_CATEGORIES = ['client_reference', 'brief', 'document', 'source_asset', 'proposal', 'deliverable', 'internal'];
const ATTACH_CAT_LABEL = {
  client_reference: 'Références du client', brief: 'Brief et documents', document: 'Documents',
  source_asset: 'Fichiers de travail', proposal: 'Propositions', deliverable: 'Livrables finaux', internal: 'Interne',
};
// Ordre d'affichage des sections côté client.
const ATTACH_CAT_ORDER = ['client_reference', 'brief', 'document', 'proposal', 'deliverable'];
const ATTACH_VISIBILITY = ['internal', 'client_visible', 'preview_only', 'downloadable', 'locked_until_payment'];

/** Un fichier est-il montrable au CLIENT ? (jamais 'internal'.) */
function attachClientVisible(a) {
  return a && a.visibility && a.visibility !== 'internal';
}
/** Le client peut-il TÉLÉCHARGER ? (aperçu seul, ou verrou paiement, => non.) */
function attachDownloadable(a, paid) {
  if (!a) return false;
  if (a.visibility === 'downloadable' || a.visibility === 'client_visible') return true;
  if (a.visibility === 'locked_until_payment') return !!paid;
  return false;   // preview_only, internal
}

/**
 * Déduplique une liste de pièces jointes SANS jamais fusionner deux fichiers
 * réellement différents : on compare d'abord l'id, puis l'URL (≈ storagePath),
 * puis le hash, et seulement en dernier recours nom+taille.
 */
function dedupeAttachments(list) {
  const out = [], seen = new Set();
  for (const a of (list || [])) {
    if (!a) continue;
    const keys = [
      a.id && 'id:' + a.id,
      a.url && 'url:' + a.url,
      a.storagePath && 'path:' + a.storagePath,
      a.hash && 'hash:' + a.hash,
      (a.name && a.size) ? 'ns:' + a.name + ':' + a.size : null,
    ].filter(Boolean);
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    out.push(a);
  }
  return out;
}

/** Section « Fichiers du projet » du portail (ne montre que les catégories présentes). */
function renderPortalFiles(p, opts) {
  const paid = !!(opts && opts.paid);
  const all = (p.attachments || []).filter(attachClientVisible);
  if (!all.length) return '';
  const icon = a => {
    const t = (a.type || '') + ' ' + (a.name || '');
    if (/image\//.test(a.type) || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.name || '')) return '🖼';
    if (/pdf/.test(t)) return '📄'; if (/zip|rar|archive/.test(t)) return '🗜';
    if (/video/.test(t)) return '🎬'; if (/audio/.test(t)) return '🎵'; return '📎';
  };
  const groups = ATTACH_CAT_ORDER
    .map(cat => ({ cat, items: all.filter(a => (a.category || 'document') === cat) }))
    .filter(g => g.items.length);
  // Catégories non prévues dans l'ordre → repli « Documents ».
  const known = new Set(ATTACH_CAT_ORDER);
  const rest = all.filter(a => !known.has(a.category || 'document'));
  if (rest.length) groups.push({ cat: 'document', items: rest });

  const rowFor = a => {
    const dl = attachDownloadable(a, paid);
    const locked = a.visibility === 'locked_until_payment' && !paid;
    const action = locked ? '<span class="dl-go" style="opacity:.6">🔒 après paiement</span>'
      : dl ? '<span class="dl-go">Ouvrir ↗</span>' : '<span class="dl-go" style="opacity:.6">Aperçu</span>';
    const href = (dl && a.url) ? esc(a.url) : null;
    const inner = `<span>${icon(a)} ${esc(a.name || 'Fichier')}</span>${action}`;
    return href
      ? `<a class="dl" href="${href}" target="_blank" rel="noopener">${inner}</a>`
      : `<div class="dl" style="cursor:default">${inner}</div>`;
  };
  return `<section class="c">
    <div class="c-h"><span class="c-t">📁 Fichiers du projet</span><span class="muted sm">${all.length} fichier(s)</span></div>
    ${groups.map(g => `<div class="muted sm" style="margin:10px 0 4px">${esc(ATTACH_CAT_LABEL[g.cat] || 'Documents')}</div>
      ${g.items.map(rowFor).join('')}`).join('')}
  </section>`;
}

function randomId(len = 16) {
  const a = new Uint8Array(len);
  (crypto || window.crypto).getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

/* ══════════════════════════════════════════════════════════════════════
   P0 #2 — mots de passe de portail HACHÉS (jamais en clair)
   ────────────────────────────────────────────────────────────────────────
   Deux endroits lisibles par tout le monde embarquent le portail :
   Firestore `portals/{id}` (allow read: if true — le lien du client n'a pas
   de compte) et la page publiée sur GitHub Pages. Y écrire le mot de passe
   en clair le rendait lisible d'un simple view-source, sur les deux.
   On n'y écrit / n'y affiche plus qu'un hachage itéré salé. Le mot de passe
   en clair ne quitte jamais le navigateur du propriétaire : localStorage et
   copies privées (users/{uid}/data, dépôt de sauvegarde privé).
   ══════════════════════════════════════════════════════════════════════ */
const PORTAL_HASH_ROUNDS = 4096;

/* SHA-256 synchrone et AUTONOME : le générateur de portail rend une chaîne de
   façon synchrone (deployPortal, document.write de portal.html) et ne peut donc
   pas attendre `crypto.subtle`. La même fonction est copiée telle quelle dans la
   page publiée via `String(sha256hex)` : elle ne doit rien capturer au-dessus
   d'elle, sinon la source embarquée serait incomplète. */
function sha256hex(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = [];
  const s = String(str);
  for (let i = 0; i < s.length; i++) {                       // → UTF-8
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      i++;
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);            // bourrage jusqu'à 56 octets
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
  return out;
}

/** Sel aléatoire de 16 octets (hex) — un par portail. */
function portalSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
  return s;
}

/** Hachage itéré salé du mot de passe d'un portail (~2 ms). */
function portalPasswordHash(pw, salt, rounds) {
  let x = String(pw);
  const n = Number(rounds) || PORTAL_HASH_ROUNDS;
  for (let i = 0; i < n; i++) x = sha256hex(String(salt) + ':' + x);
  return x;
}

/* Données du verrou à embarquer dans la page — JAMAIS le mot de passe en clair.
   Une donnée locale non migrée (password seul) est hachée à la volée. */
function portalGate(p) {
  if (!p) return null;
  if (p.passwordHash && p.passwordSalt) {
    return { salt: String(p.passwordSalt), hash: String(p.passwordHash),
             rounds: Number(p.hashRounds) || PORTAL_HASH_ROUNDS };
  }
  if (p.password) {
    const salt = p.passwordSalt || portalSalt();
    return { salt, hash: portalPasswordHash(p.password, salt), rounds: PORTAL_HASH_ROUNDS };
  }
  return null;
}

function generatePortal(p, cfg) {
  cfg = cfg || SiteConfig.get();
  const dark   = cfg.theme !== '#f8f8f8';
  const acc    = cfg.accentColor || '#C8FF00';
  const bg     = dark ? '#0b0b0d' : '#f4f4f6';
  const card   = dark ? 'rgba(255,255,255,.035)' : '#fff';
  const textC  = dark ? '#f0ece4' : '#141414';
  const mutedC = dark ? 'rgba(240,236,228,.55)' : '#666';
  const brdC   = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.1)';
  const total  = Number(p.total) || 0;
  const acPct  = Number(p.acomptePct) || 0;
  const acompte = Math.round(total * acPct / 100);
  const solde   = total - acompte;
  const idx    = Number(p.stepIndex) || 0;
  const hasPrice = total > 0;
  const acStep = acPct > 0;
  /* « Acompte reçu » ne s'affiche JAMAIS sans montant (§26), et JAMAIS tant
     qu'on est ENCORE à l'étape Acompte (idx===2 = acompte ATTENDU, pas reçu).
     Il faut avoir DÉPASSÉ cette étape — c'est le créateur qui l'avance quand le
     paiement arrive. Sans acompte configuré, la notion ne s'applique pas. */
  const acompteRecu = hasPrice && acStep && idx > 2;
  const soldeDu = acStep ? (acompteRecu ? solde : total) : total;
  const money  = n => n.toLocaleString('fr-FR') + ' €';
  const STATUS = { brief:'Brief', devis:'Devis', production:'En production', livraison:'Livraison', termine:'Terminé', valide:'Validé' };
  const statusKey = p.status || (idx >= 5 ? 'termine' : idx >= 3 ? 'production' : idx >= 1 ? 'devis' : 'brief');
  const statusLbl = STATUS[statusKey] || 'En cours';

  const steps = PORTAL_STEPS.map((s, i) => {
    const state = i < idx ? 'done' : i === idx ? 'cur' : 'todo';
    const mark = state === 'done' ? '✓' : state === 'cur' ? '●' : '○';
    return `<div class="stp ${state}"><div class="stp-c">${mark}</div><div class="stp-l">${esc(s)}</div></div>`;
  }).join('<div class="stp-line"></div>');

  const deliverables = (p.deliverables || []).filter(d => d && d.url);
  const delivHtml = deliverables.length
    ? deliverables.map(d => `<a class="dl" href="${esc(d.url)}" target="_blank" rel="noopener"><span>📎 ${esc(d.label || 'Fichier')}</span><span class="dl-go">Ouvrir ↗</span></a>`).join('')
    : `<div class="muted" style="padding:6px 2px">Vos fichiers finaux apparaîtront ici à la livraison — accessibles pour toujours depuis ce lien.</div>`;

  // Le bouton propose de régler le montant RÉELLEMENT dû (solde restant), pas
  // un solde théorique déduit d'un acompte qui n'a peut-être pas été payé.
  const payBtn = (soldeDu > 0 && statusKey !== 'termine' && p.paymentLink)
    ? `<a class="pay" href="${esc(p.paymentLink)}" target="_blank" rel="noopener">Payer — ${money(soldeDu)} →</a>` : '';

  const body = `
<div class="wrap">
  <header class="top">
    <div class="brand"><span class="ic">✳</span> ${esc(cfg.siteName || 'FOLIO')}</div>
    <div class="muted sm">Espace mission sécurisé</div>
  </header>
  <div class="muted sm">Votre espace mission avec</div>
  <h1>${esc(p.mission || 'Mission')}</h1>
  <div class="muted">Avec <b style="color:${textC}">${esc(cfg.siteName || '')}</b>${p.client ? ' · ' + esc(p.client) : ''}</div>
  <div class="row">
    <span class="pin">📌 Retrouvez tout ici — sans email, sans PDF perdu</span>
    <span class="badge">${esc(statusLbl)}</span>
  </div>

  <section class="c">
    <div class="c-t">Avancement de la mission</div>
    <div class="steps">${steps}</div>
    ${p.note ? `<div class="muted sm" style="margin-top:14px">📝 ${esc(p.note)}</div>` : ''}
  </section>

  ${hasPrice ? `<section class="c">
    <div class="c-h"><span class="c-t">💰 Suivi financier</span>${acompteRecu ? '<span class="ok">✓ Acompte reçu</span>' : (acStep ? '<span class="muted sm">Acompte attendu</span>' : '')}</div>
    <div class="fin"><span>Total de la mission</span><b>${money(total)}</b></div>
    ${acStep ? `<div class="fin"><span>Acompte demandé (${acPct}%)</span><b style="color:${acc}">${money(acompte)}</b></div>
    <div class="fin"><span>Acompte reçu</span><b>${money(acompteRecu ? acompte : 0)}</b></div>` : ''}
    <div class="fin"><span>Solde restant</span><b>${money(soldeDu)}</b></div>
    ${payBtn}
  </section>` : `<section class="c">
    <div class="c-h"><span class="c-t">💰 Suivi financier</span><span class="muted sm">En attente de validation</span></div>
    <div class="muted" style="padding:6px 2px">Le montant de la mission sera confirmé une fois le devis validé. Aucun paiement n'est demandé à ce stade.</div>
  </section>`}

  ${renderPortalFiles(p, { paid: acompteRecu || idx >= 5 })}

  <section class="c">
    <div class="c-h"><span class="c-t">📦 Livrables</span><span class="muted sm">${deliverables.length ? deliverables.length + ' fichier(s)' : 'En attente de livraison'}</span></div>
    ${delivHtml}
  </section>

  <footer class="foot">Propulsé par <a href="${HUB_HOME_URL}" target="_blank" rel="noopener">Souanpt HUB</a> · L'espace client des créatifs freelance</footer>
</div>`;

  const gateData = portalGate(p);
  const gate = gateData
    ? `<div id="lock"><div class="lockbox"><div class="brand" style="justify-content:center;margin-bottom:8px"><span class="ic">✳</span> ${esc(cfg.siteName || 'FOLIO')}</div><div class="muted sm" style="text-align:center;margin-bottom:14px">Cet espace est protégé par un mot de passe.</div><input id="pw" type="password" placeholder="Mot de passe" onkeydown="if(event.key==='Enter')chk()"><button onclick="chk()">Déverrouiller</button><div id="pwmsg" class="muted sm" style="text-align:center;margin-top:8px;min-height:14px"></div></div></div>` : '';

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>${esc(p.mission || 'Mission')} — Espace client</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--a:${acc};--bg:${bg};--c:${card};--t:${textC};--m:${mutedC};--b:${brdC}}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif;line-height:1.5;padding:20px;min-height:100vh}
a{color:inherit;text-decoration:none}
.wrap{max-width:560px;margin:0 auto;animation:fu .4s ease both}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 0 22px}
.brand{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800}
.brand .ic{width:26px;height:26px;border-radius:8px;background:var(--a);color:#060606;display:inline-flex;align-items:center;justify-content:center;font-size:14px}
.muted{color:var(--m)}.sm{font-size:12px}
h1{font-size:clamp(24px,5vw,32px);font-weight:800;letter-spacing:-1px;margin:2px 0 4px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:16px 0 22px}
.pin{font-size:11px;background:rgba(255,90,120,.12);color:#ff6b8a;padding:5px 12px;border-radius:999px;font-weight:700}
.badge{font-size:11px;background:rgba(90,140,255,.15);color:#7aa2ff;padding:5px 12px;border-radius:999px;font-weight:700}
.c{background:var(--c);border:1px solid var(--b);border-radius:16px;padding:18px;margin-bottom:14px}
.c-t{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
.c-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.ok{font-size:12px;color:var(--a);font-weight:700}
.steps{display:flex;align-items:flex-start;justify-content:space-between}
.stp{display:flex;flex-direction:column;align-items:center;gap:7px;flex-shrink:0;width:58px}
.stp-c{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:1.5px solid var(--b);color:var(--m)}
.stp-l{font-size:10px;color:var(--m);text-align:center}
.stp.done .stp-c{background:rgba(255,90,120,.15);border-color:transparent;color:#ff6b8a}
.stp.cur .stp-c{background:var(--a);border-color:transparent;color:#060606;box-shadow:0 0 0 4px rgba(200,255,0,.15)}
.stp.cur .stp-l,.stp.done .stp-l{color:var(--t);font-weight:700}
.stp-line{flex:1;height:1.5px;background:var(--b);margin-top:17px}
.fin{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--b);font-size:14px}
.fin:last-of-type{border-bottom:none}.fin b{font-weight:800}
.pay{display:block;text-align:center;margin-top:14px;padding:13px;background:var(--a);color:#060606;border-radius:10px;font-weight:800;font-size:14px}
.dl{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(128,128,128,.08);border:1px solid var(--b);border-radius:10px;margin-bottom:8px;font-size:13px;font-weight:600;transition:.15s}
.dl:hover{border-color:var(--a)}.dl-go{color:var(--a);font-size:12px;font-weight:700}
.foot{text-align:center;font-size:11px;color:var(--m);padding:20px 0}
.foot a{color:var(--a);font-weight:700}
#lock{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;z-index:10}
.lockbox{width:100%;max-width:340px;background:var(--c);border:1px solid var(--b);border-radius:16px;padding:26px}
.lockbox input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--b);background:transparent;color:var(--t);font-family:inherit;font-size:14px;margin-bottom:10px;outline:none}
.lockbox button{width:100%;padding:11px;border:none;border-radius:8px;background:var(--a);color:#060606;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer}
@media(max-width:480px){.stp{width:44px}.stp-l{font-size:8px}}
</style></head><body>
${gate}
${body}
${gateData ? `<script>
/* P0 : le mot de passe n'est jamais écrit dans la page, seulement son
   hachage itéré salé. On vérifie en recalculant le même nombre de tours. */
${String(sha256hex)}
var GATE=${JSON.stringify(gateData)};
document.querySelector('.wrap').style.display='none';
function chk(){var v=document.getElementById('pw').value,x=v,i;for(i=0;i<GATE.rounds;i++)x=sha256hex(GATE.salt+':'+x);if(x===GATE.hash){document.getElementById('lock').style.display='none';document.querySelector('.wrap').style.display='';}else{document.getElementById('pwmsg').textContent='Mot de passe incorrect';}}
</script>` : ''}
</body></html>`;
}

/** Détermine le repo du site (jamais le hub) */
function portalRepo(cfg) {
  let repo = (cfg.repo && cfg.repo.includes('/')) ? cfg.repo.split('/')[1] : (cfg.repo || SITE_REPO_NAME);
  if (!repo || repo.toLowerCase() === HUB_REPO_NAME) repo = SITE_REPO_NAME;
  return repo;
}

/**
 * Publie (ou met à jour) le portail sur le repo du site.
 * Corrige le 404 : écrit .nojekyll, active Pages, commit atomique, PUIS
 * attend que le build Pages soit terminé avant de déclarer le lien actif.
 * onStatus(msg) : retour d'état facultatif pour l'UI.
 * → { url, built }
 */
async function publishPortal(p, onStatus) {
  const token = Auth.token(); if (!Auth.ok()) throw new Error('Connecte GitHub d\'abord');
  const owner = Auth.owner(); if (!owner) throw new Error('Profil GitHub introuvable');
  const cfg = SiteConfig.get();
  const repo = portalRepo(cfg);
  onStatus?.('Préparation du repo…');
  await GH.ensureRepo(token, owner, repo, false);
  await GH.enablePages(token, owner, repo);

  const html = p.active === false ? generatePortalDisabled(cfg) : generatePortal(p, cfg);
  const files = [{ path: 'p/' + p.id + '/index.html', content: html }];
  // .nojekyll : sans ça, Jekyll peut ignorer/casser les dossiers → 404
  const hasNojekyll = await GH.fileSha(token, owner, repo, '.nojekyll');
  if (!hasNojekyll) files.push({ path: '.nojekyll', content: '' });
  onStatus?.('Publication de la page…');
  await GH.commitFiles(token, owner, repo, files, 'portal: ' + (p.mission || p.id));

  const url = `https://${owner.toLowerCase()}.github.io/${repo}/p/${p.id}/`;
  // Attend la fin du build Pages (le lien est 404 tant que ce n'est pas "built")
  onStatus?.('Construction GitHub Pages…');
  let built = false;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const b = await GH.pagesLatestBuild(token, owner, repo);
    if (b?.status === 'built') { built = true; break; }
    if (b?.status === 'errored') { await GH.pagesRequestBuild(token, owner, repo); }
    onStatus?.('Construction GitHub Pages… (' + ((i + 1) * 5) + 's)');
  }
  return { url, built };
}

/** Vérifie qu'un portail est réellement en ligne (fichier + build Pages) */
async function verifyPortal(id) {
  const token = Auth.token(); const owner = Auth.owner(); const cfg = SiteConfig.get();
  if (!Auth.ok() || !owner) return { ok: false, reason: 'Non connecté' };
  const repo = portalRepo(cfg);
  const sha = await GH.fileSha(token, owner, repo, 'p/' + id + '/index.html');
  if (!sha) return { ok: false, reason: 'Page introuvable — clique Publier' };
  const b = await GH.pagesLatestBuild(token, owner, repo);
  if (b?.status === 'built') return { ok: true };
  if (b?.status === 'errored') return { ok: false, reason: 'Build Pages en erreur — republie' };
  return { ok: false, reason: 'Build en cours — actif d\'ici ~1 min', pending: true };
}

function generatePortalDisabled(cfg) {
  const acc = cfg.accentColor || '#C8FF00';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Lien désactivé</title>
<style>body{background:#0b0b0d;color:#f0ece4;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}b{color:${acc}}</style></head>
<body><div><div style="font-size:40px;margin-bottom:12px">🔒</div><h1>Lien désactivé</h1><p style="color:rgba(240,236,228,.55);margin-top:8px">Ce lien de mission n'est plus actif.<br>Contacte ton prestataire pour un nouvel accès.</p><p style="margin-top:16px;font-size:12px">Propulsé par <b>Souanpt HUB</b></p></div></body></html>`;
}

const CORS_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
];

/* fetch avec timeout (évite qu'un proxy bloqué fige la sync) */
async function fetchTimeout(url, ms = 12000, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* ══════════════════════════════════════════════════════
   GOATCOUNTER — stats réelles remontées dans le dashboard
   Utilise l'endpoint public /counter/TOTAL.json
   (à activer dans GoatCounter → Settings → "Allow using the
    visitor counter" pour rendre l'endpoint accessible)
══════════════════════════════════════════════════════ */
async function fetchGoatStats() {
  const code = String(SiteConfig.get().goatcounter || '').trim();
  if (!code) return null;
  const url = `https://${code}.goatcounter.com/counter/TOTAL.json`;
  const parse = txt => { const j = JSON.parse(txt); const n = s => parseInt(String(s ?? '0').replace(/[^\d]/g, '')) || 0; return { views: n(j.count), visitors: n(j.count_unique) }; };
  // 1) direct (les endpoints counter envoient du CORS *)
  try { const r = await fetchTimeout(url, 10000, { headers: { 'Accept': 'application/json' } }); if (r.ok) return parse(await r.text()); } catch {}
  // 2) repli via proxy
  for (const wrap of CORS_PROXIES) {
    try { const r = await fetchTimeout(wrap(url), 10000); if (r.ok) { const t = await r.text(); if (t.includes('count')) return parse(t); } } catch {}
  }
  return null;
}

/* ══════════════════════════════════════════════════════
   BEHANCE — sync via flux RSS public (l'API Behance est fermée,
   plus aucune clé API nécessaire — juste le pseudo)
══════════════════════════════════════════════════════ */
const Behance = {
  PROXIES: CORS_PROXIES,

  async fetchProjects(username) {
    const user = (username || '').trim().replace('@','');
    if (!user) throw new Error('Pseudo Behance requis');
    const feed = `https://www.behance.net/feeds/user?username=${encodeURIComponent(user)}`;
    let xml = null, lastStatus = 0, timedOut = false;
    for (const wrap of this.PROXIES) {
      try {
        const res = await fetchTimeout(wrap(feed), 12000);
        if (!res.ok) { lastStatus = res.status; continue; }
        const t = await res.text();
        if (t.includes('<item')) { xml = t; break; }
        // réponse vide/valide mais sans projet → on retient et on continue d'essayer
      } catch (e) { if (e.name === 'AbortError') timedOut = true; }
    }
    if (!xml) {
      if (lastStatus === 403 || lastStatus === 401) throw new Error('403 — Behance a bloqué la requête (proxy limité). Réessaie dans quelques minutes.');
      if (lastStatus === 429) throw new Error('429 — trop de requêtes. Patiente une minute avant de relancer.');
      if (timedOut) throw new Error('Délai dépassé — le service relais met trop de temps. Réessaie.');
      throw new Error('Flux Behance injoignable — vérifie le pseudo (behance.net/@' + user + ') et réessaie.');
    }
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = [...doc.querySelectorAll('item')];
    if (!items.length) throw new Error('Aucun projet public trouvé pour @' + user);
    return items.map(it => {
      const g = tag => it.querySelector(tag)?.textContent?.trim() || '';
      const desc = g('description');
      const cover = (desc.match(/src="([^"]+)"/) || [])[1] || '';
      const tags = [...it.querySelectorAll('category')].map(c => c.textContent.trim()).filter(Boolean).slice(0, 4);
      return {
        title: g('title') || 'Projet',
        url:   g('link'),
        cover,
        tags,
        date: new Date(g('pubDate') || Date.now()).getTime(),
      };
    });
  },
};

/** Importe/synchronise les projets Behance dans le portfolio (dédupliqué par URL) */
async function behanceSyncNow(silent) {
  const cfg = SiteConfig.get();
  const user = (cfg.behance || '').replace('@','');
  if (!user) { if (!silent) showToast('Configure ton pseudo Behance d\'abord', '#e4b24a'); return 0; }
  const fetched = await Behance.fetchProjects(user);
  const projects = getProjects();
  let added = 0;
  fetched.forEach(f => {
    const existing = projects.find(p => p.url === f.url);
    if (existing) { // met à jour la cover/les tags si absents
      if (!existing.cover && f.cover) existing.cover = f.cover;
      if ((!existing.tags || !existing.tags.length) && f.tags.length) existing.tags = f.tags;
      return;
    }
    projects.unshift({
      id: 'be' + Date.now() + Math.floor(Math.random()*1000),
      title: f.title, tags: f.tags, url: f.url, cover: f.cover,
      views: 0, behance: true, createdAt: f.date,
    });
    added++;
  });
  localStorage.setItem('hub_projects', JSON.stringify(projects));
  localStorage.setItem('souanpt_last_behance_sync', Date.now().toString());
  window.renderProjects?.(); window.syncKPIs?.();
  if (!silent) showToast(added ? `✓ ${added} projet(s) Behance importé(s)` : '✓ Behance à jour — rien de nouveau', '#2e9a63');
  return added;
}

/* ══════════════════════════════════════════════════════
   AVIS VISITEURS — relevés depuis les Issues GitHub du repo du site
   (le formulaire du site public crée une issue "[AVIS] ★★★★★ — Nom")
══════════════════════════════════════════════════════ */
async function fetchVisitorReviews(silent) {
  const token = Auth.token();
  const cfg   = SiteConfig.get();
  if (!Auth.ok() || !cfg.repo || !cfg.repo.includes('/')) return 0;
  const [owner, repo] = cfg.repo.split('/');
  let issues = [];
  try { issues = await GH.api(token, `/repos/${owner}/${repo}/issues?state=open&per_page=50`); }
  catch { return 0; }
  const avisIssues = (issues || []).filter(i => (i.title || '').startsWith('[AVIS]'));
  if (!avisIssues.length) { if (!silent) showToast('Aucun nouvel avis', '#666', 1500); return 0; }

  const reviews = getReviews();
  let added = 0;
  for (const is of avisIssues) {
    if (reviews.find(r => r.ghIssue === is.number)) continue;
    const body   = is.body || '';
    const rating = Math.min(5, Math.max(1, parseInt((body.match(/Note\s*:\s*(\d)/) || [])[1] || (is.title.match(/★/g) || []).length || 5)));
    const author = ((body.match(/Nom\s*:\s*(.+)/) || [])[1] || is.user?.login || 'Visiteur').trim().slice(0, 60);
    const text   = ((body.match(/Avis\s*:\s*([\s\S]+?)(\n\n—|$)/) || [])[1] || body).trim().slice(0, 600);
    reviews.unshift({
      id: 'gh' + is.number, ghIssue: is.number,
      author, text, rating, status: 'pending',
      project: '', createdAt: new Date(is.created_at).getTime(),
    });
    added++;
    // Ferme l'issue une fois importée (l'avis vit désormais dans le hub)
    try { await GH.api(token, `/repos/${owner}/${repo}/issues/${is.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }); } catch {}
  }
  if (added) {
    localStorage.setItem('hub_reviews', JSON.stringify(reviews));
    window.renderReviews?.();
    showToast(`📥 ${added} nouvel(aux) avis à modérer !`, '#e4b24a', 3500);
  } else if (!silent) {
    showToast('Aucun nouvel avis', '#666', 1500);
  }
  localStorage.setItem('souanpt_last_avis_check', Date.now().toString());
  return added;
}

/* ══════════════════════════════════════════════════════
   AUTO-BACKUP — sauvegarde COMPLÈTE des données dans le dépôt privé
══════════════════════════════════════════════════════ */
const BACKUP_MIN_INTERVAL = 30 * 1000;
let _backupRunning = false;

/**
 * Verrou d'écriture sur le dépôt privé {login}-hub-data.
 * Deux codeurs écrivent sur la même branche : la sauvegarde (autoBackup) et
 * l'envoi des images (hub-images.js). Sans verrou, leurs PATCH refs/heads/main
 * se marchent dessus → « Update is not a fast forward » et une image perdue.
 * (Les dépôts du site sont différents : ils n'ont pas besoin de ce verrou.)
 */
let _repoBusy = false;
async function withRepoLock(fn) {
  let tries = 0;
  while (_repoBusy && tries++ < 240) await new Promise(r => setTimeout(r, 250));
  _repoBusy = true;
  try { return await fn(); } finally { _repoBusy = false; }
}

/**
 * Sauvegarde COMPLÈTE — schéma data/*.json (voir js/hub-data.js).
 *
 * Trois règles, sans lesquelles le dépôt devient un trou noir Git :
 *   1. RIEN NE CHANGE → 0 écriture (le manifeste est déterministe : aucun
 *      horodatage dedans, sinon chaque appel créerait un commit) ;
 *   2. 1 seul commit ATOMIQUE, et seulement pour les fichiers différents ;
 *   3. 30 s minimum entre deux écritures (quota GitHub 5 000 requêtes/h +
 *      historique git).
 * La comparaison se fait contre le manifeste REMOT (1 GET) : c'est la source
 * de vérité, donc un changement fait depuis un autre appareil ou un dépôt
 * vidé entre-temps est détecté sans état local à désynchroniser.
 *
 * @param {{force?:boolean}} [opts] force = ignore le throttle (connexion, bouton)
 * @returns {Promise<{pushed:number,deleted:number,skipped:boolean}|null>} null = pas de compte
 */
async function autoBackup(opts) {
  const token = Auth.token(); const user = Auth.user();
  if (!Auth.ok() || !user) return null;
  if (_backupRunning) return null;                        // pas de 2 sauvegardes simultanées
  // Le tirage GitHub (hub-sync.js) doit finir AVANT toute écriture : sinon on
  // pousserait une copie locale périmée par-dessus la sauvegarde d'un autre
  // appareil. C'est la seule règle d'ordonnancement du système.
  if (window.HubSync && HubSync.pending) { try { await HubSync.pending; } catch {} }
  const force = !!(opts && opts.force);
  if (!force) {
    const last = parseInt(localStorage.getItem('souanpt_last_backup') || '0', 10);
    if (Date.now() - last < BACKUP_MIN_INTERVAL) return { pushed: 0, deleted: 0, skipped: true };
  }

  _backupRunning = true;
  try {
    const owner = user.login;
    const repo  = owner.toLowerCase() + REPO_DATA_SUFFIX;
    const files = await HubData.buildFiles();
    const manifest = files.find(f => f.key === 'manifest');
    const payload  = files.filter(f => f.key !== 'manifest');

    // 1 lecture : l'état réel du dépôt (le manifeste = table des matières sha256)
    let remote = null;
    try { remote = (await GH.loadFile(token, owner, repo, 'data/manifest.json')).data; } catch {}
    if (remote === null) await GH.ensureRepo(token, owner, repo, true);  // 1re fois / dépôt recréé
    const remoteMap = new Map();
    let remoteVersion = null;
    if (remote) {
      try {
        const m = JSON.parse(remote);
        remoteVersion = (m.version === undefined ? null : m.version);
        (m.files || []).forEach(f => remoteMap.set(f.path, f.sha256));
      } catch {}
    }

    // Le manifeste ne peut pas contenir son propre sha256 (référence circulaire) :
    // il est réécrit dès qu'une donnée bouge, ou si le schéma a changé de version.
    const changed = payload.filter(f => remoteMap.get(f.path) !== f.sha256);
    const needManifest = changed.length > 0 || remoteVersion !== HubData.VERSION;

    if (!changed.length && !needManifest) {
      localStorage.setItem('souanpt_last_backup', Date.now().toString());
      window.HubSync && HubSync.record(files, false);   // accord local ↔ distant
      return { pushed: 0, deleted: 0, skipped: true };    // 0 requête d'écriture
    }

    // Chemin d'écriture uniquement (1 GET de plus) : on repart de l'arbre réel,
    // pas du manifeste — si une suppression a échoué au précédent tour, le
    // fichier orphelin est ici rattrapé. Inutile sur un dépôt encore vide.
    const localPaths = new Set(files.map(f => f.path));
    const obsolete = remote === null ? []
      : (await GH.dataPaths(token, owner, repo)).filter(p => !localPaths.has(p));

    const msg = 'backup ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    const toPush = needManifest ? [...changed, manifest] : changed;
    let pushed = 0, deleted = 0;
    /* Écritures sous verrou : les images (hub-images.js) peuvent pousser un
       commit sur le même dépôt au même moment — deux PATCH de ref concurrents
       perdent le second. Les suppressions restent APRÈS le commit des données :
       si elles échouent on perd de la place, jamais des données. */
    await withRepoLock(async () => {
      if (toPush.length) {
        await GH.commitFiles(token, owner, repo,
          toPush.map(f => ({ path: f.path, content: f.content })), msg);
        pushed = toPush.length;
      }
      // Fichiers devenus inutiles (collection rétrécie) : après le commit.
      for (const p of obsolete) if (await GH.deleteFile(token, owner, repo, p, msg)) deleted++;
    });

    localStorage.setItem('souanpt_last_backup', Date.now().toString());
    window.HubSync && HubSync.record(files, false);      // accord rétabli : la baseline suit
    return { pushed, deleted, skipped: false };
  } catch (e) {
    console.warn('[backup]', e);
    return null;
  } finally { _backupRunning = false; }
}

/** Restaure depuis le dépôt privé GitHub : data/manifest.json + data/*.json,
    avec repli sur l'ancien format mono-fichier backup.json (V1/V2). */
async function restoreFromGitHub() {
  const token = Auth.token(); const user = Auth.user();
  if (!Auth.ok() || !user) throw new Error('Connecte GitHub d\'abord');
  const owner = user.login;
  const repo  = owner.toLowerCase() + REPO_DATA_SUFFIX;

  const manifestRaw = await GH.rawFile(token, owner, repo, 'data/manifest.json');
  if (manifestRaw) {
    let paths = [];
    try { paths = (JSON.parse(manifestRaw).files || []).map(f => f.path); } catch {}
    const map = {};
    // Séquentiel volontaire : 15 requêtes d'affilée tombent dans le
    // rate-limit GitHub (5 000/h) bien plus vite qu'en parallèle.
    for (const p of paths) {
      const c = await GH.rawFile(token, owner, repo, p);
      if (c !== null) map[p] = c;
    }
    const restored = HubData.applyFiles(map);
    if (!restored.length) throw new Error('Sauvegarde vide ou illisible');
    return { restored };
  }

  /* ── Ancien format (V1/V2) : 1 seul backup.json ── */
  const { data } = await GH.loadFile(token, owner, repo, 'backup.json');
  if (!data) throw new Error('Aucun backup trouvé');
  const parsed = JSON.parse(data);
  if (parsed.siteConfig) SiteConfig.save(parsed.siteConfig);
  const legacy = {
    projects: 'hub_projects', links: 'hub_links', clients: 'hub_clients',
    invoices: 'hub_invoices', reviews: 'hub_reviews',
  };
  const restored = [];
  for (const [k, ls] of Object.entries(legacy)) {
    if (Array.isArray(parsed[k])) { localStorage.setItem(ls, JSON.stringify(parsed[k])); restored.push(k); }
  }
  return { restored, legacy: true };
}

/* ══════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════ */
function showToast(msg, color, dur) {
  const el = document.getElementById('sm2-toast'); if (!el) return;
  el.textContent = msg; el.style.background = color || '#1a1a1a'; el.style.color = '#fff';
  el.classList.add('show'); clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur || 2500);
}
window.showNotif = msg => showToast(msg);
function timeAgo(ts) {
  const d = Date.now()-ts;
  if(d<60000)return'À l\'instant';if(d<3600000)return Math.floor(d/60000)+'min';
  if(d<86400000)return Math.floor(d/3600000)+'h';return Math.floor(d/86400000)+'j';
}
