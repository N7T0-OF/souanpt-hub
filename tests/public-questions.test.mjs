import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicQuestions } from '../functions/request/[token].js';

test('public question query filters internal notes before Firestore returns documents', async () => {
  let requestedUrl;
  let requestedOptions;
  const questions = await loadPublicQuestions('abc_123', async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return Response.json([
      { document: { name: 'projects/x/databases/(default)/documents/requests/abc_123/questions/q2', fields: {
        internal: { booleanValue: false }, question: { stringValue: 'Public' },
        status: { stringValue: 'pending' }, createdAt: { integerValue: '2' },
      } } },
      { document: { name: 'projects/x/databases/(default)/documents/requests/abc_123/questions/q1', fields: {
        internal: { booleanValue: true }, question: { stringValue: 'Private' },
        status: { stringValue: 'pending' }, createdAt: { integerValue: '1' },
      } } },
      { readTime: '2026-10-21T00:00:00Z' },
    ]);
  });
  assert.equal(new URL(requestedUrl).pathname.endsWith('/requests/abc_123:runQuery'), true);
  assert.equal(requestedOptions.method, 'POST');
  assert.deepEqual(JSON.parse(requestedOptions.body).structuredQuery.where.fieldFilter, {
    field: { fieldPath: 'internal' }, op: 'EQUAL', value: { booleanValue: false },
  });
  assert.deepEqual(questions.map(question => question.id), ['q2']);
  assert.deepEqual(questions.map(question => question.question), ['Public']);
});

test('public question query rejects Firestore errors and malformed responses', async () => {
  await assert.rejects(loadPublicQuestions('abc', async () => new Response('', { status: 403 })), /failed \(403\)/);
  await assert.rejects(loadPublicQuestions('abc', async () => Response.json({ error: 'bad' })), /Invalid public questions response/);
});
