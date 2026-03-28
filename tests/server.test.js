const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../server');
const { MAX_INPUT_LENGTH } = require('../lib/systemPrompt');

const sampleBrief = {
  severity: 'HIGH',
  incident_type: 'Medical Emergency',
  summary: 'Test summary for responders.',
  location_raw: 'MG Road',
  location_address: 'MG Road, Bengaluru',
  time_sensitivity: 'minutes',
  key_facts: ['Fact one', 'Fact two', 'Fact three'],
  recommended_action: 'Dispatch ALS.',
  dispatch_template: 'MED: test dispatch under one sixty chars here for sms ok.',
  confidence: 0.82,
};

test('GET /health and /api/health return ok', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const h = await request(app).get('/health').expect(200);
  assert.equal(h.body.ok, true);
  const api = await request(app).get('/api/health').expect(200);
  assert.equal(api.body.service, 'crisis-lens');
});

test('GET /healthz returns ok (local / non-Cloud-Run)', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).get('/healthz').expect(200);
  assert.equal(res.body.ok, true);
});

test('GET / returns CrisisLens HTML shell', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).get('/').expect(200);
  assert.match(res.headers['content-type'] || '', /text\/html/i);
  assert.match(res.text, /CrisisLens/);
});

test('POST /api/analyze returns brief from generator', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app)
    .post('/api/analyze')
    .send({ input: '  someone needs help  ' })
    .expect(200);
  assert.equal(res.body.severity, 'HIGH');
  assert.equal(res.body.incident_type, 'Medical Emergency');
  assert.ok(Array.isArray(res.body.key_facts));
});

test('POST /api/analyze rejects empty input', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).post('/api/analyze').send({ input: '   ' }).expect(400);
  assert.match(res.body.error, /empty/i);
});

test('POST /api/analyze rejects missing input', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).post('/api/analyze').send({}).expect(400);
  assert.match(res.body.error, /missing/i);
});

test('POST /api/analyze rejects non-string input', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).post('/api/analyze').send({ input: 123 }).expect(400);
  assert.match(res.body.error, /string/i);
});

test('POST /api/analyze rejects input over max length', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app)
    .post('/api/analyze')
    .send({ input: 'z'.repeat(MAX_INPUT_LENGTH + 1) })
    .expect(400);
  assert.match(res.body.error, /maximum length/i);
});

test('POST /api/analyze propagates generator errors as 500', async () => {
  const app = createApp({
    generateBrief: async () => {
      throw new Error('upstream failure');
    },
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app)
    .post('/api/analyze')
    .send({ input: 'valid text here' })
    .expect(500);
  assert.match(res.body.error, /upstream failure/);
});

test('GET /api/unknown returns 404 JSON', async () => {
  const app = createApp({
    generateBrief: async () => sampleBrief,
    saveBriefSnapshot: async () => {},
  });
  const res = await request(app).get('/api/nope').expect(404);
  assert.equal(res.body.error, 'Not found');
});
