/**
 * Cloudflare Worker — Stockage de fichiers souanpt.hub (Cloudflare R2).
 * ────────────────────────────────────────────────────────────────────
 * R2 n'a PAS de règles d'accès natives : ce Worker les applique.
 *   PUT    /up?v=public|private&name=…   → upload (auth Firebase requise)
 *   GET    /f/<clé>                       → lecture (public ouvert ; privé = token du propriétaire)
 *   DELETE /f/<clé>                       → suppression (propriétaire only)
 *
 * Clé d'objet : <pub|prv>/<uid>/<id>/<nom>. La visibilité EST le préfixe → un
 * fichier privé (prv/) n'est jamais servi sans un jeton Firebase du propriétaire.
 * Les métadonnées riches (dossier, tags, usages, versions…) vivent dans Firestore
 * côté app — ce Worker ne gère QUE les octets + l'accès.
 *
 * Binding requis (wrangler.r2.toml) : [[r2_buckets]] binding = "BUCKET".
 * Variable :  FIREBASE_PROJECT_ID = "souanpt-hub".
 * Aucun secret : la vérification du jeton utilise les clés PUBLIQUES de Firebase.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Extensions refusées (jamais stockées, quelle que soit la visibilité).
const BLOCKED_EXT = ['exe', 'msi', 'bat', 'cmd', 'scr', 'com', 'js', 'jse', 'vbs', 'ps1', 'sh', 'jar', 'dll'];
const MAX_BYTES = 60 * 1024 * 1024;   // 60 Mo / fichier (v1)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    try {
      if (path === 'up' && request.method === 'PUT') return await handleUpload(request, env, url);
      if (path.startsWith('f/')) {
        const key = decodeURIComponent(path.slice(2));
        if (request.method === 'GET') return await handleGet(request, env, key);
        if (request.method === 'DELETE') return await handleDelete(request, env, key);
      }
      if (path === '' || path === 'health') return json({ ok: true, service: 'souanpt-r2' });
      return json({ ok: false, error: 'route' }, 404);
    } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
  },
};

/* ── clé propre ── */
function safeName(n) { return String(n || 'fichier').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'fichier'; }
function extOf(n) { const m = String(n || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }

/* ── upload ── */
async function handleUpload(request, env, url) {
  const uid = await requireUser(request, env);
  if (!uid) return json({ ok: false, error: 'auth' }, 401);
  const vis = url.searchParams.get('v') === 'public' ? 'pub' : 'prv';   // privé par défaut
  const name = safeName(url.searchParams.get('name') || request.headers.get('X-File-Name') || 'fichier');
  const ext = extOf(name);
  if (BLOCKED_EXT.includes(ext)) return json({ ok: false, error: 'Type de fichier interdit : .' + ext }, 415);
  const len = parseInt(request.headers.get('Content-Length') || '0');
  if (len > MAX_BYTES) return json({ ok: false, error: 'Fichier trop lourd (max 60 Mo)' }, 413);
  const id = crypto.randomUUID().slice(0, 12);
  const key = `${vis}/${uid}/${id}/${name}`;
  await env.BUCKET.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
    customMetadata: { owner: uid, uploadedAt: String(Date.now()) },
  });
  return json({ ok: true, id, key, visibility: vis === 'pub' ? 'public' : 'private', url: url.origin + '/f/' + encodeURI(key) });
}

/* ── lecture ── */
async function handleGet(request, env, key) {
  const priv = key.startsWith('prv/');
  if (priv) {                              // fichier privé → propriétaire uniquement
    const uid = await requireUser(request, env);
    if (!uid || key.split('/')[1] !== uid) return json({ ok: false, error: 'Accès refusé' }, 403);
  } else if (!key.startsWith('pub/')) {
    return json({ ok: false, error: 'clé' }, 400);
  }
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ ok: false, error: 'introuvable' }, 404);
  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('Cache-Control', priv ? 'private, no-store' : 'public, max-age=86400');
  return new Response(obj.body, { headers: h });
}

/* ── suppression ── */
async function handleDelete(request, env, key) {
  const uid = await requireUser(request, env);
  if (!uid || key.split('/')[1] !== uid) return json({ ok: false, error: 'Accès refusé' }, 403);
  await env.BUCKET.delete(key);
  return json({ ok: true });
}

/* ══ Vérification du jeton Firebase (clés PUBLIQUES, aucun secret) ══ */
let _jwks = null, _jwksExp = 0;
async function firebaseKeys() {
  const now = Date.now();
  if (_jwks && _jwksExp > now) return _jwks;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const data = await res.json();
  _jwks = {}; (data.keys || []).forEach(k => { _jwks[k.kid] = k; });
  const cc = res.headers.get('cache-control') || ''; const m = cc.match(/max-age=(\d+)/);
  _jwksExp = now + (m ? parseInt(m[1]) * 1000 : 3600000);
  return _jwks;
}
function b64urlToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
/** Renvoie l'uid si le jeton est valide (signature + aud + iss + exp), sinon null. */
async function requireUser(request, env) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tok) return null;
    const [h, p, s] = tok.split('.');
    if (!h || !p || !s) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    const proj = (env.FIREBASE_PROJECT_ID || 'souanpt-hub').trim();
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== proj) return null;
    if (payload.iss !== 'https://securetoken.google.com/' + proj) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (!payload.sub) return null;
    const jwk = (await firebaseKeys())[header.kid];
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(h + '.' + p));
    return ok ? payload.sub : null;
  } catch (e) { return null; }
}
