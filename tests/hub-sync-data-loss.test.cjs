const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

async function setup(remoteProjects, remoteConfig) {
  const data = new Map();
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
  const context = { console, localStorage, window: {}, TextEncoder, TextDecoder, btoa, atob,
    crypto: webcrypto, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/core.js', 'utf8') + '\n' +
    fs.readFileSync('js/hub-data.js', 'utf8') + '\n' +
    fs.readFileSync('js/hub-sync.js', 'utf8') + '\n' +
    ';globalThis.parts={Auth,GH,HubData,HubSync,autoBackup}', context);
  const { Auth, GH, HubData, HubSync, autoBackup } = context.parts;
  Auth.ok = () => true;
  Auth.token = () => 'test-token';
  Auth.user = () => ({ login: 'owner' });
  localStorage.setItem('souanpt_site_cfg', JSON.stringify({ name: 'local' }));
  const remote = await HubData.buildFiles();
  const replace = async (key, value) => {
    const file = remote.find(f => f.key === key);
    file.content = JSON.stringify(value, null, 2);
    file.sha256 = await HubData._sha256(file.content);
    file.bytes = file.content.length;
  };
  if (remoteProjects !== undefined) await replace('projects', remoteProjects);
  if (remoteConfig !== undefined) await replace('config', remoteConfig);
  const payload = remote.filter(f => f.key !== 'manifest');
  const manifest = JSON.stringify({ hub: 'souanpt-hub', version: HubData.VERSION,
    files: payload.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })) });
  const files = new Map(payload.map(f => [f.path, f.content]));
  files.set('data/manifest.json', manifest);
  const writes = [];
  GH.api = async (_token, path, opts = {}) => {
    if (opts.method) { writes.push(path); throw new Error('unexpected write'); }
    const name = path.split('/contents/')[1];
    if (!files.has(name)) { const e = new Error('missing'); e.status = 404; throw e; }
    return { content: GH.b64enc(files.get(name)) };
  };
  return { localStorage, HubSync, HubData, GH, autoBackup, writes, files };
}

test('a changed config on two devices blocks backup and leaves GitHub untouched', async () => {
  const { HubSync, autoBackup, writes, localStorage } = await setup(undefined, { name: 'remote' });
  const pulled = await HubSync.boot();
  assert.deepEqual(Array.from(pulled.conflicts), ['config']);
  const saved = await autoBackup({ force: true });
  assert.equal(saved.blocked, true);
  assert.deepEqual(writes, []);
  assert.equal(JSON.parse(localStorage.getItem('souanpt_site_cfg')).name, 'local');
});

test('an empty device pulls its remote projects before any backup write', async () => {
  const { HubSync, autoBackup, writes, localStorage } = await setup([{ id: 'existing-project' }]);
  const pulled = await HubSync.boot();
  assert.ok(pulled.pulled.includes('projects'));
  assert.equal(JSON.parse(localStorage.getItem('hub_projects'))[0].id, 'existing-project');
  const saved = await autoBackup({ force: true });
  assert.equal(saved.skipped, true);
  assert.deepEqual(writes, []);
});

test('a failed remote collection read never turns into an empty backup', async () => {
  const { HubSync, GH, autoBackup, writes } = await setup([{ id: 'existing-project' }]);
  const original = GH.api;
  GH.api = async (token, path, opts) => {
    if (path.endsWith('/data/projects.json')) { const e = new Error('upstream unavailable'); e.status = 503; throw e; }
    return original(token, path, opts);
  };
  const pulled = await HubSync.boot();
  assert.match(pulled.error, /upstream unavailable/);
  const saved = await autoBackup({ force: true });
  assert.equal(saved.blocked, true);
  assert.deepEqual(writes, []);
});
