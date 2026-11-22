/* ══════════════════════════════════════════════════════════════
   AMBIANCE DU SITE (v3.16) — inspirée des pages profil type haunt.gg
   Écran d'entrée (qui lance aussi la musique), particules animées,
   curseur personnalisé, accroche « machine à écrire », barre de
   défilement, grain, badge en coin.

   Tout est désactivé par défaut : un site déjà publié ne change pas
   tant que l'utilisateur n'active rien. Les réglages passent par
   sanitize() (valeurs connues, bornées, aucun CSS ni HTML libre) ; les
   textes sont publiés dans un bloc JSON échappé et posés en textContent.
   Décor = pointer-events:none. Mouvement réduit respecté.
══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const PARTICLES = ['none', 'snow', 'stars', 'embers', 'rain', 'dust', 'bubbles'];
  const CURSORS = ['none', 'dot', 'ring', 'trail'];
  const COLORS = ['accent', 'white', 'mix'];

  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const BAD_CHARS = new RegExp('[\x00-\x1f' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  const text = (v, max) => String(v == null ? '' : v).replace(BAD_CHARS, ' ').trim().slice(0, max);

  /** Réglages publics, toujours bornés. */
  function sanitize(a) {
    a = a && typeof a === 'object' ? a : {};
    const e = a.enter && typeof a.enter === 'object' ? a.enter : {};
    const t = a.typewriter && typeof a.typewriter === 'object' ? a.typewriter : {};
    const c = a.corner && typeof a.corner === 'object' ? a.corner : {};
    const lines = (Array.isArray(t.lines) ? t.lines : String(t.lines || '').split('\n'))
      .map(l => text(l, 80)).filter(Boolean).slice(0, 6);
    return {
      enter: { on: !!e.on, text: text(e.text, 40) || 'cliquer pour entrer', sub: text(e.sub, 60) },
      particles: PARTICLES.includes(a.particles) ? a.particles : 'none',
      density: clampInt(a.density, 1, 3, 2),
      pColor: COLORS.includes(a.pColor) ? a.pColor : 'accent',
      cursor: CURSORS.includes(a.cursor) ? a.cursor : 'none',
      typewriter: { on: !!t.on && lines.length > 0, lines, speed: clampInt(t.speed, 1, 3, 2) },
      progress: !!a.progress,
      grain: !!a.grain,
      corner: { on: !!c.on && !!text(c.text, 40), text: text(c.text, 40) },
    };
  }
  /** Au moins un effet actif ? (sinon rien n'est injecté dans la page) */
  function active(s) {
    return s.enter.on || s.particles !== 'none' || s.cursor !== 'none' || s.typewriter.on || s.progress || s.grain || s.corner.on;
  }

  const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  function css(s) {
    let out = '\n/* ── Ambiance (js/site-ambiance.js) ── */\n';
    if (s.particles !== 'none') out += '#amb-fx{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:150}\n';
    if (s.grain) out += `#amb-grain{position:fixed;inset:-50%;width:200%;height:200%;pointer-events:none;z-index:151;opacity:.07;background:${GRAIN};animation:amb-grain 1s steps(4) infinite}
@keyframes amb-grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(0,0)}}\n`;
    if (s.progress) out += '#amb-prog{position:fixed;right:6px;top:50%;transform:translateY(-50%);width:4px;height:min(220px,40vh);border-radius:4px;background:rgba(128,128,128,.22);z-index:190;pointer-events:none}\n#amb-prog i{display:block;width:100%;height:0;border-radius:4px;background:var(--a);box-shadow:0 0 10px var(--a)}\n';
    if (s.corner.on) out += '#amb-corner{position:fixed;left:14px;bottom:14px;z-index:190;padding:6px 11px;border-radius:999px;font:600 11px system-ui,sans-serif;color:var(--t);background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--b);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:none}\n';
    if (s.typewriter.on) out += '.amb-tw::after{content:"";display:inline-block;width:2px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--a);animation:amb-caret 1s steps(1) infinite}\n@keyframes amb-caret{50%{opacity:0}}\n';
    if (s.cursor === 'dot' || s.cursor === 'ring') out += 'html.amb-cur,html.amb-cur *{cursor:none!important}\n#amb-dot,#amb-ring{position:fixed;left:0;top:0;pointer-events:none;z-index:9998;border-radius:50%;transform:translate(-50%,-50%);opacity:0;transition:opacity .2s,width .2s,height .2s,background .2s}\n#amb-dot{width:7px;height:7px;background:var(--a);box-shadow:0 0 10px var(--a)}\n#amb-ring{width:30px;height:30px;border:1.5px solid var(--a)}\nhtml.amb-cur-on #amb-dot,html.amb-cur-on #amb-ring{opacity:1}\n#amb-ring.amb-hot{width:46px;height:46px;background:color-mix(in srgb,var(--a) 14%,transparent)}\n';
    if (s.cursor === 'trail') out += '.amb-trail{position:fixed;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--a);pointer-events:none;z-index:9998;animation:amb-trail .6s ease-out forwards}\n@keyframes amb-trail{to{transform:scale(.1);opacity:0}}\n';
    if (s.enter.on) out += `#amb-enter{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:color-mix(in srgb,var(--bg) 62%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:var(--t);cursor:pointer;transition:opacity .6s ease,visibility .6s;font-family:inherit;text-align:center;padding:24px}
#amb-enter[hidden]{display:none}
#amb-enter.amb-gone{opacity:0;visibility:hidden}
#amb-enter b{font-size:clamp(18px,3.4vw,30px);font-weight:800;letter-spacing:.02em;text-shadow:0 0 18px var(--a);animation:amb-pulse 2.2s ease-in-out infinite}
#amb-enter small{font-size:13px;color:var(--m)}
@keyframes amb-pulse{50%{opacity:.55}}\n`;
    out += '@media(prefers-reduced-motion:reduce){#amb-grain,#amb-enter b,.amb-tw::after{animation:none}}\n';
    out += '@media(hover:none),(pointer:coarse){#amb-dot,#amb-ring,.amb-trail{display:none}}\n';
    return out;
  }

  /** Éléments du décor (les textes sont posés plus tard en textContent). */
  function html(s, opts) {
    const editor = !!(opts && opts.editor);
    let out = '';
    if (s.particles !== 'none') out += '<canvas id="amb-fx" aria-hidden="true"></canvas>';
    if (s.grain) out += '<div id="amb-grain" aria-hidden="true"></div>';
    if (s.progress) out += '<div id="amb-prog" aria-hidden="true"><i></i></div>';
    if (s.corner.on) out += '<div id="amb-corner"></div>';
    if (s.cursor === 'dot' || s.cursor === 'ring') out += '<div id="amb-dot" aria-hidden="true"></div>' + (s.cursor === 'ring' ? '<div id="amb-ring" aria-hidden="true"></div>' : '');
    // Dans l'éditeur, l'écran d'entrée reste caché (il gênerait l'édition) :
    // window.ambEnter() permet de le tester depuis la fenêtre Ambiance.
    if (s.enter.on) out += `<div id="amb-enter" role="button" tabindex="0"${editor ? ' hidden' : ''}><b></b><small></small></div>`;
    return out;
  }

  function dataScript(s) {
    return '<script type="application/json" id="amb-data">' + JSON.stringify(s).replace(/</g, '\\u003c') + '</script>';
  }

  /* ─────────── Runtime inséré tel quel dans la page publiée ─────────── */
  function runtime() {
    var el = document.getElementById('amb-data'); if (!el) return;
    var S; try { S = JSON.parse(el.textContent); } catch (e) { return; }
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
    var docEl = document.documentElement;
    function accent() { return (getComputedStyle(docEl).getPropertyValue('--a') || '#C8FF00').trim() || '#C8FF00'; }

    /* Badge en coin */
    var corner = document.getElementById('amb-corner'); if (corner) corner.textContent = S.corner.text;

    /* Écran d'entrée : un clic l'efface et lance le son du site s'il existe */
    var enter = document.getElementById('amb-enter');
    if (enter) {
      enter.querySelector('b').textContent = S.enter.text;
      enter.querySelector('small').textContent = S.enter.sub || '';
      var prevOverflow = '';
      var go = function () {
        if (enter.classList.contains('amb-gone')) return;
        enter.classList.add('amb-gone');
        docEl.style.overflow = prevOverflow;
        var snd = document.getElementById('site-sound');
        if (snd && snd.getAttribute('aria-pressed') !== 'true') { try { snd.click(); } catch (e) {} }
        setTimeout(function () { enter.hidden = true; }, 650);
      };
      var show = function () {
        enter.hidden = false; enter.classList.remove('amb-gone');
        prevOverflow = docEl.style.overflow; docEl.style.overflow = 'hidden';
        try { enter.focus({ preventScroll: true }); } catch (e) {}
      };
      enter.addEventListener('click', go);
      enter.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); go(); } });
      window.ambEnter = show;
      if (!enter.hidden) show();
    }

    /* Accroche « machine à écrire » sur la phrase sous le titre */
    if (S.typewriter.on) {
      var tw = document.querySelector('.hero .hsub, .sb-hero-in .hsub, .bn-htag');
      if (tw) {
        var lines = S.typewriter.lines;
        tw.setAttribute('aria-label', lines.join(' · '));
        var span = document.createElement('span'); span.className = 'amb-tw'; span.setAttribute('aria-hidden', 'true');
        tw.textContent = ''; tw.appendChild(span);
        if (reduce) span.textContent = lines[0];
        else {
          var speed = [0, 95, 60, 35][S.typewriter.speed] || 60, li = 0, ci = 0, del = false;
          var step = function () {
            var cur = lines[li];
            if (!del) { ci++; span.textContent = cur.slice(0, ci); if (ci >= cur.length) { if (lines.length < 2) return; del = true; return setTimeout(step, 1700); } }
            else { ci--; span.textContent = cur.slice(0, ci); if (ci <= 0) { del = false; li = (li + 1) % lines.length; return setTimeout(step, 350); } }
            setTimeout(step, del ? speed / 2 : speed);
          };
          setTimeout(step, 500);
        }
      }
    }

    /* Barre de défilement verticale (côté droit) */
    var prog = document.getElementById('amb-prog');
    if (prog) {
      var bar = prog.firstChild, ticking = false;
      var upd = function () { ticking = false; var h = docEl.scrollHeight - innerHeight; bar.style.height = (h > 0 ? Math.min(100, scrollY / h * 100) : 0) + '%'; };
      addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
      upd();
    }

    /* Curseur personnalisé (souris uniquement) */
    if (fine && (S.cursor === 'dot' || S.cursor === 'ring')) {
      var dot = document.getElementById('amb-dot'), ring = document.getElementById('amb-ring');
      var mx = -100, my = -100, rx = -100, ry = -100;
      docEl.classList.add('amb-cur');
      addEventListener('mousemove', function (e) {
        mx = e.clientX; my = e.clientY; docEl.classList.add('amb-cur-on');
        if (dot) dot.style.transform = 'translate(' + mx + 'px,' + my + 'px) translate(-50%,-50%)';
        if (ring) ring.classList.toggle('amb-hot', !!(e.target.closest && e.target.closest('a,button,[onclick],[role=button],input,textarea,select,label')));
      }, { passive: true });
      document.addEventListener('mouseleave', function () { docEl.classList.remove('amb-cur-on'); });
      if (ring) (function loop() { rx += (mx - rx) * (reduce ? 1 : .2); ry += (my - ry) * (reduce ? 1 : .2); ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px) translate(-50%,-50%)'; requestAnimationFrame(loop); })();
    }
    if (fine && !reduce && S.cursor === 'trail') {
      var last = 0;
      addEventListener('mousemove', function (e) {
        var now = performance.now(); if (now - last < 28) return; last = now;
        var p = document.createElement('div'); p.className = 'amb-trail'; p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px';
        document.body.appendChild(p); setTimeout(function () { p.remove(); }, 650);
      }, { passive: true });
    }

    /* Particules (canvas plein écran, en pause quand l'onglet est caché) */
    var cv = document.getElementById('amb-fx');
    if (cv && !reduce) {
      var ctx = cv.getContext('2d'); if (!ctx) return;
      var kind = S.particles, W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), parts = [], raf = 0;
      var col = function () { var a = accent(); return S.pColor === 'white' ? '#ffffff' : S.pColor === 'mix' ? (Math.random() < .5 ? '#ffffff' : a) : a; };
      var rnd = function (a, b) { return a + Math.random() * (b - a); };
      var make = function (initial) {
        var p = { x: rnd(0, W), y: initial ? rnd(0, H) : -10, c: col(), t: rnd(0, 6.28) };
        if (kind === 'snow')    { p.r = rnd(1, 3.2); p.vy = rnd(.3, 1.1); p.vx = rnd(-.3, .3); p.a = rnd(.4, .9); }
        if (kind === 'stars')   { p.y = rnd(0, H); p.r = rnd(.6, 1.9); p.vy = rnd(.02, .08); p.vx = 0; p.a = rnd(.3, 1); }
        if (kind === 'embers')  { p.y = initial ? rnd(0, H) : H + 10; p.r = rnd(1, 2.6); p.vy = -rnd(.4, 1.3); p.vx = rnd(-.25, .25); p.a = rnd(.5, 1); }
        if (kind === 'rain')    { p.r = rnd(9, 18); p.vy = rnd(7, 12); p.vx = -1.2; p.a = rnd(.15, .4); }
        if (kind === 'dust')    { p.y = rnd(0, H); p.r = rnd(.8, 2); p.vy = rnd(-.15, .15); p.vx = rnd(-.2, .2); p.a = rnd(.15, .5); }
        if (kind === 'bubbles') { p.y = initial ? rnd(0, H) : H + 20; p.r = rnd(4, 12); p.vy = -rnd(.3, .9); p.vx = rnd(-.2, .2); p.a = rnd(.2, .5); }
        return p;
      };
      var size = function () {
        W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.min(170, Math.round(W * H / (26000 / S.density) * (W < 700 ? .55 : 1)));
        parts = []; for (var i = 0; i < n; i++) parts.push(make(true));
      };
      var draw = function () {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i]; p.t += .03; p.x += p.vx + (kind === 'snow' || kind === 'embers' ? Math.sin(p.t) * .25 : 0); p.y += p.vy;
          var alpha = kind === 'stars' ? p.a * (.55 + .45 * Math.sin(p.t * 1.6)) : kind === 'embers' ? p.a * Math.max(0, Math.min(1, p.y / H + .2)) : p.a;
          ctx.globalAlpha = alpha; ctx.fillStyle = ctx.strokeStyle = p.c;
          if (kind === 'rain') { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * 2, p.y + p.r); ctx.stroke(); }
          else if (kind === 'bubbles') { ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.stroke(); }
          else {
            if (kind === 'embers' || kind === 'stars') { ctx.shadowBlur = 8; ctx.shadowColor = p.c; }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
          }
          if (p.y > H + 25 || p.y < -25 || p.x < -25 || p.x > W + 25) parts[i] = make(false);
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
      };
      var rs = 0; addEventListener('resize', function () { clearTimeout(rs); rs = setTimeout(size, 150); });
      document.addEventListener('visibilitychange', function () { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw); });
      size(); raf = requestAnimationFrame(draw);
    }
  }

  function scriptTag() {
    return '<script>(' + runtime.toString().replace(/<\/script/gi, '<\\/script') + ')();</script>';
  }

  /** Tout ce qu'il faut injecter dans la page générée (vide si rien d'actif). */
  function inject(raw, opts) {
    const s = sanitize(raw);
    if (!active(s)) return { css: '', body: '' };
    return { css: css(s), body: html(s, opts) + dataScript(s) + scriptTag() };
  }

  root.SiteAmbiance = { sanitize, active, css, html, dataScript, runtime, scriptTag, inject, PARTICLES, CURSORS };
})(typeof window !== 'undefined' ? window : globalThis);
