import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as relay, operationAllowed } from '../functions/api/gh.js';
import { onRequest as auth } from '../functions/api/auth.js';

const RELAY = 'https://souanptjub.pages.dev';
const HUB = 'https://n7t0-of.github.io';
const COOKIE = 'hub_gh=' + encodeURIComponent(JSON.stringify({ t: 'test-token' }));

function call(handler, url, { method = 'GET', origin, cookie = COOKIE, body } = {}) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (cookie) headers.set('cookie', cookie);
  if (body) headers.set('content-type', 'text/plain');
  return handler({ request: new Request(RELAY + url, { method, headers, body }), env: {} });
}

/** Remplace fetch le temps d'un test et note chaque appel sortant vers GitHub. */
async function withUpstream(fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (target, init) => {
    calls.push({ target: String(target), method: init && init.method });
    return new Response('{"login":"alice"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

const path = p => '/api/gh?path=' + encodeURIComponent(p);

test('cross-site writes through the relay never reach GitHub', async () => {
  await withUpstream(async calls => {
    const forged = '{"title":"x","key":"ssh-ed25519 AAAA","read_only":false}';
    const evil = await call(relay, path('/repos/alice/private/contents/a.json'),
      { method: 'PUT', origin: 'https://evil.example', body: forged });
    assert.equal(evil.status, 403);
    const noOrigin = await call(relay, path('/user/repos'), { method: 'POST', body: forged });
    assert.equal(noOrigin.status, 403, 'a form or no-cors POST without Origin is refused');
    const sandboxed = await call(relay, path('/user/repos'), { method: 'POST', origin: 'null', body: forged });
    assert.equal(sandboxed.status, 403, 'a sandboxed /u/<pseudo> page has an opaque origin');
    const foreignRead = await call(relay, path('/user'), { origin: 'https://evil.example' });
    assert.equal(foreignRead.status, 403);
    assert.equal(calls.length, 0);
  });
});

test('allowed origins keep the hub operations working', async () => {
  await withUpstream(async calls => {
    const put = await call(relay, path('/repos/alice/site/contents/data/projects.json'),
      { method: 'PUT', origin: HUB, body: '{}' });
    assert.equal(put.status, 200);
    assert.match(put.headers.get('access-control-allow-methods'), /\bPUT\b.*\bDELETE\b/);
    const sameOrigin = await call(relay, path('/repos/alice/site/git/refs/heads/main'),
      { method: 'PATCH', origin: RELAY, body: '{}' });
    assert.equal(sameOrigin.status, 200);
    const read = await call(relay, path('/repos/alice/site/actions/runs?per_page=5'));
    assert.equal(read.status, 200, 'a GET without Origin (same-origin navigation) still works');
    assert.deepEqual(calls.map(c => c.method), ['PUT', 'PATCH', 'GET']);
  });
});

test('only the GitHub operations used by the hub are relayed', async () => {
  const allowed = [
    ['GET', '/user'], ['POST', '/user/repos'], ['GET', '/repos/a/b'],
    ['DELETE', '/repos/a/b/contents/img/x.png'], ['POST', '/repos/a/b/git/trees'],
    ['GET', '/repos/a/b/git/ref/heads/main'], ['PATCH', '/repos/a/b/issues/12'],
    ['POST', '/repos/a/b/pages/builds'], ['HEAD', '/repos/a/b/pages'],
  ];
  for (const [m, p] of allowed) assert.equal(operationAllowed(m, 'https://api.github.com' + p), true, `${m} ${p}`);

  const refused = [
    ['POST', '/repos/a/b/keys'], ['POST', '/repos/a/b/hooks'], ['PUT', '/repos/a/b/collaborators/eve'],
    ['POST', '/user/keys'], ['DELETE', '/repos/a/b'], ['PATCH', '/repos/a/b'],
    ['POST', '/repos/a/b/actions/workflows/x/dispatches'], ['PUT', '/repos/a/b/actions/secrets/X'],
    ['POST', '/repos/a/b/contents/../keys'], ['POST', '/repos/a/b/contents/%2e%2e/%2e%2e/keys'],
    ['PUT', '/repos/a/b/contents/../../../user/keys'], ['GET', '/user/emails'],
  ];
  for (const [m, p] of refused) assert.equal(operationAllowed(m, 'https://api.github.com' + p), false, `${m} ${p}`);

  await withUpstream(async calls => {
    const res = await call(relay, path('/repos/a/b/contents/../../../user/keys'), { method: 'PUT', origin: HUB, body: '{}' });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });
});

test('session cookie changes require a POST from an allowed origin', async () => {
  await withUpstream(async calls => {
    const forgedImport = await call(auth, '/api/auth?op=import',
      { method: 'POST', origin: 'https://evil.example', cookie: '', body: '{"token":"attacker"}' });
    assert.equal(forgedImport.status, 403);
    assert.equal(forgedImport.headers.get('set-cookie'), null);
    const getLogout = await call(auth, '/api/auth?op=logout');
    assert.equal(getLogout.headers.get('set-cookie'), null, 'logout by image/link GET is ignored');
    const noOriginLogout = await call(auth, '/api/auth?op=logout', { method: 'POST' });
    assert.equal(noOriginLogout.status, 403);
    assert.equal(calls.length, 0);

    const logout = await call(auth, '/api/auth?op=logout', { method: 'POST', origin: HUB });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const status = await call(auth, '/api/auth?op=status', { origin: HUB });
    assert.equal(status.status, 200, 'the status probe stays a simple GET');
  });
});
