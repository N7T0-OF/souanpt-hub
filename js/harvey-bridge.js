/* ══════════════════════════════════════════════════════════════════════════
   HarveyBridge — passerelle FACULTATIVE avec Harvey
   (https://github.com/ethanplusai/harvey, licence MIT).

   Harvey est un agent de prospection en Python qui tourne sur l'ordinateur du
   créateur, avec SON abonnement Claude Code ou ChatGPT/Codex (aucune clé d'API).
   Un site public ne peut pas piloter un programme local de façon fiable (le
   navigateur bloque les appels d'une page web vers localhost), et souanpt.hub
   ne doit jamais envoyer d'e-mail à la place du créateur. La passerelle est
   donc faite de FICHIERS, dans les deux sens :

     hub → Harvey : harvey.local.yaml (offre, tarifs, cible, conformité),
                    généré depuis le site, le catalogue et le profil ;
     Harvey → hub : CSV `harvey export` → prospects qualifiés (ont répondu,
                    RDV obtenu, gagnés) rangés dans l'annuaire clients, prêts
                    à recevoir un lien de demande.

   Garde-fous : l'approbation manuelle des envois (`require_approval`) et la
   désactivation de LinkedIn sont imposées dans le fichier exporté ; tout le
   texte importé est borné et échappé à l'affichage.
   Les fonctions de données sont PURES : elles se testent sans navigateur.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  const STATUS_RANK = { new: 0, contacted: 1, replied: 2, meeting: 3, closed: 4, lost: 1 };
  const DEFAULT_IMPORT = ['replied', 'meeting', 'closed'];
  const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
  const list = v => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,\n]/)).map(x => clip(x, 80)).filter(Boolean).slice(0, 12);
  const isEmail = s => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s);
  const httpUrl = s => { try { const u = new URL(String(s)); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };

  /* ── YAML : seulement des chaînes entre guillemets doubles, échappées ── */
  function q(s) {
    return '"' + clip(s, 600).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
  }
  function qList(items, indent) {
    const pad = ' '.repeat(indent);
    return items.length ? '\n' + items.map(i => pad + '- ' + q(i)).join('\n') : ' []';
  }

  /**
   * Formulaire → harvey.local.yaml complet. Harvey prend ce fichier À LA PLACE
   * de harvey.yaml : toutes les sections du modèle sont donc présentes.
   */
  function buildConfig(f) {
    f = f || {};
    const sends = Math.min(50, Math.max(5, Math.round(Number(f.maxDailySends) || 20)));
    const goal = ['book_call', 'start_trial', 'get_reply'].includes(f.goal) ? f.goal : 'book_call';
    const booking = httpUrl(f.bookingUrl);
    return [
      '# harvey.local.yaml — généré par souanpt.hub le ' + new Date().toISOString().slice(0, 10),
      '# À placer à la racine du dossier Harvey. Relis chaque champ avant `harvey run`.',
      '# L\'approbation manuelle des envois est activée : rien ne part sans ta validation.',
      'persona:',
      '  name: ' + q(f.name),
      '  company: ' + q(f.company),
      '  role: ' + q(f.role || 'Créateur indépendant'),
      '  email: ' + q(f.email),
      '  linkedin: ' + q(f.linkedin),
      '  tone: ' + q(f.tone || 'chaleureux, précis, professionnel'),
      '',
      'product:',
      '  name: ' + q(f.offer),
      '  description: ' + q(f.description),
      '  pricing: ' + q(f.pricing),
      '  key_benefits:' + qList(list(f.benefits), 4),
      '  objection_responses:',
      '    "trop cher": ' + q('Je comprends. Je peux proposer une première étape plus courte pour vérifier que le résultat vous convient.'),
      '    "déjà quelqu\'un": ' + q('Très bien. Si un projet ponctuel ou un regard extérieur vous est utile, je reste disponible.'),
      '    "pas intéressé": ' + q('Merci pour votre réponse, je ne vous relancerai pas.'),
      '  offer:',
      '    primary: ' + q(f.pricing),
      '    entry: ' + q(f.entry),
      '    goal: ' + q(goal),
      '    booking_method: ' + q(booking ? 'calendar_link' : 'suggest_times'),
      '    booking_url: ' + q(booking),
      '    meeting_duration: ' + q(f.meetingDuration || '20 minutes'),
      '    meeting_owner: ' + q(f.name),
      '',
      'icp:',
      '  industries:' + qList(list(f.industries), 4),
      '  company_size: ' + q(f.companySize || '1-50 employees'),
      '  titles:' + qList(list(f.titles), 4),
      '  geography:' + qList(list(f.geography || 'France'), 4),
      '  hiring_signals: []',
      '',
      'channels:',
      '  email:',
      '    enabled: true',
      '    provider: ' + q(['gmail', 'microsoft', 'smtp'].includes(f.provider) ? f.provider : 'gmail'),
      '    max_daily_sends: ' + sends,
      '    require_approval: true',
      '    send_to_risky: false',
      '    max_bounce_rate: 0.05',
      '    warmup:',
      '      start_date: ""',
      '      min_days: 14',
      '      start_sends: 5',
      '      daily_increase: 3',
      '      dkim_selector: ""',
      '  linkedin:',
      '    enabled: false',
      '    max_daily_connections: 20',
      '    max_daily_messages: 10',
      '',
      'usage:',
      '  max_daily_claude_percent: 60',
      '  heartbeat_interval_minutes: 15',
      '  quiet_hours:',
      '    start: "20:00"',
      '    end: "08:00"',
      '    timezone: ' + q(f.timezone || 'Europe/Paris'),
      '',
      'compliance:',
      '  postal_address: ' + q(f.postalAddress),
      '  opt_out_line: ' + q(f.optOut || 'Pas intéressé ? Répondez « non merci » et je ne vous écrirai plus.'),
      '  precleared:',
      '    enabled: false',
      '    sender_country: ""',
      '    address_source: "unknown"',
      '    prospect_country: ""',
      '',
    ].join('\n');
  }

  /** Ce qui manque avant un usage sérieux (affiché, jamais bloquant). */
  function missing(f) {
    const out = [];
    if (!clip(f && f.offer, 10)) out.push('le nom de ton offre');
    if (!clip(f && f.email, 10) || !isEmail(clip(f.email, 200))) out.push('un e-mail d\'envoi valide');
    if (!clip(f && f.postalAddress, 10)) out.push('une adresse postale (exigée par Harvey pour les e-mails de prospection)');
    if (!list(f && f.industries).length) out.push('au moins un secteur ciblé');
    return out;
  }

  /** Préremplissage depuis les données du hub (rien n'est inventé). */
  function defaultsFromHub(ctx) {
    ctx = ctx || {};
    const cfg = ctx.cfg || {}, catalog = Array.isArray(ctx.catalog) ? ctx.catalog : [];
    const prices = catalog.map(c => Number(c.price) || 0).filter(n => n > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    return {
      name: clip(ctx.pseudo || '', 80),
      company: clip(cfg.siteName, 80),
      email: clip(cfg.email, 120),
      offer: clip(catalog[0] ? catalog.map(c => c.name).slice(0, 3).join(', ') : cfg.heroText, 200),
      description: clip(cfg.about || cfg.bio, 600),
      pricing: min ? 'À partir de ' + min.toLocaleString('fr-FR') + ' €' : '',
      benefits: catalog.slice(0, 5).map(c => clip(c.name, 80)).join('\n'),
      bookingUrl: httpUrl(ctx.siteUrl),
      geography: 'France',
      timezone: 'Europe/Paris',
    };
  }

  /* ── CSV (RFC 4180 : guillemets, guillemets doublés, retours à la ligne) ── */
  function parseCsv(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const firstLine = s.split(/\r?\n/, 1)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim().toLowerCase());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
  }

  /** CSV Harvey → prospects normalisés, filtrés par statut, dédoublonnés par e-mail. */
  function leadsFromCsv(text, opts) {
    const statuses = (opts && Array.isArray(opts.statuses) && opts.statuses.length) ? opts.statuses : DEFAULT_IMPORT;
    const rows = parseCsv(text);
    if (rows.length && !('email' in rows[0]) && !('company_name' in rows[0]))
      throw new Error('Ce fichier ne ressemble pas à un export Harvey (colonnes email / company_name absentes)');
    const seen = new Set(), out = [];
    for (const r of rows) {
      const status = clip(r.status, 20).toLowerCase() || 'new';
      if (!statuses.includes(status)) continue;
      const email = clip(r.email, 200).toLowerCase();
      const person = clip([r.first_name, r.last_name].filter(Boolean).join(' '), 80);
      const company = clip(r.company_name, 80);
      if (!company && !person) continue;
      const key = email || ('co:' + company.toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        email: isEmail(email) ? email : '',
        person, company,
        title: clip(r.title, 80),
        industry: clip(r.industry, 60),
        website: httpUrl(r.website),
        status,
        score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
        personalization: clip(r.personalization, 300),
      });
    }
    return out;
  }

  /**
   * Range les prospects dans l'annuaire `hub_clients` sans rien écraser :
   * une fiche existante (même e-mail) ne voit monter que son statut de prospect.
   * @returns {{ roster: object[], added: number, updated: number }}
   */
  function mergeLeads(roster, leads, now) {
    const out = Array.isArray(roster) ? roster.map(c => ({ ...c })) : [];
    let added = 0, updated = 0;
    const t = now || Date.now();
    leads.forEach((l, i) => {
      const hit = out.find(c => (l.email && String(c.email || '').toLowerCase() === l.email)
        || (!l.email && c.source === 'harvey' && String(c.company || '').toLowerCase() === l.company.toLowerCase()));
      if (hit) {
        if ((STATUS_RANK[l.status] ?? 0) > (STATUS_RANK[hit.leadStatus] ?? -1)) { hit.leadStatus = l.status; hit.updatedAt = t; updated++; }
        return;
      }
      out.push({
        id: 'hv' + t.toString(36) + i.toString(36),
        name: l.company || l.person,
        type: 'Prospect' + (l.industry ? ' · ' + l.industry : ''),
        company: l.company, email: l.email,
        title: [l.person, l.title].filter(Boolean).join(' — '),
        website: l.website,
        notes: l.personalization,
        source: 'harvey', leadStatus: l.status, score: l.score,
        status: 'lead', progress: 0, revenue: 0, createdAt: t,
      });
      added++;
    });
    return { roster: out, added, updated };
  }

  /* ── interface ──────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const FIELDS = [
    ['name', 'Ton nom', 'Prénom Nom'], ['company', 'Nom commercial', 'Studio…'],
    ['email', 'E-mail d\'envoi', 'contact@domaine-secondaire.fr'], ['offer', 'Ton offre', 'Identité visuelle, motion design…'],
    ['description', 'Ce que tu apportes', '', 'area'], ['pricing', 'Tarifs', 'À partir de 400 €'],
    ['benefits', 'Points forts (un par ligne)', '', 'area'], ['bookingUrl', 'Lien de prise de contact / RDV', 'https://…'],
    ['industries', 'Secteurs ciblés (virgules)', 'restaurants, boutiques, startups'], ['titles', 'Postes ciblés (virgules)', 'gérant, responsable marketing'],
    ['geography', 'Zone', 'France'], ['postalAddress', 'Adresse postale (obligatoire pour Harvey)', 'Rue, code postal, ville'],
  ];

  const HarveyBridge = {
    STATUS_RANK, DEFAULT_IMPORT,
    buildConfig, missing, defaultsFromHub, parseCsv, leadsFromCsv, mergeLeads,
    _tab: 'export', _form: null, _csv: '',

    open(tab) {
      if (tab) this._tab = tab;
      if (!this._form) {
        let cfg = {};
        // SiteConfig est un `const` global de core.js, pas une propriété de window.
        try { cfg = typeof SiteConfig !== 'undefined' ? SiteConfig.get() : {}; } catch {}
        this._form = Object.assign(defaultsFromHub({
          cfg, catalog: read('hub_catalog', []),
          pseudo: (() => { try { return localStorage.getItem('souanpt_pseudo') || ''; } catch { return ''; } })(),
          siteUrl: cfg.lastDeploy && cfg.lastDeploy.url,
        }), Object.fromEntries(Object.entries(read('hub_harvey_form', {}) || {})
          // Un champ laissé vide dans le brouillon ne masque pas le préremplissage.
          .filter(([, v]) => typeof v === 'string' && v.trim())));
      }
      let m = document.getElementById('hv-modal');
      if (!m) {
        m = document.createElement('div'); m.id = 'hv-modal'; m.className = 'hv-modal';
        m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Passerelle Harvey');
        m.onclick = e => { if (e.target === m) this.close(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('hv-modal')) this.close(); });
      }
      m.innerHTML = this._html();
      this._bind(m);
    },
    close() { document.getElementById('hv-modal')?.remove(); },

    _html() {
      const f = this._form, miss = missing(f);
      const tabs = `<div class="ed-modes hv-tabs"><button data-tab="export"${this._tab === 'export' ? ' class="active"' : ''}>1 · Configurer Harvey</button><button data-tab="import"${this._tab === 'import' ? ' class="active"' : ''}>2 · Importer les prospects</button></div>`;
      const intro = `<p class="hv-p"><b>Facultatif.</b> <a href="https://github.com/ethanplusai/harvey" target="_blank" rel="noopener noreferrer">Harvey</a> est un agent de prospection open source (MIT) qui tourne <b>sur ton ordinateur</b> avec ton abonnement Claude ou ChatGPT, sans clé d'API. souanpt.hub ne l'exécute pas et n'envoie aucun e-mail : il lui prépare ta configuration et récupère les contacts intéressés.</p>`;
      const body = this._tab === 'export' ? `
        <div class="hv-grid">${FIELDS.map(([k, l, ph, type]) => `<label class="hv-f${type === 'area' ? ' hv-wide' : ''}"><span>${esc(l)}</span>${type === 'area'
          ? `<textarea class="prop-input" data-k="${k}" rows="3" placeholder="${esc(ph)}">${esc(f[k] || '')}</textarea>`
          : `<input class="prop-input" data-k="${k}" value="${esc(f[k] || '')}" placeholder="${esc(ph)}">`}</label>`).join('')}</div>
        <div id="hv-miss">${this._missHtml(miss)}</div>
        <p class="hv-p hv-small">Imposé dans le fichier : <b>approbation de chaque envoi</b>, LinkedIn désactivé, 20 envois/jour max, heures calmes 20 h – 8 h. En France, la prospection par e-mail vers des professionnels est admise si le message concerne leur activité et permet de refuser les suivants ; vers des particuliers, il faut leur accord préalable (CNIL).</p>
        <div class="hv-act"><button class="btn btn-accent" data-do="download">⬇ Télécharger harvey.local.yaml</button><button class="btn btn-ghost" data-do="copy">📋 Copier</button></div>
        <ol class="hv-steps"><li>Place le fichier à la racine du dossier Harvey.</li><li><code>harvey signals --confirm free</code> puis <code>harvey discover</code></li><li><code>harvey dashboard</code> pour valider les e-mails, puis <code>harvey run</code></li></ol>`
      : `
        <ol class="hv-steps"><li>Dans le dossier Harvey : <code>harvey export --status replied,meeting,closed --out prospects.csv</code></li><li>Choisis ce fichier ci-dessous.</li></ol>
        <label class="hv-file"><input type="file" accept=".csv,text/csv" data-do="file"> <span>${this._csv ? '✓ Fichier chargé' : 'Choisir prospects.csv'}</span></label>
        <div class="hv-sts">${[['replied', 'Ont répondu'], ['meeting', 'RDV obtenu'], ['closed', 'Gagnés'], ['contacted', 'Contactés'], ['new', 'Nouveaux']].map(([v, l]) =>
          `<label class="edw-tog"><input type="checkbox" data-st="${v}"${DEFAULT_IMPORT.includes(v) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
        <div id="hv-prev" class="hv-p"></div>
        <div class="hv-act"><button class="btn btn-accent" data-do="import" disabled>Importer dans l'annuaire</button></div>
        <p class="hv-p hv-small">Les prospects rejoignent l'annuaire de Clients & Projets (stockage local et ta sauvegarde privée) avec un badge 🤖. Une fiche existante n'est jamais écrasée. Depuis la fiche : <b>📥 Lien de demande</b> ouvre un vrai dossier client.</p>`;
      return `<div class="hv-box"><div class="hv-head"><b>🤖 Harvey — prospection</b><button class="hv-x" data-do="close" aria-label="Fermer">✕</button></div>${tabs}${intro}${body}</div>`;
    },

    _missHtml(miss) {
      return miss.length ? `<p class="hv-warn">À compléter : ${miss.map(esc).join(' · ')}</p>` : '<p class="hv-ok">✓ Configuration complète</p>';
    },
    _statuses(m) { return [...m.querySelectorAll('[data-st]:checked')].map(i => i.dataset.st); },
    _preview(m) {
      const box = m.querySelector('#hv-prev'), btn = m.querySelector('[data-do="import"]');
      if (!box || !this._csv) return;
      try {
        const leads = leadsFromCsv(this._csv, { statuses: this._statuses(m) });
        this._leads = leads;
        box.innerHTML = leads.length
          ? `<b>${leads.length} prospect${leads.length > 1 ? 's' : ''}</b> à importer :<ul class="hv-list">${leads.slice(0, 8).map(l =>
              `<li>${esc(l.company || l.person)}${l.person && l.company ? ' — ' + esc(l.person) : ''} <small>${esc(l.status)}</small></li>`).join('')}${leads.length > 8 ? `<li>… et ${leads.length - 8} autres</li>` : ''}</ul>`
          : 'Aucun prospect avec ces statuts dans ce fichier.';
        btn.disabled = !leads.length;
      } catch (e) { box.textContent = '✗ ' + e.message; btn.disabled = true; this._leads = []; }
    },

    _bind(m) {
      m.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this._tab = b.dataset.tab; this.open(); });
      // Saisie : on met à jour le brouillon et l'avertissement, sans repeindre
      // le formulaire (le champ garde le focus).
      m.querySelectorAll('[data-k]').forEach(i => i.oninput = () => {
        this._form[i.dataset.k] = i.value;
        try { localStorage.setItem('hub_harvey_form', JSON.stringify(this._form)); } catch {}
        const box = m.querySelector('#hv-miss'); if (box) box.innerHTML = this._missHtml(missing(this._form));
      });
      m.querySelectorAll('[data-st]').forEach(i => i.onchange = () => this._preview(m));
      m.querySelectorAll('[data-do]').forEach(el => {
        const d = el.dataset.do;
        if (d === 'file') el.onchange = e => {
          const file = e.target.files[0]; if (!file) return;
          if (file.size > 5 * 1048576) return root.showToast?.('Fichier trop lourd (5 Mo max)', '#c0392b', 2500);
          const rd = new FileReader();
          rd.onload = ev => { this._csv = String(ev.target.result || ''); el.nextElementSibling.textContent = '✓ ' + file.name; this._preview(m); };
          rd.readAsText(file);
        };
        else el.onclick = () => this['_' + d] && this['_' + d](m);
      });
      this._preview(m);
    },
    _close() { this.close(); },
    _download() {
      const blob = new Blob([buildConfig(this._form)], { type: 'text/yaml;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'harvey.local.yaml'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      root.showToast?.('harvey.local.yaml téléchargé ✓', '#2e9a63', 2500);
    },
    _copy() {
      navigator.clipboard?.writeText(buildConfig(this._form))
        .then(() => root.showToast?.('Configuration copiée ✓', '#2e9a63', 2000))
        .catch(() => root.showToast?.('Copie impossible — utilise le téléchargement', '#e4b24a', 2500));
    },
    _import() {
      const leads = this._leads || [];
      if (!leads.length) return;
      const res = mergeLeads(read('hub_clients', []), leads);
      try { localStorage.setItem('hub_clients', JSON.stringify(res.roster)); }
      catch { return root.showToast?.('Stockage local plein — import annulé', '#c0392b', 3500); }
      this.close();
      root.showToast?.(`🤖 ${res.added} prospect${res.added > 1 ? 's' : ''} ajouté${res.added > 1 ? 's' : ''}${res.updated ? ' · ' + res.updated + ' mis à jour' : ''}`, '#2e9a63', 3500);
      if (root.CP) { CP.setView('clients'); root.showPage?.('cp'); }
      root.renderClients?.();
    },
  };

  root.HarveyBridge = HarveyBridge;
})(typeof window !== 'undefined' ? window : globalThis);
