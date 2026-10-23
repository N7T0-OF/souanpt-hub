import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CHANNELS = new Set(['github-pages', 'cloudflare']);

export async function verifySiteDeployment({
  siteUrl,
  sha,
  channel,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxAttempts = 12,
  retryMs = 3000,
  timeoutMs = 7000,
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('A full Git commit SHA is required');
  if (!CHANNELS.has(channel)) throw new Error('Unknown deployment channel');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('At least one verification attempt is required');

  const base = new URL(siteUrl);
  if (base.protocol !== 'https:') throw new Error('A HTTPS site URL is required');
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const markerUrl = new URL('build-info.json', base);
  let lastFailure = 'no response';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    markerUrl.searchParams.set('verify', `${sha}-${Date.now()}-${attempt}`);
    try {
      const response = await fetchImpl(markerUrl.href, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) lastFailure = `HTTP ${response.status}`;
      else {
        const marker = await response.json();
        if (marker?.commit === sha && marker.channel === channel) {
          return { attempt, url: markerUrl.href };
        }
        lastFailure = `commit or channel did not match (${marker?.commit || 'no commit'})`;
      }
    } catch (error) {
      lastFailure = `request failed (${error?.name || 'unknown error'})`;
    }
    if (attempt < maxAttempts) await sleepImpl(retryMs);
  }
  throw new Error(`${channel} did not serve commit ${sha} after ${maxAttempts} attempts: ${lastFailure}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifySiteDeployment({
    siteUrl: process.env.SITE_URL,
    sha: process.env.EXPECTED_SHA,
    channel: process.env.SITE_CHANNEL,
  })
    .then(({ attempt }) => console.log(`Verified ${process.env.SITE_CHANNEL} at ${process.env.EXPECTED_SHA} after attempt ${attempt}.`))
    .catch(error => { console.error(`::error title=Site deployment verification failed::${error.message}`); process.exitCode = 1; });
}
