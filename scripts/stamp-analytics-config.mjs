import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'cloudflare/wrangler.analytics.toml');

export function stampAnalyticsConfig(source, sha) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('A full Git commit SHA is required');
  const marker = /^ANALYTICS_BUILD_SHA = "local"(?=\r?$)/m;
  if (!marker.test(source)) throw new Error('Analytics Worker SHA placeholder is missing');
  return source.replace(marker, `ANALYTICS_BUILD_SHA = "${sha}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stamped = stampAnalyticsConfig(fs.readFileSync(CONFIG, 'utf8'), process.env.GITHUB_SHA);
  fs.writeFileSync(CONFIG, stamped);
  console.log('Analytics Worker config stamped with source commit SHA.');
}
