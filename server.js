const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { generateBrief } = require('./lib/generateBrief');
const { saveBriefSnapshot } = require('./lib/firestoreBrief');
const { MAX_INPUT_LENGTH } = require('./lib/systemPrompt');

function createApp(deps = {}) {
  const runGenerate = deps.generateBrief || generateBrief;
  const runSave = deps.saveBriefSnapshot || saveBriefSnapshot;

  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          frameSrc: [
            "'self'",
            'https://www.google.com',
            'https://google.com',
            'https://maps.google.com',
            'https://*.google.com',
          ],
          connectSrc: ["'self'"],
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

  app.post('/api/analyze', async (req, res) => {
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

      try {
        await runSave(input, brief);
      } catch (persistErr) {
        console.warn('Brief persistence skipped:', persistErr.message);
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
