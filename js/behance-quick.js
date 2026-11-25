/* ══════════════════════════════════════════════════════════════
   AJOUT RAPIDE DEPUIS BEHANCE (v3.28, refait en 3.29.2)
   Behance a supprimé le flux RSS des profils (`/feeds/user` → 404) et ne
   propose plus d'API pour lister les projets d'un profil ; on ne lit pas ses
   pages en se faisant passer pour un navigateur. Donc :
     1. tu colles les liens de tes projets (un ou plusieurs d'un coup, même au
        milieu d'un texte) — bouton « Ouvrir mon profil Behance » pour les copier ;
     2. le hub retrouve chaque NOM via l'oEmbed officiel de Behance (relais
        /api/behance), écarte les doublons et ceux déjà dans ton portfolio, et
        retient ton vrai pseudo Behance (auteur des projets) ;
     3. tu ajoutes une couverture par glisser-déposer si tu veux (Behance ne la
        donne pas), tu coches, tu ajoutes.
   Sans réseau ou relais, le nom vient du lien lui-même : rien ne bloque.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const low = s => String(s || '').trim().toLocaleLowerCase('fr');
  const RESERVED = new Set(['gallery', 'search', 'galleries', 'joblist', 'jobs', 'assets', 'live', 'hire', 'onboarding', 'blog', 'about', 'misc', 'feeds', 'collection', 'moodboard', 'services']);
  const MAX_LINKS = 40;

  /** « @pseudo », « pseudo » ou « https://www.behance.net/pseudo/projects » → « pseudo ». */
  function parseUser(v) {
    let s = String(v || '').trim();
    if (!s) return '';
    const m = s.match(/behance\.net\/([A-Za-z0-9_-]{2,40})(?:[/?#]|$)/i);
    if (m) s = m[1]; else if (/[/.:]/.test(s)) return '';
    s = s.replace(/^@/, '');
    return /^[A-Za-z0-9_-]{2,40}$/.test(s) && !RESERVED.has(s.toLowerCase()) ? s : '';
  }
  /** Profil connu : pseudo enregistré, sinon lien Behance des réseaux / liens du site. */
  function userFrom(cfg, links) {
    const direct = parseUser(cfg && cfg.behance); if (direct) return direct;
    const pool = [...(Array.isArray(links) ? links : []).map(l => l && l.url), ...Object.values((cfg && cfg.socials) || {})];
    for (const u of pool) { const x = /behance\.net/i.test(String(u || '')) && !/\/gallery\//i.test(String(u)) ? parseUser(u) : ''; if (x) return x; }
    return '';
  }
  /** Identifiant stable d'un projet Behance (numéro de galerie), sinon l'adresse normalisée. */
  function keyOf(url) {
    const s = String(url || '');
    const m = s.match(/behance\.net\/gallery\/(\d+)/i);
    return m ? 'be:' + m[1] : s.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
  /** Tous les liens de projets Behance d'un texte collé, sans doublon (40 max). */
  function extractLinks(text) {
    const out = [], seen = new Set(), re = /(?:https?:\/\/)?(?:www\.)?behance\.net\/gallery\/(\d{3,12})(?:\/([A-Za-z0-9._~%-]{1,200}))?/gi;
    let m;
    while ((m = re.exec(String(text || ''))) && out.length < MAX_LINKS) {
      if (seen.has(m[1])) continue; seen.add(m[1]);
      out.push('https://www.behance.net/gallery/' + m[1] + (m[2] ? '/' + m[2] : ''));
    }
    return out;
  }
  /** Nom de secours tiré du lien : « …/241392957/Miniatures-2026 » → « Miniatures 2026 ». */
  function titleFromUrl(url) {
    const m = String(url || '').match(/\/gallery\/\d+\/([^/?#]+)/);
    if (!m) return 'Projet Behance';
    let s = m[1]; try { s = decodeURIComponent(s); } catch {}
    return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Projet Behance';
  }
  /** Couvertures candidates d'une image Behance, de la plus adaptée au site à l'originale. */
  function coverCandidates(url) {
    const s = String(url || '');
    const m = s.match(/^(https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/)([^/]+)(\/.+)$/i);
    if (!m) return s ? [s] : [];
    return [...new Set([m[1] + 'max_808' + m[3], m[1] + '808' + m[3], s])];
  }
  function cleanTitle(t) {
    return String(t || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim().slice(0, 120) || 'Projet';
  }
  /** Prépare la proposition : déjà présent ou nouveau, couvertures et tags propres. */
  function plan(fetched, existing) {
    const have = new Map((existing || []).filter(p => p && p.url).map(p => [keyOf(p.url), p]));
    const seen = new Set();
    return (fetched || []).map(f => {
      const key = keyOf(f.url); if (!f.url || seen.has(key)) return null; seen.add(key);
      const ex = have.get(key);
      return { key, title: cleanTitle(f.title), url: String(f.url), covers: coverCandidates(f.cover), cover: f.cover || '',
        tags: (f.tags || []).map(t => String(t).trim()).filter((t, i, a) => t && a.findIndex(x => low(x) === low(t)) === i).slice(0, 4),
        date: Number(f.date) || Date.now(), exists: !!ex, existingId: ex ? ex.id : null };
    }).filter(Boolean);
  }
  /** Ajoute la sélection au portfolio (en tête, ordre conservé). Renvoie le nombre ajouté. */
  function apply(items, opts) {
    opts = opts || {};
    const projects = typeof getProjects === 'function' ? getProjects() : [];
    const have = new Set(projects.filter(p => p.url).map(p => keyOf(p.url)));
    const add = [];
    items.forEach((it, i) => {
      if (have.has(it.key)) return; have.add(it.key);
      add.push({ id: 'be' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), title: it.title, tags: opts.tags === false ? [] : (it.tags || []).slice(),
        url: it.url, cover: it.best || it.cover || '', views: 0, behance: true, createdAt: it.date || Date.now() });
    });
    if (!add.length) return 0;
    localStorage.setItem('hub_projects', JSON.stringify([...add, ...projects]));
    const newTags = add.flatMap(p => p.tags);
    if (opts.tags !== false && newTags.length && typeof SiteConfig !== 'undefined') {
      try {
        const cat = Array.isArray(SiteConfig.get().projectTags) ? SiteConfig.get().projectTags : [];
        // L'orthographe déjà présente dans le catalogue l'emporte (« Logo » reste « Logo »).
        SiteConfig.set('projectTags', [...cat, ...newTags].filter((t, i, a) => low(t) && a.findIndex(x => low(x) === low(t)) === i));
      } catch {}
    }
    return add.length;
  }
  /** Relais Cloudflare (même règle que la connexion par QR). */
  function relayOrigin() {
    if (/\.pages\.dev$/.test(location.hostname) || location.hostname === 'souanpt-hub.fr') return location.origin;
    try { const b = localStorage.getItem('souanpt_relay_base'); if (b && /^https:\/\//.test(b)) return b; } catch {}
    return (typeof window.GH_RELAY === 'string' && /^https:\/\//.test(window.GH_RELAY)) ? window.GH_RELAY : 'https://souanptjub.pages.dev';
  }
  /** Nom (et auteur) d'un projet via l'oEmbed officiel ; null si indisponible. */
  async function fetchMeta(url) {
    try {
      const r = await fetch(relayOrigin() + '/api/behance?url=' + encodeURIComponent(url), { credentials: 'omit', signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
      if (!r.ok) return null;
      const d = await r.json();
      return d && d.title ? d : null;
    } catch { return null; }
  }
  const readCover = file => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choisis une image'));
    const rd = new FileReader();
    rd.onload = e => {
      const raw = e.target.result;
      if (file.type === 'image/gif' || typeof compressImageSrc !== 'function') return resolve(raw);   // GIF : jamais figé
      try { compressImageSrc(raw, out => resolve(out || raw)); } catch { resolve(raw); }
    };
    rd.onerror = () => reject(new Error('Lecture impossible'));
    rd.readAsDataURL(file);
  });

  const BQ = {
    parseUser, userFrom, keyOf, extractLinks, titleFromUrl, coverCandidates, cleanTitle, plan, apply, relayOrigin,
    _items: [], _q: '',
    user() { try { return userFrom(SiteConfig.get(), typeof getLinks === 'function' ? getLinks() : []); } catch { return ''; } },
    close() { document.getElementById('bq-modal')?.remove(); document.removeEventListener('keydown', BQ._esc, true); },
    _esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); BQ.close(); } },
    open(text) {
      this.close();
      const m = document.createElement('div'); m.id = 'bq-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Ajout rapide depuis Behance');
      m.innerHTML = '<div class="bq-card"><div class="bq-head"><span class="bq-logo">Be</span><div class="bq-ht"><b>Ajout rapide depuis Behance</b><small id="bq-who"></small></div><button type="button" class="bq-x" data-x aria-label="Fermer">✕</button></div><div class="bq-body" id="bq-body"></div><div class="bq-foot" id="bq-foot"></div></div>';
      m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('[data-x]')) BQ.close(); });
      document.body.appendChild(m); document.addEventListener('keydown', BQ._esc, true);
      this.ask(typeof text === 'string' && extractLinks(text).length ? text : '');
    },
    ask(prefill, msg) {
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      const u = this.user();
      document.getElementById('bq-who').textContent = u ? 'Profil : behance.net/' + u : 'Colle les liens de tes projets';
      body.innerHTML = `<div class="bq-ask">
          ${msg ? `<p class="bq-err">${esc(msg)}</p>` : ''}
          <p>Colle les liens de tes projets Behance : un ou plusieurs d’un coup, même au milieu d’un texte. Le hub retrouve leur nom et écarte ceux déjà ajoutés.</p>
          <textarea class="prop-input bq-paste" id="bq-links" rows="6" placeholder="https://www.behance.net/gallery/241392957/Miniatures-2026&#10;https://www.behance.net/gallery/…">${esc(prefill || '')}</textarea>
          <div class="bq-row"><a class="btn btn-ghost" id="bq-profile" href="https://www.behance.net/${esc(u)}" target="_blank" rel="noopener noreferrer">↗ Ouvrir ${u ? 'mon profil' : 'Behance'}</a><span class="bq-tip">Sur chaque projet : clic droit → « Copier l’adresse du lien ».</span></div>
          <p class="bq-tip">Behance ne permet plus de lister un profil automatiquement (son flux a été supprimé).</p></div>`;
      foot.innerHTML = '<button type="button" class="btn btn-ghost" data-x>Annuler</button><button type="button" class="btn btn-accent" id="bq-go">Trouver mes projets</button>';
      const ta = document.getElementById('bq-links');
      const go = () => { const links = extractLinks(ta.value); if (!links.length) return showToast?.('Aucun lien de projet Behance (behance.net/gallery/…) trouvé', '#c0392b', 3000); this.load(links); };
      document.getElementById('bq-go').onclick = go;
      ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) go(); });
      ta.focus();
    },
    async load(links) {
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      this._q = '';
      body.innerHTML = `<div class="bq-load"><span class="bq-spin" aria-hidden="true"></span><span id="bq-prog">Recherche des noms… 0 / ${links.length}</span></div>`;
      foot.innerHTML = '';
      const metas = new Array(links.length); let done = 0, i = 0;
      const worker = async () => { while (i < links.length) { const k = i++; metas[k] = await fetchMeta(links[k]); done++; const p = document.getElementById('bq-prog'); if (p) p.textContent = `Recherche des noms… ${done} / ${links.length}`; } };
      await Promise.all([worker(), worker(), worker()]);
      if (!document.getElementById('bq-body')) return;
      const found = links.map((url, k) => ({ title: metas[k] ? metas[k].title : titleFromUrl(url), url, cover: '', tags: [], date: Date.now() - k }));
      const users = metas.filter(Boolean).map(m => m.user).filter(Boolean);
      if (users.length) { try { if (low(SiteConfig.get().behance) !== low(users[0])) SiteConfig.set('behance', users[0]); } catch {} document.getElementById('bq-who').textContent = 'Profil : behance.net/' + users[0]; }
      this._offline = metas.every(x => !x);
      this._items = plan(found, getProjects());
      this._items.forEach(it => { it.on = !it.exists; });
      this.render();
    },
    render() {
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      const items = this._items, fresh = items.filter(i => !i.exists), q = low(this._q);
      const shown = items.filter(i => !q || low(i.title).includes(q));
      const sel = items.filter(i => i.on && !i.exists).length;
      body.innerHTML = `${this._offline ? '<p class="bq-tip bq-warn">Noms Behance indisponibles pour le moment : ils sont tirés des liens, modifiables ci-dessous.</p>' : ''}
        <div class="bq-sum"><b>${items.length}</b> projet${items.length > 1 ? 's' : ''} · <b>${fresh.length}</b> nouveau${fresh.length > 1 ? 'x' : ''}${items.length - fresh.length ? ` · ${items.length - fresh.length} déjà dans ton portfolio` : ''}</div>
        <div class="bq-tools"><button type="button" class="btn btn-ghost" data-all>☑ Tout cocher</button><button type="button" class="btn btn-ghost" data-none>☐ Tout décocher</button>
          <input class="prop-input" id="bq-q" placeholder="Filtrer…" value="${esc(this._q)}"><button type="button" class="btn btn-ghost" data-more>＋ Autres liens</button></div>
        <div class="bq-grid">${shown.map(it => `<div class="bq-it${it.exists ? ' ex' : ''}${it.on && !it.exists ? ' on' : ''}" data-key="${esc(it.key)}">
            <label class="bq-cv" title="${it.exists ? '' : 'Glisse une image ou clique pour la couverture'}">${it.best ? `<img alt="" src="${esc(it.best)}">` : `<span class="bq-cvh">${it.exists ? '' : '＋ Couverture<small>glisse une image</small>'}</span>`}${it.exists ? '<span class="bq-badge">Déjà ajouté</span>' : `<input type="file" accept="image/*" class="bq-file" data-hd-skip hidden>`}</label>
            <button type="button" class="bq-tick" data-tick ${it.exists ? 'disabled' : ''} aria-pressed="${!!(it.on && !it.exists)}" aria-label="${it.on ? 'Ne pas ajouter' : 'Ajouter'} ${esc(it.title)}">✓</button>
            <input class="bq-t" value="${esc(it.title)}" maxlength="120" aria-label="Nom du projet" ${it.exists ? 'disabled' : ''}>
            <a class="bq-lk" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">behance.net ↗</a></div>`).join('') || '<p class="bq-empty">Aucun projet ne correspond.</p>'}</div>`;
      foot.innerHTML = `<span class="bq-note">Les couvertures sont facultatives : tu peux les ajouter plus tard.</span><button type="button" class="btn btn-ghost" data-x>Annuler</button><button type="button" class="btn btn-accent" id="bq-add"${sel ? '' : ' disabled'}>${sel ? 'Ajouter ' + sel + ' projet' + (sel > 1 ? 's' : '') : 'Coche des projets'}</button>`;
      const byKey = k => items.find(i => i.key === k);
      body.querySelectorAll('[data-key]').forEach(card => {
        const it = byKey(card.dataset.key); if (!it || it.exists) return;
        card.querySelector('[data-tick]').onclick = () => { it.on = !it.on; this.render(); };
        card.querySelector('.bq-t').oninput = ev => { it.title = ev.target.value.trim().slice(0, 120) || it.title; };
        const zone = card.querySelector('.bq-cv'), file = card.querySelector('.bq-file');
        const take = async f => { try { it.best = await readCover(f); it.on = true; this.render(); } catch (err) { showToast?.(err.message, '#c0392b', 2200); } };
        file.onchange = () => file.files[0] && take(file.files[0]);
        zone.addEventListener('dragover', ev => { ev.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', ev => { ev.preventDefault(); zone.classList.remove('over'); const f = ev.dataTransfer.files[0]; if (f) take(f); });
      });
      body.querySelector('[data-all]').onclick = () => { shown.forEach(i => { if (!i.exists) i.on = true; }); this.render(); };
      body.querySelector('[data-none]').onclick = () => { shown.forEach(i => { i.on = false; }); this.render(); };
      body.querySelector('[data-more]').onclick = () => this.ask('', '');
      const qi = body.querySelector('#bq-q'); qi.oninput = () => { this._q = qi.value; this.render(); const n = document.getElementById('bq-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
      document.getElementById('bq-add').onclick = () => this.commit();
    },
    commit() {
      const pick = this._items.filter(i => i.on && !i.exists);
      if (!pick.length) return;
      let n = 0;
      try { n = apply(pick, { tags: false }); }
      catch { return showToast?.('⚠ Stockage local plein — retire des projets ou des couvertures', '#c0392b', 4000); }
      this.close();
      window.renderProjects?.(); window.syncKPIs?.(); window.renderBehancePage?.();
      try { if (document.getElementById('page-editor')?.classList.contains('active')) edRefreshPreview(); } catch {}
      try { if (typeof SiteAutoPublish !== 'undefined') SiteAutoPublish.queue(); } catch {}
      try { if (window.HubImages) getProjects().slice(0, n).forEach(p => { if (p.cover) HubImages.offloadProject(p.id); }); } catch {}
      showToast?.(n ? `✓ ${n} projet${n > 1 ? 's' : ''} Behance ajouté${n > 1 ? 's' : ''}` : 'Ces projets sont déjà dans ton portfolio', 'var(--green)', 2600);
    },
    /** Ancienne synchro automatique (flux RSS) : Behance l'a supprimé, plus rien à vérifier. */
    async checkNew() { return 0; },
  };
  window.BehanceQuick = BQ;
})();
