/**
 * Cloudflare Worker — Connexion Discord → jeton Firebase (gratuit).
 * ─────────────────────────────────────────────────────────────────
 * Discord n'est pas un fournisseur OpenID : ce Worker fait le pont.
 *   /login    → redirige vers Discord (autorisation)
 *   /callback → échange le code, récupère l'utilisateur Discord,
 *               fabrique un "custom token" Firebase, renvoie l'app avec #ct=…
 *
 * Secrets à définir dans Cloudflare (Settings → Variables and Secrets) — 4 obligatoires :
 *   DISCORD_CLIENT_ID       (ex : 1523719456768135229)
 *   DISCORD_CLIENT_SECRET   ← Discord Developer Portal → OAuth2 (jamais côté site)
 *   FIREBASE_CLIENT_EMAIL   (service account : ...@souanpt-hub.iam.gserviceaccount.com)
 *   FIREBASE_PRIVATE_KEY    (la private_key du JSON service account, collée telle quelle)
 *   APP_URL                 (OPTIONNEL — simple secours : le retour suit automatiquement
 *                            le site qui a lancé la connexion, via le paramètre "return")
 *
 * L'URL du Worker est détectée automatiquement (plus besoin de WORKER_URL).
 * Dans le portail Discord (OAuth2 → Redirects), ajoute : https://TON-WORKER.workers.dev/callback
 */

const AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

// Sites autorisés à recevoir le jeton (anti-vol : jamais de redirection ailleurs).
// Ajoute ici ton futur domaine perso (ex : 'https://hub.souanpt.fr').
const ALLOWED_RETURNS = [
  'https://souanptjub.pages.dev',   // V2 — hub officiel (Cloudflare Pages)
  'http://localhost:5180',          // tests locaux
];

/** Valide l'URL de retour ; sinon retombe sur APP_URL puis sur la V2 officielle */
function safeReturn(raw, env) {
  try {
    const u = new URL(raw);
    const ok = ALLOWED_RETURNS.some(o => u.origin === o)
            || (env.APP_URL && u.origin === new URL(env.APP_URL).origin);
    if (ok) return u.origin + u.pathname;
  } catch {}
  return env.APP_URL || (ALLOWED_RETURNS[0] + '/app.html');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    env = trimEnv(env);   // nettoie espaces/tabulations collés par erreur dans les secrets
    try {
      if (url.pathname.endsWith('/login'))    return handleLogin(url, env);
      if (url.pathname.endsWith('/callback')) return await handleCallback(request, url, env);
      return new Response('souanpt Discord auth — /login', { status: 200 });
    } catch (e) {
      console.error('[discord-auth] callback failed', e && e.name || 'Error');
      const headers = { 'cache-control': 'no-store' };
      if (url.pathname.endsWith('/callback')) headers['set-cookie'] = clearOAuthStateCookie(url);
      return new Response('Connexion indisponible — réessaie depuis /login', {
        status: 500, headers,
      });
    }
  },
};

function trimEnv(env) {
  const out = {};
  for (const k of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'APP_URL']) {
    out[k] = env[k] ? String(env[k]).trim() : env[k];
  }
  return out;
}

/* Vérifie que les secrets nécessaires sont posés ; sinon message clair */
function needSecrets(env, keys) {
  const missing = keys.filter(k => !env[k]);
  if (!missing.length) return null;
  return new Response(
    'Configuration incomplète — ajoute dans le Worker (Settings → Variables and Secrets) : '
    + missing.join(', '), { status: 500 });
}

function handleLogin(url, env) {
  const err = needSecrets(env, ['DISCORD_CLIENT_ID']);
  if (err) return err;
  const auth = new URL('https://discord.com/oauth2/authorize');
  auth.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('redirect_uri', url.origin + '/callback');
  auth.searchParams.set('scope', 'identify email');
  // OAuth state lie le callback à cette demande précise. Le retour est déjà
  // filtré par safeReturn(); le nonce est aussi conservé en cookie HttpOnly.
  const returnTo = safeReturn(url.searchParams.get('return') || '', env);
  const nonce = b64urlBytes(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(JSON.stringify({ nonce, returnTo }));
  auth.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      'cache-control': 'no-store',
      'set-cookie': oauthStateCookie(url, nonce),
    },
  });
}

function oauthStateCookie(url, nonce) {
  return 'discord_oauth_state=' + encodeURIComponent(nonce)
    + '; Path=/callback; HttpOnly; SameSite=Lax; Max-Age=600'
    + (url.protocol === 'https:' ? '; Secure' : '');
}

function clearOAuthStateCookie(url) {
  return 'discord_oauth_state=; Path=/callback; HttpOnly; SameSite=Lax; Max-Age=0'
    + (url.protocol === 'https:' ? '; Secure' : '');
}

function readOAuthState(request, url) {
  const encoded = url.searchParams.get('state') || '';
  let state;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
    state = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
  const rawCookie = request.headers.get('cookie') || '';
  const hit = rawCookie.split(';').map(s => s.trim()).find(s => s.startsWith('discord_oauth_state='));
  if (!state || typeof state.nonce !== 'string' || !state.nonce || !hit) return null;
  let cookieNonce = '';
  try { cookieNonce = decodeURIComponent(hit.slice('discord_oauth_state='.length)); } catch { return null; }
  if (cookieNonce !== state.nonce || typeof state.returnTo !== 'string') return null;
  return state;
}

async function handleCallback(request, url, env) {
  const state = readOAuthState(request, url);
  if (!state) return new Response('Connexion expirée ou invalide — repasse par /login', {
    status: 400,
    headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
  });
  if (url.searchParams.has('error')) return new Response('Connexion Discord annulée — repasse par /login', {
    status: 400,
    headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
  });
  const err = needSecrets(env, ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']);
  if (err) return new Response(err.body, {
    status: err.status, headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
  });
  const code = url.searchParams.get('code');
  if (!code) return new Response('Code manquant — repasse par /login', {
    status: 400,
    headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
  });

  // 1) code → access token Discord
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: url.origin + '/callback',
    }),
  });
  if (!tokenRes.ok) {
    return new Response('Échange Discord refusé — vérifie la configuration OAuth puis réessaie.', {
      status: 502,
      headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
    });
  }
  const { access_token } = await tokenRes.json();

  // 2) profil Discord
  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  if (!meRes.ok) return new Response('Profil Discord illisible', {
    status: 502,
    headers: { 'cache-control': 'no-store', 'set-cookie': clearOAuthStateCookie(url) },
  });
  const me = await meRes.json();

  // 3) jeton Firebase (custom token signé avec le service account)
  const jwt = await mintFirebaseToken(env, 'discord:' + me.id, {
    provider: 'discord',
    name: me.global_name || me.username || '',
    email: me.email || '',
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : '',
  });

  // 4) retour vers le site qui a lancé la connexion (validé), jeton dans le fragment (#)
  const dest = safeReturn(state.returnTo, env);
  return new Response(null, {
    status: 302,
    headers: {
      location: dest + '#ct=' + encodeURIComponent(jwt),
      'cache-control': 'no-store',
      'set-cookie': clearOAuthStateCookie(url),
    },
  });
}

/* ── Fabrication du custom token Firebase (JWT RS256) ── */
async function mintFirebaseToken(env, uid, claims) {
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL, aud: AUD,
    iat, exp: iat + 3600, uid, claims,
  };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  return data + '.' + b64urlBytes(new Uint8Array(sig));
}

function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function importPrivateKey(pem) {
  // tolère la clé collée avec des "\n" littéraux (copiée depuis le JSON) ou de vrais retours à la ligne
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der;
  try { der = Uint8Array.from(atob(body), c => c.charCodeAt(0)); }
  catch { throw new Error('FIREBASE_PRIVATE_KEY invalide — colle la valeur "private_key" du JSON service account, en entier'); }
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
