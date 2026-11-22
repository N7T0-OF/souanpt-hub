import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../js/site-ambiance.js', import.meta.url), 'utf8'), ctx);
const A = ctx.SiteAmbiance;
const plain = v => JSON.parse(JSON.stringify(v));

test('everything is off by default: an existing site gets nothing injected', () => {
  const s = A.sanitize(undefined);
  assert.equal(A.active(s), false);
  assert.deepEqual(plain(A.inject(undefined)), { css: '', body: '' });
  assert.deepEqual(plain(A.inject({ particles: 'lava', cursor: 'giant', typewriter: { on: true, lines: [] } })), { css: '', body: '' },
    'unknown values and an empty typewriter stay off');
});

test('settings are bounded and texts cleaned', () => {
  const s = plain(A.sanitize({
    enter: { on: 1, text: 'x'.repeat(200) }, particles: 'snow', density: 99, pColor: 'red', cursor: 'ring',
    typewriter: { on: true, lines: 'un\ndeux\n\ntrois\n4\n5\n6\n7', speed: -4 },
    corner: { on: true, text: 'a b\nc' },
  }));
  assert.equal(s.enter.on, true); assert.equal(s.enter.text.length, 40);
  assert.equal(s.density, 3); assert.equal(s.pColor, 'accent'); assert.equal(s.cursor, 'ring');
  assert.deepEqual(s.typewriter.lines, ['un', 'deux', 'trois', '4', '5', '6'], 'empty lines dropped, 6 max');
  assert.equal(s.typewriter.speed, 1);
  assert.equal(s.corner.text, 'a b c', 'separators and newlines removed');
});

test('texts are published as escaped data, never as HTML', () => {
  const evil = '</script><img src=x onerror=alert(1)>';
  const out = A.inject({ enter: { on: true, text: evil }, corner: { on: true, text: evil }, typewriter: { on: true, lines: [evil] } });
  const dataBlock = out.body.match(/<script type="application\/json" id="amb-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(dataBlock, /</, 'no raw < inside the data block');
  assert.doesNotMatch(out.body.replace(dataBlock, ''), /onerror/, 'the text is not in the markup');
  assert.equal(JSON.parse(dataBlock).corner.text, evil.slice(0, 40));
  const rt = A.runtime.toString();
  assert.match(rt, /textContent = S\.corner\.text/); assert.doesNotMatch(rt, /innerHTML/, 'runtime never writes HTML');
  assert.doesNotMatch(A.scriptTag().slice(8, -9), /<\/script/i);
});

test('decor never blocks the page and reduced motion is respected', () => {
  const css = A.css(A.sanitize({ particles: 'stars', grain: true, progress: true, corner: { on: true, text: 'FR' }, cursor: 'ring', enter: { on: true } }));
  for (const id of ['#amb-fx{', '#amb-grain{', '#amb-prog{', '#amb-corner{'])
    assert.match(css, new RegExp(id.replace(/[#{]/g, m => '\\' + m) + '[^}]*pointer-events:none'), `${id} click-through`);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /pointer:coarse\)\{#amb-dot,#amb-ring,\.amb-trail\{display:none/, 'no custom cursor on touch screens');
  const rt = A.runtime.toString();
  assert.match(rt, /if \(cv && !reduce\)/, 'no particles with reduced motion');
  assert.match(rt, /visibilitychange/, 'animation paused when the tab is hidden');
});

test('the entry screen is hidden in the editor and starts the site sound on click', () => {
  const s = A.sanitize({ enter: { on: true } });
  assert.match(A.html(s, { editor: true }), /id="amb-enter"[^>]*hidden/);
  assert.doesNotMatch(A.html(s, { editor: false }), /id="amb-enter"[^>]*hidden/);
  const rt = A.runtime.toString();
  assert.match(rt, /getElementById\('site-sound'\)/);
  assert.match(rt, /window\.ambEnter = show/);
  assert.match(rt, /e\.key === 'Enter' \|\| e\.key === ' '/, 'keyboard accessible');
});

test('generateSite injects the ambiance only when something is on', () => {
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.match(core, /SiteAmbiance\.inject\(cfg\.ambiance, \{ editor \}\)/);
  assert.match(core, /\$\{amb\.css\}\$\{hgBack\.css\}\n<\/style><\/head><body>/);
  assert.match(core, /\$\{amb\.body\}\n<\/body><\/html>/);
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /<script src="js\/site-ambiance\.js"><\/script>/);
  assert.match(app, /onclick="EdMenu\.run\('edWinAmbiance',true\)"/, 'Ambiance is in the 🎨 Design menu');
});
