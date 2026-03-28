const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Firestore } = require('@google-cloud/firestore');
const { CloudLogging } = require('@google-cloud/logging');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// ===========================
// SECURITY MIDDLEWARE
// ===========================
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10kb' })); // Limit payload size

// ===========================
// RATE LIMITING
// ===========================
const analyzeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: 'Too many analysis requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ===========================
// GOOGLE CLOUD SETUP
// ===========================
let db;
let logging;

let isCloudRunEnvironment = false;

if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
  isCloudRunEnvironment = true;
  db = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  });
  logging = new CloudLogging({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  });
}

// ===========================
// LOGGING UTILITY
// ===========================
async function logEvent(severity, message, metadata = {}) {
  console.log(`[${severity}] ${message}`, metadata);

  if (logging && isCloudRunEnvironment) {
    try {
      const log = logging.log('crisis-lens');
      const entry = log.entry({ severity }, {
        message,
        ...metadata,
        timestamp: new Date().toISOString()
      });
      await log.write(entry);
    } catch (err) {
      console.error('Failed to write to Cloud Logging:', err);
    }
  }
}

// ===========================
// INPUT VALIDATION
// ===========================
function validateInput(input) {
  if (!input) return { valid: false, error: 'Input cannot be empty' };
  if (typeof input !== 'string') return { valid: false, error: 'Input must be a string' };
  if (input.length < 10) return { valid: false, error: 'Input too short (minimum 10 characters)' };
  if (input.length > 5000) return { valid: false, error: 'Input too long (maximum 5000 characters)' };

  return { valid: true };
}

// ===========================
// HEALTH CHECK
// ===========================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cloudRunEnabled: isCloudRunEnvironment
  });
});

// ===========================
// STATIC FILES
// ===========================
app.use(express.static(__dirname, {
  maxAge: '1d',
  etag: false
}));

// ===========================
// API ENDPOINTS
// ===========================

/**
 * POST /api/analyze
 * Analyze crisis incident data using Google Gemini AI
 */
app.post('/api/analyze', analyzeRateLimiter, async (req, res) => {
  try {
    const { input } = req.body;

    // Validate input
    const validation = validateInput(input);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      await logEvent('ERROR', 'Missing GEMINI_API_KEY environment variable');
      return res.status(500).json({
        error: "Server configuration error. Contact administrator."
      });
    }

    const payload = {
      contents: [{ parts: [{ text: input }] }],
      systemInstruction: {
        parts: [{
          text: `You are CrisisLens, an advanced emergency intelligence system. Your job is to convert messy, unstructured crisis data into a structured, actionable JSON response for first responders.

CRITICAL RULES:
- ALWAYS respond with ONLY valid JSON, no markdown, no explanations
- If you cannot parse the input as a crisis situation, still provide your best interpretation
- Severity must be one of: CRITICAL, HIGH, MEDIUM, LOW
- Confidence must be a decimal between 0.0 and 1.0
- All fields must be present

RESPONSE FORMAT (EXACT):
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "incident_type": "string - concise category",
  "summary": "string - one actionable sentence for first responder",
  "location_raw": "string - extracted location text",
  "location_address": "string - best guess at physical address or 'Unknown'",
  "time_sensitivity": "seconds|minutes|hours",
  "key_facts": ["fact1", "fact2", "fact3"],
  "recommended_action": "string - single most critical action",
  "dispatch_template": "string - under 160 chars SMS-ready dispatch message",
  "confidence": 0.0-1.0
}`
        }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3
      }
    };

    const apiStartTime = Date.now();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 30000
      }
    );

    const apiDuration = Date.now() - apiStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      await logEvent('WARNING', 'Gemini API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 500)
      });
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultText) {
      throw new Error('No response from Gemini API');
    }

    // Clean up markdown if present despite prompt
    if (resultText.startsWith('```json')) {
      resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(resultText);

    // Validate response structure
    const requiredFields = ['severity', 'incident_type', 'summary', 'location_raw',
                          'location_address', 'time_sensitivity', 'key_facts',
                          'recommended_action', 'dispatch_template', 'confidence'];

    for (const field of requiredFields) {
      if (!(field in parsed)) {
        parsed[field] = parsed[field] || 'Unknown';
      }
    }

    // Ensure confidence is a number
    parsed.confidence = Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0));

    // Save to Firestore if available
    if (db) {
      try {
        await db.collection('analysis_history').add({
          input: input.substring(0, 500),
          result: parsed,
          timestamp: new Date(),
          apiDuration: apiDuration,
          userAgent: req.get('user-agent')
        });
      } catch (firestoreErr) {
        await logEvent('WARNING', 'Failed to save to Firestore', { error: firestoreErr.message });
      }
    }

    await logEvent('INFO', 'Analysis completed', {
      severity: parsed.severity,
      confidence: parsed.confidence,
      apiDuration: apiDuration
    });

    res.json(parsed);

  } catch (err) {
    await logEvent('ERROR', 'Analysis request failed', { error: err.message });

    // Return fallback response instead of exposing error details
    res.status(500).json({
      error: "Unable to analyze at this moment. Please try again.",
      requestId: Math.random().toString(36).substring(7)
    });
  }
});

/**
 * GET /api/stats
 * Get usage statistics
 */
app.get('/api/stats', async (req, res) => {
  try {

    if (!db) {
      return res.status(501).json({ error: 'Firestore not available' });
    }

    const snapshot = await db.collection('analysis_history')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const stats = {
      totalAnalysis: snapshot.size,
      severityDistribution: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      avgConfidence: 0,
      avgApiDuration: 0
    };

    let totalConfidence = 0;
    let totalDuration = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.result?.severity) {
        stats.severityDistribution[data.result.severity] =
          (stats.severityDistribution[data.result.severity] || 0) + 1;
      }
      totalConfidence += data.result?.confidence || 0;
      totalDuration += data.apiDuration || 0;
    });

    stats.avgConfidence = stats.totalAnalysis > 0 ?
      (totalConfidence / stats.totalAnalysis).toFixed(2) : 0;
    stats.avgApiDuration = stats.totalAnalysis > 0 ?
      Math.round(totalDuration / stats.totalAnalysis) : 0;

    res.json(stats);
  } catch (err) {
    await logEvent('ERROR', 'Stats request failed', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// ===========================
// FALLBACK ROUTE
// ===========================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===========================
// ERROR HANDLING
// ===========================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    requestId: Math.random().toString(36).substring(7)
  });
});

// ===========================
// SERVER START
// ===========================
app.listen(PORT, async () => {
  console.log(`🚨 CrisisLens server listening on port ${PORT}`);
  console.log(`Cloud Run: ${isCloudRunEnvironment ? '✓ enabled' : '✗ disabled'}`);
  await logEvent('INFO', 'Server started', { port: PORT });
});
