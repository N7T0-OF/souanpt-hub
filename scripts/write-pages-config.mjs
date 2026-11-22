#!/usr/bin/env node
/**
 * Écrit la configuration Pages (liaisons KV…) À CÔTÉ du dossier à publier.
 *   node scripts/write-pages-config.mjs <dossier-publié>
 * → <parent>/wrangler.toml avec pages_build_output_dir = <nom du dossier>
 * Puis : (cd <parent> && wrangler pages deploy <nom du dossier> --project-name=souanpthub …)
 * Le fichier n'est jamais dans le dossier publié : il n'est donc pas servi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pagesConfig(outDir) {
  const dist = path.basename(path.resolve(outDir));
  if (!/^[A-Za-z0-9._-]+$/.test(dist)) throw new Error('Nom de dossier publié inattendu : ' + dist);
  const tpl = fs.readFileSync(path.join(ROOT, 'cloudflare', 'pages.wrangler.toml'), 'utf8');
  if (!tpl.includes('__DIST__')) throw new Error('Modèle sans __DIST__');
  return tpl.replace('__DIST__', dist);
}

export function writePagesConfig(outDir) {
  const abs = path.resolve(outDir);
  if (!fs.existsSync(path.join(abs, 'build-info.json'))) throw new Error('Dossier publié introuvable ou incomplet : ' + abs);
  const target = path.join(path.dirname(abs), 'wrangler.toml');
  fs.writeFileSync(target, pagesConfig(abs));
  return { parent: path.dirname(abs), dist: path.basename(abs), file: target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('Usage : node scripts/write-pages-config.mjs <dossier-publié>'); process.exit(2); }
  const r = writePagesConfig(out);
  console.log(JSON.stringify(r));
}
