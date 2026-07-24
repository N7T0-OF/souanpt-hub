/* ══════════════════════════════════════════════════════════════════════════
   QuoteFlow — grille tarifaire privée, analyse d'une demande, estimation.

   PRINCIPE DE CONFIDENTIALITÉ. La grille tarifaire (temps interne, coût,
   prix plancher, marge, remises autorisées) ne quitte JAMAIS le navigateur
   du créateur. L'analyse et le calcul se font ici, en local. Seul le
   RÉSULTAT — les lignes et le prix proposé — pourra être publié plus tard.
   Rien de ce module ne doit finir dans une page vue par un client.

   PRINCIPE D'ANALYSE. Tout est déterministe : dictionnaire, synonymes,
   expressions régulières. Aucune IA, aucun service payant, aucun appel
   réseau — donc gratuit à vie et fonctionnel hors ligne. En contrepartie
   l'analyse peut se tromper : elle affiche donc un niveau de CONFIANCE,
   liste ce qui MANQUE, et n'invente jamais une valeur absente.
══════════════════════════════════════════════════════════════════════════ */

/* ── Catalogue des prestations ─────────────────────────────────────────────
   `syn` : formes réellement écrites par les clients, argot compris (« pp »,
   « thumbnail », « bannière »). Les accents sont retirés avant comparaison,
   donc « bannière » et « banniere » se valent.                              */
const QUOTE_SERVICES = {
  miniature_youtube: {
    label: 'Miniature YouTube', unit: 'miniature', price: 15, minutes: 90,
    syn: ['miniature', 'miniatures', 'thumbnail', 'thumbnails', 'thumb', 'vignette', 'vignettes', 'cover video'],
  },
  banniere: {
    label: 'Bannière', unit: 'bannière', price: 30, minutes: 120,
    syn: ['banniere', 'bannieres', 'banner', 'banniere youtube', 'art de chaine', 'header', 'cover'],
  },
  photo_profil: {
    label: 'Photo de profil', unit: 'visuel', price: 20, minutes: 60,
    syn: ['pp', 'photo de profil', 'avatar', 'icone', 'pfp', 'profile picture', 'profil discord'],
  },
  logo: {
    label: 'Logo', unit: 'logo', price: 60, minutes: 240,
    syn: ['logo', 'logotype', 'logos'],
  },
  identite_visuelle: {
    label: 'Identité visuelle', unit: 'identité', price: 180, minutes: 720,
    syn: ['identite visuelle', 'charte graphique', 'branding', 'identite graphique'],
  },
  affiche: {
    label: 'Affiche', unit: 'affiche', price: 35, minutes: 150,
    syn: ['affiche', 'affiches', 'poster', 'flyer', 'flyers'],
  },
  montage_video: {
    label: 'Montage vidéo', unit: 'vidéo', price: 80, minutes: 300,
    syn: ['montage', 'montage video', 'edit video', 'editing', 'monter une video'],
  },
  overlay: {
    label: 'Overlay / habillage stream', unit: 'overlay', price: 45, minutes: 180,
    syn: ['overlay', 'habillage', 'alerte twitch', 'panneau twitch', 'panneaux'],
  },
  site_web: {
    label: 'Site web', unit: 'site', price: 350, minutes: 1200,
    syn: ['site web', 'site internet', 'landing page', 'page web', 'portfolio web'],
  },
  minecraft: {
    label: 'Création Minecraft', unit: 'pack', price: 70, minutes: 300,
    syn: ['texture pack', 'resource pack', 'modpack', 'skin minecraft', 'pack minecraft'],
  },
  modelisation_3d: {
    label: 'Création 3D', unit: 'modèle', price: 120, minutes: 480,
    syn: ['3d', 'modelisation', 'blender', 'render 3d', 'modele 3d'],
  },
};

/* ── Options facturables, détectées dans le texte ── */
const QUOTE_OPTIONS = {
  sources:    { label: 'Fichiers sources', price: 10, syn: ['psd', 'fichier source', 'fichiers sources', 'sources', 'fichier ai', 'projet source', 'source file'] },
  commercial: { label: 'Usage commercial', price: 25, syn: ['usage commercial', 'commercial', 'revente', 'exploitation commerciale'] },
  animation:  { label: 'Version animée',   price: 40, syn: ['anime', 'animation', 'animee', 'motion', 'gif anime'] },
};

const QUOTE_KEY = 'hub_pricing';

/* Réglages tarifaires modifiables par le créateur. Les champs marqués PRIVÉ
   ne doivent jamais apparaître dans un document envoyé au client. */
const QUOTE_DEFAULTS = {
  services: {},              // surcharges par prestation : { price, minutes, min }
  options:  {},              // surcharges d'options : { price }
  urgencyPct: 25,            // supplément si délai < 48 h
  packDiscountPct: 10,       // remise à partir de 4 unités d'une même prestation
  revisionsIncluded: 2,
  extraRevision: 3,
  /* PRIVÉ — taux horaire visé, pour l'alerte de rentabilité. 0 = NON RÉGLÉ :
     on ne prévient pas tant que le créateur n'a pas dit ce qu'il vise. Avec
     une valeur arbitraire, l'alerte se déclencherait sur presque tout (les
     tarifs par défaut donnent ~10 €/h) et deviendrait du bruit ignoré. */
  hourlyRate: 0,
  floorPct: 65,              // PRIVÉ — prix plancher = % du prix conseillé
  currency: '€',
};

const Pricing = {
  get() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(QUOTE_KEY) || '{}'); } catch (e) {}
    return { ...QUOTE_DEFAULTS, ...saved };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    localStorage.setItem(QUOTE_KEY, JSON.stringify(next));
    return next;
  },
  /** Prix unitaire effectif d'une prestation (surcharge éventuelle du créateur). */
  price(id) {
    const c = this.get();
    const o = (c.services || {})[id] || {};
    return Number(o.price ?? QUOTE_SERVICES[id]?.price ?? 0);
  },
  minutes(id) {
    const c = this.get();
    const o = (c.services || {})[id] || {};
    return Number(o.minutes ?? QUOTE_SERVICES[id]?.minutes ?? 0);
  },
  optPrice(id) {
    const c = this.get();
    const o = (c.options || {})[id] || {};
    return Number(o.price ?? QUOTE_OPTIONS[id]?.price ?? 0);
  },
};

/* ══ Analyse du texte ═══════════════════════════════════════════════════ */

const QuoteEngine = {
  /** Minuscules sans accents : « Bannière » et « banniere » deviennent égaux. */
  norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, "'").replace(/\s+/g, ' ');
  },

  NUMBERS: { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20 },

  /** Quantité écrite juste avant/après un terme : « 2 miniatures », « x3 ». */
  quantityNear(text, term) {
    const i = text.indexOf(term);
    if (i < 0) return null;
    const before = text.slice(Math.max(0, i - 22), i);
    // Fenêtre après le terme volontairement courte : « il m'en faut 5 » doit
    // être capté, mais pas un nombre appartenant à la phrase suivante.
    const after  = text.slice(i + term.length, i + term.length + 26);
    let m = before.match(/(\d{1,3})\s*(?:x\s*)?$/) || after.match(/^\s*(?:x\s*)?(\d{1,3})\b/)
      // Tournures fréquentes où la quantité suit à distance : « des thumbnails,
      // il m'en faut 5 ». On n'accepte QUE ces formulations explicites, pour ne
      // pas ramasser un nombre appartenant à une autre idée.
      || after.match(/\b(?:en\s+faut|en\s+veux|en\s+voudrais|besoin\s+de)\s*(?:x\s*)?(\d{1,3})\b/);
    if (m) { const n = parseInt(m[1], 10); if (n > 0 && n <= 200) return n; }
    const w = before.match(/\b([a-z]+)\s*$/);
    if (w && this.NUMBERS[w[1]] !== undefined) return this.NUMBERS[w[1]];
    return null;
  },

  /** Délai évoqué + urgence. On ne devine PAS une date exacte : trop risqué. */
  deadline(text) {
    const urgent = /\b(urgent|urgente|asap|au plus vite|tres vite|des que possible|rapidement)\b/.test(text);
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    let mention = null;
    if (/\bdemain\b/.test(text)) { mention = 'demain'; }
    else if (/\bapres-demain\b/.test(text)) { mention = 'après-demain'; }
    else {
      const j = jours.find(d => new RegExp('\\b' + d + '\\b').test(text));
      if (j) mention = j;
      const dans = text.match(/\bdans\s+(\d{1,2})\s*(jour|jours|semaine|semaines)\b/);
      if (dans) mention = 'dans ' + dans[1] + ' ' + dans[2];
      const date = text.match(/\b(?:avant|pour|d'ici)\s+le\s+(\d{1,2}(?:er)?\s+[a-z]+)/);
      if (date) mention = 'le ' + date[1];
    }
    // « demain » / « après-demain » / « urgent » → moins de 48 h.
    const rush = urgent || mention === 'demain' || mention === 'après-demain'
      || /\bdans\s+1\s*jour\b/.test(text);
    return { mention, urgent: !!rush };
  },

  /** Budget évoqué par le client (sert de repère, jamais de prix imposé). */
  budget(text) {
    const m = text.match(/(?:budget|max|maximum|environ|autour de|pas plus de)[^\d]{0,14}(\d{1,5})\s*(?:e|eur|euros|€)?/)
           || text.match(/(\d{1,5})\s*(?:e|eur|euros|€)\b/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n > 0 && n < 100000 ? n : null;
  },

  /**
   * Analyse un message client brut.
   * Ne renvoie QUE ce qui est réellement trouvé — jamais de valeur inventée.
   */
  analyze(raw) {
    const text = this.norm(raw);
    const services = [];

    for (const id in QUOTE_SERVICES) {
      const def = QUOTE_SERVICES[id];
      // Le synonyme le plus long d'abord : « banniere youtube » avant « banniere ».
      const hit = [...def.syn].sort((a, b) => b.length - a.length)
        .find(s => new RegExp('(^|[^a-z])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text));
      if (!hit) continue;
      services.push({ id, label: def.label, qty: this.quantityNear(text, hit) || 1, matched: hit,
                      qtyFound: this.quantityNear(text, hit) !== null });
    }

    const options = [];
    for (const id in QUOTE_OPTIONS) {
      const hit = QUOTE_OPTIONS[id].syn.find(s => text.includes(s));
      if (hit) options.push({ id, label: QUOTE_OPTIONS[id].label, matched: hit });
    }

    const dl = this.deadline(text);
    const bud = this.budget(text);

    // Ce qui manque pour chiffrer sérieusement — dit explicitement au créateur.
    const missing = [];
    if (!services.length) missing.push('la prestation demandée');
    services.filter(s => !s.qtyFound).forEach(s => missing.push('la quantité pour « ' + s.label + ' »'));
    if (!dl.mention) missing.push('la date limite');
    if (!options.some(o => o.id === 'sources')) missing.push('le besoin de fichiers sources');
    if (!/\b(retour|retours|modification|modifications|revision|revisions)\b/.test(text))
      missing.push('le nombre de retours souhaités');

    // Confiance : ce qu'on a trouvé, pondéré par ce qui reste flou.
    let score = 0;
    if (services.length) score += 55;
    if (services.length && services.every(s => s.qtyFound)) score += 15;
    if (dl.mention) score += 12;
    if (options.length) score += 8;
    if (bud) score += 10;
    score = Math.max(0, Math.min(100, score - missing.length * 4));

    return {
      services, options, deadline: dl, budget: bud, missing,
      confidence: services.length ? score : 0,
      raw: String(raw || ''),
    };
  },

  /**
   * Transforme une analyse en estimation chiffrée.
   * Renvoie AUSSI les indicateurs privés (temps, plancher) : ils servent au
   * créateur pour décider, et ne doivent pas être transmis au client.
   */
  estimate(analysis, overrides) {
    const cfg = Pricing.get();
    const ov = overrides || {};
    const lines = [];
    let minutes = 0;

    (analysis.services || []).forEach(s => {
      const qty = Number(ov['qty_' + s.id] ?? s.qty) || 1;
      const unit = Number(ov['price_' + s.id] ?? Pricing.price(s.id));
      lines.push({ key: s.id, label: s.label, qty, unit, total: qty * unit, kind: 'service' });
      minutes += qty * Pricing.minutes(s.id);
    });

    (analysis.options || []).forEach(o => {
      if (ov['opt_' + o.id] === false) return;
      const p = Pricing.optPrice(o.id);
      if (!p) return;
      lines.push({ key: o.id, label: o.label, qty: 1, unit: p, total: p, kind: 'option' });
    });

    let subtotal = lines.reduce((n, l) => n + l.total, 0);
    const extras = [];

    // Remise « lot » : à partir de 4 unités d'une même prestation.
    const bulk = lines.filter(l => l.kind === 'service' && l.qty >= 4);
    if (bulk.length && cfg.packDiscountPct > 0) {
      const base = bulk.reduce((n, l) => n + l.total, 0);
      const d = Math.round(base * cfg.packDiscountPct) / 100;
      if (d) extras.push({ label: `Remise lot (−${cfg.packDiscountPct} %)`, amount: -d });
    }
    // Supplément urgence, uniquement si un délai court a été détecté.
    const rush = ov.urgent ?? (analysis.deadline && analysis.deadline.urgent);
    if (rush && cfg.urgencyPct > 0) {
      const d = Math.round(subtotal * cfg.urgencyPct) / 100;
      if (d) extras.push({ label: `Urgence (+${cfg.urgencyPct} %)`, amount: d });
    }

    const total = Math.max(0, Math.round((subtotal + extras.reduce((n, e) => n + e.amount, 0)) * 100) / 100);

    // Fourchette tant que des informations manquent : annoncer un prix ferme
    // sur un brief incomplet, c'est s'engager sur ce qu'on n'a pas compris.
    // Pas de fourchette « 0 – 0 » quand rien n'a été reconnu : ce serait une
    // estimation là où il n'y a aucune demande identifiée.
    const incomplete = (analysis.missing || []).length > 0;
    const range = (incomplete && total > 0)
      ? { low: Math.round(total * 0.9), high: Math.round(total * 1.2) }
      : null;

    return {
      lines, extras, subtotal: Math.round(subtotal * 100) / 100, total, range,
      currency: cfg.currency,
      // ── PRIVÉ : ne jamais transmettre au client ──
      privateInfo: {
        minutes,
        hours: Math.round(minutes / 6) / 10,
        hourlyValue: minutes ? Math.round((total / (minutes / 60)) * 10) / 10 : null,
        hourlyRate: cfg.hourlyRate,
        floor: Math.round(total * cfg.floorPct) / 100,
        // Alerte seulement si un taux visé a été renseigné (0 = non réglé).
        belowRate: !!(cfg.hourlyRate > 0 && minutes && (total / (minutes / 60)) < cfg.hourlyRate),
      },
    };
  },

  /* ── Messages prêts à copier ─────────────────────────────────────────── */

  /** Questionnaire initial, adapté si une prestation est déjà connue. */
  questions(serviceId) {
    const s = serviceId && QUOTE_SERVICES[serviceId];
    const head = s
      ? `Salut ! Pour te donner une estimation juste sur ${s.label.toLowerCase()}, j'aurais besoin de quelques précisions :`
      : `Salut ! Pour pouvoir te donner une estimation correcte, j'aurais besoin de quelques informations :`;
    const q = [
      s ? `Combien de ${s.unit}(s) te faut-il ?` : `Quel type de création souhaites-tu ?`,
      `Sur quelle plateforme sera-t-elle utilisée ?`,
      `As-tu déjà une identité visuelle, un logo ou des références ?`,
      `Quel style recherches-tu ?`,
      `Quelle est ta date limite ?`,
      `As-tu besoin des fichiers sources ?`,
      `Combien de retours penses-tu prévoir ?`,
      `As-tu un budget approximatif ?`,
    ];
    return head + '\n\n' + q.map((t, i) => `${i + 1}. ${t}`).join('\n')
      + `\n\nTu peux répondre directement sous chaque question.`;
  },

  /** Relance ciblée : ne redemande QUE ce qui manque réellement. */
  followUp(analysis) {
    const m = analysis.missing || [];
    if (!m.length) return 'Merci, j\'ai tout ce qu\'il me faut — je reviens vers toi avec une estimation.';
    return `Merci pour les informations. Il me manque simplement ${m.length === 1 ? 'un élément' : 'quelques éléments'} pour te donner un tarif précis :\n\n`
      + m.map(x => '- ' + x.charAt(0).toUpperCase() + x.slice(1) + ' ?').join('\n')
      + `\n\nDès que j'ai ça, je t'envoie l'estimation.`;
  },

  /** Récapitulatif à envoyer au client — SANS aucune donnée privée. */
  summary(analysis, est, opts) {
    const o = opts || {};
    const cur = est.currency;
    const l = est.lines.map(x => `- ${x.label}${x.qty > 1 ? ' × ' + x.qty : ''} : ${x.total} ${cur}`);
    const e = est.extras.map(x => `- ${x.label} : ${x.amount > 0 ? '+' : ''}${x.amount} ${cur}`);
    const prix = est.range && !o.final
      ? `Estimation : entre ${est.range.low} et ${est.range.high} ${cur} (non contractuelle)`
      : `Prix proposé : ${est.total} ${cur}`;
    return `Voici le détail de ton projet :\n\n${l.join('\n')}${e.length ? '\n' + e.join('\n') : ''}\n\n${prix}`
      + (analysis.deadline && analysis.deadline.mention ? `\nDélai évoqué : ${analysis.deadline.mention}` : '')
      + `\n\nDis-moi si ça te convient ou si tu veux ajuster quelque chose.`;
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   QuoteUI — page « Demandes & Devis ».
   Tout est local : rien n'est envoyé, le créateur copie les messages
   lui-même vers l'outil de son choix (Discord, Instagram, WhatsApp…).
══════════════════════════════════════════════════════════════════════════ */
const QuoteUI = {
  _a: null, _e: null,
  _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  _el(id) { return document.getElementById(id); },

  init() {
    this.renderPricing();
    this._renderChips();
    const m = this._el('qf-mode'); if (m) m.value = SiteConfig.get().acceptanceMode || 'manual';
    this.loadAcceptances();   // repère les acceptations entrantes à confirmer
  },
  setMode(v) {
    SiteConfig.set('acceptanceMode', v === 'automatic' ? 'automatic' : 'manual');
    showToast?.(v === 'automatic'
      ? 'Lancement automatique activé — les acceptations créent la mission sans confirmation.'
      : 'Validation manuelle : tu confirmes chaque acceptation.', '#666', 3500);
    if (v === 'automatic') this.loadAcceptances();
  },

  /* ── Grille tarifaire ── */
  togglePricing() {
    const b = this._el('qf-pricing'); if (!b) return;
    b.style.display = b.style.display === 'none' ? 'block' : 'none';
    if (b.style.display === 'block') this.renderPricing();
  },
  renderPricing() {
    const list = this._el('qf-pricing-list'); if (!list) return;
    const c = Pricing.get();
    list.innerHTML = Object.keys(QUOTE_SERVICES).map(id => {
      const d = QUOTE_SERVICES[id];
      return `<div class="qf-row">
        <span class="qf-l">${this._esc(d.label)} <span style="color:var(--muted2)">/ ${this._esc(d.unit)}</span></span>
        <input class="prop-input qf-q" type="number" min="0" step="1" data-price="${id}" value="${Pricing.price(id)}" title="Prix unitaire">
        <input class="prop-input qf-q" type="number" min="0" step="5" data-min="${id}" value="${Pricing.minutes(id)}" title="Temps estimé en minutes (privé)">
      </div>`;
    }).join('') + Object.keys(QUOTE_OPTIONS).map(id =>
      `<div class="qf-row">
        <span class="qf-l">➕ ${this._esc(QUOTE_OPTIONS[id].label)}</span>
        <input class="prop-input qf-q" type="number" min="0" step="1" data-opt="${id}" value="${Pricing.optPrice(id)}" title="Supplément">
      </div>`).join('');
    const set = (i, v) => { const e = this._el(i); if (e) e.value = v; };
    set('qf-urg', c.urgencyPct); set('qf-pack', c.packDiscountPct); set('qf-rate', c.hourlyRate);
  },
  savePricing() {
    const services = {}, options = {};
    document.querySelectorAll('[data-price]').forEach(i => {
      services[i.dataset.price] = { ...(services[i.dataset.price] || {}), price: Number(i.value) || 0 };
    });
    document.querySelectorAll('[data-min]').forEach(i => {
      services[i.dataset.min] = { ...(services[i.dataset.min] || {}), minutes: Number(i.value) || 0 };
    });
    document.querySelectorAll('[data-opt]').forEach(i => { options[i.dataset.opt] = { price: Number(i.value) || 0 }; });
    Pricing.set({
      services, options,
      urgencyPct: Number(this._el('qf-urg').value) || 0,
      packDiscountPct: Number(this._el('qf-pack').value) || 0,
      hourlyRate: Number(this._el('qf-rate').value) || 0,
    });
    showToast?.('Grille tarifaire enregistrée ✓', '#2e9a63', 2000);
    if (this._a) this.recompute();
  },

  /* ── Analyse ── */
  clear() {
    const i = this._el('qf-input'); if (i) i.value = '';
    this._a = this._e = null;
    this._attachments = [];
    this._renderChips();
    this._el('qf-result').style.display = 'none';
    this._el('qf-empty').style.display = 'block';
    this._el('qf-msg').textContent = '';
  },

  /* ── Références jointes (fichiers PUBLICS du Stockage) ─────────────────── */
  _attachments: [],
  _renderChips() {
    const box = this._el('qf-chips'); if (!box) return;
    const n = (this._attachments || []).length;
    box.innerHTML = n ? this._attachments.map((a, i) =>
      `<span class="qf-chip">📎 ${this._esc(a.name)}<button onclick="QuoteUI.unattach(${i})" title="Retirer">✕</button></span>`).join('')
      : '<span class="edw-hint">Aucune référence jointe. Elles suivront la mission automatiquement.</span>';
  },
  unattach(i) { this._attachments.splice(i, 1); this._renderChips(); },
  attachDialog() {
    if (typeof HubFiles === 'undefined') return showToast?.('Stockage indisponible', '#e4b24a', 3000);
    // Seuls les fichiers PUBLICS sont proposés : le client (sans compte) ne
    // pourra voir sur sa mission que ce qui a une URL publique.
    const files = HubFiles.list().filter(f => f.status !== 'trash' && f.visibility === 'public');
    const already = new Set((this._attachments || []).map(a => a.id));
    const body = files.length
      ? `<div class="edw-hint" style="margin-bottom:8px">Seuls tes fichiers <b>publics</b> apparaissent : le client les verra sur sa mission sans avoir à les renvoyer.</div>
         <div style="max-height:46vh;overflow:auto">${files.map(f =>
           `<label class="edw-tog" style="padding:6px 0"><input type="checkbox" data-fid="${this._esc(f.id)}"${already.has(f.id) ? ' checked' : ''}>
             📎 ${this._esc(f.displayName || f.name)} <span class="edw-hint">${this._size(f.size)}</span></label>`).join('')}</div>`
      : `<div class="edw-hint">Aucun fichier public dans ton Stockage. Rends une référence publique dans <b>Stockage</b>, puis reviens la joindre.</div>`;
    QDialog.open({
      title: '📎 Joindre des références', body, confirm: 'Joindre',
      onConfirm: (dlg) => {
        const picked = [...dlg.querySelectorAll('[data-fid]:checked')].map(c => c.dataset.fid);
        const list = HubFiles.list();
        this._attachments = picked.map(id => {
          const f = list.find(x => x.id === id); if (!f) return null;
          return {
            id: f.id, name: f.displayName || f.name, type: f.mime || '', size: f.size || 0,
            url: HubFiles.publicUrl(f), storagePath: f.path, hash: f.sha || '',
            category: 'client_reference', visibility: 'client_visible',
            uploadedBy: 'creator', createdAt: Date.now(),
          };
        }).filter(Boolean);
        this._renderChips();
        QDialog.close();
        return true;
      },
    });
  },
  _size(b) { b = Number(b) || 0; if (b < 1024) return b + ' o'; if (b < 1048576) return (b / 1024).toFixed(0) + ' Ko'; return (b / 1048576).toFixed(1) + ' Mo'; },
  analyze() {
    const txt = (this._el('qf-input')?.value || '').trim();
    if (!txt) return showToast?.('Colle d\'abord le message du client', '#e4b24a', 2500);
    this._a = QuoteEngine.analyze(txt);
    this.recompute();
    this._el('qf-empty').style.display = 'none';
    this._el('qf-result').style.display = 'block';
    if (!this._a.services.length) {
      showToast?.('Aucune prestation reconnue — corrige à la main ou précise la demande', '#e4b24a', 4000);
    }
  },
  /** Recalcule à partir des corrections faites par le créateur. */
  recompute() {
    if (!this._a) return;
    const ov = {};
    document.querySelectorAll('[data-qty]').forEach(i => { ov['qty_' + i.dataset.qty] = Number(i.value) || 1; });
    document.querySelectorAll('[data-optoff]').forEach(i => { if (!i.checked) ov['opt_' + i.dataset.optoff] = false; });
    const u = this._el('qf-urgent'); if (u) ov.urgent = u.checked;
    this._e = QuoteEngine.estimate(this._a, ov);
    this.render();
  },
  render() {
    const a = this._a, e = this._e; if (!a || !e) return;

    // ── Colonne analyse
    const conf = this._el('qf-conf');
    if (conf) {
      const lvl = a.confidence >= 80 ? 'élevée' : a.confidence >= 55 ? 'moyenne' : 'faible';
      conf.textContent = `confiance ${lvl} · ${a.confidence} %`;
      conf.style.color = a.confidence >= 80 ? 'var(--accent)' : a.confidence >= 55 ? '#e4b24a' : '#c0392b';
    }
    const dl = a.deadline || {};
    this._el('qf-analysis').innerHTML =
      (a.services.length
        ? a.services.map(s => `<div class="qf-row">
            <span class="qf-l">${this._esc(s.label)}
              <span class="qf-tag ${s.qtyFound ? 'ok' : 'warn'}">${s.qtyFound ? 'quantité lue' : 'quantité supposée'}</span></span>
            <input class="prop-input qf-q" type="number" min="1" max="200" data-qty="${s.id}" value="${s.qty}" oninput="QuoteUI.recompute()">
          </div>`).join('')
        : '<div class="an-empty-mini">Aucune prestation reconnue. Précise la demande, ou règle les quantités à la main après avoir ajouté la prestation à ta grille.</div>')
      + (a.options.length ? '<div style="margin-top:8px">' + a.options.map(o =>
          `<label class="edw-tog"><input type="checkbox" data-optoff="${o.id}" checked onchange="QuoteUI.recompute()"> ${this._esc(o.label)}
           <span class="qf-tag ok">détecté : « ${this._esc(o.matched)} »</span></label>`).join('') + '</div>' : '')
      + `<div style="margin-top:8px">
           <label class="edw-tog"><input type="checkbox" id="qf-urgent"${dl.urgent ? ' checked' : ''} onchange="QuoteUI.recompute()"> Traiter en urgence</label>
           <div style="margin-top:6px">
             <span class="qf-tag ${dl.mention ? 'ok' : 'warn'}">Délai : ${dl.mention ? this._esc(dl.mention) : 'non précisé'}</span>
             <span class="qf-tag ${a.budget ? 'ok' : ''}">Budget : ${a.budget ? a.budget + ' ' + e.currency : 'non précisé'}</span>
           </div>
         </div>`
      + (a.missing.length
          ? `<div class="hintbox" style="margin-top:10px">⚠ Il manque : ${this._esc(a.missing.join(', '))}. <strong style="color:var(--text)">Rien n'est inventé</strong> — demande-le avant d'annoncer un prix ferme.</div>`
          : '<div class="hintbox" style="margin-top:10px">✓ Brief complet — tu peux annoncer un prix ferme.</div>');

    // ── Colonne estimation
    const cur = e.currency;
    const priv = this._el('qf-priv');
    if (priv) {
      const p = e.privateInfo;
      priv.textContent = p.hours ? `${p.hours} h · ${p.hourlyValue} ${cur}/h · plancher ${p.floor} ${cur}` : '';
      priv.style.color = p.belowRate ? '#c0392b' : 'var(--muted2)';
      priv.title = 'Informations privées — jamais transmises au client';
    }
    this._el('qf-estimate').innerHTML =
      (e.lines.length
        ? e.lines.map(l => `<div class="qf-row"><span class="qf-l">${this._esc(l.label)}${l.qty > 1 ? ' × ' + l.qty : ''}</span>
            <span class="qf-p">${l.total} ${cur}</span></div>`).join('')
        : '<div class="an-empty-mini">Rien à chiffrer pour l\'instant.</div>')
      + e.extras.map(x => `<div class="qf-row"><span class="qf-l" style="color:var(--muted)">${this._esc(x.label)}</span>
          <span class="qf-p" style="color:${x.amount < 0 ? 'var(--accent)' : '#e4b24a'}">${x.amount > 0 ? '+' : ''}${x.amount} ${cur}</span></div>`).join('')
      + `<div class="qf-total"><span>${e.range ? 'Estimation' : 'Prix proposé'}</span>
           <span>${e.range ? `${e.range.low} – ${e.range.high} ${cur}` : `${e.total} ${cur}`}</span></div>`
      + (e.range ? '<div class="hintbox" style="margin-top:8px">Fourchette tant que le brief est incomplet : annoncer un prix ferme sur une demande floue, c\'est s\'engager sur ce qu\'on n\'a pas compris.</div>' : '')
      + (e.privateInfo.belowRate ? '<div class="hintbox" style="margin-top:8px;border-color:rgba(192,57,43,.4)">⚠ Ce prix te situe <strong style="color:var(--text)">sous ton taux horaire visé</strong>.</div>' : '');
  },

  /* ── Messages à copier ── */
  _copy(txt, label) {
    const box = this._el('qf-msg'); if (box) box.textContent = txt;
    navigator.clipboard?.writeText(txt)
      .then(() => showToast?.(label + ' copié ✓ — colle-le dans ta conversation', '#2e9a63', 2600))
      .catch(() => showToast?.('Copie refusée par le navigateur — le texte est affiché ci-dessous', '#e4b24a', 3000));
  },
  copyQuestions() {
    const first = this._a && this._a.services[0];
    this._copy(QuoteEngine.questions(first && first.id), 'Questionnaire');
  },
  copyFollowUp() {
    if (!this._a) return;
    this._copy(QuoteEngine.followUp(this._a), 'Message');
  },
  /* ── Publier l'estimation : crée un lien consultable sans compte ──
     ⚠ On ne publie QUE ce que le client a le droit de voir. Les indicateurs
     privés (temps interne, taux horaire, prix plancher) sont volontairement
     absents de l'objet envoyé : le document Firestore est en lecture PUBLIQUE,
     tout ce qui y entre est lisible par quiconque possède le lien. */
  async publish() {
    if (!this._a || !this._e) return;
    if (!(window.Cloud && Cloud.enabled && Cloud.user()))
      return showToast?.('Connecte-toi (Google ou Discord) pour créer un lien d\'estimation', '#e4b24a', 4000);
    // Brief incomplet → le client verra une FOURCHETTE, ce qui est honnête et
    // déjà signalé sur sa page. Pas de confirm() natif (§3).
    if (this._a.missing.length)
      showToast?.('Brief incomplet : le client verra une fourchette, pas un prix ferme.', '#e4b24a', 3500);

    const e = this._e, a = this._a;
    const code = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const days = 7;
    // Objet volontairement plat et minimal — relire cette liste avant d'y ajouter
    // quoi que ce soit : tout champ ajouté devient public.
    const doc = {
      owner: Cloud.user().uid,
      creatorName: (localStorage.getItem('souanpt_pseudo') || Cloud.user().displayName || 'Créateur'),
      projectName: (this._el('qf-project')?.value || '').trim(),
      title: e.range ? 'Estimation de ton projet' : 'Ton devis',
      currency: e.currency,
      lines: e.lines.map(l => ({ label: l.label, qty: l.qty, total: l.total })),
      extras: e.extras.map(x => ({ label: x.label, amount: x.amount })),
      total: e.range ? e.range.high : e.total,
      deadline: (a.deadline && a.deadline.mention) || '',
      revisions: Pricing.get().revisionsIncluded,
      status: 'sent',
      createdAt: Date.now(),
      expiresAt: Date.now() + days * 86400000,
      // Références jointes (fichiers PUBLICS uniquement — le client les verra
      // sur la mission sans avoir à les renvoyer). Références, pas binaires.
      attachments: (this._attachments || []).slice(),
    };
    try {
      await Cloud._db.collection('estimates').doc(code).set(doc);
      // On garde une trace locale des estimations créées ici : le tableau de
      // bord sait ainsi lesquelles surveiller (acceptations entrantes) sans
      // interroger toute la base.
      this._track(code, doc);
      /* Lien /c/<token> et non /estimate/<code> : c'est LE lien unique du
         dossier. Il suivra le client jusqu'à la livraison — il n'aura jamais
         à en recevoir un nouveau. /estimate/<code> reste valable pour les
         liens déjà envoyés. */
      const url = location.origin + '/c/' + code;
      const box = this._el('qf-msg');
      if (box) box.textContent = `Lien client créé :\n${url}\n\nValable ${days} jours. Il s'ouvre sans compte, et restera le même quand le projet passera en production.`;
      navigator.clipboard?.writeText(url).catch(() => {});
      showToast?.('Lien créé et copié ✓', '#2e9a63', 3500);
    } catch (err) {
      showToast?.('✗ ' + (err.message || 'Publication impossible'), '#c0392b', 4000);
    }
  },

  copySummary(final) {
    if (!this._a || !this._e) return;
    // Prix ferme sur brief incomplet → avertissement non bloquant, pas de
    // confirm() natif (§3). Le créateur reste libre d'envoyer.
    if (final && this._a.missing.length)
      showToast?.('Attention : brief incomplet, tu envoies un prix ferme.', '#e4b24a', 3500);
    this._copy(QuoteEngine.summary(this._a, this._e, { final: !!final }), final ? 'Prix ferme' : 'Estimation');
  },

  /* ══════════════════════════════════════════════════════════════════════
     ACCEPTATIONS & LANCEMENT DE MISSION (côté créateur)
  ══════════════════════════════════════════════════════════════════════ */
  ESTK: 'hub_estimates',
  _tracked() { try { return JSON.parse(localStorage.getItem(this.ESTK) || '[]'); } catch (e) { return []; } },
  _track(code, doc) {
    const l = this._tracked().filter(x => x.code !== code);
    l.unshift({ code, project: doc.projectName || '', total: doc.total, currency: doc.currency,
                createdAt: doc.createdAt, launched: false });
    localStorage.setItem(this.ESTK, JSON.stringify(l.slice(0, 100)));
  },
  _markLaunched(code) {
    const l = this._tracked().map(x => x.code === code ? { ...x, launched: true } : x);
    localStorage.setItem(this.ESTK, JSON.stringify(l));
  },

  _acc: [],   // acceptations en attente, chargées depuis Firestore

  _neg: [],   // contre-offres en attente (notification interne)

  /** Lit les estimations du créateur : acceptations à confirmer + contre-offres. */
  async loadAcceptances() {
    this._acc = []; this._neg = [];
    if (!(window.Cloud && Cloud.enabled && Cloud.user())) { this._renderAcc(); return; }
    const uid = Cloud.user().uid;
    try {
      // Requête par propriétaire (filtre à champ unique, pas d'index composite).
      const snap = await Cloud._db.collection('estimates').where('owner', '==', uid).limit(60).get();
      const estimates = [];
      snap.forEach(d => estimates.push({ code: d.id, ...d.data() }));
      // Un portail déjà créé = mission lancée → on n'a plus à confirmer.
      const launched = new Set(this.getPortals().map(p => p.id));
      // Contre-offres déjà « vues » (marquées localement) → on ne re-notifie pas.
      const seen = this._seenNeg();
      for (const est of estimates) {
        if (est.status === 'confirmed' || launched.has(est.code)) continue;
        const offs = await Cloud._db.collection('estimates').doc(est.code).collection('offers').get();
        let accept = null, lastCounter = null;
        offs.forEach(o => {
          const v = o.data();
          if (v.author !== 'client') return;
          if (v.kind === 'acceptance') accept = v;
          else if (v.kind === 'counter' && (!lastCounter || (v.createdAt || 0) > (lastCounter.createdAt || 0))) lastCounter = v;
        });
        // L'acceptation prime : si le client a fini par accepter, la contre-offre
        // n'a plus à être signalée.
        if (accept) this._acc.push({ est, accept });
        else if (lastCounter && !seen.has(est.code + ':' + (lastCounter.createdAt || 0))) {
          this._neg.push({ est, offer: lastCounter });
        }
      }
    } catch (e) { console.warn('[quote] loadAcceptances', e); }
    // Mode automatique : lancer sans intervention pour les prestations simples.
    if (SiteConfig.get().acceptanceMode === 'automatic') {
      for (const a of this._acc.slice()) { await this.launch(a.est.code, {}, true); }
      // Recharge pour retirer celles qui viennent d'être lancées.
      if (this._acc.length) return this.loadAcceptances();
    }
    this._renderAcc();
  },
  getPortals() { try { return JSON.parse(localStorage.getItem('hub_portals') || '[]'); } catch (e) { return []; } },

  // Contre-offres déjà consultées → mémorisées localement pour ne pas re-notifier.
  _seenNeg() { try { return new Set(JSON.parse(localStorage.getItem('hub_neg_seen') || '[]')); } catch (e) { return new Set(); } },
  dismissNeg(key) {
    const s = this._seenNeg(); s.add(key);
    localStorage.setItem('hub_neg_seen', JSON.stringify([...s].slice(-200)));
    this._neg = this._neg.filter(x => x.est.code + ':' + (x.offer.createdAt || 0) !== key);
    this._renderAcc();
  },

  _renderAcc() {
    const box = this._el('qf-acc'); if (!box) return;
    const nA = this._acc.length, nN = this._neg.length, n = nA + nN;
    const badge = this._el('devis-badge');
    if (badge) { badge.textContent = n || ''; badge.style.display = n ? '' : 'none'; }
    if (!n) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';

    const accCard = !nA ? '' : `<div class="an-card" style="border-color:rgba(200,255,0,.3)">
      <div class="an-card-h"><span>✅ Acceptations à confirmer</span><span class="an-card-sub">${nA} en attente</span></div>
      ${this._acc.map(({ est, accept }) => {
        const parts = String(accept.message || '').split('·').map(s => s.trim());
        const name = this._esc(parts[0] || 'Client'), mail = this._esc(parts[1] || '');
        return `<div class="qf-row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700">${this._esc(est.projectName || est.title || 'Projet')}</div>
            <div style="font-size:10px;color:var(--muted2)">${name}${mail ? ' · ' + mail : ''} · accepté ${this._when(accept.createdAt)}</div>
          </div>
          <div style="font-size:13px;font-weight:800;white-space:nowrap;margin:0 10px">${this._esc(accept.amount)} ${this._esc(est.currency || '€')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="font-size:10px" onclick="window.open('/c/${this._esc(est.code)}','_blank')">Voir</button>
            <button class="btn btn-accent" style="font-size:10px" onclick="QuoteUI.launchDialog('${this._esc(est.code)}')">🚀 Lancer la mission</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

    // Notification interne : contre-offres reçues (pas de service tiers).
    const negCard = !nN ? '' : `<div class="an-card" style="border-color:rgba(228,178,74,.3)">
      <div class="an-card-h"><span>💬 Contre-offres reçues</span><span class="an-card-sub">${nN} à examiner</span></div>
      ${this._neg.map(({ est, offer }) => {
        const key = est.code + ':' + (offer.createdAt || 0);
        return `<div class="qf-row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700">${this._esc(est.projectName || est.title || 'Projet')}</div>
            <div style="font-size:10px;color:var(--muted2)">Proposé : ${this._esc(offer.amount)} ${this._esc(est.currency || '€')} (au lieu de ${this._esc(est.total)}) · ${this._when(offer.createdAt)}${offer.message ? ' · « ' + this._esc(String(offer.message).slice(0, 60)) + ' »' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="font-size:10px" onclick="window.open('/c/${this._esc(est.code)}','_blank')">Voir</button>
            <button class="btn btn-ghost" style="font-size:10px" onclick="QuoteUI.dismissNeg('${this._esc(key)}')" title="Marquer comme lue">Vu</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

    box.innerHTML = accCard + negCard;
  },
  _when(ts) {
    const s = Math.round((Date.now() - Number(ts || 0)) / 1000);
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return new Date(Number(ts)).toLocaleDateString('fr-FR');
  },

  /** Fenêtre intégrée de lancement (jamais confirm/alert/prompt — §4). */
  launchDialog(code) {
    const item = this._acc.find(a => a.est.code === code); if (!item) return;
    const { est, accept } = item;
    const cur = est.currency || '€';
    const parts = String(accept.message || '').split('·').map(s => s.trim());
    const defDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const html = `
      <div class="ql-r"><span>Client</span><b>${this._esc(parts[0] || 'Client')}</b></div>
      <div class="ql-r"><span>Prestation</span><b>${this._esc(est.projectName || est.title || 'Projet')}</b></div>
      <div class="ql-r"><span>Prix accepté</span><b>${this._esc(accept.amount)} ${this._esc(cur)}</b></div>
      <div class="edw-l">Livraison estimée</div>
      <input class="prop-input" id="ql-date" type="date" value="${defDate}">
      <div class="edw-l">Acompte</div>
      <select class="prop-input" id="ql-ac">
        <option value="0">Aucun</option>
        <option value="30">30 %</option>
        <option value="50" selected>50 %</option>
      </select>
      <div class="edw-l">Retours inclus</div>
      <input class="prop-input" id="ql-rev" type="number" min="0" value="${Number(est.revisions) || 2}">
      <label class="edw-tog" style="margin-top:10px"><input type="checkbox" id="ql-portal" checked> Créer l'espace mission (même lien /c/)</label>`;
    QDialog.open({
      title: '🚀 Lancer cette mission ?',
      body: html,
      confirm: 'Confirmer et lancer',
      onConfirm: async (dlg) => {
        const opts = {
          deliveryDate: dlg.querySelector('#ql-date').value,
          acomptePct: Number(dlg.querySelector('#ql-ac').value) || 0,
          revisions: Number(dlg.querySelector('#ql-rev').value) || 0,
        };
        return this.launch(code, opts);
      },
    });
  },

  /**
   * Lance la mission. IDEMPOTENT : si un portail existe déjà pour ce code,
   * on ne recrée rien (protection double-clic / rechargement).
   * Réutilise le MÊME code comme id de portail → /c/<code> continue de marcher.
   */
  async launch(code, opts, silent) {
    opts = opts || {};
    if (!(window.Cloud && Cloud.enabled && Cloud.user())) {
      if (!silent) showToast?.('Connecte-toi pour lancer la mission', '#e4b24a', 3500);
      return false;
    }
    // Déjà lancée ? (local d'abord, puis Firestore)
    if (this.getPortals().some(p => p.id === code)) { if (!silent) showToast?.('Mission déjà lancée', '#666', 2500); return true; }
    let est = (this._acc.find(a => a.est.code === code) || {}).est;
    const accept = (this._acc.find(a => a.est.code === code) || {}).accept || {};
    try {
      if (!est) { const d = await Cloud._db.collection('estimates').doc(code).get(); est = d.exists ? { code, ...d.data() } : null; }
      if (!est) { if (!silent) showToast?.('Estimation introuvable', '#c0392b', 3000); return false; }
      const remote = await Cloud._db.collection('portals').doc(code).get();
      if (remote.exists) { this._syncPortalLocal(remote.data()); this._markLaunched(code);
        if (!silent) showToast?.('Mission déjà lancée', '#666', 2500); return true; }

      const parts = String(accept.message || '').split('·').map(s => s.trim());
      const cfg = SiteConfig.get();
      // Identité UNIQUE : le portail reprend le nom du créateur, pas « FOLIO »
      // par défaut (§16 — plus de souanpt d'un côté, FOLIO de l'autre).
      const siteName = localStorage.getItem('souanpt_pseudo') || Cloud.user().displayName || est.creatorName || 'Mon studio';
      const acPct = opts.acomptePct || 0;
      const portal = {
        id: code, owner: Cloud.user().uid,
        mission: est.projectName || est.title || 'Mission',
        client: parts[0] || 'Client',
        total: Number(accept.amount) || Number(est.total) || 0,
        acomptePct: acPct,
        // Étape « Acompte » si un acompte est demandé, sinon « Production ».
        stepIndex: acPct > 0 ? 2 : 3,
        revisions: opts.revisions,
        deliveryDate: opts.deliveryDate || '',
        siteName, accent: cfg.accentColor || '#C8FF00', theme: cfg.theme || '#060606',
        active: true, sourceAcceptanceId: code,
        deliverables: [], createdAt: Date.now(),
        // Reprise AUTOMATIQUE des pièces jointes de la demande / estimation :
        // références, brief… Elles ne sont pas recopiées (ce sont des
        // références de fichiers), juste rattachées, dédupliquées.
        attachments: (typeof dedupeAttachments === 'function')
          ? dedupeAttachments([...(est.attachments || []), ...(est.requestAttachments || [])])
          : (est.attachments || []),
      };
      // Écriture atomique : le portail Firestore d'abord (source de vérité du
      // lien public), puis le miroir local, puis le statut de l'estimation.
      await Cloud.savePortalDoc(portal);
      this._syncPortalLocal(portal);
      await Cloud._db.collection('estimates').doc(code).set({ status: 'confirmed', confirmedAt: Date.now() }, { merge: true });
      this._markLaunched(code);
      QDialog.close();
      if (!silent) {
        showToast?.('✓ Mission lancée — le client suit tout depuis le même lien', '#2e9a63', 4000);
        if (typeof renderPortals === 'function') renderPortals();
      }
      this._acc = this._acc.filter(a => a.est.code !== code);
      this._renderAcc();
      return true;
    } catch (e) {
      console.warn('[quote] launch', e);
      if (!silent) showToast?.('✗ ' + (e.message || 'Lancement impossible'), '#c0392b', 4000);
      return false;
    }
  },
  _syncPortalLocal(portal) {
    const l = this.getPortals().filter(p => p.id !== portal.id);
    l.unshift({ ...portal, url: location.origin + '/c/' + portal.id, publishedAt: Date.now() });
    localStorage.setItem('hub_portals', JSON.stringify(l));
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   QDialog — micro-fenêtre intégrée du tableau de bord (remplace confirm/prompt).
   Overlay + carte, Échap et clic extérieur ferment (sauf pendant l'envoi),
   focus géré, onConfirm asynchrone avec état de chargement et erreur inline.
══════════════════════════════════════════════════════════════════════════ */
const QDialog = {
  _el: null, _busy: false, _lastFocus: null,
  open({ title, body, confirm, cancel, onConfirm }) {
    this.close();
    this._lastFocus = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'qd-ov';
    ov.innerHTML = `<div class="qd" role="dialog" aria-modal="true">
      <h2 class="qd-t">${title || ''}</h2>
      <div class="qd-b">${body || ''}</div>
      <div class="qd-err" style="display:none"></div>
      <div class="qd-a">
        <button type="button" class="btn btn-ghost qd-cancel">${cancel || 'Annuler'}</button>
        <button type="button" class="btn btn-accent qd-ok">${confirm || 'Confirmer'}</button>
      </div></div>`;
    document.body.appendChild(ov);
    this._el = ov;
    const card = ov.querySelector('.qd');
    const okB = ov.querySelector('.qd-ok'), err = ov.querySelector('.qd-err');
    ov.querySelector('.qd-cancel').onclick = () => { if (!this._busy) this.close(); };
    ov.onclick = e => { if (e.target === ov && !this._busy) this.close(); };
    this._key = e => { if (e.key === 'Escape' && !this._busy) this.close(); };
    document.addEventListener('keydown', this._key);
    okB.onclick = async () => {
      if (this._busy || !onConfirm) return;
      this._busy = true; okB.disabled = true; const label = okB.textContent; okB.textContent = 'Envoi…';
      err.style.display = 'none';
      try {
        const ok = await onConfirm(card);
        // onConfirm ferme lui-même en cas de succès (ex. QDialog.close()).
        if (ok === false) throw new Error('Action non aboutie');
      } catch (e) {
        this._busy = false; okB.disabled = false; okB.textContent = label;
        err.textContent = e.message || 'Une erreur est survenue. Réessaie.';
        err.style.display = 'block';
        return;
      }
      this._busy = false;
    };
    const first = card.querySelector('input,select,textarea,button:not(.qd-cancel):not(.qd-ok)');
    setTimeout(() => { (first || okB).focus(); }, 0);
  },
  close() {
    if (this._key) document.removeEventListener('keydown', this._key);
    if (this._el) this._el.remove();
    this._el = null; this._busy = false;
    if (this._lastFocus && this._lastFocus.focus) { try { this._lastFocus.focus(); } catch (e) {} }
  },
};

window.QDialog = QDialog;
window.QuoteUI = QuoteUI;
window.Pricing = Pricing;
window.QuoteEngine = QuoteEngine;
window.QUOTE_SERVICES = QUOTE_SERVICES;
window.QUOTE_OPTIONS = QUOTE_OPTIONS;
