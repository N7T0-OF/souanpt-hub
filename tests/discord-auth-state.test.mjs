import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/discord-auth-worker.js';

const env = { DISCORD_CLIENT_ID: 'test-client' };

async function startLogin() {
  const response = await worker.fetch(new Request(
    'https://auth.example.workers.dev/login?return=https%3A%2F%2Fsouanptjub.pages.dev%2Fapp.html',
  ), env);
  const authorization = new URL(response.headers.get('location'));
  const cookie = response.headers.get('set-cookie');
  const nonce = decodeURIComponent(cookie.match(/discord_oauth_state=([^;]+)/)[1]);
  return { authorization, cookie, nonce };
}

test('login creates unpredictable OAuth state and a matching HttpOnly cookie', async () => {
  const first = await startLogin();
  const second = await startLogin();

  assert.equal(first.authorization.origin, 'https://discord.com');
  assert.notEqual(first.authorization.searchParams.get('state'), second.authorization.searchParams.get('state'));
  assert.match(first.cookie, /HttpOnly/);
  assert.match(first.cookie, /SameSite=Lax/);
  assert.equal(first.authorization.searchParams.get('state').length > 32, true);
});

test('callback rejects missing and mismatched state before using the authorization code', async () => {
  const { authorization, nonce } = await startLogin();
  const callback = new URL('https://auth.example.workers.dev/callback');
  callback.searchParams.set('code', 'must-not-be-exchanged');
  callback.searchParams.set('state', authorization.searchParams.get('state'));

  const missing = await worker.fetch(new Request(callback), {
    ...env,
    DISCORD_CLIENT_SECRET: 'test-secret',
    FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'unused',
  });
  assert.equal(missing.status, 400);
  assert.match(await missing.text(), /invalide/);

  const mismatched = await worker.fetch(new Request(callback, {
    headers: { cookie: 'discord_oauth_state=wrong-nonce' },
  }), {
    ...env,
    DISCORD_CLIENT_SECRET: 'test-secret',
    FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'unused',
  });
  assert.equal(mismatched.status, 400);
  assert.notEqual(nonce, 'wrong-nonce');
});

test('matching state passes CSRF validation and callback processing continues', async () => {
  const { authorization, cookie } = await startLogin();
  const callback = new URL('https://auth.example.workers.dev/callback');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  const response = await worker.fetch(new Request(callback, { headers: { cookie } }), {
    ...env,
    DISCORD_CLIENT_SECRET: 'test-secret',
    FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'unused',
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Code manquant/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('Discord cancellation clears the state cookie without requiring server secrets', async () => {
  const { authorization, cookie } = await startLogin();
  const callback = new URL('https://auth.example.workers.dev/callback');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  callback.searchParams.set('error', 'access_denied');
  const response = await worker.fetch(new Request(callback, { headers: { cookie } }), env);

  assert.equal(response.status, 400);
  assert.match(await response.text(), /annulée/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('callback exceptions clear the cookie and do not disclose internal errors', async () => {
  const { authorization, cookie } = await startLogin();
  const callback = new URL('https://auth.example.workers.dev/callback');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  callback.searchParams.set('code', 'test-code');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('private endpoint detail'); };
  try {
    const response = await worker.fetch(new Request(callback, { headers: { cookie } }), {
      ...env,
      DISCORD_CLIENT_SECRET: 'test-secret',
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'unused',
    });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private endpoint detail/);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
