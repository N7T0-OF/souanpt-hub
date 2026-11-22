import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, deviceLabel, same } from '../functions/api/pair.js';

const ORIGIN = 'https://souanptjub.pages.dev';
const TOKENS = { 'gho_pcSESSIONtoken1234567890': 'souanpt', ['ghp_' + 'B'.repeat(36)]: 'souanpt', 'gho_otherACCOUNTtoken12345678': 'intrus' };

function kv() {
  const m = new Map();
  return { m, async get(k, o) { const v = m.get(k); return v == null ? null : (o && o.type === 'json' ? JSON.parse(v) : v); }, async put(k, v, o) { m.set(k, v); this.lastTtl = o && o.expirationTtl; }, async delete(k) { m.delete(k); } };
}
async function call(env, op, body = {}, { cookie, pat, origin = ORIGIN } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const t = String((init.headers || {}).authorization || '').replace('token ', '');
    return TOKENS[t] ? new Response(JSON.stringify({ login: TOKENS[t], name: 'N', avatar_url: 'https://a' }), { status: 200 }) : new Response('{}', { status: 401 });
  };
  try {
    const headers = { 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = 'hub_gh=' + encodeURIComponent(JSON.stringify({ t: cookie }));
    if (pat) headers['x-hub-token'] = pat;
    const res = await onRequest({ request: new Request(ORIGIN + '/api/pair?op=' + op, { method: 'POST', headers, body: JSON.stringify(body) }), env });
    return { res, json: await res.clone().json().catch(() => null) };
  } finally { globalThis.fetch = realFetch; }
}
const PC = { cookie: 'gho_pcSESSIONtoken1234567890' };

test('without the KV store or from a foreign site, nothing happens', async () => {
  assert.equal((await call({}, 'create', {}, PC)).json.code, 'NO_KV');
  const env = { HUB_PAIR: kv() };
  const r = await call(env, 'create', {}, { ...PC, origin: 'https://evil.test' });
  assert.equal(r.res.status, 403); assert.equal(env.HUB_PAIR.m.size, 0);
  assert.equal((await call(env, 'create', {})).res.status, 401, 'a logged-out computer cannot create a pairing');
});

test('full flow: QR → claim → approval on the PC → the phone gets its own session', async () => {
  const env = { HUB_PAIR: kv() };
  const c = await call(env, 'create', {}, PC);
  assert.equal(c.res.status, 200);
  const { id, secret } = c.json;
  const stored = [...env.HUB_PAIR.m.values()][0];
  assert.doesNotMatch(stored, /gho_|ghp_/, 'no token stored before approval');
  assert.doesNotMatch(stored, new RegExp(secret), 'only a hash of the QR secret is stored');
  assert.ok(env.HUB_PAIR.lastTtl <= 120);

  assert.equal((await call(env, 'claim', { id, secret: secret.slice(0, -2) + 'xx', device: 'x' })).res.status, 400, 'wrong secret refused');
  const cl = await call(env, 'claim', { id, secret, device: 'iPhone · Safari <script>' });
  assert.equal(cl.res.status, 200); assert.ok(cl.json.nonce); assert.equal(cl.json.login, 'souanpt');
  assert.equal((await call(env, 'claim', { id, secret, device: 'second' })).json.code, 'USED', 'a QR code works once');

  assert.equal((await call(env, 'redeem', { id, nonce: cl.json.nonce })).json.pending, true, 'nothing before approval');
  const st = await call(env, 'status', { id }, PC);
  assert.equal(st.json.st, 'claimed'); assert.equal(st.json.device, 'iPhone · Safari script', 'device label cleaned');
  assert.equal((await call(env, 'status', { id }, { cookie: 'gho_otherACCOUNTtoken12345678' })).res.status, 403, 'another account cannot see or approve it');

  assert.equal((await call(env, 'approve', { id }, PC)).json.st, 'approved');
  assert.equal((await call(env, 'redeem', { id, nonce: 'Z'.repeat(32) })).res.status, 403, 'only the phone holding the nonce can redeem');
  const rd = await call(env, 'redeem', { id, nonce: cl.json.nonce });
  assert.equal(rd.res.status, 200);
  assert.equal(rd.json.user.login, 'souanpt');
  assert.doesNotMatch(JSON.stringify(rd.json), /gho_|ghp_/, 'the token is never in the response body');
  const cookie = rd.res.headers.get('set-cookie');
  assert.match(cookie, /^hub_gh=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure; SameSite=None/);
  assert.equal(env.HUB_PAIR.m.size, 0, 'pairing deleted after use');
  assert.equal((await call(env, 'redeem', { id, nonce: cl.json.nonce })).res.status, 410, 'cannot be replayed');
});

test('refusal on the PC, expiry, and the local-token mode', async () => {
  const env = { HUB_PAIR: kv() };
  let c = await call(env, 'create', {}, PC);
  let cl = await call(env, 'claim', { id: c.json.id, secret: c.json.secret });
  assert.equal((await call(env, 'deny', { id: c.json.id }, PC)).json.st, 'denied');
  assert.equal((await call(env, 'redeem', { id: c.json.id, nonce: cl.json.nonce })).json.code, 'DENIED');
  assert.equal((await call(env, 'approve', { id: c.json.id }, PC)).json.st, 'expired', 'nothing left to approve after a refusal');

  c = await call(env, 'create', {}, PC);
  const key = 'pair:' + c.json.id; const rec = JSON.parse(env.HUB_PAIR.m.get(key)); rec.exp = Date.now() - 1; env.HUB_PAIR.m.set(key, JSON.stringify(rec));
  assert.equal((await call(env, 'claim', { id: c.json.id, secret: c.json.secret })).json.code, 'EXPIRED');

  const pat = await call(env, 'create', {}, { pat: 'ghp_' + 'B'.repeat(36) });
  assert.equal(pat.res.status, 200, 'a computer in local-token mode can pair too');
  assert.equal((await call(env, 'create', {}, { pat: 'not-a-token' })).res.status, 401);
});

test('helpers and browser module', () => {
  assert.equal(deviceLabel('  a\u0000b  <x>  '), 'ab x');
  assert.equal(deviceLabel(''), 'Appareil');
  assert.equal(same('abc', 'abc'), true); assert.equal(same('abc', 'abd'), false); assert.equal(same('', ''), false);
  const client = readFileSync(new URL('../js/device-pair.js', import.meta.url), 'utf8');
  assert.match(client, /'\/app\.html#pair=' \+ p\.id \+ '\.' \+ p\.secret/, 'secret after # — never sent to a server in a URL');
  assert.match(client, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/, 'the secret leaves the address bar immediately');
  assert.doesNotMatch(client, /qrserver|chart\.googleapis|api\.qr/i, 'QR generated locally');
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /api\.qrserver\.com/, 'no shared link sent to a third-party QR service anymore');
  assert.match(app, /onclick="DevicePair\.openPC\(\)"/);
  assert.match(app, /<script src="js\/vendor\/qrcode\.min\.js"><\/script>/);
});
