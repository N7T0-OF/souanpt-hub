const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCore() {
  const data = new Map();
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
  const context = { console, setTimeout, localStorage, window: {}, document: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/core.js', 'utf8') +
    ';globalThis.exported={GH,Auth,SiteConfig,generateSite,deployPortfolio,ensureReviewClient};', context);
  return { ...context.exported, localStorage, context };
}

test('GitHub ref reads bypass the browser cache in both auth modes', async () => {
  const { GH, context } = loadCore();
  const requests = [];
  context.fetch = async (url, init) => { requests.push({ url, init }); return {}; };
  GH.relayBase = () => 'https://souanptjub.pages.dev';
  GH.relayMode = () => true;
  await GH.req('/repos/owner/site/git/ref/heads/main');
  GH.relayMode = () => false;
  await GH.req('/repos/owner/site/git/ref/heads/main');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => r.init.cache), ['no-store', 'no-store']);
  assert.equal(requests[0].init.credentials, 'include');
});

test('publication skips a duplicate commit when the desired files are already live', async () => {
  const { GH } = loadCore();
  const writes = [];
  GH.api = async (_token, path, opts = {}) => {
    if (opts.method) writes.push(path);
    if (path === '/repos/owner/site') return { default_branch: 'main' };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: 'live-commit' } };
    if (path.endsWith('/git/commits/live-commit')) return { tree: { sha: 'live-tree' } };
    if (path.endsWith('/git/trees')) return { sha: 'live-tree' };
    throw new Error('Unexpected path: ' + path);
  };
  assert.equal(await GH.commitFiles('token', 'owner', 'site',
    [{ path: 'index.html', content: '<h1>live</h1>' }], 'deploy'), 'live-commit');
  assert.deepEqual(writes, ['/repos/owner/site/git/trees']);
});

test('relay never forwards a cacheable GitHub response to the browser', async () => {
  const { onRequest } = await import('../functions/api/gh.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"object":{"sha":"fresh"}}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' },
    });
    const request = new Request('https://souanptjub.pages.dev/api/gh?path=%2Frepos%2Fowner%2Fsite%2Fgit%2Fref%2Fheads%2Fmain', {
      headers: { cookie: 'hub_gh=' + encodeURIComponent(JSON.stringify({ t: 'test-token' })), origin: 'https://souanptjub.pages.dev' },
    });
    const response = await onRequest({ request, env: {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).object.sha, 'fresh');
  } finally { globalThis.fetch = originalFetch; }
});

test('publication retries a moved GitHub branch without force pushing', async () => {
  const { GH } = loadCore();
  const calls = [];
  let head = 'base-1', patches = 0, blobs = 0;
  GH.api = async (_token, path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/repos/owner/site') return { default_branch: 'main' };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: head } };
    if (path.endsWith('/git/commits/base-1')) return { tree: { sha: 'tree-1' } };
    if (path.endsWith('/git/commits/base-2')) return { tree: { sha: 'tree-2' } };
    if (path.endsWith('/git/blobs')) { blobs++; return { sha: 'blob-1' }; }
    if (path.endsWith('/git/trees')) return { sha: 'tree-new-' + JSON.parse(opts.body).base_tree };
    if (path.endsWith('/git/commits')) return { sha: 'commit-' + JSON.parse(opts.body).parents[0] };
    if (path.endsWith('/git/refs/heads/main')) {
      patches++;
      assert.equal(JSON.parse(opts.body).force, false);
      if (patches === 1) {
        head = 'base-2';
        throw Object.assign(new Error('Update is not a fast forward'), { status: 422 });
      }
      return {};
    }
    throw new Error('Unexpected path: ' + path);
  };
  const sha = await GH.commitFiles('token', 'owner', 'site',
    [{ path: 'index.html', content: '<h1>new</h1>' }, { path: 'image.gif', b64: 'R0lG' }], 'deploy');
  assert.equal(sha, 'commit-base-2');
  assert.equal(patches, 2);
  assert.equal(blobs, 1);
  assert.deepEqual(calls.filter(c => c.path.endsWith('/git/commits') && c.opts.method === 'POST')
    .map(c => JSON.parse(c.opts.body).parents[0]), ['base-1', 'base-2']);
});

test('creating a review client is case insensitive and never duplicates', () => {
  const { ensureReviewClient, localStorage } = loadCore();
  assert.equal(ensureReviewClient('  Alice   Design  '), true);
  assert.equal(ensureReviewClient('alice design'), false);
  assert.equal(ensureReviewClient('Visiteur'), false);
  assert.equal(JSON.parse(localStorage.getItem('hub_clients')).length, 1);
});

test('generated portfolio includes readable reviews and optional wheel smoothing', () => {
  const { SiteConfig, generateSite } = loadCore();
  const cfg = { ...SiteConfig.defaults(), smoothWheel: true, repo: 'owner/site' };
  const html = generateSite(cfg, [], [{ author: 'Alice', text: 'Très bien', rating: 5, status: 'approved' }]);
  assert.match(html, /\.rt\{font-size:16px/);
  assert.match(html, /Défilement|addEventListener\('wheel'/);
  for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script.trim()) new vm.Script(script);
  }
  const without = generateSite({ ...cfg, smoothWheel: false }, [], []);
  assert.doesNotMatch(without, /addEventListener\('wheel'/);
});

test('publication waits for the build of its own commit and omits local deployment metadata', async () => {
  const { GH, Auth, SiteConfig, deployPortfolio, localStorage, context } = loadCore();
  context.setTimeout = callback => { callback(); return 0; };
  Auth.ok = () => true; Auth.token = () => 'token'; Auth.owner = () => 'owner';
  SiteConfig.save({ ...SiteConfig.defaults(), repo: 'owner/site',
    lastDeploy: { url: 'https://old.example/', ts: 1 },
    contactMethods: [{ id: 'phone', on: false, value: 'private phone' }],
    projectTags: ['Unpublished draft'] });
  let committed, polls = 0;
  GH.ensureRepo = async () => {}; GH.enablePages = async () => {};
  GH.commitFiles = async (_token, _owner, _repo, files) => { committed = files; return 'new-sha'; };
  GH.pagesInfo = async () => ({ html_url: 'https://owner.github.io/site/' });
  GH.pagesLatestBuild = async () => (++polls === 1
    ? { status: 'built', commit: 'old-sha' }
    : { status: 'built', commit: 'new-sha' });
  const result = await deployPortfolio();
  assert.equal(result.verified, true);
  assert.equal(result.sha, 'new-sha');
  assert.equal(polls, 2);
  const manifest = JSON.parse(committed.find(f => f.path === 'site-config.json').content);
  assert.equal(manifest.lastDeploy, undefined);
  assert.equal(manifest.contactMethods, undefined);
  assert.equal(manifest.projectTags, undefined);
  assert.doesNotMatch(committed.find(f => f.path === 'index.html').content, /private phone|Unpublished draft/);
  assert.equal(JSON.parse(localStorage.getItem(SiteConfig._K)).lastDeploy.sha, 'new-sha');
});

test('project filters, branding and optional audio work in all three public themes', () => {
  const { SiteConfig, generateSite } = loadCore();
  const project = { id: 'p1', title: 'Exemple', tags: ['Motion', 'Logo'], cover: '' };
  for (const layoutStyle of ['float', 'sidebar', 'bento']) {
    const html = generateSite({ ...SiteConfig.defaults(), layoutStyle,
      siteLogo: 'https://example.com/logo.png', favicon: 'https://example.com/icon.png',
      titleEffect: 'glow', backgroundMusic: 'https://example.com/music.mp3' }, [project], []);
    assert.match(html, /data-tag="motion"/);
    assert.match(html, /data-tags="\[&quot;motion&quot;,&quot;logo&quot;\]"/);
    assert.match(html, /class="site-sound"/);
    assert.match(html, /rel="icon" href="https:\/\/example.com\/icon.png"/);
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (script.trim()) new vm.Script(script);
    }
  }
});

test('custom logo and site name can appear together in every public layout', () => {
  const { SiteConfig, generateSite } = loadCore();
  for (const layoutStyle of ['float', 'sidebar', 'bento']) {
    const html = generateSite({ ...SiteConfig.defaults(), layoutStyle,
      siteName: 'Folio', siteLogo: 'https://example.com/logo.png',
      brandMode: 'both', brandSize: 48 }, [], []);
    assert.match(html, /class="brand-img" style="width:48px;height:48px"/);
    assert.match(html, /Folio/);
  }
});

test('Clients & Projets keeps local workspaces visible without Firebase', async () => {
  const data = new Map();
  const localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
  const local = { token: 'local-token', clientName: 'Alice', projectName: 'Identité', localOnly: true };
  const ClientWorkspace = { all: () => [local], migrate: async () => ({}) };
  const body = { innerHTML: '' };
  const context = { console, localStorage, ClientWorkspace,
    window: { ClientWorkspace }, document: { getElementById: id => id === 'cp-body' ? body : null } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/clients.js', 'utf8'), context);
  const CP = context.window.CP;
  CP._paint = () => { body.innerHTML = CP._links.map(x => x.projectName).join(','); };
  await CP.render();
  assert.equal(body.innerHTML, 'Identité');
  assert.equal(CP._links[0].localOnly, true);
  assert.match(CP._actions(CP._links[0]), /Local/);
  assert.doesNotMatch(CP._actions(CP._links[0]), /Ouvrir le lien client/);
});

test('a portal launched from a client dossier keeps that exact project link', () => {
  const data = new Map();
  const localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
  const calls = [];
  const context = { console, localStorage, setTimeout: fn => fn(),
    document: { getElementById: () => null, addEventListener: () => {} },
    window: { showPage: page => calls.push(page), portalOpenForm: prefill => calls.push(prefill) } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/client-workspace.js', 'utf8'), context);
  const ClientWorkspace = context.window.ClientWorkspace;
  ClientWorkspace.ensure('project-1', { clientName: 'Alice', projectName: 'Logo' });
  ClientWorkspace.ensure('project-2', { clientName: 'Alice', projectName: 'Site' });
  ClientWorkspace._current = { w: ClientWorkspace.get('project-2') };
  ClientWorkspace.editPortal('');
  assert.equal(calls[0], 'portals');
  assert.equal(calls[1].workspaceId, 'project-2');
  localStorage.setItem('hub_portals', JSON.stringify([{ id: 'portal-1', client: 'Alice' }]));
  assert.equal(ClientWorkspace.attach('portal-1', 'project-2', 'portal'), true);
  assert.equal(JSON.parse(localStorage.getItem('hub_portals'))[0].workspaceId, 'project-2');
  assert.equal(ClientWorkspace.get('project-2').refs.portal, 'portal-1');
  assert.equal(ClientWorkspace.get('project-1').refs.portal, undefined);
});

test('public Firebase functions use the same project settings as the dashboard', async () => {
  const { PROJECT_ID, WEB_API_KEY, STORAGE_BUCKET } = await import('../firebase/edge-config.js');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('firebase/firebase-config.js', 'utf8'), context);
  const cfg = context.window.FIREBASE_CONFIG;
  assert.equal(PROJECT_ID, cfg.projectId);
  assert.equal(WEB_API_KEY, cfg.apiKey);
  assert.equal(STORAGE_BUCKET, cfg.storageBucket);
  await Promise.all(['c/[token].js', 'request/[token].js', 'estimate/[code].js', 'u/[pseudo].js']
    .map(path => import('../functions/' + path)));
});

test('invalid legacy Firebase config leaves GitHub access available', () => {
  const context = { console, window: { FIREBASE_CONFIG: { disabled: true, apiKey: 'invalid' } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/cloud.js', 'utf8'), context);
  assert.equal(context.window.Cloud.enabled, false);
  assert.match(context.window.Cloud.unavailableReason, /Firebase est suspendu/);
});
