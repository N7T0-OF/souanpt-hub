/* ══════════════════════════════════════════════════════════════
   ZONES DE DÉPÔT (v3.28) — remplace le bouton natif « Choisir un fichier /
   Aucun fichier choisi » par une vraie zone : icône, « Dépose un fichier ici
   ou clique pour parcourir », taille maximale, puis le nom du fichier choisi.
   Automatique : tout <input type="file"> VISIBLE (pas `hidden`, pas déjà
   dans une étiquette personnalisée) est habillé dès qu'il apparaît, y compris
   dans les micro-fenêtres de l'éditeur. L'input reste le vrai champ : ses
   gestionnaires `onchange` existants continuent de fonctionner (le dépôt
   remplit input.files puis déclenche `change`).
   Attributs facultatifs : data-max="4" (Mo), data-label="Logo du site".
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M5 13a1 1 0 0 1 1 1v3.5c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5V14a1 1 0 1 1 2 0v3.5A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5V14a1 1 0 0 1 1-1Zm7-9a1 1 0 0 1 .7.3l3.5 3.5a1 1 0 1 1-1.4 1.4L13 7.42V15a1 1 0 1 1-2 0V7.42L9.2 9.2a1 1 0 0 1-1.4-1.4l3.5-3.5A1 1 0 0 1 12 4Z"/></svg>';

  /** Libellé lisible des formats acceptés (« image », « audio », « .json »…). */
  function kindOf(accept) {
    const a = String(accept || '').toLowerCase();
    if (!a) return '';
    if (/^image\//.test(a) || a.split(',').every(x => /^image\/|^\.(png|jpe?g|webp|gif|avif|svg)$/.test(x.trim()))) return 'Images';
    if (/^audio\//.test(a)) return 'Audio';
    if (/^video\//.test(a)) return 'Vidéo';
    return a.split(',').map(x => x.trim().replace(/^\./, '').replace(/\/\*$/, '').toUpperCase()).join(', ');
  }
  /** Le fichier respecte-t-il l'attribut accept ? (même règle que le navigateur) */
  function accepts(input, file) {
    const list = String(input.accept || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    const name = String(file.name || '').toLowerCase(), type = String(file.type || '').toLowerCase();
    return list.some(rule => rule.startsWith('.') ? name.endsWith(rule) : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule);
  }
  function eligible(input) {
    return input && input.type === 'file' && !input.hidden && !input.dataset.hd && !input.closest('label') && !input.closest('[data-hd-skip]')
      && input.style.display !== 'none' && input.isConnected;
  }

  function enhance(input) {
    if (!eligible(input)) return;
    input.dataset.hd = '1';
    const max = parseFloat(input.dataset.max) || 0, kind = kindOf(input.accept);
    const zone = document.createElement('label');
    zone.className = 'hd-zone';
    input.parentNode.insertBefore(zone, input);
    zone.innerHTML = `<span class="hd-ic">${ICON}</span><span class="hd-tx"><b>${esc(input.dataset.label || (input.multiple ? 'Dépose des fichiers ici ou clique pour parcourir' : 'Dépose un fichier ici ou clique pour parcourir'))}</b>
      <small class="hd-sub">${esc([kind, max ? 'Max ' + String(max).replace('.', ',') + ' Mo' : ''].filter(Boolean).join(' · '))}</small></span>`;
    zone.appendChild(input);
    input.classList.add('hd-input');
    const sub = zone.querySelector('.hd-sub'), base = sub.textContent;
    const show = () => {
      const fs = [...(input.files || [])];
      zone.classList.toggle('has', fs.length > 0);
      sub.textContent = fs.length ? (fs.length === 1 ? fs[0].name + ' · ' + size(fs[0].size) : fs.length + ' fichiers') + ' — clique pour changer' : base;
      if (fs.length && max && fs.some(f => f.size > max * 1048576)) { zone.classList.add('bad'); sub.textContent = 'Trop lourd : ' + size(Math.max(...fs.map(f => f.size))) + ' (max ' + max + ' Mo)'; }
      else zone.classList.remove('bad');
    };
    input.addEventListener('change', show);
    let depth = 0;
    zone.addEventListener('dragenter', ev => { ev.preventDefault(); depth++; zone.classList.add('over'); });
    zone.addEventListener('dragover', ev => { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'copy'; } catch {} });
    zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('over'); } });
    zone.addEventListener('drop', ev => {
      ev.preventDefault(); depth = 0; zone.classList.remove('over');
      const files = [...(ev.dataTransfer && ev.dataTransfer.files || [])].filter(f => accepts(input, f));
      if (!files.length) { window.showToast && showToast('Format non accepté' + (kind ? ' — ' + kind : ''), '#c0392b', 2200); return; }
      try {
        const dt = new DataTransfer(); (input.multiple ? files : files.slice(0, 1)).forEach(f => dt.items.add(f));
        input.files = dt.files;
      } catch { window.showToast && showToast('Dépôt non pris en charge ici — clique pour parcourir', '#e4b24a', 2400); return; }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function scan(root) {
    (root.querySelectorAll ? root.querySelectorAll('input[type=file]') : []).forEach(enhance);
    if (root.tagName === 'INPUT') enhance(root);
  }
  function start() {
    scan(document);
    new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.HubDrop = { enhance, accepts, kindOf };
})();
