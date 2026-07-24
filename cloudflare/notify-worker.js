/**
 * notify-worker — notifications PERSISTANTES, observables et relançables.
 *
 * SÉCURITÉ. Le navigateur n'envoie QUE { event, workspaceId, entityId }. Il ne
 * voit jamais le webhook Discord ni la clé email. Le Worker RELIT lui-même le
 * montant, le client et le projet dans Firestore — un montant venu du
 * navigateur n'est jamais utilisé. Les écritures Firestore se font avec le
 * COMPTE DE SERVICE (comme le Worker analytics), donc les collections
 * `notifications` et `notification_jobs` restent en écriture interdite au
 * client : personne ne peut fabriquer une fausse notification.
 *
 * ROBUSTESSE. Chaque canal a son propre statut, son compteur de tentatives et
 * sa dernière erreur. Une panne Discord n'annule ni l'interne ni un email déjà
 * envoyé, et ne le renvoie pas non plus. Un Cron rejoue les canaux en échec
 * avec un backoff borné, puis abandonne proprement.
 *
 * Secrets (Settings → Variables and Secrets) — JAMAIS dans le code :
 *   FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY   (obligatoires — écritures)
 *   FIREBASE_PROJECT_ID                            (facultatif)
 *   DISCORD_WEBHOOK_URL                            (facultatif)
 *   EMAIL_PROVIDER (resend|brevo|none), EMAIL_API_KEY, EMAIL_FROM, EMAIL_TO
 *   APP_URL, ALLOWED_ORIGIN
 */

const EVENTS = {
  'request.created':                 { icon: '📥', title: 'Nouvelle demande',        cat: 'requests' },
  'request.file_added':              { icon: '📎', title: 'Nouveau fichier client',  cat: 'requests' },
  'request.question_sent':           { icon: '❓', title: 'Question envoyée',        cat: 'requests' },
  'request.question_answered':       { icon: '💬', title: 'Le client a répondu',     cat: 'requests' },
  'estimate.published':              { icon: '📄', title: 'Estimation publiée',      cat: 'estimates' },
  'estimate.counter_offer_received': { icon: '↩️', title: 'Contre-offre reçue',      cat: 'estimates' },
  'estimate.accepted':               { icon: '✅', title: 'Estimation acceptée',     cat: 'estimates' },
  'mission.started':                 { icon: '🚀', title: 'Mission lancée',          cat: 'missions' },
  'proposal.published':              { icon: '🖼', title: 'Proposition publiée',     cat: 'missions' },
  'proposal.comment_added':          { icon: '💭', title: 'Commentaire client',      cat: 'missions' },
  'payment.received':                { icon: '💰', title: 'Paiement reçu',           cat: 'payments' },
  'delivery.unlocked':               { icon: '📦', title: 'Livraison débloquée',     cat: 'missions' },
};

// Backoff borné : 5 min, 15 min, 1 h, 6 h → puis échec définitif.
const RETRY_DELAYS = [5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60];
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/* ── Firestore (compte de service) ────────────────────────────────────── */
function projId(env) {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  try { return env.FIREBASE_CLIENT_EMAIL.split('@')[1].split('.')[0]; } catch (e) { return 'souanpt-hub'; }
}
const docsUrl = env => `https://firestore.googleapis.com/v1/projects/${projId(env)}/databases/(default)/documents`;

let _tok = null;
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && _tok.exp - 60 > now) return _tok.access_token;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore',
                  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                assertion: data + '.' + b64urlBytes(new Uint8Array(sig)) }),
  });
  if (!res.ok) throw new Error('token ' + res.status);
  const j = await res.json();
  _tok = { access_token: j.access_token, exp: now + (j.expires_in || 3600) };
  return _tok.access_token;
}
function b64url(s) { return b64urlBytes(new TextEncoder().encode(s)); }
function b64urlBytes(b) { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function importPrivateKey(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der; try { der = Uint8Array.from(atob(body), c => c.charCodeAt(0)); }
  catch (e) { throw new Error('FIREBASE_PRIVATE_KEY invalide'); }
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

const val = v => {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(val);
  if (v.mapValue) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = val(f[k]); return o; }
  return undefined;
};
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const k in v) f[k] = toFs(v[k]); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
const fields = o => { const f = {}; for (const k in o) f[k] = toFs(o[k]); return f; };
const unfields = d => { const o = {}; for (const k in (d.fields || {})) o[k] = val(d.fields[k]); return o; };

async function fsGet(env, pathSeg) {
  const t = await getAccessToken(env);
  const r = await fetch(`${docsUrl(env)}/${pathSeg}`, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return null;
  return unfields(await r.json());
}
async function fsSet(env, pathSeg, obj) {
  const t = await getAccessToken(env);
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${docsUrl(env)}/${pathSeg}?${mask}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(obj) }),
  });
  if (!r.ok) throw new Error('firestore ' + r.status);
  return true;
}
/** Jobs à rejouer : pending/failed dont nextRetryAt est dépassé. */
async function fsQueryDueJobs(env, limit) {
  const t = await getAccessToken(env);
  const r = await fetch(`${docsUrl(env)}:runQuery`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'notification_jobs' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'done' }, op: 'EQUAL', value: { booleanValue: false } } },
        { fieldFilter: { field: { fieldPath: 'nextRetryAt' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(Date.now()) } } },
      ] } },
      limit: limit || 20,
    } }),
  });
  if (!r.ok) return [];
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter(x => x.document)
    .map(x => ({ id: String(x.document.name).split('/').pop(), ...unfields(x.document) }));
}

/* ── Nettoyage des erreurs : jamais de secret dans un message affiché ── */
function safeError(msg) {
  return String(msg || 'erreur')
    .replace(/https:\/\/discord\.com\/api\/webhooks\/\S+/gi, 'https://discord.com/api/webhooks/••••••')
    .replace(/(re_|key-|xkeysib-)[A-Za-z0-9_-]+/gi, '$1••••••')
    .replace(/Bearer\s+\S+/gi, 'Bearer ••••••')
    .slice(0, 200);
}

/** Classe une réponse HTTP : retry ? permanent ? délai imposé ? */
function classify(status, retryAfter) {
  if (status === 429) return { retry: true, wait: retryAfter ? Number(retryAfter) * 1000 : null, why: 'rate limit (429)' };
  if (status >= 500) return { retry: true, wait: null, why: 'erreur fournisseur (' + status + ')' };
  return { retry: false, wait: null, why: 'refus définitif (' + status + ')' };   // 4xx hors 429
}

/* ══════════════════════════════════════════════════════════════════════════
   NotificationProvider — le métier n'appelle jamais Discord ni un email
   directement. Chaque méthode renvoie { ok } | { skipped } | { failed }.
══════════════════════════════════════════════════════════════════════════ */
class NotificationProvider {
  constructor(env) { this.env = env; }

  async sendInternal(ev) {
    // Écrit avec le compte de service → le client ne peut pas en fabriquer.
    await fsSet(this.env, 'notifications/' + encodeURIComponent(ev.idempotencyKey), {
      ownerId: ev.ownerId || '', workspaceId: ev.workspaceId || '', event: ev.event,
      category: ev.category || 'requests', title: ev.title, message: ev.message,
      actionUrl: ev.actionUrl || '', entityId: ev.entityId || '',
      idempotencyKey: ev.idempotencyKey, readAt: null, archivedAt: null, createdAt: Date.now(),
    });
    return { ok: true };
  }

  async sendDiscord(ev) {
    const hook = (this.env.DISCORD_WEBHOOK_URL || '').trim();
    if (!hook) return { skipped: 'non configuré' };
    // Charge utile PUBLIQUE construite ici : jamais de note interne, de prix
    // plancher ni d'URL de stockage privée.
    const lines = Object.entries(ev.details || {}).map(([k, v]) => `**${k} :** ${v}`).join('\n');
    let r;
    try {
      r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `${ev.icon} **${ev.title}**\n${lines}${ev.actionUrl ? `\n\n[Ouvrir dans Souanpt Hub](${ev.actionUrl})` : ''}` }) });
    } catch (e) { return { failed: safeError(e.message), retry: true }; }
    if (r.ok) return { ok: true };
    const c = classify(r.status, r.headers.get('retry-after'));
    return { failed: 'Discord : ' + c.why, retry: c.retry, wait: c.wait };
  }

  async sendEmail(ev) {
    const provider = (this.env.EMAIL_PROVIDER || 'none').toLowerCase();
    const key = (this.env.EMAIL_API_KEY || '').trim();
    const from = (this.env.EMAIL_FROM || '').trim();
    const to = (ev.emailTo || this.env.EMAIL_TO || '').trim();
    if (provider === 'none') return { skipped: 'non configuré' };
    if (!key) return { skipped: 'EMAIL_API_KEY absent' };
    if (!from) return { skipped: 'EMAIL_FROM absent' };
    if (!to) return { skipped: 'destinataire absent' };
    const tpl = TEMPLATES[ev.event] || TEMPLATES._default;
    const subject = tpl.subject(ev), html = tpl.render(ev);
    let r;
    try {
      if (provider === 'resend') {
        r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html }) });
      } else if (provider === 'brevo') {
        r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({ sender: { email: from.replace(/.*<|>.*/g, '') || from },
                                 to: [{ email: to }], subject, htmlContent: html }) });
      } else return { skipped: 'fournisseur inconnu : ' + provider };
    } catch (e) { return { failed: safeError(e.message), retry: true }; }
    if (r.ok) return { ok: true };
    const c = classify(r.status, r.headers.get('retry-after'));
    return { failed: 'Email : ' + c.why, retry: c.retry, wait: c.wait };
  }

  send(channel, ev) {
    if (channel === 'discord') return this.sendDiscord(ev);
    if (channel === 'email') return this.sendEmail(ev);
    return this.sendInternal(ev);
  }
}

/* ── Modèles d'emails, centralisés (jamais de HTML dans le métier) ── */
const btn = url => url ? `<p><a href="${url}" style="display:inline-block;padding:12px 22px;background:#C8FF00;color:#060606;border-radius:10px;text-decoration:none;font-weight:bold">Ouvrir mon espace</a></p>` : '';
const wrap = (body, ev) => `<div style="font-family:system-ui,sans-serif;line-height:1.6;color:#141414">${body}${btn(ev.actionUrl)}<p style="color:#888;font-size:12px">Souanpt Hub</p></div>`;
const TEMPLATES = {
  'request.question_sent': { subject: () => 'Une précision est nécessaire',
    render: ev => wrap(`<h2>Une précision est nécessaire</h2><p>Bonjour,</p><p>Une information manque pour poursuivre votre demande. Vous pouvez répondre directement depuis votre espace.</p>`, ev) },
  'estimate.published': { subject: () => 'Votre estimation est disponible',
    render: ev => wrap(`<h2>Votre estimation est disponible</h2><p>Bonjour,</p><p>Vous pouvez la consulter, l'accepter ou proposer un autre montant depuis votre espace.</p>`, ev) },
  'mission.started': { subject: () => 'Votre mission est confirmée',
    render: ev => wrap(`<h2>Votre mission est confirmée</h2><p>Bonjour,</p><p>Le suivi du projet est disponible depuis votre espace habituel.</p>`, ev) },
  'proposal.published': { subject: () => 'Une nouvelle proposition est disponible',
    render: ev => wrap(`<h2>Nouvelle proposition</h2><p>Bonjour,</p><p>Une proposition vous attend. Vous pouvez la consulter et transmettre vos retours.</p>`, ev) },
  'delivery.unlocked': { subject: () => 'Votre livraison est disponible',
    render: ev => wrap(`<h2>Votre livraison est disponible</h2><p>Bonjour,</p><p>Vos fichiers finaux sont accessibles depuis votre espace.</p>`, ev) },
  _default: { subject: ev => `${ev.icon} ${ev.title}`,
    render: ev => wrap(`<h2>${ev.title}</h2><ul>${Object.entries(ev.details || {}).map(([k, v]) => `<li><b>${k}</b> : ${v}</li>`).join('')}</ul>`, ev) },
};

/** Relit le contexte côté SERVEUR (jamais les valeurs du navigateur). */
async function loadContext(env, workspaceId) {
  const details = {}; let ownerId = '', emailTo = '';
  const est = await fsGet(env, 'estimates/' + encodeURIComponent(workspaceId));
  const req = est ? null : await fsGet(env, 'requests/' + encodeURIComponent(workspaceId));
  const por = await fsGet(env, 'portals/' + encodeURIComponent(workspaceId));
  const src = est || req || por;
  if (src) {
    ownerId = src.owner || '';
    if (src.projectName || src.mission) details['Projet'] = src.projectName || src.mission;
    if (src.contact && src.contact.name) details['Client'] = src.contact.name;
    if (src.contact && src.contact.email) emailTo = src.contact.email;
    if (src.client) details['Client'] = src.client;
    if (typeof src.total === 'number' && src.total > 0) details['Montant'] = src.total + ' ' + (src.currency || '€');
  }
  return { ownerId, details, emailTo };
}

/** Envoie les canaux encore à traiter et met le job à jour. */
async function runJob(env, job) {
  const provider = new NotificationProvider(env);
  const ctx = job.test ? { ownerId: 'test', details: { Test: 'Notification de test' }, emailTo: '' }
                       : await loadContext(env, job.workspaceId);
  const meta = EVENTS[job.event] || { icon: '🔔', title: job.event, cat: 'requests' };
  const ev = {
    event: job.event, icon: meta.icon, title: meta.title, category: meta.cat,
    message: Object.entries(ctx.details).map(([k, v]) => `${k} : ${v}`).join(' · ') || meta.title,
    details: ctx.details, ownerId: ctx.ownerId, workspaceId: job.workspaceId,
    entityId: job.entityId || '', idempotencyKey: job.idempotencyKey,
    actionUrl: (env.APP_URL || '') ? `${env.APP_URL}/c/${job.workspaceId}` : '',
    emailTo: job.audience === 'client' ? ctx.emailTo : '',
  };

  const status = { ...(job.channelStatus || {}) };
  const attempts = { ...(job.attempts || {}) };
  const lastError = { ...(job.lastError || {}) };
  let nextRetryAt = 0;

  for (const ch of (job.channels || ['internal'])) {
    // On ne renvoie JAMAIS un canal déjà envoyé ou définitivement abandonné.
    if (status[ch] === 'sent' || status[ch] === 'skipped' || status[ch] === 'abandoned') continue;
    let res;
    try { res = await provider.send(ch, ev); }
    catch (e) { res = { failed: safeError(e.message), retry: true }; }

    if (res.ok) { status[ch] = 'sent'; delete lastError[ch]; continue; }
    if (res.skipped) { status[ch] = 'skipped'; lastError[ch] = res.skipped; continue; }

    attempts[ch] = (attempts[ch] || 0) + 1;
    lastError[ch] = res.failed;
    if (!res.retry || attempts[ch] >= MAX_ATTEMPTS) {
      status[ch] = 'abandoned';   // 4xx permanent, ou budget de tentatives épuisé
    } else {
      status[ch] = 'failed';
      const delay = res.wait != null ? res.wait : RETRY_DELAYS[Math.min(attempts[ch] - 1, RETRY_DELAYS.length - 1)] * 1000;
      const at = Date.now() + delay;
      nextRetryAt = nextRetryAt ? Math.min(nextRetryAt, at) : at;
    }
  }

  const done = (job.channels || []).every(c => ['sent', 'skipped', 'abandoned'].includes(status[c]));
  await fsSet(env, 'notification_jobs/' + encodeURIComponent(job.id), {
    channelStatus: status, attempts, lastError,
    nextRetryAt: done ? 0 : (nextRetryAt || Date.now() + RETRY_DELAYS[0] * 1000),
    done, updatedAt: Date.now(),
  });
  return { status, attempts, lastError, done };
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */
function cors(env) {
  const o = (env.ALLOWED_ORIGIN || '').trim() || '*';
  return { 'access-control-allow-origin': o, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
}
const json = (env, body, status) => new Response(JSON.stringify(body),
  { status: status || 200, headers: { 'content-type': 'application/json', ...cors(env) } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (request.method !== 'POST') return json(env, { ok: false, error: 'method' }, 405);

    const allowed = (env.ALLOWED_ORIGIN || '').trim();
    const origin = request.headers.get('origin') || '';
    if (allowed && origin && origin !== allowed) return json(env, { ok: false, error: 'origin' }, 403);

    let body = {};
    try {
      const txt = await request.text();
      if (txt.length > 4000) return json(env, { ok: false, error: 'payload' }, 413);
      body = JSON.parse(txt);
    } catch (e) { return json(env, { ok: false, error: 'json' }, 400); }

    // Relance manuelle d'un job depuis « État des envois ».
    if (body.action === 'retry' && body.jobId) {
      const id = String(body.jobId).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
      const job = await fsGet(env, 'notification_jobs/' + encodeURIComponent(id));
      if (!job) return json(env, { ok: false, error: 'job introuvable' }, 404);
      // Un canal abandonné redevient « à tenter » sur demande explicite.
      const st = { ...(job.channelStatus || {}) };
      for (const k in st) if (st[k] === 'abandoned' || st[k] === 'failed') st[k] = 'pending';
      const out = await runJob(env, { ...job, id, channelStatus: st, attempts: {} });
      return json(env, { ok: true, results: out.status });
    }

    const event = String(body.event || '');
    const workspaceId = String(body.workspaceId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!EVENTS[event]) return json(env, { ok: false, error: 'event inconnu' }, 400);
    if (!workspaceId) return json(env, { ok: false, error: 'workspaceId' }, 400);

    const entityId = String(body.entityId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const version = Number(body.version) || 1;
    // Clé d'idempotence DURABLE : elle est l'identifiant du job en base.
    const idempotencyKey = `${workspaceId}_${event}_${entityId || '0'}_${version}`;
    const channels = (Array.isArray(body.channels) && body.channels.length ? body.channels : ['internal'])
      .filter(c => ['internal', 'discord', 'email'].includes(c));

    // Déjà traité ? On renvoie le résultat existant sans rien renvoyer.
    const existing = await fsGet(env, 'notification_jobs/' + encodeURIComponent(idempotencyKey));
    if (existing && !body.test) {
      return json(env, { ok: true, deduped: true, results: existing.channelStatus || {}, idempotencyKey });
    }

    const job = {
      id: idempotencyKey, event, workspaceId, entityId, idempotencyKey, channels,
      audience: body.audience === 'client' ? 'client' : 'creator',
      channelStatus: Object.fromEntries(channels.map(c => [c, 'pending'])),
      attempts: {}, lastError: {}, nextRetryAt: 0, done: false, test: !!body.test,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    try { await fsSet(env, 'notification_jobs/' + encodeURIComponent(idempotencyKey), job); }
    catch (e) { return json(env, { ok: false, error: 'file indisponible : ' + safeError(e.message) }, 200); }

    const out = await runJob(env, job);
    // TOUJOURS 200 : une notification ne doit jamais faire échouer le métier.
    return json(env, { ok: true, results: out.status, errors: out.lastError, idempotencyKey });
  },

  /** Cron : rejoue les canaux en échec dont l'heure de reprise est atteinte. */
  async scheduled(controller, env, ctx) {
    const jobs = await fsQueryDueJobs(env, 20);
    for (const j of jobs) {
      try { await runJob(env, j); } catch (e) { /* un job cassé n'arrête pas les autres */ }
    }
  },
};
