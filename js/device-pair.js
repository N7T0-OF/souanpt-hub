/* ══════════════════════════════════════════════════════════════
   CONNEXION DU TÉLÉPHONE PAR QR CODE (v3.23) — functions/api/pair.js
   PC connecté : Paramètres → Compte → « 📱 Connecter mon téléphone ».
   Le téléphone scanne, l'ordinateur AUTORISE, le téléphone reçoit sa propre
   session (cookie HttpOnly du relais). Aucun jeton dans le QR, l'URL ou
   l'écran ; QR à usage unique valable 2 min ; QR généré localement
   (js/vendor/qrcode.min.js), jamais par un service tiers.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HASH_RE = /^#pair=([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{24,96})$/;
  const MESSAGES = {
    NO_KV: 'La connexion par QR sera active après la prochaine mise en ligne (stockage Cloudflare à activer).',
    AUTH: 'Connecte-toi d\'abord sur cet ordinateur.',
    EXPIRED: 'QR code expiré — génères-en un nouveau sur l\'ordinateur.',
    USED: 'Ce QR code a déjà été utilisé.',
    DENIED: 'Connexion refusée sur l\'ordinateur.',
    INVALID: 'QR code invalide.',
    ORIGIN: 'Adresse du hub non autorisée par le serveur.',
  };

  /** Origine du relais (Cloudflare) : c'est elle qui pose le cookie de session. */
  function relayOrigin() {
    const h = location.hostname;
    if (/\.pages\.dev$/.test(h) || /(^|\.)souanpt-hub\.fr$/.test(h) || h === 'localhost' || h === '127.0.0.1') return location.origin;
    try { const b = localStorage.getItem('souanpt_relay_base'); if (b && /^https:\/\//.test(b)) return b; } catch {}
    return (typeof window.GH_RELAY === 'string' && /^https:\/\//.test(window.GH_RELAY)) ? window.GH_RELAY : 'https://souanptjub.pages.dev';
  }
  async function call(op, body, asPC) {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    // Mode historique (jeton local) : le PC prouve son identité au relais par son jeton, en en-tête HTTPS.
    if (asPC && typeof Auth !== 'undefined' && !Auth.isRelay() && Auth.token()) headers['x-hub-token'] = Auth.token();
    let r, d = null;
    try { r = await fetch(relayOrigin() + '/api/pair?op=' + op, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body || {}) }); }
    catch { throw Object.assign(new Error('Serveur injoignable — vérifie la connexion.'), { code: 'NETWORK' }); }
    try { d = await r.json(); } catch {}
    if ((r.status === 404 || r.status === 405) && !(d && d.code)) d = { code: 'NO_KV' };   // relais absent (serveur local / version antérieure)
    if (!r.ok) throw Object.assign(new Error(MESSAGES[d && d.code] || (d && d.error) || ('Erreur ' + r.status)), { code: (d && d.code) || 'HTTP_' + r.status });
    return d || {};
  }
  /** « iPhone · Safari », « Android · Chrome »… (affiché à l'ordinateur pour l'autorisation). */
  function deviceName() {
    const ua = navigator.userAgent || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
    const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
    return os + ' · ' + br;
  }
  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }

  const DevicePair = {
    _timer: null, _poll: null,
    /* ── Ordinateur ── */
    async openPC() {
      this.closePC();
      const box = document.createElement('div'); box.id = 'pair-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Connecter mon téléphone');
      box.innerHTML = `<div class="pair-card"><div class="pair-h"><b>📱 Connecter mon téléphone</b><button type="button" class="btn btn-ghost" data-x aria-label="Fermer">✕</button></div>
        <div class="pair-body" id="pair-body"><div class="pair-msg">Préparation du QR code…</div></div></div>`;
      document.body.appendChild(box);
      box.querySelector('[data-x]').onclick = () => this.closePC();
      box.addEventListener('click', ev => { if (ev.target === box) this.closePC(); });
      box.addEventListener('keydown', ev => { if (ev.key === 'Escape') this.closePC(); });
      const body = box.querySelector('#pair-body');
      let p;
      try { p = await call('create', {}, true); }
      catch (err) { body.innerHTML = `<div class="pair-msg bad">${e(err.message)}</div>`; return; }
      const url = relayOrigin() + '/app.html#pair=' + p.id + '.' + p.secret;
      const end = Date.now() + (p.ttl || 120) * 1000;
      body.innerHTML = `<div class="pair-qr" aria-label="QR code de connexion">${qrSvg(url)}</div>
        <ol class="pair-steps"><li>Scanne ce code avec l'appareil photo du téléphone.</li><li>Autorise la connexion ici.</li></ol>
        <div class="pair-msg" id="pair-state">En attente du téléphone… <b id="pair-left"></b></div>
        <div class="pair-act" id="pair-act"></div>`;
      const tick = () => {
        const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        const el = document.getElementById('pair-left'); if (el) el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (!s) this._expired(body);
      };
      tick(); this._timer = setInterval(tick, 1000);
      let asked = false;
      this._poll = setInterval(async () => {
        if (!document.getElementById('pair-modal')) return this.closePC();
        let st; try { st = await call('status', { id: p.id }, true); } catch { return; }
        if (st.st === 'expired') return this._expired(body);
        if (st.st === 'claimed' && !asked) {
          asked = true;
          const qr = body.querySelector('.pair-qr'); if (qr) qr.classList.add('used');
          document.getElementById('pair-state').innerHTML = `<b>${e(st.device || 'Un appareil')}</b> veut se connecter à ton compte.`;
          const act = document.getElementById('pair-act');
          act.innerHTML = `<button type="button" class="btn btn-accent" data-ok>✓ Autoriser</button><button type="button" class="btn btn-ghost" data-no>Refuser</button>`;
          act.querySelector('[data-ok]').onclick = async () => {
            act.innerHTML = '';
            try { await call('approve', { id: p.id }, true); document.getElementById('pair-state').innerHTML = '✓ Téléphone autorisé — il se connecte.'; clearInterval(this._timer); clearInterval(this._poll); setTimeout(() => this.closePC(), 2500); }
            catch (err) { document.getElementById('pair-state').innerHTML = `<span class="bad">${e(err.message)}</span>`; }
          };
          act.querySelector('[data-no]').onclick = async () => {
            act.innerHTML = ''; try { await call('deny', { id: p.id }, true); } catch {}
            document.getElementById('pair-state').textContent = 'Connexion refusée.'; clearInterval(this._timer); clearInterval(this._poll);
          };
        }
      }, 2000);
    },
    _expired(body) {
      clearInterval(this._timer); clearInterval(this._poll);
      if (!body.isConnected) return;
      body.innerHTML = `<div class="pair-msg">QR code expiré.</div><div class="pair-act"><button type="button" class="btn btn-accent" onclick="DevicePair.openPC()">Nouveau QR code</button></div>`;
    },
    closePC() { clearInterval(this._timer); clearInterval(this._poll); document.getElementById('pair-modal')?.remove(); },

    /* ── Téléphone : arrivée par le QR code ── */
    async fromHash() {
      const m = HASH_RE.exec(location.hash || '');
      if (!m) return false;
      const [, id, secret] = m;
      try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
      if (typeof Auth !== 'undefined' && Auth.ok()) { showToast?.('Cet appareil est déjà connecté ✓', 'var(--green)', 3000); return true; }
      const ov = document.createElement('div'); ov.id = 'pair-phone'; ov.setAttribute('role', 'status');
      ov.innerHTML = `<div class="pair-card"><div class="pair-big">📱</div><b>Connexion depuis ton ordinateur</b><div class="pair-msg" id="pp-msg">Vérification du QR code…</div><div class="pair-act"><button type="button" class="btn btn-ghost" data-x>Annuler</button></div></div>`;
      document.body.appendChild(ov);
      let stop = false;
      ov.querySelector('[data-x]').onclick = () => { stop = true; ov.remove(); };
      const say = (t, bad) => { const el = document.getElementById('pp-msg'); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); } };
      let c;
      try { c = await call('claim', { id, secret, device: deviceName() }); }
      catch (err) { say(err.message, true); return true; }
      say('Autorise la connexion sur ton ordinateur (@' + (c.login || '') + ')…');
      const until = Date.now() + 135000;
      while (!stop && Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000));
        let d;
        try { d = await call('redeem', { id, nonce: c.nonce }); }
        catch (err) { if (err.code === 'NETWORK') continue; say(err.message, true); return true; }
        if (d.pending) continue;
        if (d.user) {
          say('✓ Autorisé — ouverture de ton espace…');
          try { await connectGitHubRelay(d.user, relayOrigin()); if (typeof gateHide === 'function') gateHide(); }
          catch (err) { say('Session reçue, mais l\'ouverture a échoué : ' + err.message, true); return true; }
          setTimeout(() => ov.remove(), 1200);
          return true;
        }
      }
      if (!stop) say('Délai dépassé — génère un nouveau QR code sur l\'ordinateur.', true);
      return true;
    },
    _deviceName: deviceName, _qrSvg: qrSvg, _relayOrigin: relayOrigin,
  };
  window.DevicePair = DevicePair;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => DevicePair.fromHash());
  else DevicePair.fromHash();
})();
