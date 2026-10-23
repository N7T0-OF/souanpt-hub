import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_FILES = ['index.html', 'app.html', 'portal.html', 'classement.html', 'soutenir.html', '404.html', 'site-config.json'];

export function buildDistribution({ channel, output, commitSha, builtAt = new Date().toISOString() }) {
  if (!['github-pages', 'cloudflare', 'release-pages', 'release-cloudflare'].includes(channel)) throw new Error('Canal inconnu');
  const out = path.resolve(output || path.join(os.tmpdir(), `souanpt-hub-dist-${channel}-${process.pid}`));
  if (out === ROOT || out.startsWith(ROOT + path.sep)) throw new Error('Le répertoire de sortie doit être hors du dépôt');
  fs.mkdirSync(out, { recursive: false });

  for (const file of BASE_FILES) copyFile(file, out);
  for (const dir of ['js', 'legal']) copyTree(dir, out);
  copyFile('.nojekyll', out);
  copyFile('firebase/firebase-config.js', out);
  if (channel.includes('cloudflare')) {
    copyFile('_routes.json', out);
    copyTree('functions', out);
  }

  const versionSource = fs.readFileSync(path.join(ROOT, 'js/quote.js'), 'utf8');
  const match = versionSource.match(/const\s+HUB_VERSIONS\s*=\s*\[\s*\[['"](\d+\.\d+\.\d+)['"]/);
  if (!match) throw new Error('Version applicative introuvable');
  const sha = commitSha || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const marker = { version: match[1], commit: sha, builtAt, channel };
  fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify(marker, null, 2) + '\n', { flag: 'wx' });
  validateDistribution(out, channel);
  return { directory: out, ...marker };
}

export function validateDistribution(directory, channel) {
  const out = path.resolve(directory);
  const info = JSON.parse(fs.readFileSync(path.join(out, 'build-info.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(info.version) || !info.commit || info.channel !== channel) throw new Error('build-info.json invalide');
  for (const file of ['index.html', 'app.html', 'js/core.js', 'js/cloud.js', 'firebase/firebase-config.js']) {
    if (!fs.existsSync(path.join(out, file))) throw new Error('Fichier public requis absent : ' + file);
  }
  if (channel.includes('cloudflare') !== fs.existsSync(path.join(out, 'functions'))) throw new Error('Contenu Functions incorrect pour ce canal');
  for (const jsonFile of ['site-config.json', ...(channel.includes('cloudflare') ? ['_routes.json'] : [])])
    JSON.parse(fs.readFileSync(path.join(out, jsonFile), 'utf8'));

  for (const page of ['index.html', 'app.html', 'portal.html', 'classement.html', 'soutenir.html', '404.html']) {
    const source = fs.readFileSync(path.join(out, page), 'utf8');
    const refs = source.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    for (const [, ref] of refs) {
      if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref) || ref.includes('${')) continue;
      const localPath = decodeURIComponent(ref.split(/[?#]/, 1)[0]);
      if (!localPath || localPath === '/') continue;
      const target = localPath.startsWith('/')
        ? path.resolve(out, localPath.slice(1))
        : path.resolve(out, path.dirname(page), localPath);
      if (!target.startsWith(out + path.sep) || !fs.existsSync(target)) throw new Error(`${page} référence une ressource absente : ${ref}`);
    }
  }

  const files = listFiles(out);
  for (const file of files) {
    const rel = path.relative(out, file).replace(/\\/g, '/');
    if (/^(?:\.git|\.github|\.claude|\.freebuff|\.wrangler|docs|scripts|tests)(?:\/|$)/i.test(rel)
      || /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|p12|keystore|jks))$/i.test(rel)) throw new Error('Fichier interne dans l’artefact : ' + rel);
    const content = fs.readFileSync(file);
    const sample = content.subarray(0, Math.min(content.length, 2_000_000)).toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|CLOUDFLARE_API_TOKEN\s*[=:]\s*[A-Za-z0-9_-]{24,}/.test(sample))
      throw new Error('Secret évident détecté dans l’artefact : ' + rel);
  }
  return { files: files.length, info };
}

function copyFile(rel, out) {
  const source = path.join(ROOT, rel);
  if (!fs.statSync(source).isFile()) throw new Error('Fichier absent : ' + rel);
  const target = path.join(out, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}
function copyTree(rel, out) {
  const source = path.join(ROOT, rel);
  if (!fs.statSync(source).isDirectory()) throw new Error('Dossier absent : ' + rel);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const child = path.posix.join(rel.replace(/\\/g, '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error('Lien symbolique refusé : ' + child);
    if (entry.isDirectory()) copyTree(child, out);
    else if (entry.isFile()) copyFile(child, out);
  }
}
function listFiles(directory) {
  const all = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) all.push(...listFiles(target));
    else if (entry.isFile()) all.push(target);
  }
  return all;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const channelArg = process.argv.find(v => v.startsWith('--channel='));
    const outputArg = process.argv.find(v => v.startsWith('--output='));
    const result = buildDistribution({
      channel: channelArg && channelArg.slice('--channel='.length),
      output: outputArg && outputArg.slice('--output='.length),
      commitSha: process.env.GITHUB_SHA,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(String(error && error.message || error) + '\n');
    process.exitCode = 1;
  }
}
