'use strict';
/**
 * core.js — GitHub API + Auth (PAT direct, 100% gratuit, zéro proxy)
 * Basé sur le flux : getUser() vérifie → ensureRepo() crée → token en localStorage
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
    const data = await res.json();
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
    })});
    await new Promise(r => setTimeout(r, 2000));
  },

  async putFile(token, owner, repo, path, content, sha, msg) {
    return this.api(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: msg || 'update', content: this.b64enc(content), ...(sha ? {sha} : {}) }),
    });
  },

  async enablePages(token, owner, repo) {
    try { await this.api(token, `/repos/${owner}/${repo}/pages`, {
      method: 'POST', body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
    }); } catch {}
  },

  async runs(token, owner, repo, n = 5) {
    try { return (await this.api(token, `/repos/${owner}/${repo}/actions/runs?per_page=${n}`)).workflow_runs || []; }
    catch { return []; }
  },
};

/* ══════════════════════════════════════════════════════
   AUTH — token + user dans localStorage (équivalent Zustand persist)
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
   CONNEXION GITHUB — flux simple et gratuit
   1. Utilisateur colle son PAT
   2. getUser() vérifie le token
   3. ensureRepo() crée le dépôt privé de données
   4. Token sauvegardé en localStorage
══════════════════════════════════════════════════════ */
const REPO_DATA_SUFFIX = '-hub-data'; // {username}-hub-data

async function connectGitHub(token) {
  const t = token.trim();
  if (!t) throw new Error('Token requis');
  const user = await GH.getUser(t);                      // vérifie le token
  const dataRepo = user.login.toLowerCase() + REPO_DATA_SUFFIX;
  await GH.ensureRepo(t, user.login, dataRepo, true);     // crée le dépôt privé
  Auth.set(t, { login: user.login, name: user.name, avatar_url: user.avatar_url });
  const cfg = SiteConfig.get();
  if (!cfg.repo) { cfg.repo = user.login + '/souanpt-hub'; SiteConfig.save(cfg); }
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
  }),
  get()    { try { return { ...SiteConfig.defaults(), ...JSON.parse(localStorage.getItem(SiteConfig._K) || '{}') }; } catch { return SiteConfig.defaults(); } },
  save(d)  { localStorage.setItem(SiteConfig._K, JSON.stringify(d)); },
  set(k,v) { const d = SiteConfig.get(); d[k] = v; SiteConfig.save(d); },
};

/* ══════════════════════════════════════════════════════
   SITE GENERATOR
══════════════════════════════════════════════════════ */
function generateSite(cfg, projects) {
  if (!cfg)      cfg      = SiteConfig.get();
  if (!projects) projects = JSON.parse(localStorage.getItem('hub_projects') || '[]');
  const cols = parseInt(cfg.layout) || 3;
  const dark = cfg.theme !== '#f8f8f8';
  const textC  = dark ? '#f0ece4' : '#111';
  const mutedC = dark ? 'rgba(240,236,228,.5)' : '#666';
  const sfcC   = dark ? 'rgba(255,255,255,.04)' : '#fff';
  const brdC   = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.1)';
  const GRADS  = ['linear-gradient(135deg,#1a0533,#6B21A8)','linear-gradient(135deg,#0a1628,#1e40af)','linear-gradient(135deg,#0d1f0d,#166534)','linear-gradient(135deg,#2d0a0a,#991b1b)','linear-gradient(135deg,#1a1400,#854d0e)','linear-gradient(135deg,#0a0a1f,#1e1b4b)'];
  const cards = projects.map((p, i) => `
    <article class="pc" ${p.url ? `onclick="window.open('${p.url}','_blank')"` : ''}>
      <div class="pt" style="${p.cover ? `background:url(${p.cover})center/cover` : `background:${GRADS[i%6]}`}"></div>
      <div class="pb">
        <div class="pn">${p.title||'Projet'}</div>
        <div class="ptags">${(p.tags||[]).slice(0,3).map(t=>`<span class="ptag">${t}</span>`).join('')}</div>
        <div class="pm">${p.views?`👁 ${p.views}`:''}${p.behance?' · <span style="color:#4a8cff">Behance</span>':''}</div>
      </div>
    </article>`).join('') || `<div style="grid-column:span ${cols};text-align:center;color:${mutedC};padding:40px">Aucun projet</div>`;
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${cfg.bio}">
<title>${cfg.siteName} — Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--a:${cfg.accentColor};--bg:${cfg.theme};--t:${textC};--m:${mutedC};--s:${sfcC};--b:${brdC};--cols:${cols}}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif}a{color:inherit;text-decoration:none}
nav{position:sticky;top:0;z-index:50;height:56px;display:flex;align-items:center;padding:0 32px;gap:24px;background:var(--bg);backdrop-filter:blur(20px);border-bottom:1px solid var(--b)}
.logo{font-size:16px;font-weight:800;letter-spacing:-.5px}.logo span{color:var(--a)}
.nl{display:flex;gap:4px;margin-left:auto}.nl a{padding:6px 14px;border-radius:20px;font-size:12px;color:var(--m);transition:.2s}.nl a:hover{color:var(--t)}
.hero{padding:80px 32px 56px;text-align:center;max-width:800px;margin:0 auto}
.htag{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:16px}
h1{font-size:clamp(40px,7vw,72px);font-weight:800;letter-spacing:-2px;line-height:1.08;margin-bottom:16px}h1 span{color:var(--a)}
.hsub{font-size:15px;color:var(--m);margin-bottom:28px;line-height:1.7}
.ctas{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.bp{padding:12px 28px;background:var(--a);color:#060606;border-radius:8px;font-size:13px;font-weight:700;border:none;cursor:pointer;font-family:inherit;transition:.2s;text-decoration:none;display:inline-block}.bp:hover{opacity:.85}
.bg{padding:12px 28px;background:transparent;color:var(--t);border:1px solid var(--b);border-radius:8px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:.2s;text-decoration:none;display:inline-block}.bg:hover{border-color:var(--a);color:var(--a)}
section{padding:48px 32px;max-width:1100px;margin:0 auto}
.sl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:8px}
h2{font-size:24px;font-weight:800;letter-spacing:-.5px;margin-bottom:24px}
.pg{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:16px}
.pc{background:var(--s);border:1px solid var(--b);border-radius:12px;overflow:hidden;cursor:pointer;transition:all .25s}
.pc:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,.3)}
.pt{aspect-ratio:16/10;background:var(--s)}.pb{padding:14px}.pn{font-size:13px;font-weight:700;margin-bottom:6px}
.ptags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}.ptag{font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(200,255,0,.1);color:var(--a);font-weight:600}
.pm{font-size:10px;color:var(--m)}.ci{text-align:center;padding:60px 32px;max-width:600px;margin:0 auto}
footer{text-align:center;padding:24px;border-top:1px solid var(--b);font-size:10px;color:var(--m)}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.pc{animation:fu .4s ease both}${projects.slice(0,12).map((_,i)=>`.pc:nth-child(${i+1}){animation-delay:${i*.05}s}`).join('')}
@media(max-width:600px){.pg{grid-template-columns:1fr!important}.nl{display:none}}
</style></head><body>
<nav><a href="#" class="logo">${cfg.siteName}<span>.</span></a><div class="nl"><a href="#projects">Projets</a><a href="#contact">Contact</a>${cfg.behance?`<a href="https://www.behance.net/${cfg.behance}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}</div></nav>
<div class="hero"><div class="htag">${cfg.heroText}</div><h1>${cfg.siteName}<span>.</span></h1><p class="hsub">${cfg.bio}</p>
<div class="ctas"><a href="#projects" class="bp">Voir les projets</a>${cfg.email?`<a href="mailto:${cfg.email}" class="bg">Me contacter</a>`:''}</div></div>
<section id="projects"><div class="sl">Portfolio</div><h2>Mes projets</h2><div class="pg">${cards}</div></section>
<section id="contact" class="ci"><div class="sl">Contact</div><h2>Travaillons ensemble</h2><div class="ctas" style="margin-top:20px">${cfg.email?`<a href="mailto:${cfg.email}" class="bp">${cfg.email}</a>`:''} ${cfg.behance?`<a href="https://www.behance.net/${cfg.behance}" target="_blank" class="bg">Behance →</a>`:''}</div></section>
<footer>© ${new Date().getFullYear()} ${cfg.siteName} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
</body></html>`;
}

/* ══════════════════════════════════════════════════════
   DEPLOY PIPELINE
══════════════════════════════════════════════════════ */
async function deployPortfolio(onLog, onStep) {
  const token = Auth.token();
  if (!token) throw new Error('Non connecté — connecte GitHub d\'abord');
  const cfg   = SiteConfig.get();
  const owner = Auth.owner();
  if (!owner) throw new Error('Profil GitHub introuvable');
  const repoName = cfg.repo ? cfg.repo.split('/')[1] : 'souanpt-hub';

  onStep?.('behance', 'active'); onLog?.('Récupération des projets…');
  const projects = JSON.parse(localStorage.getItem('hub_projects') || '[]');
  onLog?.(`  → ${projects.length} projet(s)`);
  onStep?.('behance', 'done');

  onStep?.('generate', 'active'); onLog?.('Génération du HTML…');
  const siteHTML = generateSite(cfg, projects);
  onLog?.(`  → ${Math.round(siteHTML.length/1024)} KB`);
  onStep?.('generate', 'done');

  onStep?.('commit', 'active'); onLog?.(`Envoi vers ${owner}/${repoName}…`);
  await GH.ensureRepo(token, owner, repoName, false);
  const sha = await GH.fileSha(token, owner, repoName, 'index.html');
  await GH.putFile(token, owner, repoName, 'index.html', siteHTML, sha, 'deploy: ' + new Date().toISOString().slice(0,10));
  const cfgSha = await GH.fileSha(token, owner, repoName, 'site-config.json');
  await GH.putFile(token, owner, repoName, 'site-config.json', JSON.stringify({...cfg}, null, 2), cfgSha, 'config: update');
  onLog?.('  → Commité'); onStep?.('commit', 'done');

  onStep?.('pages', 'active'); onLog?.('Activation GitHub Pages…');
  await GH.enablePages(token, owner, repoName);
  const url = `https://${owner.toLowerCase()}.github.io/${repoName}`;
  onLog?.(`  → ${url}`); onStep?.('pages', 'done');
  SiteConfig.set('lastDeploy', { url, ts: Date.now(), repo: owner+'/'+repoName });
  SiteConfig.set('repo', owner+'/'+repoName);
  return url;
}

/* ══════════════════════════════════════════════════════
   AUTO-BACKUP — sauvegarde des données dans le dépôt privé
   Utilise loadFile/saveFile exactement comme l'exemple fourni
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
      projects:   JSON.parse(localStorage.getItem('hub_projects')  || '[]'),
      links:      JSON.parse(localStorage.getItem('hub_links')     || '[]'),
      clients:    JSON.parse(localStorage.getItem('hub_clients')   || '[]'),
      invoices:   JSON.parse(localStorage.getItem('hub_invoices')  || '[]'),
      reviews:    JSON.parse(localStorage.getItem('hub_reviews')   || '[]'),
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
