/**
 * Cloudflare Worker — Connexion Discord → jeton Firebase (gratuit).
 * ─────────────────────────────────────────────────────────────────
 * Discord n'est pas un fournisseur OpenID : ce Worker fait le pont.
 *   /login    → redirige vers Discord (autorisation)
 *   /callback → échange le code, récupère l'utilisateur Discord,
 *               fabrique un "custom token" Firebase, renvoie l'app avec #ct=…
 *
 * Secrets à définir dans Cloudflare (Settings → Variables and Secrets) — 5 au total :
 *   DISCORD_CLIENT_ID       (ex : 1523719456768135229)
 *   DISCORD_CLIENT_SECRET   ← Discord Developer Portal → OAuth2 (jamais côté site)
 *   FIREBASE_CLIENT_EMAIL   (service account : ...@souanpt-hub.iam.gserviceaccount.com)
 *   FIREBASE_PRIVATE_KEY    (la private_key du JSON service account, collée telle quelle)
 *   APP_URL                 (URL du dashboard, ex : https://n7t0-of.github.io/souanpt-hub/app.html)
 *
 * L'URL du Worker est détectée automatiquement (plus besoin de WORKER_URL).
 * Dans le portail Discord (OAuth2 → Redirects), ajoute : https://TON-WORKER.workers.dev/callback
 */

const AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.endsWith('/login'))    return handleLogin(url, env);
      if (url.pathname.endsWith('/callback')) return await handleCallback(url, env);
      return new Response('souanpt Discord auth — /login', { status: 200 });
    } catch (e) {
      return new Response('Erreur: ' + e.message, { status: 500 });
    }
  },
};

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
  return Response.redirect(auth.toString(), 302);
}

async function handleCallback(url, env) {
  const err = needSecrets(env, ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'APP_URL']);
  if (err) return err;
  const code = url.searchParams.get('code');
  if (!code) return new Response('Code manquant — repasse par /login', { status: 400 });

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
    const t = await tokenRes.text();
    return new Response('Échange Discord refusé (' + tokenRes.status + ') — vérifie DISCORD_CLIENT_SECRET et que le redirect "' + url.origin + '/callback" est bien ajouté dans Discord → OAuth2 → Redirects.\n' + t, { status: 502 });
  }
  const { access_token } = await tokenRes.json();

  // 2) profil Discord
  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  if (!meRes.ok) return new Response('Profil Discord illisible', { status: 502 });
  const me = await meRes.json();

  // 3) jeton Firebase (custom token signé avec le service account)
  const jwt = await mintFirebaseToken(env, 'discord:' + me.id, {
    provider: 'discord',
    name: me.global_name || me.username || '',
    email: me.email || '',
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : '',
  });

  // 4) retour vers l'app avec le jeton dans le fragment (#) — jamais envoyé aux serveurs
  return Response.redirect(env.APP_URL + '#ct=' + encodeURIComponent(jwt), 302);
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
