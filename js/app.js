'use strict';

/* ══════════════════════════════
   AUTH
══════════════════════════════ */
function enterDash() {
  const input = document.getElementById('login-pseudo');
  if (!input) return;
  const pseudo = input.value.trim();
  if (pseudo.length < 2) { input.focus(); shakeEl(input); return; }
  Store.login(pseudo);
  addXP('login', 2);
  bootDash();
}

function enterDashWithPseudo(pseudo) {
  Store.login(pseudo);
  addXP('login', 2);
  bootDash();
}

function exitDash() {
  Store.logout();
}

function bootDash() {
  document.body.classList.add('in-dash');
  loadDashData();
  setTimeout(() => buildDashChart(30), 80);
}

function shakeEl(el) {
  el.style.animation = 'shake .4s ease';
  setTimeout(() => el.style.animation = '', 400);
}

/* ══════════════════════════════
   LOAD DATA INTO DOM
══════════════════════════════ */
function loadDashData() {
  const profile = Store.get('profile') || {};
  renderXP(profile);
  renderLinks();
  renderProjects();
  renderInvoices();
  renderClients();
  renderReviews();
  renderNotifications();
  renderSettings();
  renderProfile();
  renderStorage();
  renderMedia();
}

/* ══════════════════════════════
   PUBLIC NAV
══════════════════════════════ */
window.pubNav = function(id) {
  document.querySelectorAll('.pub-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.pnl').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById('pub-' + id);
  if (sec) sec.classList.add('active');
  const btn = document.getElementById('pnl-' + id);
  if (btn) btn.classList.add('active');
  document.querySelector('.pub-scroll')?.scrollTo({ top: 0 });
};

/* ══════════════════════════════
   DASHBOARD NAV
══════════════════════════════ */
window.sw = function(id, btn, lbl) {
  document.querySelectorAll('.dpage').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('dpage-' + id);
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('ptitle').textContent = lbl || id;
  document.querySelector('.scroll-area')?.scrollTo({ top: 0 });
  if (id === 'overview')    buildDashChart(window._dashPeriod || 30);
  if (id === 'analytics')   initAnalyticsCharts();
  if (id === 'facturation') initRevChart();
};

window.switchP = function(pts, btn) {
  document.querySelectorAll('.cf').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  buildDashChart(pts);
};

/* ══════════════════════════════
   PROFILE
══════════════════════════════ */
function renderProfile() {
  const p = Store.get('profile') || {};
  // topbar
  const ptitle = document.getElementById('ptitle');
  // sidebar avatar
  document.querySelectorAll('.xp-av').forEach(el => el.textContent = p.avatar || (p.username||'?')[0].toUpperCase());
  document.querySelectorAll('.xp-name').forEach(el => el.textContent = p.displayName || p.username || '');
  // settings form
  const f = {
    'set-pseudo': p.username || '',
    'set-displayname': p.displayName || '',
    'set-code': p.creatorCode || '',
    'set-bio': p.bio || '',
    'set-seo-title': (Store.get('settings') || {}).seoTitle || '',
    'set-seo-desc': (Store.get('settings') || {}).seoDesc || '',
  };
  Object.entries(f).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
}

/* ══════════════════════════════
   LINKS
══════════════════════════════ */
function renderLinks() {
  const links = Store.get('links') || [];
  const container = document.getElementById('links-list');
  if (!container) return;
  if (links.length === 0) {
    container.innerHTML = `<div class="empty"><i class="ti ti-link"></i><div class="empty-title">Aucun lien</div><div class="empty-sub">Ajoute ton premier lien</div></div>`;
    return;
  }
  container.innerHTML = links.map((l, i) => `
    <div class="gc link-row" data-id="${l.id}">
      <i class="ti ti-grid-dots" style="color:var(--muted);cursor:grab"></i>
      <div class="link-thumb" style="background:${l.bg||'#1a1a1a'}">
        <i class="ti ${l.icon||'ti-link'}" style="font-size:14px;color:${l.color||'var(--gold-l)'}"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:600;color:var(--text)">${escHtml(l.title)}</div>
        <div style="font-size:9px;color:var(--muted)">${escHtml(l.url)}</div>
      </div>
      <div style="text-align:right;min-width:44px">
        <div style="font-size:12px;font-weight:700;color:var(--gold-l)">${l.clicks||0}</div>
        <div style="font-size:8px;color:var(--muted)">clics</div>
      </div>
      <div class="link-bar-w"><div class="link-bar" style="width:${Math.min(100,Math.round((l.clicks||0)/10))}%"></div></div>
      <button onclick="deleteLink('${l.id}')" style="background:none;border:none;cursor:pointer;color:var(--muted2);font-size:14px"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

window.addLink = function() {
  const title = document.getElementById('new-link-title')?.value.trim();
  const url   = document.getElementById('new-link-url')?.value.trim();
  if (!title || !url) { showToast('Titre et URL requis', '#c0392b', 1500); return; }
  const links = Store.get('links') || [];
  links.push({ id: Date.now().toString(), title, url, clicks: 0, bg: '#1a1a1a', icon: 'ti-link', color: 'var(--gold-l)', createdAt: Date.now() });
  Store.set('links', links);
  renderLinks();
  document.getElementById('new-link-title').value = '';
  document.getElementById('new-link-url').value = '';
  showToast('Lien ajouté', '#2e9a63', 1500);
};

window.deleteLink = function(id) {
  const links = (Store.get('links') || []).filter(l => l.id !== id);
  Store.set('links', links);
  renderLinks();
};

/* ══════════════════════════════
   PROJECTS
══════════════════════════════ */
function renderProjects() {
  const projects = Store.get('projects') || [];
  const container = document.getElementById('projects-list');
  if (!container) return;
  const colors = ['pt1','pt2','pt3','pt4','pt5','pt6'];
  const emojis = ['🎨','🏎️','🌍','🖥️','✏️','📸','🎬','🔧'];
  if (projects.length === 0) {
    container.innerHTML = `<div class="proj-card gc" style="border-style:dashed;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;min-height:140px;color:var(--muted);cursor:pointer;grid-column:span 3" onclick="document.getElementById('add-project-form').style.display='block'"><i class="ti ti-plus" style="font-size:18px"></i><span style="font-size:10px">Ajouter ton premier projet</span></div>`;
    return;
  }
  container.innerHTML = projects.map((p, i) => `
    <div class="proj-card gc${p.behance?' sync':''}">
      <div class="pthumb ${colors[i%colors.length]}">${p.emoji||emojis[i%emojis.length]}</div>
      <div class="pbody">
        <div class="ptitle">${escHtml(p.title)}</div>
        <div class="ptags">${(p.tags||[]).slice(0,3).map(t=>`<span class="ptag${p.behance?' gold':''}">${escHtml(t)}</span>`).join('')}</div>
        <div class="pmeta"><i class="ti ti-eye" style="font-size:10px"></i> ${p.views||0} · ${formatDate(p.date||p.createdAt)}</div>
      </div>
      <button onclick="deleteProject('${p.id}')" style="position:absolute;top:6px;left:6px;background:var(--red-dim);border:none;border-radius:4px;cursor:pointer;color:var(--red);font-size:10px;padding:2px 6px;opacity:0;transition:opacity .15s" class="proj-del">✕</button>
    </div>`).join('') +
    `<div class="proj-card gc" style="border-style:dashed;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;min-height:140px;color:var(--muted);cursor:pointer" onclick="document.getElementById('add-project-form').style.display='block'"><i class="ti ti-plus" style="font-size:18px"></i><span style="font-size:10px">Ajouter</span></div>`;

  // show delete on hover
  container.querySelectorAll('.proj-card').forEach(card => {
    card.addEventListener('mouseenter', () => { const d = card.querySelector('.proj-del'); if(d) d.style.opacity='1'; });
    card.addEventListener('mouseleave', () => { const d = card.querySelector('.proj-del'); if(d) d.style.opacity='0'; });
  });
}

window.addProject = function() {
  const title = document.getElementById('np-title')?.value.trim();
  if (!title) return;
  const projects = Store.get('projects') || [];
  const tagsRaw  = document.getElementById('np-tags')?.value || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  projects.push({ id: Date.now().toString(), title, tags, views: 0, createdAt: Date.now() });
  Store.set('projects', projects);
  renderProjects();
  document.getElementById('add-project-form').style.display = 'none';
  ['np-title','np-tags'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  addXP('project');
  Store.addNotification(`Projet "${title}" ajouté`, 'green');
  showToast('Projet ajouté', '#2e9a63', 1500);
};

window.deleteProject = function(id) {
  const projects = (Store.get('projects') || []).filter(p => p.id !== id);
  Store.set('projects', projects);
  renderProjects();
};

/* ══════════════════════════════
   INVOICES
══════════════════════════════ */
function renderInvoices() {
  const invoices = Store.get('invoices') || [];
  const container = document.getElementById('invoices-list');
  if (!container) return;

  const paid   = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.price||0), 0);
  const pending = invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.price||0), 0);
  const kpis = document.querySelectorAll('#dpage-facturation .kpi-val');
  if (kpis[0]) kpis[0].textContent = paid.toLocaleString('fr') + ' €';
  if (kpis[2]) kpis[2].textContent = invoices.filter(i=>i.status==='paid').length;
  if (kpis[3]) kpis[3].textContent = invoices.filter(i=>i.status==='pending').length;

  if (invoices.length === 0) {
    container.innerHTML = '<div class="empty"><i class="ti ti-receipt"></i><div class="empty-title">Aucune prestation</div><div class="empty-sub">Ajoute ta première prestation</div></div>';
    return;
  }
  container.innerHTML = invoices.slice().reverse().map(inv => `
    <div class="fac-row">
      <div class="fac-name">${escHtml(inv.name)}</div>
      <div class="fac-client">${escHtml(inv.client||'—')}</div>
      <div class="fac-price">${(inv.price||0).toLocaleString('fr')} €</div>
      <div class="fac-date">${formatDate(inv.date||inv.createdAt)}</div>
      <div class="fac-status ${inv.status==='paid'?'fs-paid':'fs-wait'}" style="cursor:pointer" onclick="toggleInvStatus('${inv.id}')">${inv.status==='paid'?'Payé':'En attente'}</div>
      <button onclick="deleteInv('${inv.id}')" style="background:none;border:none;cursor:pointer;color:var(--muted2);font-size:12px"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

window.addInvoice = function() {
  const name   = document.getElementById('inv-name')?.value.trim();
  const client = document.getElementById('inv-client')?.value.trim();
  const price  = parseFloat(document.getElementById('inv-price')?.value) || 0;
  if (!name) { showToast('Nom requis', '#c0392b', 1500); return; }
  const invoices = Store.get('invoices') || [];
  invoices.push({ id: Date.now().toString(), name, client, price, status: 'pending', createdAt: Date.now(), date: Date.now() });
  Store.set('invoices', invoices);
  renderInvoices();
  ['inv-name','inv-client','inv-price'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('add-inv-form').style.display = 'none';
  showToast('Prestation ajoutée', '#2e9a63', 1500);
  // reset rev chart
  if (revChart) { revChart.destroy(); revChart = null; }
};

window.toggleInvStatus = function(id) {
  const invoices = Store.get('invoices') || [];
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  if (inv.status === 'pending') {
    inv.status = 'paid';
    addXP('invoice');
    Store.addNotification(`Prestation "${inv.name}" marquée payée`, 'gold');
    showToast(`+50 XP — Prestation payée !`, '#e4b24a', 2000);
  } else {
    inv.status = 'pending';
  }
  Store.set('invoices', invoices);
  renderInvoices();
  if (revChart) { revChart.destroy(); revChart = null; initRevChart(); }
};

window.deleteInv = function(id) {
  Store.set('invoices', (Store.get('invoices')||[]).filter(i => i.id !== id));
  renderInvoices();
};

/* ══════════════════════════════
   CLIENTS
══════════════════════════════ */
function renderClients() {
  const clients = Store.get('clients') || [];
  const container = document.getElementById('clients-list');
  if (!container) return;
  if (clients.length === 0) {
    container.innerHTML = `<div class="empty" style="grid-column:span 2"><i class="ti ti-users"></i><div class="empty-title">Aucun client</div><div class="empty-sub">Ajoute ton premier client</div></div>`;
    return;
  }
  const cols = ['rgba(201,146,42,.15)','rgba(46,154,99,.12)','rgba(45,125,210,.12)','rgba(192,57,43,.1)'];
  const tcols = ['var(--gold-l)','var(--green)','var(--blue)','var(--red)'];
  container.innerHTML = clients.map((c, i) => `
    <div class="gc client-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div class="client-av" style="background:${cols[i%4]};color:${tcols[i%4]}">${(c.name||'?')[0].toUpperCase()}</div>
        <div><div class="client-name">${escHtml(c.name)}</div><div class="client-sub">${escHtml(c.type||'')} · ${c.lastContact?`il y a ${daysSince(c.lastContact)}j`:'Nouveau'}</div></div>
        <span class="rstatus ${c.status==='active'?'st-ok':c.status==='done'?'st-ok':'st-w'}" style="margin-left:auto">${c.status==='active'?'Actif':c.status==='done'?'Terminé':'En cours'}</span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:6px">${c.projects||0} projet(s) · ${(c.revenue||0).toLocaleString('fr')}€</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:9px;color:var(--muted2)">
        <span>Progression</span>
        <div class="progress-bar-w"><div class="progress-bar" style="width:${c.progress||0}%"></div></div>
        <span style="color:var(--text);font-weight:600">${c.progress||0}%</span>
      </div>
      <button onclick="deleteClient('${c.id}')" style="margin-top:8px;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--muted2);font-size:10px;padding:3px 8px;font-family:inherit">Supprimer</button>
    </div>`).join('');
}

window.addClient = function() {
  const name = document.getElementById('cl-name')?.value.trim();
  if (!name) { showToast('Nom requis', '#c0392b', 1500); return; }
  const clients = Store.get('clients') || [];
  clients.push({ id: Date.now().toString(), name, type: document.getElementById('cl-type')?.value||'', status: 'active', projects: 0, revenue: 0, progress: 0, lastContact: Date.now(), createdAt: Date.now() });
  Store.set('clients', clients);
  renderClients();
  document.getElementById('add-client-form').style.display = 'none';
  ['cl-name','cl-type'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  addXP('client');
  showToast('Client ajouté +20 XP', '#2e9a63', 2000);
};

window.deleteClient = function(id) {
  Store.set('clients', (Store.get('clients')||[]).filter(c => c.id !== id));
  renderClients();
};

/* ══════════════════════════════
   REVIEWS
══════════════════════════════ */
function renderReviews() {
  const reviews = Store.get('reviews') || [];
  const container = document.getElementById('reviews-list');
  if (!container) return;
  const ok  = reviews.filter(r=>r.status==='approved').length;
  const wt  = reviews.filter(r=>r.status==='pending').length;
  const no  = reviews.filter(r=>r.status==='refused').length;
  const kpis = document.querySelectorAll('#dpage-avis .kpi-val');
  if (kpis[0]) kpis[0].textContent = ok;
  if (kpis[1]) kpis[1].textContent = wt;
  if (kpis[2]) kpis[2].textContent = no;
  const badge = document.querySelector('.ni[data-page="avis"] .nbadge');
  if (badge) badge.textContent = wt || '';

  if (reviews.length === 0) {
    container.innerHTML = `<div class="empty" style="grid-column:span 2"><i class="ti ti-star"></i><div class="empty-title">Aucun avis</div><div class="empty-sub">Les avis de tes clients apparaîtront ici</div></div>`;
    return;
  }
  container.innerHTML = reviews.map(r => `
    <div class="gc rcard">
      <div class="rhead">
        <div class="rav" style="background:var(--gold-dim);color:var(--gold-l)">${(r.author||'?')[0].toUpperCase()}</div>
        <div><div class="rname">${escHtml(r.author)}</div><div class="rdate">${formatDate(r.createdAt)}</div></div>
        <div class="stars" style="margin-left:auto">${'★'.repeat(r.rating||5)}${'☆'.repeat(5-(r.rating||5))}</div>
        <span class="rstatus ${r.status==='approved'?'st-ok':r.status==='refused'?'st-no':'st-w'}">${r.status==='approved'?'Approuvé':r.status==='refused'?'Refusé':'En attente'}</span>
      </div>
      <div class="rtext">${escHtml(r.text)}</div>
      ${r.project?`<div class="rproj">· ${escHtml(r.project)}</div>`:''}
      ${r.status==='pending'?`<div class="modbtns">
        <button class="mbtn mb-ok" onclick="reviewAction('${r.id}','approved')">Approuver</button>
        <button class="mbtn mb-no" onclick="reviewAction('${r.id}','refused')">Refuser</button>
        <button class="mbtn mb-del" onclick="reviewAction('${r.id}','delete')">Supprimer</button>
      </div>`:''}
    </div>`).join('');
}

window.addReview = function() {
  const author = document.getElementById('rv-author')?.value.trim();
  const text   = document.getElementById('rv-text')?.value.trim();
  const rating = parseInt(document.getElementById('rv-rating')?.value) || 5;
  if (!author || !text) { showToast('Auteur et avis requis', '#c0392b', 1500); return; }
  const reviews = Store.get('reviews') || [];
  reviews.push({ id: Date.now().toString(), author, text, rating, status: 'pending', project: document.getElementById('rv-project')?.value||'', createdAt: Date.now() });
  Store.set('reviews', reviews);
  renderReviews();
  document.getElementById('add-review-form').style.display = 'none';
  ['rv-author','rv-text','rv-project'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  Store.addNotification(`Nouvel avis de ${author}`, 'gold');
  renderNotifications();
};

window.reviewAction = function(id, action) {
  const reviews = Store.get('reviews') || [];
  if (action === 'delete') {
    Store.set('reviews', reviews.filter(r => r.id !== id));
  } else {
    const r = reviews.find(r => r.id === id);
    if (r) {
      r.status = action;
      if (action === 'approved') addXP('review');
    }
    Store.set('reviews', reviews);
  }
  renderReviews();
};

/* ══════════════════════════════
   NOTIFICATIONS
══════════════════════════════ */
function renderNotifications() {
  const notifs = Store.get('notifications') || [];
  const container = document.getElementById('notif-list');
  if (!container) return;
  const unread = notifs.filter(n => !n.read).length;
  const dot = document.querySelector('.ndot');
  if (dot) dot.style.display = unread > 0 ? '' : 'none';
  const badge = document.querySelector('.ni[data-page="overview"] .nbadge');
  if (badge) badge.textContent = unread > 0 ? unread : '';

  container.innerHTML = notifs.slice(0, 8).map(n => `
    <div class="nitem${n.read?' read':''}" onclick="markRead('${n.id}')">
      <div class="nd" style="background:${n.type==='gold'?'var(--gold)':n.type==='green'?'var(--green)':'var(--muted)'}"></div>
      <div class="nt">${escHtml(n.text)}</div>
      <div class="ntime">${timeAgo(n.time)}</div>
    </div>`).join('') || '<div style="font-size:10px;color:var(--muted);padding:8px 0">Aucune notification</div>';
}

window.markRead = function(id) {
  const notifs = Store.get('notifications') || [];
  const n = notifs.find(n => n.id == id);
  if (n) n.read = true;
  Store.set('notifications', notifs);
  renderNotifications();
};

window.markAllRead = function() {
  const notifs = (Store.get('notifications')||[]).map(n => ({ ...n, read: true }));
  Store.set('notifications', notifs);
  renderNotifications();
};

/* ══════════════════════════════
   SETTINGS SAVE
══════════════════════════════ */
window.saveProfile = function() {
  const profile = Store.get('profile') || {};
  profile.displayName = document.getElementById('set-displayname')?.value.trim() || profile.displayName;
  profile.creatorCode = document.getElementById('set-code')?.value.trim() || profile.creatorCode;
  profile.bio = document.getElementById('set-bio')?.value.trim() || '';
  Store.set('profile', profile);
  renderXP(profile);
  showToast('Profil sauvegardé ✓', '#2e9a63', 1800);
};

window.saveSettings = function(section) {
  const settings = Store.get('settings') || {};
  if (section === 'behance') {
    settings.behanceUsername = document.getElementById('set-behance')?.value.trim() || '';
    settings.behanceConnected = !!settings.behanceUsername;
  }
  if (section === 'github') {
    settings.githubRepo = document.getElementById('set-github')?.value.trim() || '';
  }
  if (section === 'kofi') {
    settings.kofiUsername = document.getElementById('set-kofi')?.value.trim() || '';
  }
  if (section === 'lang') {
    settings.lang = document.getElementById('set-lang')?.value || 'fr';
  }
  if (section === 'seo') {
    settings.seoTitle = document.getElementById('set-seo-title')?.value.trim() || '';
    settings.seoDesc  = document.getElementById('set-seo-desc')?.value.trim() || '';
    settings.seoImage = document.getElementById('set-seo-image')?.value.trim() || '';
  }
  if (section === 'privacy') {
    settings.portfolioPublic = document.getElementById('tog-portfolio-public')?.classList.contains('on') || false;
    settings.noindex = document.getElementById('tog-noindex')?.classList.contains('on') || false;
    settings.linksPublic = document.getElementById('tog-links-public')?.classList.contains('on') || false;
  }
  Store.set('settings', settings);
  showToast('Sauvegardé ✓', '#2e9a63', 1800);
};

function renderSettings() {
  const s = Store.get('settings') || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('set-behance', s.behanceUsername);
  setVal('set-github',  s.githubRepo);
  setVal('set-kofi',    s.kofiUsername);
  setVal('set-lang',    s.lang || 'fr');
  setVal('set-seo-title', s.seoTitle);
  setVal('set-seo-desc',  s.seoDesc);
  setVal('set-seo-image', s.seoImage);
  // toggles
  const setTog = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on', !!val);
    el.classList.toggle('off', !val);
  };
  setTog('tog-portfolio-public', s.portfolioPublic !== false);
  setTog('tog-noindex', !!s.noindex);
  setTog('tog-links-public', s.linksPublic !== false);
}

/* ══════════════════════════════
   STORAGE
══════════════════════════════ */
function renderStorage() {
  const st = Store.get('storage') || {};
  const used  = st.used || 0;
  const limit = st.limit || 1073741824;
  const pct   = Math.min(100, Math.round(used / limit * 100));
  const bar   = document.querySelector('.stor-bar');
  if (bar) bar.style.width = pct + '%';

  const usedGo  = (used  / 1073741824).toFixed(2);
  const freeGo  = ((limit - used) / 1073741824).toFixed(2);
  const totalGo = (limit / 1073741824).toFixed(0);

  const usedEl  = document.getElementById('stor-used');
  const freeEl  = document.getElementById('stor-free');
  if (usedEl)  usedEl.textContent  = usedGo + ' Go';
  if (freeEl)  freeEl.textContent  = freeGo + ' Go libres';

  // file list
  const all = Object.values(st.structure || {}).flat();
  const container = document.getElementById('stor-files');
  if (!container) return;
  if (all.length === 0) {
    container.innerHTML = '<div class="empty"><i class="ti ti-folder"></i><div class="empty-title">Aucun fichier</div></div>';
    return;
  }
  container.innerHTML = all.slice(-5).reverse().map(f => `
    <div class="stor-file">
      <div class="stor-ico" style="background:var(--gold-dim);color:var(--gold-l)"><i class="ti ti-file"></i></div>
      <div style="flex:1"><div class="stor-name">${escHtml(f.name)}</div><div class="stor-path">${escHtml(f.folder||'')}</div></div>
      <span style="font-size:9px;color:var(--muted)">${formatSize(f.size||0)}</span>
    </div>`).join('');
}

/* ══════════════════════════════
   MEDIA
══════════════════════════════ */
function renderMedia() {
  const media = Store.get('media') || [];
  const container = document.getElementById('media-grid');
  if (!container) return;
  const icons = { image: '🖼️', pdf: '📄', video: '🎬', logo: '✏️', other: '📁' };
  if (media.length === 0) {
    container.innerHTML = `<div class="empty" style="grid-column:span 4"><i class="ti ti-photo"></i><div class="empty-title">Aucun média</div><div class="empty-sub">Importe tes fichiers</div></div>`;
    return;
  }
  container.innerHTML = media.map(m => `
    <div class="media-card" data-type="${m.type||'other'}">
      <div class="media-thumb">${icons[m.type||'other']||'📁'}</div>
      <div class="media-info">
        <div class="media-name">${escHtml(m.name)}</div>
        <div class="media-size">${formatSize(m.size||0)} · ${(m.type||'file').toUpperCase()}</div>
      </div>
    </div>`).join('');
}

window.importMedia = function(event) {
  const files = event?.target?.files;
  if (!files || files.length === 0) {
    // fake import dialog
    const name = prompt('Nom du fichier (ex: logo.png) :');
    if (!name) return;
    const ext = name.split('.').pop().toLowerCase();
    const typeMap = { png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image', svg:'logo', pdf:'pdf', mp4:'video', mov:'video', docx:'other', zip:'other' };
    const type = typeMap[ext] || 'other';
    const media = Store.get('media') || [];
    const file = { id: Date.now().toString(), name, type, size: Math.floor(Math.random()*5000000)+50000, uploadedAt: Date.now() };
    media.push(file);
    Store.set('media', media);
    // add to storage
    const st = Store.get('storage') || {};
    st.used = (st.used||0) + file.size;
    Store.set('storage', st);
    renderMedia();
    renderStorage();
    showToast('Fichier ajouté', '#2e9a63', 1500);
    return;
  }
  const media = Store.get('media') || [];
  const st = Store.get('storage') || {};
  Array.from(files).forEach(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    const typeMap = { png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image', svg:'logo', pdf:'pdf', mp4:'video', mov:'video', docx:'other', zip:'other' };
    const type = typeMap[ext] || 'other';
    media.push({ id: Date.now().toString()+Math.random(), name: f.name, type, size: f.size, uploadedAt: Date.now() });
    st.used = (st.used||0) + f.size;
  });
  Store.set('media', media);
  Store.set('storage', st);
  renderMedia();
  renderStorage();
  showToast(`${files.length} fichier(s) ajouté(s)`, '#2e9a63', 1500);
};

/* ══════════════════════════════
   SIDEBAR SEARCH
══════════════════════════════ */
const PAGES_INDEX = [
  {label:"Vue d'ensemble",page:'overview',icon:'ti-layout-dashboard'},
  {label:'Portfolio',page:'portfolio',icon:'ti-layout-grid'},
  {label:'Portfolio Builder',page:'builder',icon:'ti-tool'},
  {label:'Analytics',page:'analytics',icon:'ti-chart-bar'},
  {label:'Avis',page:'avis',icon:'ti-star'},
  {label:'Profil Links',page:'links',icon:'ti-link'},
  {label:'Facturation',page:'facturation',icon:'ti-receipt'},
  {label:'CV & Carrière',page:'cv',icon:'ti-file-cv'},
  {label:'QR Builder',page:'qr',icon:'ti-qrcode'},
  {label:'Clients',page:'clients',icon:'ti-users'},
  {label:'Médias',page:'media',icon:'ti-photo'},
  {label:'Badges & XP',page:'badges',icon:'ti-award'},
  {label:'GitHub Hub',page:'github',icon:'ti-brand-github'},
  {label:'Stockage',page:'storage',icon:'ti-folder'},
  {label:'Paramètres',page:'settings',icon:'ti-settings'},
];
function filterNav(q) {
  const res = document.getElementById('sb-search-results');
  if (!res) return;
  if (!q) { res.classList.remove('open'); return; }
  const filtered = PAGES_INDEX.filter(p => p.label.toLowerCase().includes(q.toLowerCase()));
  if (!filtered.length) { res.classList.remove('open'); return; }
  res.innerHTML = filtered.map(p => `<div class="sr-item" onclick="goPage('${p.page}','${p.label}')"><i class="ti ${p.icon}"></i>${p.label}</div>`).join('');
  res.classList.add('open');
}
window.goPage = function(page, label) {
  const btn = document.querySelector(`.ni[data-page="${page}"]`);
  sw(page, btn, label);
  document.getElementById('sb-search-results')?.classList.remove('open');
  const inp = document.querySelector('.ss input');
  if (inp) { inp.value = ''; inp.blur(); }
};

/* ══════════════════════════════
   TOGGLES
══════════════════════════════ */
document.addEventListener('click', e => {
  const tog = e.target.closest('.tog');
  if (tog) { tog.classList.toggle('on'); tog.classList.toggle('off'); }
});

/* ══════════════════════════════
   QR BUILDER
══════════════════════════════ */
window.generateQR = function() {
  const input = document.getElementById('qr-input');
  const val = input?.value.trim() || `https://souanpt.hub/${Store.currentUser()||'profile'}`;
  const color = document.querySelector('.qr-swatch.active')?.dataset.color || '#e4b24a';
  const preview = document.getElementById('qr-preview-area');
  if (!preview) return;
  const s = 180, cells = 21, cs = Math.floor(s / cells);
  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (Math.imul(31,h)+str.charCodeAt(i))|0; return Math.abs(h); }
  const h = hash(val);
  let rects = '';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const finder = (r<7&&c<7)||(r<7&&c>=cells-7)||(r>=cells-7&&c<7);
      const inner  = (r>=2&&r<=4&&c>=2&&c<=4&&r<7&&c<7)||(r>=2&&r<=4&&c>=cells-5&&c<cells&&r<7)||(r>=cells-5&&r<cells&&c>=2&&c<=4);
      if (finder&&!inner) rects += `<rect x="${c*cs}" y="${r*cs}" width="${cs}" height="${cs}" fill="${color}"/>`;
      else if (!finder) { if (hash(val+r+','+c+h)%3===0) rects += `<rect x="${c*cs}" y="${r*cs}" width="${cs-1}" height="${cs-1}" rx="1" fill="${color}" opacity=".85"/>`; }
    }
  }
  preview.innerHTML = `<svg width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg" style="border-radius:8px;background:#111;padding:8px">${rects}</svg>`;
  addXP('qr_scan', 0.5);
};

/* ══════════════════════════════
   BUILDER
══════════════════════════════ */
window.addBuilderBlock = function(type) {
  const canvas = document.getElementById('builder-canvas');
  if (!canvas) return;
  const map = { text:['Bloc Texte','📝'], gallery:['Galerie','🖼️'], project:['Projet','🎨'], video:['Vidéo','🎬'], contact:['Contact','📬'] };
  const [label, emoji] = map[type] || ['Bloc','📦'];
  const sec = document.createElement('div');
  sec.className = 'b-section';
  sec.innerHTML = `<div class="b-section-label">${label}</div><div style="font-size:28px;margin-bottom:8px">${emoji}</div><div style="font-size:11px;color:var(--muted3)">Cliquer pour éditer</div><button class="b-section-remove" onclick="this.closest('.b-section').remove()">✕</button>`;
  canvas.appendChild(sec);
};

/* ══════════════════════════════
   EXPORT / IMPORT DATA
══════════════════════════════ */
window.exportData = function() {
  const data = Store.exportAll();
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `souanpt-hub-backup-${Store.currentUser()}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export téléchargé', '#2e9a63', 1800);
};

window.importData = function() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (Store.importAll(ev.target.result)) {
        loadDashData();
        showToast('Import réussi ✓', '#2e9a63', 2000);
      } else {
        showToast('Fichier invalide', '#c0392b', 2000);
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

/* ══════════════════════════════
   UTILS
══════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1048576) return (bytes/1024).toFixed(0) + ' Ko';
  if (bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' Mo';
  return (bytes/1073741824).toFixed(2) + ' Go';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)   return 'À l\'instant';
  if (diff < 3600000) return Math.floor(diff/60000) + ' min';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h';
  return Math.floor(diff/86400000) + 'j';
}

function daysSince(ts) {
  return Math.floor((Date.now() - ts) / 86400000);
}

/* ══════════════════════════════
   EVENTS
══════════════════════════════ */
document.addEventListener('input', e => {
  if (e.target.matches('.ss input')) filterNav(e.target.value);
  // SEO live preview
  if (e.target.id === 'set-seo-title') {
    const el = document.getElementById('seo-title-prev');
    if (el) el.textContent = e.target.value;
  }
  if (e.target.id === 'set-seo-desc') {
    const el = document.getElementById('seo-desc-prev');
    if (el) el.textContent = e.target.value;
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.sb-search')) {
    document.getElementById('sb-search-results')?.classList.remove('open');
  }
  // notification bell
  if (e.target.closest('.tb-icon')) {
    const dot = document.querySelector('.ndot');
    if (dot) dot.style.display = 'none';
  }
  // qr swatch
  const sw = e.target.closest('.qr-swatch');
  if (sw) {
    document.querySelectorAll('.qr-swatch').forEach(x => x.classList.remove('active'));
    sw.classList.add('active');
  }
  // faq
  const fitem = e.target.closest('.faq-item');
  if (fitem) fitem.classList.toggle('open');
  // analytics tab
  const atab = e.target.closest('.atab');
  if (atab) {
    atab.closest('.a-tabs')?.querySelectorAll('.atab').forEach(t => t.classList.remove('active'));
    atab.classList.add('active');
  }
  // media type filter
  const mtbtn = e.target.closest('.mt-btn');
  if (mtbtn) {
    mtbtn.closest('.media-type-tabs')?.querySelectorAll('.mt-btn').forEach(b => b.classList.remove('active'));
    mtbtn.classList.add('active');
    const type = mtbtn.dataset.type;
    document.querySelectorAll('.media-card').forEach(c => {
      c.style.display = (type === 'all' || c.dataset.type === type) ? '' : 'none';
    });
  }
  // settings save buttons
  const saveBtn = e.target.closest('[data-save]');
  if (saveBtn) saveSettings(saveBtn.dataset.save);
});

document.addEventListener('keydown', e => {
  if ((e.metaKey||e.ctrlKey) && e.key === 'f' && document.body.classList.contains('in-dash')) {
    e.preventDefault();
    document.querySelector('.ss input')?.focus();
  }
  if (e.key === 'Escape') {
    const inp = document.querySelector('.ss input');
    if (inp) { inp.value = ''; inp.blur(); filterNav(''); }
  }
});

/* ══════════════════════════════
   INIT
══════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Add shake animation CSS
  const style = document.createElement('style');
  style.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`;
  document.head.appendChild(style);

  // Auto-login if session exists
  if (Store.isLoggedIn()) {
    bootDash();
  }
});
