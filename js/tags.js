/* ══════════════════════════════════════════════════════════════════════════
   ProjectTags — tags des projets du portfolio.

   Les tags vivent déjà sur chaque projet (`p.tags`, tableau de chaînes) : ce
   module ne change pas le modèle, il le rend fiable et agréable à éditer.
     · clean()    : normalise (espaces, longueur, doublons insensibles à la
                    casse, 8 tags max) — appliqué à chaque enregistrement ;
     · counts()   : inventaire des tags et du nombre de projets qui les portent ;
     · rename() / remove() : renommer, fusionner ou retirer un tag partout ;
     · mount()    : éditeur à pastilles avec suggestions (tags déjà utilisés) ;
     · openManager() : fenêtre 🏷 Tags de l'éditeur (renommer, fusionner,
                    supprimer, filtre par tag sur le site public).

   Les fonctions de données sont PURES (elles reçoivent la liste de projets) :
   elles se testent sans navigateur. Les écritures passent par save().
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  const MAX_TAGS = 8, MAX_LEN = 24;
  const norm = s => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim().slice(0, MAX_LEN).trim();
  const keyOf = s => norm(s).toLowerCase();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ProjectTags = {
    MAX_TAGS, MAX_LEN,

    /** Liste ou texte « a, b » → tags propres, dans l'ordre de saisie. */
    clean(list) {
      const src = Array.isArray(list) ? list : String(list == null ? '' : list).split(',');
      const out = [], seen = new Set();
      for (const t of src) {
        const n = norm(t), k = n.toLowerCase();
        if (!n || seen.has(k)) continue;
        seen.add(k); out.push(n);
        if (out.length >= MAX_TAGS) break;
      }
      return out;
    },

    /** [{ name, n }] trié par usage — la première graphie rencontrée gagne. */
    counts(projects) {
      const map = new Map();
      (projects || []).forEach(p => this.clean(p && p.tags).forEach(t => {
        const k = t.toLowerCase();
        if (!map.has(k)) map.set(k, { name: t, n: 0 });
        map.get(k).n++;
      }));
      return [...map.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'fr'));
    },

    /** Renomme `from` en `to` sur tous les projets (fusion si `to` existe).
        Retourne le nombre de projets modifiés. */
    rename(projects, from, to) {
      const k = keyOf(from), next = norm(to);
      if (!k || !next) return 0;
      let changed = 0;
      (projects || []).forEach(p => {
        const tags = this.clean(p && p.tags);
        if (!tags.some(t => t.toLowerCase() === k)) return;
        p.tags = this.clean(tags.map(t => (t.toLowerCase() === k ? next : t)));
        changed++;
      });
      return changed;
    },

    /** Retire un tag de tous les projets. Retourne le nombre de projets modifiés. */
    remove(projects, tag) {
      const k = keyOf(tag);
      if (!k) return 0;
      let changed = 0;
      (projects || []).forEach(p => {
        const tags = this.clean(p && p.tags);
        const kept = tags.filter(t => t.toLowerCase() !== k);
        if (kept.length === tags.length) return;
        p.tags = kept; changed++;
      });
      return changed;
    },

    /* ── navigateur ─────────────────────────────────────────────────────── */
    _projects() { try { return JSON.parse(localStorage.getItem('hub_projects') || '[]') || []; } catch { return []; } },
    save(projects) {
      localStorage.setItem('hub_projects', JSON.stringify(projects));
      if (typeof root.renderProjects === 'function') root.renderProjects();
      if (typeof root.edRefreshPreview === 'function') root.edRefreshPreview();
    },

    /**
     * Éditeur à pastilles. Entrée ou virgule ajoute, Retour arrière sur un
     * champ vide retire la dernière, un clic sur une suggestion l'ajoute.
     * @returns {{ get: () => string[] }}
     */
    mount(box, initial) {
      let tags = this.clean(initial);
      const known = () => this.counts(this._projects()).map(t => t.name);
      const draw = () => {
        const have = new Set(tags.map(t => t.toLowerCase()));
        const sugg = known().filter(t => !have.has(t.toLowerCase())).slice(0, 10);
        box.innerHTML = `
          <div class="tg-box">${tags.map((t, i) =>
            `<span class="tg-chip">${esc(t)}<button type="button" data-i="${i}" aria-label="Retirer ${esc(t)}">×</button></span>`).join('')}
            <input class="tg-in" maxlength="${MAX_LEN}" placeholder="${tags.length >= MAX_TAGS ? MAX_TAGS + ' tags max' : 'Ajouter un tag…'}"${tags.length >= MAX_TAGS ? ' disabled' : ''}>
          </div>
          ${sugg.length ? `<div class="tg-sugg"><span>Déjà utilisés :</span>${sugg.map(t =>
            `<button type="button" class="tg-s" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}`;
        const input = box.querySelector('.tg-in');
        const add = v => { const next = this.clean([...tags, ...String(v).split(',')]); if (next.length !== tags.length) { tags = next; draw(); box.querySelector('.tg-in')?.focus(); } else if (input) input.value = ''; };
        box.querySelectorAll('.tg-chip button').forEach(b => b.onclick = () => { tags.splice(+b.dataset.i, 1); draw(); });
        box.querySelectorAll('.tg-s').forEach(b => b.onclick = () => add(b.dataset.t));
        if (!input) return;
        input.onkeydown = e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
          else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); draw(); box.querySelector('.tg-in')?.focus(); }
        };
        // Un tag tapé sans Entrée n'est pas perdu à l'enregistrement.
        input.onblur = () => { if (input.value.trim()) add(input.value); };
      };
      draw();
      return { get: () => { const pending = box.querySelector('.tg-in'); return this.clean([...tags, ...String(pending ? pending.value : '').split(',')]); } };
    },

    /** Fenêtre 🏷 Tags de l'éditeur. */
    openManager(anchor) {
      if (!root.EdWin) return;
      const draw = () => {
        const list = this.counts(this._projects());
        // SiteConfig est un `const` global de core.js, pas une propriété de window.
        const cfg = typeof SiteConfig !== 'undefined' ? SiteConfig.get() : {};
        return `
          <p class="edw-hint">Un tag renommé sous le nom d'un tag existant les <b>fusionne</b>. Les projets ne sont jamais supprimés.</p>
          ${list.length ? list.map(t => `
            <div class="tg-row">
              <input class="edw-in tg-name" value="${esc(t.name)}" data-k="${esc(t.name)}" maxlength="${MAX_LEN}" aria-label="Nom du tag ${esc(t.name)}">
              <span class="tg-n">${t.n} projet${t.n > 1 ? 's' : ''}</span>
              <button class="edw-sec-rst tg-del" data-k="${esc(t.name)}" title="Retirer ce tag de tous les projets">✕</button>
            </div>`).join('') : '<div class="edw-hint">Aucun tag pour l\'instant — ajoute-en depuis un projet (✎).</div>'}
          <div class="edw-l">Site public</div>
          <label class="edw-tog"><input type="checkbox" id="tg-filter"${cfg.tagFilter ? ' checked' : ''}> Afficher un filtre par tag au-dessus des projets</label>
          <p class="edw-hint">Le thème Latérale montre déjà ses catégories dans la barre de gauche.</p>`;
      };
      EdWin.open(anchor, '🏷 Tags des projets', `<div id="tg-mgr">${draw()}</div>`, w => {
        const body = w.querySelector('#tg-mgr');
        const bind = () => {
          body.querySelectorAll('.tg-name').forEach(inp => inp.onchange = () => {
            const ps = this._projects();
            const n = this.rename(ps, inp.dataset.k, inp.value);
            if (n) { this.save(ps); root.showToast?.(`Tag renommé sur ${n} projet${n > 1 ? 's' : ''} ✓`, '#2e9a63', 2000); }
            body.innerHTML = draw(); bind();
          });
          body.querySelectorAll('.tg-del').forEach(b => b.onclick = () => {
            const ps = this._projects();
            const n = this.remove(ps, b.dataset.k);
            if (n) { this.save(ps); root.showToast?.(`Tag retiré de ${n} projet${n > 1 ? 's' : ''}`, '#666', 2000); }
            body.innerHTML = draw(); bind();
          });
          const f = body.querySelector('#tg-filter');
          if (f) f.onchange = () => { if (typeof root.edSet === 'function') root.edSet('tagFilter', f.checked); else SiteConfig.set('tagFilter', f.checked); };
        };
        bind();
      }, 'wide');
    },
  };

  root.ProjectTags = ProjectTags;
})(typeof window !== 'undefined' ? window : globalThis);
