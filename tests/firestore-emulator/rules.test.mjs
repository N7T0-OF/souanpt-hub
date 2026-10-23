import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-souanpt-rules',
    firestore: {
      rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => env.clearFirestore());
after(async () => {
  if (env) await env.cleanup();
});

async function seed(documents) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [path, data] of documents) await setDoc(doc(db, path), data);
  });
}

test('specific root rules cannot be bypassed by an owner field', async () => {
  const db = env.authenticatedContext('alice').firestore();

  await assertFails(setDoc(doc(db, 'users/bob'), { owner: 'alice', pseudo: 'impostor' }));
  await assertFails(setDoc(doc(db, 'users/alice'), { owner: 'alice', email: 'clear@example.test' }));
  await assertFails(setDoc(doc(db, 'portals/new'), { owner: 'alice', password: 'cleartext' }));
  await assertFails(setDoc(doc(db, 'reviews/new'), {
    owner: 'alice', author: 'someone', text: 'unverified', status: 'accepted',
  }));
  await assertFails(setDoc(doc(db, 'notifications/forged'), { owner: 'alice', ownerId: 'alice' }));
  await assertFails(setDoc(doc(db, 'notification_jobs/forged'), { owner: 'alice', ownerId: 'alice' }));

  await seed([
    ['users/alice', { owner: 'alice', email: 'legacy@example.test' }],
    ['portals/legacy', { owner: 'alice', password: 'old-password' }],
    ['notifications/one', { owner: 'alice', ownerId: 'alice', body: 'original' }],
    ['notification_jobs/one', { owner: 'alice', ownerId: 'alice' }],
  ]);
  await assertFails(updateDoc(doc(db, 'users/alice'), { email: 'new-clear@example.test' }));
  await assertFails(updateDoc(doc(db, 'portals/legacy'), { password: 'new-cleartext' }));
  await assertFails(updateDoc(doc(db, 'notifications/one'), { body: 'forged' }));
  await assertFails(deleteDoc(doc(db, 'notification_jobs/one')));

  await assertSucceeds(setDoc(doc(db, 'users/alice'), { name: 'Alice' }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, 'portals/safe'), { owner: 'alice', passwordHash: 'hash', passwordSalt: 'salt' }));
});

/** Réserve un pseudo et l'écrit sur le profil en UN lot, comme Cloud.claimPseudo. */
function claim(db, uid, pseudo, extra = {}, release = null) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'handles', pseudo), { uid, createdAt: 1 });
  batch.set(doc(db, 'users', uid), { ...extra, pseudo }, { merge: true });
  if (release) batch.delete(doc(db, 'handles', release));
  return batch.commit();
}

test('a public pseudo belongs to one account and cannot be taken over', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const guest = env.unauthenticatedContext().firestore();

  await assertSucceeds(claim(alice, 'alice', 'studio-a', { uid: 'alice', owner: 'alice', verified: false, views: 0 }));
  assert.equal((await getDoc(doc(guest, 'handles/studio-a'))).data().uid, 'alice');
  await assertFails(getDocs(collection(guest, 'handles')));

  // Bob ne peut ni reprendre le pseudo, ni l'écrire sans réservation, ni réserver pour un autre.
  await assertFails(claim(bob, 'bob', 'studio-a'));
  await assertFails(setDoc(doc(bob, 'users/bob'), { pseudo: 'studio-a' }));
  await assertFails(setDoc(doc(bob, 'handles/free-one'), { uid: 'alice', createdAt: 1 }));
  await assertFails(deleteDoc(doc(bob, 'handles/studio-a')));
  // Réserver un pseudo que son profil ne porte pas = accumulation, refusée.
  await assertFails(setDoc(doc(bob, 'handles/spare'), { uid: 'bob', createdAt: 1 }));
  await assertFails(claim(bob, 'bob', 'Bad.Name'), 'uppercase and dots are not valid pseudos');

  // Changer de pseudo libère l'ancien dans le même lot ; le garder est refusé.
  await assertFails(claim(alice, 'alice', 'studio-b'));
  await assertSucceeds(claim(alice, 'alice', 'studio-b', {}, 'studio-a'));
  assert.equal((await getDoc(doc(guest, 'handles/studio-a'))).exists(), false);
  await assertSucceeds(claim(bob, 'bob', 'studio-a'));
});

test('legacy pseudos can be claimed once and stay editable', async () => {
  await seed([
    ['users/carol', { uid: 'carol', owner: 'carol', pseudo: 'carol', name: 'Carol' }],
    ['users/dave', { uid: 'dave', owner: 'dave', pseudo: 'carol', name: 'Dave' }],
  ]);
  const carol = env.authenticatedContext('carol').firestore();
  const dave = env.authenticatedContext('dave').firestore();
  await assertSucceeds(updateDoc(doc(dave, 'users/dave'), { name: 'Dave R.' }), 'unchanged legacy pseudo does not block edits');
  await assertSucceeds(setDoc(doc(carol, 'handles/carol'), { uid: 'carol', createdAt: 1 }));
  await assertFails(setDoc(doc(dave, 'handles/carol'), { uid: 'dave', createdAt: 1 }), 'the first claim wins');
  await assertSucceeds(claim(dave, 'dave', 'dave-studio'), 'the duplicate moves to a free pseudo');
});

test('verified badge, ranking counters and identity fields are not self-writable', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(alice, 'users/alice'), { verified: true }));
  await assertFails(setDoc(doc(alice, 'users/alice'), { visitors: 5000 }));
  await assertFails(setDoc(doc(alice, 'users/alice'), { owner: 'bob' }));
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), { uid: 'alice', owner: 'alice', verified: false, views: 0, reviewsAvg: 0, public: true }));

  await assertFails(updateDoc(doc(alice, 'users/alice'), { verified: true }));
  await assertFails(updateDoc(doc(alice, 'users/alice'), { reviewsAvg: 5, reviewsCount: 99 }));
  await assertFails(updateDoc(doc(alice, 'users/alice'), { uid: 'bob' }));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice'), { public: false, siteUrl: 'https://alice.example', analyticsEnabled: true }));
});

test('shared root documents allow direct lookup but only owner-filtered lists', async () => {
  const roots = ['portals', 'estimates', 'requests', 'public_links'];
  await seed(roots.flatMap(root => [
    [`${root}/${root}-alice`, { owner: 'alice', status: 'open' }],
    [`${root}/${root}-bob`, { owner: 'bob', status: 'open' }],
  ]));

  const guest = env.unauthenticatedContext().firestore();
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  for (const root of roots) {
    const shared = await assertSucceeds(getDoc(doc(guest, root, `${root}-alice`)));
    assert.equal(shared.exists(), true);
    await assertFails(getDocs(collection(guest, root)));
    await assertFails(getDocs(collection(alice, root)));
    await assertFails(getDocs(query(collection(bob, root), where('owner', '==', 'alice'))));
    const owned = await assertSucceeds(getDocs(query(collection(alice, root), where('owner', '==', 'alice'))));
    assert.equal(owned.size, 1);
  }
});

test('internal request notes stay private and public answers stay constrained', async () => {
  await seed([
    ['requests/request-1', { owner: 'alice', status: 'open' }],
    ['requests/request-1/questions/public', {
      internal: false, status: 'pending', locked: false, answer: null, seenAt: 0,
    }],
    ['requests/request-1/questions/internal', {
      internal: true, status: 'pending', locked: false, answer: null,
    }],
    ['requests/request-1/questions/legacy', {
      status: 'pending', locked: false, answer: null,
    }],
  ]);

  const guest = env.unauthenticatedContext().firestore();
  const owner = env.authenticatedContext('alice').firestore();
  const publicQuestion = doc(guest, 'requests/request-1/questions/public');
  const internalQuestion = doc(guest, 'requests/request-1/questions/internal');
  const legacyQuestion = doc(guest, 'requests/request-1/questions/legacy');
  const questions = collection(guest, 'requests/request-1/questions');

  await assertSucceeds(getDoc(publicQuestion));
  await assertFails(getDoc(internalQuestion));
  await assertFails(getDoc(legacyQuestion));
  await assertFails(getDocs(questions));
  const visible = await assertSucceeds(getDocs(query(questions, where('internal', '==', false))));
  assert.equal(visible.size, 1);
  const allOwned = await assertSucceeds(getDocs(collection(owner, 'requests/request-1/questions')));
  assert.equal(allOwned.size, 3);

  await assertFails(setDoc(doc(guest, 'requests/request-1/questions/forged'), { internal: false }));
  await assertFails(setDoc(doc(owner, 'requests/request-1/questions/missing-flag'), { status: 'pending' }));
  await assertSucceeds(setDoc(doc(owner, 'requests/request-1/questions/owner-note'), {
    internal: true, status: 'pending', locked: false,
  }));
  await assertFails(updateDoc(internalQuestion, { answer: 'leak', status: 'answered' }));
  await assertFails(updateDoc(legacyQuestion, { answer: 'leak', status: 'answered' }));
  await assertFails(updateDoc(internalQuestion, { internal: false }));
  await assertSucceeds(updateDoc(publicQuestion, { seenAt: 1 }));
  await assertSucceeds(updateDoc(publicQuestion, { answer: 'response', answeredAt: 2, status: 'answered' }));
});
