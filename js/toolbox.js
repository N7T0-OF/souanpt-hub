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

  const Toolbox = {
    _file: null, _tab: 'image',
    render() {
      const root = document.getElementById('tools-root'); if (!root) return;
      const tabs = [['image', '🖼', 'Image'], ['palette', '🎨', 'Palette'], ['contrast', '◐', 'Contraste'], ['qr', '▦', 'QR code']];
      root.innerHTML = `<div class="tb-tabs" role="tablist">${tabs.map(([k, i, l]) => `<button type="button" role="tab" aria-selected="${this._tab === k}" class="${this._tab === k ? 'on' : ''}" onclick="Toolbox.go('${k}')">${i} ${l}</button>`).join('')}<span class="tb-safe">🔒 Rien n'est envoyé : tout reste sur cet appareil</span></div><div class="gc tb-panel" id="tb-panel"></div>`;
      this['_' + this._tab]();
    },
    go(tab) { this._tab = tab; this.render(); },
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
      try { SiteConfig.set('accentColor', col); window.HubAccent && HubAccent.apply(col); window.SiteAutoPublish && SiteAutoPublish.queue(); } catch {}
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
  window.Toolbox = Toolbox;
})();
