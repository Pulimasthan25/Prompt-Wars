const { test } = require('node:test');
const assert = require('node:assert/strict');

test('hashInput is stable for same string', () => {
  const { hashInput } = require('../lib/firestoreBrief');
  assert.equal(hashInput('hello'), hashInput('hello'));
  assert.notEqual(hashInput('a'), hashInput('b'));
});

test('saveBriefSnapshot resolves when Firestore is disabled', async () => {
  const prev = process.env.ENABLE_FIRESTORE;
  delete process.env.ENABLE_FIRESTORE;
  const { saveBriefSnapshot } = require('../lib/firestoreBrief');
  await assert.doesNotReject(() =>
    saveBriefSnapshot('input text', {
      severity: 'LOW',
      incident_type: 'test',
      time_sensitivity: 'minutes',
      confidence: 0.2,
    })
  );
  if (prev !== undefined) process.env.ENABLE_FIRESTORE = prev;
});
