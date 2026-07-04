'use strict';

const XP_GAINS = {
  view: 0.1, qr_scan: 0.5, review: 5,
  project: 20, client: 20, invoice: 50,
  link_click: 0.2, login: 2
};

const XP_THRESHOLDS = {
  next(level) {
    if (level < 5)  return level * 100;
    if (level < 10) return level * 250;
    if (level < 25) return level * 500;
    if (level < 50) return level * 1000;
    return level * 2000;
  }
};

function addXP(type, override) {
  if (!Store.isLoggedIn()) return;
  const gain = override !== undefined ? override : (XP_GAINS[type] || 1);
  const profile = Store.get('profile') || {};
  profile.xp = (profile.xp || 0) + gain;

  // level up
  let cap = XP_THRESHOLDS.next(profile.level || 1);
  let leveled = false;
  while (profile.xp >= cap) {
    profile.xp -= cap;
    profile.level = (profile.level || 1) + 1;
    cap = XP_THRESHOLDS.next(profile.level);
    leveled = true;
    showToast(`🎉 Niveau ${profile.level} atteint !`, '#e4b24a', 3000);
    Store.addNotification(`Niveau ${profile.level} atteint ! 🎉`, 'gold');
  }

  Store.set('profile', profile);
  Store.addXPLog(type, gain);

  if (gain >= 1) showToast(`+${gain} XP`, '#c9922a', 1500);

  renderXP(profile);
  return profile;
}

function renderXP(profile) {
  if (!profile) profile = Store.get('profile');
  if (!profile) return;

  const level = profile.level || 1;
  const xp    = profile.xp   || 0;
  const cap   = XP_THRESHOLDS.next(level);
  const pct   = Math.min(100, Math.round(xp / cap * 100));

  const bar  = document.querySelector('.xp-bar');
  const lvl  = document.querySelector('.xp-level');
  const nums = document.querySelectorAll('.xp-nums span');
  const av   = document.querySelector('.xp-av');
  const name = document.querySelector('.xp-name');

  if (bar)  bar.style.width = pct + '%';
  if (lvl)  lvl.textContent = `Niveau ${level} · ${profile.plan === 'premium' ? 'Premium' : 'Gratuit'}`;
  if (nums[0]) nums[0].textContent = Math.round(xp).toLocaleString('fr') + ' XP';
  if (nums[1]) nums[1].textContent = cap.toLocaleString('fr') + ' XP';
  if (av)   av.textContent = profile.avatar || profile.username[0].toUpperCase();
  if (name) name.textContent = profile.displayName || profile.username;
}

function showToast(msg, bg, dur) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${bg};color:#080808;font-family:Sora,sans-serif;font-size:11px;font-weight:700;padding:8px 16px;border-radius:20px;opacity:1;transition:opacity .4s,transform .4s;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(4px)'; }, dur - 400);
  setTimeout(() => t.remove(), dur);
}

window.addXP   = addXP;
window.renderXP = renderXP;
window.showToast = showToast;
