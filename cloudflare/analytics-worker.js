/**
 * Public analytics ingestion. All writes fail closed until Cloudflare rate
 * limit bindings, the Durable Object guard, Firebase credentials, and the
 * explicit ingest flag are configured.
 */
const API = 'https://firestore.googleapis.com/v1';
const MAX_BODY_BYTES = 4096;
const MAX_PROJECTS_PER_EVENT = 20;
const MAX_PROJECT_NAME = 80;
const MAX_DAILY_PROFILE_EVENTS = 5000;
const MAX_DAILY_PROFILE_IP_EVENTS = 120;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
});
const noContent = () => new Response(null, { status: 204, headers: CORS });

function ready(env) {
  return env.ANALYTICS_INGEST_ENABLED === 'true'
    && !!env.ANALYTICS_RATE_LIMITER
    && !!env.ANALYTICS_GUARD
    && !!env.ANALYTICS_IP_SALT
    && !!env.FIREBASE_CLIENT_EMAIL
    && !!env.FIREBASE_PRIVATE_KEY;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/status' && request.method === 'GET') {
      return json({ enabled: ready(env), reason: ready(env) ? null : 'security_setup_required' });
    }
    if (url.pathname !== '/hit') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!ready(env)) return json({ error: 'analytics_temporarily_unavailable' }, 503);

    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) return json({ error: 'request_rejected' }, 400);
    try {
      const ipLimit = await env.ANALYTICS_RATE_LIMITER.limit({ key: 'ip:' + ip });
      if (!ipLimit.success) return json({ error: 'rate_limited' }, 429);

      const raw = await readBody(request);
      const event = parseEvent(raw);
      if (!event) return json({ error: 'invalid_event' }, 400);

      const uidLimit = await env.ANALYTICS_RATE_LIMITER.limit({ key: 'profile:' + event.uid });
      if (!uidLimit.success) return json({ error: 'rate_limited' }, 429);

      const token = await getAccessToken(env);
      const profile = await readPublicProfile(env, token, event.uid);
      if (!profile) return json({ error: 'profile_not_eligible' }, 403);

      const ipHash = await hash(env.ANALYTICS_IP_SALT + ':' + ip);
      const guardId = env.ANALYTICS_GUARD.idFromName(event.uid);
      const guard = env.ANALYTICS_GUARD.get(guardId);
      const guarded = await guard.fetch('https://analytics-guard/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.eid,
          ipHash,
          day: new Date().toISOString().slice(0, 10),
          projects: event.t === 'pj' ? event.projects : event.t === 'click' && event.project ? [event.project] : [],
        }),
      });
      if (!guarded.ok) return json({ error: guarded.status === 429 ? 'quota_exceeded' : 'analytics_temporarily_unavailable' }, guarded.status);
      const verdict = await guarded.json();
      if (verdict.duplicate) return noContent();

      await commit(env, token, event.uid, toTransforms(event, request));
      return noContent();
    } catch (error) {
      // Never return Google/Firebase response bodies or secrets to a public caller.
      console.error('[analytics] request failed', error && error.name || 'Error');
      if (error && error.message === 'body_too_large') return json({ error: 'body_too_large' }, 413);
      if (error && (error.message === 'body_missing' || error.name === 'TypeError')) return json({ error: 'invalid_event' }, 400);
      return json({ error: 'analytics_temporarily_unavailable' }, 503);
    }
  },
};

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('body_too_large');
  if (!request.body) throw new Error('body_missing');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseEvent(raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return null; }
  if (!body || Array.isArray(body) || typeof body !== 'object') return null;
  const uid = body.uid;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) return null;
  if (typeof body.eid !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(body.eid)) return null;
  const allowed = body.t === 'pv' ? ['uid', 'eid', 't', 'u', 'ua']
    : body.t === 'pj' ? ['uid', 'eid', 't', 'projects']
      : body.t === 'click' ? ['uid', 'eid', 't', 'project'] : null;
  if (!allowed || Object.keys(body).some(key => !allowed.includes(key))) return null;

  if (body.t === 'pv') {
    if (body.u !== undefined && body.u !== 0 && body.u !== 1) return null;
    if (body.ua !== undefined && (typeof body.ua !== 'string' || body.ua.length > 256)) return null;
    return { uid, eid: body.eid, t: 'pv', unique: body.u === 1, ua: body.ua || '' };
  }
  if (body.t === 'pj') {
    if (!Array.isArray(body.projects) || body.projects.length < 1 || body.projects.length > MAX_PROJECTS_PER_EVENT) return null;
    const projects = [...new Set(body.projects)];
    if (projects.length !== body.projects.length || projects.some(p => typeof p !== 'string' || p.length < 1 || p.length > MAX_PROJECT_NAME)) return null;
    return { uid, eid: body.eid, t: 'pj', projects };
  }
  if (body.project !== undefined && (typeof body.project !== 'string' || body.project.length < 1 || body.project.length > MAX_PROJECT_NAME)) return null;
  return { uid, eid: body.eid, t: 'click', project: body.project || '' };
}

async function readPublicProfile(env, token, uid) {
  const project = projectId(env);
  const path = `${API}/projects/${encodeURIComponent(project)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const response = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('profile_lookup_failed');
  const doc = await response.json();
  const f = doc.fields || {};
  const pseudo = f.pseudo && f.pseudo.stringValue;
  const siteUrl = f.siteUrl && f.siteUrl.stringValue;
  let publicUrl = null;
  try { publicUrl = new URL(siteUrl); } catch {}
  return f.analyticsEnabled?.booleanValue === true
    && (f.uid?.stringValue === uid || f.owner?.stringValue === uid)
    && typeof pseudo === 'string' && /^[a-z0-9_-]{2,20}$/.test(pseudo)
    && publicUrl && publicUrl.protocol === 'https:' && !publicUrl.username && !publicUrl.password
    ? { pseudo, siteUrl: publicUrl.href } : null;
}

function toTransforms(event, request) {
  const country = ((request.cf && request.cf.country) || 'XX').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase() || 'XX';
  const type = device(event.ua || request.headers.get('user-agent') || '');
  if (event.t === 'pv') {
    const summary = [increment('views')];
    const daily = [increment('days.' + field(new Date().toISOString().slice(0, 10)) + '.views')];
    if (event.unique) { summary.push(increment('visitors')); daily.push(increment('days.' + field(new Date().toISOString().slice(0, 10)) + '.visitors')); }
    return [
      { name: 'summary', fields: summary },
      { name: 'daily', fields: daily },
      { name: 'devices', fields: [increment('map.' + type)] },
      { name: 'countries', fields: [increment('map.' + country)] },
    ];
  }
  if (event.t === 'pj') return [{ name: 'projects', fields: event.projects.map(p => increment('map.' + field(p) + '.views')) }];
  const fields = [increment('clicks')];
  const writes = [{ name: 'summary', fields }];
  if (event.project) writes.push({ name: 'projects', fields: [increment('map.' + field(event.project) + '.clicks')] });
  return writes;
}

function device(ua) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}
function field(value) { return '`' + String(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'; }
function increment(fieldPath) { return { fieldPath, increment: { integerValue: '1' } }; }
function projectId(env) {
  if (env.FIREBASE_PROJECT_ID) return String(env.FIREBASE_PROJECT_ID).trim();
  const match = String(env.FIREBASE_CLIENT_EMAIL || '').match(/@([^.]+)\./);
  if (!match) throw new Error('firebase_project_missing');
  return match[1];
}
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}

async function commit(env, token, uid, transforms) {
  const project = projectId(env);
  const base = `projects/${project}/databases/(default)/documents/users/${encodeURIComponent(uid)}/analytics/`;
  const writes = transforms.map(item => ({ transform: {
    document: base + item.name,
    fieldTransforms: item.fields.map(field => ({ fieldPath: field.fieldPath, increment: field.increment })),
  } }));
  const response = await fetch(`${API}/projects/${encodeURIComponent(project)}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error('analytics_commit_failed');
}

let _token = null;
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.value;
  const data = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const assertion = data + '.' + b64urlBytes(new Uint8Array(signature));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('firebase_token_failed');
  const token = await response.json();
  _token = { value: token.access_token, exp: now + (token.expires_in || 3600) };
  return _token.value;
}
function b64url(value) { return b64urlBytes(new TextEncoder().encode(value)); }
function b64urlBytes(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function importPrivateKey(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der;
  try { der = Uint8Array.from(atob(body), c => c.charCodeAt(0)); }
  catch { throw new Error('firebase_private_key_invalid'); }
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Per-profile quotas and idempotency. Data is isolated by profile UID. */
export class AnalyticsGuard {
  constructor(ctx) {
    this.ctx = ctx;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (day TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(day,event_id));
      CREATE TABLE IF NOT EXISTS profile_counts (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ip_counts (day TEXT NOT NULL, ip_hash TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,ip_hash));
      CREATE TABLE IF NOT EXISTS project_names (name TEXT PRIMARY KEY);
    `);
  }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/consume') return json({ error: 'not_found' }, 404);
    let input;
    try { input = await request.json(); } catch { return json({ error: 'invalid_event' }, 400); }
    if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.day || '')
      || !/^[A-Za-z0-9_-]{16,64}$/.test(input.eventId || '')
      || !/^[a-f0-9]{64}$/.test(input.ipHash || '')
      || !Array.isArray(input.projects) || input.projects.length > MAX_PROJECTS_PER_EVENT) return json({ error: 'invalid_event' }, 400);

    try {
      const result = this.ctx.storage.transactionSync(() => {
        const sql = this.ctx.storage.sql;
        // Keep only a short dedup window; retain per-profile daily project names.
        sql.exec('DELETE FROM events WHERE day < ?', input.day);
        sql.exec('DELETE FROM profile_counts WHERE day < ?', input.day);
        sql.exec('DELETE FROM ip_counts WHERE day < ?', input.day);
        const prior = sql.exec('SELECT 1 AS found FROM events WHERE day = ? AND event_id = ?', input.day, input.eventId).toArray();
        if (prior.length) return { status: 200, body: { duplicate: true } };
        const profile = sql.exec('SELECT count FROM profile_counts WHERE day = ?', input.day).toArray()[0];
        if ((profile?.count || 0) >= MAX_DAILY_PROFILE_EVENTS) return { status: 429, body: { error: 'quota_exceeded' } };
        const ip = sql.exec('SELECT count FROM ip_counts WHERE day = ? AND ip_hash = ?', input.day, input.ipHash).toArray()[0];
        if ((ip?.count || 0) >= MAX_DAILY_PROFILE_IP_EVENTS) return { status: 429, body: { error: 'quota_exceeded' } };
        const names = [...new Set(input.projects)];
        const known = sql.exec('SELECT name FROM project_names').toArray().map(row => row.name);
        if (names.some(name => typeof name !== 'string' || name.length < 1 || name.length > MAX_PROJECT_NAME)
          || known.length + names.filter(name => !known.includes(name)).length > 40) return { status: 400, body: { error: 'invalid_event' } };
        sql.exec('INSERT INTO events(day,event_id) VALUES(?,?)', input.day, input.eventId);
        sql.exec('INSERT INTO profile_counts(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1', input.day);
        sql.exec('INSERT INTO ip_counts(day,ip_hash,count) VALUES(?,?,1) ON CONFLICT(day,ip_hash) DO UPDATE SET count=count+1', input.day, input.ipHash);
        for (const name of names) sql.exec('INSERT OR IGNORE INTO project_names(name) VALUES(?)', name);
        return { status: 200, body: { duplicate: false } };
      });
      return json(result.body, result.status);
    } catch {
      return json({ error: 'guard_unavailable' }, 503);
    }
  }
}
