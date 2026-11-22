/* ══════════════════════════════════════════════════════════════
   AJOUT RAPIDE DEPUIS BEHANCE (v3.28)
   Le hub retrouve ton profil Behance (pseudo enregistré, ou lien Behance
   de tes réseaux), repère tes projets publics, leur nom, leur couverture et
   leurs tags, les OPTIMISE (couverture en grand format 808 px au lieu de la
   vignette 404 px, titres nettoyés, doublons écartés), puis te PROPOSE la
   liste : tu coches ce que tu veux ajouter (tout cocher / tout décocher).
   Rien n'est ajouté sans ton choix. La synchro automatique ne fait plus
   qu'annoncer les nouveautés (notification « Choisir »).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const low = s => String(s || '').trim().toLocaleLowerCase('fr');
  const RESERVED = new Set(['gallery', 'search', 'galleries', 'joblist', 'jobs', 'assets', 'live', 'hire', 'onboarding', 'blog', 'about', 'misc', 'feeds', 'collection', 'moodboard']);

  /** « @pseudo », « pseudo » ou « https://www.behance.net/pseudo/projects » → « pseudo ». */
  function parseUser(v) {
    let s = String(v || '').trim();
    if (!s) return '';
    const m = s.match(/behance\.net\/([A-Za-z0-9_-]{2,40})(?:[/?#]|$)/i);
    if (m) s = m[1]; else if (/[/.:]/.test(s)) return '';
    s = s.replace(/^@/, '');
    return /^[A-Za-z0-9_-]{2,40}$/.test(s) && !RESERVED.has(s.toLowerCase()) ? s : '';
  }
  /** Profil « connecté » : pseudo enregistré, sinon lien Behance des réseaux / liens du site. */
  function userFrom(cfg, links) {
    const direct = parseUser(cfg && cfg.behance); if (direct) return direct;
    const pool = [...(Array.isArray(links) ? links : []).map(l => l && l.url), ...Object.values((cfg && cfg.socials) || {})];
    for (const u of pool) { const x = /behance\.net/i.test(String(u || '')) ? parseUser(u) : ''; if (x) return x; }
    return '';
  }
  /** Identifiant stable d'un projet Behance (numéro de galerie), sinon l'adresse normalisée. */
  function keyOf(url) {
    const s = String(url || '');
    const m = s.match(/behance\.net\/gallery\/(\d+)/i);
    return m ? 'be:' + m[1] : s.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
  /** Couvertures candidates, de la plus adaptée au site à l'originale du flux. */
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
  /** Ajoute la sélection au portfolio (en tête, ordre Behance). Renvoie le nombre ajouté. */
  function apply(items, opts) {
    opts = opts || {};
    const projects = typeof getProjects === 'function' ? getProjects() : [];
    const have = new Set(projects.filter(p => p.url).map(p => keyOf(p.url)));
    const add = [];
    items.forEach((it, i) => {
      if (have.has(it.key)) return; have.add(it.key);
      add.push({ id: 'be' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), title: it.title, tags: opts.tags === false ? [] : it.tags.slice(),
        url: it.url, cover: it.best || it.cover, views: 0, behance: true, createdAt: it.date });
    });
    if (!add.length) return 0;
    const next = [...add, ...projects];
    localStorage.setItem('hub_projects', JSON.stringify(next));
    if (opts.tags !== false && typeof SiteConfig !== 'undefined') {
      try {
        const cat = Array.isArray(SiteConfig.get().projectTags) ? SiteConfig.get().projectTags : [];
        // L'orthographe déjà présente dans le catalogue l'emporte (« Logo » reste « Logo »).
        SiteConfig.set('projectTags', [...cat, ...add.flatMap(p => p.tags)].filter((t, i, a) => low(t) && a.findIndex(x => low(x) === low(t)) === i));
      } catch {}
    }
    return add.length;
  }

  const BQ = {
    parseUser, userFrom, keyOf, coverCandidates, cleanTitle, plan, apply,
    _items: [], _user: '', _q: '',
    user() { try { return userFrom(SiteConfig.get(), typeof getLinks === 'function' ? getLinks() : []); } catch { return ''; } },
    close() { document.getElementById('bq-modal')?.remove(); document.removeEventListener('keydown', BQ._esc, true); },
    _esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); BQ.close(); } },
    open(user) {
      this.close();
      const m = document.createElement('div'); m.id = 'bq-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Ajout rapide depuis Behance');
      m.innerHTML = '<div class="bq-card"><div class="bq-head"><span class="bq-logo">Be</span><div class="bq-ht"><b>Ajout rapide depuis Behance</b><small id="bq-who"></small></div><button type="button" class="bq-x" data-x aria-label="Fermer">✕</button></div><div class="bq-body" id="bq-body"></div><div class="bq-foot" id="bq-foot"></div></div>';
      m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('[data-x]')) BQ.close(); });
      document.body.appendChild(m); document.addEventListener('keydown', BQ._esc, true);
      const u = parseUser(user) || this.user();
      if (u) this.load(u); else this.ask();
    },
    ask(msg) {
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      document.getElementById('bq-who').textContent = 'Profil Behance introuvable dans tes réglages';
      body.innerHTML = `<div class="bq-ask"><p>${esc(msg || 'Indique ton profil Behance une fois : il sera retenu pour les prochaines fois.')}</p>
        <input class="prop-input" id="bq-user" placeholder="pseudo ou https://www.behance.net/pseudo" autocomplete="off"></div>`;
      foot.innerHTML = '<button type="button" class="btn btn-ghost" data-x>Annuler</button><button type="button" class="btn btn-accent" id="bq-go">Trouver mes projets</button>';
      const go = () => { const v = parseUser(document.getElementById('bq-user').value); if (!v) return showToast?.('Pseudo ou lien Behance invalide', '#c0392b', 2200); this.load(v); };
      document.getElementById('bq-go').onclick = go;
      const inp = document.getElementById('bq-user'); inp.onkeydown = ev => { if (ev.key === 'Enter') go(); }; inp.focus();
    },
    async load(user) {
      this._user = user; this._q = '';
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      document.getElementById('bq-who').innerHTML = `@${esc(user)} · <button type="button" class="bq-link" id="bq-change">changer</button>`;
      document.getElementById('bq-change').onclick = () => this.ask('Quel profil Behance utiliser ?');
      body.innerHTML = `<div class="bq-load"><span class="bq-spin" aria-hidden="true"></span>Recherche des projets publics de @${esc(user)}…</div>`;
      foot.innerHTML = '';
      let fetched;
      try { fetched = await Behance.fetchProjects(user); }
      catch (err) {
        if (!document.getElementById('bq-body')) return;
        body.innerHTML = `<div class="bq-ask"><p class="bq-err">${esc(err.message || 'Behance injoignable')}</p></div>`;
        foot.innerHTML = '<button type="button" class="btn btn-ghost" id="bq-other">Autre profil</button><button type="button" class="btn btn-accent" id="bq-retry">Réessayer</button>';
        document.getElementById('bq-retry').onclick = () => this.load(user);
        document.getElementById('bq-other').onclick = () => this.ask('Quel profil Behance utiliser ?');
        return;
      }
      if (!document.getElementById('bq-body')) return;
      try { if (low(SiteConfig.get().behance) !== low(user)) SiteConfig.set('behance', user); } catch {}
      this._items = plan(fetched, getProjects());
      this._items.forEach(it => { it.on = !it.exists; });
      try { localStorage.setItem('souanpt_last_behance_sync', String(Date.now())); localStorage.removeItem('souanpt_behance_new'); } catch {}
      this.render();
    },
    render() {
      const body = document.getElementById('bq-body'), foot = document.getElementById('bq-foot'); if (!body) return;
      const items = this._items, fresh = items.filter(i => !i.exists), q = low(this._q);
      const shown = items.filter(i => !q || low(i.title).includes(q) || i.tags.some(t => low(t).includes(q)));
      const sel = items.filter(i => i.on && !i.exists).length;
      body.innerHTML = `<div class="bq-sum"><b>${items.length}</b> projet${items.length > 1 ? 's' : ''} trouvé${items.length > 1 ? 's' : ''} · <b>${fresh.length}</b> nouveau${fresh.length > 1 ? 'x' : ''}${items.length - fresh.length ? ` · ${items.length - fresh.length} déjà dans ton portfolio` : ''}</div>
        <div class="bq-tools"><button type="button" class="btn btn-ghost" data-all>☑ Tout cocher</button><button type="button" class="btn btn-ghost" data-none>☐ Tout décocher</button>
          <input class="prop-input" id="bq-q" placeholder="Filtrer…" value="${esc(this._q)}">
          <label class="bq-opt"><input type="checkbox" id="bq-tags"${this._noTags ? '' : ' checked'}> Reprendre les tags Behance</label></div>
        <div class="bq-grid">${shown.map(it => `<label class="bq-it${it.exists ? ' ex' : ''}${it.on && !it.exists ? ' on' : ''}" data-key="${esc(it.key)}">
            <input type="checkbox" class="bq-ck" ${it.exists ? 'disabled' : ''} ${it.on && !it.exists ? 'checked' : ''} aria-label="Ajouter ${esc(it.title)}">
            <span class="bq-cv">${it.covers.length ? `<img alt="" loading="lazy" data-i="0" src="${esc(it.covers[0])}">` : ''}${it.exists ? '<span class="bq-badge">Déjà ajouté</span>' : ''}<span class="bq-tick" aria-hidden="true">✓</span></span>
            <span class="bq-t">${esc(it.title)}</span>
            <span class="bq-tags">${it.tags.map(t => `<i>${esc(t)}</i>`).join('')}</span></label>`).join('') || '<p class="bq-empty">Aucun projet ne correspond.</p>'}</div>`;
      foot.innerHTML = `<span class="bq-note">Couvertures en grand format, chargées depuis Behance.</span><button type="button" class="btn btn-ghost" data-x>Annuler</button><button type="button" class="btn btn-accent" id="bq-add"${sel ? '' : ' disabled'}>${sel ? 'Ajouter ' + sel + ' projet' + (sel > 1 ? 's' : '') : 'Coche des projets'}</button>`;
      const byKey = k => items.find(i => i.key === k);
      // Optimisation des couvertures : grand format d'abord, repli automatique.
      body.querySelectorAll('.bq-cv img').forEach(img => {
        const it = byKey(img.closest('[data-key]').dataset.key);
        img.onload = () => { if (img.naturalWidth > 1) it.best = img.currentSrc || img.src; };
        img.onerror = () => { const n = +img.dataset.i + 1; if (n < it.covers.length) { img.dataset.i = n; img.src = it.covers[n]; } else img.remove(); };
      });
      body.querySelectorAll('.bq-ck').forEach(ck => ck.onchange = () => { const it = byKey(ck.closest('[data-key]').dataset.key); it.on = ck.checked; this.render(); });
      body.querySelector('[data-all]').onclick = () => { shown.forEach(i => { if (!i.exists) i.on = true; }); this.render(); };
      body.querySelector('[data-none]').onclick = () => { shown.forEach(i => { i.on = false; }); this.render(); };
      body.querySelector('#bq-tags').onchange = ev => { this._noTags = !ev.target.checked; };
      const qi = body.querySelector('#bq-q'); qi.oninput = () => { this._q = qi.value; this.render(); const n = document.getElementById('bq-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
      document.getElementById('bq-add').onclick = () => this.commit();
    },
    commit() {
      const pick = this._items.filter(i => i.on && !i.exists);
      if (!pick.length) return;
      let n = 0;
      try { n = apply(pick, { tags: !this._noTags }); }
      catch { return showToast?.('⚠ Stockage local plein — retire des projets ou libère de la place', '#c0392b', 4000); }
      this.close();
      window.renderProjects?.(); window.syncKPIs?.(); window.renderBehancePage?.();
      try { if (document.getElementById('page-editor')?.classList.contains('active')) edRefreshPreview(); } catch {}
      try { if (typeof SiteAutoPublish !== 'undefined') SiteAutoPublish.queue(); } catch {}
      showToast?.(n ? `✓ ${n} projet${n > 1 ? 's' : ''} Behance ajouté${n > 1 ? 's' : ''}` : 'Ces projets sont déjà dans ton portfolio', 'var(--green)', 2600);
    },
    /** Synchro silencieuse : met à jour les couvertures manquantes et ANNONCE les nouveaux projets (sans les ajouter). */
    async checkNew() {
      const user = this.user(); if (!user) return 0;
      const fetched = await Behance.fetchProjects(user);
      const projects = getProjects(), items = plan(fetched, projects);
      let touched = false;
      items.filter(i => i.exists).forEach(i => { const p = projects.find(x => x.id === i.existingId); if (p && !p.cover && i.cover) { p.cover = i.covers[0] || i.cover; touched = true; } });
      if (touched) localStorage.setItem('hub_projects', JSON.stringify(projects));
      localStorage.setItem('souanpt_last_behance_sync', String(Date.now()));
      const fresh = items.filter(i => !i.exists);
      const seenKey = 'souanpt_behance_seen'; let seen; try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); } catch { seen = new Set(); }
      const unseen = fresh.filter(i => !seen.has(i.key));
      localStorage.setItem('souanpt_behance_new', String(fresh.length));
      if (unseen.length && typeof Notify !== 'undefined' && Notify._sysAll && Notify._sysSave) {
        const all = Notify._sysAll(), now = Date.now();
        Notify._sysSave([{ id: 'behance-new-' + now, local: true, event: 'behance.new', category: 'general', action: 'behance-quick',
          title: '🅱 ' + unseen.length + ' nouveau' + (unseen.length > 1 ? 'x projets' : ' projet') + ' sur Behance', message: unseen.slice(0, 3).map(i => i.title).join(', ') + (unseen.length > 3 ? '…' : '') + ' — choisis ce que tu ajoutes', createdAt: now }, ...all]);
        try { Notify.loadInbox().then(() => Notify.renderInbox()); } catch {}
        localStorage.setItem(seenKey, JSON.stringify([...seen, ...unseen.map(i => i.key)].slice(-300)));
      }
      return fresh.length;
    },
  };
  window.BehanceQuick = BQ;
})();
