const request = require('supertest');
const express = require('express');
const path = require('path');

// ===========================
// MOCK SETUP
// ===========================
jest.mock('@google-cloud/firestore');
jest.mock('@google-cloud/logging');

process.env.GEMINI_API_KEY = 'test-key';
process.env.ADMIN_KEY = 'test-admin-key';

// Load server after mocking
const app = require('./server');

// ===========================
// TEST SUITES
// ===========================

describe('CrisisLens Server', () => {

  describe('Health Check Endpoint', () => {
    test('GET /health returns 200 with status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('Analyze Endpoint - Input Validation', () => {
    test('POST /api/analyze rejects empty input', async () => {
      const res = await request(app).post('/api/analyze').send({ input: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Input cannot be empty');
    });

    test('POST /api/analyze rejects non-string input', async () => {
      const res = await request(app).post('/api/analyze').send({ input: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Input must be a string');
    });

    test('POST /api/analyze rejects short input', async () => {
      const res = await request(app).post('/api/analyze').send({ input: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Input too short (minimum 10 characters)');
    });

    test('POST /api/analyze rejects very long input', async () => {
      const longInput = 'a'.repeat(5001);
      const res = await request(app).post('/api/analyze').send({ input: longInput });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Input too long (maximum 5000 characters)');
    });

    test('POST /api/analyze accepts valid input', async () => {
      const validInput = 'This is a valid emergency report with sufficient detail about an incident';
      const res = await request(app).post('/api/analyze').send({ input: validInput });
      // Will fail due to missing API, but validation should pass
      expect(res.status).not.toBe(400);
    });
  });

  describe('Security Headers', () => {
    test('Response includes security headers', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers).toHaveProperty('x-xss-protection');
    });

    test('Response includes CORS headers', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    test('Rate limiter returns 429 after limit exceeded', async () => {
      const input = 'This is a valid emergency report with sufficient detail';

      // Make requests up to the limit
      let lastStatus = 200;
      for (let i = 0; i < 35; i++) {
        const res = await request(app)
          .post('/api/analyze')
          .send({ input });
        lastStatus = res.status;
        // Stop early if rate limited
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429 || 500); // Either rate limit or API error
    });
  });

  describe('Payload Size Limits', () => {
    test('Rejects payloads over 10kb', async () => {
      const hugePayload = 'a'.repeat(11000);
      const res = await request(app)
        .post('/api/analyze')
        .send({ input: hugePayload });

      expect(res.status).toBe(413 || 400); // Payload too large or validation error
    });
  });

  describe('Admin Stats Endpoint', () => {
    test('GET /api/stats rejects missing admin key', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/stats rejects invalid admin key', async () => {
      const res = await request(app)
        .get('/api/stats')
        .set('x-admin-key', 'invalid-key');
      expect(res.status).toBe(401);
    });

    test('GET /api/stats accepts valid admin key', async () => {
      const res = await request(app)
        .get('/api/stats')
        .set('x-admin-key', 'test-admin-key');
      // Will fail due to Firestore mock, but auth should pass
      expect(res.status).not.toBe(401);
    });
  });

  describe('Static File Serving', () => {
    test('GET / serves index.html', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/html/);
    });

    test('GET /some-route serves index.html (SPA routing)', async () => {
      const res = await request(app).get('/unknown-route');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/html/);
    });
  });

  describe('Error Handling', () => {
    test('Server handles invalid JSON gracefully', async () => {
      const res = await request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .send('invalid json {');

      expect(res.status).toBe(400);
    });
  });

});

describe('Input Validation Edge Cases', () => {
  test('Handles unicode input correctly', async () => {
    const unicodeInput = 'Émergeñcy 🚨 incident at Ñuevo Léon with ∑ casualties';
    const res = await request(app).post('/api/analyze').send({ input: unicodeInput });
    expect(res.status).not.toBe(400);
  });

  test('Handles SQL injection attempts gracefully', async () => {
    const sqlInput = "'; DROP TABLE incidents; -- sufficient text to pass validation";
    const res = await request(app).post('/api/analyze').send({ input: sqlInput });
    expect(res.status).not.toBe(500);
  });

  test('Handles XSS attempts in input', async () => {
    const xssInput = '<script>alert("xss")</script> incident report with enough text here for validation';
    const res = await request(app).post('/api/analyze').send({ input: xssInput });
    expect(res.status).not.toBe(500);
  });
});

describe('Compression and Performance', () => {
  test('Response includes compression headers', async () => {
    const res = await request(app).get('/health');
    // Note: compression is applied, check vary header
    expect(res.headers['vary']).toBeDefined();
  });
});
