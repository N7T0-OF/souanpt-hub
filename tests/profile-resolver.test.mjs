import test from 'node:test';
import assert from 'node:assert/strict';
import { findCreator } from '../functions/u/[pseudo].js';

const str = v => ({ stringValue: v });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Annuaire simulé : réservations, profils, et requête « pseudo == x » héritée. */
function directory({ handles = {}, users = {} }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push(u.pathname.split('/documents')[1] || u.pathname);
    let m;
    if ((m = /\/documents\/handles\/([^/]+)$/.exec(u.pathname))) {
      const uid = handles[m[1]];
      return uid ? json({ fields: { uid: str(uid) } }) : json({ error: { code: 404 } }, 404);
    }
    if ((m = /\/documents\/users\/([^/]+)$/.exec(u.pathname))) {
      const p = users[m[1]];
      return p ? json({ fields: { pseudo: str(p.pseudo), siteUrl: str(p.siteUrl || '') } }) : json({ error: { code: 404 } }, 404);
    }
    if (u.pathname.endsWith(':runQuery')) {
      const wanted = JSON.parse(init.body).structuredQuery.where.fieldFilter.value.stringValue;
      const rows = Object.entries(users).filter(([, p]) => p.pseudo === wanted)
        .map(([id, p]) => ({ document: { name: id, fields: { pseudo: str(p.pseudo), siteUrl: str(p.siteUrl || '') } } }));
      return json(rows.length ? rows : [{ readTime: 'x' }]);
    }
    throw new Error('unexpected ' + url);
  };
  return { fetchImpl, calls };
}

test('a reserved pseudo resolves to its holder even if another profile copied it', async () => {
  const { fetchImpl, calls } = directory({
    handles: { studio: 'alice' },
    users: { alice: { pseudo: 'studio', siteUrl: 'https://alice.example' }, mallory: { pseudo: 'studio', siteUrl: 'https://evil.example' } },
  });
  const { user } = await findCreator('Studio', fetchImpl);
  assert.equal(user.siteUrl.stringValue, 'https://alice.example');
  assert.ok(!calls.some(c => c.includes('runQuery')), 'the legacy query is not used when a reservation exists');
});

test('a stale reservation (profile moved away) resolves to nobody', async () => {
  const { fetchImpl } = directory({ handles: { old: 'alice' }, users: { alice: { pseudo: 'new' } } });
  assert.equal((await findCreator('old', fetchImpl)).user, null);
});

test('legacy pseudos still resolve, but duplicates are refused instead of picked at random', async () => {
  const single = directory({ users: { carol: { pseudo: 'carol', siteUrl: 'https://carol.example' } } });
  assert.equal((await findCreator('carol', single.fetchImpl)).user.siteUrl.stringValue, 'https://carol.example');

  const dup = directory({ users: { carol: { pseudo: 'carol' }, dave: { pseudo: 'carol' } } });
  assert.deepEqual(await findCreator('carol', dup.fetchImpl), { ambiguous: true });

  const none = directory({});
  assert.equal((await findCreator('ghost', none.fetchImpl)).user, null);
});

test('directory errors surface instead of falling through to the legacy lookup', async () => {
  const failing = async () => json({ error: 'boom' }, 503);
  await assert.rejects(findCreator('studio', failing), /annuaire 503/);
});
