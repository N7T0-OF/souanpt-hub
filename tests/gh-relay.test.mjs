import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('GitHub Pages probes the current Cloudflare relay before legacy domains', () => {
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  const declared = core.match(/const GH_RELAY_DEFAULT = '([^']+)'/);
  assert.ok(declared, 'default relay origin declared');
  const source = readFileSync(new URL('../js/gh-auth.js', import.meta.url), 'utf8');
  const storage = { getItem: () => null };
  const location = { origin: 'https://n7t0-of.github.io', hostname: 'n7t0-of.github.io' };
  const session = new Function('localStorage', 'location', 'window', 'GH_RELAY_DEFAULT',
    source + '\nreturn GhSession;')(storage, location, {}, declared[1]);
  const origins = session._candidates();
  assert.equal(origins[0], 'https://souanptjub.pages.dev');
  assert.equal(origins.filter(origin => origin === 'https://souanptjub.pages.dev').length, 1);
});

test('a failed relay probe can be retried without reloading the page', async () => {
  const source = readFileSync(new URL('../js/gh-auth.js', import.meta.url), 'utf8');
  let attempts = 0;
  const session = new Function('localStorage', 'location', 'window', 'GH_RELAY_DEFAULT', 'fetch',
    source + '\nreturn GhSession;')(
    { getItem: () => null },
    { origin: 'https://n7t0-of.github.io', hostname: 'n7t0-of.github.io' },
    {}, 'https://souanptjub.pages.dev',
    async () => { attempts++; return { ok: false }; },
  );
  await session.probe();
  const firstAttemptCount = attempts;
  assert.ok(firstAttemptCount > 0);
  assert.equal(session._probe, null);
  await session.probe();
  assert.equal(attempts, firstAttemptCount * 2);
});
