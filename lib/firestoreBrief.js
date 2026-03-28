const crypto = require('crypto');

let dbSingleton = null;

function getDb() {
  if (dbSingleton !== null) return dbSingleton;
  if (process.env.ENABLE_FIRESTORE !== 'true') {
    dbSingleton = false;
    return dbSingleton;
  }
  try {
    const { Firestore } = require('@google-cloud/firestore');
    dbSingleton = new Firestore();
  } catch (e) {
    console.warn('Firestore init skipped:', e.message);
    dbSingleton = false;
  }
  return dbSingleton;
}

function hashInput(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Persists a non-PII summary for audit / replay in hackathon demo.
 * @param {string} rawInput
 * @param {object} brief
 */
async function saveBriefSnapshot(rawInput, brief) {
  const db = getDb();
  if (!db) return;

  const col = db.collection('incident_briefs');
  const doc = {
    createdAt: new Date().toISOString(),
    inputHash: hashInput(rawInput),
    severity: String(brief.severity || ''),
    incident_type: String(brief.incident_type || ''),
    time_sensitivity: String(brief.time_sensitivity || ''),
    confidence: typeof brief.confidence === 'number' ? brief.confidence : null,
  };

  await col.add(doc);
}

module.exports = { saveBriefSnapshot, getDb, hashInput };
