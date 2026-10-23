import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

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

  await assertSucceeds(setDoc(doc(db, 'users/alice'), { pseudo: 'alice' }));
  await assertSucceeds(setDoc(doc(db, 'portals/safe'), { owner: 'alice', passwordHash: 'hash', passwordSalt: 'salt' }));
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
