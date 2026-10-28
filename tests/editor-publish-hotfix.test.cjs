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
    ';globalThis.exported={GH,Auth,SiteConfig,SiteAutoPublish,generateSite,buildAnalyticsProjectManifest,deployPortfolio,publishPortal,verifyPortal,ensureReviewClient};', context);
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
  const newSha = 'a'.repeat(40), oldSha = 'b'.repeat(40);
  let committed, polls = 0;
  GH.ensureRepo = async () => {}; GH.enablePages = async () => {};
  GH.commitFiles = async (_token, _owner, _repo, files) => { committed = files; return newSha; };
  GH.pagesInfo = async () => ({ html_url: 'https://owner.github.io/site/' });
  GH.pagesLatestBuild = async () => (++polls === 1
    ? { status: 'built', commit: oldSha }
    : { status: 'built', commit: newSha });
  const result = await deployPortfolio();
  assert.equal(result.verified, true);
  assert.equal(result.sha, newSha);
  assert.equal(polls, 2);
  const manifest = JSON.parse(committed.find(f => f.path === 'site-config.json').content);
  assert.equal(manifest.lastDeploy, undefined);
  assert.equal(manifest.contactMethods, undefined);
  assert.equal(manifest.projectTags, undefined);
  assert.doesNotMatch(committed.find(f => f.path === 'index.html').content, /private phone|Unpublished draft/);
  assert.equal(JSON.parse(localStorage.getItem(SiteConfig._K)).lastDeploy.sha, newSha);
  assert.equal(SiteConfig.get().autoPublish, true, 'la première publication vérifiée active les futures mises à jour');
});

test('an explicit auto-publish opt-out survives a manual publication', async () => {
  const { GH, Auth, SiteConfig, deployPortfolio } = loadCore();
  Auth.ok = () => true; Auth.token = () => 'token'; Auth.owner = () => 'owner';
  SiteConfig.save({ ...SiteConfig.defaults(), repo: 'owner/site', autoPublishChoice: 'off' });
  GH.ensureRepo = async () => {}; GH.enablePages = async () => {};
  const manualSha = 'c'.repeat(40);
  GH.commitFiles = async () => manualSha;
  GH.pagesInfo = async () => ({ html_url: 'https://owner.github.io/site/' });
  GH.pagesLatestBuild = async () => ({ status: 'built', commit: manualSha });
  assert.equal((await deployPortfolio()).verified, true);
  assert.equal(SiteConfig.get().autoPublish, false);
});

test('portal publication waits for its own Pages build and later builds still verify it', async () => {
  const { GH, Auth, SiteConfig, publishPortal, verifyPortal, localStorage, context } = loadCore();
  context.setTimeout = callback => { callback(); return 0; };
  Auth.ok = () => true; Auth.token = () => 'token'; Auth.owner = () => 'owner';
  SiteConfig.save({ ...SiteConfig.defaults(), repo: 'owner/site' });
  GH.ensureRepo = async () => {}; GH.enablePages = async () => {};
  GH.fileSha = async () => 'page-blob';
  GH.commitFiles = async () => 'portal-sha';
  GH.api = async () => ({ sha: 'portal-blob' });
  let polls = 0;
  GH.pagesLatestBuild = async () => (++polls === 1
    ? { status: 'built', commit: 'older-sha' }
    : { status: 'built', commit: 'portal-sha' });
  const result = await publishPortal({ id: 'portal-1', mission: 'Logo', active: false });
  assert.equal(result.built, true);
  assert.equal(result.sha, 'portal-sha');
  assert.equal(result.fileSha, 'portal-blob');
  assert.equal(polls, 2);

  localStorage.setItem('hub_portals', JSON.stringify([{ id: 'portal-1', deploySha: 'portal-sha', deployFileSha: 'portal-blob' }]));
  GH.pagesLatestBuild = async () => ({ status: 'built', commit: 'newer-site-sha' });
  assert.equal((await verifyPortal('portal-1')).ok, true);
});

test('project filters, analytics manifest, branding and optional audio work in all three public themes', () => {
  const { SiteConfig, generateSite, buildAnalyticsProjectManifest } = loadCore();
  const project = { id: 'p1', title: 'Exemple', tags: ['Motion', 'Logo'], cover: '' };
  for (const layoutStyle of ['float', 'sidebar', 'bento']) {
    const html = generateSite({ ...SiteConfig.defaults(), layoutStyle,
      siteLogo: 'https://example.com/logo.png', favicon: 'https://example.com/icon.png',
      titleEffect: 'glow', backgroundMusic: 'https://example.com/music.mp3' }, [project], []);
    assert.match(html, /data-tag="motion"/);
    assert.match(html, /data-tags="\[&quot;motion&quot;,&quot;logo&quot;\]"/);
    const manifest = buildAnalyticsProjectManifest(html, [project]);
    assert.equal(manifest.error, null);
    assert.equal(JSON.stringify(manifest.entries), JSON.stringify([{ id: 'p1', title: 'Exemple' }]));
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

test('sidebar preferences alter only the sidebar layout and keep other themes intact', () => {
  const { SiteConfig, generateSite } = loadCore();
  const cfg = { ...SiteConfig.defaults(), sidebarPrefs:{ position:'right', width:280, gap:20,
    radius:6, fontSize:15, background:'#121212', textColor:'#dddddd', compact:true,
    showCategories:false, showContact:false, hoverLift:true }, email:'me@example.com' };
  const sidebar = generateSite({ ...cfg, layoutStyle:'sidebar' }, [], []);
  assert.match(sidebar, /flex-direction:row-reverse/);
  assert.match(sidebar, /\.sb-side\{width:280px/);
  assert.match(sidebar, /background:#121212/);
  assert.doesNotMatch(sidebar, /class="sb-cta"/);
  for (const layoutStyle of ['float','bento']) {
    const html = generateSite({ ...cfg, layoutStyle }, [], []);
    assert.doesNotMatch(html, /class="sb-side"/);
    assert.match(html, /me@example\.com/);
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

test('adding a client survives a form repaint and an unavailable auto publication', () => {
  const data = new Map();
  const localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
  const viewed = [], notices = [];
  const CP = {
    _clientDraft: { name: 'Nouveau client', type: 'Design' }, _clientFormOpen: true,
    viewClient: id => viewed.push(id), checkClientDuplicate() {},
  };
  const context = {
    console: { warn() {} }, localStorage, CP,
    document: { getElementById: () => null },
    SiteAutoPublish: { queue() { throw new Error('publication indisponible'); } },
    showToast: message => notices.push(message),
  };
  vm.createContext(context);
  const html = fs.readFileSync('app.html', 'utf8');
  vm.runInContext(html.slice(html.indexOf('function addClient()'), html.indexOf('function deleteClient(')), context);
  context.addClient();
  const saved = JSON.parse(localStorage.getItem('hub_clients'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Nouveau client');
  assert.equal(saved[0].type, 'Design');
  assert.equal(viewed[0], saved[0].id);
  assert.equal(CP._clientFormOpen, false);
  assert.match(notices.at(-1), /Client ajouté/);
  CP._clientDraft.name = 'Nouveau client';
  context.addClient();
  assert.equal(JSON.parse(localStorage.getItem('hub_clients')).length, 1);
  assert.match(notices.at(-1), /existe déjà/);
});

test('anonymous preview mode works only on deployment previews and never creates an admin session', () => {
  const saved = new Map();
  const sessionStorage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const banner = { hidden: true };
  const calls = [];
  const location = { hostname: '505beab1.souanptjub.pages.dev' };
  let connected = false;
  const Auth = { ok: () => connected };
  const context = { location, sessionStorage, Auth, Cloud: { user: () => null },
    document: { getElementById: id => id === 'preview-mode-banner' ? banner : null },
    window: { CP: { setView: view => calls.push(view) }, addEventListener() {} },
    gateHide: () => calls.push('hide'), gateShow: () => calls.push('gate'),
    showPage: page => calls.push(page), showToast() {} };
  vm.createContext(context);
  const html = fs.readFileSync('app.html', 'utf8');
  vm.runInContext(html.slice(html.indexOf('const PreviewMode ='), html.indexOf('function gateShow()')) +
    ';globalThis.previewMode=PreviewMode;', context);
  context.previewMode.enter();
  assert.equal(context.previewMode.active(), true);
  assert.equal(banner.hidden, false);
  assert.deepEqual(calls, ['hide', 'cp', 'clients']);
  assert.equal(Auth.ok(), false);

  context.previewMode.leave();
  assert.equal(banner.hidden, true);
  assert.equal(calls.at(-1), 'gate');
  location.hostname = 'souanptjub.pages.dev';
  context.previewMode.enter();
  assert.equal(context.previewMode.active(), false);
  assert.equal(saved.size, 0);
  location.hostname = '505beab1.souanptjub.pages.dev';
  connected = true;
  context.previewMode.enter();
  assert.equal(saved.size, 0);
});

test('manual projects link to an existing client and create a new fiche only when needed', () => {
  const data = new Map([['hub_clients', JSON.stringify([{ id: 'alice', name: 'Alice' }])]]);
  const localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
  const fields = {
    'cp-manual-client': { value: ' alice ' },
    'cp-manual-name': { value: 'Identité' },
    'cp-manual-type': { value: 'Design' },
  };
  const match = { hidden: true, replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); } };
  const workspaces = [];
  const ClientWorkspace = {
    all: () => workspaces,
    ensure(token, patch) { const item = { token, ...patch }; workspaces.push(item); localStorage.setItem('hub_workspaces', JSON.stringify(workspaces)); return item; },
    open(token) { opened.push(token); },
  };
  let queued = 0, viewed = '', synced = 0, uuid = 0;
  const opened = [];
  const context = { console, localStorage, ClientWorkspace, SiteAutoPublish: { queue: () => queued++ },
    crypto: { randomUUID: () => `${String(++uuid).padStart(8,'0')}-1234-1234-1234-123456789abc` },
    syncKPIs: () => synced++,
    window: { ClientWorkspace, showToast() {} },
    document: {
      getElementById: id => id === 'cp-manual-match' ? match : fields[id] || null,
      createElement: () => ({ textContent: '', onclick: null }),
      querySelectorAll: () => [],
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/clients.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/client-metrics.js', 'utf8'), context);
  const CP = context.window.CP;
  CP._paint = () => {}; CP._badge = () => {}; CP.viewClient = id => { viewed = id; };
  assert.equal(CP.checkManualClient().id, 'alice');
  assert.equal(match.hidden, false);
  assert.match(match.children[0].textContent, /déjà existant/);
  CP.saveManual();
  assert.equal(JSON.parse(localStorage.getItem('hub_clients')).length, 1);
  assert.equal(workspaces[0].clientId, 'alice');
  assert.equal(workspaces[0].projectType, 'Design');
  assert.equal(workspaces[0].localOnly, true);
  assert.equal(viewed, 'alice');
  assert.equal(queued, 0);
  assert.deepEqual(opened, [workspaces[0].token]);
  assert.equal(synced, 1);
  assert.equal(context.window.ClientMetrics.collect().professionalProjects, 1);

  fields['cp-manual-client'].value = 'Bob';
  fields['cp-manual-name'].value = 'Site';
  CP.saveManual();
  assert.equal(JSON.parse(localStorage.getItem('hub_clients')).length, 2);
  assert.equal(workspaces[1].clientName, 'Bob');
  assert.equal(queued, 1);
  assert.deepEqual(opened, workspaces.map(w => w.token));
  assert.equal(synced, 2);
  assert.equal(context.window.ClientMetrics.collect().professionalProjects, 2);
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
  context.document = { addEventListener: () => {} };
  vm.runInContext(fs.readFileSync('js/analytics.js', 'utf8'), context);
  assert.match(context.window.Analytics._emptyMsg(), /Statistiques cloud suspendues/);
});
