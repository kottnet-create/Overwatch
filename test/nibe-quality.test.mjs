import assert from 'node:assert/strict';
import test from 'node:test';
import {assessNibeSource} from '../nibe-quality.mjs';

const now = Date.parse('2026-11-26T12:00:00.000Z');
const sample = (name, sourceOffset = 0, receivedOffset = 0, unit = '°C') => ({
  parameterId: name,
  parameterName: name,
  value: 35,
  unit,
  sourceTimestamp: new Date(now + sourceOffset).toISOString(),
  receivedAt: new Date(now + receivedOffset).toISOString(),
});

test('does not mistake stored myUplink credentials for a live connection', () => {
  const result = assessNibeSource({
    accountStatus: {connected: true, provider: 'myUplink'},
    latestMeasurements: [sample('BT6')],
    now,
  });
  assert.equal(result.configured, true);
  assert.equal(result.connection, 'unknown');
  assert.equal(result.usable, false);
});

test('reports fresh NIBE history measurements without claiming live connection', () => {
  const result = assessNibeSource({
    accountStatus: {connected: true},
    latestMeasurements: [sample('BT6'), sample('BT50')],
    now,
  });
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.counts.fresh, 2);
  assert.equal(result.readingCount, 2);
});

test('identifies stale NIBE history separately from account configuration', () => {
  const result = assessNibeSource({
    accountStatus: {connected: true},
    latestMeasurements: [sample('BT6', -8 * 60 * 1000, -8 * 60 * 1000)],
    now,
  });
  assert.equal(result.connection, 'unknown');
  assert.equal(result.dataQuality, 'stale');
  assert.equal(result.usable, false);
});

test('reports mixed freshness as partial and retains per-point detail', () => {
  const result = assessNibeSource({
    accountStatus: {connected: true},
    latestMeasurements: [sample('BT6'), sample('BT50', -8 * 60 * 1000, -8 * 60 * 1000)],
    now,
  });
  assert.equal(result.dataQuality, 'partial');
  assert.equal(result.counts.fresh, 1);
  assert.equal(result.counts.stale, 1);
});

test('reports missing history and an unconfigured account distinctly', () => {
  const missing = assessNibeSource({accountStatus: {connected: true}, latestMeasurements: [], now});
  assert.equal(missing.dataQuality, 'missing');
  assert.equal(missing.connection, 'unknown');
  const unconfigured = assessNibeSource({accountStatus: {connected: false}, latestMeasurements: [], now});
  assert.equal(unconfigured.connection, 'not_configured');
  assert.equal(unconfigured.configured, false);
});

test('retains malformed source timestamps as diagnostic metadata without losing a fresh snapshot', () => {
  const result = assessNibeSource({
    accountStatus: {connected: true},
    latestMeasurements: [{...sample('BT6'), sourceTimestamp: 'bad'}],
    now,
  });
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.counts.fresh, 1);
  assert.equal(result.readings[0].sourceAgeMs, null);
});

test('assesses only the newest stored sample for each NIBE point', () => {
  const older = sample('BT6', -10 * 60 * 1000, -10 * 60 * 1000);
  const newer = sample('BT6');
  const other = sample('BT50');
  const result = assessNibeSource({
    accountStatus: {connected: true},
    latestMeasurements: [newer, older, other],
    now,
  });
  assert.equal(result.readingCount, 2);
  assert.equal(result.counts.fresh, 2);
  assert.equal(result.counts.stale, 0);
  assert.equal(result.readings.length, 2);
});

test('uses verified live system connection and fresh poll receipt for unchanged point values', () => {
  const result = assessNibeSource({
    accountStatus: {
      configured: true,
      connectionState: 'connected',
      lastSuccessAt: new Date(now - 1000).toISOString(),
    },
    latestMeasurements: [{
      ...sample('BT6', -45 * 60 * 1000, -1000),
      receivedAt: new Date(now - 1000).toISOString(),
    }],
    now,
  });
  assert.equal(result.connection, 'connected');
  assert.equal(result.connectionFreshness, 'fresh');
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.usable, true);
  assert.equal(result.readings[0].sourceAgeMs, 45 * 60 * 1000);
});
