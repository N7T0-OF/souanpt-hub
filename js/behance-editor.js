/* ══════════════════════════════════════════════════════════════════════════
   EdBehance — réglages de la fenêtre Behance dans l'éditeur de site.

   · Fenêtre « Behance » (barre de l'éditeur) : activation, style, effets du
     PSD, dimensions et cadrage par défaut (avancé).
   · Section « Aperçu Behance » dans la fiche d'un projet : code
     d'intégration (facultatif), cadrage ordinateur / téléphone.
   Un seul mode : le projet Behance en direct.

   Chaque changement est envoyé AUSSITÔT à la fenêtre ouverte dans l'aperçu
   (window.bvLive dans l'iframe de l'éditeur) : c'est le même code que le site
   publié (js/behance-viewer.js), donc le rendu est identique.
   Réglages globaux : SiteConfig.behancePreview. Par projet : p.preview
   = { beId?, crop: { desk, mob } }.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const BV = () => window.BehanceViewer;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EdBehance = {
    _pending: null,
    _cropTab: 'desk',

    cfg() { return BV().sanitizeConfig(SiteConfig.get().behancePreview); },
    setCfg(patch) {
      const next = BV().sanitizeConfig({ ...this.cfg(), ...patch });
      SiteConfig.set('behancePreview', next);
      this.push();
      return next;
    },
    projects() { return getProjects().filter(p => BV().projectEntry(p, this.cfg())); },
    saveProject(id, mutate) {
      const ps = getProjects();
      const p = ps.find(x => String(x.id) === String(id)); if (!p) return null;
      p.preview = { ...(p.preview || {}) };
      mutate(p.preview, p);
      try { localStorage.setItem('hub_projects', JSON.stringify(ps)); }
      catch { showToast?.('⚠ Stockage local plein — réglage non enregistré', '#c0392b', 4000); return null; }
      this.push();
      return p;
    },

    /* ── liaison avec l'aperçu de l'éditeur ── */
    win() { try { return document.getElementById('ed-preview-frame').contentWindow; } catch { return null; } },
    data() {
      const c = this.cfg(), map = {};
      getProjects().forEach(p => { const e = BV().projectEntry(p, c); if (e) map[String(p.id)] = e; });
      return { cfg: c, projects: map };
    },
    /** Pousse l'état courant dans la fenêtre de l'aperçu, ou régénère l'aperçu
        si son HTML ne contient pas encore la fenêtre (elle était désactivée). */
    push(openId) {
      const w = this.win();
      const d = this.data();
      if (w && typeof w.bvLive === 'function') {
        if (!d.cfg.enabled) { w.bvClose && w.bvClose(); return; }
        w.bvLive(d);
        if (openId && !(w.bvState && w.bvState().open)) w.bvOpen(openId);
        return;
      }
      if (!d.cfg.enabled) return;
      this._pending = openId || this._pending;
      if (typeof edRefreshPreview === 'function') edRefreshPreview();
    },
    /** Appelé par edRefreshPreview une fois l'aperçu chargé. */
    afterPreview(frame) {
      const id = this._pending; this._pending = null;
      if (!id) return;
      try { const w = frame.contentWindow; if (w.bvOpen) w.bvOpen(id); } catch {}
    },
    test(id) {
      if (!id) return showToast?.('Aucun projet Behance à tester', '#e4b24a', 2500);
      if (!this.cfg().enabled) this.setCfg({ enabled: true });
      this.push(String(id));
    },

    /* ── fenêtre de réglages globaux ── */
    openSettings(anchor) {
      const draw = () => {
        const c = this.cfg(), fx = c.effects, ps = this.projects();
        const seg = (key, val, opts) => `<div class="edw-row">${opts.map(([v, l]) =>
          `<button class="edw-st${val === v ? ' on' : ''}" data-set="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
        const slider = (key, label, min, max, val, unit, step) => `<label class="bve-sl"><span>${label} <b data-out="${key}">${val}${unit || ''}</b></span>
          <input type="range" data-num="${key}" min="${min}" max="${max}" step="${step || 1}" value="${val}" data-unit="${unit || ''}"></label>`;
        const tog = (key, label, on) => `<label class="edw-tog"><input type="checkbox" data-fx="${key}"${on ? ' checked' : ''}> ${label}</label>`;
        const cropRow = (dev, lbl) => {
          const k = c.crop[dev];
          return `<div class="edw-l">${lbl}</div>` + slider('crop.' + dev + '.zoom', 'Zoom', 1, 3, k.zoom, '×', .05)
            + slider('crop.' + dev + '.x', 'Position X', -50, 50, k.x) + slider('crop.' + dev + '.y', 'Rogner en haut', 0, 600, k.y, ' px', 4);
        };
        return `
          <label class="edw-tog bve-main"><input type="checkbox" id="bve-on"${c.enabled ? ' checked' : ''}> <b>Ouvrir les projets Behance dans une fenêtre sur le site</b></label>
          <p class="edw-hint">${ps.length ? ps.length + ' projet' + (ps.length > 1 ? 's' : '') + ' Behance détecté' + (ps.length > 1 ? 's' : '') : 'Aucun projet Behance : importe-les (Behance) ou colle un code d\'intégration dans la fiche d\'un projet.'} · les autres projets gardent leur lien.</p>
          <div class="edw-l">Style (d'après le PSD de référence)</div>${seg('style', c.style, [['perspective', 'Perspective'], ['curved', 'Écran incurvé'], ['flat', 'Plat']])}
          <div class="edw-l">Affichage</div>${seg('display', c.display, [['window', 'Fenêtre'], ['page', 'Vue plein écran']])}
          <label class="edw-tog"><input type="checkbox" id="bve-link"${c.showLink ? ' checked' : ''}> Bouton « Voir sur Behance »</label>
          <div class="edw-l">Effets</div>
          <label class="edw-tog"><input type="checkbox" data-fx="on"${fx.on ? ' checked' : ''}> Effets du PSD</label>
          ${slider('effects.intensity', 'Intensité', 0, 100, fx.intensity, ' %')}
          <div class="bve-grid">${tog('grain', 'Grain', fx.grain)}${tog('streaks', 'Traînées latérales', fx.streaks)}${tog('depth', 'Flou de profondeur', fx.depth)}${tog('vignette', 'Vignettage', fx.vignette)}
            ${tog('glow', 'Halo (couleur d\'accent)', fx.glow)}${tog('shadow', 'Ombre portée', fx.shadow)}${tog('saturate', 'Saturation', fx.saturate)}${tog('anim', 'Animation d\'ouverture', fx.anim)}</div>
          <details class="bve-adv"><summary>Réglages avancés</summary>
            ${slider('width', 'Largeur', 50, 100, c.width, ' %')}${slider('height', 'Hauteur', 40, 100, c.height, ' %')}
            ${slider('radius', 'Arrondis', 0, 40, c.radius, ' px')}${slider('border', 'Bordure', 0, 4, c.border, ' px')}
            ${slider('tilt', 'Inclinaison (perspective)', 0, 25, c.tilt, '°')}${slider('backdrop', 'Fond assombri', 40, 100, c.backdrop, ' %')}
            <p class="edw-hint">Cadrage par défaut — chaque projet peut avoir le sien (fiche du projet).</p>
            ${cropRow('desk', 'Ordinateur')}${cropRow('mob', 'Téléphone')}
            <button class="edw-sec-rst" id="bve-reset">↺ Réinitialiser la fenêtre</button>
          </details>
          ${ps.length ? `<div class="edw-l">Essayer</div><div class="edw-row bve-try"><select class="edw-in" id="bve-proj">${ps.map(p => `<option value="${esc(p.id)}">${esc(p.title || 'Projet')}</option>`).join('')}</select>
            <button class="edw-ok" id="bve-test">▶ Ouvrir dans l'aperçu</button></div>` : ''}`;
      };
      EdWin.open(anchor, '🅱 Fenêtre Behance', `<div id="bve">${draw()}</div>`, root => {
        const body = root.querySelector('#bve');
        const redraw = () => { const open = body.querySelector('.bve-adv')?.open; body.innerHTML = draw(); if (open) body.querySelector('.bve-adv').open = true; bind(); };
        const bind = () => {
          const q = s => body.querySelector(s);
          q('#bve-on').onchange = e => { this.setCfg({ enabled: e.target.checked }); if (typeof edRefreshPreview === 'function') edRefreshPreview(); redraw(); };
          q('#bve-link').onchange = e => this.setCfg({ showLink: e.target.checked });
          body.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { this.setCfg({ [b.dataset.set]: b.dataset.v }); redraw(); });
          body.querySelectorAll('[data-fx]').forEach(i => i.onchange = () => { const c = this.cfg(); this.setCfg({ effects: { ...c.effects, [i.dataset.fx]: i.checked } }); });
          body.querySelectorAll('[data-num]').forEach(r => r.oninput = () => {
            const out = body.querySelector(`[data-out="${r.dataset.num}"]`); if (out) out.textContent = r.value + r.dataset.unit;
            const path = r.dataset.num.split('.'), c = this.cfg(), v = Number(r.value);
            if (path[0] === 'effects') this.setCfg({ effects: { ...c.effects, intensity: v } });
            else if (path[0] === 'crop') this.setCfg({ crop: { ...c.crop, [path[1]]: { ...c.crop[path[1]], [path[2]]: v } } });
            else this.setCfg({ [path[0]]: v });
          });
          if (q('#bve-reset')) q('#bve-reset').onclick = () => { this.setCfg({ ...BV().DEFAULTS, enabled: this.cfg().enabled }); redraw(); };
          if (q('#bve-test')) q('#bve-test').onclick = () => {
            const wasOff = !this.cfg().enabled;
            this.test(q('#bve-proj').value);
            if (wasOff) redraw();     // l'essai active la fenêtre : la case doit le montrer
          };
        };
        bind();
      }, 'wide');
    },

    /* ── section « Aperçu Behance » de la fiche projet ── */
    projectSection(p) {
      const e = BV().projectEntry(p, this.cfg());
      const pv = p.preview || {};
      const crop = (e && e.crop) || BV().sanitizeCrops(pv.crop, this.cfg().crop);
      const k = crop[this._cropTab];
      const sl = (key, label, min, max, val, unit, step) => `<label class="bve-sl"><span>${label} <b data-pout="${key}">${val}${unit || ''}</b></span>
        <input type="range" data-pc="${key}" min="${min}" max="${max}" step="${step || 1}" value="${val}" data-unit="${unit || ''}"></label>`;
      const gallery = Array.isArray(pv.gallery) ? pv.gallery.map(g => typeof g === 'string' ? g : (g && g.src)).filter(Boolean) : [];
      const hasBe = !!(e && e.be);
      return `<div class="bve-proj" id="bve-proj-sec">
        <div class="edw-l">Images du projet <span class="edw-hint">déroulant — tes propres images</span></div>
        <div class="bve-gal" id="bve-gal">${gallery.length ? gallery.map((src, i) => `
          <div class="bve-gal-it" data-i="${i}"><img src="${esc(src)}" alt="" loading="lazy">
            <div class="bve-gal-act"><button type="button" data-gup="${i}" title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-gdel="${i}" title="Retirer">✕</button></div></div>`).join('')
          : '<p class="edw-hint" style="margin:0">Aucune image. Colle les adresses de tes images (clic droit → « Copier l’adresse de l’image » sur ton projet Behance) ou importe des fichiers.</p>'}</div>
        <textarea class="edw-in" id="bve-gal-urls" rows="2" placeholder="Colle une ou plusieurs adresses d'images (une par ligne), puis Entrée"></textarea>
        <div class="edw-row"><button class="edw-sec-rst" id="bve-gal-add">＋ Ajouter les adresses</button><button class="edw-sec-rst" id="bve-gal-pick">📁 Importer des fichiers</button>
          ${gallery.length ? '<button class="edw-sec-rst" id="bve-gal-clear">✖ Tout retirer</button>' : ''}
          <input type="file" id="bve-gal-file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></div>
        <p class="edw-hint">Avec des images, la fenêtre affiche le projet qui défile. Sans, elle montre la carte Behance (couverture seule : Behance ne fournit pas le contenu complet aux autres sites).</p>
        <div class="edw-l" style="margin-top:12px">Lien / carte Behance ${hasBe ? `<span class="edw-hint">projet n° ${esc(e.be)}</span>` : ''}</div>
        <input class="edw-in" id="bve-code" placeholder="Adresse du projet Behance ou code d'intégration (facultatif)" value="${esc(pv.beId ? 'https://www.behance.net/embed/project/' + pv.beId : (BV().projectId(p.url) ? p.url : ''))}">
        <p class="edw-hint" id="bve-code-msg">Seul le numéro du projet est conservé, jamais le code collé.</p>
        ${hasBe && !gallery.length ? `<div class="edw-row bve-tabs"><button class="edw-st${this._cropTab === 'desk' ? ' on' : ''}" data-tab="desk">🖥 Ordinateur</button><button class="edw-st${this._cropTab === 'mob' ? ' on' : ''}" data-tab="mob">▮ Téléphone</button></div>
          ${sl('zoom', 'Zoom', 1, 3, k.zoom, '×', .05)}${sl('x', 'Position X', -50, 50, k.x)}${sl('y', 'Rogner en haut', 0, 600, k.y, ' px', 4)}
          <div class="edw-row"><button class="edw-sec-rst" id="bve-crop-rst">↺ Réinitialiser le cadrage</button></div>` : ''}
        ${e ? '<div class="edw-row"><button class="edw-sec-rst" id="bve-try-live">▶ Voir dans l\'aperçu</button></div>' : ''}
      </div>`;
    },
    bindProject(w, id) {
      const sec = w.querySelector('#bve-proj-sec'); if (!sec) return;
      const q = s => sec.querySelector(s);
      const rerender = () => { const p = getProjects().find(x => String(x.id) === String(id)); if (p) { sec.outerHTML = this.projectSection(p); this.bindProject(w, id); } };
      const code = q('#bve-code');
      code.onchange = () => {
        const v = code.value.trim();
        const msg = q('#bve-code-msg');
        if (!v) { this.saveProject(id, pv => { delete pv.beId; }); rerender(); return; }
        const be = BV().idFromEmbedCode(v);
        if (!be) { msg.textContent = '✗ Code non reconnu : seules les intégrations https://www.behance.net/embed/project/<numéro> sont acceptées.'; msg.style.color = '#c0392b'; return; }
        this.saveProject(id, pv => { pv.beId = be; });
        rerender();
      };
      sec.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this._cropTab = b.dataset.tab; rerender(); });
      sec.querySelectorAll('[data-pc]').forEach(r => r.oninput = () => {
        const out = sec.querySelector(`[data-pout="${r.dataset.pc}"]`); if (out) out.textContent = r.value + r.dataset.unit;
        const tab = this._cropTab;
        this.saveProject(id, (pv, p) => {
          const cur = BV().projectEntry(p, this.cfg()).crop;
          pv.crop = { ...cur, [tab]: { ...cur[tab], [r.dataset.pc]: Number(r.value) } };
        });
        this.push(String(id));
      });
      if (q('#bve-crop-rst')) q('#bve-crop-rst').onclick = () => { this.saveProject(id, pv => { if (pv.crop) delete pv.crop[this._cropTab]; }); rerender(); this.push(String(id)); };
      if (q('#bve-try-live')) q('#bve-try-live').onclick = () => this.test(id);
      this._bindGallery(sec, id, rerender);
    },
    /* ── galerie d'images du projet (le déroulé) ── */
    GAL_MAX: 40,
    GAL_MAX_BYTES: 3500000,   // ~3,5 Mo de data: cumulés avant saturation localStorage
    _gallery(id) { const p = getProjects().find(x => String(x.id) === String(id)); const g = p && p.preview && p.preview.gallery; return Array.isArray(g) ? g.map(x => typeof x === 'string' ? x : (x && x.src)).filter(Boolean) : []; },
    _setGallery(id, list, rerender) {
      const clean = list.slice(0, this.GAL_MAX);
      const bytes = clean.filter(s => s.startsWith('data:')).reduce((n, s) => n + s.length, 0);
      if (bytes > this.GAL_MAX_BYTES) return showToast?.('Trop d\'images importées — préfère coller des adresses, ou retires-en', '#c0392b', 4500);
      const ok = this.saveProject(id, pv => { if (clean.length) pv.gallery = clean; else delete pv.gallery; });
      if (ok) { rerender(); this.push(String(id)); }
    },
    _bindGallery(sec, id, rerender) {
      const q = s => sec.querySelector(s);
      const addUrls = () => {
        const ta = q('#bve-gal-urls'); if (!ta) return;
        const urls = ta.value.split(/[\s\n]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
        if (!urls.length) return showToast?.('Colle au moins une adresse http(s) d\'image', '#e4b24a', 2500);
        this._setGallery(id, this._gallery(id).concat(urls), rerender);
      };
      if (q('#bve-gal-add')) q('#bve-gal-add').onclick = addUrls;
      const ta = q('#bve-gal-urls');
      if (ta) ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); addUrls(); } };
      const file = q('#bve-gal-file');
      if (q('#bve-gal-pick')) q('#bve-gal-pick').onclick = () => file.click();
      if (file) file.onchange = ev => {
        const files = [...ev.target.files]; ev.target.value = '';
        const imgs = files.filter(f => /^image\//.test(f.type));
        if (!imgs.length) return;
        let done = 0; const out = [];
        imgs.forEach((f, idx) => {
          const rd = new FileReader();
          rd.onload = e2 => {
            const raw = String(e2.target.result || '');
            const keep = src => { out[idx] = src; if (++done === imgs.length) this._setGallery(id, this._gallery(id).concat(out.filter(Boolean)), rerender); };
            // Un GIF reste animé ; le reste est compressé en WebP.
            if (f.type === 'image/gif' || typeof compressImageSrc !== 'function') keep(raw);
            else compressImageSrc(raw, c => keep(c || raw));
          };
          rd.onerror = () => { if (++done === imgs.length) this._setGallery(id, this._gallery(id).concat(out.filter(Boolean)), rerender); };
          rd.readAsDataURL(f);
        });
      };
      sec.querySelectorAll('[data-gdel]').forEach(b => b.onclick = () => { const g = this._gallery(id); g.splice(+b.dataset.gdel, 1); this._setGallery(id, g, rerender); });
      sec.querySelectorAll('[data-gup]').forEach(b => b.onclick = () => { const i = +b.dataset.gup, g = this._gallery(id); if (i > 0) { [g[i - 1], g[i]] = [g[i], g[i - 1]]; this._setGallery(id, g, rerender); } });
      if (q('#bve-gal-clear')) q('#bve-gal-clear').onclick = () => { if (confirm('Retirer toutes les images de ce projet ?')) this._setGallery(id, [], rerender); };
    },
  };

  window.EdBehance = EdBehance;
})();
