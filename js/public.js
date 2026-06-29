/* ══ public.js — public site navigation ══ */
'use strict';

window.pubNav = function(id) {
  document.querySelectorAll('.pub-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.pnl').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById('pub-' + id);
  if (sec) sec.classList.add('active');
  const btn = document.getElementById('pnl-' + id);
  if (btn) btn.classList.add('active');
  const scroll = document.querySelector('.pub-scroll');
  if (scroll) scroll.scrollTop = 0;
};

window.enterDash = function() {
  document.body.classList.add('in-dash');
  setTimeout(() => {
    if (typeof buildDashChart === 'function') buildDashChart(30);
  }, 80);
};

window.exitDash = function() {
  document.body.classList.remove('in-dash');
};

/* FAQ accordion */
document.addEventListener('click', function(e) {
  const item = e.target.closest('.faq-item');
  if (item) item.classList.toggle('open');
});

/* Hero reserve button */
document.addEventListener('DOMContentLoaded', function() {
  const heroBtn = document.querySelector('.hero-btn');
  if (heroBtn) {
    heroBtn.addEventListener('click', function() {
      const input = document.querySelector('.hero-input-wrap input');
      const val = input ? input.value.trim() : '';
      if (val.length < 2) { if (input) input.focus(); return; }
      pubNav('login');
    });
  }

  /* Footer links wiring */
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', function() {
      pubNav(this.dataset.nav);
    });
  });
});
