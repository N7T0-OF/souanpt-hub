/**
 * scripts/sync-behance.js
 * Syncs Behance projects to assets/behance-projects.json
 * Called by GitHub Actions behance-sync.yml
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY  = process.env.BEHANCE_API_KEY;
const USERNAME = process.env.BEHANCE_USERNAME || 'eolienneolienn';
const OUT      = path.join(__dirname, '..', 'assets', 'behance-projects.json');

if (!API_KEY) {
  console.log('[behance-sync] No BEHANCE_API_KEY — skipping.');
  process.exit(0);
}

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } });
    }).on('error', rej);
  });
}

async function main() {
  const url = `https://api.behance.net/v2/users/${USERNAME}/projects?api_key=${API_KEY}&per_page=20`;
  const resp = await get(url);
  if (!resp.projects) throw new Error('Unexpected response: ' + JSON.stringify(resp).slice(0,200));

  const projects = resp.projects.map(p => ({
    id: p.id, name: p.name, url: p.url,
    covers: p.covers,
    published: p.published_on,
    fields: p.fields || [],
    stats: { views: p.stats?.views || 0, appreciations: p.stats?.appreciations || 0 },
    tags: p.tags || []
  }));

  let existing = [];
  if (fs.existsSync(OUT)) try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const newOnes = projects.filter(p => !existing.find(e => e.id === p.id));
  if (newOnes.length) console.log(`[behance-sync] ${newOnes.length} new: ${newOnes.map(p=>p.name).join(', ')}`);
  else console.log('[behance-sync] No new projects.');

  fs.writeFileSync(OUT, JSON.stringify(projects, null, 2));
  console.log(`[behance-sync] Wrote ${projects.length} projects.`);
}

main().catch(e => { console.error('[behance-sync]', e.message); process.exit(1); });
