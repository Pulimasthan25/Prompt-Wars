const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportBriefToGcs } = require('../lib/gcsExport');

test('exportBriefToGcs no-ops when GCS_EXPORT_BUCKET unset', async () => {
  const prev = process.env.GCS_EXPORT_BUCKET;
  delete process.env.GCS_EXPORT_BUCKET;
  await assert.doesNotReject(() =>
    exportBriefToGcs('abc123', { severity: 'LOW', incident_type: 'test' })
  );
  if (prev !== undefined) process.env.GCS_EXPORT_BUCKET = prev;
});
