/* ══════════════════════════════════════════════════════════════
   haunt.gg — connexion ImageHost (v3.17)
   Envoie images, vidéos et sons sur l'hébergement haunt.gg du compte de
   l'utilisateur, et les choisit depuis le hub : le site ne garde que des
   adresses (plus de limite ~3,5 Mo du stockage du navigateur).

   Clé : sur CET appareil seulement (localStorage `souanpt_haunt_v1`). Elle
   n'est pas dans le registre HubData → jamais sauvegardée sur GitHub ni
   Firestore, jamais publiée. Les appels passent par le relais /api/haunt
   (functions/api/haunt.js) car haunt.gg n'autorise pas les appels directs
   depuis un navigateur (pas d'en-tête CORS).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const KEY_RE = /^haunt_[A-Za-z0-9]{16,80}$/;
  const ERRORS = {
    NO_KEY: 'Clé haunt.gg manquante ou mal copiée.',
    UNAUTHORIZED: 'Clé haunt.gg refusée : vérifie-la ou crée-en une nouvelle.',
    KEY_NOT_FOUND: 'Clé haunt.gg inconnue ou sans la permission nécessaire.',
    KEY_DISABLED: 'Cette clé haunt.gg a été désactivée.',
    INSUFFICIENT_PERMISSIONS: 'La clé n\'a pas la permission pour cette action (ImageHost).',
    KEY_OWNER_UNAVAILABLE: 'Le compte haunt.gg de cette clé est indisponible.',
    INVALID_MIME: 'Type de fichier refusé par haunt.gg.',
    QUOTA_EXCEEDED: 'Ton stockage haunt.gg est plein.',
    FILE_TOO_LARGE: 'Fichier trop lourd pour ton offre haunt.gg.',
    RATE_LIMITED: 'Trop de requêtes : réessaie dans une minute.',
    NOT_FOUND: 'Fichier introuvable sur haunt.gg.',
    ORIGIN: 'Le relais haunt.gg refuse cette adresse de hub.',
    UPSTREAM: 'haunt.gg ne répond pas, réessaie plus tard.',
  };

  const Haunt = {
    STORE: 'souanpt_haunt_v1',
    base() {
      const h = location.hostname;
      if (/\.pages\.dev$/.test(h) || /(^|\.)souanpt-hub\.fr$/.test(h)) return '';
      return (typeof window.GH_RELAY === 'string' && /^https:\/\//.test(window.GH_RELAY)) ? window.GH_RELAY : 'https://souanptjub.pages.dev';
    },
    key() { try { const v = localStorage.getItem(this.STORE) || ''; return KEY_RE.test(v) ? v : ''; } catch { return ''; } },
    validKey(v) { return KEY_RE.test(String(v || '').trim()); },
    setKey(v) { v = String(v || '').trim(); if (!KEY_RE.test(v)) return false; try { localStorage.setItem(this.STORE, v); return true; } catch { return false; } },
    clearKey() { try { localStorage.removeItem(this.STORE); } catch {} },
    connected() { return !!this.key(); },
    masked() { const k = this.key(); return k ? k.slice(0, 8) + '…' + k.slice(-3) : ''; },

    async call(params, init) {
      const key = this.key();
      if (!key) throw Object.assign(new Error(ERRORS.NO_KEY), { code: 'NO_KEY' });
      const qs = new URLSearchParams(params).toString();
      let res;
      try {
        res = await fetch(this.base() + '/api/haunt?' + qs, Object.assign({ cache: 'no-store' }, init, { headers: Object.assign({ 'x-haunt-key': key }, (init && init.headers) || {}) }));
      } catch { throw Object.assign(new Error('Relais haunt.gg injoignable (connexion ou site hors Cloudflare).'), { code: 'NETWORK' }); }
      let body = null; try { body = await res.json(); } catch {}
      if (!res.ok || (body && body.error)) {
        const code = (body && body.code) || ('HTTP_' + res.status);
        throw Object.assign(new Error(ERRORS[code] || (body && body.error) || ('Erreur haunt.gg (' + res.status + ')')), { code, status: res.status });
      }
      return body;
    },
    list(o) { o = o || {}; return this.call({ op: 'uploads', type: o.type || 'all', limit: String(o.limit || 40), offset: String(o.offset || 0), ...(o.search ? { search: String(o.search).slice(0, 100) } : {}) }); },
    upload(file) { const fd = new FormData(); fd.append('file', file, file.name || 'fichier'); return this.call({ op: 'upload' }, { method: 'POST', body: fd }); },
    remove(id) { return this.call({ op: 'delete', id: String(id) }, { method: 'DELETE' }); },
    async test() { const r = await this.list({ limit: 1 }); return { total: r.total | 0 }; },
    /** Adresse à intégrer : le fichier brut du CDN (rawUrl), en https. */
    src(item) { const u = item && (item.rawUrl || item.url) || ''; return /^https:\/\//.test(u) ? u : ''; },
  };

  /* ── Sélecteur de fichiers haunt.gg (fenêtre modale autonome) ── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HauntPicker = {
    /** open({ type:'image'|'audio'|'video'|'all', multiple, title, onPick(items) }) */
    open(opts) {
      opts = Object.assign({ type: 'image', multiple: true, title: 'Mes fichiers haunt.gg' }, opts || {});
      if (!Haunt.connected()) { showToast?.('Connecte d\'abord haunt.gg dans Paramètres → Compte → Connexions', '#e4b24a', 4000); return; }
      this.close();
      const accept = { image: 'image/png,image/jpeg,image/webp,image/gif,image/avif', audio: 'audio/*', video: 'video/mp4,video/webm,video/quicktime', all: '' }[opts.type] || '';
      const box = document.createElement('div'); box.id = 'hp-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<div class="hp-card"><div class="hp-head"><b>👻 ${esc(opts.title)}</b><span class="hp-sp"></span>
          <label class="btn btn-ghost hp-up">⬆ Envoyer<input type="file" ${accept ? `accept="${accept}"` : ''} multiple hidden></label>
          <button class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        <div class="hp-msg"></div><div class="hp-grid"></div>
        <div class="hp-foot"><button class="btn btn-ghost" data-more hidden>Plus de fichiers</button><span class="hp-sp"></span>
          <span class="hp-count"></span><button class="btn" data-ok disabled>Ajouter</button></div></div>`;
      document.body.appendChild(box);
      const grid = box.querySelector('.hp-grid'), msg = box.querySelector('.hp-msg'), ok = box.querySelector('[data-ok]'), more = box.querySelector('[data-more]'), count = box.querySelector('.hp-count');
      const chosen = new Map(); let offset = 0;
      const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#e05a4f' : ''; };
      const refreshCount = () => { ok.disabled = !chosen.size; count.textContent = chosen.size ? chosen.size + ' choisi' + (chosen.size > 1 ? 's' : '') : ''; };
      const tile = it => {
        const src = Haunt.src(it); if (!src) return null;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'hp-it'; b.title = it.originalName || it.name || '';
        b.innerHTML = it.type === 'image' ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="hp-ic">${it.type === 'audio' ? '🎵' : it.type === 'video' ? '🎬' : '📎'}</span><span class="hp-nm">${esc(it.originalName || it.name)}</span>`;
        b.onclick = () => {
          if (!opts.multiple) { chosen.clear(); grid.querySelectorAll('.hp-it.on').forEach(x => x.classList.remove('on')); }
          if (chosen.has(it.id)) { chosen.delete(it.id); b.classList.remove('on'); } else { chosen.set(it.id, it); b.classList.add('on'); }
          refreshCount();
        };
        return b;
      };
      const load = async () => {
        say('Chargement…'); more.hidden = true;
        try {
          const r = await Haunt.list({ type: opts.type === 'all' ? 'all' : opts.type, limit: 40, offset });
          (r.items || []).forEach(it => { const t = tile(it); if (t) grid.appendChild(t); });
          offset += (r.items || []).length;
          more.hidden = offset >= (r.total | 0);
          say(grid.children.length ? '' : 'Aucun fichier de ce type sur ton haunt.gg : envoie-en un avec ⬆ Envoyer.');
        } catch (e) { say(e.message, true); }
      };
      box.querySelector('input[type=file]').onchange = async e => {
        const files = [...e.target.files]; e.target.value = '';
        for (let i = 0; i < files.length; i++) {
          say('Envoi ' + (i + 1) + '/' + files.length + ' : ' + files[i].name + '…');
          try {
            const it = await Haunt.upload(files[i]);
            const item = { id: it.id, type: String(it.mime || '').split('/')[0], name: it.fileName + '.' + it.fileExtension, originalName: files[i].name, url: it.url, rawUrl: it.rawUrl };
            const t = tile(item); if (t) { grid.prepend(t); t.click(); }
          } catch (err) { say(files[i].name + ' : ' + err.message, true); return; }
        }
        say('Envoyé sur haunt.gg ✓');
      };
      more.onclick = load;
      ok.onclick = () => { const items = [...chosen.values()]; this.close(); try { opts.onPick && opts.onPick(items); } catch (e) { console.error(e); } };
      box.querySelector('[data-x]').onclick = () => this.close();
      box.addEventListener('click', e => { if (e.target === box) this.close(); });
      box.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
      setTimeout(() => box.querySelector('[data-x]').focus(), 20);
      load();
    },
    close() { document.getElementById('hp-modal')?.remove(); },
  };

  /* ── Paramètres → Compte → Connexions : ligne haunt.gg ── */
  const HauntSettings = {
    render() {
      const sub = document.getElementById('conn-haunt-sub'), btn = document.getElementById('conn-haunt-btn');
      if (!sub || !btn) return;
      sub.textContent = Haunt.connected() ? 'Connecté sur cet appareil · ' + Haunt.masked() : 'Non connecté';
      sub.style.color = Haunt.connected() ? 'var(--green)' : '';
      btn.textContent = Haunt.connected() ? 'Gérer' : 'Connecter';
    },
    toggle() {
      const box = document.getElementById('conn-haunt-box'); if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) { const i = document.getElementById('conn-haunt-key'); i.value = ''; i.placeholder = Haunt.connected() ? Haunt.masked() + ' (enregistrée)' : 'haunt_…'; i.focus(); this.msg(''); }
    },
    msg(t, bad) { const m = document.getElementById('conn-haunt-msg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--red)' : 'var(--muted2)'; } },
    async save() {
      const v = document.getElementById('conn-haunt-key').value.trim();
      if (v && !Haunt.validKey(v)) return this.msg('Ce n\'est pas une clé haunt.gg (elle commence par haunt_).', true);
      const prev = Haunt.key();
      if (v) Haunt.setKey(v); else if (!prev) return this.msg('Colle ta clé haunt.gg.', true);
      this.msg('Vérification…');
      try { const r = await Haunt.test(); this.msg('✓ Connecté · ' + r.total + ' fichier' + (r.total > 1 ? 's' : '') + ' sur ton haunt.gg'); document.getElementById('conn-haunt-key').value = ''; }
      catch (e) { if (v) { if (prev) Haunt.setKey(prev); else Haunt.clearKey(); } this.msg(e.message, true); }
      this.render();
    },
    forget() { Haunt.clearKey(); this.render(); this.msg('Clé retirée de cet appareil. Pense à la révoquer sur haunt.gg si tu ne t\'en sers plus.'); },
  };

  window.Haunt = Haunt; window.HauntPicker = HauntPicker; window.HauntSettings = HauntSettings;
  document.addEventListener('DOMContentLoaded', () => HauntSettings.render());
})();
