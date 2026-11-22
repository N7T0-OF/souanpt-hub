/* ══════════════════════════════════════════════════════════════
   Éditeur — fenêtres 🔎 Référencement et 👻 haunt.gg (v3.18)
   S'appuient sur js/site-seo.js (SiteSEO) et js/haunt.js (HauntPicker).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const visibleProjects = () => getProjects().filter(p => !p.hidden && p.status !== 'hidden');
  const reviews = () => (typeof getReviews === 'function' ? getReviews() : []);

  function auditHtml(cfg) {
    const a = SiteSEO.audit(cfg, visibleProjects(), reviews());
    const col = a.score >= 80 ? 'var(--green)' : a.score >= 50 ? '#e4b24a' : 'var(--red)';
    const host = (() => { try { return a.preview.url ? new URL(a.preview.url).host + new URL(a.preview.url).pathname : 'ton-site.github.io'; } catch { return ''; } })();
    return `<div class="seo-score"><b style="color:${col}">${a.score}</b><span>/100</span><div class="seo-bar"><i style="width:${a.score}%;background:${col}"></i></div></div>
      <div class="seo-g"><div class="seo-g-url">${e(host)}</div><div class="seo-g-t">${e(a.preview.title)}</div><div class="seo-g-d">${e(a.preview.description)}</div></div>
      ${a.preview.image ? `<div class="seo-share"><img src="${e(a.preview.image)}" alt=""><div><b>${e(a.preview.title)}</b><span>${e(a.preview.description)}</span></div></div>` : ''}
      <ul class="seo-list">${a.checks.map(c => `<li class="${c.ok ? 'ok' : ''}"><span>${c.ok ? '✓' : '○'}</span><div>${e(c.label)}${c.ok ? '' : `<small>${e(c.tip)}</small>`}</div></li>`).join('')}</ul>`;
  }

  function edWinSEO(btn) {
    const cfg = SiteConfig.get(), s = SiteSEO.sanitize(cfg);
    const html = `
      <div id="seo-audit">${auditHtml(cfg)}</div>
      <div class="edw-l">Titre dans Google <span class="edw-hint">vide = nom + métier + ville</span></div>
      <input class="edw-in" id="seo-title" maxlength="70" placeholder="Souanpt — Graphiste miniatures YouTube" value="${e(s.title)}">
      <div class="edw-l">Description <span class="edw-hint">70 à 165 caractères</span></div>
      <textarea class="edw-in" id="seo-desc" rows="3" maxlength="170" placeholder="Miniatures YouTube, identités visuelles et motion design pour créateurs. Devis rapide.">${e(s.description)}</textarea>
      <div class="edw-row"><input class="edw-in" id="seo-job" maxlength="80" placeholder="Métier (ex. Graphiste)" value="${e(s.jobTitle)}"><input class="edw-in" id="seo-city" maxlength="60" placeholder="Ville / région" value="${e(s.city)}"></div>
      <div class="edw-l">Image de partage <span class="edw-hint">Discord, X, WhatsApp — 1200×630 idéal</span></div>
      <input class="edw-in" id="seo-img" type="url" placeholder="https://…" value="${e(s.shareImage)}">
      <div class="edw-row"><button class="edw-sec-rst" id="seo-img-haunt" type="button">👻 Choisir sur haunt.gg</button></div>
      <label class="edw-tog"><input type="checkbox" id="seo-index"${s.index ? ' checked' : ''}> Autoriser Google à indexer le site</label>
      `;
    EdWin.open(btn, '🔎 Référencement (SEO)', html, w => {
      const v = id => w.querySelector('#' + id);
      const save = () => {
        const cur = SiteConfig.get();
        edSet('seo', { ...(cur.seo || {}), title: v('seo-title').value, description: v('seo-desc').value, jobTitle: v('seo-job').value, city: v('seo-city').value, shareImage: v('seo-img').value.trim(), index: v('seo-index').checked });
        v('seo-audit').innerHTML = auditHtml(SiteConfig.get());
      };
      w.querySelectorAll('input,textarea').forEach(i => i.onchange = save);
      v('seo-img-haunt').onclick = () => {
        if (typeof HauntPicker === 'undefined') return;
        HauntPicker.open({ type: 'image', multiple: false, title: 'Image de partage — haunt.gg', onPick: items => { const u = items[0] && Haunt.src(items[0]); if (u) { v('seo-img').value = u; save(); } } });
      };
    });
  }

  function edWinHaunt(btn) {
    const cfg = SiteConfig.get();
    const links = SiteSEO.hauntLinks(cfg);
    const mode = ['auto', 'always', 'off'].includes(cfg.hauntBack) ? cfg.hauntBack : 'auto';
    const html = `
      
      <div class="edw-l">Ton pseudo haunt.gg</div>
      <input class="edw-in" id="hg-user" maxlength="60" placeholder="souanpt" value="${e(String(cfg.hauntUser || '').replace(/^https?:\/\/(www\.)?haunt\.gg\//i, ''))}">
      <div class="edw-l">Bouton « ← haunt.gg » sur le site</div>
      <select class="edw-in" id="hg-back">
        <option value="auto"${mode === 'auto' ? ' selected' : ''}>Seulement pour les visiteurs venus de haunt.gg</option>
        <option value="always"${mode === 'always' ? ' selected' : ''}>Toujours</option>
        <option value="off"${mode === 'off' ? ' selected' : ''}>Jamais</option></select>
      <div class="edw-l">Liens à mettre sur ton profil haunt.gg <span class="edw-hint">tuiles Folio, Contact…</span></div>
      ${links.length ? links.map((l, i) => `<div class="hg-link"><span>${e(l.label)}</span><code>${e(l.url)}</code><button class="edw-sec-rst" type="button" data-copy="${i}">Copier</button></div>`).join('')
        : '<p class="edw-hint">Publie ton site une première fois : son adresse servira à fabriquer ces liens.</p>'}
      
      <div class="edw-row"><a class="edw-sec-rst" href="https://haunt.gg/fr/dashboard" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Ouvrir haunt.gg ↗</a>
        <button class="edw-sec-rst" type="button" id="hg-keys">${typeof Haunt !== 'undefined' && Haunt.connected() ? '✓ Hébergement haunt.gg connecté' : '🔑 Connecter l\'hébergement haunt.gg'}</button></div>`;
    EdWin.open(btn, '👻 haunt.gg', html, w => {
      const v = id => w.querySelector('#' + id);
      v('hg-user').onchange = () => {
        const raw = v('hg-user').value.trim();
        const url = raw ? SiteSEO.hauntUrl(raw) : '';
        if (raw && !url) return showToast?.('Pseudo haunt.gg invalide', '#c0392b', 2500);
        edSet('hauntUser', url ? url.slice('https://haunt.gg/'.length) : '');
      };
      v('hg-back').onchange = () => edSet('hauntBack', v('hg-back').value);
      w.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        const l = links[+b.dataset.copy];
        try { await navigator.clipboard.writeText(l.url); b.textContent = 'Copié ✓'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); }
        catch { showToast?.(l.url, '#888', 6000); }
      });
      v('hg-keys').onclick = () => { EdWin.close?.(); showPage('settings'); setTimeout(() => {
        try { settingsTab('compte', [...document.querySelectorAll('.settings-nav-item')].find(n => /compte/i.test(n.textContent))); } catch {} document.getElementById('conn-haunt')?.scrollIntoView({ block: 'center' }); if (window.HauntSettings && document.getElementById('conn-haunt-box')?.hidden) HauntSettings.toggle(); }, 300); };
    });
  }

  window.edWinSEO = edWinSEO; window.edWinHaunt = edWinHaunt;
})();
