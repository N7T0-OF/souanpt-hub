import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySiteDeployment } from '../scripts/verify-site-deploy.mjs';

const sha = 'a'.repeat(40);
const marker = (commit = sha, channel = 'github-pages') => Response.json({ commit, channel, version: '3.10.1' });

test('site verifier retries a stale Pages marker and preserves the repository path', async () => {
  const requests = [];
  const pauses = [];
  const responses = [marker('b'.repeat(40)), marker()];
  const result = await verifySiteDeployment({
    siteUrl: 'https://n7t0-of.github.io/souanpt-hub/', sha, channel: 'github-pages',
    maxAttempts: 2, retryMs: 7,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return responses.shift(); },
    sleepImpl: async ms => { pauses.push(ms); },
  });
  assert.equal(result.attempt, 2);
  assert.deepEqual(pauses, [7]);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).pathname, '/souanpt-hub/build-info.json');
  assert.notEqual(requests[0].url, requests[1].url);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers['Cache-Control'], 'no-cache');
});

test('site verifier tolerates transient network and HTTP errors but requires the right channel', async () => {
  const responses = [new Error('network'), new Response('', { status: 503 }), marker(sha, 'github-pages'), marker(sha, 'cloudflare')];
  let calls = 0;
  const result = await verifySiteDeployment({
    siteUrl: 'https://souanptjub.pages.dev', sha, channel: 'cloudflare',
    maxAttempts: 4, retryMs: 0, sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  assert.equal(result.attempt, 4);
  assert.equal(calls, 4);
  assert.equal(new URL(result.url).pathname, '/build-info.json');
});

test('site verifier fails after its bound and rejects invalid verification inputs', async () => {
  let calls = 0;
  const pauses = [];
  await assert.rejects(verifySiteDeployment({
    siteUrl: 'https://souanptjub.pages.dev', sha, channel: 'cloudflare',
    maxAttempts: 3, retryMs: 5, sleepImpl: async ms => { pauses.push(ms); },
    fetchImpl: async () => { calls++; return marker('b'.repeat(40), 'cloudflare'); },
  }), /after 3 attempts/);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [5, 5]);
  await assert.rejects(verifySiteDeployment({ siteUrl: 'https://example.com', sha: 'short', channel: 'cloudflare' }), /full Git commit SHA/);
  await assert.rejects(verifySiteDeployment({ siteUrl: 'https://example.com', sha, channel: 'release-cloudflare' }), /Unknown deployment channel/);
  await assert.rejects(verifySiteDeployment({ siteUrl: 'http://example.com', sha, channel: 'cloudflare' }), /HTTPS site URL/);
});

test('both production workflows check their public marker after deployment', () => {
  for (const [workflow, deployStep, channel] of [
    ['deploy.yml', '- name: Deploy', 'github-pages'],
    ['deploy-cloudflare.yml', '- name: Deploy Cloudflare Pages', 'cloudflare'],
  ]) {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    const deploy = source.indexOf(deployStep);
    const verify = source.indexOf('run: node scripts/verify-site-deploy.mjs');
    assert.ok(deploy >= 0 && verify > deploy, `${workflow} must verify after deployment`);
    assert.match(source.slice(deploy, verify), new RegExp(`SITE_CHANNEL: ${channel}`));
  }
});
