import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker, { AnalyticsGuard } from '../cloudflare/analytics-worker.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const profile = uid => ({
  fields: {
    uid: { stringValue: uid }, owner: { stringValue: uid },
    pseudo: { stringValue: 'creator' }, siteUrl: { stringValue: 'https://creator.example/' },
    analyticsEnabled: { booleanValue: true },
  },
});

function localNamespace() {
  const objects = new Map();
  return {
    objects,
    idFromName: name => name,
    get(id) {
      if (!objects.has(id)) {
        const db = new DatabaseSync(':memory:');
        const sql = {
          exec(query, ...values) {
            if (/^\s*CREATE\b/i.test(query) || query.includes(';')) {
              db.exec(query);
              return { toArray: () => [] };
            }
            const stmt = db.prepare(query);
            if (/^\s*SELECT\b/i.test(query)) return { toArray: () => stmt.all(...values) };
            stmt.run(...values);
            return { toArray: () => [] };
          },
        };
        const ctx = { storage: { sql, transactionSync: fn => { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (error) { db.exec('ROLLBACK'); throw error; } } } };
        objects.set(id, new AnalyticsGuard(ctx));
      }
      const object = objects.get(id);
      return { fetch: (input, init) => object.fetch(new Request(input, init)) };
    },
  };
}

function setup(options = {}) {
  const state = { commits: [], profileReads: 0, profiles: new Map([['user-1', profile('user-1')]]), commitStatus: 200 };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (url.includes('/documents/users/')) {
      state.profileReads++;
      const uid = decodeURIComponent(url.split('/documents/users/')[1]);
      const body = state.profiles.get(uid);
      return body ? Response.json(body) : new Response('{}', { status: 404 });
    }
    if (url.endsWith('/documents:commit')) {
      state.commits.push(JSON.parse(init.body));
      return state.commitStatus === 200 ? Response.json({}) : new Response('private firestore detail', { status: state.commitStatus });
    }
    throw new Error('unexpected fetch: ' + url);
  };
  const rate = { limit: async () => ({ success: true }) };
  const env = {
    ANALYTICS_INGEST_ENABLED: 'true',
    ANALYTICS_RATE_LIMITER: options.rateLimiter || rate,
    ANALYTICS_GUARD: options.guard || localNamespace(),
    ANALYTICS_IP_SALT: 'test-only-salt',
    FIREBASE_CLIENT_EMAIL: 'worker@souanpt-hub.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privatePem,
  };
  const restore = () => { globalThis.fetch = oldFetch; };
  return { env, state, restore };
}

function request(body, extra = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...extra.headers };
  const options = { method: extra.method || 'POST', headers };
  if (body !== undefined) options.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://analytics.example/hit', options);
}
const event = (overrides = {}) => ({ uid: 'user-1', eid: '0123456789abcdef', t: 'pv', u: 1, ua: 'Mozilla/5.0', ...overrides });

test('status and hit fail closed when security infrastructure is missing', async () => {
  const status = await worker.fetch(new Request('https://analytics.example/status'), {});
  assert.equal(status.status, 200);
  assert.equal((await status.json()).enabled, false);
  const hit = await worker.fetch(request(event()), {});
  assert.equal(hit.status, 503);
});

test('valid event is accepted only for a published, opted-in owner profile', async t => {
  const f = setup(); t.after(f.restore);
  const response = await worker.fetch(request(event()), f.env);
  assert.equal(response.status, 204);
  assert.equal(f.state.commits.length, 1);
  assert.equal(f.state.commits[0].writes.length, 4);
});

test('unknown, unpublished, and non-consenting profiles cannot receive writes', async t => {
  const f = setup(); t.after(f.restore);
  assert.equal((await worker.fetch(request(event({ uid: 'missing-user' })), f.env)).status, 403);
  f.state.profiles.set('private-user', { ...profile('private-user'), fields: { ...profile('private-user').fields, siteUrl: { stringValue: '' } } });
  assert.equal((await worker.fetch(request(event({ uid: 'private-user' })), f.env)).status, 403);
  f.state.profiles.set('other-owner', { fields: { ...profile('other-owner').fields, uid: undefined, owner: { stringValue: 'different-user' } } });
  assert.equal((await worker.fetch(request(event({ uid: 'other-owner' })), f.env)).status, 403);
  f.state.profiles.set('no-consent', { fields: { ...profile('no-consent').fields, uid: { stringValue: 'no-consent' }, owner: { stringValue: 'no-consent' }, analyticsEnabled: { booleanValue: false } } });
  assert.equal((await worker.fetch(request(event({ uid: 'no-consent' })), f.env)).status, 403);
  assert.equal(f.state.commits.length, 0);
});

test('rate limiting blocks a burst before profile reads or writes', async t => {
  let profileCalls = 0;
  const f = setup({ rateLimiter: { limit: async ({ key }) => ({ success: key.startsWith('ip:') || ++profileCalls < 2 }) } }); t.after(f.restore);
  const first = await worker.fetch(request(event()), f.env);
  const second = await worker.fetch(request(event({ eid: '1123456789abcdef' })), f.env);
  assert.equal(first.status, 204);
  assert.equal(second.status, 429);
  assert.equal(f.state.profileReads, 1);
  assert.equal(f.state.commits.length, 1);
});

test('durable guard enforces per-profile daily event quota', async t => {
  const f = setup(); t.after(f.restore);
  f.env.ANALYTICS_GUARD.get('user-1');
  const guard = f.env.ANALYTICS_GUARD.objects.get('user-1');
  const day = new Date().toISOString().slice(0, 10);
  guard.ctx.storage.sql.exec('INSERT INTO profile_counts(day,count) VALUES(?,?)', day, 5000);
  const response = await worker.fetch(request(event()), f.env);
  assert.equal(response.status, 429);
  assert.equal(f.state.commits.length, 0);
});

test('malformed JSON, oversized body, and unsupported event shapes are rejected', async t => {
  const f = setup(); t.after(f.restore);
  assert.equal((await worker.fetch(request('{bad json'), f.env)).status, 400);
  assert.equal((await worker.fetch(request('x'.repeat(4097)), f.env)).status, 413);
  assert.equal((await worker.fetch(request(event({ t: 'unknown' })), f.env)).status, 400);
  assert.equal((await worker.fetch(request(event({ extra: 'secret' })), f.env)).status, 400);
  assert.equal((await worker.fetch(request(event({ uid: 'bad/uid' })), f.env)).status, 400);
  assert.equal(f.state.commits.length, 0);
});

test('project names, counts, and user-agent lengths are bounded', async t => {
  const f = setup(); t.after(f.restore);
  assert.equal((await worker.fetch(request(event({ t: 'pv', ua: 'x'.repeat(257) })), f.env)).status, 400);
  assert.equal((await worker.fetch(request(event({ t: 'pj', projects: Array(21).fill('project') })), f.env)).status, 400);
  assert.equal((await worker.fetch(request(event({ t: 'pj', projects: ['ok', 'ok'] })), f.env)).status, 400);
  assert.equal((await worker.fetch(request(event({ t: 'click', project: 'x'.repeat(81) })), f.env)).status, 400);
  assert.equal(f.state.commits.length, 0);
});

test('event IDs are idempotent and the Durable Object also limits profile/IP quotas', async t => {
  const f = setup(); t.after(f.restore);
  assert.equal((await worker.fetch(request(event()), f.env)).status, 204);
  assert.equal((await worker.fetch(request(event()), f.env)).status, 204);
  assert.equal(f.state.commits.length, 1);
  const guard = f.env.ANALYTICS_GUARD.objects.get('user-1');
  const day = new Date().toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-only-salt:198.51.100.3'));
  const ipHash = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
  guard.ctx.storage.sql.exec('INSERT INTO ip_counts(day,ip_hash,count) VALUES(?,?,?)', day, ipHash, 120);
  const response = await worker.fetch(request(event({ eid: '1123456789abcdef' }), { headers: { 'cf-connecting-ip': '198.51.100.3' } }), f.env);
  assert.equal(response.status, 429);
});

test('Firestore failures fail closed without returning private response bodies', async t => {
  const f = setup(); t.after(f.restore); f.state.commitStatus = 500;
  const response = await worker.fetch(request(event()), f.env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private firestore detail/);
});
