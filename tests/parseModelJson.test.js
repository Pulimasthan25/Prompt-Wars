const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseModelJson } = require('../lib/parseModelJson');

test('parseModelJson parses plain JSON object', () => {
  const out = parseModelJson('{"severity":"LOW","confidence":0.5}');
  assert.equal(out.severity, 'LOW');
  assert.equal(out.confidence, 0.5);
});

test('parseModelJson strips ```json fence', () => {
  const raw = '```json\n{"a":1}\n```';
  assert.deepEqual(parseModelJson(raw), { a: 1 });
});

test('parseModelJson strips generic ``` fence', () => {
  const raw = '```\n{"b":2}\n```';
  assert.deepEqual(parseModelJson(raw), { b: 2 });
});

test('parseModelJson throws on invalid JSON', () => {
  assert.throws(() => parseModelJson('not json'), SyntaxError);
});

test('parseModelJson throws on non-string', () => {
  assert.throws(() => parseModelJson(null), TypeError);
});
