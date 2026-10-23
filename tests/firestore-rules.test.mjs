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
    assert.match(access, /allow list: if isOwner\(\);/, `${collection} keeps owner-filtered queries`);
    assert.doesNotMatch(access, /allow read: if true;|allow list: if true;/, `${collection} must not allow public enumeration`);
  }
  assert.doesNotMatch(rules, /match \/\{col\}\/\{id\} \{/, 'a generic root match must not override collection-specific write restrictions');
});

test('sensitive root collections rely only on their explicit write rules', () => {
  assert.match(rules, /match \/users\/\{uid\} \{[\s\S]*?allow create: if owns\(uid\) && emailAllowed\(request\.resource\.data\);/);
  assert.match(rules, /match \/portals\/\{id\} \{[\s\S]*?allow create: if creatingSelf\(\) && passwordAllowed\(request\.resource\.data\);/);
  assert.match(rules, /match \/notifications\/\{id\} \{[\s\S]*?allow create, delete: if false;/);
  assert.match(rules, /match \/notification_jobs\/\{id\} \{[\s\S]*?allow write: if false;/);
  assert.doesNotMatch(rules, /match \/\{col\}\/\{id\} \{/, 'a wildcard root writer would bypass these checks through OR semantics');
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
