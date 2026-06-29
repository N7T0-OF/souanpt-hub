/* ══ dashboard.js — dashboard interactions ══ */
'use strict';

window.sw = function(id, btn, lbl) {
  document.querySelectorAll('.dpage').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('dpage-' + id);
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');
  const title = document.getElementById('ptitle');
  if (title) title.textContent = lbl || id;
  const scroll = document.querySelector('.scroll-area');
  if (scroll) scroll.scrollTop = 0;
  /* lazy chart init */
  if (id === 'overview' && typeof buildDashChart === 'function') buildDashChart(window._dashPeriod || 30);
  if (id === 'analytics' && typeof initAnalyticsCharts === 'function') initAnalyticsCharts();
};

window.switchP = function(pts, btn) {
  document.querySelectorAll('.cf').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (typeof buildDashChart === 'function') buildDashChart(pts);
};

/* Toggle switches */
document.addEventListener('click', function(e) {
  const tog = e.target.closest('.tog');
  if (tog) { tog.classList.toggle('on'); tog.classList.toggle('off'); }
});

/* Notification dot — hide on bell click */
document.addEventListener('click', function(e) {
  if (e.target.closest('.tb-icon')) {
    const dot = document.querySelector('.ndot');
    if (dot) dot.style.display = 'none';
  }
});

/* ⌘F → sidebar search */
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f' && document.body.classList.contains('in-dash')) {
    const inp = document.querySelector('.ss input');
    if (inp) { e.preventDefault(); inp.focus(); }
  }
});

/* Sidebar search filter */
document.addEventListener('input', function(e) {
  if (!e.target.matches('.ss input')) return;
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.sb-nav .ni').forEach(function(btn) {
    btn.style.display = (!q || btn.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
});

/* ── Avis moderation ── */
function updateAvisCounters() {
  const ok  = document.querySelectorAll('#dpage-avis .rstatus.st-ok').length;
  const wt  = document.querySelectorAll('#dpage-avis .rstatus.st-w').length;
  const no  = document.querySelectorAll('#dpage-avis .rstatus.st-no').length;
  const kpis = document.querySelectorAll('#dpage-avis .kpi-val');
  if (kpis[0]) kpis[0].textContent = ok;
  if (kpis[1]) kpis[1].textContent = wt;
  if (kpis[2]) kpis[2].textContent = no;
  const badge = document.querySelector('.ni[data-page="avis"] .nbadge');
  if (badge) badge.textContent = wt || '';
}

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.mbtn');
  if (!btn) return;
  const card = btn.closest('.rcard');
  if (!card) return;
  const badge = card.querySelector('.rstatus');

  if (btn.classList.contains('mb-ok')) {
    if (badge) { badge.className = 'rstatus st-ok'; badge.textContent = 'Approuvé'; }
    const mbtns = btn.closest('.modbtns');
    if (mbtns) mbtns.remove();
    updateAvisCounters();
    if (typeof addXP === 'function') addXP('review');
  } else if (btn.classList.contains('mb-no')) {
    if (badge) { badge.className = 'rstatus st-no'; badge.textContent = 'Refusé'; }
    const mbtns = btn.closest('.modbtns');
    if (mbtns) mbtns.remove();
    updateAvisCounters();
  } else if (btn.classList.contains('mb-del')) {
    card.style.transition = 'opacity .3s, transform .3s';
    card.style.opacity = '0';
    card.style.transform = 'scale(.97)';
    setTimeout(() => { card.remove(); updateAvisCounters(); }, 300);
  }
});

/* ── Settings save feedback ── */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.sc-body .btn-gold');
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = '✓ Sauvegardé';
  btn.style.background = 'var(--green)';
  setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2200);
});

/* ── Facturation: add row ── */
document.addEventListener('click', function(e) {
  if (!e.target.closest('[data-action="add-prestation"]')) return;
  const name   = prompt('Nom de la prestation :');
  if (!name) return;
  const client = prompt('Client :') || '—';
  const price  = prompt('Prix (€) :') || '0';
  const date   = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
  const row = document.createElement('div');
  row.className = 'fac-row';
  row.innerHTML = `<div class="fac-name">${name}</div><div class="fac-client">${client}</div><div class="fac-price">${Number(price).toLocaleString('fr')} €</div><div class="fac-date">${date}</div><div class="fac-status fs-wait">En attente</div>`;
  const list = document.querySelector('#dpage-facturation .gc.fac-list');
  if (list) list.appendChild(row);
  if (typeof addXP === 'function') addXP('invoice', 10);
});
