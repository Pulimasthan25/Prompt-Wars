const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const { generateBrief } = require('./lib/generateBrief');
const { saveBriefSnapshot, hashInput } = require('./lib/firestoreBrief');
const { exportBriefToGcs } = require('./lib/gcsExport');
const { createGoogleAuthMiddleware } = require('./lib/googleAuthMiddleware');
const { MAX_INPUT_LENGTH } = require('./lib/systemPrompt');

function createApp(deps = {}) {
  const runGenerate = deps.generateBrief || generateBrief;
  const runSave = deps.saveBriefSnapshot || saveBriefSnapshot;
  const runGcsExport = deps.exportBriefToGcs || exportBriefToGcs;
  const googleAuth = deps.googleAuthMiddleware || createGoogleAuthMiddleware();

  const app = express();
  app.disable('x-powered-by');
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://www.googletagmanager.com',
            'https://www.google-analytics.com',
            'https://accounts.google.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          frameSrc: [
            "'self'",
            'https://www.google.com',
            'https://google.com',
            'https://maps.google.com',
            'https://*.google.com',
            'https://accounts.google.com',
          ],
          connectSrc: [
            "'self'",
            'https://www.google-analytics.com',
            'https://analytics.google.com',
            'https://*.google-analytics.com',
            'https://www.googletagmanager.com',
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://*.googleapis.com',
          ],
          fontSrc: ["'self'"],
        },
      },
    })
  );
  app.use(express.json({ limit: '256kb' }));

  const healthPayload = { ok: true, service: 'crisis-lens' };
  // Note: paths named "healthz" may be intercepted by Google Frontend on *.run.app (404 before the container).
  app.get('/healthz', (_req, res) => {
    res.json(healthPayload);
  });
  app.get('/health', (_req, res) => {
    res.json(healthPayload);
  });
  app.get('/api/health', (_req, res) => {
    res.json(healthPayload);
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      ga4MeasurementId: (process.env.GA4_MEASUREMENT_ID || '').trim(),
      googleOAuthClientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
      requireGoogleAuth: process.env.REQUIRE_GOOGLE_AUTH === 'true',
      googleCloud: {
        cloudRun: true,
        secretManagerForGeminiKey: true,
        firestoreEnabled: process.env.ENABLE_FIRESTORE === 'true',
        vertexAiEnabled: process.env.USE_VERTEX_AI === 'true',
        cloudStorageExportEnabled: !!(process.env.GCS_EXPORT_BUCKET || '').trim(),
      },
    });
  });

  app.post('/api/analyze', googleAuth, async (req, res) => {
    try {
      const raw = req.body?.input;
      if (raw === undefined || raw === null) {
        return res.status(400).json({ error: 'Missing "input" in JSON body.' });
      }
      if (typeof raw !== 'string') {
        return res.status(400).json({ error: '"input" must be a string.' });
      }
      const input = raw.trim();
      if (!input) {
        return res.status(400).json({ error: '"input" must not be empty.' });
      }
      if (input.length > MAX_INPUT_LENGTH) {
        return res.status(400).json({
          error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters.`,
        });
      }

      const brief = await runGenerate(input);
      const ih = hashInput(input);

      try {
        await runSave(input, brief);
      } catch (persistErr) {
        console.warn('Brief persistence skipped:', persistErr.message);
      }

      try {
        await runGcsExport(ih, brief);
      } catch (gcsErr) {
        console.warn('GCS export skipped:', gcsErr.message);
      }

      return res.json(brief);
    } catch (err) {
      console.error('API failed:', err);
      const message =
        err?.message && typeof err.message === 'string'
          ? err.message
          : 'Failed to analyze input.';
      return res.status(500).json({ error: message });
    }
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.sendFile(path.join(__dirname, 'index.html'));
  });

  return app;
}

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { createApp };
