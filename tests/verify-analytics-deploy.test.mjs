import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyAnalyticsWorker } from '../scripts/verify-analytics-deploy.mjs';
import { stampAnalyticsConfig } from '../scripts/stamp-analytics-config.mjs';

const sha = 'a'.repeat(40);
const safeStatus = (commit = sha) => Response.json({ enabled: false, reason: 'security_setup_required', commit });

test('Worker config receives the exact source commit before deployment', () => {
  const source = readFileSync(new URL('../cloudflare/wrangler.analytics.toml', import.meta.url), 'utf8');
  const stamped = stampAnalyticsConfig(source, sha);
  assert.match(stamped, new RegExp(`ANALYTICS_BUILD_SHA = "${sha}"`));
  assert.match(stamped, /ANALYTICS_INGEST_ENABLED = "false"/);
  assert.match(stampAnalyticsConfig(source.replace(/\r?\n/g, '\r\n'), sha), new RegExp(`ANALYTICS_BUILD_SHA = "${sha}"`));
  assert.throws(() => stampAnalyticsConfig(source, 'short'), /full Git commit SHA/);
  assert.throws(() => stampAnalyticsConfig('[vars]\n', sha), /placeholder is missing/);
});

test('deployment verification retries an old text Worker until protected JSON is public', async () => {
  const calls = [];
  const responses = [new Response('souanpt analytics — POST /hit'), safeStatus()];
  const result = await verifyAnalyticsWorker({
    sha, retryMs: 0, maxAttempts: 2, sleepImpl: async () => {},
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responses.shift(); },
  });
  assert.equal(result.attempt, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('verify'), sha);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls.length, 2);
});

test('deployment verification rejects a Worker with ingestion enabled', async () => {
  await assert.rejects(verifyAnalyticsWorker({
    sha, maxAttempts: 1,
    fetchImpl: async () => Response.json({ enabled: true, reason: null, commit: sha }),
  }), /protected status did not match/);
});

test('deployment verification rejects a stale Worker, malformed status and invalid commit SHA', async () => {
  await assert.rejects(verifyAnalyticsWorker({
    sha, maxAttempts: 1,
    fetchImpl: async () => safeStatus('b'.repeat(40)),
  }), /worker SHA/);
  await assert.rejects(verifyAnalyticsWorker({
    sha, maxAttempts: 1,
    fetchImpl: async () => Response.json({ enabled: false, reason: 'other', commit: sha }),
  }), /protected status did not match/);
  await assert.rejects(verifyAnalyticsWorker({ sha: 'short' }), /full Git commit SHA/);
});

test('release rechecks the protected Worker after production markers and before publication', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const production = workflow.indexOf('- name: Verify current production deployments');
  const worker = workflow.indexOf('- name: Verify current protected Analytics Worker');
  const release = workflow.indexOf('- name: Publish GitHub Release');
  assert.ok(production >= 0 && worker > production && release > worker);
  assert.match(workflow.slice(worker, release), /run: node scripts\/verify-analytics-deploy\.mjs/);
});
