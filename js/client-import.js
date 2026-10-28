/* Import local des NOMS de dossiers. Aucun contenu de fichier n'est lu ou envoyé.
   Racine / client / projet : seuls ces deux niveaux de sous-dossiers comptent. */
(function () {
  const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim().replace(/\s+/g,' ');
  const similar = (a, b) => {
    const left = norm(a), right = norm(b);
    return left !== right && Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left));
  };
  const valid = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 150 && !/[\x00-\x1f<>]/.test(value);
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const ClientImport = {
    root: '', rows: [], report: null, running: false,
    open() {
      if (this.running) return;
      let el = document.getElementById('ci-root');
      if (!el) { el = document.createElement('div'); el.id = 'ci-root'; document.body.appendChild(el); }
      el.innerHTML = `<div class="ci-shade" onclick="ClientImport.close()"></div><section class="ci-dialog" role="dialog" aria-modal="true" aria-label="Importer clients et projets">
        <header><h2>📁 Importer des clients et projets</h2><button class="btn btn-ghost" onclick="ClientImport.close()" aria-label="Fermer">✕</button></header>
        <p>Choisis un dossier comme <code>E:\\AA moi\\clients</code>. Seuls les noms de ses sous-dossiers seront analysés. Aucun fichier ne sera lu ni transféré. Les données resteront dans ce navigateur jusqu'à leur sauvegarde privée autorisée.</p>
        <div class="ci-actions"><button class="btn btn-accent" onclick="ClientImport.choose()">Choisir un dossier</button><label class="btn btn-ghost" style="cursor:pointer">Sélection compatible <input id="ci-files" type="file" webkitdirectory multiple style="display:none" onchange="ClientImport.fromFiles(this.files)"></label></div>
        <div id="ci-status" role="status">Aucun dossier sélectionné.</div><div id="ci-preview"></div></section>`;
      this._style();
      el.querySelector('button')?.focus();
    },
    close() { if (!this.running) document.getElementById('ci-root')?.remove(); },
    _style() {
      if (document.getElementById('ci-style')) return;
      const style = document.createElement('style'); style.id = 'ci-style';
      style.textContent = `#ci-root{position:fixed;inset:0;z-index:990}.ci-shade{position:absolute;inset:0;background:#000b;backdrop-filter:blur(6px)}.ci-dialog{position:relative;margin:3vh auto;width:min(760px,calc(100vw - 24px));max-height:94vh;overflow:auto;background:var(--s1);border:1px solid var(--border2);border-radius:16px;padding:20px;color:var(--text);box-shadow:0 24px 90px #0009}.ci-dialog header{display:flex;justify-content:space-between;align-items:center;gap:12px}.ci-dialog h2{font-size:17px}.ci-dialog p{font-size:11px;color:var(--muted2);line-height:1.6}.ci-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}#ci-status{font-size:11px;color:var(--gold-l);margin:10px 0}.ci-client{border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px 0}.ci-client.ci-review{border-color:var(--gold-l)}.ci-client>label{font-weight:700}.ci-project{display:block;margin:7px 0 0 21px;font-size:11px}.ci-options{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;margin:12px 0}.ci-options label{display:flex;gap:5px;align-items:center}.ci-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ci-row select,.ci-row input[type=text]{background:var(--s2);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:5px;font-size:11px}.ci-summary{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:11px;line-height:1.7}.ci-progress{width:100%;height:9px;accent-color:var(--accent)}`;
      document.head.appendChild(style);
    },
    status(message) { const el = document.getElementById('ci-status'); if (el) el.textContent = message; },
    async choose() {
      if (!window.showDirectoryPicker) { this.status('Sélection directe indisponible ici. Utilise « Navigateur compatible ». Les dossiers vides peuvent manquer.'); return; }
      try {
        const root = await window.showDirectoryPicker({ mode:'read' });
        this.status('Analyse des noms de dossiers…');
        const rows = [];
        for await (const client of root.values()) {
          if (client.kind !== 'directory' || !valid(client.name)) continue;
          const projects = [];
          for await (const project of client.values()) if (project.kind === 'directory' && valid(project.name)) projects.push(project.name);
          rows.push({ name:client.name, projects });
          if (rows.length % 20 === 0) await pause();
        }
        this.load(root.name, rows, false);
      } catch (error) {
        if (error?.name !== 'AbortError') this.status('Lecture du dossier impossible : ' + (error?.message || 'erreur inconnue'));
      }
    },
    fromFiles(files) {
      const paths = [...(files || [])].map(f => f.webkitRelativePath).filter(Boolean);
      if (!paths.length) return this.status('Aucun fichier détecté. Le mode compatible ne voit pas les dossiers vides.');
      const root = paths[0].split('/')[0];
      const byClient = new Map();
      for (const path of paths) {
        const parts = path.split('/');
        if (parts[0] !== root || parts.length < 3 || !valid(parts[1])) continue;
        if (!byClient.has(parts[1])) byClient.set(parts[1], new Set());
        // root / client / project / fichier : les niveaux suivants sont ignorés.
        if (parts.length >= 4 && valid(parts[2])) byClient.get(parts[1]).add(parts[2]);
      }
      this.load(root, [...byClient].map(([name, projects]) => ({ name, projects:[...projects] })), true);
    },
    load(root, rows, fallback) {
      this.root = valid(root) ? root.trim() : 'dossier';
      this.rows = rows.filter(r => valid(r.name)).slice(0, 1000).map(r => ({ name:r.name.trim(), projects:[...new Set((r.projects || []).filter(valid).map(x => x.trim()))].slice(0, 2000), selected:true, selectedProjects:null, matchId:'' }));
      this.report = null;
      const total = this.rows.reduce((n,r) => n + r.projects.length, 0);
      this.status(`${this.rows.length} client(s), ${total} projet(s) détectés dans « ${this.root} ».${fallback ? ' Les dossiers vides ne sont pas visibles dans ce mode.' : ''}`);
      document.getElementById('ci-preview')?.replaceChildren();
      this.preview();
    },
    preview() {
      const el = document.getElementById('ci-preview'); if (!el) return;
      if (el.querySelector?.('[data-ci-client]')) this.rememberSelection();
      if (!this.rows.length) { el.innerHTML = '<p>Aucun sous-dossier client détecté.</p>'; return; }
      const existing = read('hub_clients');
      const options = existing.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      el.innerHTML = `<div class="ci-options"><label><input type="checkbox" id="ci-attach" checked onchange="ClientImport.summary()">Rattacher les clients exacts</label><label><input type="checkbox" id="ci-create" checked onchange="ClientImport.summary()">Créer les clients manquants</label><label><input type="checkbox" id="ci-duplicates" checked onchange="ClientImport.summary()">Ignorer les projets déjà présents</label></div>
        <div class="ci-actions"><button class="btn btn-ghost" onclick="ClientImport.selectAll(true)">Tout sélectionner</button><button class="btn btn-ghost" onclick="ClientImport.selectAll(false)">Tout désélectionner</button></div>
        ${this.rows.map((r,i) => {
          const exact = existing.find(c => norm(c.name) === norm(r.name));
          const suggestion = !exact && existing.find(c => similar(c.name, r.name));
          const needsReview = !!suggestion && !r.matchId;
          return `<div class="ci-client${needsReview ? ' ci-review' : ''}"><div class="ci-row"><label><input type="checkbox" data-ci-client="${i}"${r.selected !== false ? ' checked' : ''} onchange="ClientImport.summary()"> ${esc(r.name)}</label><small>${exact ? 'Client existant' : suggestion ? 'Nom proche : ' + esc(suggestion.name) + ' — choisir une action' : 'Nouveau client'}</small>
            <select data-ci-match="${i}" aria-label="Rattacher ${esc(r.name)}" onchange="ClientImport.summary()"><option value="">${exact ? 'Rattacher automatiquement' : suggestion ? 'Choisir un client ou créer une fiche distincte…' : 'Nouveau client'}</option>${suggestion ? '<option value="__new__">Créer une nouvelle fiche distincte</option>' : ''}${options}</select></div>
            ${r.projects.map((p,j) => `<label class="ci-project"><input type="checkbox" data-ci-project="${i}:${j}"${r.selectedProjects?.[j] === false ? '' : ' checked'} onchange="ClientImport.summary()"> ${esc(p)}</label>`).join('') || '<small>Aucun projet détecté</small>'}</div>`;
        }).join('')}
        <div class="ci-options"><label>Type commun (facultatif) <input type="text" id="ci-type" maxlength="100" placeholder="Ex. Design"></label><label><input type="checkbox" checked disabled> Projets privés</label></div>
        <div id="ci-summary" class="ci-summary"></div><div class="ci-actions"><button class="btn btn-accent" id="ci-continue" onclick="ClientImport.confirm()">Vérifier l’import</button></div>`;
      this.rows.forEach((r,i) => { const select = el.querySelector(`[data-ci-match="${i}"]`); if (select) select.value = String(r.matchId || ''); });
      this.summary();
    },
    rememberSelection() {
      this.rows.forEach((row, i) => {
        row.selected = !!document.querySelector(`[data-ci-client="${i}"]`)?.checked;
        row.selectedProjects = row.projects.map((_, j) => !!document.querySelector(`[data-ci-project="${i}:${j}"]`)?.checked);
        row.matchId = document.querySelector(`[data-ci-match="${i}"]`)?.value || '';
      });
    },
    selectAll(on) { document.querySelectorAll('#ci-preview input[type=checkbox]:not(:disabled)').forEach(c => { if (c.hasAttribute('data-ci-client') || c.hasAttribute('data-ci-project')) c.checked = on; }); this.summary(); },
    plan() {
      const existing = read('hub_clients'), workspaces = window.ClientWorkspace?.all?.() || [];
      const attach = document.getElementById('ci-attach')?.checked;
      const create = document.getElementById('ci-create')?.checked;
      const skipDuplicates = document.getElementById('ci-duplicates')?.checked;
      const type = document.getElementById('ci-type')?.value.trim() || '';
      const entries = [], seenClients = new Set(), seenProjects = new Set();
      let linked = 0, newClients = 0, skipped = 0, unresolved = 0;
      for (let i=0;i<this.rows.length;i++) {
        if (!document.querySelector(`[data-ci-client="${i}"]`)?.checked) continue;
        const row = this.rows[i];
        const chosen = document.querySelector(`[data-ci-match="${i}"]`)?.value || '';
        let client = chosen && chosen !== '__new__' ? existing.find(c => String(c.id) === chosen) : null;
        const exact = existing.find(c => norm(c.name) === norm(row.name));
        if (chosen && chosen !== '__new__' && !client) { unresolved++; continue; }
        if (!exact && !chosen && existing.some(c => similar(c.name, row.name))) { unresolved++; continue; }
        if (!client && exact && attach) client = exact;
        if (!client && exact) { skipped += row.projects.filter((_,j) => document.querySelector(`[data-ci-project="${i}:${j}"]`)?.checked).length; continue; }
        if (!client && !create) continue;
        const key = client ? 'id:' + client.id : 'name:' + norm(row.name);
        if (!seenClients.has(key)) { seenClients.add(key); client ? linked++ : newClients++; }
        for (let j=0;j<row.projects.length;j++) {
          if (!document.querySelector(`[data-ci-project="${i}:${j}"]`)?.checked) continue;
          const projectName = row.projects[j];
          const identity = key + '/' + norm(projectName);
          if (seenProjects.has(identity)) { skipped++; continue; }
          seenProjects.add(identity);
          const duplicate = workspaces.some(w => w.status !== 'trashed' && (client ? w.clientId === client.id || !w.clientId && norm(w.clientName) === norm(client.name) : norm(w.clientName) === norm(row.name)) && norm(w.projectName) === norm(projectName));
          if (duplicate && skipDuplicates) { skipped++; continue; }
          entries.push({ clientId:client?.id || '', clientName:client?.name || row.name, projectName, projectType:type, root:this.root });
        }
      }
      return { entries, linked, newClients, skipped, unresolved };
    },
    summary() {
      const el = document.getElementById('ci-summary'); if (!el) return;
      const p = this.plan();
      el.textContent = `${p.newClients} client(s) à créer · ${p.linked} à rattacher · ${p.entries.length} projet(s) à créer · ${p.skipped} doublon(s) ignoré(s)${p.unresolved ? ' · ' + p.unresolved + ' nom(s) proches à vérifier' : ''}. Aucun fichier transféré, aucun projet publié.`;
    },
    confirm() {
      const p = this.plan();
      if (p.unresolved) {
        this.status(`Vérifie ${p.unresolved} client(s) : rattacher à une fiche existante ou créer une fiche distincte.`);
        const existing = read('hub_clients');
        this.rows.forEach((row,i) => {
          if (!document.querySelector(`[data-ci-client="${i}"]`)?.checked) return;
          const select = document.querySelector(`[data-ci-match="${i}"]`);
          const missing = select?.value && select.value !== '__new__' && !existing.some(c => String(c.id) === select.value);
          if (select && (missing || !select.value && existing.some(c => similar(c.name, row.name)))) select.focus?.();
        });
        return;
      }
      if (!p.newClients && !p.entries.length) { this.status('Aucun nouveau client ou projet à importer avec cette sélection.'); return; }
      this.rememberSelection();
      const el = document.getElementById('ci-summary'); if (!el) return;
      el.innerHTML = `<b>Résumé de l’import</b><br>${p.newClients} client(s) à créer · ${p.linked} à rattacher · ${p.entries.length} projet(s) à créer · ${p.skipped} doublon(s) ignoré(s).<br>Aucun fichier transféré. Aucun contenu publié.`;
      document.getElementById('ci-continue').outerHTML = `<button class="btn btn-ghost" onclick="ClientImport.preview()">Retour</button> <button class="btn btn-accent" onclick="ClientImport.importNow()">Importer ${p.newClients} client(s) et ${p.entries.length} projet(s)</button>`;
    },
    async _token(entry) {
      const key = [entry.root, entry.clientName, entry.projectName].map(norm).join('\0');
      const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      return 'imp_' + [...new Uint8Array(data)].slice(0, 16).map(n => n.toString(16).padStart(2,'0')).join('');
    },
    async importNow() {
      if (this.running || !window.ClientWorkspace) return;
      this.running = true;
      try { if (window.CP?._migrationPromise) await CP._migrationPromise; }
      catch (error) { this.running = false; this.status('Attends la fin de la synchronisation des dossiers avant l’import.'); return; }
      const p = this.plan();
      if (p.unresolved) { this.running = false; this.status('Résous les noms de clients proches avant de lancer l’import.'); return; }
      if (!p.newClients && !p.entries.length) { this.running = false; this.status('Aucun nouveau client ou projet à importer.'); return; }
      const selectedRows = this.rows.map((row,i) => ({ row, selected:!!document.querySelector(`[data-ci-client="${i}"]`)?.checked,
        matchId:document.querySelector(`[data-ci-match="${i}"]`)?.value || '' }));
      const createMissing = !!document.getElementById('ci-create')?.checked;
      const skipDuplicates = !!document.getElementById('ci-duplicates')?.checked;
      const area = document.getElementById('ci-preview');
      area.innerHTML = `<div>Préparation de l’import…</div><progress class="ci-progress" id="ci-progress" value="0" max="${Math.max(1,p.entries.length)}"></progress><div id="ci-current">0 / ${p.entries.length}</div>`;
      const clients = read('hub_clients'), workspaces = ClientWorkspace.all();
      const beforeClients = JSON.stringify(clients), beforeWorkspaces = JSON.stringify(workspaces);
      const rawClients = localStorage.getItem('hub_clients'), rawWorkspaces = localStorage.getItem('hub_workspaces');
      const recoveryKey = 'hub_import_recovery_' + Date.now();
      const report = { createdClients:[], createdClientIds:[], linkedClients:[], createdProjects:[], skipped:p.skipped, errors:[], recoveryKey };
      let wroteClients = false;
      try {
        // Point de récupération local obligatoire avant le premier changement.
        localStorage.setItem(recoveryKey, JSON.stringify({ clients:beforeClients, workspaces:beforeWorkspaces }));
        const clientByName = new Map(clients.map(c => [norm(c.name), c]));
        let done = 0;
        for (const entry of p.entries) {
          let client = entry.clientId ? clients.find(c => String(c.id) === String(entry.clientId)) : clientByName.get(norm(entry.clientName));
          if (!client) {
            client = { id:crypto.randomUUID(), name:entry.clientName, type:'', status:'active', progress:0, revenue:0, createdAt:Date.now() };
            clients.push(client); clientByName.set(norm(client.name), client); report.createdClients.push(client.name); report.createdClientIds.push(client.id);
          } else if (!report.linkedClients.includes(client.name)) report.linkedClients.push(client.name);
          const token = await this._token(entry);
          const already = workspaces.find(w => w.token === token || skipDuplicates && w.status !== 'trashed' && (w.clientId === client.id || !w.clientId && norm(w.clientName) === norm(client.name)) && norm(w.projectName) === norm(entry.projectName));
          if (already) { report.skipped++; }
          else {
            const w = ClientWorkspace._ensureIn(workspaces, token, { clientId:client.id, clientName:client.name, projectName:entry.projectName, projectType:entry.projectType, stage:'request' });
            w.localOnly = true; w.origin = 'directory_import'; w.importRef = token; w.status = 'active';
            report.createdProjects.push({ name:entry.projectName, client:client.name, token });
          }
          done++;
          const progress = document.getElementById('ci-progress'), label = document.getElementById('ci-current');
          if (progress) progress.value = done;
          if (label) label.textContent = `${done} / ${p.entries.length} — ${entry.clientName}`;
          if (done % 10 === 0) await pause();
        }
        // Un client sans projet sélectionné reste importable comme fiche.
        for (const { row, selected, matchId } of selectedRows) {
          if (!selected || matchId && matchId !== '__new__' || clientByName.has(norm(row.name)) || !createMissing) continue;
          const client = { id:crypto.randomUUID(), name:row.name, type:'', status:'active', progress:0, revenue:0, createdAt:Date.now() };
          clients.push(client); clientByName.set(norm(client.name), client); report.createdClients.push(client.name); report.createdClientIds.push(client.id);
        }
        if (localStorage.getItem('hub_clients') !== rawClients || localStorage.getItem('hub_workspaces') !== rawWorkspaces)
          throw new Error('Les données ont changé sur un autre onglet pendant l’import. Aucun résultat n’a été écrit.');
        localStorage.setItem('hub_clients', JSON.stringify(clients)); wroteClients = true;
        ClientWorkspace.save(workspaces);
        this.report = report;
        window.CP?.invalidateSearch();
        if (window.CP) { CP._links = CP._mergeLinks(CP._links.filter(l => !l.localOnly)); CP.clearSearch(); CP._badge(); }
        if (typeof syncKPIs === 'function') syncKPIs();
        this.status('Import terminé. Les projets sont privés et accessibles dans Clients & Projets.');
        area.innerHTML = `<div class="ci-summary">${report.createdClients.length} client(s) créé(s) · ${report.linkedClients.length} rattaché(s) · ${report.createdProjects.length} projet(s) créé(s) · ${report.skipped} doublon(s) ignoré(s).<br>Point de récupération local : ${esc(recoveryKey)}.</div><div class="ci-actions"><button class="btn btn-ghost" onclick="ClientImport.view('clients')">Voir les clients</button><button class="btn btn-ghost" onclick="ClientImport.view('list')">Voir les projets</button><button class="btn btn-ghost" onclick="ClientImport.downloadReport()">Télécharger le rapport</button><button class="btn btn-ghost" onclick="ClientImport.rollback()">Annuler cet import</button><button class="btn btn-accent" onclick="ClientImport.close()">Fermer</button></div>`;
      } catch (error) {
        let restored = true;
        if (wroteClients) try { localStorage.setItem('hub_clients', beforeClients); ClientWorkspace.save(JSON.parse(beforeWorkspaces)); } catch (rollbackError) { restored = false; report.errors.push('Retour arrière local impossible : ' + rollbackError.message); }
        report.errors.push(error?.message || 'Erreur inconnue'); this.report = report;
        this.status('Import interrompu : ' + report.errors.join(' · '));
        area.innerHTML = `<p>${!wroteClients ? 'Aucune donnée existante n’a été modifiée.' : restored ? 'Les données antérieures ont été restaurées.' : 'Le point de récupération local est conservé ; aucune autre écriture ne sera tentée.'}</p><button class="btn btn-ghost" onclick="ClientImport.downloadReport()">Télécharger le rapport</button>`;
      } finally { this.running = false; }
    },
    view(v) { this.close(); if (window.CP) { CP.statusFilter = ''; CP.clearSearch(); CP.setView(v); } window.showPage?.('cp'); },
    rollback() {
      const report = this.report; if (!report?.createdProjects || this.running) return;
      if (!window.confirm('Retirer uniquement les clients et projets créés par cet import ? Les autres données resteront en place.')) return;
      const tokens = new Set(report.createdProjects.map(p => p.token));
      const workspaces = ClientWorkspace.all().filter(w => !tokens.has(w.token));
      const ids = new Set(report.createdClientIds || []);
      const clients = read('hub_clients').filter(c => !ids.has(c.id) || workspaces.some(w => w.clientId === c.id));
      try {
        ClientWorkspace.save(workspaces); localStorage.setItem('hub_clients', JSON.stringify(clients));
        report.rolledBack = true;
        window.CP?.invalidateSearch();
        if (window.CP) { CP._links = CP._mergeLinks(CP._links.filter(l => !l.localOnly)); CP._paint(); CP._badge(); }
        if (typeof syncKPIs === 'function') syncKPIs();
        this.status('Import annulé. Les autres données sont conservées.');
        const button = document.querySelector('#ci-preview button[onclick="ClientImport.rollback()"]'); if (button) button.disabled = true;
      } catch (error) { this.status('Annulation impossible : ' + error.message + '. Utilise le point de récupération local.'); }
    },
    downloadReport() {
      if (!this.report) return;
      const blob = new Blob([JSON.stringify(this.report,null,2)], { type:'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'souanpt-import-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
  window.ClientImport = ClientImport;
})();
