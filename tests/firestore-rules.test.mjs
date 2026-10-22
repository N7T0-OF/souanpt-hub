import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');

test('shared links allow direct lookup without public root collection enumeration', () => {
  for (const [collection, id] of [
    ['portals', 'id'],
    ['estimates', 'code'],
    ['requests', 'token'],
    ['public_links', 'token'],
  ]) {
    const start = `match /${collection}/{${id}} {`;
    const at = rules.indexOf(start);
    assert.ok(at >= 0, `${collection} rule is present`);
    const firstWrite = rules.indexOf('allow create:', at);
    assert.ok(firstWrite > at, `${collection} has a create rule`);
    const access = rules.slice(at + start.length, firstWrite);
    assert.match(access, /allow get: if true;/, `${collection} keeps token lookup`);
    assert.doesNotMatch(access, /allow read: if true;|allow list: if true;/, `${collection} must not allow public enumeration`);
  }
  assert.match(rules, /match \/\{col\}\/\{id\} \{\s*allow read:\s*if isOwner\(\);/, 'owner queries remain available');
});

test('internal request notes require owner access and anonymous updates stay public-only', () => {
  const questionsAt = rules.indexOf('match /questions/{qid} {');
  const notificationsAt = rules.indexOf('match /notifications/{id} {', questionsAt);
  assert.ok(questionsAt >= 0 && notificationsAt > questionsAt);
  const questions = rules.slice(questionsAt, notificationsAt);
  assert.match(questions, /allow get: if ownsRequest\(token\) \|\| resource\.data\.get\('internal', true\) == false;/);
  assert.match(questions, /allow list: if ownsRequest\(token\) \|\| resource\.data\.internal == false;/);
  assert.doesNotMatch(questions, /allow read: if true;/);
  assert.match(questions, /allow create: if ownsRequest\(token\) && request\.resource\.data\.internal is bool;/);
  assert.match(questions, /allow update: if request\.resource\.data\.internal is bool && \(/);
  assert.equal((questions.match(/resource\.data\.get\('internal', true\) == false/g) || []).length, 3,
    'get, answer and seenAt all guard internal notes');
});
