/** Upload anonymized brief JSON to Cloud Storage when GCS_EXPORT_BUCKET is set. */

const crypto = require('crypto');

function hashPayload(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex').slice(0, 12);
}

/**
 * @param {string} inputHash from lib/firestoreBrief.hashInput
 * @param {object} brief parsed model output
 */
async function exportBriefToGcs(inputHash, brief) {
  const bucketName = (process.env.GCS_EXPORT_BUCKET || '').trim();
  if (!bucketName) return;

  const { Storage } = require('@google-cloud/storage');
  const storage = new Storage();
  const fileName = `briefs/${new Date().toISOString().replace(/[:.]/g, '-')}-${inputHash}-${hashPayload(brief)}.json`;
  const body = JSON.stringify({
    exportedAt: new Date().toISOString(),
    inputHash,
    brief,
  });

  await storage.bucket(bucketName).file(fileName).save(body, {
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, max-age=0',
    },
  });
}

module.exports = { exportBriefToGcs };
