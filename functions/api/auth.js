/**
 * /api/auth — relais d'authentification GitHub (T5 : sortir le jeton du navigateur).
 *
 * Cloudflare Pages Functions (offre gratuite). Deux façons d'ouvrir une session :
 *
 *   1. DEVICE FLOW (1 clic, aucune manipulation) — l'utilisateur saisit un code
 *      à 8 caractères sur github.com/login/device. GitHub bloque le CORS
 *      navigateur sur ces endpoints : c'est LE motif de l'existence de ce relais.
 *      Besoin d'une OAuth App / GitHub App dont le client_id est monté en variable
 *      d'environnement `GH_CLIENT_ID`. AUCUN secret : « The client_secret is not
 *      needed for the device flow » (docs GitHub).
 *
 *   2. IMPORT D'UN TOKEN EXISTANT — pour migrer les comptes qui ont déjà collé
 *      une PAT : le jeton est envoyé UNE fois ici, vérifié, puis rangé dans un
 *      cookie HttpOnly. Le navigateur n'en contient plus rien.
 *
 * Dans les deux cas le jeton de GitHub est ensuite stocké UNIQUEMENT dans le
 * cookie `hub_gh` (HttpOnly, Secure, SameSite=None). Le JS du hub ne le reçoit
 * jamais : les appels API partent de `/api/gh` (voir functions/api/gh.js) qui
 * rajoute l'en-tête Authorization côté serveur.
 *
 * Le jeton n'est jamais renvoyé au client : ni dans le corps, ni dans un log.
 *
 * Origines autorisées : liste blanche (GH_AUTH_ORIGINS + défauts). Sans cela,
 * n'importe quel site pourrait appeler ce relais avec les cookies de la victime.
 */

const GITHUB_AUTH = 'https://github.com';
const GITHUB_API  = 'https://api.github.com';

const COOKIE_NAME = 'hub_gh';
const COOKIE_AGE  = 90 * 24 * 3600;   // 90 jours (renouvelé à chaque usage)
const SCOPE       = 'repo workflow pages';  // mêmes droits que l'ancienne PAT

/** Origines admises par défaut. `http://localhost:*` sert la page de tests. */
const DEFAULT_ORIGINS = [
  'https://n7t0-of.github.io',      // hub sur GitHub Pages
  'https://souanpt-hub.pages.dev',  // hub sur Cloudflare Pages (relais inclus)
  'https://souanpthub.pages.dev',   // variante du nom de projet Pages
  'https://souanptjub.pages.dev',   // variante du nom de projet Pages
  'https://souanpt-hub.fr',         // domaine personnel
  'http://localhost:8766',
  'http://127.0.0.1:8766',
];

/* ────────────────────────── CORS ────────────────────────── */

export function allowedOrigins(env) {
  const extra = String((env && env.GH_AUTH_ORIGINS) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return new Set(DEFAULT_ORIGINS.concat(extra));
}

/** En-têtes CORS : `credentials` impose une origine EXACTE (jamais `*`). */
export function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, accept',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
  if (origin && allowedOrigins(env).has(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-credentials'] = 'true';
  }
  return h;
}

export function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    }, corsHeaders(request, env)),
  });
}

/* ─────────────────────── cookie de session ─────────────────────── */

/** Cookie → { t: token, exp?: epoch-s } | null (jamais exposé au client). */
export function readSession(request) {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  if (!hit) return null;
  try {
    const o = JSON.parse(decodeURIComponent(hit.slice(COOKIE_NAME.length + 1)));
    if (!o || typeof o.t !== 'string' || !o.t) return null;
    if (o.exp && Date.now() / 1000 > o.exp) return null;
    return o;
  } catch { return null; }
}

/**
 * Construit la valeur `Set-Cookie`. `Secure; SameSite=None` est obligatoire quand
 * le hub est servi depuis une AUTRE origine (GitHub Pages) — sur HTTP local on
 * replie sur SameSite=Lax, sinon le navigateur refuse carrément le cookie.
 */
export function sessionCookie(request, sess) {
  const https = request.url.startsWith('https:');
  return COOKIE_NAME + '=' + encodeURIComponent(JSON.stringify(sess))
    + '; Path=/; HttpOnly'
    + (https ? '; Secure; SameSite=None' : '; SameSite=Lax')
    + '; Max-Age=' + COOKIE_AGE;
}

export function clearCookie(request) {
  const https = request.url.startsWith('https:');
  return COOKIE_NAME + '=; Path=/; HttpOnly; Max-Age=0'
    + (https ? '; Secure; SameSite=None' : '; SameSite=Lax');
}

/* ────────────────────────── GitHub ────────────────────────── */

/** Profil minimal — c'est TOUT ce que le client a le droit de recevoir. */
async function ghUser(token) {
  const r = await fetch(GITHUB_API + '/user', {
    headers: {
      'authorization': 'token ' + token,
      'accept': 'application/vnd.github+json',
      'user-agent': 'souanpt-hub-relay',
    },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.login) return null;
  return { login: u.login, name: u.name || '', avatar_url: u.avatar_url || '' };
}

/** POST OAuth (form-urlencoded : format documenté par GitHub), réponse JSON. */
async function oauth(path, fields) {
  const r = await fetch(GITHUB_AUTH + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json',
      'user-agent': 'souanpt-hub-relay',
    },
    body: new URLSearchParams(fields).toString(),
  });
  return r.json().catch(() => ({}));
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/* ────────────────────────── opérations ────────────────────────── */

/** Sonde : « le relais existe-t-il ? », session éventuellement encore valide. */
async function statusOp(request, env) {
  const sess = readSession(request);
  let user = null;
  if (sess) {
    user = await ghUser(sess.t);
    if (!user) {
      // Jeton révoqué / expiré : on referme proprement.
      return new Response(JSON.stringify({ relay: true, configured: !!env.GH_CLIENT_ID, user: null }), {
        status: 200,
        headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          corsHeaders(request, env), { 'set-cookie': clearCookie(request) }),
      });
    }
  }
  return json(request, env, { relay: true, configured: !!env.GH_CLIENT_ID, user });
}

/** Étape 1 du device flow : obtient le code à saisir sur github.com/login/device. */
async function deviceOp(request, env) {
  if (!env.GH_CLIENT_ID) return json(request, env, { relay: true, configured: false }, 501);
  const data = await oauth('/login/device/code', { client_id: env.GH_CLIENT_ID, scope: SCOPE });
  if (!data.device_code || !data.user_code) {
    return json(request, env, { error: data.error || 'device_failed' }, 502);
  }
  return json(request, env, {
    relay: true,
    configured: true,
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri || 'https://github.com/login/device',
    expires_in: data.expires_in || 900,
    interval: data.interval || 5,
  });
}

/** Étape 2 : sondage jusqu'à ce que l'utilisateur ait validé le code. */
async function pollOp(request, env, raw) {
  if (!env.GH_CLIENT_ID) return json(request, env, { relay: true, configured: false }, 501);
  const deviceCode = String(raw.device_code || '');
  if (!deviceCode) return json(request, env, { error: 'device_code manquant' }, 400);

  const data = await oauth('/login/oauth/access_token', {
    client_id: env.GH_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  if (data.error) {
    const interval = data.interval || 5;
    if (data.error === 'authorization_pending') return json(request, env, { pending: true, interval });
    if (data.error === 'slow_down')             return json(request, env, { pending: true, interval: interval + 5 });
    const label = {
      expired_token: 'Code expiré — relance la connexion',
      access_denied: 'Connexion refusée sur GitHub',
      incorrect_client_credentials: 'Client ID manquant ou invalide (GH_CLIENT_ID)',
      device_flow_disabled: 'Device flow non activé dans les réglages de l\'app GitHub',
    }[data.error] || ('Erreur GitHub : ' + data.error);
    return json(request, env, { error: label, code: data.error }, 400);
  }

  const token = data.access_token;
  if (!token) return json(request, env, { error: 'Réponse GitHub incompréhensible' }, 502);

  const user = await ghUser(token);
  if (!user) return json(request, env, { error: 'Token inexploitable' }, 502);

  const sess = { t: token };
  if (data.expires_in) sess.exp = Math.floor(Date.now() / 1000) + Number(data.expires_in) - 60;
  if (data.refresh_token) sess.r = data.refresh_token;   // si l'app exige des jetons éphémères

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      corsHeaders(request, env), { 'set-cookie': sessionCookie(request, sess) }),
  });
}

/** Migration d'une PAT existante : vérifiée ici, stockée ici, vidée du navigateur. */
async function importOp(request, env, raw) {
  const token = String(raw.token || '').trim();
  if (!token) return json(request, env, { error: 'Token manquant' }, 400);
  const user = await ghUser(token);
  if (!user) return json(request, env, { error: 'Token GitHub invalide (401)' }, 401);
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      corsHeaders(request, env), { 'set-cookie': sessionCookie(request, { t: token }) }),
  });
}

/* ────────────────────────── route ────────────────────────── */

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const op = new URL(request.url).searchParams.get('op') || '';
  try {
    if (op === 'status')  return await statusOp(request, env);
    if (op === 'logout')  return new Response('{}', {
      status: 200,
      headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' },
        corsHeaders(request, env), { 'set-cookie': clearCookie(request) }),
    });
    if (request.method !== 'POST') return json(request, env, { error: 'op inconnue : ' + op }, 400);

    const raw = await body(request);
    if (op === 'device') return await deviceOp(request, env);
    if (op === 'poll')   return await pollOp(request, env, raw);
    if (op === 'import') return await importOp(request, env, raw);
    return json(request, env, { error: 'op inconnue : ' + op }, 400);
  } catch (e) {
    return json(request, env, { error: 'relais : ' + (e && e.message || 'erreur') }, 502);
  }
}
