import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, route, KEY_RE } from '../functions/api/haunt.js';

const KEY = 'haunt_' + 'A'.repeat(32);
const ORIGIN = 'https://souanptjub.pages.dev';

async function call({ method = 'GET', qs = 'op=uploads', origin = ORIGIN, key = KEY, body, ct } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const headers = {};
    if (origin) headers.origin = origin;
    if (key) headers['x-haunt-key'] = key;
    if (ct) headers['content-type'] = ct;
    const res = await onRequest({ request: new Request('https://souanptjub.pages.dev/api/haunt?' + qs, { method, headers, body }), env: {} });
    return { res, calls, json: await res.clone().json().catch(() => null) };
  } finally { globalThis.fetch = realFetch; }
}

test('only the three ImageHost operations pass, with a target built server-side', () => {
  const p = s => new URLSearchParams(s);
  assert.equal(route('GET', p('op=uploads&limit=40&type=image')).target, 'https://haunt.gg/api/imagehost/uploads?limit=40&type=image');
  assert.equal(route('POST', p('op=upload')).target, 'https://haunt.gg/api/imagehost/upload');
  assert.equal(route('DELETE', p('op=delete&id=c2f1a4d3-8b6e')).target, 'https://haunt.gg/api/imagehost/uploads/c2f1a4d3-8b6e');
  for (const [m, q] of [['GET', 'op=upload'], ['POST', 'op=uploads'], ['GET', 'op=folders'], ['DELETE', 'op=delete&id=../../lookup/user'],
    ['DELETE', 'op=delete&id='], ['GET', 'op=uploads&limit=500'], ['GET', 'op=uploads&type=evil'], ['GET', 'op=uploads&sort=__proto__'], ['PATCH', 'op=delete&id=x']])
    assert.equal(route(m, p(q)), null, `${m} ${q}`);
  assert.ok(KEY_RE.test(KEY)); assert.ok(!KEY_RE.test('haunt_short')); assert.ok(!KEY_RE.test('ghp_' + 'A'.repeat(32)));
});

test('the key is forwarded in a header to haunt.gg only, never in a URL', async () => {
  const { res, calls } = await call({ qs: 'op=uploads&limit=1' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://haunt.gg/api/imagehost/uploads?limit=1');
  assert.equal(calls[0].init.headers['x-api-key'], KEY);
  assert.doesNotMatch(calls[0].url, /haunt_/);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(res.headers.get('access-control-allow-headers'), /x-haunt-key/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('foreign origins, missing keys and unknown operations are refused before any call', async () => {
  for (const [opts, status, code] of [
    [{ origin: 'https://evil.test' }, 403, 'ORIGIN'], [{ origin: null }, 403, 'ORIGIN'],
    [{ key: null }, 401, 'NO_KEY'], [{ key: 'haunt_x' }, 401, 'NO_KEY'],
    [{ qs: 'op=folders' }, 400, 'OP'],
    [{ method: 'POST', qs: 'op=upload', body: '{}', ct: 'application/json' }, 400, 'BODY'],
  ]) {
    const { res, calls, json } = await call(opts);
    assert.equal(res.status, status, JSON.stringify(opts)); assert.equal(json.code, code); assert.equal(calls.length, 0, 'haunt.gg never called');
  }
});

test('a multipart upload is passed through to the upload endpoint', async () => {
  const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'a.png');
  const req = new Request('https://x/', { method: 'POST', body: fd });
  const { res, calls } = await call({ method: 'POST', qs: 'op=upload', body: await req.arrayBuffer(), ct: req.headers.get('content-type') });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, 'https://haunt.gg/api/imagehost/upload');
  assert.match(calls[0].init.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.ok(calls[0].init.body.byteLength > 4);
});

test('the client keeps the key on the device: not backed up, not published', () => {
  const client = readFileSync(new URL('../js/haunt.js', import.meta.url), 'utf8');
  assert.match(client, /STORE: 'souanpt_haunt_v1'/);
  assert.match(client, /'x-haunt-key': key/, 'sent as a header');
  assert.doesNotMatch(client, /[?&]key=|api_key=/, 'never in a query string');
  const registry = readFileSync(new URL('../js/hub-data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(registry, /souanpt_haunt/, 'not in the GitHub/Firestore backup registry');
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /souanpt_haunt|Haunt\.key/, 'the site generator never reads the key');
  for (const f of ['../js/haunt.js', '../functions/api/haunt.js', '../app.html', '../js/canvas.js', '../js/behance-editor.js'])
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /haunt_[A-Za-z0-9]{20,}/, `${f} contains no real key`);
});
