/* ══════════════════════════════════════════════════════════════
   OUTILS LOCAUX (v3.25) — inspirés d'ihate.tools, neverupload.lol, animg :
   tout se passe dans le navigateur, AUCUN fichier n'est envoyé.
     • Image : compresser / redimensionner / convertir (JPG, WebP, PNG) —
       le réencodage retire aussi les métadonnées (EXIF, position GPS) ;
       filigrane texte facultatif.
     • Palette : couleurs dominantes d'une image → copier, ou appliquer
       comme couleur du site.
     • Contraste : rapport WCAG entre deux couleurs (AA / AAA).
     • QR code : texte ou lien → PNG (librairie locale).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kb = n => n < 1048576 ? Math.round(n / 1024) + ' Ko' : (n / 1048576).toFixed(2).replace('.', ',') + ' Mo';
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

  /* ── calculs purs (testés) ── */
  function luminance(h) {
    const n = parseInt(String(h).replace('#', ''), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /** Couleurs dominantes : quantification 4 bits par canal, cases les plus peuplées, couleurs trop proches fusionnées. */
  function palette(rgba, count) {
    count = count || 6;
    const bins = new Map();
    for (let i = 0; i < rgba.length; i += 16) {          // 1 pixel sur 4 suffit
      if (rgba[i + 3] < 128) continue;
      const k = (rgba[i] >> 4) << 8 | (rgba[i + 1] >> 4) << 4 | (rgba[i + 2] >> 4);
      const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2]; bins.set(k, b);
    }
    const out = [];
    [...bins.values()].sort((p, q) => q.n - p.n).forEach(b => {
      if (out.length >= count) return;
      const c = [b.r / b.n, b.g / b.n, b.b / b.n];
      if (out.some(o => Math.abs(o.c[0] - c[0]) + Math.abs(o.c[1] - c[1]) + Math.abs(o.c[2] - c[2]) < 60)) return;
      out.push({ c, n: b.n });
    });
    return out.map(o => hex(o.c[0], o.c[1], o.c[2]));
  }
  /** Dimensions cibles en gardant le ratio (largeur max, jamais d'agrandissement). */
  function fit(w, h, maxW) { maxW = Math.round(Number(maxW) || 0); if (!maxW || w <= maxW) return [w, h]; return [maxW, Math.max(1, Math.round(h * maxW / w))]; }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Choisis une image (JPG, PNG, WebP, GIF…)'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => resolve({ img, url }); img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }

  /* ── Raccourcis vers des projets open source (3.26, dossiers et profil en 3.28) ──
     Plutôt que de refaire ce que ces outils font déjà très bien, le hub y
     donne accès en un clic. Raccourcis par défaut (masquables) + raccourcis
     personnels, rangés dans des DOSSIERS que l'on crée, renomme, réordonne ;
     un raccourci se déplace en le maintenant puis en le glissant (même geste
     que les projets dans l'éditeur du site). Recommandations selon le profil
     (graphiste, photographe, vidéaste, 3D…), détecté ou choisi.
     Aucune icône chargée depuis ces sites : pastille locale, donc aucune
     requête vers un tiers tant qu'on ne clique pas. */
  const DEFAULT_LINKS = [
    { id: 'ihate', name: 'ihate.tools', url: 'https://ihate.tools/', icon: '📄', cat: 'Outils sans envoi', desc: 'PDF, images, QR, JSON — dans le navigateur' },
    { id: 'neverupload', name: 'NeverUpload', url: 'https://neverupload.lol/', icon: '🛡', cat: 'Outils sans envoi', desc: '500+ outils : PDF, vidéo, OCR, fond détouré' },
    { id: 'animg', name: 'Aimg', url: 'https://animg.vercel.app/', icon: '🖼', cat: 'Outils sans envoi', desc: 'Images : détourage, favicon, GIF, filigrane' },
    { id: 'opensourceui', name: 'Opensource UI', url: 'https://opensourceui.in/', icon: '📱', cat: 'Interfaces open source', desc: 'Maquettes d\'appareils, composants React' },
    { id: 'pinui', name: 'PinUI', url: 'https://pinui.xyz/', icon: '📌', cat: 'Interfaces open source', desc: 'Composants d\'interface' },
    { id: 'wensity', name: 'Wensity UI', url: 'https://ui.wensity.com/', icon: '🧩', cat: 'Interfaces open source', desc: 'Composants d\'interface' },
    { id: 'easyui', name: 'EasyUI', url: 'https://easyui.site/', icon: '✨', cat: 'Interfaces open source', desc: 'Blocs et composants' },
    { id: 'wobli', name: 'Wobli', url: 'https://wobli.space/', icon: '🌀', cat: 'Interfaces open source', desc: 'Interfaces et animations' },
    { id: 'ryanaque', name: 'Ryan Aque', url: 'https://ryanaque.com/', icon: '🎛', cat: 'Interfaces open source', desc: 'Composants et expériences web' },
    { id: 'nexvyn', name: 'Nexvyn UI', url: 'https://crazyui.vercel.app/', icon: '🎚', cat: 'Interfaces open source', desc: 'Composants soignés, animations' },
  ];
  /* Profils créatifs : [id, icône, libellé, nom du dossier, mots repérés dans le métier / la bio / les tags]. */
  const PROFILES = [
    ['graphiste', '🎨', 'Graphiste', 'Graphisme', /graphi|logo|branding|identit[ée] visuelle|miniature|thumbnail|affiche|print|typo|packaging/],
    ['photo', '📷', 'Photographe', 'Photo', /photo|portrait|shooting|retouche/],
    ['video', '🎬', 'Vidéaste', 'Vidéo', /vid[ée]o|monteu|montage|film|youtube|r[ée]alisat|clip|cadreu/],
    ['3d', '🧊', '3D', '3D', /(^|[^a-z0-9])3d([^a-z]|$)|blender|cinema ?4d|c4d|mod[ée]li|rendu|render/],
    ['motion', '🌀', 'Motion design', 'Motion', /motion|anim/],
    ['uiux', '📱', 'UI / UX', 'UI / UX', /(^|[^a-z])(ui|ux)([^a-z]|$)|interface|web ?design|webdesign|application/],
    ['illustration', '✏️', 'Illustration', 'Illustration', /illustr|dessin|concept art|peint|manga|(^|[^a-z])bd([^a-z]|$)/],
    ['audio', '🎧', 'Son & musique', 'Son', /musique|musicien|audio|beatmak|compositeur|sound|(^|[^a-z])son([^a-z]|$)/],
  ];
  const PROFILE_IDS = PROFILES.map(p => p[0]);
  /* Outils gratuits, la plupart open source, proposés selon le profil. */
  const RECO = [
    { id: 'r-photopea', name: 'Photopea', url: 'https://www.photopea.com/', icon: '🖌', desc: 'Retouche façon Photoshop, dans le navigateur', for: ['graphiste', 'photo', 'illustration'] },
    { id: 'r-penpot', name: 'Penpot', url: 'https://penpot.app/', icon: '🧭', desc: 'Design d’interfaces open source', for: ['uiux', 'graphiste'] },
    { id: 'r-inkscape', name: 'Inkscape', url: 'https://inkscape.org/', icon: '✒', desc: 'Dessin vectoriel open source', for: ['graphiste', 'illustration'] },
    { id: 'r-gimp', name: 'GIMP', url: 'https://www.gimp.org/', icon: '🐾', desc: 'Retouche d’images open source', for: ['graphiste', 'photo'] },
    { id: 'r-krita', name: 'Krita', url: 'https://krita.org/', icon: '🖍', desc: 'Peinture numérique open source', for: ['illustration', 'graphiste'] },
    { id: 'r-coolors', name: 'Coolors', url: 'https://coolors.co/', icon: '🎨', desc: 'Générateur de palettes', for: ['graphiste', 'uiux', 'illustration'] },
    { id: 'r-gfonts', name: 'Google Fonts', url: 'https://fonts.google.com/', icon: '🔤', desc: 'Polices libres', for: ['graphiste', 'uiux'] },
    { id: 'r-fontshare', name: 'Fontshare', url: 'https://www.fontshare.com/', icon: '🅰', desc: 'Polices professionnelles gratuites', for: ['graphiste', 'uiux'] },
    { id: 'r-squoosh', name: 'Squoosh', url: 'https://squoosh.app/', icon: '🗜', desc: 'Compression d’images open source', for: ['photo', 'graphiste', 'uiux'] },
    { id: 'r-upscayl', name: 'Upscayl', url: 'https://upscayl.org/', icon: '🔍', desc: 'Agrandir une image par IA, open source', for: ['photo', 'graphiste'] },
    { id: 'r-darktable', name: 'darktable', url: 'https://www.darktable.org/', icon: '🎞', desc: 'Développement RAW open source', for: ['photo'] },
    { id: 'r-rawtherapee', name: 'RawTherapee', url: 'https://www.rawtherapee.com/', icon: '🌄', desc: 'Traitement RAW open source', for: ['photo'] },
    { id: 'r-digikam', name: 'digiKam', url: 'https://www.digikam.org/', icon: '🗂', desc: 'Gestion de photothèque open source', for: ['photo'] },
    { id: 'r-kdenlive', name: 'Kdenlive', url: 'https://kdenlive.org/', icon: '🎬', desc: 'Montage vidéo open source', for: ['video'] },
    { id: 'r-shotcut', name: 'Shotcut', url: 'https://shotcut.org/', icon: '✂', desc: 'Montage vidéo open source', for: ['video'] },
    { id: 'r-handbrake', name: 'HandBrake', url: 'https://handbrake.fr/', icon: '🍹', desc: 'Convertir et compresser des vidéos', for: ['video', 'motion'] },
    { id: 'r-obs', name: 'OBS Studio', url: 'https://obsproject.com/', icon: '⏺', desc: 'Enregistrement d’écran et streaming', for: ['video', 'audio'] },
    { id: 'r-blender', name: 'Blender', url: 'https://www.blender.org/', icon: '🧊', desc: '3D, animation, rendu — open source', for: ['3d', 'motion', 'video'] },
    { id: 'r-polyhaven', name: 'Poly Haven', url: 'https://polyhaven.com/', icon: '🌐', desc: 'HDRI, textures et modèles libres', for: ['3d'] },
    { id: 'r-ambientcg', name: 'ambientCG', url: 'https://ambientcg.com/', icon: '🧱', desc: 'Matériaux PBR libres (CC0)', for: ['3d'] },
    { id: 'r-synfig', name: 'Synfig', url: 'https://www.synfig.org/', icon: '🌀', desc: 'Animation 2D open source', for: ['motion', 'illustration'] },
    { id: 'r-lottiefiles', name: 'LottieFiles', url: 'https://lottiefiles.com/', icon: '💫', desc: 'Animations Lottie pour le web', for: ['motion', 'uiux'] },
    { id: 'r-excalidraw', name: 'Excalidraw', url: 'https://excalidraw.com/', icon: '✏', desc: 'Tableau blanc, croquis rapides', for: ['uiux', 'illustration'] },
    { id: 'r-lucide', name: 'Lucide', url: 'https://lucide.dev/', icon: '◇', desc: 'Icônes open source', for: ['uiux', 'graphiste'] },
    { id: 'r-audacity', name: 'Audacity', url: 'https://www.audacityteam.org/', icon: '🎙', desc: 'Édition audio open source', for: ['audio', 'video'] },
    { id: 'r-lmms', name: 'LMMS', url: 'https://lmms.io/', icon: '🎹', desc: 'Composition musicale open source', for: ['audio'] },
    { id: 'r-freesound', name: 'Freesound', url: 'https://freesound.org/', icon: '🔊', desc: 'Bruitages et sons libres', for: ['audio', 'video', 'motion'] },
  ];
  const LINKS_KEY = 'hub_shortcuts';
  /** Adresse acceptée : https uniquement, sans identifiants, 300 caractères max. */
  function safeUrl(v) {
    let s = String(v || '').trim(); if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try { const u = new URL(s); if (u.protocol !== 'https:' || u.username || u.password || s.length > 300) return ''; return u.href; } catch { return ''; }
  }
  const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const low = s => String(s || '').trim().toLocaleLowerCase('fr');
  const arr = v => Array.isArray(v) ? v : [];
  const linkStore = () => {
    let v = {}; try { v = JSON.parse(localStorage.getItem(LINKS_KEY) || '{}') || {}; } catch {}
    const folders = Array.isArray(v.folders) ? v.folders.filter(f => f && f.id && f.name).map(f => ({ id: String(f.id).slice(0, 40), name: String(f.name).slice(0, 40), closed: !!f.closed, items: arr(f.items).map(String).slice(0, 150) })) : null;
    return { hidden: arr(v.hidden), custom: arr(v.custom), folders, profile: Array.isArray(v.profile) ? v.profile.filter(p => PROFILE_IDS.includes(p)) : null, recoHidden: arr(v.recoHidden).map(String) };
  };
  const linkSave = s => {
    const o = { hidden: [...new Set(s.hidden)].slice(0, 50), custom: s.custom.slice(0, 80) };
    if (s.folders) o.folders = s.folders.slice(0, 30);
    if (s.profile) o.profile = s.profile;
    if (s.recoHidden && s.recoHidden.length) o.recoHidden = [...new Set(s.recoHidden)].slice(0, 60);
    try { localStorage.setItem(LINKS_KEY, JSON.stringify(o)); return true; } catch { return false; }
  };
  /** Raccourcis visibles (défauts non masqués + personnels revalidés), par id. */
  function pool(s) {
    const custom = s.custom.map(c => ({ id: String(c.id), name: String(c.name || '').slice(0, 60), url: safeUrl(c.url), icon: String(c.icon || '').slice(0, 4), cat: String(c.cat || 'Mes raccourcis').slice(0, 40), desc: String(c.desc || '').slice(0, 100), custom: true })).filter(c => c.name && c.url);
    return new Map([...DEFAULT_LINKS.filter(d => !s.hidden.includes(d.id)).map(d => [d.id, { ...d }]), ...custom.map(c => [c.id, c])]);
  }
  const slug = s => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'dossier';
  /** Dossiers avec leurs raccourcis. Ordre enregistré, puis les nouveaux rangés par catégorie. */
  function layout(s) {
    const p = pool(s), used = new Set();
    const out = (s.folders || []).map(f => ({ id: f.id, name: f.name, closed: f.closed, items: f.items.map(id => { if (used.has(id) || !p.has(id)) return null; used.add(id); return p.get(id); }).filter(Boolean) }));
    for (const l of p.values()) {
      if (used.has(l.id)) continue;
      let f = out.find(x => low(x.name) === low(l.cat));
      if (!f) { let id = 'f-' + slug(l.cat); while (out.some(x => x.id === id)) id += '-'; f = { id, name: l.cat, closed: false, items: [] }; out.push(f); }
      f.items.push(l); used.add(l.id);
    }
    out.forEach(f => f.items.forEach(l => { l.cat = f.name; }));
    return out;
  }
  const persist = (s, folders) => { s.folders = folders.map(f => ({ id: f.id, name: f.name, closed: !!f.closed, items: f.items.map(l => l.id) })); return linkSave(s); };
  /** Profil déduit du métier (référencement), de la bio et des tags des projets. */
  function detectProfile(text) {
    const t = low(text);
    return t ? PROFILES.filter(p => p[4].test(t)).map(p => p[0]) : [];
  }
  function profileText() {
    try {
      const c = (typeof SiteConfig !== 'undefined' && SiteConfig.get()) || {};
      const projects = typeof window.getProjects === 'function' ? window.getProjects() : [];
      return [c.seo && c.seo.jobTitle, c.bio, c.tagline, ...arr(c.projectTags), ...arr(projects).flatMap(p => arr(p && p.tags))].filter(Boolean).join(' · ');
    } catch { return ''; }
  }

  const Links = {
    defaults: DEFAULT_LINKS, profiles: PROFILES.map(p => ({ id: p[0], icon: p[1], label: p[2], folder: p[3] })), catalog: RECO,
    /** Liste affichée, dans l'ordre des dossiers. */
    all() { return layout(linkStore()).flatMap(f => f.items); },
    folders() { return layout(linkStore()); },
    hiddenCount() { return linkStore().hidden.filter(id => DEFAULT_LINKS.some(d => d.id === id)).length; },
    add(x) {
      const url = safeUrl(x.url), name = String(x.name || '').trim().slice(0, 60);
      if (!url || !name) return null;
      const s = linkStore();
      const item = { id: x.id || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, url, icon: String(x.icon || '').trim().slice(0, 4), cat: String(x.cat || '').trim().slice(0, 40) || 'Mes raccourcis', desc: String(x.desc || '').trim().slice(0, 100) };
      const i = s.custom.findIndex(c => c.id === item.id);
      if (i >= 0) s.custom[i] = item; else s.custom.push(item);
      if (!linkSave(s)) return null;
      if (x.folder) this.move(item.id, x.folder, Infinity);
      return item;
    },
    remove(id) {
      const s = linkStore();
      if (DEFAULT_LINKS.some(d => d.id === id)) s.hidden.push(id); else s.custom = s.custom.filter(c => c.id !== id);
      if (s.folders) s.folders.forEach(f => { f.items = f.items.filter(x => x !== id); });
      linkSave(s);
    },
    restore() { const s = linkStore(); s.hidden = []; linkSave(s); },
    open(url) { const u = safeUrl(url); if (u) window.open(u, '_blank', 'noopener,noreferrer'); },

    /* ── dossiers ── */
    addFolder(name) {
      name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40); if (!name) return null;
      const s = linkStore(), fs = layout(s), ex = fs.find(f => low(f.name) === low(name));
      if (ex) return ex.id;
      let id = 'f-' + slug(name); while (fs.some(f => f.id === id)) id += '-';
      fs.push({ id, name, closed: false, items: [] }); persist(s, fs); return id;
    },
    renameFolder(id, name) {
      name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40); if (!name) return false;
      const s = linkStore(), fs = layout(s), f = fs.find(x => x.id === id);
      if (!f || fs.some(x => x.id !== id && low(x.name) === low(name))) return false;
      f.name = name; s.custom.forEach(c => { if (f.items.some(l => l.id === String(c.id))) c.cat = name; });
      return persist(s, fs);
    },
    /** Supprime un dossier : ses raccourcis passent dans le dossier voisin (rien n'est perdu). */
    removeFolder(id) {
      const s = linkStore(), fs = layout(s), i = fs.findIndex(x => x.id === id);
      if (i < 0) return false;
      const [f] = fs.splice(i, 1);
      if (f.items.length) {
        if (!fs.length) fs.push({ id: 'f-mes-raccourcis', name: 'Mes raccourcis', closed: false, items: [] });
        const to = fs[Math.max(0, i - 1)]; to.items.push(...f.items);
        s.custom.forEach(c => { if (f.items.some(l => l.id === String(c.id))) c.cat = to.name; });
      }
      return persist(s, fs);
    },
    toggleFolder(id) { const s = linkStore(), fs = layout(s), f = fs.find(x => x.id === id); if (!f) return; f.closed = !f.closed; persist(s, fs); },
    moveFolder(id, to) {
      const s = linkStore(), fs = layout(s), i = fs.findIndex(x => x.id === id); if (i < 0) return false;
      const [f] = fs.splice(i, 1); fs.splice(Math.max(0, Math.min(fs.length, to)), 0, f); return persist(s, fs);
    },
    /** Déplace un raccourci dans un dossier, à une position (fin si Infinity). */
    move(linkId, folderId, index) {
      const s = linkStore(), fs = layout(s), to = fs.find(f => f.id === folderId); if (!to) return false;
      let item = null;
      fs.forEach(f => { const k = f.items.findIndex(l => l.id === linkId); if (k >= 0) item = f.items.splice(k, 1)[0]; });
      if (!item) return false;
      to.items.splice(Math.max(0, Math.min(to.items.length, Number.isFinite(index) ? index : to.items.length)), 0, item);
      const c = s.custom.find(x => String(x.id) === linkId); if (c) c.cat = to.name;
      return persist(s, fs);
    },

    /* ── profil et recommandations ── */
    detectProfile,
    profile() { const s = linkStore(); return s.profile ? { ids: s.profile, auto: false } : { ids: detectProfile(profileText()), auto: true }; },
    setProfile(ids) { const s = linkStore(); s.profile = Array.isArray(ids) ? [...new Set(ids)].filter(p => PROFILE_IDS.includes(p)) : null; linkSave(s); },
    recommend(ids, limit) {
      const s = linkStore(), have = new Set([...pool(s).values()].map(l => hostOf(l.url)));
      const want = new Set(ids || this.profile().ids);
      if (!want.size) return [];
      return RECO.map(r => ({ r, n: r.for.filter(f => want.has(f)).length }))
        .filter(x => x.n && !have.has(hostOf(x.r.url)) && !s.recoHidden.includes(x.r.id))
        .sort((a, b) => b.n - a.n).slice(0, limit || 8).map(x => x.r);
    },
    /** Ajoute une recommandation dans le dossier de son profil (créé au besoin). */
    addReco(id, ids) {
      const r = RECO.find(x => x.id === id); if (!r) return null;
      const want = ids || this.profile().ids, p = PROFILES.find(x => r.for.includes(x[0]) && want.includes(x[0])) || PROFILES.find(x => x[0] === r.for[0]);
      const folder = this.addFolder(p ? p[3] : 'Mes raccourcis');
      return this.add({ name: r.name, url: r.url, icon: r.icon, desc: r.desc, cat: p ? p[3] : '', folder });
    },
    dismissReco(id) { const s = linkStore(); s.recoHidden.push(String(id)); linkSave(s); },
    resetReco() { const s = linkStore(); s.recoHidden = []; linkSave(s); },
  };

  /* Glisser-déposer des raccourcis : maintien puis glisser, comme les projets
     dans l'éditeur (la carte décolle et suit le pointeur, une place fantôme
     montre où elle atterrira). Souris : décolle après 6 px ; tactile : après
     un appui de 260 ms (sinon le défilement reste normal). */
  function bindDrag(panel, onDrop) {
    let st = null;
    const clear = () => {
      if (!st) return;
      clearTimeout(st.timer);
      if (st.ghost) st.ghost.remove();
      if (st.el) st.el.classList.remove('lk-ph');
      panel.classList.remove('lk-dragging');
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true);
      st = null;
    };
    const lift = () => {
      const r = st.el.getBoundingClientRect();
      const g = st.el.cloneNode(true); g.className = 'lk-it lk-ghost'; g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
      st.dx = st.x - r.left; st.dy = st.y - r.top; st.ghost = g; document.body.appendChild(g);
      st.el.classList.add('lk-ph'); panel.classList.add('lk-dragging'); st.lifted = true; place(st.x, st.y);
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
    };
    const place = (x, y) => {
      st.ghost.style.transform = `translate(${x - st.dx}px,${y - st.dy}px) rotate(-1.5deg)`;
      const under = document.elementFromPoint(x, y); if (!under) return;
      const it = under.closest('.lk-it:not(.lk-ghost)'), grid = under.closest('[data-grid]') || (under.closest('.lk-cat') && under.closest('.lk-cat').querySelector('[data-grid]'));
      if (it && it !== st.el && panel.contains(it)) {
        const r = it.getBoundingClientRect(), after = (y > r.bottom - 4) || (y >= r.top && x > r.left + r.width / 2);
        it.parentNode.insertBefore(st.el, after ? it.nextSibling : it);
      } else if (grid && panel.contains(grid) && !grid.contains(st.el)) {
        grid.insertBefore(st.el, grid.querySelector('.lk-dropzone'));
      }
    };
    const move = ev => {
      if (!st) return;
      if (!st.lifted) {
        if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > (st.touch ? 10 : 6)) { if (st.touch) return clear(); lift(); } else return;
      }
      ev.preventDefault(); place(ev.clientX, ev.clientY);
    };
    const up = () => {
      if (!st) return;
      if (st.lifted) {
        const grid = st.el.closest('[data-grid]'), idx = [...grid.querySelectorAll('.lk-it')].indexOf(st.el), id = st.el.dataset.id;
        panel._lkJustDragged = Date.now(); clear(); onDrop(id, grid.dataset.grid, idx);
      } else clear();
    };
    const cancel = () => clear();
    panel.addEventListener('pointerdown', ev => {
      const el = ev.target.closest('.lk-it'); if (!el || !el.dataset.id || ev.button > 0 || ev.target.closest('.lk-act')) return;
      clear();
      st = { el, x: ev.clientX, y: ev.clientY, touch: ev.pointerType !== 'mouse', lifted: false };
      if (st.touch) st.timer = setTimeout(() => { if (st && !st.lifted) lift(); }, 260);
      document.addEventListener('pointermove', move, { capture: true, passive: false }); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
    });
    // Un appui long ne doit pas ouvrir le menu du navigateur pendant le geste.
    panel.addEventListener('contextmenu', ev => { if (st && st.touch) ev.preventDefault(); });
  }

  const Toolbox = {
    _file: null, _tab: 'links',
    render() {
      const root = document.getElementById('tools-root'); if (!root) return;
      const tabs = [['links', '🔗', 'Raccourcis'], ['image', '🖼', 'Image'], ['palette', '🎨', 'Palette'], ['contrast', '◐', 'Contraste'], ['qr', '▦', 'QR code']];
      root.innerHTML = `<div class="tb-tabs" role="tablist">${tabs.map(([k, i, l]) => `<button type="button" role="tab" aria-selected="${this._tab === k}" class="${this._tab === k ? 'on' : ''}" onclick="Toolbox.go('${k}')">${i} ${l}</button>`).join('')}${this._tab === 'links' ? '<span class="tb-safe">Ouvre les projets open source dans un nouvel onglet</span>' : '<span class="tb-safe">🔒 Rien n’est envoyé : tout reste sur cet appareil</span>'}</div><div class="gc tb-panel" id="tb-panel"></div>`;
      this['_' + this._tab]();
    },
    go(tab) { this._tab = tab; this.render(); },

    /* ── Raccourcis ── */
    _links(editId) {
      const p = document.getElementById('tb-panel');
      const folders = Links.folders(), all = folders.flatMap(f => f.items);
      const editing = editId ? all.find(l => l.id === editId && l.custom) : null;
      const prof = Links.profile(), recos = Links.recommend(prof.ids, 6);
      const pastille = l => l.icon ? e(l.icon) : e((l.name || '?').charAt(0).toUpperCase());
      const card = l => `<div class="lk-it" data-id="${e(l.id)}"><button type="button" class="lk-open" data-open="${e(l.id)}" title="Ouvrir ${e(hostOf(l.url))} dans un nouvel onglet — maintiens pour déplacer"><span class="lk-ic">${pastille(l)}</span><span class="lk-tx"><b>${e(l.name)}</b><small>${e(l.desc || hostOf(l.url))}</small></span><span class="lk-go">↗</span></button>
            <span class="lk-act">${l.custom ? `<button type="button" data-edit="${e(l.id)}" title="Modifier" aria-label="Modifier ${e(l.name)}">✎</button>` : ''}<button type="button" data-del="${e(l.id)}" title="${l.custom ? 'Supprimer' : 'Retirer'}" aria-label="${l.custom ? 'Supprimer' : 'Retirer'} ${e(l.name)}">✕</button></span></div>`;
      const profile = `<div class="lk-prof"><div class="lk-prof-h"><b>✨ Pour ton profil</b><small>${prof.ids.length ? (prof.auto ? 'déduit de ton métier et de tes tags — choisis pour ajuster' : 'choisi par toi') : 'choisis ce que tu fais pour recevoir des outils adaptés'}</small></div>
          <div class="lk-chips" role="group" aria-label="Ton profil">${Links.profiles.map(x => `<button type="button" class="lk-chip${prof.ids.includes(x.id) ? ' on' : ''}" data-prof="${x.id}" aria-pressed="${prof.ids.includes(x.id)}">${x.icon} ${e(x.label)}</button>`).join('')}${prof.auto ? '' : '<button type="button" class="lk-chip lk-chip-auto" data-prof-auto title="Revenir à la détection automatique">↺ Auto</button>'}</div>
          ${recos.length ? `<div class="lk-reco">${recos.map(r => `<div class="lk-rc"><span class="lk-ic">${e(r.icon)}</span><span class="lk-tx"><b>${e(r.name)}</b><small>${e(r.desc)}</small></span>
              <button type="button" class="lk-rc-b" data-reco-open="${e(r.id)}" title="Ouvrir ${e(hostOf(r.url))}" aria-label="Ouvrir ${e(r.name)}">↗</button><button type="button" class="lk-rc-b lk-rc-add" data-reco-add="${e(r.id)}" title="Ajouter à mes raccourcis">＋</button><button type="button" class="lk-rc-x" data-reco-x="${e(r.id)}" title="Ne plus proposer" aria-label="Ne plus proposer ${e(r.name)}">✕</button></div>`).join('')}</div>`
            : prof.ids.length ? '<p class="lk-empty">Tout ce qu’on te recommande est déjà dans tes raccourcis ✓</p>' : ''}</div>`;
      const folderHtml = (f, i) => `<section class="lk-cat${f.closed ? ' closed' : ''}" data-folder="${e(f.id)}">
          <div class="lk-fh"><button type="button" class="lk-fold" data-fold="${e(f.id)}" aria-expanded="${!f.closed}" title="${f.closed ? 'Déplier' : 'Replier'}">▾</button>
            <b class="lk-fname">${e(f.name)}</b><span class="lk-n">${f.items.length}</span>
            <span class="lk-fact"><button type="button" data-fup="${e(f.id)}" title="Monter le dossier" aria-label="Monter ${e(f.name)}"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" data-fdown="${e(f.id)}" title="Descendre le dossier" aria-label="Descendre ${e(f.name)}"${i === folders.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-fren="${e(f.id)}" title="Renommer" aria-label="Renommer ${e(f.name)}">✎</button><button type="button" data-fdel="${e(f.id)}" title="Supprimer le dossier (les raccourcis sont gardés)" aria-label="Supprimer le dossier ${e(f.name)}">🗑</button></span></div>
          <div class="lk-grid" data-grid="${e(f.id)}">${f.items.map(card).join('')}<div class="lk-dropzone">Dépose un raccourci ici</div></div></section>`;
      p.innerHTML = profile
        + `<div class="lk-bar"><button type="button" class="btn btn-ghost" style="font-size:10px" data-newfolder>📁 Nouveau dossier</button><span class="lk-tip">Maintiens un raccourci puis glisse-le pour le ranger ou le déplacer.</span></div>`
        + `<div id="lk-folders">${folders.map(folderHtml).join('')}</div>`
        + `<form class="lk-form" id="lk-form" autocomplete="off"><div class="lk-h">${editing ? '✎ Modifier « ' + e(editing.name) + ' »' : '＋ Ajouter un raccourci'}</div>
            <div class="lk-fields"><input class="prop-input" id="lk-name" maxlength="60" placeholder="Nom *" value="${e(editing ? editing.name : '')}">
              <input class="prop-input" id="lk-url" maxlength="300" placeholder="Adresse * (https://…)" value="${e(editing ? editing.url : '')}">
              <input class="prop-input" id="lk-icon" maxlength="4" placeholder="Icône (emoji)" value="${e(editing ? editing.icon : '')}">
              <select class="prop-input" id="lk-folder" aria-label="Dossier">${folders.map(f => `<option value="${e(f.id)}"${editing && f.items.some(l => l.id === editing.id) ? ' selected' : ''}>📁 ${e(f.name)}</option>`).join('')}<option value="__new">＋ Nouveau dossier…</option></select>
              <input class="prop-input" id="lk-desc" maxlength="100" placeholder="Description (facultatif)" value="${e(editing ? editing.desc : '')}"></div>
            <div class="sys-row"><button type="submit" class="btn btn-accent" style="font-size:10px">${editing ? 'Enregistrer' : 'Ajouter'}</button>${editing ? '<button type="button" class="btn btn-ghost" style="font-size:10px" data-cancel>Annuler</button>' : ''}
              ${Links.hiddenCount() ? `<button type="button" class="btn btn-ghost" style="font-size:10px" data-restore>${Links.hiddenCount() === 1 ? 'Rétablir le raccourci retiré' : 'Rétablir les ' + Links.hiddenCount() + ' raccourcis retirés'}</button>` : ''}</div></form>`;
      const byId = id => all.find(l => l.id === id);
      const redo = () => this._links();
      const askName = (msg, def) => { const v = prompt(msg, def || ''); return v == null ? null : v.trim(); };
      p.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { if (Date.now() - (p._lkJustDragged || 0) < 400) return; const l = byId(b.dataset.open); if (l) Links.open(l.url); });
      p.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { this._links(b.dataset.edit); document.getElementById('lk-name')?.focus(); });
      p.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        const l = byId(b.dataset.del); if (!l) return;
        if (l.custom && !confirm('Supprimer le raccourci « ' + l.name + ' » ?')) return;
        Links.remove(l.id); redo();
        showToast?.(l.custom ? 'Raccourci supprimé' : '« ' + l.name + ' » retiré — rétablissable en bas de page', '#666', 2200);
      });
      p.querySelectorAll('[data-prof]').forEach(b => b.onclick = () => {
        const cur = Links.profile().ids, id = b.dataset.prof;
        Links.setProfile(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]); redo();
      });
      p.querySelector('[data-prof-auto]')?.addEventListener('click', () => { Links.setProfile(null); redo(); });
      p.querySelectorAll('[data-reco-open]').forEach(b => b.onclick = () => { const r = Links.catalog.find(x => x.id === b.dataset.recoOpen); if (r) Links.open(r.url); });
      p.querySelectorAll('[data-reco-add]').forEach(b => b.onclick = () => { const it = Links.addReco(b.dataset.recoAdd); redo(); if (it) showToast?.('« ' + it.name + ' » ajouté dans « ' + it.cat + ' » ✓', 'var(--green)', 2000); });
      p.querySelectorAll('[data-reco-x]').forEach(b => b.onclick = () => { Links.dismissReco(b.dataset.recoX); redo(); });
      p.querySelector('[data-newfolder]').onclick = () => { const n = askName('Nom du nouveau dossier'); if (n && Links.addFolder(n)) { redo(); showToast?.('Dossier « ' + n + ' » créé — glisse des raccourcis dedans', 'var(--green)', 2200); } };
      p.querySelectorAll('[data-fold]').forEach(b => b.onclick = () => { Links.toggleFolder(b.dataset.fold); redo(); });
      p.querySelectorAll('[data-fup],[data-fdown]').forEach(b => b.onclick = () => {
        const id = b.dataset.fup || b.dataset.fdown, i = folders.findIndex(f => f.id === id);
        Links.moveFolder(id, b.dataset.fup ? i - 1 : i + 1); redo();
      });
      p.querySelectorAll('[data-fren]').forEach(b => b.onclick = () => {
        const f = folders.find(x => x.id === b.dataset.fren); const n = f && askName('Nouveau nom du dossier', f.name);
        if (n && !Links.renameFolder(f.id, n)) showToast?.('Un dossier porte déjà ce nom', '#e4b24a', 2000); redo();
      });
      p.querySelectorAll('[data-fdel]').forEach(b => b.onclick = () => {
        const f = folders.find(x => x.id === b.dataset.fdel); if (!f) return;
        if (f.items.length && !confirm('Supprimer le dossier « ' + f.name + ' » ? Ses ' + f.items.length + ' raccourci(s) passent dans le dossier voisin.')) return;
        Links.removeFolder(f.id); redo();
      });
      p.querySelector('[data-cancel]')?.addEventListener('click', redo);
      p.querySelector('[data-restore]')?.addEventListener('click', () => { Links.restore(); redo(); });
      p.querySelector('#lk-folder').onchange = ev => {
        if (ev.target.value !== '__new') return;
        const n = askName('Nom du nouveau dossier'); const id = n && Links.addFolder(n);
        if (!id) { ev.target.selectedIndex = 0; return; }
        ev.target.insertAdjacentHTML('afterbegin', `<option value="${e(id)}">📁 ${e(n)}</option>`); ev.target.value = id;
      };
      p.querySelector('#lk-form').onsubmit = ev => {
        ev.preventDefault();
        const v = id => document.getElementById(id).value;
        const folder = v('lk-folder') === '__new' ? '' : v('lk-folder'), fname = (folders.find(f => f.id === folder) || {}).name || '';
        const item = Links.add({ id: editing ? editing.id : undefined, name: v('lk-name'), url: v('lk-url'), icon: v('lk-icon'), cat: fname, desc: v('lk-desc'), folder });
        if (!item) return showToast?.('Nom et adresse https valides requis', '#c0392b', 2500);
        redo(); showToast?.('Raccourci « ' + item.name + ' » ' + (editing ? 'modifié' : 'ajouté') + ' ✓', 'var(--green)', 1800);
      };
      if (!p._lkDrag) { p._lkDrag = true; bindDrag(p, (id, folder, idx) => { Links.move(id, folder, idx); this._links(); }); }
    },
    _drop(accept, label) {
      return `<label class="tb-drop" id="tb-drop"><input type="file" id="tb-file" accept="${accept}" hidden><b>${label}</b><small>ou glisse un fichier ici</small></label>`;
    },
    _bindDrop(onFile) {
      const d = document.getElementById('tb-drop'), f = document.getElementById('tb-file'); if (!d || !f) return;
      f.onchange = () => f.files[0] && onFile(f.files[0]);
      d.addEventListener('dragover', ev => { ev.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', ev => { ev.preventDefault(); d.classList.remove('over'); const x = ev.dataTransfer.files[0]; if (x) onFile(x); });
    },

    /* ── Image ── */
    _image() {
      const p = document.getElementById('tb-panel');
      p.innerHTML = `${this._drop('image/*', '🖼 Choisir une image')}
        <div class="tb-grid"><label class="biz-f"><span>Format</span><select class="prop-input" id="tb-fmt"><option value="image/webp">WebP (le plus léger)</option><option value="image/jpeg">JPG</option><option value="image/png">PNG (sans perte)</option></select></label>
          <label class="biz-f"><span>Largeur max (px, vide = d'origine)</span><input class="prop-input" id="tb-w" type="number" min="16" max="8000" placeholder="1600"></label>
          <label class="biz-f"><span>Qualité <b id="tb-qv">82</b> %</span><input id="tb-q" type="range" min="40" max="100" value="82"></label>
          <label class="biz-f"><span>Filigrane (facultatif)</span><input class="prop-input" id="tb-wm" maxlength="60" placeholder="© Souanpt"></label></div>
        <div class="tb-out" id="tb-out"><p class="sys-sub">Les métadonnées (appareil, date, position GPS) sont retirées au réencodage.</p></div>`;
      const q = document.getElementById('tb-q'); q.oninput = () => { document.getElementById('tb-qv').textContent = q.value; };
      this._bindDrop(file => this.processImage(file));
    },
    async processImage(file) {
      const out = document.getElementById('tb-out');
      let src; try { src = await readImage(file); } catch (err) { out.innerHTML = `<p class="bad">${e(err.message)}</p>`; return; }
      const { img, url } = src;
      const type = document.getElementById('tb-fmt').value, q = (+document.getElementById('tb-q').value || 82) / 100;
      const [w, h] = fit(img.naturalWidth, img.naturalHeight, document.getElementById('tb-w').value);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
      g.drawImage(img, 0, 0, w, h);
      const wm = document.getElementById('tb-wm').value.trim();
      if (wm) {
        const fs = Math.max(12, Math.round(w / 28));
        g.font = `700 ${fs}px system-ui, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.lineWidth = Math.max(2, fs / 8); g.strokeStyle = 'rgba(0,0,0,.45)'; g.fillStyle = 'rgba(255,255,255,.85)';
        g.strokeText(wm, w - fs * .7, h - fs * .6); g.fillText(wm, w - fs * .7, h - fs * .6);
      }
      URL.revokeObjectURL(url);
      c.toBlob(blob => {
        if (!blob) { out.innerHTML = '<p class="bad">Ce format n\'est pas pris en charge par ce navigateur.</p>'; return; }
        const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[type];
        const name = String(file.name || 'image').replace(/\.[^.]+$/, '') + (wm ? '-filigrane' : '') + '.' + ext;
        const gain = Math.round((1 - blob.size / file.size) * 100);
        out.innerHTML = `<div class="tb-res"><img src="${URL.createObjectURL(blob)}" alt="Aperçu"><div><b>${e(name)}</b>
          <span>${img.naturalWidth}×${img.naturalHeight} → ${w}×${h}</span><span>${kb(file.size)} → <b>${kb(blob.size)}</b>${gain > 0 ? ` (−${gain} %)` : gain < 0 ? ` (+${-gain} %)` : ''}</span>
          <button type="button" class="btn btn-accent" style="font-size:10px" id="tb-dl">⬇ Télécharger</button></div></div>`;
        document.getElementById('tb-dl').onclick = () => download(blob, name);
      }, type, q);
    },

    /* ── Palette ── */
    _palette() {
      const p = document.getElementById('tb-panel');
      p.innerHTML = `${this._drop('image/*', '🎨 Choisir une image (logo, visuel, photo)')}<div class="tb-out" id="tb-out"></div>`;
      this._bindDrop(async file => {
        const out = document.getElementById('tb-out');
        let src; try { src = await readImage(file); } catch (err) { out.innerHTML = `<p class="bad">${e(err.message)}</p>`; return; }
        const [w, h] = fit(src.img.naturalWidth, src.img.naturalHeight, 200);
        const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(src.img, 0, 0, w, h);
        URL.revokeObjectURL(src.url);
        const cols = palette(g.getImageData(0, 0, w, h).data, 6);
        out.innerHTML = `<div class="tb-pal">${cols.map(col => `<div class="tb-sw"><button type="button" style="background:${col}" title="Copier ${col}" data-copy="${col}"></button><code>${col}</code><button type="button" class="btn btn-ghost" style="font-size:9px" data-accent="${col}">Couleur du site</button></div>`).join('')}</div>`;
        out.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); showToast?.(b.dataset.copy + ' copié ✓', 'var(--green)', 1500); } catch {} });
        out.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => this.useAccent(b.dataset.accent));
      });
    },
    useAccent(col) {
      if (!/^#[0-9A-F]{6}$/i.test(col)) return;
      if (!confirm('Utiliser ' + col + ' comme couleur principale du site et du tableau de bord ?')) return;
      try { SiteConfig.set('accentColor', col); window.HubAccent && HubAccent.apply(col); if (typeof SiteAutoPublish !== 'undefined') SiteAutoPublish.queue(); } catch {}
      showToast?.('Couleur du site : ' + col + ' ✓', 'var(--green)', 2200);
    },

    /* ── Contraste ── */
    _contrast() {
      const acc = (window.hubAccentHex && hubAccentHex()) || '#C8FF00';
      const p = document.getElementById('tb-panel');
      p.innerHTML = `<div class="tb-grid"><label class="biz-f"><span>Texte</span><input type="color" id="tb-fg" value="#060606"></label><label class="biz-f"><span>Fond</span><input type="color" id="tb-bg" value="${acc}"></label></div><div class="tb-out" id="tb-out"></div>`;
      const run = () => {
        const fg = document.getElementById('tb-fg').value, bg = document.getElementById('tb-bg').value, r = contrast(fg, bg);
        const ok = (v, t) => `<span class="${r >= t ? 'ok' : 'ko'}">${r >= t ? '✓' : '✗'} ${v}</span>`;
        document.getElementById('tb-out').innerHTML = `<div class="tb-ctr" style="background:${bg};color:${fg}"><b>Aa</b> Texte d'exemple sur ce fond</div>
          <div class="tb-ratio"><b>${r.toFixed(2).replace('.', ',')} : 1</b>${ok('AA texte (4,5)', 4.5)}${ok('AA grand texte (3)', 3)}${ok('AAA (7)', 7)}</div>`;
      };
      p.querySelectorAll('input[type=color]').forEach(i => i.oninput = run); run();
    },

    /* ── QR code ── */
    _qr() {
      const p = document.getElementById('tb-panel');
      p.innerHTML = `<label class="biz-f"><span>Texte ou lien</span><input class="prop-input" id="tb-qrt" maxlength="800" placeholder="https://…" value="${e((SiteConfig.get().siteUrl) || '')}"></label><div class="tb-out tb-qrout" id="tb-out"></div>`;
      const run = () => {
        const t = document.getElementById('tb-qrt').value.trim(), out = document.getElementById('tb-out');
        if (!t) { out.innerHTML = ''; return; }
        let svg = ''; try { const q = qrcode(0, 'M'); q.addData(t); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { out.innerHTML = '<p class="bad">Texte trop long pour un QR code.</p>'; return; }
        out.innerHTML = `<div class="qr-local">${svg}</div><button type="button" class="btn btn-accent" style="font-size:10px;margin-top:10px" onclick="downloadQRPng(document.querySelector('#tb-out svg'))">⬇ PNG</button>`;
      };
      document.getElementById('tb-qrt').oninput = run; run();
    },
  };
  // Calculs exposés pour les tests (noms distincts des onglets _palette / _contrast).
  Toolbox.calc = { luminance, contrast, palette, fit };
  Toolbox.links = Links; Toolbox.safeUrl = safeUrl;
  window.Toolbox = Toolbox;
})();
