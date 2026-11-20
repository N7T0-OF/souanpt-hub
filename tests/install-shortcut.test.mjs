import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/install-shortcut.js', import.meta.url), 'utf8');

/** Simule un appareil (navigateur, écran, mode d'affichage) et charge le script. */
function device({ ua, platform = '', touch = 0, coarse = false, fine = true, standalone = false, dismissedAt = null }) {
  const appended = [];
  const listeners = {};
  const el = () => ({ id: '', className: '', innerHTML: '', style: {}, querySelector: () => ({ onclick: null, focus() {} }),
    setAttribute() {}, addEventListener() {}, remove() {} });
  const document = {
    readyState: 'complete',
    head: { appendChild: n => appended.push(n) },
    body: { appendChild: n => appended.push(n) },
    createElement: el,
    getElementById: id => appended.find(n => n.id === id) || null,
    querySelector: () => null,
    addEventListener() {},
  };
  const media = q => ({ matches: q.includes('standalone') ? standalone : q.includes('coarse') ? coarse : q.includes('fine') ? fine : false });
  const store = new Map(dismissedAt ? [['souanpt_shortcut_dismissed_at', String(dismissedAt)]] : []);
  const window = {
    addEventListener: (t, f) => { listeners[t] = f; },
    matchMedia: media,
  };
  const ctx = vm.createContext({
    window, document, matchMedia: media, location: { protocol: 'http:', hostname: 'example.test' },
    navigator: { userAgent: ua, platform, maxTouchPoints: touch, standalone: standalone || undefined },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  vm.runInContext(SRC, ctx);
  return { shown: () => appended.some(n => n.id === 'sh-btn'), api: window.InstallShortcut, listeners };
}

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  // iPadOS se présente comme un Mac : seul le nombre de points de contact le trahit.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
};

test('the shortcut button appears on phones and tablets', () => {
  assert.equal(device({ ua: UA.iphone, platform: 'iPhone', touch: 5, coarse: true, fine: false }).shown(), true, 'iPhone');
  assert.equal(device({ ua: UA.ipad, platform: 'MacIntel', touch: 5, coarse: true, fine: false }).shown(), true, 'iPad (desktop-class Safari)');
  assert.equal(device({ ua: UA.androidPhone, touch: 5, coarse: true, fine: false }).shown(), true, 'Android phone');
  assert.equal(device({ ua: UA.androidTablet, touch: 10, coarse: true, fine: false }).shown(), true, 'Android tablet');
});

test('the button stays hidden on computers, once installed, and while snoozed', () => {
  assert.equal(device({ ua: UA.windows }).shown(), false, 'Windows desktop');
  assert.equal(device({ ua: UA.mac, platform: 'MacIntel', touch: 0 }).shown(), false, 'Mac without touch');
  assert.equal(device({ ua: UA.windows, touch: 10, coarse: true, fine: true }).shown(), false, 'touch laptop with a mouse');
  assert.equal(device({ ua: UA.androidPhone, touch: 5, coarse: true, fine: false, standalone: true }).shown(), false, 'opened from the shortcut');
  assert.equal(device({ ua: UA.iphone, touch: 5, coarse: true, fine: false, dismissedAt: Date.now() - 86400000 }).shown(), false, 'dismissed yesterday');
  assert.equal(device({ ua: UA.iphone, touch: 5, coarse: true, fine: false, dismissedAt: Date.now() - 31 * 86400000 }).shown(), true, 'snooze expires after 30 days');
});

test('the native install prompt is captured instead of the browser mini-bar', () => {
  const d = device({ ua: UA.androidPhone, touch: 5, coarse: true, fine: false });
  let prevented = false;
  d.listeners.beforeinstallprompt({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(typeof d.listeners.appinstalled, 'function', 'the button disappears once installed');
});
