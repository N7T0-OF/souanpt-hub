'use strict';
/* ui.js — dépend de core.js */

/* ══════════════════════════════════════════════════════
   GITHUB PAGE
══════════════════════════════════════════════════════ */
const GHPage = {
  async init() {
    if (Auth.ok()) {
      this.showConnected(Auth.user());
      this.loadRepo();
      this.loadRuns();
    } else {
      this.showDisconnected();
    }
    const ri = document.getElementById('gh-repo-inp');
    if (ri) {
      const cfg = SiteConfig.get();
      const u   = Auth.owner();
      ri.value  = cfg.repo || (u ? u + '/' + SITE_REPO_NAME : '');
      ri.placeholder = 'username/' + SITE_REPO_NAME;
    }
  },

  showConnected(user) {
    if (!user) return;
    const av = document.getElementById('gh-avatar');
    if (av && user.avatar_url) av.innerHTML = `<img src="${user.avatar_url}" style="width:42px;height:42px;border-radius:50%;object-fit:cover">`;
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('gh-connect-name', '@' + user.login);
    set('gh-connect-sub',  user.name || 'Connecté avec GitHub');
    const badge = document.getElementById('gh-connect-badge');
    if (badge) { badge.textContent='CONNECTÉ'; badge.style.cssText='background:rgba(46,154,99,.15);color:#2e9a63;font-size:9px;padding:3px 10px;border-radius:10px;font-weight:700'; }
    const btn = document.getElementById('gh-connect-btn');
    if (btn) { btn.textContent='✓ Connecté'; btn.disabled=true; btn.style.opacity='.5'; }
    const dBtn = document.getElementById('gh-disconnect-btn');
    if (dBtn) dBtn.style.display='';
    const main = document.getElementById('gh-main-section');
    if (main) main.style.display='flex';
    // Sync editor badge
    const dot = document.getElementById('ed-gh-dot');
    const lbl = document.getElementById('ed-gh-label');
    if (dot) dot.style.background='#2e9a63';
    if (lbl) lbl.textContent='@'+user.login+' · connecté';
    const sb = document.getElementById('set-gh-badge');
    if (sb) sb.style.display='inline-block';
    // Auto-backup
    setTimeout(autoBackup, 3000);
    setInterval(autoBackup, 5*60*1000);
    // Relève automatique des avis visiteurs (issues GitHub du site)
    setTimeout(() => fetchVisitorReviews(true), 4000);
    setInterval(() => fetchVisitorReviews(true), 5*60*1000);
    // Bubble
    BubbleWidget?.init?.();
  },

  showDisconnected() {
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('gh-connect-name', 'Non connecté');
    set('gh-connect-sub', 'Clique "Se connecter" pour autoriser GitHub en 1 clic');
    const badge = document.getElementById('gh-connect-badge');
    if (badge) { badge.textContent='DÉCONNECTÉ'; badge.style.cssText=''; }
    const btn = document.getElementById('gh-connect-btn');
    if (btn) { btn.textContent='Se connecter avec GitHub'; btn.disabled=false; btn.style.opacity='1'; }
    const dBtn = document.getElementById('gh-disconnect-btn');
    if (dBtn) dBtn.style.display='none';
    const main = document.getElementById('gh-main-section');
    if (main) main.style.display='none';
  },

  async loadRepo() {
    const token = Auth.token(); const cfg = SiteConfig.get(); const user = Auth.user();
    const repo = cfg.repo || (user?.login ? user.login+'/'+SITE_REPO_NAME : '');
    if (!token || !repo) return;
    const [owner, r] = repo.split('/');
    const dot = document.getElementById('gh-repo-dot');
    const lbl = document.getElementById('gh-repo-label');
    const lnk = document.getElementById('gh-repo-link');
    try {
      const data = await GH.getRepo(token, owner, r);
      if (dot) dot.style.background='#2e9a63';
      if (lbl) lbl.textContent=data.full_name+' · '+data.visibility;
      if (lnk) { lnk.href=data.html_url; lnk.style.display=''; }
      const pd = document.getElementById('gh-pages-display');
      const pl = document.getElementById('gh-pages-link');
      const url = SiteConfig.get().lastDeploy?.url || `https://${owner.toLowerCase()}.github.io/${r}`;
      if (pd) pd.style.display='';
      if (pl) { pl.href=url; pl.textContent=url; }
    } catch {
      if (dot) dot.style.background='#e4b24a';
      if (lbl) lbl.textContent='Repo introuvable — utilise "+ Créer"';
    }
  },

  async loadRuns() {
    const token = Auth.token(); const cfg = SiteConfig.get(); const user = Auth.user();
    const repo = cfg.repo || (user?.login ? user.login+'/'+SITE_REPO_NAME : '');
    if (!token || !repo) return;
    const [owner, r] = repo.split('/');
    const list = document.getElementById('gh-runs-list');
    if (list) list.innerHTML='<div style="color:var(--muted2);font-size:10px">Chargement…</div>';
    const runs = await GH.runs(token, owner, r, 5);
    if (!runs.length) { if(list) list.innerHTML='<div style="color:var(--muted2);font-size:10px">Aucun run — déploie pour commencer</div>'; return; }
    const ic = s => s==='success'?'✓':s==='failure'?'✗':s==='in_progress'?'⟳':'·';
    const co = s => s==='success'?'#2e9a63':s==='failure'?'#c0392b':s==='in_progress'?'var(--accent)':'var(--muted2)';
    const ago = ts => { const d=Math.floor((Date.now()-new Date(ts))/1000); if(d<60)return d+'s'; if(d<3600)return Math.floor(d/60)+'min'; if(d<86400)return Math.floor(d/3600)+'h'; return Math.floor(d/86400)+'j'; };
    if (list) list.innerHTML=runs.map(run=>`
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--s2);border-radius:6px">
        <span style="color:${co(run.conclusion||run.status)};font-size:14px;width:16px">${ic(run.conclusion||run.status)}</span>
        <span style="flex:1;color:var(--text);font-size:11px">${run.display_title||run.name||'Run'}</span>
        <span style="color:var(--muted2);font-size:10px">il y a ${ago(run.created_at)}</span>
        <a href="${run.html_url}" target="_blank" style="color:var(--accent3);font-size:10px;text-decoration:none">↗</a>
      </div>`).join('');
  },

  pipelineStep(id, state) {
    const el = document.getElementById('ps-'+id);
    if (el) el.className='pipeline-step '+(state||'');
  },
  resetPipeline() { ['behance','generate','commit','pages'].forEach(id=>this.pipelineStep(id,'')); },

  appendLog(msg, color) {
    const el = document.getElementById('gh-deploy-log'); if (!el) return;
    el.style.display='';
    const div = document.createElement('div');
    div.style.color=color||'inherit'; div.textContent='› '+msg;
    el.appendChild(div); el.scrollTop=el.scrollHeight;
  },
};

/* ══════════════════════════════════════════════════════
   GITHUB CONNECT — Device Flow + fallback PAT
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   CONNEXION GITHUB — PAT direct (simple, gratuit, fiable)
══════════════════════════════════════════════════════ */
async function ghStartConnect() {
  const inp = document.getElementById('gh-pat-inp');
  const btn = document.getElementById('gh-connect-btn');
  const msg = document.getElementById('gh-connect-msg');
  const val = inp?.value.trim();

  if (!val) {
    if (msg) { msg.style.color = '#c0392b'; msg.textContent = 'Colle ton token GitHub ci-dessus'; }
    inp?.focus();
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⟳ Connexion…'; }
  if (msg) { msg.style.color = 'var(--muted2)'; msg.textContent = 'Vérification du token…'; }

  try {
    const user = await connectGitHub(val);

    if (inp) inp.value = '•'.repeat(24);
    if (msg) { msg.style.color = '#2e9a63'; msg.textContent = '✓ Connecté — dépôt ' + user.login.toLowerCase() + '-hub-data créé'; }

    GHPage.showConnected(user);
    GHPage.loadRepo();
    GHPage.loadRuns();

    const ri = document.getElementById('gh-repo-inp');
    if (ri) ri.value = SiteConfig.get().repo || '';

    showToast('✓ GitHub connecté — @' + user.login, '#2e9a63');

  } catch (e) {
    const errMsg = e.message.includes('401') ? 'Token invalide'
                 : e.message.includes('403') ? 'Scopes insuffisants — ajoute "repo"'
                 : e.message;
    if (msg) { msg.style.color = '#c0392b'; msg.textContent = '✗ ' + errMsg; }
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
    if (inp) inp.value = '';
  }
}

async function ghCheckRepo()  {
  const val = document.getElementById('gh-repo-inp')?.value.trim();
  if (!val) return;
  SiteConfig.set('repo', val);
  await GHPage.loadRepo();
}

async function ghCreateRepo() {
  const token = Auth.token(); if (!token) { showToast('Connecte GitHub d\'abord','#c0392b'); return; }
  const val   = document.getElementById('gh-repo-inp')?.value.trim() || (Auth.owner()+'/souanpt-hub');
  const [owner, repo] = val.split('/');
  const dot = document.getElementById('gh-repo-dot');
  const lbl = document.getElementById('gh-repo-label');
  if (lbl) lbl.textContent='Création de '+val+'…';
  try {
    await GH.ensureRepo(token, owner, repo, false);
    await GH.enablePages(token, owner, repo);
    SiteConfig.set('repo', val);
    if (dot) dot.style.background='#2e9a63';
    if (lbl) lbl.textContent=val+' créé + GitHub Pages activé';
    showToast('✓ '+val+' créé','#2e9a63');
    GHPage.loadRuns();
  } catch(e) {
    if (dot) dot.style.background='#c0392b';
    if (lbl) lbl.textContent='✗ '+e.message;
  }
}

async function ghDeploy() {
  if (!Auth.ok()) { showToast('Connecte GitHub d\'abord','#c0392b'); return; }
  const repoInp = document.getElementById('gh-repo-inp');
  if (repoInp?.value.trim()) SiteConfig.set('repo', repoInp.value.trim());
  const btn    = document.getElementById('gh-deploy-btn');
  const result = document.getElementById('gh-deploy-result');
  if (btn)    { btn.disabled=true; btn.textContent='⟳ Déploiement…'; }
  if (result) result.innerHTML='';
  const logEl = document.getElementById('gh-deploy-log');
  if (logEl)  { logEl.innerHTML=''; logEl.style.display=''; }
  GHPage.resetPipeline();
  try {
    const url = await deployPortfolio(
      (m,c) => GHPage.appendLog(m,c),
      (s,st) => GHPage.pipelineStep(s,st)
    );
    if (result) result.innerHTML='✓ Déployé — <a href="'+url+'" target="_blank" style="color:var(--accent3)">'+url+'</a>';
    showToast('✓ Portfolio déployé !','#2e9a63');
    setTimeout(()=>GHPage.loadRuns(),3000);
    const pd=document.getElementById('gh-pages-display'); const pl=document.getElementById('gh-pages-link');
    if(pd)pd.style.display=''; if(pl){pl.href=url;pl.textContent=url;}
  } catch(e) {
    GHPage.appendLog('✗ '+e.message,'#c0392b');
    if (result) result.innerHTML='<span style="color:#c0392b">✗ '+e.message+'</span>';
    showToast('✗ '+e.message,'#c0392b');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='🚀 Déployer le portfolio'; }
  }
}

async function ghRefreshRuns() { await GHPage.loadRuns(); showToast('Actualisé','#2e9a63',1500); }

function ghDisconnect() {
  if (!confirm('Déconnecter GitHub ?')) return;
  Auth.clear();
  GHPage.showDisconnected();
  showToast('Déconnecté','#666');
  setTimeout(() => location.reload(), 600); // la porte de connexion se réaffiche
}

function ghOpenSite() {
  const url = SiteConfig.get().lastDeploy?.url;
  if (url) window.open(url,'_blank');
  else showToast('Déploie d\'abord','#e4b24a');
}

/* ══════════════════════════════════════════════════════
   ÉDITEUR
══════════════════════════════════════════════════════ */
let _edTimer=null, _edBlobUrl=null;
// true dès que les champs de l'éditeur ont été remplis depuis SiteConfig.
// Tant que c'est false, edGetConfig() NE DOIT PAS lire le formulaire (vide).
let _edLoaded = false;

function edLoad() {
  const cfg = SiteConfig.get();
  _edLoaded = true;
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.value=v||''; };
  set('ep-site-name', cfg.siteName);
  set('ep-bio',       cfg.bio);
  set('ep-hero-text', cfg.heroText);
  set('ep-behance',   cfg.behance);
  set('ep-email',     cfg.email);
  set('ep-layout',    cfg.layout);
  set('ep-theme',     cfg.theme);
  const ac=document.getElementById('ep-accent-color'); if(ac)ac.value=cfg.accentColor||'#C8FF00';
  const s=cfg.sections||{};
  _edVis = { projects: s.projects!==false, avis: s.avis!==false, contact: s.contact!==false, about: s.about!==false };
  const SK=['about','projects','avis','contact'];
  _edOrder = (Array.isArray(cfg.sectionOrder)&&cfg.sectionOrder.length?cfg.sectionOrder.slice():SK.slice()).filter(k=>SK.includes(k));
  SK.forEach(k=>{ if(!_edOrder.includes(k)) _edOrder.push(k); });
  edRenderBlocks();
  set('ep-about', cfg.about||'');
  set('ep-avis-mode', cfg.avisMode||'defile');
  set('ep-layout-style', cfg.layoutStyle||'float');
  set('ep-hero-image', cfg.heroImage||'');
  set('ep-proj-limit', cfg.projectsLimit||0);
  set('ep-anim', cfg.animLevel||'smooth');
  const fx = cfg.fx || {};
  const chk=(id,v)=>{ const el=document.getElementById(id); if(el) el.checked=!!v; };
  chk('ep-fx-tilt', fx.tilt); chk('ep-fx-shine', fx.shine); chk('ep-fx-lift', fx.lift);
  chk('ep-fx-glow', fx.glow); chk('ep-fx-mouseglow', fx.mouseglow);
  const intv=document.getElementById('ep-fx-intensity'); if(intv){intv.value=fx.intensity||7; const tv=document.getElementById('ep-tilt-val'); if(tv)tv.textContent=fx.intensity||7;}
  edSyncThemeCards();
  edPerf();
  const dot=document.getElementById('ed-gh-dot'); const lbl=document.getElementById('ed-gh-label');
  if (Auth.ok()) { if(dot)dot.style.background='#2e9a63'; if(lbl)lbl.textContent='@'+(Auth.user()?.login||'?')+' · connecté'; }
  else           { if(dot)dot.style.background='var(--muted)'; if(lbl)lbl.textContent='GitHub non connecté — cliquer'; }
}

function edGetConfig() {
  // SÉCURITÉ : si l'éditeur n'a jamais été ouvert, ses champs sont VIDES.
  // Lire le formulaire renverrait des valeurs par défaut ('FOLIO', etc.) et
  // publierait un site vide en écrasant la vraie config. On rend la config
  // enregistrée telle quelle (elle contient déjà ownerUid, repo, fx…).
  if (!_edLoaded) return SiteConfig.get();
  return {
    siteName:    document.getElementById('ep-site-name')?.value    || 'FOLIO',
    bio:         document.getElementById('ep-bio')?.value          || '',
    accentColor: document.getElementById('ep-accent-color')?.value || '#C8FF00',
    theme:       document.getElementById('ep-theme')?.value        || '#060606',
    layout:      document.getElementById('ep-layout')?.value       || '3',
    heroText:    document.getElementById('ep-hero-text')?.value    || '',
    behance:     document.getElementById('ep-behance')?.value      || '',
    email:       document.getElementById('ep-email')?.value        || '',
    repo:        SiteConfig.get().repo || '',
    // uid du propriétaire : indispensable pour que le site publié embarque le
    // mouchard analytics (perdu sinon, edGetConfig ne lit que le formulaire)
    ownerUid:    SiteConfig.get().ownerUid || (window.Cloud && Cloud.user() ? Cloud.user().uid : '') || '',
    sections: { ...(_edVis || { projects:true, avis:true, contact:true, about:true }) },
    sectionOrder: (_edOrder || ['about','projects','avis','contact']).slice(),
    about:    document.getElementById('ep-about')?.value || '',
    avisMode: document.getElementById('ep-avis-mode')?.value || 'defile',
    layoutStyle:   document.getElementById('ep-layout-style')?.value || 'float',
    heroImage:     document.getElementById('ep-hero-image')?.value.trim() || '',
    projectsLimit: parseInt(document.getElementById('ep-proj-limit')?.value) || 0,
    animLevel:     document.getElementById('ep-anim')?.value || 'smooth',
    fx: {
      tilt:      !!document.getElementById('ep-fx-tilt')?.checked,
      intensity: parseInt(document.getElementById('ep-fx-intensity')?.value) || 7,
      shine:     !!document.getElementById('ep-fx-shine')?.checked,
      lift:      !!document.getElementById('ep-fx-lift')?.checked,
      glow:      !!document.getElementById('ep-fx-glow')?.checked,
      mouseglow: !!document.getElementById('ep-fx-mouseglow')?.checked,
    },
  };
}
function edHeroImport(ev) {
  const f = ev.target.files[0]; if (!f) return;
  fileToDataURL(f, d => {
    const inp = document.getElementById('ep-hero-image'); if (inp) inp.value = d;
    edUpdatePreview();
    showToast('Image hero importée & optimisée ✓', '#2e9a63', 2000);
  });
  ev.target.value = '';
}

/* ── Panneau éditeur : accordéon, cartes de thème, jauge de perf ── */
function edGroup(h) { h.parentElement.classList.toggle('open'); }
/* Réinitialise les panneaux de l'éditeur (Thème/Contenu/…) à l'état replié.
   Appelé à chaque OUVERTURE de l'éditeur → aucun état d'ouverture mémorisé. */
function edResetPanels() { document.querySelectorAll('#page-editor .eg').forEach(g => g.classList.remove('open')); }
function edPickTheme(v) {
  const sel = document.getElementById('ep-layout-style'); if (sel) sel.value = v;
  edSyncThemeCards();
  edUpdatePreview();
}
function edSyncThemeCards() {
  const v = document.getElementById('ep-layout-style')?.value || 'float';
  document.querySelectorAll('#ed-theme-cards .th-card').forEach(c => c.classList.toggle('active', c.dataset.v === v));
}
/* Estime la performance localement selon animations/effets/médias — pas d'IA, gratuit */
function edPerf() {
  const g = (typeof edGetConfig === 'function') ? edGetConfig() : {};
  const fx = g.fx || {};
  // slider d'intensité visible seulement si l'effet 3D est actif
  const row = document.getElementById('ep-fx-tilt-row'); if (row) row.style.display = fx.tilt ? '' : 'none';
  const tv = document.getElementById('ep-tilt-val'); if (tv) tv.textContent = fx.intensity || 7;
  const anim = { none: 0, light: 3, smooth: 8, premium: 16 }[g.animLevel] ?? 8;
  let load = anim + (fx.tilt ? 8 : 0) + (fx.shine ? 4 : 0) + (fx.lift ? 2 : 0)
           + (fx.glow ? 4 : 0) + (fx.mouseglow ? 6 : 0);
  let projs = 0, heavyCovers = 0;
  try { const P = JSON.parse(localStorage.getItem('hub_projects') || '[]'); projs = P.length; heavyCovers = P.filter(p => (p.cover || '').startsWith('data:')).length; } catch {}
  load += Math.max(0, projs - 12) * 1.5 + heavyCovers * 3 + (g.heroImage ? 4 : 0);
  const score = Math.max(35, Math.round(100 - load));
  const col = score >= 85 ? 'var(--green)' : score >= 65 ? 'var(--gold-l)' : 'var(--red)';
  const bar = document.getElementById('ed-perf-bar'), num = document.getElementById('ed-perf-num'),
        lbl = document.getElementById('ed-perf-label'), ld = document.getElementById('ed-perf-load'), mob = document.getElementById('ed-perf-mob');
  if (bar) { bar.style.width = score + '%'; bar.style.background = col; }
  if (num) { num.textContent = score + '/100'; num.style.color = col; }
  if (lbl) lbl.textContent = score >= 85 ? 'Ultra rapide' : score >= 65 ? 'Rapide' : 'Animations lourdes';
  if (ld)  ld.textContent  = '≈' + (0.4 + load / 90).toFixed(1) + 's desktop';
  if (mob) mob.textContent = '≈' + (0.6 + load / 55).toFixed(1) + 's mobile';
  // Suggestions dans la barre (avec bouton Optimiser)
  const tips = [];
  if (heavyCovers) tips.push(`🖼 ${heavyCovers} couverture(s) non optimisée(s) <button onclick="optimizeAllCovers();return false">Optimiser</button>`);
  if (g.animLevel === 'premium') tips.push('⚡ Animations Premium activées');
  if (g.layoutStyle === 'sidebar' && !g.heroImage) tips.push('🌄 Hero conseillé pour le thème latéral');
  const box = document.getElementById('ed-tips');
  if (box) box.innerHTML = tips.slice(0, 2).map(t => `<span class="ptip">${t}</span>`).join('');
}

/* ══════════════════════════════════════════════════════
   BLOCS — ordre + visibilité des sections du site
══════════════════════════════════════════════════════ */
const ED_SECTIONS = { about:'À propos', projects:'Projets', avis:'Avis clients', contact:'Contact' };
let _edOrder=null, _edVis=null, _edBlockDrag=null;

function edRenderBlocks() {
  const list=document.getElementById('ed-blocks-list'); if(!list||!_edOrder) return;
  const lockItem=(lbl,ic)=>`<div class="ed-block-item" style="opacity:.4;cursor:default"><span>${ic}</span> ${lbl}<span style="margin-left:auto;font-size:8px">fixe</span></div>`;
  list.innerHTML =
    lockItem('Hero','★') +
    _edOrder.map((k,i)=>`<div class="ed-block-item" draggable="true" style="${_edVis[k]===false?'opacity:.4;':''}border-style:solid"
      ondragstart="edBlockDragStart(event,${i})" ondragover="event.preventDefault();this.style.borderColor='rgba(200,255,0,.5)'"
      ondragleave="this.style.borderColor=''" ondrop="edBlockDrop(event,${i})" ondragend="edRenderBlocks()">
      <span style="cursor:grab;letter-spacing:-1px" title="Glisser pour réordonner">⋮⋮</span> ${ED_SECTIONS[k]}
      <button onclick="edToggleBlock('${k}')" title="${_edVis[k]===false?'Afficher la section':'Masquer la section'}"
        style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:11px;color:${_edVis[k]===false?'var(--muted)':'var(--accent)'}">${_edVis[k]===false?'◌':'👁'}</button>
    </div>`).join('') +
    lockItem('Footer','—');
}
function edBlockDragStart(e,i){ _edBlockDrag=i; e.dataTransfer.effectAllowed='move'; }
function edBlockDrop(e,i){
  e.preventDefault();
  if(_edBlockDrag===null||_edBlockDrag===i){ edRenderBlocks(); return; }
  const [m]=_edOrder.splice(_edBlockDrag,1); _edOrder.splice(i,0,m); _edBlockDrag=null;
  edRenderBlocks(); edUpdatePreview();
  showToast('Ordre des sections mis à jour ✓','#2e9a63',1500);
}
function edToggleBlock(k){
  _edVis[k] = _edVis[k]===false;
  edRenderBlocks(); edUpdatePreview();
}

function edUpdatePreview() { try{ edPerf(); }catch{} clearTimeout(_edTimer); _edTimer=setTimeout(edRefreshPreview,600); }

function edRefreshPreview() {
  const frame=document.getElementById('ed-preview-frame');
  const loading=document.getElementById('ed-preview-loading');
  if (!frame) return;
  if (loading) loading.style.display='flex';
  const cfg = edGetConfig();
  const siteHtml = generateSite(cfg);
  if (_edBlobUrl) URL.revokeObjectURL(_edBlobUrl);
  const blob = new Blob([siteHtml],{type:'text/html'});
  _edBlobUrl = URL.createObjectURL(blob);
  frame.onload = ()=>{ if(loading)loading.style.display='none'; };
  frame.src = _edBlobUrl;
  setTimeout(()=>{ if(loading)loading.style.display='none'; },2000);
  const u=Auth.owner()||'souanpt'; const repo=cfg.repo||(u+'/'+SITE_REPO_NAME);
  const [owner,r]=repo.split('/');
  const urlEl=document.getElementById('ed-preview-url');
  if (urlEl) urlEl.textContent=owner.toLowerCase()+'.github.io/'+(r||SITE_REPO_NAME);
}

function edSaveConfig(silent) {
  const cfg=edGetConfig(); const existing=SiteConfig.get(); SiteConfig.save({...existing,...cfg});
  const el=document.getElementById('ed-last-save');
  if (el) el.textContent=(silent?'Auto-sauvegardé à ':'Sauvegardé à ')+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  if (!silent) showToast('Config sauvegardée ✓','#2e9a63');
}

/* Aperçu par appareil (PC / tablette / mobile) */
function edDevice(w, btn) {
  const f = document.getElementById('ed-preview-frame'); if (!f) return;
  f.style.transition = 'width .3s ease';
  f.style.width  = w ? w + 'px' : '100%';
  f.style.margin = w ? '0 auto' : '';
  f.style.borderLeft  = w ? '1px solid rgba(255,255,255,.1)' : 'none';
  f.style.borderRight = w ? '1px solid rgba(255,255,255,.1)' : 'none';
  document.querySelectorAll('.ed-dev-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
}

/* Sauvegarde automatique de l'éditeur (30 s + avant fermeture) */
setInterval(() => {
  if (document.getElementById('page-editor')?.classList.contains('active')) edSaveConfig(true);
}, 30000);
window.addEventListener('beforeunload', () => {
  if (document.getElementById('page-editor')?.classList.contains('active')) edSaveConfig(true);
});

function edPreviewExternal() {
  const html=generateSite(edGetConfig()); const win=window.open('','_blank'); if(win){win.document.write(html);win.document.close();}
}

async function edDeploy() {
  if (!Auth.ok()) { showToast('Connecte GitHub dans "GitHub & Déploiement"','#e4b24a',3000); showPage('github'); return; }
  edSaveConfig();
  const btn1=document.getElementById('ed-deploy-btn'); const btn2=document.getElementById('ed-deploy-btn2');
  const status=document.getElementById('ed-status');
  [btn1,btn2].forEach(b=>{if(b)b.disabled=true;});
  if (status) status.textContent='Déploiement…';
  try {
    const url=await deployPortfolio((m)=>{if(status)status.textContent=m;});
    if(status)status.innerHTML='✓ <a href="'+url+'" target="_blank" style="color:var(--accent3)">'+url+'</a>';
    showToast('✓ Déployé !','#2e9a63');
  } catch(e) {
    if(status)status.textContent='✗ '+e.message;
    showToast('✗ '+e.message,'#c0392b');
  } finally {
    [btn1,btn2].forEach(b=>{if(b)b.disabled=false;});
  }
}

function edToggleGhPanel() {
  const p=document.getElementById('ed-gh-panel');
  if (p) p.style.display=p.style.display==='none'?'':'none';
}

function edSelectBlock(name,el) {
  document.querySelectorAll('.ed-block-item').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

function edAddBlock() {
  const types=['Galerie','Témoignages','Timeline','Vidéo','Texte'];
  const list=document.getElementById('ed-blocks-list'); if(!list) return;
  const name=prompt('Type de bloc :\n'+types.map((t,i)=>(i+1)+'. '+t).join('\n')); if(!name) return;
  const i=parseInt(name)-1; const lbl=types[i]||name;
  const div=document.createElement('div'); div.className='ed-block-item';
  div.innerHTML='<span>☐</span> '+lbl; div.onclick=()=>edSelectBlock(lbl,div);
  list.appendChild(div);
}

/* ══════════════════════════════════════════════════════
   BULLE PROFIL
══════════════════════════════════════════════════════ */
const BubbleWidget = {
  _qrOn: false,
  init() {
    this.refresh();
    const b=document.getElementById('sp-bubble-trigger'); if(b)b.style.display='flex';
  },
  refresh() {
    const user=Auth.user(); const cfg=SiteConfig.get();
    const username=user?.login||'souanpt'; const initials=username.slice(0,2).toUpperCase();
    const url=cfg.lastDeploy?.url||(user?`https://${user.login.toLowerCase()}.github.io/${SITE_REPO_NAME}`:'—');
    const short=url.replace('https://','');
    ['sp-bub-av','sp-hd-av2'].forEach(id=>{
      const el=document.getElementById(id); if(!el)return;
      if(user?.avatar_url) el.innerHTML=`<img src="${user.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      else el.textContent=initials;
    });
    const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    s('sp-bub-name',user?.name||username);
    s('sp-bub-url', short);
    s('sp-hd-name2',user?.name||username);
    s('sp-hd-handle2','@'+username);
    s('sp-site-url2',short);
    const lk=document.getElementById('sp-footer-lnk'); if(lk)lk.href=url.startsWith('http')?url:'https://'+url;
    const lastBk=localStorage.getItem('souanpt_last_backup');
    const bkt=document.getElementById('sp-bk-time2');
    if(bkt&&lastBk)bkt.textContent='Il y a '+timeAgo(parseInt(lastBk));
  },
  open()  { this.refresh(); document.getElementById('sp-overlay2')?.classList.add('open'); },
  close() { document.getElementById('sp-overlay2')?.classList.remove('open'); },
  closeOnBg(e){ if(e.target.id==='sp-overlay2')this.close(); },
  tab(name,btn){
    ['share','profile','backup'].forEach(t=>{const el=document.getElementById('sp2-tab-'+t);if(el)el.style.display=t===name?'':'none';});
    document.querySelectorAll('#sp-overlay2 .sm2-tab').forEach(b=>b.classList.remove('active'));
    if(btn)btn.classList.add('active');
    if(name==='profile')this.loadProfileTab();
  },
  siteUrl(){ const cfg=SiteConfig.get(); return cfg.lastDeploy?.url||(Auth.owner()?`https://${Auth.owner().toLowerCase()}.github.io/${SITE_REPO_NAME}`:''); },
  copyUrl()    { navigator.clipboard.writeText(this.siteUrl()).then(()=>showToast('URL copiée ✓','#2e9a63',1500)); },
  openSite()   { window.open(this.siteUrl(),'_blank'); },
  copyHandle() { const u='@'+(Auth.user()?.login||'souanpt'); navigator.clipboard.writeText(u).then(()=>showToast(u+' copié','#2e9a63',1500)); },
  shareNative(){ const url=this.siteUrl(); if(navigator.share)navigator.share({title:'Mon Portfolio',url}); else this.copyUrl(); },
  toggleQR(){
    this._qrOn=!this._qrOn;
    const area=document.getElementById('sp-qr-area2');
    const lbl=document.getElementById('sp-qr-lbl2');
    if(area)area.classList.toggle('on',this._qrOn);
    if(lbl)lbl.textContent=this._qrOn?'Masquer QR':'⬡ QR Code';
    if(this._qrOn){ const cv=document.getElementById('sp-qr-canvas2'); if(cv)this.drawQR(cv,this.siteUrl()); }
  },
  drawQR(canvas,text){
    const ctx=canvas.getContext('2d'); const S=canvas.width,C=21,cs=Math.floor(S/C);
    function h(s){let v=0;for(let i=0;i<s.length;i++)v=(Math.imul(31,v)+s.charCodeAt(i))|0;return Math.abs(v);}
    ctx.fillStyle='#111';ctx.fillRect(0,0,S,S);ctx.fillStyle='#C8FF00';
    for(let r=0;r<C;r++)for(let c=0;c<C;c++){
      const f=(r<7&&c<7)||(r<7&&c>=C-7)||(r>=C-7&&c<7);
      const inn=(r>=2&&r<=4&&c>=2&&c<=4)||(r>=2&&r<=4&&c>=C-5&&c<C)||(r>=C-5&&r<C&&c>=2&&c<=4);
      if(f&&!inn)ctx.fillRect(c*cs,r*cs,cs,cs);
      else if(!f&&h(text+r+','+c+h(text))%3===0){ctx.beginPath();ctx.roundRect(c*cs+1,r*cs+1,cs-2,cs-2,2);ctx.fill();}
    }
  },
  dlQR(){ const cv=document.getElementById('sp-qr-canvas2');if(!cv)return;const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download='qr-portfolio.png';a.click();showToast('QR téléchargé','#2e9a63',1500); },
  loadProfileTab(){ const cfg=SiteConfig.get(); const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!==undefined)el.value=v;}; set('sp-f-bio',cfg.bio||''); set('sp-f-domain',cfg.customDomain?cfg.customDomain.replace('https://',''):''); },
  saveProfile(){
    const cfg=SiteConfig.get();
    const bio=document.getElementById('sp-f-bio')?.value.trim();
    const domain=document.getElementById('sp-f-domain')?.value.trim();
    if(bio!==undefined)cfg.bio=bio;
    if(domain!==undefined)cfg.customDomain=domain?'https://'+domain.replace('https://',''):'';
    SiteConfig.save(cfg); this.refresh(); showToast('Profil sauvegardé ✓','#2e9a63');
  },
  async backupNow(){
    const btn=document.getElementById('sp-bk-btn2');
    if(btn){btn.textContent='⟳';btn.disabled=true;}
    await autoBackup();
    const ts=localStorage.getItem('souanpt_last_backup');
    const bkt=document.getElementById('sp-bk-time2'); if(bkt&&ts)bkt.textContent='À l\'instant';
    if(btn){btn.textContent='↑ Sauver';btn.disabled=false;}
    showToast('Backup effectué ✓','#2e9a63');
  },
  exportJSON(){
    const data=JSON.stringify({auth:{user:Auth.user()},config:SiteConfig.get()},null,2);
    const blob=new Blob([data],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url;a.download='souanpt-hub-export.json';a.click();URL.revokeObjectURL(url);showToast('Export téléchargé','#2e9a63');
  },
  goEditor(){ this.close(); showPage('editor'); },
};

/* ══════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════ */
function showPage(id) {
  // Behance & GitHub ont déménagé dans Paramètres → Intégrations
  if (id === 'github' || id === 'behance') {
    showPage('settings');
    setTimeout(() => {
      const nav = [...document.querySelectorAll('.settings-nav-item')].find(n => n.textContent.includes('Intégrations'));
      window.settingsTab?.('integrations', nav);
      window.intOpen?.(id);
    }, 80);
    return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  const page=document.getElementById('page-'+id); if(page)page.classList.add('active');
  const navBtn=document.querySelector(`.ni[data-page="${id}"]`); if(navBtn)navBtn.classList.add('active');
  const titles={overview:"Vue d'ensemble",analytics:'Analytics',portfolio:'Portfolio',links:'Profil Links',editor:'Éditeur de site',clients:'Clients',facturation:'Facturation',avis:'Avis',portals:'Portails Clients',media:'Médias',storage:'Stockage',behance:'Behance Sync',github:'GitHub & Déploiement',settings:'Paramètres'};
  const t=document.getElementById('topbar-title'); if(t)t.textContent=titles[id]||id;
  document.querySelector('.scroll-area')?.scrollTo({top:0});
  if(id==='github') setTimeout(()=>GHPage.init(),50);
  if(id==='editor') { edResetPanels(); edLoad(); setTimeout(edRefreshPreview,100); }
  if(id==='overview') { window.Analytics?.refresh(); if(typeof syncKPIs==='function')syncKPIs(); if(typeof renderActivity==='function')renderActivity(); }
}

async function syncBehance(){
  showToast('↻ Sync Behance…','#666',1500);
  try { await behanceSyncNow(false); }
  catch(e) { showToast('✗ ' + e.message, '#c0392b', 3000); }
}

document.addEventListener('DOMContentLoaded',()=>{
  if(document.getElementById('page-github')?.classList.contains('active')) GHPage.init();
  if(document.getElementById('page-editor')?.classList.contains('active'))  { edResetPanels(); edLoad(); setTimeout(edRefreshPreview,200); }
  if(Auth.ok()) BubbleWidget.init();
  document.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click',function(){
      if(this.textContent.includes('+'))return;
      document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
      this.classList.add('active');
    });
  });
});
