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
const HUB_HOME_URL     = 'https://souanptjub.pages.dev/'; // accueil souanpt.hub V2 (Cloudflare Pages — cible du badge des sites publiés)
const ANALYTICS_URL    = 'https://souanpt-analytics.titaneolinne13.workers.dev/hit'; // mouchard des sites publiés → agrégats Firestore (Worker gratuit)
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
    layoutStyle: 'float', heroImage: '', projectsLimit: 0,
    animLevel: 'smooth', fx: { tilt: false, intensity: 7, shine: false, lift: false, glow: false, mouseglow: false },
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
function getLinks()    { try { return JSON.parse(localStorage.getItem('hub_links')    || '[]'); } catch { return []; } }

/* ══════════════════════════════════════════════════════
   MODÈLE DE BLOCS — source unique du contenu public.
   Un bloc = une PLACE (w/h sur la grille) + une PRÉSENTATION.
   Les données restent dans hub_projects / hub_links (via `ref`) pour ne rien
   casser (sync Behance, analytics, classement) ; les blocs libres (texte…)
   portent leurs données dans `props`.
   Même modèle pour TOUS les styles : la grille Bento le rend en grille,
   les styles flottant/latéral le regroupent en sections. Changer de style
   n'efface donc jamais un bloc.
     { id, type, w, h, ref?, props?, hidden?, locked? }
     type : profile | project | link | text | reviews | contact
══════════════════════════════════════════════════════ */
const BLOCK_COLS = 4;                       // colonnes de la grille (desktop)
const blockUid = t => 'b_' + t + '_' + Math.random().toString(36).slice(2, 8);

/** Renvoie les blocs du site : ceux enregistrés, sinon migrés depuis l'existant. */
function getBlocks(cfg, projects, links) {
  cfg = cfg || SiteConfig.get();
  if (Array.isArray(cfg.blocks) && cfg.blocks.length) return cfg.blocks;
  return migrateBlocks(cfg, projects, links);
}

/** Migration : projets → blocs Projet, liens → blocs Réseau, à propos → bloc Texte…
    Non destructif : ne touche à aucune donnée, construit seulement la disposition. */
function migrateBlocks(cfg, projects, links) {
  cfg      = cfg || SiteConfig.get();
  projects = projects || getProjects();
  links    = links || getLinks();
  const sec = { projects: true, avis: true, contact: true, about: true, ...(cfg.sections || {}) };
  // ⚠ identifiants DÉTERMINISTES (dérivés de la donnée référencée) : migrateBlocks
  // peut être rappelé à tout moment (getBlocks est un accesseur) et doit toujours
  // rendre les mêmes ids, sinon la sélection/le glisser-déposer ciblent des blocs fantômes.
  const out = [{ id: 'b_profile', type: 'profile', w: 2, h: 2 }];
  if (String(cfg.about || '').trim() && sec.about)
    out.push({ id: 'b_about', type: 'text', w: 2, h: 1, props: { title: 'À propos', text: String(cfg.about) } });
  links.forEach(l => out.push({ id: 'b_link_' + l.id, type: 'link', ref: l.id, w: 1, h: 1 }));
  if (sec.projects) projects.forEach((p, i) =>
    out.push({ id: 'b_proj_' + p.id, type: 'project', ref: p.id, w: i === 0 ? 2 : 1, h: i === 0 ? 2 : 1 }));
  if (sec.avis)    out.push({ id: 'b_reviews', type: 'reviews', w: 2, h: 1 });
  if (sec.contact) out.push({ id: 'b_contact', type: 'contact', w: 1, h: 1 });
  return out;
}

/** Résumé de migration (affiché à l'utilisateur) */
function migrateBlocksSummary(cfg, projects, links) {
  const b = migrateBlocks(cfg, projects, links);
  const n = t => b.filter(x => x.type === t).length;
  return { total: b.length, projects: n('project'), links: n('link'), text: n('text'), reviews: n('reviews'), contact: n('contact') };
}

/* ══════════════════════════════════════════════════════
   SITE GENERATOR — navbar style haunt.gg + projets cliquables + avis visiteurs
══════════════════════════════════════════════════════ */
/** Rendu de la grille Bento depuis les blocs. Conserve data-p / data-l pour l'analytics. */
function renderBentoGrid(blocks, ctx) {
  const { cfg, projects, links, approved, GRADS } = ctx;
  const P = id => projects.find(p => String(p.id) === String(id));
  const L = id => links.find(l => String(l.id) === String(id));
  const platIcon = (t, u) => {
    const s = (t + ' ' + u).toLowerCase();
    if (s.includes('discord')) return '🎮';   if (s.includes('instagram')) return '📸';
    if (s.includes('behance')) return '🎨';   if (s.includes('github')) return '🐙';
    if (s.includes('linkedin')) return '💼';  if (s.includes('tiktok')) return '🎵';
    if (s.includes('youtube')) return '▶';    if (s.includes('twitch')) return '🟣';
    if (s.includes('kofi') || s.includes('ko-fi')) return '☕';
    if (s.includes('mailto') || s.includes('@')) return '✉';
    return '🔗';
  };
  const cell = (b, inner, extra) =>
    `<article class="bn bn-${esc(b.type)}" data-b="${esc(b.id)}" style="--w:${Math.max(1, Math.min(BLOCK_COLS, b.w || 1))};--h:${Math.max(1, b.h || 1)}"${extra || ''}>${inner}</article>`;

  const html = blocks.filter(b => !b.hidden).map(b => {
    if (b.type === 'profile')
      return cell(b, `<div class="bn-av">${esc(String(cfg.siteName || 'S')[0].toUpperCase())}</div>
        ${cfg.heroText ? `<div class="bn-htag">${esc(cfg.heroText)}</div>` : ''}
        <h1 class="bn-name">${esc(cfg.siteName || '')}</h1>
        ${cfg.bio ? `<p class="bn-bio">${esc(cfg.bio)}</p>` : ''}`);
    if (b.type === 'text') {
      const pr = b.props || {};
      return cell(b, `${pr.title ? `<div class="bn-t">${esc(pr.title)}</div>` : ''}<p class="bn-txt">${esc(pr.text || '').replace(/\n/g, '<br>')}</p>`);
    }
    if (b.type === 'link') {
      const l = L(b.ref); if (!l) return '';
      return cell(b, `<span class="bn-ic">${platIcon(l.title || '', l.url || '')}</span><div class="bn-t">${esc(l.title || 'Lien')}</div><div class="bn-sub">${esc(String(l.url || '').replace(/^https?:\/\//, '').slice(0, 30))}</div>`,
        ` data-l="${esc(l.title || 'Lien')}" onclick="window.open('${esc(l.url)}','_blank')"`);
    }
    if (b.type === 'project') {
      const p = P(b.ref); if (!p) return '';
      const i = Math.max(0, projects.indexOf(p));
      return cell(b, `<div class="bn-cov" style="${p.cover ? `background:url('${esc(p.cover)}')center/cover` : `background:${GRADS[i % 6]}`}"></div>
        <div class="bn-pb"><div class="bn-t">${esc(p.title || 'Projet')}</div><div class="ptags">${(p.tags || []).slice(0, 2).map(t => `<span class="ptag">${esc(t)}</span>`).join('')}</div></div>`,
        ` data-p="${esc(p.title || 'Projet')}"${p.url ? ` onclick="window.open('${esc(p.url)}','_blank')"` : ''}`);
    }
    if (b.type === 'reviews') {
      if (!approved.length) return '';
      return cell(b, `<div class="bn-t">★ Avis</div><div class="bn-rv">${approved.slice(0, 3).map(r =>
        `<div class="bn-rvi"><b>${esc(r.author)}</b> <span class="bn-st">${'★'.repeat(r.rating || 5)}</span><p>${esc(r.text)}</p></div>`).join('')}</div>`);
    }
    if (b.type === 'contact') {
      if (!cfg.email) return '';
      return cell(b, `<span class="bn-ic">✉</span><div class="bn-t">Me contacter</div><div class="bn-sub">${esc(cfg.email)}</div>`,
        ` onclick="location.href='mailto:${esc(cfg.email)}'"`);
    }
    return '';
  }).join('');
  return `<div class="bn-grid">${html}</div>`;
}

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
  const layoutStyle = ['sidebar', 'bento'].includes(cfg.layoutStyle) ? cfg.layoutStyle : 'float';
  const links       = getLinks();
  const blocks      = getBlocks(cfg, projects, links);   // même modèle pour tous les styles
  const heroImage   = String(cfg.heroImage || '').trim();
  const projLimit   = parseInt(cfg.projectsLimit) || 0;   // 0 = tous
  const hiddenCount = projLimit && projects.length > projLimit ? projects.length - projLimit : 0;
  const animLevel   = cfg.animLevel || 'smooth';
  const fx          = cfg.fx || {};
  const revDur      = { none: 0, light: .3, smooth: .6, premium: .8 }[animLevel] ?? .6;
  const revY        = animLevel === 'none' ? 0 : animLevel === 'premium' ? 26 : 18;

  const cards = projects.map((p, i) => `
    <article class="pc${projLimit && i >= projLimit ? ' pc-hidden' : ''}" data-tags="${(p.tags||[]).join('|').toLowerCase()}" data-p="${esc(p.title||'Projet')}" data-b="${esc((blocks.find(b => b.type === 'project' && String(b.ref) === String(p.id)) || {}).id || '')}"${p.url ? ` onclick="window.open('${esc(p.url)}','_blank')" title="Ouvrir le projet"` : ''}>
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
  const SEC_ICONS  = { about: '◈', projects: '▦', avis: '★', contact: '✉' };
  const tagList = [...new Set(projects.flatMap(p => (p.tags || []).slice(0, 3)).filter(Boolean))].slice(0, 8);
  const secHtml = {
    about: `<section id="about" class="rev" style="max-width:760px"><div class="sl">À propos</div><h2>Qui suis-je ?</h2><p class="about-p">${esc(aboutTxt).replace(/\n/g,'<br>')}</p></section>`,
    projects: `<section id="projects" class="rev"><div class="prow"><div><div class="sl">Portfolio</div><h2 style="margin-bottom:0">Mes projets</h2></div>${hiddenCount?`<button class="seeall" onclick="document.querySelectorAll('.pc-hidden').forEach(function(e){e.classList.remove('pc-hidden')});this.remove()">Voir tout (+${hiddenCount}) →</button>`:''}</div><div class="pg" style="margin-top:20px">${cards}</div></section>`,
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
@keyframes fuo{from{opacity:0}to{opacity:1}}
${animLevel==='none'?'':`.pc{animation:${fx.tilt?'fuo':'fu'} ${revDur*.7}s ease both}${projects.slice(0,12).map((_,i)=>`.pc:nth-child(${i+1}){animation-delay:${i*.05}s}`).join('')}`}
.pc{transition:transform .18s ease,box-shadow .25s ease}
/* Effets premium — UNIQUEMENT sur ordinateur (souris/trackpad détectés) */
@media (hover:hover) and (pointer:fine){
${fx.tilt?`.pc{transform-style:preserve-3d;transition:transform .1s ease,box-shadow .25s;will-change:transform}`:''}
${fx.lift&&!fx.tilt?`.pc:hover{transform:translateY(-7px)}`:''}
${fx.glow?`.pc:hover{box-shadow:0 16px 42px color-mix(in srgb,var(--a) 32%,transparent)!important}`:''}
${fx.shine?`.pc{position:relative}.pc::before{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.22) 48%,transparent 60%);transform:translateX(-130%);transition:transform .7s ease}.pc:hover::before{transform:translateX(130%)}`:''}
${fx.mouseglow?`.pc::after{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .3s;background:radial-gradient(180px circle at var(--mx,50%) var(--my,50%),color-mix(in srgb,var(--a) 22%,transparent),transparent 60%)}.pc:hover::after{opacity:1}`:''}
}
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
.rev{opacity:${animLevel==='none'?1:0};transform:translateY(${revY}px);transition:opacity ${revDur}s ease,transform ${revDur}s ease}
.rev.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.rev{opacity:1;transform:none;transition:none}.mqtrack{animation:none}}
/* ── MENU MOBILE ── */
.burger{display:none;flex-direction:column;gap:4px;background:none;border:none;cursor:pointer;padding:8px;margin-left:4px}
.burger span{width:20px;height:2px;background:var(--t);border-radius:2px;transition:.25s}
.burger.open span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.burger.open span:nth-child(2){opacity:0}
.burger.open span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.mobmenu{position:fixed;top:70px;left:16px;right:16px;z-index:99;display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:18px;background:${navBg};border:1px solid var(--b);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 20px 50px rgba(0,0,0,.5);opacity:0;transform:translateY(-12px);pointer-events:none;transition:.25s}
.mobmenu.open{opacity:1;transform:none;pointer-events:auto}
.mobmenu a{padding:13px 16px;border-radius:12px;font-size:14px;font-weight:600;color:var(--m)}
.mobmenu a:hover{color:var(--t);background:rgba(128,128,128,.12)}
/* ── Voir plus / catégories ── */
.pc-hidden{display:none}
.prow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.seeall{background:var(--a);color:#060606;border:none;border-radius:999px;padding:9px 18px;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;transition:.2s;white-space:nowrap}
.seeall:hover{opacity:.85}
/* ── STYLE BARRE LATÉRALE ── */
/* ── Style Bento : tout le corps est une grille de blocs ── */
.bn-page{max-width:1080px;margin:0 auto;padding:0 16px 60px}
.bn-grid{display:grid;grid-template-columns:repeat(${BLOCK_COLS},1fr);gap:14px;margin:34px 0;align-items:stretch}
.bn{grid-column:span var(--w,1);grid-row:span var(--h,1);position:relative;display:flex;flex-direction:column;gap:6px;justify-content:center;
    min-height:150px;padding:18px;border:1px solid var(--b);border-radius:14px;background:${dark?'rgba(255,255,255,.025)':'#fafafa'};overflow:hidden}
.bn[onclick]{cursor:pointer}
.bn-t{font-size:14px;font-weight:800;letter-spacing:-.2px;color:var(--t)}
.bn-sub{font-size:11px;color:${mutedC};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bn-txt{font-size:12px;line-height:1.7;color:${mutedC}}
.bn-ic{font-size:22px;line-height:1}
.bn-av{width:52px;height:52px;border-radius:50%;background:var(--a);color:#060606;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;font-family:'Syne',sans-serif}
.bn-htag{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--a)}
.bn-name{font-size:clamp(20px,3vw,30px);font-weight:800;letter-spacing:-1px;color:var(--t)}
.bn-bio{font-size:12px;line-height:1.7;color:${mutedC}}
.bn-project{padding:0;justify-content:flex-start}
.bn-cov{flex:1;min-height:70px;width:100%}
.bn-pb{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.bn-rv{display:flex;flex-direction:column;gap:8px;overflow:hidden}
.bn-rvi{font-size:11px;color:${mutedC};line-height:1.5}
.bn-rvi b{color:var(--t)}
.bn-st{color:var(--a);font-size:10px}
@media(max-width:900px){.bn-grid{grid-template-columns:repeat(2,1fr)}.bn{grid-column:span min(var(--w,1),2)}}
@media(max-width:560px){.bn-grid{grid-template-columns:1fr}.bn{grid-column:span 1;grid-row:span 1}}
.sb-wrap{display:flex;min-height:100vh;gap:14px;padding:14px}
.sb-side{width:230px;flex-shrink:0;position:sticky;top:14px;height:calc(100vh - 28px);padding:24px 16px;display:flex;flex-direction:column;gap:6px;border:1px solid var(--b);border-radius:14px;background:${dark?'rgba(255,255,255,.025)':'#fafafa'};overflow-y:auto}
.sb-logo{display:flex;align-items:center;gap:9px;font-size:18px;font-weight:800;letter-spacing:-.5px;margin-bottom:20px}
.sb-logo .ic{width:28px;height:28px;border-radius:9px;background:var(--a);color:#060606;display:inline-flex;align-items:center;justify-content:center;font-size:15px}
.sb-nav{display:flex;flex-direction:column;gap:2px;background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding:0;border-radius:14px;max-width:none;width:100%}
.sb-nav a{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:600;color:var(--m);transition:.15s}
.sb-nav a:hover{background:rgba(128,128,128,.1);color:var(--t)}
.sb-nav .sbi{width:18px;text-align:center;opacity:.8}
.sb-cat{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--m);margin:20px 12px 8px}
.sb-tags{display:flex;flex-direction:column;gap:1px}
.sb-tags a{padding:8px 12px;border-radius:10px;font-size:12px;color:var(--m);transition:.15s;text-transform:capitalize}
.sb-tags a:hover,.sb-tags a.on{background:rgba(128,128,128,.1);color:var(--t)}
.sb-cta{margin-top:auto;padding:11px;border-radius:10px;background:var(--a);color:#060606;font-size:12px;font-weight:800;text-align:center;transition:.2s}
.sb-cta:hover{opacity:.85}
.sb-main{flex:1;min-width:0;padding:0 12px}
.sb-main section{padding:40px 4px;max-width:none}
.sb-hero{border-radius:14px;min-height:min(56vh,420px);display:flex;align-items:flex-end;padding:34px;position:relative;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.sb-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.72))}
.sb-hero-in{position:relative;z-index:1}
.sb-hero-in .htag{color:#fff;opacity:.85}
.sb-hero-in h1{color:#fff;font-size:clamp(34px,5vw,60px)}
.sb-hero-in .hsub{color:rgba(255,255,255,.8);margin-bottom:0}
@media(max-width:820px){.sb-side{position:fixed;left:-260px;top:14px;transition:.25s;z-index:100}.sb-wrap.open .sb-side{left:14px}.sb-main{padding:0}}
@media(max-width:640px){.pg{grid-template-columns:1fr!important}.nl{display:none}.navcta{display:none}.burger{display:flex}}
</style></head><body>
${layoutStyle === 'bento' ? `
<div class="bn-page">
  <div class="navwrap"><nav>
    <a href="#" class="logo"><span class="ic">✳</span>${esc(cfg.siteName)}<span class="d">.</span></a>
    <div class="nl"></div>
    ${cfg.email ? `<a class="ncta" href="mailto:${esc(cfg.email)}">Me contacter</a>` : ''}
  </nav></div>
  ${renderBentoGrid(blocks, { cfg, projects, links, approved, GRADS })}
  <footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
</div>` : layoutStyle === 'sidebar' ? `
<div class="sb-wrap" id="sbw">
  <aside class="sb-side">
    <a href="#" class="sb-logo"><span class="ic">✳</span>${esc(cfg.siteName)}</a>
    <nav class="sb-nav">
      ${order.filter(k=>sec[k]).map(k=>`<a href="#${k}"><span class="sbi">${SEC_ICONS[k]||'•'}</span>${SEC_LABELS[k]}</a>`).join('')}
      ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank"><span class="sbi">↗</span>Behance</a>`:''}
    </nav>
    ${tagList.length?`<div class="sb-cat">Catégories</div><div class="sb-tags"><a href="#projects" onclick="return filterTag('')" class="on" data-t="">Tous</a>${tagList.map(t=>`<a href="#projects" onclick="return filterTag('${esc(t.toLowerCase())}')" data-t="${esc(t.toLowerCase())}">${esc(t)}</a>`).join('')}</div>`:''}
    ${cfg.email?`<a class="sb-cta" href="mailto:${esc(cfg.email)}">Me contacter</a>`:''}
  </aside>
  <main class="sb-main">
    <div class="sb-hero" style="${heroImage?`background:url('${esc(heroImage)}')center/cover`:`background:${GRADS[0]}`}">
      <div class="sb-hero-in"><div class="htag">${esc(cfg.heroText)}</div><h1>${esc(cfg.siteName)}</h1><p class="hsub">${esc(cfg.bio)}</p></div>
    </div>
    ${bodySections}
    <footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>
  </main>
</div>` : `
<div class="navwrap"><nav>
  <a href="#" class="logo"><span class="ic">✳</span>${esc(cfg.siteName)}<span class="d">.</span></a>
  <div class="nl">
    ${navLinks}
    ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}
  </div>
  <a class="ncta navcta" href="${cfg.email?`mailto:${esc(cfg.email)}`:(sec.contact?'#contact':'#')}">Me contacter</a>
  <button class="burger" aria-label="Menu" onclick="var m=document.getElementById('mm');m.classList.toggle('open');this.classList.toggle('open')"><span></span><span></span><span></span></button>
</nav></div>
<div class="mobmenu" id="mm" onclick="this.classList.remove('open');document.querySelector('.burger').classList.remove('open')">
  ${order.filter(k=>sec[k]).map(k=>`<a href="#${k}">${SEC_LABELS[k]}</a>`).join('')}
  ${behanceUser?`<a href="https://www.behance.net/${esc(behanceUser)}" target="_blank" style="color:#4a8cff">Behance ↗</a>`:''}
  ${cfg.email?`<a href="mailto:${esc(cfg.email)}">Me contacter</a>`:''}
</div>
<div class="hero"><div class="htag">${esc(cfg.heroText)}</div><h1>${esc(cfg.siteName)}<span>.</span></h1><p class="hsub">${esc(cfg.bio)}</p>
<div class="ctas">${sec.projects?'<a href="#projects" class="bp">Voir les projets</a>':''}${cfg.email?`<a href="mailto:${esc(cfg.email)}" class="bg">Me contacter</a>`:''}</div></div>
${bodySections}
<footer>© ${new Date().getFullYear()} ${esc(cfg.siteName)} · <span style="color:var(--a)">●</span> souanpt.hub</footer>`}
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
function filterTag(t){
  document.querySelectorAll('.sb-tags a').forEach(function(a){a.classList.toggle('on',(a.getAttribute('data-t')||'')===t);});
  document.querySelectorAll('.pc').forEach(function(c){
    var tags=(c.getAttribute('data-tags')||'');
    var show = !t || tags.split('|').indexOf(t)>-1;
    c.classList.remove('pc-hidden');
    c.style.display = show ? '' : 'none';
  });
  return false;
}
/* Apparition au scroll */
${animLevel==='none'?`document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});`:`
if ('IntersectionObserver' in window) {
  var _io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_io.unobserve(en.target);}});},{threshold:.12});
  document.querySelectorAll('.rev').forEach(function(el){_io.observe(el);});
} else {
  document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});
}`}
${(fx.tilt||fx.mouseglow)?`
// Effets souris — UNIQUEMENT sur un vrai pointeur (PC/trackpad), jamais sur mobile
if (window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches) {
${fx.tilt?`
  // Effet 3D interactif (Gun.lol / Haunt.gg) — la carte suit la souris, retour doux au centre
  var _ti=${Math.max(3,Math.min(16,Number(fx.intensity)||7))};
  document.querySelectorAll('.pc').forEach(function(c){
    c.addEventListener('mousemove',function(e){var r=c.getBoundingClientRect();var x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;c.style.transform='perspective(700px) rotateY('+(x*_ti)+'deg) rotateX('+(-y*_ti)+'deg) translateY(-4px)';});
    c.addEventListener('mouseleave',function(){c.style.transform='';});
  });`:''}
${fx.mouseglow?`
  // Halo lumineux qui suit le curseur
  document.querySelectorAll('.pc').forEach(function(c){
    c.addEventListener('mousemove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px');});
  });`:''}
}`:''}
</script>
${cfg.ownerUid ? `<script>(function(){var U=${JSON.stringify(String(cfg.ownerUid))},EP=${JSON.stringify(ANALYTICS_URL)};if(!U||location.protocol.indexOf('http')!==0||location.hostname==='localhost'||location.hostname==='127.0.0.1'){return;}var td=new Date().toISOString().slice(0,10),vid,ld,uq=true;try{vid=localStorage.getItem('_shv');if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('_shv',vid);}ld=localStorage.getItem('_shd');uq=ld!==td;localStorage.setItem('_shd',td);}catch(e){}function S(p){p.uid=U;try{var b=JSON.stringify(p);if(navigator.sendBeacon){navigator.sendBeacon(EP,b);}else{fetch(EP,{method:'POST',body:b,keepalive:true,mode:'no-cors'});}}catch(e){}}S({t:'pv',u:uq?1:0,ref:document.referrer||'',ua:navigator.userAgent});var seen={};try{var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){var t=en.target.getAttribute('data-p');if(t){seen[t]=1;}io.unobserve(en.target);}});},{threshold:.5});document.querySelectorAll('[data-p]').forEach(function(el){io.observe(el);});}catch(e){}function F(){var ps=Object.keys(seen);if(ps.length){S({t:'pj',projects:ps});seen={};}}setTimeout(F,4500);addEventListener('pagehide',F);document.querySelectorAll('[data-p]').forEach(function(el){el.addEventListener('click',function(){var t=el.getAttribute('data-p');if(t){S({t:'click',project:t});}});});})();</script>` : ''}
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

/* ══════════════════════════════════════════════════════
   PORTAIL CLIENT — page mission autonome, lien privé sans compte
   Publiée sur le repo du site à /p/{id}/ ; reprend le thème du portfolio.
   Lecture seule (le suivi 2 sens — messagerie, validation, signature —
   nécessitera un backend : c'est la V2 Supabase/Firebase).
══════════════════════════════════════════════════════ */
const PORTAL_STEPS = ['Brief', 'Devis', 'Acompte', 'Production', 'Livraison', 'Terminé'];

function randomId(len = 16) {
  const a = new Uint8Array(len);
  (crypto || window.crypto).getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function generatePortal(p, cfg) {
  cfg = cfg || SiteConfig.get();
  const dark   = cfg.theme !== '#f8f8f8';
  const acc    = cfg.accentColor || '#C8FF00';
  const bg     = dark ? '#0b0b0d' : '#f4f4f6';
  const card   = dark ? 'rgba(255,255,255,.035)' : '#fff';
  const textC  = dark ? '#f0ece4' : '#141414';
  const mutedC = dark ? 'rgba(240,236,228,.55)' : '#666';
  const brdC   = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.1)';
  const total  = Number(p.total) || 0;
  const acPct  = Number(p.acomptePct) || 0;
  const acompte = Math.round(total * acPct / 100);
  const solde   = total - acompte;
  const idx    = Number(p.stepIndex) || 0;
  const acompteRecu = idx >= 2;
  const money  = n => n.toLocaleString('fr-FR') + ' €';
  const STATUS = { brief:'Brief', devis:'Devis', production:'En production', livraison:'Livraison', termine:'Terminé', valide:'Validé' };
  const statusKey = p.status || (idx >= 5 ? 'termine' : idx >= 3 ? 'production' : idx >= 1 ? 'devis' : 'brief');
  const statusLbl = STATUS[statusKey] || 'En cours';

  const steps = PORTAL_STEPS.map((s, i) => {
    const state = i < idx ? 'done' : i === idx ? 'cur' : 'todo';
    const mark = state === 'done' ? '✓' : state === 'cur' ? '●' : '○';
    return `<div class="stp ${state}"><div class="stp-c">${mark}</div><div class="stp-l">${esc(s)}</div></div>`;
  }).join('<div class="stp-line"></div>');

  const deliverables = (p.deliverables || []).filter(d => d && d.url);
  const delivHtml = deliverables.length
    ? deliverables.map(d => `<a class="dl" href="${esc(d.url)}" target="_blank" rel="noopener"><span>📎 ${esc(d.label || 'Fichier')}</span><span class="dl-go">Ouvrir ↗</span></a>`).join('')
    : `<div class="muted" style="padding:6px 2px">Vos fichiers finaux apparaîtront ici à la livraison — accessibles pour toujours depuis ce lien.</div>`;

  const payBtn = (solde > 0 && statusKey !== 'termine' && p.paymentLink)
    ? `<a class="pay" href="${esc(p.paymentLink)}" target="_blank" rel="noopener">Payer le solde — ${money(solde)} →</a>` : '';

  const body = `
<div class="wrap">
  <header class="top">
    <div class="brand"><span class="ic">✳</span> ${esc(cfg.siteName || 'FOLIO')}</div>
    <div class="muted sm">Espace mission sécurisé</div>
  </header>
  <div class="muted sm">Votre espace mission avec</div>
  <h1>${esc(p.mission || 'Mission')}</h1>
  <div class="muted">Avec <b style="color:${textC}">${esc(cfg.siteName || '')}</b>${p.client ? ' · ' + esc(p.client) : ''}</div>
  <div class="row">
    <span class="pin">📌 Retrouvez tout ici — sans email, sans PDF perdu</span>
    <span class="badge">${esc(statusLbl)}</span>
  </div>

  <section class="c">
    <div class="c-t">Avancement de la mission</div>
    <div class="steps">${steps}</div>
    ${p.note ? `<div class="muted sm" style="margin-top:14px">📝 ${esc(p.note)}</div>` : ''}
  </section>

  <section class="c">
    <div class="c-h"><span class="c-t">💰 Suivi financier</span>${acompteRecu ? '<span class="ok">✓ Acompte reçu</span>' : ''}</div>
    <div class="fin"><span>Total mission</span><b>${money(total)}</b></div>
    <div class="fin"><span>Acompte (${acPct}%)</span><b style="color:${acc}">${money(acompte)}</b></div>
    <div class="fin"><span>Solde à la livraison</span><b>${money(solde)}</b></div>
    ${payBtn}
  </section>

  <section class="c">
    <div class="c-h"><span class="c-t">📦 Livrables</span><span class="muted sm">${deliverables.length ? deliverables.length + ' fichier(s)' : 'En attente de livraison'}</span></div>
    ${delivHtml}
  </section>

  <footer class="foot">Propulsé par <a href="${HUB_HOME_URL}" target="_blank" rel="noopener">Souanpt HUB</a> · L'espace client des créatifs freelance</footer>
</div>`;

  const gate = p.password
    ? `<div id="lock"><div class="lockbox"><div class="brand" style="justify-content:center;margin-bottom:8px"><span class="ic">✳</span> ${esc(cfg.siteName || 'FOLIO')}</div><div class="muted sm" style="text-align:center;margin-bottom:14px">Cet espace est protégé par un mot de passe.</div><input id="pw" type="password" placeholder="Mot de passe" onkeydown="if(event.key==='Enter')chk()"><button onclick="chk()">Déverrouiller</button><div id="pwmsg" class="muted sm" style="text-align:center;margin-top:8px;min-height:14px"></div></div></div>` : '';

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>${esc(p.mission || 'Mission')} — Espace client</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root{--a:${acc};--bg:${bg};--c:${card};--t:${textC};--m:${mutedC};--b:${brdC}}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif;line-height:1.5;padding:20px;min-height:100vh}
a{color:inherit;text-decoration:none}
.wrap{max-width:560px;margin:0 auto;animation:fu .4s ease both}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 0 22px}
.brand{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800}
.brand .ic{width:26px;height:26px;border-radius:8px;background:var(--a);color:#060606;display:inline-flex;align-items:center;justify-content:center;font-size:14px}
.muted{color:var(--m)}.sm{font-size:12px}
h1{font-size:clamp(24px,5vw,32px);font-weight:800;letter-spacing:-1px;margin:2px 0 4px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:16px 0 22px}
.pin{font-size:11px;background:rgba(255,90,120,.12);color:#ff6b8a;padding:5px 12px;border-radius:999px;font-weight:700}
.badge{font-size:11px;background:rgba(90,140,255,.15);color:#7aa2ff;padding:5px 12px;border-radius:999px;font-weight:700}
.c{background:var(--c);border:1px solid var(--b);border-radius:16px;padding:18px;margin-bottom:14px}
.c-t{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
.c-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.ok{font-size:12px;color:var(--a);font-weight:700}
.steps{display:flex;align-items:flex-start;justify-content:space-between}
.stp{display:flex;flex-direction:column;align-items:center;gap:7px;flex-shrink:0;width:58px}
.stp-c{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:1.5px solid var(--b);color:var(--m)}
.stp-l{font-size:10px;color:var(--m);text-align:center}
.stp.done .stp-c{background:rgba(255,90,120,.15);border-color:transparent;color:#ff6b8a}
.stp.cur .stp-c{background:var(--a);border-color:transparent;color:#060606;box-shadow:0 0 0 4px rgba(200,255,0,.15)}
.stp.cur .stp-l,.stp.done .stp-l{color:var(--t);font-weight:700}
.stp-line{flex:1;height:1.5px;background:var(--b);margin-top:17px}
.fin{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--b);font-size:14px}
.fin:last-of-type{border-bottom:none}.fin b{font-weight:800}
.pay{display:block;text-align:center;margin-top:14px;padding:13px;background:var(--a);color:#060606;border-radius:10px;font-weight:800;font-size:14px}
.dl{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(128,128,128,.08);border:1px solid var(--b);border-radius:10px;margin-bottom:8px;font-size:13px;font-weight:600;transition:.15s}
.dl:hover{border-color:var(--a)}.dl-go{color:var(--a);font-size:12px;font-weight:700}
.foot{text-align:center;font-size:11px;color:var(--m);padding:20px 0}
.foot a{color:var(--a);font-weight:700}
#lock{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;z-index:10}
.lockbox{width:100%;max-width:340px;background:var(--c);border:1px solid var(--b);border-radius:16px;padding:26px}
.lockbox input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--b);background:transparent;color:var(--t);font-family:inherit;font-size:14px;margin-bottom:10px;outline:none}
.lockbox button{width:100%;padding:11px;border:none;border-radius:8px;background:var(--a);color:#060606;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer}
@media(max-width:480px){.stp{width:44px}.stp-l{font-size:8px}}
</style></head><body>
${gate}
${body}
${p.password ? `<script>
document.querySelector('.wrap').style.display='none';
function chk(){var v=document.getElementById('pw').value;if(v===${JSON.stringify(String(p.password))}){document.getElementById('lock').style.display='none';document.querySelector('.wrap').style.display='';}else{document.getElementById('pwmsg').textContent='Mot de passe incorrect';}}
</script>` : ''}
</body></html>`;
}

/** Détermine le repo du site (jamais le hub) */
function portalRepo(cfg) {
  let repo = (cfg.repo && cfg.repo.includes('/')) ? cfg.repo.split('/')[1] : (cfg.repo || SITE_REPO_NAME);
  if (!repo || repo.toLowerCase() === HUB_REPO_NAME) repo = SITE_REPO_NAME;
  return repo;
}

/**
 * Publie (ou met à jour) le portail sur le repo du site.
 * Corrige le 404 : écrit .nojekyll, active Pages, commit atomique, PUIS
 * attend que le build Pages soit terminé avant de déclarer le lien actif.
 * onStatus(msg) : retour d'état facultatif pour l'UI.
 * → { url, built }
 */
async function publishPortal(p, onStatus) {
  const token = Auth.token(); if (!token) throw new Error('Connecte GitHub d\'abord');
  const owner = Auth.owner(); if (!owner) throw new Error('Profil GitHub introuvable');
  const cfg = SiteConfig.get();
  const repo = portalRepo(cfg);
  onStatus?.('Préparation du repo…');
  await GH.ensureRepo(token, owner, repo, false);
  await GH.enablePages(token, owner, repo);

  const html = p.active === false ? generatePortalDisabled(cfg) : generatePortal(p, cfg);
  const files = [{ path: 'p/' + p.id + '/index.html', content: html }];
  // .nojekyll : sans ça, Jekyll peut ignorer/casser les dossiers → 404
  const hasNojekyll = await GH.fileSha(token, owner, repo, '.nojekyll');
  if (!hasNojekyll) files.push({ path: '.nojekyll', content: '' });
  onStatus?.('Publication de la page…');
  await GH.commitFiles(token, owner, repo, files, 'portal: ' + (p.mission || p.id));

  const url = `https://${owner.toLowerCase()}.github.io/${repo}/p/${p.id}/`;
  // Attend la fin du build Pages (le lien est 404 tant que ce n'est pas "built")
  onStatus?.('Construction GitHub Pages…');
  let built = false;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const b = await GH.pagesLatestBuild(token, owner, repo);
    if (b?.status === 'built') { built = true; break; }
    if (b?.status === 'errored') { await GH.pagesRequestBuild(token, owner, repo); }
    onStatus?.('Construction GitHub Pages… (' + ((i + 1) * 5) + 's)');
  }
  return { url, built };
}

/** Vérifie qu'un portail est réellement en ligne (fichier + build Pages) */
async function verifyPortal(id) {
  const token = Auth.token(); const owner = Auth.owner(); const cfg = SiteConfig.get();
  if (!token || !owner) return { ok: false, reason: 'Non connecté' };
  const repo = portalRepo(cfg);
  const sha = await GH.fileSha(token, owner, repo, 'p/' + id + '/index.html');
  if (!sha) return { ok: false, reason: 'Page introuvable — clique Publier' };
  const b = await GH.pagesLatestBuild(token, owner, repo);
  if (b?.status === 'built') return { ok: true };
  if (b?.status === 'errored') return { ok: false, reason: 'Build Pages en erreur — republie' };
  return { ok: false, reason: 'Build en cours — actif d\'ici ~1 min', pending: true };
}

function generatePortalDisabled(cfg) {
  const acc = cfg.accentColor || '#C8FF00';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Lien désactivé</title>
<style>body{background:#0b0b0d;color:#f0ece4;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}b{color:${acc}}</style></head>
<body><div><div style="font-size:40px;margin-bottom:12px">🔒</div><h1>Lien désactivé</h1><p style="color:rgba(240,236,228,.55);margin-top:8px">Ce lien de mission n'est plus actif.<br>Contacte ton prestataire pour un nouvel accès.</p><p style="margin-top:16px;font-size:12px">Propulsé par <b>Souanpt HUB</b></p></div></body></html>`;
}

const CORS_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
];

/* fetch avec timeout (évite qu'un proxy bloqué fige la sync) */
async function fetchTimeout(url, ms = 12000, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

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
  try { const r = await fetchTimeout(url, 10000, { headers: { 'Accept': 'application/json' } }); if (r.ok) return parse(await r.text()); } catch {}
  // 2) repli via proxy
  for (const wrap of CORS_PROXIES) {
    try { const r = await fetchTimeout(wrap(url), 10000); if (r.ok) { const t = await r.text(); if (t.includes('count')) return parse(t); } } catch {}
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
    let xml = null, lastStatus = 0, timedOut = false;
    for (const wrap of this.PROXIES) {
      try {
        const res = await fetchTimeout(wrap(feed), 12000);
        if (!res.ok) { lastStatus = res.status; continue; }
        const t = await res.text();
        if (t.includes('<item')) { xml = t; break; }
        // réponse vide/valide mais sans projet → on retient et on continue d'essayer
      } catch (e) { if (e.name === 'AbortError') timedOut = true; }
    }
    if (!xml) {
      if (lastStatus === 403 || lastStatus === 401) throw new Error('403 — Behance a bloqué la requête (proxy limité). Réessaie dans quelques minutes.');
      if (lastStatus === 429) throw new Error('429 — trop de requêtes. Patiente une minute avant de relancer.');
      if (timedOut) throw new Error('Délai dépassé — le service relais met trop de temps. Réessaie.');
      throw new Error('Flux Behance injoignable — vérifie le pseudo (behance.net/@' + user + ') et réessaie.');
    }
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
