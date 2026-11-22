/* ══════════════════════════════════════════════════════════════
   ÉDITION RAPIDE SUR TÉLÉPHONE (v3.29)
   Sous 820 px, l'éditeur de site ne charge PAS l'aperçu en direct (une
   iframe avec tout le site, ses images et ses effets : lourd en mémoire
   sur un téléphone). À la place, une page légère façon Linktree :
     🔗 Liens (ajouter, modifier, réordonner, retirer)
     📁 Projets (nouveau projet, ajout rapide Behance)
     🏷 Tags (créer, ranger des projets)
     🎵 Musique et son de clic (lien ou fichier)
     ✳ Profil (nom, bio, e-mail)
   La mise en page (blocs, thème, effets, aperçu) demande un ordinateur ;
   « Éditeur complet quand même » reste possible pour la session.
   Les données sont les mêmes que l'éditeur complet (hub_links + blocs,
   hub_projects, SiteConfig) et la publication automatique suit son réglage.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MQ = window.matchMedia ? matchMedia('(max-width: 820px)') : { matches: false, addEventListener() {} };
  const FULL_KEY = 'hub_ed_full';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return String(u || '').replace(/^mailto:/, ''); } };
  const toast = (m, c, d) => { try { showToast(m, c, d); } catch {} };
  const queue = () => { try { if (typeof SiteAutoPublish !== 'undefined') SiteAutoPublish.queue(); } catch {} };
  const cfg = () => (typeof SiteConfig !== 'undefined' ? SiteConfig.get() : {});
  const setCfg = (k, v) => { if (typeof SiteConfig !== 'undefined') SiteConfig.set(k, v); };
  const fullForced = () => { try { return sessionStorage.getItem(FULL_KEY) === '1'; } catch { return false; } };

  /** Lien saisi → { url, platform, title }. Pseudo seul refusé (impossible de savoir où il pointe). */
  function normalizeLink(raw, title) {
    const v = String(raw || '').trim(); if (!v) return null;
    const det = typeof socialDetect === 'function' ? socialDetect(v) : { platform: null };
    const p = det.platform && typeof socialById === 'function' ? socialById(det.platform) : null;
    let url = '';
    if (det.platform === 'email') url = 'mailto:' + v.replace(/^mailto:/i, '');
    else if (/^https?:\/\//i.test(v)) url = v;
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v)) url = 'https://' + v;
    else return null;
    try { if (!/^mailto:/.test(url)) { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; url = u.href; } } catch { return null; }
    return { url, platform: p ? p.id : 'custom', title: String(title || '').trim().slice(0, 60) || (p ? p.label : hostOf(url)) };
  }
  /** Liens du site dans l'ordre de leurs blocs (même ordre que la grille publiée). */
  function orderedLinks() {
    const links = typeof getLinks === 'function' ? getLinks() : [];
    let order = [];
    try { order = getBlocks(cfg()).filter(b => b.type === 'link').map(b => String(bRef(b))); } catch {}
    const rank = id => { const i = order.indexOf(String(id)); return i < 0 ? 1e6 : i; };
    return links.slice().sort((a, b) => rank(a.id) - rank(b.id));
  }
  function saveLinks(ls) { localStorage.setItem('hub_links', JSON.stringify(ls)); }
  function reconcile() { try { setCfg('blocks', placeBlocks(getBlocks(cfg()))); } catch {} queue(); }

  const EdLite = {
    normalizeLink,
    active() { return MQ.matches && !fullForced(); },
    /** Appelé à chaque ouverture de l'éditeur (et au changement de taille d'écran). */
    sync() {
      const page = document.getElementById('page-editor'); if (!page) return;
      const on = this.active();
      page.classList.toggle('ed-lite', on);
      if (on) { this.free(); this.render(); }
      else if (page.querySelector('#ed-lite')) page.querySelector('#ed-lite').hidden = true;
    },
    /** Libère l'aperçu déjà chargé (passage d'un grand écran à un petit). */
    free() {
      const f = document.getElementById('ed-preview-frame');
      if (f && f.getAttribute('src') && f.getAttribute('src') !== 'about:blank') { try { f.src = 'about:blank'; } catch {} }
    },
    full() {
      try { sessionStorage.setItem(FULL_KEY, '1'); } catch {}
      this.sync();
      toast('Éditeur complet : il peut être lent sur un téléphone', '#e4b24a', 3000);
      try { edRefreshPreview(); } catch {}
    },
    lite() { try { sessionStorage.removeItem(FULL_KEY); } catch {} this.sync(); },
    render() {
      const page = document.getElementById('page-editor'); if (!page) return;
      let root = page.querySelector('#ed-lite');
      if (!root) { root = document.createElement('div'); root.id = 'ed-lite'; page.insertBefore(root, page.firstChild); }
      root.hidden = false;
      const c = cfg(), links = orderedLinks(), projects = typeof getProjects === 'function' ? getProjects() : [];
      const tags = typeof edTagCatalog === 'function' ? edTagCatalog() : [];
      const count = t => projects.filter(p => (p.tags || []).some(x => String(x).toLowerCase() === String(t).toLowerCase())).length;
      const file = u => { const s = String(u || ''); if (!s) return 'Aucun'; try { return decodeURIComponent(new URL(s).pathname.split('/').pop()) || hostOf(s); } catch { return s.slice(0, 40); } };
      const open = root._open || { links: true };
      const sec = (id, icon, title, sub, body) => `<details class="el-sec" data-sec="${id}"${open[id] ? ' open' : ''}><summary><span class="el-ic">${icon}</span><span class="el-st"><b>${title}</b><small>${sub}</small></span><span class="el-chev" aria-hidden="true">›</span></summary><div class="el-body">${body}</div></details>`;
      root.innerHTML = `
        <div class="el-head"><div><b>📱 Édition rapide</b><p>Pas d’aperçu en direct sur téléphone : l’éditeur reste léger. La mise en page (blocs, thème, effets) se fait sur ordinateur.</p></div>
          <div class="el-hb"><button type="button" class="btn btn-ghost" data-el="site">↗ Voir mon site</button><button type="button" class="btn btn-ghost" data-el="full">Éditeur complet</button></div></div>
        ${sec('links', '🔗', 'Liens', links.length + ' lien' + (links.length > 1 ? 's' : '') + ' sur ton site', `
          <div class="el-list">${links.map((l, i) => `<div class="el-row" data-link="${esc(l.id)}">
              <span class="el-li">${esc((typeof platIconOf === 'function' ? platIconOf(l.title || '', l.url || '') : '') || '🔗')}</span>
              <span class="el-lt"><b>${esc(l.title || hostOf(l.url))}</b><small>${esc(hostOf(l.url))}</small></span>
              <span class="el-act"><button type="button" data-up="${esc(l.id)}" aria-label="Monter ${esc(l.title)}"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" data-down="${esc(l.id)}" aria-label="Descendre ${esc(l.title)}"${i === links.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-edit="${esc(l.id)}" aria-label="Modifier ${esc(l.title)}">✎</button><button type="button" data-rm="${esc(l.id)}" aria-label="Retirer ${esc(l.title)}">✕</button></span></div>`).join('') || '<p class="el-empty">Aucun lien pour le moment.</p>'}</div>
          <form class="el-form" id="el-link-form" autocomplete="off"><input class="prop-input" id="el-link-url" inputmode="url" placeholder="Lien (https://…, instagram.com/toi, e-mail)" required>
            <input class="prop-input" id="el-link-title" maxlength="60" placeholder="Titre (facultatif)"><input type="hidden" id="el-link-id">
            <button type="submit" class="btn btn-accent" id="el-link-ok">＋ Ajouter le lien</button></form>`)}
        ${sec('projects', '📁', 'Projets', projects.length + ' projet' + (projects.length > 1 ? 's' : ''), `
          <div class="el-two"><button type="button" class="btn btn-accent" data-el="project">＋ Nouveau projet</button><button type="button" class="btn btn-ghost" data-el="behance">🅱 Depuis Behance</button></div>
          <div class="el-list el-proj">${projects.slice(0, 30).map(p => `<div class="el-row"><span class="el-th">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ''}</span><span class="el-lt"><b>${esc(p.title || 'Sans titre')}</b><small>${esc((p.tags || []).slice(0, 3).join(' · ') || hostOf(p.url))}</small></span></div>`).join('')}${projects.length > 30 ? `<p class="el-empty">+ ${projects.length - 30} autres</p>` : ''}</div>`)}
        ${sec('tags', '🏷', 'Tags', tags.length ? tags.length + ' tag' + (tags.length > 1 ? 's' : '') : 'Aucun tag', `
          <div class="el-chips">${tags.map(t => `<button type="button" class="el-chip" data-tag="${esc(t)}">${esc(t)} <i>${count(t)}</i></button>`).join('') || '<p class="el-empty">Crée un tag pour classer tes projets.</p>'}</div>
          <form class="el-form el-inline" id="el-tag-form" autocomplete="off"><input class="prop-input" id="el-tag" maxlength="40" placeholder="Nouveau tag (ex. Motion)"><button type="submit" class="btn btn-accent">Créer</button></form>
          <p class="el-hint">Touche un tag pour y ranger des projets et choisir où il s’affiche.</p>`)}
        ${sec('audio', '🎵', 'Musique & son', 'Musique : ' + esc(file(c.backgroundMusic)), `
          <label class="el-l">Musique de fond</label><input class="prop-input" id="el-music" type="url" placeholder="https://…/musique.mp3" value="${esc(c.backgroundMusic || '')}">
          <input type="file" id="el-music-file" accept="audio/*" data-max="15" data-label="Dépose ta musique ou touche pour choisir">
          <label class="el-l">Son de clic (facultatif)</label><input class="prop-input" id="el-click" type="url" placeholder="https://…/clic.mp3" value="${esc(c.clickSound || '')}">
          <input type="file" id="el-click-file" accept="audio/*" data-max="15" data-label="Dépose un son de clic ou touche pour choisir">
          <div class="el-two"><button type="button" class="btn btn-accent" data-el="audio">Enregistrer</button><button type="button" class="btn btn-ghost" data-el="audio-off">Retirer la musique</button></div>`)}
        ${sec('profile', '✳', 'Profil', esc(c.siteName || 'Nom du site'), `
          <label class="el-l">Nom du site</label><input class="prop-input" id="el-name" maxlength="60" value="${esc(c.siteName || '')}">
          <label class="el-l">Bio</label><textarea class="prop-input" id="el-bio" rows="3" maxlength="400">${esc(c.bio || '')}</textarea>
          <label class="el-l">E-mail de contact</label><input class="prop-input" id="el-email" type="email" inputmode="email" value="${esc(c.email || '')}">
          <button type="button" class="btn btn-accent" data-el="profile">Enregistrer</button>`)}
        <p class="el-foot">Les changements partent avec la publication automatique si elle est activée, sinon avec 🚀 Publier.</p>`;
      this.bind(root);
    },
    bind(root) {
      const $ = s => root.querySelector(s);
      root.querySelectorAll('details.el-sec').forEach(d => d.addEventListener('toggle', () => { root._open = root._open || {}; root._open[d.dataset.sec] = d.open; }));
      root.querySelector('[data-el="site"]').onclick = () => { const u = cfg().customDomain || cfg().siteUrl; if (u && /^https:\/\//.test(u)) window.open(u, '_blank', 'noopener'); else { try { edPreviewExternal(); } catch { toast('Site pas encore publié', '#e4b24a'); } } };
      root.querySelector('[data-el="full"]').onclick = () => this.full();
      // Liens
      const form = $('#el-link-form');
      form.onsubmit = ev => {
        ev.preventDefault();
        const n = normalizeLink($('#el-link-url').value, $('#el-link-title').value);
        if (!n) return toast('Lien invalide : colle une adresse complète (https://…) ou une adresse e-mail', '#c0392b', 3000);
        const ls = getLinks(), id = $('#el-link-id').value;
        if (id) { const i = ls.findIndex(x => String(x.id) === id); if (i >= 0) ls[i] = { ...ls[i], ...n, title: $('#el-link-title').value.trim() || ls[i].title || n.title }; }
        else ls.push({ id: Date.now().toString(), clicks: 0, ...n });
        saveLinks(ls); reconcile(); this.render();
        toast(id ? 'Lien modifié ✓' : 'Lien ajouté ✓', 'var(--green)', 1600);
      };
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const l = getLinks().find(x => String(x.id) === b.dataset.edit); if (!l) return;
        $('#el-link-url').value = String(l.url || '').replace(/^mailto:/, ''); $('#el-link-title').value = l.title || ''; $('#el-link-id').value = l.id;
        $('#el-link-ok').textContent = 'Enregistrer le lien'; $('#el-link-url').focus();
      });
      root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
        const id = b.dataset.rm, l = getLinks().find(x => String(x.id) === id);
        if (!l || !confirm('Retirer « ' + (l.title || hostOf(l.url)) + ' » du site ?')) return;
        saveLinks(getLinks().filter(x => String(x.id) !== id));
        try { setCfg('blocks', getBlocks(cfg()).filter(x => !(x.type === 'link' && String(bRef(x)) === id))); } catch {}
        queue(); this.render(); toast('Lien retiré', '#666', 1500);
      });
      root.querySelectorAll('[data-up],[data-down]').forEach(b => b.onclick = () => {
        const id = b.dataset.up || b.dataset.down, up = !!b.dataset.up;
        try {
          const blocks = getBlocks(cfg()), idx = blocks.map((x, i) => x.type === 'link' ? i : -1).filter(i => i >= 0);
          const k = idx.findIndex(i => String(bRef(blocks[i])) === id), j = up ? k - 1 : k + 1;
          if (k < 0 || j < 0 || j >= idx.length) return;
          [blocks[idx[k]], blocks[idx[j]]] = [blocks[idx[j]], blocks[idx[k]]];
          setCfg('blocks', blocks); queue(); this.render();
        } catch { toast('Ordre indisponible', '#c0392b'); }
      });
      // Projets
      root.querySelector('[data-el="project"]').onclick = () => { try { edAddProject(); } catch { toast('Ajout indisponible', '#c0392b'); } };
      root.querySelector('[data-el="behance"]').onclick = () => window.BehanceQuick && BehanceQuick.open();
      // Tags
      $('#el-tag-form').onsubmit = ev => {
        ev.preventDefault();
        const name = $('#el-tag').value.trim().replace(/\s+/g, ' '); if (!name) return;
        const list = typeof edTagCatalog === 'function' ? edTagCatalog() : [];
        if (list.some(t => t.toLowerCase() === name.toLowerCase())) return toast('Ce tag existe déjà', '#e4b24a', 1800);
        setCfg('projectTags', [...list, name]); queue(); this.render(); toast('Tag « ' + name + ' » créé ✓', 'var(--green)', 1600);
      };
      root.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { try { edWinTags(b.dataset.tag); } catch {} });
      // Musique et son
      [['el-music-file', 'el-music'], ['el-click-file', 'el-click']].forEach(([fid, uid]) => {
        const f = $('#' + fid); if (!f) return;
        f.onchange = async () => {
          const input = $('#' + uid); input.placeholder = 'Envoi en cours…';
          try { input.value = await edUploadSiteAsset(f.files[0], 'audio'); toast('Audio envoyé ✓ — pense à Enregistrer', 'var(--green)', 2200); }
          catch (err) { toast(err.message, '#c0392b', 3500); }
          input.placeholder = 'https://…';
        };
      });
      const okUrl = v => !v || (typeof publicMediaUrl === 'function' ? publicMediaUrl(v) : /^https:\/\//.test(v));
      root.querySelector('[data-el="audio"]').onclick = () => {
        const m = $('#el-music').value.trim(), k = $('#el-click').value.trim();
        if (!okUrl(m) || !okUrl(k)) return toast('Utilise une adresse HTTPS valide', '#c0392b', 2500);
        setCfg('backgroundMusic', m); setCfg('clickSound', k); queue(); this.render(); toast('Son du site enregistré ✓', 'var(--green)', 1800);
      };
      root.querySelector('[data-el="audio-off"]').onclick = () => { setCfg('backgroundMusic', ''); queue(); this.render(); toast('Musique retirée', '#666', 1500); };
      // Profil
      root.querySelector('[data-el="profile"]').onclick = () => {
        const email = $('#el-email').value.trim();
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('E-mail invalide', '#c0392b', 2000);
        setCfg('siteName', $('#el-name').value.trim()); setCfg('bio', $('#el-bio').value.trim()); setCfg('email', email);
        queue(); this.render(); toast('Profil enregistré ✓', 'var(--green)', 1600);
      };
    },
  };
  const onChange = () => { if (document.getElementById('page-editor')?.classList.contains('active')) { const was = document.getElementById('page-editor').classList.contains('ed-lite'); EdLite.sync(); if (was && !EdLite.active()) { try { edRefreshPreview(); } catch {} } } };
  if (MQ.addEventListener) MQ.addEventListener('change', onChange); else if (MQ.addListener) MQ.addListener(onChange);
  window.EdLite = EdLite;
})();
