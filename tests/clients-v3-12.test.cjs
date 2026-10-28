const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function load(file, values = {}) {
  const storage = new Map(Object.entries(values).map(([key,value]) => [key, JSON.stringify(value)]));
  const localStorage = { getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,String(value)) };
  const document = { querySelector:() => null, getElementById:() => null };
  const context = { window:{}, localStorage, document, crypto:webcrypto, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'), context);
  return { ...context, storage, context };
}

test('professional projects are counted once by workspace token and stay separate from portfolio', () => {
  const ctx = load('client-metrics.js', {
    hub_clients:[{id:'a'},{id:'a'},{id:'b'}], hub_projects:[{id:'portfolio'}],
    hub_workspaces:[{token:'one',stage:'request',status:'active'},{token:'two',stage:'done',status:'active'},{token:'three',stage:'request',status:'archived'},{token:'deleted',status:'trashed'}],
  });
  const m = ctx.window.ClientMetrics.collect([{token:'one',projectName:'same linked project'}]);
  assert.equal(m.clients,2);
  assert.equal(m.professionalProjects,3);
  assert.equal(m.activeProjects,1);
  assert.equal(m.completedProjects,1);
  assert.equal(m.portfolioProjects,1);
});

test('file picker fallback uses path names only and never reads file content', () => {
  const ctx = load('client-import.js');
  const importer = ctx.window.ClientImport;
  let captured;
  importer.load = (root,rows,fallback) => { captured = {root,rows,fallback}; };
  const files = [
    { webkitRelativePath:'clients/CLIMB/Logo/source.psd', get arrayBuffer(){ throw Error('file read'); } },
    { webkitRelativePath:'clients/CLIMB/Logo/Sources/design.ai' },
    { webkitRelativePath:'clients/CLIMB/Affiche/final.png' },
    { webkitRelativePath:'clients/Nova/profile.txt' },
  ];
  importer.fromFiles(files);
  assert.equal(captured.root,'clients');
  assert.deepEqual(JSON.parse(JSON.stringify(captured.rows)), [
    {name:'CLIMB',projects:['Logo','Affiche']},{name:'Nova',projects:[]},
  ]);
  assert.equal(captured.fallback,true);
});

test('import plan reuses an existing client and skips a project already in its workspace', () => {
  const ctx = load('client-import.js', {
    hub_clients:[{id:'c1',name:'Climb'}],
  });
  const importer = ctx.window.ClientImport;
  importer.rows = [{name:'CLIMB',projects:['Logo','Affiche']}]; importer.root = 'clients';
  ctx.window.ClientWorkspace = { all:() => [{token:'old',clientId:'c1',clientName:'Climb',projectName:'Logo',status:'active'}] };
  ctx.document.querySelector = selector => selector.includes('data-ci-match') ? {value:'c1'} : {checked:true};
  ctx.document.getElementById = id => id === 'ci-type' ? {value:'Design'} : {checked:true};
  const plan = importer.plan();
  assert.equal(plan.linked,1);
  assert.equal(plan.newClients,0);
  assert.equal(plan.skipped,1);
  assert.equal(plan.entries.length,1);
  assert.equal(plan.entries[0].projectName,'Affiche');
  assert.equal(plan.entries[0].clientId,'c1');
});

test('a similar client name requires an explicit link or distinct new fiche', () => {
  const ctx = load('client-import.js', { hub_clients:[{id:'c1',name:'Climb Studio'}] });
  const importer = ctx.window.ClientImport;
  importer.rows = [{name:'Climb',projects:['Logo']}]; importer.root = 'clients';
  ctx.window.ClientWorkspace = { all:() => [] };
  let choice = '';
  ctx.document.querySelector = selector => selector.includes('data-ci-match') ? {value:choice} : {checked:true};
  ctx.document.getElementById = id => id === 'ci-type' ? {value:''} : {checked:true};
  assert.equal(importer.plan().unresolved,1);
  assert.equal(importer.plan().entries.length,0);
  choice = 'c1';
  assert.equal(importer.plan().unresolved,0);
  assert.equal(importer.plan().entries[0].clientId,'c1');
  choice = '__new__';
  assert.equal(importer.plan().unresolved,0);
  assert.equal(importer.plan().newClients,1);
  assert.equal(importer.plan().entries[0].clientName,'Climb');
  choice = 'deleted-client';
  assert.equal(importer.plan().unresolved,1);
  assert.equal(importer.plan().entries.length,0);
});

test('import review blocks unresolved names before showing the final action', () => {
  const ctx = load('client-import.js', { hub_clients:[{id:'c1',name:'Climb Studio'}] });
  const importer = ctx.window.ClientImport;
  importer.rows = [{name:'Climb',projects:['Logo'],selected:true,selectedProjects:null,matchId:''}];
  ctx.window.ClientWorkspace = { all:() => [] };
  const summary = {innerHTML:'unchanged',textContent:''};
  const preview = {innerHTML:'',querySelector:() => ({value:''})};
  ctx.document.getElementById = id => ({'ci-preview':preview,'ci-summary':summary,
    'ci-attach':{checked:true},'ci-create':{checked:true},'ci-duplicates':{checked:true},'ci-type':{value:''}})[id] || null;
  ctx.document.querySelector = selector => selector.includes('data-ci-match') ? {value:'',focus() {}} : {checked:true};
  let message = ''; importer.status = value => { message = value; };
  importer.preview();
  assert.match(preview.innerHTML,/Créer une nouvelle fiche distincte/);
  importer.confirm();
  assert.match(message,/Vérifie 1 client/);
  assert.equal(summary.innerHTML,'unchanged');
});

test('unified search handles accents, spacing and local professional projects', () => {
  const ctx = load('clients.js', { hub_clients:[{id:'c1',name:'École Créative'}] });
  const cp = ctx.window.CP;
  cp._links = [{token:'local-1',clientId:'c1',clientName:'École Créative',projectName:'Création Logo',projectType:'Identité visuelle',localOnly:true}];
  cp.search = cp.normalize('  creation   LOgo ');
  assert.equal(cp._filteredLinks().length,1);
  assert.equal(cp.matchesClient({id:'c1',name:'École Créative'}),true);
  cp.search = cp.normalize('absent');
  assert.equal(cp._filteredLinks().length,0);
  cp.search = cp.normalize('école');
  cp.searchKind = 'clients';
  assert.equal(cp._filteredLinks().length,0);
  assert.equal(cp.matchesClient({id:'c1',name:'École Créative'}),true);
});

test('confirmed folder import creates private workspace data and is idempotent', async () => {
  const ctx = load('client-import.js', { hub_clients:[], hub_workspaces:[] });
  const importer = ctx.window.ClientImport;
  importer.root = 'clients'; importer.rows = [{name:'Nova',projects:['Logo']}];
  importer.status = () => {};
  const area = {innerHTML:''};
  ctx.document.getElementById = id => ({
    'ci-preview':area, 'ci-attach':{checked:true}, 'ci-create':{checked:true},
    'ci-duplicates':{checked:true}, 'ci-type':{value:'Design'},
  })[id] || null;
  ctx.document.querySelector = selector => selector.includes('data-ci-match') ? {value:''} : {checked:true};
  const workspace = {
    all:() => JSON.parse(ctx.localStorage.getItem('hub_workspaces') || '[]'),
    _ensureIn(items,token,patch) { const w={token,...patch,status:'active',createdAt:Date.now()}; items.push(w); return w; },
    save:items => ctx.localStorage.setItem('hub_workspaces',JSON.stringify(items)),
  };
  ctx.window.ClientWorkspace = workspace; ctx.context.ClientWorkspace = workspace;
  await importer.importNow();
  const clients = JSON.parse(ctx.localStorage.getItem('hub_clients'));
  const projects = workspace.all();
  assert.equal(clients.length,1);
  assert.equal(projects.length,1);
  assert.equal(projects[0].clientId,clients[0].id);
  assert.equal(projects[0].localOnly,true);
  assert.equal(projects[0].origin,'directory_import');
  assert.equal(ctx.localStorage.getItem('hub_projects'),null);
  assert.ok(ctx.localStorage.getItem(importer.report.recoveryKey));
  assert.equal(importer.plan().entries.length,0);
});

test('explicitly distinct client with no projects creates only a private client fiche', async () => {
  const ctx = load('client-import.js', {
    hub_clients:[{id:'c1',name:'Climb Studio'}], hub_workspaces:[],
  });
  const importer = ctx.window.ClientImport;
  importer.root = 'clients'; importer.rows = [{name:'Climb',projects:[]}];
  importer.status = () => {};
  const area = {innerHTML:''};
  ctx.document.getElementById = id => ({
    'ci-preview':area, 'ci-attach':{checked:true}, 'ci-create':{checked:true},
    'ci-duplicates':{checked:true}, 'ci-type':{value:''},
  })[id] || null;
  ctx.document.querySelector = selector => selector.includes('data-ci-match') ? {value:'__new__'} : {checked:true};
  const workspace = { all:() => JSON.parse(ctx.localStorage.getItem('hub_workspaces') || '[]'),
    save:items => ctx.localStorage.setItem('hub_workspaces',JSON.stringify(items)) };
  ctx.window.ClientWorkspace = workspace; ctx.context.ClientWorkspace = workspace;
  await importer.importNow();
  const names = JSON.parse(ctx.localStorage.getItem('hub_clients')).map(c => c.name);
  assert.deepEqual(names,['Climb Studio','Climb']);
  assert.equal(workspace.all().length,0);
  assert.deepEqual(Array.from(importer.report.createdClients),['Climb']);
});

test('dashboard inline scripts remain valid JavaScript after adding import controls', () => {
  const html = fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
  for (const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script.trim()) new vm.Script(script);
  }
  assert.match(html, /id="cp-search"/);
  assert.match(html, /ClientImport\.open\(\)/);
});

test('bulk changes affect only private workspaces and trash is recoverable', () => {
  const initial = [
    {token:'private',projectName:'Logo',localOnly:true,status:'active'},
    {token:'public',projectName:'Site',localOnly:false,status:'active'},
  ];
  const ctx = load('clients.js', {hub_workspaces:initial, hub_clients:[{id:'c1',name:'Nova'}]});
  const cp = ctx.window.CP;
  const workspace = { all:() => JSON.parse(ctx.localStorage.getItem('hub_workspaces')),
    save:list => ctx.localStorage.setItem('hub_workspaces',JSON.stringify(list)) };
  ctx.window.ClientWorkspace = workspace; ctx.context.ClientWorkspace = workspace;
  ctx.window.confirm = () => true;
  ctx.document.getElementById = id => ({'cp-bulk-type':{value:'Illustration'},
    'cp-bulk-status':{value:'archived'},'cp-bulk-client':{value:'c1'}})[id] || null;
  cp._paint = () => {}; cp._badge = () => {};
  cp._links = initial;
  cp.selectedTokens.add('private'); cp.selectedTokens.add('public');
  cp.bulk('type');
  assert.equal(workspace.all()[0].projectType,'Illustration');
  assert.equal(workspace.all()[1].projectType,undefined);
  cp.selectedTokens.add('private'); cp.bulk('trash');
  assert.equal(workspace.all()[0].status,'trashed');
  cp.restoreTrash('private');
  assert.equal(workspace.all()[0].status,'active');
});

test('local suggestions flag orphan projects without changing stored data', () => {
  const ctx = load('clients.js', {hub_clients:[{id:'c1',name:'Nova'}]});
  const cp = ctx.window.CP;
  cp._links = [{token:'orphan',projectName:'Logo',clientName:'Unknown',localOnly:true}];
  const before = ctx.localStorage.getItem('hub_clients');
  assert.match(cp._insights(), /Fiche client à rattacher/);
  assert.equal(ctx.localStorage.getItem('hub_clients'),before);
});
