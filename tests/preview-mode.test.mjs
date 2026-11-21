import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/preview-mode.js', import.meta.url), 'utf8');

/** Extrait la fonction cyrb53 du module pour la rejouer à l'identique. */
function extractCyrb53() {
  const start = src.indexOf('function cyrb53(');
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return new Function(src.slice(start, i + 1) + '\nreturn cyrb53;')();
}

test('the default code hash constant matches what the module computes', () => {
  const cyrb53 = extractCyrb53();
  const constant = /DEFAULT_CODE_HASH = '([0-9a-f]+)'/.exec(src)[1];
  const comment = /cyrb53\('([^']+)'\)/.exec(src)[1];
  assert.equal(cyrb53(comment), constant, 'constant must equal cyrb53 of the documented code — else the code never validates');
});

test('cyrb53 is deterministic and distinguishes codes', () => {
  const cyrb53 = extractCyrb53();
  assert.equal(cyrb53('souanpt-apercu'), cyrb53('souanpt-apercu'));
  assert.notEqual(cyrb53('souanpt-apercu'), cyrb53('souanpt-apercus'));
  assert.notEqual(cyrb53('souanpt-apercu'), cyrb53(''));
});

test('preview mode is sandboxed: fictional data, no real network, no Firebase', () => {
  assert.match(src, /Object\.defineProperty\(window, 'localStorage'/, 'swaps localStorage for an in-memory store');
  assert.match(src, /FIREBASE_CONFIG'.*get\(\) \{ return null; \}/s, 'neutralises Firebase');
  assert.match(src, /u\.origin === location\.origin \? nativeFetch/, 'blocks cross-origin fetch');
  assert.match(src, /demo-be|demoData/, 'seeds demo data');
  // Aucune donnée réelle n'est écrite : la mémoire volatile est la seule cible.
  assert.doesNotMatch(src, /nativeLocalStorage\.setItem|real.*setItem/, 'never writes to the real storage');
});

test('app.html loads preview-mode.js before Firebase and wires the gate', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const preview = html.indexOf('js/preview-mode.js');
  const firebase = html.indexOf('firebasejs');
  const config = html.indexOf('firebase/firebase-config.js');
  assert.ok(preview > 0 && preview < firebase && preview < config, 'preview-mode.js must run before Firebase');
  assert.match(html, /PreviewMode\.submitCode\(\)/, 'the gate has an admin-code submit');
  assert.match(html, /id="gate-admin-code"/);
});

test('the preview shows the latest feature: a demo gallery and a "Voir la nouveauté" demo', () => {
  assert.match(src, /function demoSlides\(\)/, 'demo slides are generated, no real images');
  assert.match(src, /image\/jpeg/, 'slides are JPEG data URLs accepted by the gallery validator');
  assert.match(src, /preview: gallery\.length \? \{ gallery \}/, 'the demo Behance project carries the gallery');
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(html, /onclick="PreviewMode\.showNew\(\)"/, 'banner button');
  assert.match(html, /showNew\(\) \{\s*if \(!this\.sandbox\(\)/, 'demo only in the sandbox');
  assert.match(html, /bvOpen\('demo-be'\)/, 'opens the demo project window');
});
