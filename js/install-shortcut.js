/* ══════════════════════════════════════════════════════════════════════════
   Bouton « Ajouter un raccourci » — téléphones et tablettes uniquement.

   souanpt.hub reste un SITE : pas d'APK. Sur mobile, il s'installe comme une
   application web (icône sur l'écran d'accueil, plein écran) grâce à
   manifest.webmanifest et sw.js.

     · Chrome, Edge, Samsung Internet (Android) : le bouton ouvre la vraie
       fenêtre d'installation du navigateur (beforeinstallprompt).
     · Safari (iPhone, iPad) n'en propose pas : le bouton affiche les deux
       gestes à faire (Partager → « Sur l'écran d'accueil »).
     · Autres navigateurs : indication du menu à utiliser.

   Masqué sur ordinateur, quand le site est déjà ouvert depuis le raccourci,
   et pendant 30 jours après un clic sur ✕.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const KEY = 'souanpt_shortcut_dismissed_at';
  const SNOOZE_MS = 30 * 86400000;
  let deferred = null;

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Téléphone ou tablette : écran tactile principal, ou système mobile déclaré.
  const isHandheld = () => isIOS || /Android|Mobile|Tablet|Silk|Kindle/i.test(ua)
    || (window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
  const installed = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const snoozed = () => {
    try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < SNOOZE_MS; } catch { return false; }
  };

  // Service worker : seulement en HTTPS (ou localhost), condition des navigateurs.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  const css = `
#sh-btn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:860;display:flex;align-items:center;gap:2px;
  background:var(--accent,#C8FF00);color:var(--on-accent,#060606);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:700 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif}
#sh-btn button{font:inherit;color:inherit;background:none;border:none;cursor:pointer;min-height:44px}
#sh-btn .sh-go{padding:0 6px 0 16px;display:flex;align-items:center;gap:8px}
#sh-btn .sh-x{width:40px;font-size:16px;opacity:.65}
#sh-btn button:focus-visible{outline:2px solid #060606;outline-offset:-4px;border-radius:999px}
#sh-sheet{position:fixed;inset:0;z-index:870;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:0 12px calc(12px + env(safe-area-inset-bottom,0px))}
#sh-sheet .sh-card{width:min(420px,100%);background:#111;color:#f0ece4;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px 18px;
  font:14px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
#sh-sheet h2{font-size:16px;margin:0 0 10px}
#sh-sheet ol{margin:0 0 16px 20px;padding:0}
#sh-sheet li{margin:6px 0}
#sh-sheet b{color:var(--accent,#C8FF00)}
#sh-sheet .sh-ok{width:100%;min-height:44px;border:none;border-radius:10px;background:var(--accent,#C8FF00);color:var(--on-accent,#060606);font:700 14px system-ui,sans-serif;cursor:pointer}
@media print{#sh-btn{display:none}}`;

  function hide() { document.getElementById('sh-btn')?.remove(); }

  function help() {
    const steps = isIOS
      ? '<li>Touche <b>Partager</b> (le carré avec une flèche ↑) en bas ou en haut de Safari.</li><li>Choisis <b>Sur l\'écran d\'accueil</b>, puis <b>Ajouter</b>.</li>'
      : '<li>Ouvre le <b>menu</b> du navigateur (⋮ ou ☰).</li><li>Choisis <b>Ajouter à l\'écran d\'accueil</b> ou <b>Installer l\'application</b>.</li>';
    const sheet = document.createElement('div');
    sheet.id = 'sh-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'sh-title');
    sheet.innerHTML = `<div class="sh-card"><h2 id="sh-title">Ajouter souanpt.hub à l'écran d'accueil</h2><ol>${steps}</ol>
      <button type="button" class="sh-ok">J'ai compris</button></div>`;
    const close = () => { sheet.remove(); document.querySelector('#sh-btn .sh-go')?.focus(); };
    sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('.sh-ok')) close(); });
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(sheet);
    sheet.querySelector('.sh-ok').focus();
  }

  async function install() {
    if (!deferred) return help();
    const prompt = deferred; deferred = null;
    prompt.prompt();
    try { const choice = await prompt.userChoice; if (choice && choice.outcome === 'accepted') hide(); } catch {}
  }

  function show() {
    if (document.getElementById('sh-btn') || installed() || !isHandheld() || snoozed()) return;
    if (!document.getElementById('sh-style')) {
      const s = document.createElement('style'); s.id = 'sh-style'; s.textContent = css; document.head.appendChild(s);
    }
    const box = document.createElement('div');
    box.id = 'sh-btn';
    box.innerHTML = '<button type="button" class="sh-go"><span aria-hidden="true">📲</span>Ajouter un raccourci</button>'
      + '<button type="button" class="sh-x" aria-label="Masquer pendant 30 jours">✕</button>';
    box.querySelector('.sh-go').onclick = install;
    box.querySelector('.sh-x').onclick = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} hide(); };
    document.body.appendChild(box);
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  window.addEventListener('appinstalled', hide);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();

  window.InstallShortcut = { show, help, isHandheld, installed };
})();
