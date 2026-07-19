/**
 * Cloudflare Worker — Collecte Analytics native souanpt.hub (gratuit).
 * ────────────────────────────────────────────────────────────────────
 * Reçoit les « hits » du mouchard des sites publiés (POST /hit) et écrit des
 * AGRÉGATS dans Firestore via le compte de service (écritures 100% serveur —
 * aucune écriture publique n'est autorisée côté Firestore).
 *
 * Détecte le pays (request.cf.country, gratuit) et l'appareil (User-Agent).
 * Déduplication des visiteurs uniques côté client (par jour).
 * Le référent n'est NI envoyé par le traqueur NI stocké (section « Sources »
 * retirée du dashboard).
 *
 * Secrets (Settings → Variables and Secrets) — mêmes que le Worker Discord :
 *   FIREBASE_CLIENT_EMAIL  (…@souanpt-hub.iam.gserviceaccount.com)
 *   FIREBASE_PRIVATE_KEY   (private_key du JSON service account)
 *   FIREBASE_PROJECT_ID    (optionnel — déduit sinon du client_email : souanpt-hub)
 *
 * Modèle écrit (lu par Cloud.loadAnalytics) :
 *   users/{uid}/analytics/summary   { views, visitors, clicks }
 *   users/{uid}/analytics/daily     { days: { 'YYYY-MM-DD': {views, visitors} } }
 *   users/{uid}/analytics/devices   { map: { desktop, mobile, tablet } }
 *   users/{uid}/analytics/countries { map: { FR, BE, … } }  (codes ISO)
 *   users/{uid}/analytics/projects  { map: { '<titre>': {views, clicks} } }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const noContent = () => new Response(null, { status: 204, headers: CORS });
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.endsWith('/hit')) {
      if (request.method !== 'POST') return json({ ok: true, ready: true }, 200);
      env = trimEnv(env);
      const miss = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(k => !env[k]);
      if (miss.length) return json({ ok: false, error: 'secrets manquants: ' + miss.join(', ') }, 500);
      try { return await handleHit(request, env); }
      catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
    }
    return new Response('souanpt analytics — POST /hit', { status: 200, headers: CORS });
  },
};

function trimEnv(env) {
  const out = {};
  for (const k of ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_PROJECT_ID']) out[k] = env[k] ? String(env[k]).trim() : env[k];
  return out;
}

/* Le référent (« Sources ») n'est plus ni classé ni stocké : la section a été
   retirée du dashboard, donc plus rien ne le consommait. On arrête de le
   collecter — c'est la donnée la plus sensible du lot (elle révèle le parcours
   du visiteur) et une donnée non collectée n'a besoin ni d'être protégée ni
   d'être déclarée. Les anciens documents `referrers` restent en base : ils ne
   sont plus alimentés ni lus. */
function device(ua) {
  ua = ua || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

async function handleHit(request, env) {
  let body = {};
  try { body = JSON.parse(await request.text()); } catch (e) {}
  const uid = String(body.uid || '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 128);
  if (!uid) return json({ ok: false, error: 'uid' }, 400);
  const t = body.t;
  const day = new Date().toISOString().slice(0, 10);
  const cc = ((request.cf && request.cf.country) || 'XX').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase() || 'XX';
  const dev = device(String(body.ua || request.headers.get('user-agent') || ''));

  const T = [];
  if (t === 'pv') {
    const summary = [inc('views', 1)];
    const daily = [inc('days.' + fp(day) + '.views', 1)];
    if (body.u) { summary.push(inc('visitors', 1)); daily.push(inc('days.' + fp(day) + '.visitors', 1)); }
    T.push({ name: 'summary', fields: summary });
    T.push({ name: 'daily', fields: daily });
    T.push({ name: 'devices', fields: [inc('map.' + dev, 1)] });
    T.push({ name: 'countries', fields: [inc('map.' + cc, 1)] });
  } else if (t === 'pj') {
    const ps = Array.isArray(body.projects) ? body.projects.slice(0, 40) : [];
    if (!ps.length) return noContent();
    T.push({ name: 'projects', fields: ps.map(p => inc('map.' + fp(String(p).slice(0, 120)) + '.views', 1)) });
  } else if (t === 'click') {
    T.push({ name: 'summary', fields: [inc('clicks', 1)] });
    if (body.project) T.push({ name: 'projects', fields: [inc('map.' + fp(String(body.project).slice(0, 120)) + '.clicks', 1)] });
  } else {
    return json({ ok: false, error: 't' }, 400);
  }

  await commit(env, uid, T);
  return noContent();
}

/* ── Firestore REST : increments atomiques via le compte de service ── */
function projId(env) {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  try { return env.FIREBASE_CLIENT_EMAIL.split('@')[1].split('.')[0]; } catch (e) { return 'souanpt-hub'; }
}
function inc(fieldPath, n) { return { fieldPath, increment: { integerValue: String(n) } }; }
function fp(seg) { return '`' + String(seg).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'; } // segment de champ échappé

async function commit(env, uid, transforms) {
  const token = await getAccessToken(env);
  const base = `projects/${projId(env)}/databases/(default)/documents/users/${uid}/analytics/`;
  const writes = transforms.map(t => ({ transform: { document: base + t.name, fieldTransforms: t.fields } }));
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projId(env)}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) throw new Error('commit ' + res.status + ' ' + (await res.text()).slice(0, 300));
}

let _tok = null;
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && _tok.exp - 60 > now) return _tok.access_token;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const assertion = data + '.' + b64urlBytes(new Uint8Array(sig));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error('token ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  _tok = { access_token: j.access_token, exp: now + (j.expires_in || 3600) };
  return _tok.access_token;
}

function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function importPrivateKey(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der;
  try { der = Uint8Array.from(atob(body), c => c.charCodeAt(0)); }
  catch (e) { throw new Error('FIREBASE_PRIVATE_KEY invalide'); }
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
