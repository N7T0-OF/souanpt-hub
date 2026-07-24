/**
 * notify-worker — couche de notifications FACULTATIVE et NON BLOQUANTE.
 *
 * PRINCIPE DE SÉCURITÉ. Le navigateur n'envoie QUE { event, workspaceId }.
 * Il ne voit jamais l'URL du webhook Discord ni la clé email : elles vivent
 * uniquement dans les secrets du Worker. Le Worker RELIT lui-même les données
 * (montant, client, projet) dans Firestore — on ne fait jamais confiance à un
 * montant envoyé par le navigateur.
 *
 * PRINCIPE DE ROBUSTESSE. Une panne Discord ou email ne doit JAMAIS empêcher
 * une acceptation, une demande ou un lancement de mission. Le Worker répond
 * toujours 200 avec le détail par canal ; l'appelant ignore le résultat.
 *
 * Secrets attendus (Settings → Variables and Secrets) — JAMAIS dans le code :
 *   DISCORD_WEBHOOK_URL   (facultatif)
 *   EMAIL_PROVIDER        (resend | brevo | none)
 *   EMAIL_API_KEY         (facultatif)
 *   EMAIL_FROM            (ex. "Souanpt <hello@souanpt.fr>")
 *   EMAIL_TO              (destinataire créateur)
 *   APP_URL               (ex. https://souanptjub.pages.dev)
 *   ALLOWED_ORIGIN        (ex. https://souanptjub.pages.dev)
 */

const PROJECT = 'souanpt-hub';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

/* Événements pris en charge. Un événement inconnu est refusé : on ne relaie
   pas n'importe quoi vers Discord. */
const EVENTS = {
  'request.created':                  { icon: '📥', title: 'Nouvelle demande' },
  'request.file_added':               { icon: '📎', title: 'Nouveau fichier client' },
  'request.question_sent':            { icon: '❓', title: 'Question envoyée' },
  'request.question_answered':        { icon: '💬', title: 'Le client a répondu' },
  'estimate.published':               { icon: '📄', title: 'Estimation publiée' },
  'estimate.counter_offer_received':  { icon: '↩️', title: 'Contre-offre reçue' },
  'estimate.accepted':                { icon: '✅', title: 'Estimation acceptée' },
  'mission.started':                  { icon: '🚀', title: 'Mission lancée' },
  'proposal.published':               { icon: '🖼', title: 'Proposition publiée' },
  'proposal.comment_added':           { icon: '💭', title: 'Commentaire client' },
  'payment.received':                 { icon: '💰', title: 'Paiement reçu' },
  'delivery.unlocked':                { icon: '📦', title: 'Livraison débloquée' },
};

const val = v => {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = val(f[k]); return o; }
  return undefined;
};

function cors(env) {
  const o = (env.ALLOWED_ORIGIN || '').trim() || '*';
  return {
    'access-control-allow-origin': o,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
const json = (env, body, status) =>
  new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json', ...cors(env) } });

/* ══════════════════════════════════════════════════════════════════════════
   NotificationProvider — le métier n'appelle jamais Discord ni un fournisseur
   email directement. On passe toujours par dispatch(), ce qui permet de
   changer de fournisseur sans toucher au reste.
══════════════════════════════════════════════════════════════════════════ */
class NotificationProvider {
  constructor(env) { this.env = env; }

  /** Notification interne : écrite dans Firestore, lue par le tableau de bord. */
  async sendInternal(ev) {
    const key = ev.idempotencyKey.replace(/[^\w.-]/g, '_');
    const body = {
      fields: {
        ownerId: { stringValue: ev.ownerId || '' },
        workspaceId: { stringValue: ev.workspaceId || '' },
        event: { stringValue: ev.event },
        title: { stringValue: ev.title },
        message: { stringValue: ev.message },
        actionUrl: { stringValue: ev.actionUrl || '' },
        readAt: { nullValue: null },
        createdAt: { integerValue: String(Date.now()) },
      },
    };
    // documentId = clé d'idempotence → un rechargement ou un double clic
    // écrase le même document au lieu d'en créer un second.
    const url = `${FS}/notifications/${encodeURIComponent(key)}`;
    const r = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('interne HTTP ' + r.status);
    return true;
  }

  async sendDiscord(ev) {
    const hook = (this.env.DISCORD_WEBHOOK_URL || '').trim();
    if (!hook) return 'non configuré';
    const lines = Object.entries(ev.details || {}).map(([k, v]) => `**${k} :** ${v}`).join('\n');
    const r = await fetch(hook, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: `${ev.icon} **${ev.title}**\n${lines}${ev.actionUrl ? `\n\n[Ouvrir dans Souanpt Hub](${ev.actionUrl})` : ''}`,
      }),
    });
    if (!r.ok) throw new Error('discord HTTP ' + r.status);
    return true;
  }

  async sendEmail(ev) {
    const provider = (this.env.EMAIL_PROVIDER || 'none').toLowerCase();
    const key = (this.env.EMAIL_API_KEY || '').trim();
    const from = (this.env.EMAIL_FROM || '').trim();
    const to = (this.env.EMAIL_TO || '').trim();
    if (provider === 'none' || !key || !from || !to) return 'non configuré';
    const html = `<h2>${ev.icon} ${ev.title}</h2><ul>${
      Object.entries(ev.details || {}).map(([k, v]) => `<li><b>${k}</b> : ${v}</li>`).join('')
    }</ul>${ev.actionUrl ? `<p><a href="${ev.actionUrl}">Ouvrir dans Souanpt Hub</a></p>` : ''}`;

    if (provider === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: `${ev.icon} ${ev.title}`, html }),
      });
      if (!r.ok) throw new Error('resend HTTP ' + r.status);
      return true;
    }
    if (provider === 'brevo') {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ sender: { email: from.replace(/.*<|>.*/g, '') || from }, to: [{ email: to }],
                               subject: `${ev.icon} ${ev.title}`, htmlContent: html }),
      });
      if (!r.ok) throw new Error('brevo HTTP ' + r.status);
      return true;
    }
    return 'fournisseur inconnu : ' + provider;
  }

  /** Envoie sur les canaux demandés. Un canal en panne n'arrête pas les autres. */
  async dispatch(ev) {
    const out = {};
    for (const ch of ev.channels) {
      try {
        const fn = ch === 'discord' ? this.sendDiscord : ch === 'email' ? this.sendEmail : this.sendInternal;
        const res = await fn.call(this, ev);
        out[ch] = res === true ? 'sent' : 'skipped: ' + res;
      } catch (e) {
        // Journalisé, jamais propagé : le parcours métier ne doit pas casser.
        out[ch] = 'failed: ' + (e.message || 'erreur');
      }
    }
    return out;
  }
}

/** Relit les données côté SERVEUR — jamais celles envoyées par le navigateur. */
async function loadContext(event, workspaceId) {
  const details = {};
  let ownerId = '';
  const get = async (col, id) => {
    try {
      const r = await fetch(`${FS}/${col}/${encodeURIComponent(id)}`);
      if (!r.ok) return null;
      const j = await r.json();
      const o = {}; for (const k in (j.fields || {})) o[k] = val(j.fields[k]);
      return o;
    } catch (e) { return null; }
  };
  const est = await get('estimates', workspaceId);
  const req = est ? null : await get('requests', workspaceId);
  const por = await get('portals', workspaceId);
  const src = est || req || por;
  if (src) {
    ownerId = src.owner || '';
    if (src.projectName || src.mission) details['Projet'] = src.projectName || src.mission;
    if (src.contact && src.contact.name) details['Client'] = src.contact.name;
    if (src.client) details['Client'] = src.client;
    if (typeof src.total === 'number' && src.total > 0) details['Montant'] = src.total + ' ' + (src.currency || '€');
  }
  return { ownerId, details };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (request.method !== 'POST') return json(env, { ok: false, error: 'method' }, 405);

    // Origine : on n'accepte que le hub si ALLOWED_ORIGIN est renseigné.
    const allowed = (env.ALLOWED_ORIGIN || '').trim();
    const origin = request.headers.get('origin') || '';
    if (allowed && origin && origin !== allowed) return json(env, { ok: false, error: 'origin' }, 403);

    let body = {};
    try {
      const txt = await request.text();
      if (txt.length > 4000) return json(env, { ok: false, error: 'payload' }, 413);
      body = JSON.parse(txt);
    } catch (e) { return json(env, { ok: false, error: 'json' }, 400); }

    const event = String(body.event || '');
    const workspaceId = String(body.workspaceId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const meta = EVENTS[event];
    if (!meta) return json(env, { ok: false, error: 'event inconnu' }, 400);
    if (!workspaceId) return json(env, { ok: false, error: 'workspaceId' }, 400);

    // Mode test : ne relit rien, sert à vérifier la configuration des canaux.
    const isTest = body.test === true;
    const ctx = isTest ? { ownerId: 'test', details: { Test: 'Notification de test' } }
                       : await loadContext(event, workspaceId);

    const channels = Array.isArray(body.channels) && body.channels.length
      ? body.channels.filter(c => ['internal', 'discord', 'email'].includes(c))
      : ['internal'];

    // Idempotence : workspaceId:event:entity:version
    const entity = String(body.entityId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const idempotencyKey = `${workspaceId}_${event}_${entity || '0'}_${body.version || 1}`;

    const provider = new NotificationProvider(env);
    const results = await provider.dispatch({
      event, icon: meta.icon, title: meta.title,
      message: Object.entries(ctx.details).map(([k, v]) => `${k} : ${v}`).join(' · ') || meta.title,
      details: ctx.details, ownerId: ctx.ownerId, workspaceId,
      actionUrl: (env.APP_URL || '') ? `${env.APP_URL}/c/${workspaceId}` : '',
      channels, idempotencyKey,
    });

    // TOUJOURS 200 : l'appelant ne doit jamais échouer à cause d'une notification.
    return json(env, { ok: true, results, idempotencyKey });
  },
};
