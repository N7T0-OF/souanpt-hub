#!/usr/bin/env node
/**
 * Écrit la configuration Pages (liaisons KV…) à la RACINE du dépôt.
 *   node scripts/write-pages-config.mjs <dossier-publié>
 * → <racine>/wrangler.toml (ignoré par Git) avec pages_build_output_dir = <dossier-publié>
 * Puis, DEPUIS LA RACINE : wrangler pages deploy <dossier-publié> --project-name=souanpthub …
 *
 * Pourquoi la racine : Wrangler lit `functions/` dans le dossier d'où il est lancé.
 * Lancé ailleurs (ex. à côté du dossier publié), il publie le site SANS les Functions
 * et le relais (/api/auth, /api/pair…) tombe en 404 — vécu le 22/11/2026.
 * Le fichier reste hors du dossier publié : il n'est jamais servi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pagesConfig(outDir, configDir = ROOT) {
  const abs = path.resolve(outDir);
  let rel = path.relative(path.resolve(configDir), abs);
  if (!rel || rel === '.') throw new Error('Le dossier publié ne peut pas être la racine du dépôt');
  rel = rel.split(path.sep).join('/');
  if (!/^[A-Za-z0-9._:/-]+$/.test(rel)) throw new Error('Chemin du dossier publié inattendu : ' + rel);
  const tpl = fs.readFileSync(path.join(ROOT, 'cloudflare', 'pages.wrangler.toml'), 'utf8');
  if (!tpl.includes('__DIST__')) throw new Error('Modèle sans __DIST__');
  return tpl.replace('__DIST__', rel);
}

export function writePagesConfig(outDir, configDir = ROOT) {
  const abs = path.resolve(outDir);
  if (!fs.existsSync(path.join(abs, 'build-info.json'))) throw new Error('Dossier publié introuvable ou incomplet : ' + abs);
  if (!fs.existsSync(path.join(path.resolve(configDir), 'functions'))) throw new Error('Pas de dossier functions/ dans ' + configDir + ' : Wrangler publierait le site sans le relais');
  const target = path.join(path.resolve(configDir), 'wrangler.toml');
  fs.writeFileSync(target, pagesConfig(abs, configDir));
  return { dir: path.resolve(configDir), dist: abs, file: target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('Usage : node scripts/write-pages-config.mjs <dossier-publié>'); process.exit(2); }
  const r = writePagesConfig(out);
  console.log(JSON.stringify(r));
}
