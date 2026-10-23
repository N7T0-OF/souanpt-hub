import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

/* Le VRAI js/cloud.js, branché sur l'émulateur : Cloud.claimPseudo doit marcher
   avec les nouvelles règles ET avec des règles qui ignorent handles/ (celles
   en production tant que la nouvelle version n'est pas publiée), pour que le
   client puisse être déployé avant les règles. */
const RULES = readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8');
const LEGACY_RULES = `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents {
  match /users/{uid} { allow read: if true; allow write: if request.auth != null && request.auth.uid == uid; }
} }`;

let current, legacy;
before(async () => {
  current = await initializeTestEnvironment({ projectId: 'demo-souanpt-pseudo', firestore: { rules: RULES } });
  legacy = await initializeTestEnvironment({ projectId: 'demo-souanpt-legacy', firestore: { rules: LEGACY_RULES } });
});
after(async () => { await current?.cleanup(); await legacy?.cleanup(); });

const CLOUD_SRC = readFileSync(new URL('../../js/cloud.js', import.meta.url), 'utf8');
function cloudFor(env, uid) {
  // Même royaume JS que le SDK : Firestore refuse les objets d'un contexte vm.
  // Sans FIREBASE_CONFIG, Cloud.init() s'arrête avant de toucher au SDK global.
  const Cloud = new Function('window', CLOUD_SRC + '\nreturn Cloud;')({});
  Cloud._db = env.authenticatedContext(uid).firestore();
  Cloud._user = { uid };
  Cloud.enabled = true;
  return Cloud;
}

test('claimPseudo reserves, refuses a taken pseudo and releases the old one', async () => {
  await current.clearFirestore();
  const alice = cloudFor(current, 'alice'), bob = cloudFor(current, 'bob');
  assert.equal(await alice.claimPseudo('Studio-A', { uid: 'alice', owner: 'alice', verified: false, views: 0 }), 'studio-a');
  assert.equal(await bob.pseudoAvailable('studio-a'), false);
  await assert.rejects(bob.claimPseudo('studio-a'), /déjà pris/);
  await alice.claimPseudo('studio-b');
  assert.equal(await bob.pseudoAvailable('studio-a'), true, 'the previous pseudo was released');
  await bob.claimPseudo('studio-a');
  assert.equal((await current.unauthenticatedContext().firestore().doc('handles/studio-a').get()).data().uid, 'bob');
});

test('ensureHandle reserves a legacy pseudo once and reports a duplicate', async () => {
  await current.clearFirestore();
  await current.withSecurityRulesDisabled(async c => {
    await c.firestore().doc('users/carol').set({ uid: 'carol', owner: 'carol', pseudo: 'carol' });
    await c.firestore().doc('users/dave').set({ uid: 'dave', owner: 'dave', pseudo: 'carol' });
  });
  assert.equal(await cloudFor(current, 'carol').ensureHandle(), 'claimed');
  assert.equal(await cloudFor(current, 'carol').ensureHandle(), 'held');
  assert.equal(await cloudFor(current, 'dave').ensureHandle(), 'taken');
});

test('with rules that predate handles/, the client falls back to the previous write', async () => {
  await legacy.clearFirestore();
  const alice = cloudFor(legacy, 'alice');
  assert.equal(await alice.pseudoAvailable('studio-a'), true);
  assert.equal(await alice.claimPseudo('studio-a', { uid: 'alice', owner: 'alice' }), 'studio-a');
  assert.equal((await legacy.unauthenticatedContext().firestore().doc('users/alice').get()).data().pseudo, 'studio-a');
  assert.equal(await alice.ensureHandle(), 'skip');
});
