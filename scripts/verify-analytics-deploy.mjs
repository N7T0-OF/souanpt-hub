import { pathToFileURL } from 'node:url';
import path from 'node:path';

const STATUS_URL = 'https://souanpt-analytics.titaneolinne13.workers.dev/status';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyAnalyticsWorker({
  sha,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxAttempts = 12,
  retryMs = 3000,
  timeoutMs = 7000,
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('A full Git commit SHA is required');
  const url = new URL(STATUS_URL);
  url.searchParams.set('verify', sha);
  let lastFailure = 'no response';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url.href, {
        cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) lastFailure = `HTTP ${response.status}`;
      else if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) {
        lastFailure = 'expected JSON status response';
      } else {
        const status = await response.json();
        if (status?.enabled === false && status.reason === 'security_setup_required' && status.commit === sha) {
          return { attempt, url: url.href };
        }
        lastFailure = 'worker SHA or protected status did not match';
      }
    } catch (error) {
      lastFailure = `request failed (${error?.name || 'unknown error'})`;
    }
    if (attempt < maxAttempts) await sleepImpl(retryMs);
  }
  throw new Error(`Protected Analytics Worker did not become ready after ${maxAttempts} attempts: ${lastFailure}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyAnalyticsWorker({ sha: process.env.GITHUB_SHA })
    .then(({ attempt }) => console.log(`Protected Analytics Worker confirmed after attempt ${attempt}; ingestion is disabled.`))
    .catch(error => { console.error(`::error title=Analytics Worker verification failed::${error.message}`); process.exitCode = 1; });
}
