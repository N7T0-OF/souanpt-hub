'use strict';
/**
 * core.js — GitHub API + Auth (PAT direct, 100% gratuit, zéro proxy)
 * Déploiement atomique (1 seul commit) + vérification Pages + sync Behance RSS
 */

/* ══════════════════════════════════════════════════════
   GITHUB API
══════════════════════════════════════════════════════ */
const GH = {
  BASE: 'https://api.github.com',

  async api(token, path, opts) {
    const res = await fetch(this.BASE + path, {
      ...opts,
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(opts?.headers || {}),
      },
    });
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'GitHub ' + res.status);
    return data;
  },

  b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  },
  b64dec(str) {
    const bin = atob(str.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },

  async getUser(token)            { return this.api(token, '/user'); },
  async getRepo(token, owner, r)  { return this.api(token, `/repos/${owner}/${r}`); },

  async fileSha(token, owner, repo, path) {
    try { return (await this.api(token, `/repos/${owner}/${repo}/contents/${path}`)).sha || null; }
    catch { return null; }
  },

  async loadFile(token, owner, repo, path) {
    try {
      const res = await this.api(token, `/repos/${owner}/${repo}/contents/${path}`);
      return { data: this.b64dec(res.content), sha: res.sha };
    } catch { return { data: null, sha: null }; }
  },

  /** Crée le dépôt s'il n'existe pas */
  async ensureRepo(token, username, repoName, isPrivate = true) {
    try { await this.api(token, `/repos/${username}/${repoName}`); return; } catch {}
    await this.api(token, '/user/repos', { method: 'POST', body: JSON.stringify({
      name: repoName, private: isPrivate, auto_init: true,
      description: 'souanpt.hub — généré automatiquement',
      has_issues: true,
    })});
    await new Promise(r => setTimeout(r, 2500));
  },

  async putFile(token, owner, repo, path, content, sha, msg) {
    return this.api(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: msg || 'update', content: this.b64enc(content), ...(sha ? {sha} : {}) }),
    });
  },

  /**
   * Commit ATOMIQUE de plusieurs fichiers en un seul commit (Git Data API).
   * Évite les builds Pages concurrents → cause du "Deployment failed, try again later".
   * files: [{ path, content }]
   */
  async commitFiles(token, owner, repo, files, message) {
    const info   = await this.api(token, `/repos/${owner}/${repo}`);
    const branch = info.default_branch || 'main';
    const ref    = await this.api(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const baseSha    = ref.object.sha;
    const baseCommit = await this.api(token, `/repos/${owner}/${repo}/git/commits/${baseSha}`);
    const tree = await this.api(token, `/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
    });
    const commit = await this.api(token, `/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
    });
    await this.api(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    return commit.sha;
  },

  /** Active GitHub Pages (branche main, racine). Idempotent. */
  async enablePages(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages`); } catch {}
    try {
      return await this.api(token, `/repos/${owner}/${repo}/pages`, {
        method: 'POST', body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
      });
    } catch { return null; } // 409 = déjà activé
  },

  async pagesInfo(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages`); } catch { return null; }
  },
  async pagesLatestBuild(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages/builds/latest`); } catch { return null; }
  },
  async pagesRequestBuild(token, owner, repo) {
    try { return await this.api(token, `/repos/${owner}/${repo}/pages/builds`, { method: 'POST' }); } catch { return null; }
  },

  async runs(token, owner, repo, n = 5) {
    try { return (await this.api(token, `/repos/${owner}/${repo}/actions/runs?per_page=${n}`)).workflow_runs || []; }
    catch { return []; }
  },
};

/* ══════════════════════════════════════════════════════
   AUTH — token + user dans localStorage
══════════════════════════════════════════════════════ */
const Auth = {
  _K: 'souanpt_auth_v2',
  get()             { try { return JSON.parse(localStorage.getItem(this._K) || '{}'); } catch { return {}; } },
  save(d)           { localStorage.setItem(this._K, JSON.stringify(d)); },
  token()           { return this.get().token || ''; },
  user()            { return this.get().user  || null; },
  owner()           { return this.user()?.login || ''; },
  set(token, user)  { this.save({ token, user, ts: Date.now() }); },
  clear()           { localStorage.removeItem(this._K); },
  ok()              { return !!this.token(); },
};

/* ══════════════════════════════════════════════════════
   CONNEXION GITHUB
══════════════════════════════════════════════════════ */
const REPO_DATA_SUFFIX = '-hub-data';  // {username}-hub-data (backup privé)
const HUB_REPO_NAME    = 'souanpt-hub'; // repo du dashboard — jamais utilisé comme cible de déploiement
const HUB_HOME_URL     = 'https://n7t0-of.github.io/souanpt-hub/'; // accueil souanpt.hub (cible du badge des sites publiés)
const SITE_REPO_NAME   = 'souanpt-folio'; // repo par défaut du site public

async function connectGitHub(token) {
  const t = token.trim();
  if (!t) throw new Error('Token requis');
  const user = await GH.getUser(t);
  const dataRepo = user.login.toLowerCase() + REPO_DATA_SUFFIX;
  await GH.ensureRepo(t, user.login, dataRepo, true);
  Auth.set(t, { login: user.login, name: user.name, avatar_url: user.avatar_url });
  // Journal des connexions (local)
  try {
    const log = JSON.parse(localStorage.getItem('souanpt_login_log') || '[]');
    log.unshift({ ts: Date.now(), ua: (navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/) || ['Navigateur'])[0] });
    localStorage.setItem('souanpt_login_log', JSON.stringify(log.slice(0, 10)));
  } catch {}
  const cfg = SiteConfig.get();
  if (!cfg.repo || cfg.repo.split('/')[1]?.toLowerCase() === HUB_REPO_NAME) {
    cfg.repo = user.login + '/' + SITE_REPO_NAME;
    SiteConfig.save(cfg);
  }
  return user;
}

/* ══════════════════════════════════════════════════════
   SITE CONFIG
══════════════════════════════════════════════════════ */
const SiteConfig = {
  _K: 'souanpt_site_cfg',
  defaults: () => ({
    siteName: 'FOLIO', bio: 'Designer & Motion Artist',
    accentColor: '#C8FF00', theme: '#060606', layout: '3',
    heroText: 'Créatif · Designer · Motion',
    behance: '', email: '', repo: '',
    sections: { projects: true, avis: true, contact: true, about: true },
    sectionOrder: ['about', 'projects', 'avis', 'contact'],
    avisMode: 'defile',
    about: '', goatcounter: '',
  }),
  get()    { try { return { ...SiteConfig.defaults(), ...JSON.parse(localStorage.getItem(SiteConfig._K) || '{}') }; } catch { return SiteConfig.defaults(); } },
  save(d)  { localStorage.setItem(SiteConfig._K, JSON.stringify(d)); },
  set(k,v) { const d = SiteConfig.get(); d[k] = v; SiteConfig.save(d); },
};

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getProjects() { try { return JSON.parse(localStorage.getItem('hub_projects') || '[]'); } catch { return []; } }
function getReviews()  { try { return JSON.parse(localStorage.getItem('hub_reviews')  || '[]'); } catch { return []; } }

/* ══════════════════════════════════════════════════════
   SITE GENERATOR — navbar style haunt.gg + projets cliquables + avis visiteurs
══════════════════════════════════════════════════════ */
function generateSite(cfg, projects, reviews) {
  if (!cfg)      cfg      = SiteConfig.get();
  if (!projects) projects = getProjects();
  if (!reviews)  reviews  = getReviews();
  const approved = reviews.filter(r => r.status === 'approved');
  const aboutTxt = String(cfg.about || '').trim();
  const sec      = { projects: true, avis: true, contact: true, about: true, ...(cfg.sections || {}) };
  if (!aboutTxt) sec.about = false; // pas de texte → pas de section
  const SEC_KEYS = ['about', 'projects', 'avis', 'contact'];
  const order = (Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder.slice() : SEC_KEYS.slice())
                .filter(k => SEC_KEYS.includes(k));
  SEC_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const avisMode = cfg.avisMode || 'defile';
  const cols   = parseInt(cfg.layout) || 3;
  const dark   = cfg.theme !== '#f8f8f8';
  const textC  = dark ? '#f0ece4' : '#111';
  const mutedC = dark ? 'rgba(240,236,228,.55)' : '#666';
  const sfcC   = dark ? 'rgba(255,255,255,.04)' : '#fff';
  const brdC   = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.1)';
  const navBg  = dark ? 'rgba(10,10,10,.75)' : 'rgba(255,255,255,.8)';
  const repoFull = cfg.repo || '';
  const behanceUser = (cfg.behance || '').replace('@','');
  const GRADS  = ['linear-gradient(135deg,#1a0533,#6B21A8)','linear-gradient(135deg,#0a1628,#1e40af)','linear-gradient(135deg,#0d1f0d,#166534)','linear-gradient(135deg,#2d0a0a,#991b1b)','linear-gradient(135deg,#1a1400,#854d0e)','linear-gradient(135deg,#0a0a1f,#1e1b4b)'];

  const cards = projects.map((p, i) => `
    <article class="pc"${p.url ? ` onclick="window.open('${esc(p.url)}','_blank')" title="Ouvrir le projet"` : ''}>
      <div class="pt" style="${p.cover ? `background:url('${esc(p.cover)}')center/cover` : `background:${GRADS[i%6]}`}">${p.url?'<span class="go">Voir le projet ↗</span>':''}</div>
      <div class="pb">
        <div class="pn">${esc(p.title||'Projet')}</div>
        <div class="ptags">${(p.tags||[]).slice(0,3).map(t=>`<span class="ptag">${esc(t)}</span>`).join('')}</div>
        <div class="pm">${p.views?`👁 ${p.views} · `:''}${p.behance?'<span style="color:#4a8cff">Behance</span>':''}</div>
      </div>
    </article>`).join('') || `<div style="grid-column:1/-1;text-align:center;color:${mutedC};padding:40px">Aucun projet pour le moment</div>`;

  const rvCard = r => `
    <div class="rc">
      <div class="rh"><div class="rav">${esc((r.author||'?')[0].toUpperCase())}</div>
        <div><div class="rn">${esc(r.author)}</div><div class="rs">${'★'.repeat(r.rating||5)}${'☆'.repeat(5-(r.rating||5))}</div></div>
      </div>
      <p class="rt">${esc(r.text)}</p>
      ${r.project?`<div class="rp">· ${esc(r.project)}</div>`:''}
    </div>`;
  const reviewCards = approved.length ? approved.map(rvCard).join('')
    : `<div style="grid-column:1/-1;text-align:center;color:${mutedC};padding:24px;font-size:13px">Sois le premier à laisser un avis ✨</div>`;
  // Défilement infini si assez d'avis, sinon grille
  const useMarquee = avisMode !== 'grille' && approved.length >= 3;
  const mqHalf = `<div class="mqhalf">${approved.map(rvCard).join('')}</div>`;
  const avisDisplay = useMarquee
    ? `<div class="mq"><div class="mqtrack" style="animation-duration:${Math.max(20, approved.length*7)}s">${mqHalf}${mqHalf}</div></div>`
    : `<div class="rg">${reviewCards}</div>`;

  // ── Sections modulaires : visibilité + ordre pilotés par l'éditeur ──
  const SEC_LABELS = { about: 'À propos', projects: 'Projets', avis: 'Avis', contact: 'Contact' };
  const secHtml = {
    about: `<section id="about" class="rev" style="max-width:760px"><div class="sl">À propos</div><h2>Qui suis-je ?</h2><p class="about-p">${esc(aboutTxt).replace(/\n/g,'<br>')}</p></section>`,
    projects: `<section id="projects" class="rev"><div class="sl">Portfolio</div><h2>Mes projets</h2><div class="pg">${cards}</div></section>`,
    avis: `<section id="avis" class="rev"><div class="sl">Témoignages</div><h2>Avis clients</h2>
  ${avisDisplay}
  <div class="leave">
    ${repoFull?`<button class="bg" onclick="document.getElementById('revform').classList.toggle('open')">✎ Laisser un avis</button>
    <form id="revform" onsubmit="return revSend(event)">
      <label>Ton nom</label><input id="rv-n" required maxlength="60" placeholder="Prénom Nom">
      <label>Ta note</label><div id="rvstars"><span class="on">★</span><span class="on">★</span><span class="on">★</span><span class="on">★</span><span class="on">★</span></div>
      <label>Ton avis</label><textarea id="rv-t" required maxlength="600" placeholder="Raconte ton expérience…"></textarea>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button type="submit" class="bp" style="flex:1">Envoyer l'avis</button>
      </div>
      <p class="rhint">L'avis s'envoie via GitHub (compte gratuit requis, 1 clic).${cfg.email?` Ou par email : <a href="#" onclick="return revMail()" style="color:var(--a)">${esc(cfg.email)}</a>`:''}<br>Chaque avis est vérifié avant publication ✓</p>
    </form>`:''}
  </div>
</section>`,
    contact: `<section id="contact" class="ci rev"><div class="sl">Contact</div><h2>Travaillons ensemble</h2><div class="ctas" style="margin-top:20px">${cfg.email?`<a href="mailto:${esc(cfg.email)}" class="bp">${esc(cfg.email)}</a>`:''} ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" class="bg">Behance →</a>`:''}</div></section>`,
  };
  const bodySections = order.filter(k => sec[k]).map(k => secHtml[k]).join('\n');
  const navLinks = order.filter(k => sec[k]).map(k => `<a href="#${k}">${SEC_LABELS[k]}</a>`).join('\n    ');

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${esc(cfg.bio)}">
<title>${esc(cfg.siteName)} — Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--a:${cfg.accentColor};--bg:${cfg.theme};--t:${textC};--m:${mutedC};--s:${sfcC};--b:${brdC};--cols:${cols}}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif}a{color:inherit;text-decoration:none}
/* ── NAVBAR (pilule flottante) ── */
.navwrap{position:sticky;top:14px;z-index:100;display:flex;justify-content:center;padding:0 16px}
nav{display:flex;align-items:center;gap:4px;width:100%;max-width:900px;padding:8px 8px 8px 16px;border-radius:999px;background:${navBg};border:1px solid var(--b);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 10px 40px rgba(0,0,0,.3)}
.logo{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;letter-spacing:-.4px;margin-right:6px;white-space:nowrap}
.logo .ic{width:24px;height:24px;border-radius:8px;background:var(--a);display:inline-flex;align-items:center;justify-content:center;color:#060606;font-size:13px;font-weight:800}
.logo span.d{color:var(--a)}
.nl{display:flex;gap:2px;margin:0 auto}
.nl a{padding:8px 14px;border-radius:999px;font-size:12px;color:var(--m);transition:.2s;white-space:nowrap}
.nl a:hover{color:var(--t);background:rgba(128,128,128,.12)}
.ncta{padding:9px 18px;border-radius:999px;background:var(--a);color:#060606;font-size:12px;font-weight:800;white-space:nowrap;transition:.2s}
.ncta:hover{opacity:.85}
/* ── HERO ── */
.hero{padding:88px 32px 56px;text-align:center;max-width:820px;margin:0 auto}
.htag{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:16px}
h1{font-size:clamp(40px,7vw,76px);font-weight:800;letter-spacing:-2px;line-height:1.06;margin-bottom:16px}h1 span{color:var(--a)}
.hsub{font-size:15px;color:var(--m);margin-bottom:28px;line-height:1.7}
.ctas{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.bp{padding:12px 28px;background:var(--a);color:#060606;border-radius:10px;font-size:13px;font-weight:700;border:none;cursor:pointer;font-family:inherit;transition:.2s;text-decoration:none;display:inline-block}.bp:hover{opacity:.85}
.bg{padding:12px 28px;background:transparent;color:var(--t);border:1px solid var(--b);border-radius:10px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:.2s;text-decoration:none;display:inline-block}.bg:hover{border-color:var(--a);color:var(--a)}
section{padding:48px 32px;max-width:1100px;margin:0 auto}
.sl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:8px}
h2{font-size:24px;font-weight:800;letter-spacing:-.5px;margin-bottom:24px}
/* ── PROJETS ── */
.pg{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:16px}
.pc{background:var(--s);border:1px solid var(--b);border-radius:14px;overflow:hidden;cursor:pointer;transition:all .25s;position:relative}
.pc:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,.3);border-color:var(--a)}
.pt{aspect-ratio:16/10;background:var(--s);position:relative;display:flex;align-items:flex-end;justify-content:flex-end}
.go{opacity:0;transition:.2s;background:var(--a);color:#060606;font-size:10px;font-weight:800;padding:5px 12px;border-radius:999px;margin:10px}
.pc:hover .go{opacity:1}
.pb{padding:14px}.pn{font-size:13px;font-weight:700;margin-bottom:6px}
.ptags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}.ptag{font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(200,255,0,.1);color:var(--a);font-weight:600}
.pm{font-size:10px;color:var(--m)}
/* ── AVIS ── */
.rg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:24px}
.rc{background:var(--s);border:1px solid var(--b);border-radius:14px;padding:18px}
.rh{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.rav{width:34px;height:34px;border-radius:50%;background:rgba(200,255,0,.12);color:var(--a);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.rn{font-size:12px;font-weight:700}.rs{color:#e4b24a;font-size:12px}
.rt{font-size:12px;color:var(--m);line-height:1.7}.rp{font-size:10px;color:var(--m);margin-top:8px;opacity:.7}
/* ── FORM AVIS ── */
.leave{text-align:center}
#revform{display:none;max-width:440px;margin:18px auto 0;text-align:left;background:var(--s);border:1px solid var(--b);border-radius:14px;padding:20px}
#revform.open{display:block}
#revform label{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--m);display:block;margin:12px 0 5px}
#revform input,#revform textarea{width:100%;background:${dark?'rgba(255,255,255,.05)':'#f4f4f4'};border:1px solid var(--b);border-radius:8px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:13px;outline:none}
#revform input:focus,#revform textarea:focus{border-color:var(--a)}
#revform textarea{height:90px;resize:none}
#rvstars{display:flex;gap:4px;font-size:26px;cursor:pointer;color:${dark?'rgba(255,255,255,.2)':'#ddd'}}
#rvstars span{transition:.15s}#rvstars span.on{color:#e4b24a}
.rhint{font-size:10px;color:var(--m);margin-top:10px;line-height:1.6;text-align:center}
.ci{text-align:center;padding:60px 32px;max-width:600px;margin:0 auto}
footer{text-align:center;padding:24px;border-top:1px solid var(--b);font-size:10px;color:var(--m)}
/* ── BADGE "Made by Souanpt HUB" (style Framer) ── */
.made{position:fixed;bottom:16px;right:16px;z-index:200;display:flex;align-items:center;gap:7px;padding:7px 12px 7px 9px;border-radius:999px;background:rgba(10,10,10,.82);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 6px 22px rgba(0,0,0,.35);font-size:11px;font-weight:700;color:#f0ece4;text-decoration:none;transition:transform .2s,box-shadow .2s;font-family:'Syne',system-ui,sans-serif}
.made:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.45)}
.made .mic{width:18px;height:18px;border-radius:5px;background:var(--a);display:inline-flex;align-items:center;justify-content:center;color:#060606;font-size:11px;flex-shrink:0}
.made b{color:var(--a)}
@media(max-width:640px){.made{bottom:12px;right:12px;padding:6px 10px 6px 8px;font-size:10px}}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.pc{animation:fu .4s ease both}${projects.slice(0,12).map((_,i)=>`.pc:nth-child(${i+1}){animation-delay:${i*.05}s}`).join('')}
/* ── À PROPOS ── */
.about-p{font-size:14px;color:var(--m);line-height:1.95}
/* ── AVIS DÉFILEMENT INFINI ── */
.mq{overflow:hidden;margin-bottom:24px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
.mqtrack{display:flex;width:max-content;animation:mqs 40s linear infinite}
.mq:hover .mqtrack{animation-play-state:paused}
.mqhalf{display:flex;gap:14px;padding-right:14px}
.mq .rc{width:280px;flex-shrink:0}
@keyframes mqs{from{transform:translateX(0)}to{transform:translateX(-50%)}}
/* ── APPARITION AU SCROLL ── */
.rev{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}
.rev.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.rev{opacity:1;transform:none;transition:none}.mqtrack{animation:none}}
@media(max-width:640px){.pg{grid-template-columns:1fr!important}.nl{display:none}}
</style></head><body>
<div class="navwrap"><nav>
  <a href="#" class="logo"><span class="ic">✳</span>${esc(cfg.siteName)}<span class="d">.</span></a>
  <div class="nl">
    ${navLinks}
    ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}
  </div>
  <a class="ncta" href="${cfg.email?`mailto:${esc(cfg.email)}`:(sec.contact?'#contact':'#')}">Me contacter</a>
</nav></div>
<div class="hero"><div class="htag">${esc(cfg.heroText)}</div><h1>${esc(cfg.siteName)}<span>.</span></h1><p class="hsub">${esc(cfg.bio)}</p>
<div class="ctas">${sec.projects?'<a href="#projects" class="bp">Voir les projets</a>':''}${cfg.email?`<a href="mailto:${esc(cfg.email)}" class="bg">Me contacter</a>`:''}</div></div>
${bodySections}
<footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
<a class="made" href="${HUB_HOME_URL}" target="_blank" rel="noopener" title="Créé avec Souanpt HUB — clique pour découvrir"><span class="mic">✳</span>Made by <b>Souanpt&nbsp;HUB</b></a>
<script>
var _rvN=5;
document.querySelectorAll('#rvstars span').forEach(function(s,i){
  s.onclick=function(){_rvN=i+1;document.querySelectorAll('#rvstars span').forEach(function(x,j){x.classList.toggle('on',j<_rvN);});};
});
function revSend(e){
  e.preventDefault();
  var n=document.getElementById('rv-n').value.trim(), t=document.getElementById('rv-t').value.trim();
  if(!n||!t)return false;
  var stars='★'.repeat(_rvN)+'☆'.repeat(5-_rvN);
  var title='[AVIS] '+stars+' — '+n;
  var body='Nom: '+n+'\\nNote: '+_rvN+'\\nAvis: '+t+'\\n\\n— envoyé depuis le portfolio';
  window.open('https://github.com/${repoFull}/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body),'_blank');
  return false;
}
function revMail(){
  var n=document.getElementById('rv-n').value.trim()||'', t=document.getElementById('rv-t').value.trim()||'';
  location.href='mailto:${esc(cfg.email||'')}?subject='+encodeURIComponent('[AVIS] '+_rvN+'/5 — '+n)+'&body='+encodeURIComponent(t);
  return false;
}
/* Apparition au scroll */
if ('IntersectionObserver' in window) {
  var _io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_io.unobserve(en.target);}});},{threshold:.12});
  document.querySelectorAll('.rev').forEach(function(el){_io.observe(el);});
} else {
  document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});
}
</script>
${cfg.goatcounter?`<script data-goatcounter="https://${esc(String(cfg.goatcounter).trim())}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`:''}
</body></html>`;
}

/* ══════════════════════════════════════════════════════
   DEPLOY PIPELINE — 1 commit atomique + vérification Pages
══════════════════════════════════════════════════════ */
async function deployPortfolio(onLog, onStep) {
  const token = Auth.token();
  if (!token) throw new Error('Non connecté — connecte GitHub d\'abord');
  const cfg   = SiteConfig.get();
  const owner = Auth.owner();
  if (!owner) throw new Error('Profil GitHub introuvable');

  let repoName = (cfg.repo && cfg.repo.includes('/')) ? cfg.repo.split('/')[1] : (cfg.repo || SITE_REPO_NAME);
  if (!repoName || repoName.toLowerCase() === HUB_REPO_NAME) {
    // Protection : ne JAMAIS écraser le dashboard avec le site généré
    repoName = SITE_REPO_NAME;
    onLog?.('⚠ "' + HUB_REPO_NAME + '" est le repo du dashboard — déploiement redirigé vers ' + owner + '/' + repoName, '#e4b24a');
  }

  onStep?.('behance', 'active'); onLog?.('Récupération des projets et avis…');
  const projects = getProjects();
  const approved = getReviews().filter(r => r.status === 'approved');
  onLog?.(`  → ${projects.length} projet(s) · ${approved.length} avis approuvé(s)`);
  onStep?.('behance', 'done');

  onStep?.('generate', 'active'); onLog?.('Génération du HTML…');
  const cfgToUse = { ...cfg, repo: owner + '/' + repoName };
  const siteHTML = generateSite(cfgToUse, projects);
  onLog?.(`  → ${Math.round(siteHTML.length/1024)} KB`);
  onStep?.('generate', 'done');

  onStep?.('commit', 'active'); onLog?.(`Envoi vers ${owner}/${repoName}…`);
  await GH.ensureRepo(token, owner, repoName, false);
  await GH.enablePages(token, owner, repoName); // activer Pages AVANT le push
  await GH.commitFiles(token, owner, repoName, [
    { path: 'index.html',       content: siteHTML },
    { path: 'site-config.json', content: JSON.stringify(cfgToUse, null, 2) },
    { path: '.nojekyll',        content: '' },
  ], 'deploy: ' + new Date().toISOString().slice(0,16).replace('T',' '));
  onLog?.('  → 1 commit (index.html + config)'); onStep?.('commit', 'done');

  onStep?.('pages', 'active'); onLog?.('Vérification GitHub Pages…');
  const pages = await GH.pagesInfo(token, owner, repoName);
  const url = pages?.html_url || `https://${owner.toLowerCase()}.github.io/${repoName}/`;

  // Poll du build Pages (max ~75s) — retry auto si erreur
  let ok = false, retried = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const b = await GH.pagesLatestBuild(token, owner, repoName);
    const st = b?.status || 'queued';
    if (st === 'built')  { ok = true; break; }
    if (st === 'errored') {
      if (!retried) { retried = true; onLog?.('  → build en erreur, nouvelle tentative…', '#e4b24a'); await GH.pagesRequestBuild(token, owner, repoName); }
      else throw new Error('Build Pages en erreur : ' + (b?.error?.message || 'réessaie dans 1 min'));
    } else {
      onLog?.('  → build ' + st + '…');
    }
  }
  if (ok) onLog?.('  → ✓ Site en ligne : ' + url);
  else    onLog?.('  → Build en cours — le site sera visible d\'ici 1-2 min : ' + url, '#e4b24a');
  onStep?.('pages', 'done');

  SiteConfig.set('lastDeploy', { url, ts: Date.now(), repo: owner + '/' + repoName });
  SiteConfig.set('repo', owner + '/' + repoName);
  return url;
}

const CORS_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
];

/* ══════════════════════════════════════════════════════
   GOATCOUNTER — stats réelles remontées dans le dashboard
   Utilise l'endpoint public /counter/TOTAL.json
   (à activer dans GoatCounter → Settings → "Allow using the
    visitor counter" pour rendre l'endpoint accessible)
══════════════════════════════════════════════════════ */
async function fetchGoatStats() {
  const code = String(SiteConfig.get().goatcounter || '').trim();
  if (!code) return null;
  const url = `https://${code}.goatcounter.com/counter/TOTAL.json`;
  const parse = txt => { const j = JSON.parse(txt); const n = s => parseInt(String(s ?? '0').replace(/[^\d]/g, '')) || 0; return { views: n(j.count), visitors: n(j.count_unique) }; };
  // 1) direct (les endpoints counter envoient du CORS *)
  try { const r = await fetch(url, { headers: { 'Accept': 'application/json' } }); if (r.ok) return parse(await r.text()); } catch {}
  // 2) repli via proxy
  for (const wrap of CORS_PROXIES) {
    try { const r = await fetch(wrap(url)); if (r.ok) { const t = await r.text(); if (t.includes('count')) return parse(t); } } catch {}
  }
  return null;
}

/* ══════════════════════════════════════════════════════
   BEHANCE — sync via flux RSS public (l'API Behance est fermée,
   plus aucune clé API nécessaire — juste le pseudo)
══════════════════════════════════════════════════════ */
const Behance = {
  PROXIES: CORS_PROXIES,

  async fetchProjects(username) {
    const user = (username || '').trim().replace('@','');
    if (!user) throw new Error('Pseudo Behance requis');
    const feed = `https://www.behance.net/feeds/user?username=${encodeURIComponent(user)}`;
    let xml = null, lastErr = null;
    for (const wrap of this.PROXIES) {
      try {
        const res = await fetch(wrap(feed));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        xml = await res.text();
        if (xml.includes('<item')) break;
        xml = null;
      } catch (e) { lastErr = e; }
    }
    if (!xml) throw new Error('Flux Behance injoignable' + (lastErr ? ' (' + lastErr.message + ')' : ''));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = [...doc.querySelectorAll('item')];
    if (!items.length) throw new Error('Aucun projet public trouvé pour @' + user);
    return items.map(it => {
      const g = tag => it.querySelector(tag)?.textContent?.trim() || '';
      const desc = g('description');
      const cover = (desc.match(/src="([^"]+)"/) || [])[1] || '';
      const tags = [...it.querySelectorAll('category')].map(c => c.textContent.trim()).filter(Boolean).slice(0, 4);
      return {
        title: g('title') || 'Projet',
        url:   g('link'),
        cover,
        tags,
        date: new Date(g('pubDate') || Date.now()).getTime(),
      };
    });
  },
};

/** Importe/synchronise les projets Behance dans le portfolio (dédupliqué par URL) */
async function behanceSyncNow(silent) {
  const cfg = SiteConfig.get();
  const user = (cfg.behance || '').replace('@','');
  if (!user) { if (!silent) showToast('Configure ton pseudo Behance d\'abord', '#e4b24a'); return 0; }
  const fetched = await Behance.fetchProjects(user);
  const projects = getProjects();
  let added = 0;
  fetched.forEach(f => {
    const existing = projects.find(p => p.url === f.url);
    if (existing) { // met à jour la cover/les tags si absents
      if (!existing.cover && f.cover) existing.cover = f.cover;
      if ((!existing.tags || !existing.tags.length) && f.tags.length) existing.tags = f.tags;
      return;
    }
    projects.unshift({
      id: 'be' + Date.now() + Math.floor(Math.random()*1000),
      title: f.title, tags: f.tags, url: f.url, cover: f.cover,
      views: 0, behance: true, createdAt: f.date,
    });
    added++;
  });
  localStorage.setItem('hub_projects', JSON.stringify(projects));
  localStorage.setItem('souanpt_last_behance_sync', Date.now().toString());
  window.renderProjects?.(); window.syncKPIs?.();
  if (!silent) showToast(added ? `✓ ${added} projet(s) Behance importé(s)` : '✓ Behance à jour — rien de nouveau', '#2e9a63');
  return added;
}

/* ══════════════════════════════════════════════════════
   AVIS VISITEURS — relevés depuis les Issues GitHub du repo du site
   (le formulaire du site public crée une issue "[AVIS] ★★★★★ — Nom")
══════════════════════════════════════════════════════ */
async function fetchVisitorReviews(silent) {
  const token = Auth.token();
  const cfg   = SiteConfig.get();
  if (!token || !cfg.repo || !cfg.repo.includes('/')) return 0;
  const [owner, repo] = cfg.repo.split('/');
  let issues = [];
  try { issues = await GH.api(token, `/repos/${owner}/${repo}/issues?state=open&per_page=50`); }
  catch { return 0; }
  const avisIssues = (issues || []).filter(i => (i.title || '').startsWith('[AVIS]'));
  if (!avisIssues.length) { if (!silent) showToast('Aucun nouvel avis', '#666', 1500); return 0; }

  const reviews = getReviews();
  let added = 0;
  for (const is of avisIssues) {
    if (reviews.find(r => r.ghIssue === is.number)) continue;
    const body   = is.body || '';
    const rating = Math.min(5, Math.max(1, parseInt((body.match(/Note\s*:\s*(\d)/) || [])[1] || (is.title.match(/★/g) || []).length || 5)));
    const author = ((body.match(/Nom\s*:\s*(.+)/) || [])[1] || is.user?.login || 'Visiteur').trim().slice(0, 60);
    const text   = ((body.match(/Avis\s*:\s*([\s\S]+?)(\n\n—|$)/) || [])[1] || body).trim().slice(0, 600);
    reviews.unshift({
      id: 'gh' + is.number, ghIssue: is.number,
      author, text, rating, status: 'pending',
      project: '', createdAt: new Date(is.created_at).getTime(),
    });
    added++;
    // Ferme l'issue une fois importée (l'avis vit désormais dans le hub)
    try { await GH.api(token, `/repos/${owner}/${repo}/issues/${is.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }); } catch {}
  }
  if (added) {
    localStorage.setItem('hub_reviews', JSON.stringify(reviews));
    window.renderReviews?.();
    showToast(`📥 ${added} nouvel(aux) avis à modérer !`, '#e4b24a', 3500);
  } else if (!silent) {
    showToast('Aucun nouvel avis', '#666', 1500);
  }
  localStorage.setItem('souanpt_last_avis_check', Date.now().toString());
  return added;
}

/* ══════════════════════════════════════════════════════
   AUTO-BACKUP — sauvegarde des données dans le dépôt privé
══════════════════════════════════════════════════════ */
async function autoBackup() {
  const token = Auth.token(); const user = Auth.user();
  if (!token || !user) return;
  try {
    const owner = user.login;
    const repo  = owner.toLowerCase() + REPO_DATA_SUFFIX;
    await GH.ensureRepo(token, owner, repo, true);

    const data = {
      exportedAt: new Date().toISOString(),
      siteConfig: SiteConfig.get(),
      projects:   getProjects(),
      links:      JSON.parse(localStorage.getItem('hub_links')     || '[]'),
      clients:    JSON.parse(localStorage.getItem('hub_clients')   || '[]'),
      invoices:   JSON.parse(localStorage.getItem('hub_invoices')  || '[]'),
      reviews:    getReviews(),
    };

    const { sha } = await GH.loadFile(token, owner, repo, 'backup.json');
    await GH.putFile(token, owner, repo, 'backup.json', JSON.stringify(data, null, 2), sha, 'backup: ' + new Date().toISOString());
    localStorage.setItem('souanpt_last_backup', Date.now().toString());
  } catch {}
}

/** Restaure depuis le dépôt privé GitHub */
async function restoreFromGitHub() {
  const token = Auth.token(); const user = Auth.user();
  if (!token || !user) throw new Error('Connecte GitHub d\'abord');
  const owner = user.login;
  const repo  = owner.toLowerCase() + REPO_DATA_SUFFIX;
  const { data } = await GH.loadFile(token, owner, repo, 'backup.json');
  if (!data) throw new Error('Aucun backup trouvé');
  const parsed = JSON.parse(data);
  if (parsed.siteConfig) SiteConfig.save(parsed.siteConfig);
  if (parsed.projects)   localStorage.setItem('hub_projects', JSON.stringify(parsed.projects));
  if (parsed.links)      localStorage.setItem('hub_links',    JSON.stringify(parsed.links));
  if (parsed.clients)    localStorage.setItem('hub_clients',  JSON.stringify(parsed.clients));
  if (parsed.invoices)   localStorage.setItem('hub_invoices', JSON.stringify(parsed.invoices));
  if (parsed.reviews)    localStorage.setItem('hub_reviews',  JSON.stringify(parsed.reviews));
  return parsed;
}

/* ══════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════ */
function showToast(msg, color, dur) {
  const el = document.getElementById('sm2-toast'); if (!el) return;
  el.textContent = msg; el.style.background = color || '#1a1a1a'; el.style.color = '#fff';
  el.classList.add('show'); clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur || 2500);
}
window.showNotif = msg => showToast(msg);
function timeAgo(ts) {
  const d = Date.now()-ts;
  if(d<60000)return'À l\'instant';if(d<3600000)return Math.floor(d/60000)+'min';
  if(d<86400000)return Math.floor(d/3600000)+'h';return Math.floor(d/86400000)+'j';
}
