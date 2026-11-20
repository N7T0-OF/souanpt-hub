/* ══════════════════════════════════════════════════════════════════════════
   EdBehance — réglages de la fenêtre Behance dans l'éditeur de site.

   · Fenêtre « Behance » (barre de l'éditeur) : activation, style, mode
     initial, effets du PSD, dimensions et cadrage par défaut (avancé).
   · Section « Aperçu Behance » dans la fiche d'un projet : code
     d'intégration (facultatif), cadrage ordinateur / téléphone, image
     d'aperçu PNG (import, remplacement, suppression), export de la
     composition statique.

   Chaque changement est envoyé AUSSITÔT à la fenêtre ouverte dans l'aperçu
   (window.bvLive dans l'iframe de l'éditeur) : c'est le même code que le site
   publié (js/behance-viewer.js), donc le rendu est identique.
   Réglages globaux : SiteConfig.behancePreview. Par projet : p.preview
   = { beId?, png?, crop: { desk, mob } }.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const BV = () => window.BehanceViewer;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PNG_MAX_CHARS = 2600000;   // ≈ 1,9 Mo d'image : au-delà, localStorage sature

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
      catch { showToast?.('⚠ Stockage local plein — image non enregistrée', '#c0392b', 4000); return null; }
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
    push(openId, mode) {
      const w = this.win();
      const d = this.data();
      if (w && typeof w.bvLive === 'function') {
        if (!d.cfg.enabled) { w.bvClose && w.bvClose(); return; }
        w.bvLive({ ...d, mode });
        if (openId && !(w.bvState && w.bvState().open)) w.bvOpen(openId, mode);
        return;
      }
      if (!d.cfg.enabled) return;
      this._pending = openId ? { id: openId, mode } : this._pending;
      if (typeof edRefreshPreview === 'function') edRefreshPreview();
    },
    /** Appelé par edRefreshPreview une fois l'aperçu chargé. */
    afterPreview(frame) {
      const p = this._pending; this._pending = null;
      if (!p) return;
      try { const w = frame.contentWindow; if (w.bvOpen) w.bvOpen(p.id, p.mode); } catch {}
    },
    test(id, mode) {
      if (!id) return showToast?.('Aucun projet Behance à tester', '#e4b24a', 2500);
      if (!this.cfg().enabled) this.setCfg({ enabled: true });
      this.push(String(id), mode);
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
          <div class="edw-l">Mode à l'ouverture</div>${seg('mode', c.mode, [['live', 'Behance Live'], ['png', 'Aperçu PNG']])}
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
      return `<div class="bve-proj" id="bve-proj-sec">
        <div class="edw-l">Aperçu Behance ${e ? `<span class="edw-hint">projet n° ${esc(e.be)}</span>` : ''}</div>
        ${e ? '' : '<p class="edw-hint">Ce projet n\'a pas d\'adresse Behance reconnue. Colle son code d\'intégration (Behance → Partager → Intégrer) :</p>'}
        <input class="edw-in" id="bve-code" placeholder="&lt;iframe src=&quot;https://www.behance.net/embed/project/…&quot; …&gt; ou adresse du projet" value="${esc(pv.beId ? 'https://www.behance.net/embed/project/' + pv.beId : '')}">
        <p class="edw-hint" id="bve-code-msg">Seul le numéro du projet est conservé, jamais le code collé.</p>
        ${e ? `<div class="edw-row bve-tabs"><button class="edw-st${this._cropTab === 'desk' ? ' on' : ''}" data-tab="desk">🖥 Ordinateur</button><button class="edw-st${this._cropTab === 'mob' ? ' on' : ''}" data-tab="mob">▮ Téléphone</button></div>
          ${sl('zoom', 'Zoom', 1, 3, k.zoom, '×', .05)}${sl('x', 'Position X', -50, 50, k.x)}${sl('y', 'Rogner en haut', 0, 600, k.y, ' px', 4)}
          <div class="edw-row"><button class="edw-sec-rst" id="bve-crop-rst">↺ Réinitialiser le cadrage</button><button class="edw-sec-rst" id="bve-try-live">▶ Behance Live</button><button class="edw-sec-rst" id="bve-try-png">▶ Aperçu PNG</button></div>
          <div class="edw-l">Image d'aperçu (mode PNG)</div>
          <div class="bve-png">${pv.png ? `<img src="${esc(pv.png)}" alt="Aperçu enregistré">` : `<span>${p.cover ? 'Aucune image : la couverture servira de secours (annoncée comme telle).' : 'Aucune image d\'aperçu.'}</span>`}</div>
          <div class="edw-row"><button class="edw-sec-rst" id="bve-png-pick">📁 ${pv.png ? 'Remplacer' : 'Importer'} une image</button>${pv.png ? '<button class="edw-sec-rst" id="bve-png-del">✖ Supprimer</button>' : ''}
            <button class="edw-sec-rst" id="bve-png-export"${pv.png || p.cover ? '' : ' disabled'}>⬇ Exporter la composition PNG</button>
            <input type="file" id="bve-png-file" accept="image/png,image/jpeg,image/webp" hidden></div>` : ''}
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
      if (q('#bve-try-live')) q('#bve-try-live').onclick = () => this.test(id, 'live');
      if (q('#bve-try-png')) q('#bve-try-png').onclick = () => this.test(id, 'png');
      const file = q('#bve-png-file');
      if (q('#bve-png-pick')) q('#bve-png-pick').onclick = () => file.click();
      if (file) file.onchange = ev => {
        const f = ev.target.files[0]; ev.target.value = '';
        if (!f || !/^image\/(png|jpeg|webp)$/.test(f.type)) return showToast?.('Choisis une image PNG, JPEG ou WebP', '#c0392b', 2500);
        const rd = new FileReader();
        rd.onload = e2 => {
          const raw = String(e2.target.result || '');
          const keep = src => {
            if (src.length > PNG_MAX_CHARS) return showToast?.('Image trop lourde pour le navigateur — réduis-la sous 2 Mo', '#c0392b', 4000);
            if (this.saveProject(id, pv => { pv.png = src; })) { rerender(); this.test(id, 'png'); showToast?.('Image d\'aperçu enregistrée ✓', '#2e9a63', 2000); }
          };
          // Une grande image est réduite (WebP) ; une image déjà légère reste telle quelle.
          if (raw.length > PNG_MAX_CHARS / 2 && typeof compressImageSrc === 'function') compressImageSrc(raw, out => keep(out || raw));
          else keep(raw);
        };
        rd.readAsDataURL(f);
      };
      if (q('#bve-png-del')) q('#bve-png-del').onclick = () => {
        if (!confirm('Supprimer l\'image d\'aperçu de ce projet ?')) return;
        this.saveProject(id, pv => { delete pv.png; }); rerender();
      };
      if (q('#bve-png-export')) q('#bve-png-export').onclick = async () => {
        const p = getProjects().find(x => String(x.id) === String(id)); if (!p) return;
        const src = (p.preview && p.preview.png) || p.cover;
        try {
          const blob = await BV().exportComposition(src, { cfg: this.cfg() });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = 'apercu-' + String(p.title || 'projet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        } catch (e) {
          showToast?.((p.preview && p.preview.png) ? '✗ Export impossible : ' + e.message
            : '✗ La couverture Behance ne peut pas être exportée (protection du navigateur) — importe une image d\'aperçu', '#c0392b', 5000);
        }
      };
    },
  };

  window.EdBehance = EdBehance;
})();
