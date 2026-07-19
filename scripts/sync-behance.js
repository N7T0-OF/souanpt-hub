/**
 * scripts/sync-behance.js
 * Sync des projets Behance vers assets/behance-projects.json
 * via le flux RSS PUBLIC (l'API Behance est fermée — aucune clé nécessaire).
 * Utilisable par GitHub Actions ou en local : node scripts/sync-behance.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const USERNAME = process.env.BEHANCE_USERNAME || 'souanpt';
const OUT      = path.join(__dirname, '..', 'assets', 'behance-projects.json');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'souanpt-hub' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return get(r.headers.location).then(res, rej);
      }
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}

async function main() {
  const xml = await get(`https://www.behance.net/feeds/user?username=${encodeURIComponent(USERNAME)}`);
  const items = xml.split('<item>').slice(1).map(b => b.split('</item>')[0]);
  if (!items.length) throw new Error('Aucun projet dans le flux RSS de @' + USERNAME);

  const projects = items.map(b => {
    const desc = pick(b, 'description');
    return {
      name:  pick(b, 'title'),
      url:   pick(b, 'link'),
      cover: (desc.match(/src="([^"]+)"/) || [])[1] || '',
      published: pick(b, 'pubDate'),
      tags:  [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()),
    };
  });

  // assets/ n'est plus versionné (il ne contenait qu'un JSON vide) : on le crée
  // au besoin, sinon writeFileSync échoue en ENOENT sur un clone neuf.
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(projects, null, 2));
  console.log(`[behance-sync] ${projects.length} projet(s) écrits pour @${USERNAME}.`);
}

main().catch(e => { console.error('[behance-sync]', e.message); process.exit(1); });
