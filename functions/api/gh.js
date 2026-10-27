/**
 * /api/gh?path=/repos/... — proxy GitHub (T5 : le jeton ne quitte jamais le relais).
 *
 * Le hub n'envoie PLUS `Authorization: …` : il appelle ce endpoint en
 * `credentials: 'include'`, et c'est ICI que l'en-tête est fabriqué à partir du
 * cookie HttpOnly `hub_gh` (posé par functions/api/auth.js).
 *
 * Conséquences, volontaires :
 *   • le jeton n'est ni lisible ni extractible par le JavaScript du navigateur ;
 *   • la portée du proxy est exactement api.github.com (pas de SSRF : la cible
 *     est reconstruite à partir d'un chemin, jamais d'une URL fournie) ;
 *   • sans cookie valide → 401, et le client bascule sur son mode dégradé.
 *
 * Seules les origines de la liste blanche peuvent l'utiliser (CORS), et toute
 * écriture exige un en-tête Origin autorisé (CSRF, voir originAllowed).
 *
 * P0 — ce n'est PAS un proxy générique : seules les opérations GitHub dont le
 * hub a besoin (ALLOWED) passent. Le jeton historique porte `repo workflow
 * pages`; sans cette liste, une requête forgée pourrait ajouter une clé de
 * déploiement, un webhook ou un collaborateur sur un dépôt de la victime.
 */

import { corsHeaders, json, originAllowed, readSession } from './auth.js';

const API = 'https://api.github.com';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/** Opérations autorisées : [méthodes, motif du chemin NORMALISÉ, sans query].
 *  Inventaire tiré des appels `GH.api` de js/core.js. HEAD suit GET. */
const SEG = '[^/]+';
const REPO = `/repos/${SEG}/${SEG}`;
export const ALLOWED = [
  [['GET'], '/user'],
  [['POST'], '/user/repos'],
  [['GET'], REPO],
  [['GET', 'PUT', 'DELETE'], `${REPO}/contents(?:/.*)?`],
  [['GET'], `${REPO}/git/ref/heads/.+`],
  [['GET'], `${REPO}/git/commits/${SEG}`],
  [['POST'], `${REPO}/git/(?:blobs|trees|commits)`],
  [['PATCH'], `${REPO}/git/refs/heads/.+`],
  [['GET', 'POST'], `${REPO}/pages`],
  [['GET'], `${REPO}/pages/builds/latest`],
  [['POST'], `${REPO}/pages/builds`],
  [['GET'], `${REPO}/actions/runs`],
  [['GET'], `${REPO}/issues`],
  [['PATCH'], `${REPO}/issues/\\d+`],
].map(([methods, pattern]) => [methods, new RegExp('^' + pattern + '$')]);

/** Vérifie l'opération sur le chemin tel que fetch l'enverra : le parseur
 *  d'URL résout `..` et `%2e%2e`, on contrôle donc le résultat, pas l'entrée. */
export function operationAllowed(method, target) {
  let url;
  try { url = new URL(target); } catch { return false; }
  if (url.origin !== API) return false;
  const m = method === 'HEAD' ? 'GET' : method;
  return ALLOWED.some(([methods, re]) => methods.includes(m) && re.test(url.pathname));
}

/** En-têtes de réponse à transmettre tels quels (pas content-encoding :
 *  le corps est lu puis ré-émit, il est déjà décompressé). Ne pas transmettre
 *  cache-control : une ref GitHub mise en cache ferait échouer le commit suivant
 *  avec « Update is not a fast forward » même après plusieurs retries. */
const PASS = [
  'content-type', 'etag', 'last-modified',
  'content-disposition', 'link',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'x-ratelimit-used', 'retry-after', 'location', 'x-github-request-id',
];

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (!METHODS.includes(request.method)) {
    return json(request, env, { error: 'méthode refusée' }, 405);
  }
  // Une origine étrangère est refusée quelle que soit la méthode; une écriture
  // sans Origin aussi (formulaire ou fetch no-cors d'un site tiers).
  const write = request.method !== 'GET' && request.method !== 'HEAD';
  if ((request.headers.get('origin') || write) && !originAllowed(request, env)) {
    return json(request, env, { error: 'origine refusée' }, 403);
  }

  const sess = readSession(request);
  if (!sess) return json(request, env, { error: 'session', hint: 'Reconnecte GitHub' }, 401);

  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  if (!path.startsWith('/')) return json(request, env, { error: 'path requis' }, 400);

  // Concaténation stricte : la cible reste api.github.com quoi qu'il arrive.
  const target = API + path;
  if (!operationAllowed(request.method, target)) {
    return json(request, env, { error: 'opération GitHub non autorisée' }, 403);
  }

  const headers = {
    'authorization': 'token ' + sess.t,
    'accept': request.headers.get('accept') || 'application/vnd.github+json',
    'user-agent': 'souanpt-hub-relay',
  };
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && !!request.body;
  // Content-Type transmis UNIQUEMENT avec un corps : GitHub refuse parfois un
  // GET « application/json » sans body (le hub l'envoie par défaut).
  const ct = hasBody ? (request.headers.get('content-type') || 'application/json') : null;
  if (ct) headers['content-type'] = ct;
  const inm = request.headers.get('if-none-match');
  if (inm) headers['if-none-match'] = inm;

  const init = { method: request.method, headers };
  if (hasBody) init.body = await request.arrayBuffer();

  let res;
  try {
    res = await fetch(target, init);
  } catch (e) {
    return json(request, env, { error: 'github injoignable' }, 502);
  }

  const buf = await res.arrayBuffer();
  const out = { 'cache-control': 'no-store' };
  for (const h of PASS) {
    const v = res.headers.get(h);
    if (v) out[h] = v;
  }
  // 401 = jeton révoqué entre-temps : le client en profite pour refermer la session.
  Object.assign(out, corsHeaders(request, env));
  return new Response(buf, { status: res.status, headers: out });
}
