/* ══════════════════════════════════════════════════════════════════════════
   BehanceViewer — fenêtre de consultation des projets Behance sur le site.

   Le visiteur clique un projet Behance du portfolio : une fenêtre s'ouvre
   au-dessus du site avec le VRAI projet (intégration officielle Behance,
   https://www.behance.net/embed/project/<id>?ilo0=1), recadré, et habillé des
   effets du PSD de référence (« apercu projet.psd ») :
     · style « perspective » : écran incliné (haut plus étroit), côtés assombris
       par deux dégradés noirs, traînées horizontales floues de la couverture,
       ombre portée noire, flou de profondeur en haut et en bas, grain en
       lumière tamisée 30 %, saturation (calque Vibrance +100) ;
     · style « écran incurvé » : bords arrondis, ombre interne et vignettage
       radial (calques masqués du PSD) — une vraie déformation en barillet du
       contenu Behance est impossible : le navigateur interdit de déformer les
       pixels d'un cadre d'une autre origine ;
     · style « plat » : la fenêtre sans profondeur.

   Séparation stricte : 1. iframe Behance, 2. conteneur de recadrage
   (overflow:hidden + zoom/décalage), 3. effets décoratifs (pointer-events:none,
   ne bloquent ni clic ni défilement), 4. commandes de la fenêtre.

   Le contenu de l'iframe n'est jamais lu ni modifié (même origine) : le
   recadrage se fait autour d'elle. Une seule iframe à la fois, créée à
   l'ouverture et détruite à la fermeture.

   Mode « Aperçu PNG » : image statique enregistrée sur le projet, dans le même
   cadre. À défaut, la couverture du flux RSS sert de secours, annoncée comme
   telle (ce n'est pas une capture du projet).

   UNE implémentation : generateSite() insère css() et runtime() tels quels
   dans le site publié ET dans l'aperçu de l'éditeur.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  const ID_RE = /^\d{5,12}$/;

  /** URL Behance (galerie ou intégration) → identifiant numérique, sinon null. */
  function projectId(url) {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!/^(?:www\.)?behance\.net$/i.test(u.hostname) || u.username || u.password || u.port) return null;
    const m = /^\/(?:gallery|embed\/project)\/(\d{5,12})(?:\/|$)/.exec(u.pathname);
    return m ? m[1] : null;
  }
  /** Seule source d'iframe possible : le format officiel vérifié le 20/11/2026. */
  function embedUrl(id) {
    return ID_RE.test(String(id || '')) ? 'https://www.behance.net/embed/project/' + id + '?ilo0=1' : null;
  }
  /** Code d'intégration collé (Partager → Intégrer) ou URL → identifiant validé.
      Le HTML collé n'est JAMAIS conservé ni injecté : seul l'identifiant l'est. */
  function idFromEmbedCode(code) {
    const s = String(code || '').trim();
    const src = /<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(s);
    return projectId(src ? src[1] : s);
  }

  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const CROP = { desk: { zoom: 1, x: 0, y: 0 }, mob: { zoom: 1, x: 0, y: 0 } };
  /** zoom 1→3 · x -50→50 (% du débord latéral) · y 0→600 px rognés en haut. */
  function sanitizeCrop(c, d) {
    d = d || CROP.desk; c = c && typeof c === 'object' ? c : {};
    return { zoom: Math.round(clamp(c.zoom, 1, 3, d.zoom) * 100) / 100, x: Math.round(clamp(c.x, -50, 50, d.x)), y: Math.round(clamp(c.y, 0, 600, d.y)) };
  }
  function sanitizeCrops(c, d) {
    c = c && typeof c === 'object' ? c : {}; d = d || CROP;
    return { desk: sanitizeCrop(c.desk, d.desk), mob: sanitizeCrop(c.mob, d.mob) };
  }

  const FX_KEYS = ['grain', 'streaks', 'depth', 'vignette', 'glow', 'shadow', 'saturate', 'anim'];
  const DEFAULTS = {
    enabled: false,        // désactivé par défaut : un site déjà publié ne change pas
    display: 'window',     // window | page (vue plein écran)
    mode: 'live',          // live | png (mode initial)
    showLink: true,
    style: 'perspective',  // perspective | curved | flat
    width: 92, height: 86, // % de l'écran (max 1500 px de large)
    radius: 16, border: 1, tilt: 9, backdrop: 92,
    effects: { on: true, intensity: 70, grain: true, streaks: true, depth: true, vignette: true, glow: true, shadow: true, saturate: true, anim: true },
    crop: CROP,
  };
  /** Réglages validés et bornés (aucun CSS ni code libre). */
  function sanitizeConfig(c) {
    c = c && typeof c === 'object' ? c : {};
    const fx = c.effects && typeof c.effects === 'object' ? c.effects : {};
    const effects = { on: fx.on !== false, intensity: Math.round(clamp(fx.intensity, 0, 100, DEFAULTS.effects.intensity)) };
    FX_KEYS.forEach(k => { effects[k] = fx[k] === undefined ? DEFAULTS.effects[k] : !!fx[k]; });
    return {
      enabled: c.enabled === true,
      display: c.display === 'page' ? 'page' : 'window',
      mode: c.mode === 'png' ? 'png' : 'live',
      showLink: c.showLink !== false,
      style: ['perspective', 'curved', 'flat'].includes(c.style) ? c.style : DEFAULTS.style,
      width: Math.round(clamp(c.width, 50, 100, DEFAULTS.width)),
      height: Math.round(clamp(c.height, 40, 100, DEFAULTS.height)),
      radius: Math.round(clamp(c.radius, 0, 40, DEFAULTS.radius)),
      border: Math.round(clamp(c.border, 0, 4, DEFAULTS.border)),
      tilt: Math.round(clamp(c.tilt, 0, 25, DEFAULTS.tilt)),
      backdrop: Math.round(clamp(c.backdrop, 40, 100, DEFAULTS.backdrop)),
      effects,
      crop: sanitizeCrops(c.crop),
    };
  }

  const safeHttp = s => { try { const u = new URL(String(s)); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  const safeImage = s => {
    const v = String(s || '');
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
    return safeHttp(v);
  };
  /** Projet du portfolio → entrée publiée, ou null s'il n'est pas un projet Behance. */
  function projectEntry(p, cfg) {
    if (!p) return null;
    const pv = p.preview && typeof p.preview === 'object' ? p.preview : {};
    const id = (ID_RE.test(String(pv.beId || '')) && String(pv.beId)) || projectId(p.url);
    if (!id) return null;
    return {
      be: id,
      url: safeHttp(p.url) || 'https://www.behance.net/gallery/' + id,
      title: String(p.title || 'Projet').slice(0, 140),
      cover: safeImage(p.cover),
      png: safeImage(pv.png),
      crop: sanitizeCrops(pv.crop, (cfg && cfg.crop) || CROP),
    };
  }
  /** Bloc JSON lu par runtime() — `<` échappé : impossible de fermer la balise. */
  function dataScript(projects, cfg) {
    const c = sanitizeConfig(cfg);
    const map = {};
    (projects || []).forEach(p => { const e = projectEntry(p, c); if (e && p.id != null) map[String(p.id)] = e; });
    if (!c.enabled || !Object.keys(map).length) return '';
    return '<script type="application/json" id="bv-data">'
      + JSON.stringify({ cfg: c, projects: map }).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '') + '</script>';
  }
  /** Le projet s'ouvrira-t-il dans la fenêtre ? (pour câbler la carte) */
  function opensInViewer(p, cfg) { return sanitizeConfig(cfg).enabled && !!projectEntry(p, cfg); }

  /* Grain du PSD (calque « Fond 1 ») : bruit SVG, lumière tamisée. */
  const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  function css() {
    return `
/* ── Fenêtre Behance (js/behance-viewer.js) ── */
#bv{position:fixed;inset:0;z-index:1000;--i:.7;--tilt:9deg;--w:92vw;--h:86vh;--rad:16px;--bd:1px;--back:.92}
#bv[hidden]{display:none}
#bv .bv-back{position:absolute;inset:0;background:rgba(0,0,0,var(--back));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#bv .bv-streak{position:absolute;left:-15%;top:6%;width:130%;height:88%;object-fit:cover;filter:url(#bv-blur-x) saturate(1.3);opacity:calc(var(--i) * .8);pointer-events:none;
  -webkit-mask-image:linear-gradient(90deg,#000 0,#000 18%,transparent 34%,transparent 66%,#000 82%,#000 100%);mask-image:linear-gradient(90deg,#000 0,#000 18%,transparent 34%,transparent 66%,#000 82%,#000 100%)}
#bv .bv-sides{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,#000 0,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 70%,#000 100%);opacity:calc(.35 + var(--i) * .65)}
#bv .bv-stage{position:absolute;left:50%;top:50%;width:min(var(--w),1500px);height:var(--h);transform:translate(-50%,-50%);display:flex;flex-direction:column;gap:10px;perspective:1700px}
#bv .bv-bar{display:flex;align-items:center;gap:8px;min-height:40px;color:#f0ece4;font:600 13px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;position:relative;z-index:3}
#bv .bv-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800;font-size:14px}
#bv .bv-modes{display:flex;padding:3px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12)}
#bv .bv-modes button,#bv .bv-btn{font:inherit;font-size:12px;color:#f0ece4;background:none;border:none;border-radius:999px;padding:7px 12px;cursor:pointer;min-height:34px;white-space:nowrap}
#bv .bv-modes button[aria-pressed="true"]{background:var(--a);color:var(--on-a)}
#bv .bv-btn{border:1px solid rgba(255,255,255,.18);text-decoration:none;display:inline-flex;align-items:center;gap:6px}
#bv .bv-btn:hover,#bv .bv-modes button:hover{border-color:var(--a)}
#bv .bv-x{width:38px;padding:0;justify-content:center;font-size:16px}
#bv button:focus-visible,#bv a:focus-visible{outline:2px solid var(--a);outline-offset:2px}
#bv .bv-screen{position:relative;flex:1;min-height:0;border-radius:var(--rad);overflow:hidden;background:#0c0c0c;transform-origin:50% 60%;
  transform:rotateX(var(--tilt));border:var(--bd) solid var(--a-border,rgba(255,255,255,.18));transition:transform .5s cubic-bezier(.2,.8,.2,1),opacity .35s}
/* Ombre du PSD (calques « Calque 2 ») : noire, taille 29 px × 1,33, contraction 33 %. */
#bv.bv-fx-on.bv-fx-shadow .bv-screen{box-shadow:0 0 39px 13px #000,0 30px 80px rgba(0,0,0,.6)}
#bv.bv-fx-on.bv-fx-glow .bv-screen{box-shadow:0 0 0 1px var(--a-border,transparent),0 0 70px var(--a-glow,transparent)}
#bv.bv-fx-on.bv-fx-shadow.bv-fx-glow .bv-screen{box-shadow:0 0 39px 13px #000,0 0 0 1px var(--a-border,transparent),0 0 70px var(--a-glow,transparent)}
#bv .bv-crop{position:absolute;inset:0;overflow:hidden;--z:1;--x:0;--y:0}
#bv .bv-crop iframe{position:absolute;left:0;top:0;width:100%;height:calc((100% + var(--y) * 1px) / var(--z));border:0;background:#fff;
  transform-origin:50% 0;transform:translate(calc(var(--x) * (var(--z) - 1) * 1%),calc(var(--y) * -1px)) scale(var(--z))}
#bv.bv-fx-on.bv-fx-saturate .bv-crop iframe,#bv.bv-fx-on.bv-fx-saturate .bv-crop img{filter:saturate(calc(1 + var(--i) * .35))}
#bv .bv-crop.bv-png{overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}
#bv .bv-crop.bv-png::-webkit-scrollbar{width:5px}#bv .bv-crop.bv-png::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:3px}
#bv .bv-crop img{display:block;width:calc(100% * var(--z));margin-left:calc((100% - 100% * var(--z)) / 2 + var(--x) * (var(--z) - 1) * 1%);margin-top:calc(var(--y) * -1px);height:auto}
#bv .bv-fx{position:absolute;inset:0;pointer-events:none;z-index:2}
#bv .bv-dof{position:absolute;left:0;right:0;height:16%;backdrop-filter:blur(calc(var(--i) * 6px));-webkit-backdrop-filter:blur(calc(var(--i) * 6px))}
#bv .bv-dof.t{top:0;-webkit-mask-image:linear-gradient(#000,transparent);mask-image:linear-gradient(#000,transparent)}
#bv .bv-dof.b{bottom:0;-webkit-mask-image:linear-gradient(transparent,#000);mask-image:linear-gradient(transparent,#000)}
#bv .bv-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,calc(var(--i) * .9)) 100%)}
#bv .bv-glare{position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,calc(var(--i) * .09)) 0,rgba(255,255,255,0) 38%)}
#bv .bv-grain{position:absolute;inset:0;pointer-events:none;background-image:${GRAIN};background-size:180px;mix-blend-mode:soft-light;opacity:calc(var(--i) * .43);z-index:4}
#bv .bv-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;
  background:#0c0c0c;color:#f0ece4;font:14px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;z-index:1}
#bv .bv-state[hidden]{display:none}
#bv .bv-state p{max-width:420px;color:rgba(240,236,228,.75)}
#bv .bv-spin{width:30px;height:30px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:var(--a);animation:bvspin 1s linear infinite}
#bv .bv-slow{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;
  max-width:calc(100% - 24px);padding:8px 8px 8px 14px;border-radius:14px;background:rgba(8,8,8,.88);border:1px solid rgba(255,255,255,.14);
  color:#f0ece4;font:12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#bv .bv-note{position:absolute;left:12px;bottom:12px;z-index:3;font:600 11px system-ui,sans-serif;color:#f0ece4;background:rgba(0,0,0,.65);padding:5px 9px;border-radius:999px;pointer-events:none}
@keyframes bvspin{to{transform:rotate(360deg)}}
/* style « écran incurvé » : bords arrondis, ombre interne, vignettage fort */
#bv.bv-s-curved .bv-screen{transform:none;border-radius:calc(var(--rad) + 26px)/calc(var(--rad) + 40px)}
#bv.bv-s-curved .bv-vig{background:radial-gradient(ellipse 75% 70% at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,calc(var(--i) * 1.2)) 100%);box-shadow:inset 0 0 calc(var(--i) * 140px) rgba(0,0,0,.9)}
#bv.bv-s-flat .bv-screen{transform:none}
/* vue dédiée : la fenêtre occupe tout l'écran */
#bv.bv-page .bv-stage{width:100vw;height:100vh;height:100dvh;padding:10px 12px 0;transform:translate(-50%,-50%)}
#bv.bv-page .bv-screen{border-radius:12px 12px 0 0;transform:none}
#bv:not(.bv-fx-on) .bv-fx,#bv:not(.bv-fx-on) .bv-grain,#bv:not(.bv-fx-on) .bv-streak{display:none}
#bv:not(.bv-fx-grain) .bv-grain,#bv:not(.bv-fx-streaks) .bv-streak,#bv:not(.bv-fx-depth) .bv-dof,#bv:not(.bv-fx-vignette) .bv-vig{display:none}
/* ouverture / fermeture */
#bv.bv-fx-anim .bv-stage{transition:opacity .35s,transform .45s cubic-bezier(.2,.8,.2,1)}
#bv.bv-fx-anim.bv-enter .bv-stage{opacity:0;transform:translate(-50%,-46%) scale(.94)}
#bv.bv-fx-anim .bv-back,#bv.bv-fx-anim .bv-streak,#bv.bv-fx-anim .bv-sides{transition:opacity .35s}
#bv.bv-fx-anim.bv-enter .bv-back,#bv.bv-fx-anim.bv-enter .bv-streak,#bv.bv-fx-anim.bv-enter .bv-sides{opacity:0}
/* téléphone : lisible avant tout — pas d'inclinaison ni de traînées */
@media (max-width:760px){
  #bv .bv-stage{width:100vw;height:100vh;height:100dvh;padding:8px 8px 0;gap:8px}
  #bv .bv-screen{transform:none;border-radius:12px 12px 0 0}
  #bv .bv-streak,#bv .bv-dof{display:none}
  #bv .bv-title{font-size:13px}
  #bv .bv-btn span{display:none}
}
@media (prefers-reduced-motion:reduce){#bv .bv-stage,#bv .bv-screen,#bv .bv-back{transition:none!important}#bv .bv-spin{animation:none}}
`;
  }

  /* ─── Code navigateur, inséré tel quel dans le site (aucune dépendance) ─── */
  function runtime() {
    var dataEl = document.getElementById('bv-data');
    if (!dataEl) return;
    var D; try { D = JSON.parse(dataEl.textContent); } catch (e) { return; }
    var C = D.cfg, P = D.projects, cur = null, mode = 'live', lastFocus = null, timer = null, closing = null;
    var mq = window.matchMedia ? window.matchMedia('(max-width: 760px)') : { matches: false };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var root = document.createElement('div');
    root.id = 'bv'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'bv-title');
    root.innerHTML = '<div class="bv-back" data-close></div><img class="bv-streak" alt="" aria-hidden="true"><div class="bv-sides"></div>'
      + '<div class="bv-stage"><div class="bv-bar"><div class="bv-title" id="bv-title"></div>'
      + '<div class="bv-modes" role="group" aria-label="Mode d\'affichage"><button type="button" data-mode="live">Behance Live</button><button type="button" data-mode="png">Aperçu PNG</button></div>'
      + '<a class="bv-btn bv-link" target="_blank" rel="noopener noreferrer">↗<span> Voir sur Behance</span></a>'
      + '<button type="button" class="bv-btn bv-x" data-close aria-label="Fermer">✕</button></div>'
      + '<div class="bv-screen"><div class="bv-crop"></div><div class="bv-fx" aria-hidden="true"><div class="bv-dof t"></div><div class="bv-dof b"></div><div class="bv-vig"></div><div class="bv-glare"></div></div>'
      + '<div class="bv-state" hidden></div></div></div><div class="bv-grain" aria-hidden="true"></div>'
      + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="bv-blur-x" x="-20%" width="140%"><feGaussianBlur stdDeviation="56 1.5"/></filter></svg>';
    document.body.appendChild(root);
    var $ = function (s) { return root.querySelector(s); };
    var crop = $('.bv-crop'), state = $('.bv-state'), link = $('.bv-link'), streak = $('.bv-streak');

    function applyCfg() {
      var e = C.effects || {};
      root.className = 'bv-s-' + C.style + (C.display === 'page' ? ' bv-page' : '') + (e.on ? ' bv-fx-on' : '')
        + ['grain', 'streaks', 'depth', 'vignette', 'glow', 'shadow', 'saturate'].map(function (k) { return e[k] ? ' bv-fx-' + k : ''; }).join('')
        + (e.anim && !reduce ? ' bv-fx-anim' : '');
      var s = root.style;
      s.setProperty('--i', String((e.intensity || 0) / 100));
      s.setProperty('--tilt', (C.style === 'perspective' ? C.tilt : 0) + 'deg');
      s.setProperty('--w', C.width + 'vw'); s.setProperty('--h', C.height + 'vh');
      s.setProperty('--rad', C.radius + 'px'); s.setProperty('--bd', C.border + 'px');
      s.setProperty('--back', String(C.backdrop / 100));
      link.hidden = !C.showLink;
    }
    function applyCrop() {
      if (!cur) return;
      var c = (cur.crop && cur.crop[mq.matches ? 'mob' : 'desk']) || { zoom: 1, x: 0, y: 0 };
      crop.style.setProperty('--z', String(c.zoom)); crop.style.setProperty('--x', String(c.x)); crop.style.setProperty('--y', String(c.y));
    }
    function say(html, spin) { state.innerHTML = (spin ? '<div class="bv-spin"></div>' : '') + html; state.hidden = false; }
    function clearFrame() {
      clearTimeout(timer);
      var f = crop.querySelector('iframe'); if (f) { f.src = 'about:blank'; f.remove(); }
      crop.innerHTML = ''; crop.classList.remove('bv-png');
      var n = $('.bv-note'); if (n) n.remove();
      var s = $('.bv-slow'); if (s) s.remove();
    }
    function behanceBtn() { return C.showLink ? '<a class="bv-btn" href="' + cur.url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">↗ Voir sur Behance</a>' : ''; }
    function setMode(m) {
      if (!cur) return;
      mode = m === 'png' ? 'png' : 'live';
      root.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
      clearFrame(); applyCrop();
      if (mode === 'live') {
        say('<p>Chargement du projet Behance…</p>', true);
        var f = document.createElement('iframe');
        f.title = cur.title + ' — Behance';
        f.src = 'https://www.behance.net/embed/project/' + cur.be + '?ilo0=1';
        f.setAttribute('allowfullscreen', '');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        // « load » attend toutes les images du projet : s'il arrive après la
        // barre de repli, celle-ci n'a plus lieu d'être.
        f.onload = function () { clearTimeout(timer); state.hidden = true; var s = $('.bv-slow'); if (s) s.remove(); };
        /* L'événement « load » d'une intégration Behance n'est pas fiable (il
           peut ne jamais arriver alors que le projet s'affiche). Après 8 s, on
           découvre donc le cadre quoi qu'il en soit, et une barre discrète,
           qui ne masque rien, propose les solutions de repli. */
        timer = setTimeout(function () {
          state.hidden = true;
          var bar = document.createElement('div'); bar.className = 'bv-slow';
          bar.innerHTML = '<span>Le projet ne s\'affiche pas ? L\'intégration peut être lente ou désactivée.</span>'
            + (cur.png || cur.cover ? '<button type="button" class="bv-btn" data-mode="png">Voir l\'aperçu</button>' : '') + behanceBtn()
            + '<button type="button" class="bv-btn bv-x" aria-label="Masquer ce message" data-dismiss>✕</button>';
          $('.bv-screen').appendChild(bar);
        }, 8000);
        crop.appendChild(f);
        return;
      }
      var src = cur.png || cur.cover;
      if (!src) {
        say('<p>Aucun aperçu PNG pour ce projet.</p>' + behanceBtn());
        return;
      }
      state.hidden = true;
      crop.classList.add('bv-png');
      var img = document.createElement('img');
      img.alt = cur.title; img.decoding = 'async'; img.src = src;
      img.onerror = function () { say('<p>L\'aperçu n\'a pas pu être chargé.</p>' + behanceBtn()); };
      crop.appendChild(img);
      if (!cur.png) {
        var n = document.createElement('div'); n.className = 'bv-note';
        n.textContent = 'Couverture du projet — pas une capture complète';
        $('.bv-screen').appendChild(n);
      }
    }
    function open(pid, m) {
      var p = P[String(pid)]; if (!p) return true;     // pas un projet intégrable : lien normal
      clearTimeout(closing);
      cur = p; lastFocus = document.activeElement;
      $('#bv-title').textContent = p.title;
      link.href = p.url;
      streak.src = p.png || p.cover || ''; streak.hidden = !(p.png || p.cover);
      applyCfg(); root.hidden = false;
      root.classList.add('bv-enter');
      requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('bv-enter'); }); });
      document.documentElement.style.overflow = 'hidden';
      setMode(m || C.mode);
      setTimeout(function () { var x = $('.bv-x'); if (x) x.focus(); }, 30);
      return false;
    }
    function close() {
      if (root.hidden) return;
      root.classList.add('bv-enter');
      closing = setTimeout(function () {
        root.hidden = true; clearFrame(); cur = null; state.hidden = true;
        document.documentElement.style.overflow = '';
        if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
      }, root.classList.contains('bv-fx-anim') ? 380 : 0);
    }
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-close],[data-mode],[data-dismiss]');
      if (!t) return;
      if (t.hasAttribute('data-dismiss')) { var b = t.closest('.bv-slow'); if (b) b.remove(); return; }
      if (t.hasAttribute('data-close')) close(); else setMode(t.getAttribute('data-mode'));
    });
    document.addEventListener('keydown', function (e) {
      if (root.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = [].filter.call(root.querySelectorAll('button,a[href],iframe'), function (n) { return !n.hidden && n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    if (mq.addEventListener) mq.addEventListener('change', applyCrop);
    window.bvOpen = open;
    window.bvClose = close;
    window.bvSetMode = setMode;
    /* Éditeur : met à jour réglages et projet SANS recharger la page. */
    window.bvLive = function (next) {
      if (next && next.cfg) C = next.cfg;
      if (next && next.projects) P = next.projects;
      if (cur) { var id = Object.keys(P).find(function (k) { return P[k].be === cur.be; }); if (id) cur = P[id]; }
      applyCfg(); applyCrop();
      if (next && next.mode) setMode(next.mode);
      else if (cur && mode === 'png') setMode('png');
    };
    window.bvState = function () { return { open: !root.hidden, mode: mode, project: cur && cur.be, frames: root.querySelectorAll('iframe').length }; };
  }

  function scriptTag() { return '<script>(' + runtime.toString().replace(/<\/(script)/gi, '<\\/$1') + ')();</script>'; }

  /* ─── Export PNG de la composition statique (tableau de bord) ───
     Image locale (aperçu PNG) + effets du PSD dessinés sur un canvas. Le contenu
     de l'iframe Behance ne peut pas être capturé (origine différente). */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => res(img); img.onerror = () => rej(new Error('Image illisible'));
      img.src = src;
    });
  }
  async function exportComposition(src, opts) {
    opts = opts || {};
    const c = sanitizeConfig(opts.cfg || { enabled: true });
    const k = (c.effects.on ? c.effects.intensity : 0) / 100;
    const img = await loadImage(src);
    const W = 1830, H = 973, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    // Traînées horizontales (calque « Calque 2 copie 24 ») : image écrasée puis étirée.
    if (c.effects.on && c.effects.streaks) {
      const t = document.createElement('canvas'); t.width = 24; t.height = 200;
      t.getContext('2d').drawImage(img, 0, 0, 24, 200);
      g.globalAlpha = .8 * k; g.imageSmoothingQuality = 'high'; g.drawImage(t, -W * .15, H * .06, W * 1.3, H * .88); g.globalAlpha = 1;
    }
    const sides = g.createLinearGradient(0, 0, W, 0);
    sides.addColorStop(0, 'rgba(0,0,0,1)'); sides.addColorStop(.3, 'rgba(0,0,0,0)'); sides.addColorStop(.7, 'rgba(0,0,0,0)'); sides.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = sides; g.fillRect(0, 0, W, H);
    // Écran : 73 % de la largeur (1336 / 1830 dans le PSD), perspective par bandes.
    const sw = W * .73, sh = H * .94, sx = (W - sw) / 2, sy = (H - sh) / 2;
    const tilt = c.style === 'perspective' ? Math.min(.25, c.tilt / 100) : 0;
    const src2 = document.createElement('canvas'); src2.width = Math.round(sw); src2.height = Math.round(sh);
    const s2 = src2.getContext('2d');
    const scale = sw / img.naturalWidth; s2.drawImage(img, 0, 0, sw, img.naturalHeight * scale);
    if (c.effects.on && c.effects.saturate) { s2.globalCompositeOperation = 'saturation'; s2.fillStyle = 'hsl(0,' + Math.round(40 + 60 * k) + '%,50%)'; s2.globalAlpha = .25 * k; s2.fillRect(0, 0, sw, sh); s2.globalAlpha = 1; s2.globalCompositeOperation = 'source-over'; }
    if (c.effects.on && c.effects.shadow) { g.save(); g.shadowColor = '#000'; g.shadowBlur = 52; g.fillStyle = '#000'; g.fillRect(sx + sw * tilt / 2, sy, sw * (1 - tilt), sh); g.restore(); }
    // Tranches d'1 px dessinées sur 2 px (recouvrement) : pas de lignes visibles.
    for (let y = 0; y < sh; y++) {
      const f = 1 - tilt * (1 - y / sh), w = sw * f;
      g.drawImage(src2, 0, y, sw, Math.min(2, sh - y), sx + (sw - w) / 2, sy + y, w, Math.min(2, sh - y));
    }
    if (c.effects.on && c.effects.depth) {
      const blur = document.createElement('canvas'); blur.width = W; blur.height = H;
      const b = blur.getContext('2d'); b.filter = 'blur(' + Math.round(6 * k) + 'px)'; b.drawImage(cv, 0, 0);
      const m = b.createLinearGradient(0, sy, 0, sy + sh);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.16, 'rgba(0,0,0,0)'); m.addColorStop(.84, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
      b.filter = 'none'; b.globalCompositeOperation = 'destination-in'; b.fillStyle = m; b.fillRect(0, 0, W, H);
      g.drawImage(blur, 0, 0);
    }
    if (c.effects.on && c.effects.vignette) {
      const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .62);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (.9 * k) + ')');
      g.fillStyle = v; g.fillRect(0, 0, W, H);
    }
    if (c.effects.on && c.effects.grain) {
      // Tuile de bruit 256 px répétée : même rendu qu'un bruit plein cadre, 30× plus rapide.
      const T = 256, nc = document.createElement('canvas'); nc.width = T; nc.height = T;
      const nx = nc.getContext('2d'), n = nx.createImageData(T, T), d = n.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      nx.putImageData(n, 0, 0);
      g.globalCompositeOperation = 'soft-light'; g.globalAlpha = .43 * k;
      g.fillStyle = g.createPattern(nc, 'repeat'); g.fillRect(0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('Export impossible'))), 'image/png'));
  }

  root.BehanceViewer = {
    ID_RE, DEFAULTS, FX_KEYS, projectId, embedUrl, idFromEmbedCode, sanitizeCrop, sanitizeCrops, sanitizeConfig,
    projectEntry, dataScript, opensInViewer, css, runtime, scriptTag, exportComposition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
