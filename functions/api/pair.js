/**
 * /api/pair?op=… — connexion d'un téléphone depuis un ordinateur déjà connecté (v3.23).
 *
 * Principe (comme WhatsApp Web, mais dans le sens PC → téléphone) :
 *   1. create   (PC connecté)  : crée un appairage de 2 min. Le QR contient
 *                                 `…/app#pair=<id>.<secret>` — le secret est après
 *                                 le « # » : jamais envoyé dans une URL au serveur,
 *                                 jamais dans un journal. AUCUN jeton n'est stocké.
 *   2. claim    (téléphone)    : présente id + secret, reçoit un nonce privé.
 *   3. status   (PC)           : voit qu'un appareil (« iPhone · Safari ») attend.
 *   4. approve / deny (PC)     : l'utilisateur AUTORISE explicitement. C'est
 *                                 seulement là que le jeton GitHub du PC est déposé
 *                                 (pour quelques secondes) dans l'appairage.
 *   5. redeem   (téléphone)    : avec son nonce, reçoit son propre cookie de
 *                                 session HttpOnly ; l'appairage est supprimé.
 * Le jeton n'apparaît jamais dans une réponse, un QR ou une URL.
 *
 * Stockage : espace KV Cloudflare lié sous le nom `HUB_PAIR` (TTL ≤ 120 s).
 * Sans lui, toutes les opérations répondent 501 { code: 'NO_KV' }.
 */

import { corsHeaders, originAllowed, readSession, sessionCookie } from './auth.js';

const TTL = 120;                         // durée de vie d'un appairage (s)
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{24,96}$/;

const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha(s) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))))); }
/** Comparaison à temps constant de deux empreintes. */
export function same(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** Libellé d'appareil affiché au PC : court, sans caractère de contrôle. */
export function deviceLabel(v) {
  return String(v || 'Appareil').replace(/[\u0000-\u001f<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Appareil';
}

function headers(request, env, extra) {
  const h = corsHeaders(request, env);
  h['access-control-allow-headers'] = 'content-type, accept, x-hub-token';
  h['access-control-allow-methods'] = 'POST, OPTIONS';
  return Object.assign(h, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra || {});
}
const reply = (request, env, data, status = 200, extra) => new Response(JSON.stringify(data), { status, headers: headers(request, env, extra) });

async function ghUser(token) {
  const r = await fetch('https://api.github.com/user', { headers: { authorization: 'token ' + token, accept: 'application/vnd.github+json', 'user-agent': 'souanpt-hub-relay' } });
  if (!r.ok) return null;
  const u = await r.json();
  return { login: u.login, name: u.name || '', avatar_url: u.avatar_url || '' };
}

/** Jeton du PC : cookie de session du relais, sinon jeton local envoyé en en-tête (mode historique). */
async function pcIdentity(request) {
  const sess = readSession(request);
  let token = sess && sess.t;
  if (!token) {
    const h = request.headers.get('x-hub-token') || '';
    if (/^(gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/.test(h)) token = h;
  }
  if (!token) return null;
  const user = await ghUser(token);
  return user ? { token, user } : null;
}

async function load(env, id) { return ID_RE.test(id) ? await env.HUB_PAIR.get('pair:' + id, { type: 'json' }) : null; }
async function save(env, id, rec) {
  const left = Math.max(60, Math.ceil((rec.exp - Date.now()) / 1000));   // KV : TTL minimum 60 s
  await env.HUB_PAIR.put('pair:' + id, JSON.stringify(rec), { expirationTtl: left });
}

export async function onRequest(context) {
  const { request } = context;
  const env = context.env || {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request, env) });
  if (request.method !== 'POST') return reply(request, env, { error: 'méthode refusée' }, 405);
  if (!originAllowed(request, env)) return reply(request, env, { error: 'origine refusée', code: 'ORIGIN' }, 403);
  if (!env.HUB_PAIR || typeof env.HUB_PAIR.get !== 'function') return reply(request, env, { error: 'connexion par QR non configurée sur ce serveur', code: 'NO_KV' }, 501);

  const op = new URL(request.url).searchParams.get('op') || '';
  let body = {};
  try { body = await request.json(); } catch {}
  const id = String(body.id || '');
  const now = Date.now();

  /* ── côté PC ── */
  if (op === 'create') {
    const pc = await pcIdentity(request);
    if (!pc) return reply(request, env, { error: 'connecte-toi d\'abord sur cet ordinateur', code: 'AUTH' }, 401);
    const newId = randomToken(18), secret = randomToken(24);
    await save(env, newId, { st: 'waiting', login: pc.user.login, sh: await sha(secret), exp: now + TTL * 1000, at: now });
    return reply(request, env, { id: newId, secret, ttl: TTL });
  }
  if (op === 'status' || op === 'approve' || op === 'deny') {
    const pc = await pcIdentity(request);
    if (!pc) return reply(request, env, { error: 'session expirée', code: 'AUTH' }, 401);
    const rec = await load(env, id);
    if (!rec || rec.exp < now) return reply(request, env, { st: 'expired' });
    if (rec.login !== pc.user.login) return reply(request, env, { error: 'appairage d\'un autre compte', code: 'FORBIDDEN' }, 403);
    if (op === 'status') return reply(request, env, { st: rec.st, device: rec.device || '' });
    if (rec.st !== 'claimed') return reply(request, env, { error: 'aucun appareil en attente', code: 'STATE', st: rec.st }, 409);
    if (op === 'deny') { await save(env, id, { ...rec, st: 'denied', t: undefined }); return reply(request, env, { st: 'denied' }); }
    // Autorisation explicite : le jeton est déposé pour le seul détenteur du nonce, 60 s max.
    await save(env, id, { ...rec, st: 'approved', t: pc.token, exp: Math.min(rec.exp + 30000, now + 60000) });
    return reply(request, env, { st: 'approved' });
  }

  /* ── côté téléphone ── */
  if (op === 'claim') {
    const secret = String(body.secret || '');
    if (!SECRET_RE.test(secret)) return reply(request, env, { error: 'QR code invalide', code: 'INVALID' }, 400);
    const rec = await load(env, id);
    if (!rec || rec.exp < now) return reply(request, env, { error: 'QR code expiré — génères-en un nouveau sur l\'ordinateur', code: 'EXPIRED' }, 410);
    if (!same(await sha(secret), rec.sh)) return reply(request, env, { error: 'QR code invalide', code: 'INVALID' }, 400);
    if (rec.st !== 'waiting') return reply(request, env, { error: 'QR code déjà utilisé', code: 'USED' }, 409);
    const nonce = randomToken(24);
    await save(env, id, { ...rec, st: 'claimed', nh: await sha(nonce), device: deviceLabel(body.device), claimedAt: now });
    return reply(request, env, { nonce, login: rec.login });
  }
  if (op === 'redeem') {
    const nonce = String(body.nonce || '');
    if (!SECRET_RE.test(nonce)) return reply(request, env, { error: 'requête invalide', code: 'INVALID' }, 400);
    const rec = await load(env, id);
    if (!rec || rec.exp < now) return reply(request, env, { error: 'délai dépassé', code: 'EXPIRED' }, 410);
    if (!rec.nh || !same(await sha(nonce), rec.nh)) return reply(request, env, { error: 'requête invalide', code: 'INVALID' }, 403);
    if (rec.st === 'claimed') return reply(request, env, { pending: true });
    if (rec.st === 'denied') { await env.HUB_PAIR.delete('pair:' + id); return reply(request, env, { error: 'connexion refusée sur l\'ordinateur', code: 'DENIED' }, 403); }
    if (rec.st !== 'approved' || !rec.t) return reply(request, env, { error: 'état inattendu', code: 'STATE' }, 409);
    await env.HUB_PAIR.delete('pair:' + id);           // usage unique
    const user = await ghUser(rec.t);
    if (!user) return reply(request, env, { error: 'session de l\'ordinateur expirée', code: 'AUTH' }, 401);
    return reply(request, env, { user }, 200, { 'set-cookie': sessionCookie(request, { t: rec.t }) });
  }
  return reply(request, env, { error: 'opération inconnue', code: 'OP' }, 400);
}
