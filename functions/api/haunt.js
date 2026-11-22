/**
 * /api/haunt?op=… — relais vers l'API ImageHost de haunt.gg (v3.17).
 *
 * Pourquoi un relais : l'API haunt.gg ne renvoie aucun en-tête CORS, un
 * navigateur refuse donc de l'appeler directement depuis le hub.
 *
 * La clé haunt.gg appartient à l'utilisateur : elle vit sur SON appareil
 * (localStorage `souanpt_haunt_v1`, hors sauvegarde), arrive ici dans
 * l'en-tête `x-haunt-key` et repart vers haunt.gg en `X-API-Key`. Ce relais
 * ne la stocke pas, ne la journalise pas et ne la met jamais dans une URL.
 *
 * Ce n'est PAS un proxy générique : la cible est reconstruite ici (jamais
 * prise du client) et seules trois opérations passent :
 *   op=uploads  GET     liste des fichiers (paramètres filtrés)
 *   op=upload   POST    envoi d'un fichier (multipart transmis tel quel)
 *   op=delete   DELETE  suppression d'un fichier par id
 * Toute requête exige une origine de la liste blanche (CSRF / usage tiers).
 */

import { corsHeaders, originAllowed } from './auth.js';

export const API = 'https://haunt.gg/api/imagehost';
export const KEY_RE = /^haunt_[A-Za-z0-9]{16,80}$/;
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_UPLOAD = 75 * 1024 * 1024;   // offre gratuite haunt.gg : 75 Mo par fichier

const LIST_PARAMS = {
  limit: v => /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 100,
  offset: v => /^\d{1,6}$/.test(v) && +v <= 100000,
  type: v => ['all', 'image', 'video', 'audio', 'other'].includes(v),
  sort: v => ['uploadAt', 'fileSize', 'viewCount', 'favorite'].includes(v),
  order: v => v === 'asc' || v === 'desc',
  search: v => v.length <= 100,
  favoriteOnly: v => v === 'true' || v === 'false',
};

/** Opération demandée → { method, target } ou null (refus). */
export function route(method, params) {
  const op = params.get('op');
  if (op === 'uploads' && method === 'GET') {
    const q = new URLSearchParams();
    for (const [k, ok] of Object.entries(LIST_PARAMS)) {
      const v = params.get(k);
      if (v === null) continue;
      if (!ok(v)) return null;
      q.set(k, v);
    }
    return { method, target: API + '/uploads' + (q.toString() ? '?' + q : '') };
  }
  if (op === 'upload' && method === 'POST') return { method, target: API + '/upload' };
  if (op === 'delete' && method === 'DELETE') {
    const id = params.get('id') || '';
    return ID_RE.test(id) ? { method, target: API + '/uploads/' + encodeURIComponent(id) } : null;
  }
  return null;
}

function headers(request, env, extra) {
  const h = corsHeaders(request, env);
  h['access-control-allow-headers'] = 'content-type, accept, x-haunt-key';
  h['access-control-allow-methods'] = 'GET, POST, DELETE, OPTIONS';
  return Object.assign(h, { 'cache-control': 'no-store' }, extra || {});
}
function fail(request, env, status, error, code) {
  return new Response(JSON.stringify({ error, code }), {
    status, headers: headers(request, env, { 'content-type': 'application/json; charset=utf-8' }),
  });
}

const PASS = ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request, env) });
  if (!originAllowed(request, env)) return fail(request, env, 403, 'origine refusée', 'ORIGIN');

  const key = request.headers.get('x-haunt-key') || '';
  if (!KEY_RE.test(key)) return fail(request, env, 401, 'clé haunt.gg manquante ou invalide', 'NO_KEY');

  const r = route(request.method, new URL(request.url).searchParams);
  if (!r) return fail(request, env, 400, 'opération non autorisée', 'OP');

  const init = { method: r.method, headers: { 'x-api-key': key, 'accept': 'application/json', 'user-agent': 'souanpt-hub-relay' } };
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) init.headers['x-forwarded-for'] = ip;
  if (r.method === 'POST') {
    const ct = request.headers.get('content-type') || '';
    if (!/^multipart\/form-data;\s*boundary=/i.test(ct)) return fail(request, env, 400, 'envoi multipart attendu', 'BODY');
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_UPLOAD + 64 * 1024) return fail(request, env, 413, 'fichier trop lourd (75 Mo max)', 'FILE_TOO_LARGE');
    init.headers['content-type'] = ct;
    init.body = await request.arrayBuffer();
    if (init.body.byteLength > MAX_UPLOAD + 64 * 1024) return fail(request, env, 413, 'fichier trop lourd (75 Mo max)', 'FILE_TOO_LARGE');
  }

  let res;
  try { res = await fetch(r.target, init); }
  catch { return fail(request, env, 502, 'haunt.gg injoignable', 'UPSTREAM'); }

  const out = headers(request, env);
  for (const h of PASS) { const v = res.headers.get(h); if (v) out[h] = v; }
  return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
}
