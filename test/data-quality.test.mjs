import assert from 'node:assert/strict';
import test from 'node:test';
import {assessConnectionStatus, assessReadingQuality, buildSourceStatus} from '../data-quality.mjs';

const now = Date.parse('2026-11-26T12:00:00.000Z');
const reading = (value = 1200, unit = 'W', sourceOffsetMs = 0, receivedOffsetMs = 0) => ({
  value, unit, source: 'test-provider',
  sourceAt: new Date(now + sourceOffsetMs).toISOString(),
  receivedAt: new Date(now + receivedOffsetMs).toISOString(),
});

test('accepts a fresh finite reading with the expected unit', () => {
  const result = assessReadingQuality(reading(), {now, expectedUnit: 'W'});
  assert.equal(result.quality, 'fresh');
  assert.equal(result.usable, true);
  assert.equal(result.value, 1200);
  assert.equal(result.source, 'test-provider');
});

test('keeps missing, malformed, wrong-unit and stale readings distinct', () => {
  assert.equal(assessReadingQuality(null, {now}).reason, 'reading_missing');
  assert.equal(assessReadingQuality({value: '1200', unit: 'W', sourceAt: reading().sourceAt, receivedAt: reading().receivedAt}, {now}).reason, 'value_invalid');
  assert.equal(assessReadingQuality(reading(1200, 'kW'), {now, expectedUnit: 'W'}).reason, 'unit_mismatch');
  assert.equal(assessReadingQuality(reading(1200, 'W', -240000), {now}).quality, 'stale');
});

test('rejects invalid and implausibly future timestamps', () => {
  assert.equal(assessReadingQuality({...reading(), sourceAt: '2026-02-30T12:00:00.000Z'}, {now}).reason, 'timestamp_invalid');
  assert.equal(assessReadingQuality(reading(1, 'W', 60000), {now}).reason, 'timestamp_in_future');
});

test('connection configuration and connection state are assessed separately', () => {
  assert.equal(assessConnectionStatus({configured: false, status: 'connected', now}).state, 'not_configured');
  assert.equal(assessConnectionStatus({configured: true, status: 'connected', now}).state, 'connected');
  assert.equal(assessConnectionStatus({configured: true, status: 'auth_error', now}).state, 'error');
  assert.equal(assessConnectionStatus({configured: true, status: 'needs_home', now}).state, 'needs_attention');
});

test('connection success freshness is independent of live connection state', () => {
  const result = assessConnectionStatus({
    configured: true, status: 'connected',
    lastSuccessAt: new Date(now - 20 * 60 * 1000).toISOString(), now,
  });
  assert.equal(result.state, 'connected');
  assert.equal(result.freshness, 'stale');
});

test('combined source status is usable only when connection and reading are both good', () => {
  const good = buildSourceStatus({
    provider: 'Example', configured: true, connectionStatus: 'connected',
    lastSuccessAt: new Date(now - 30000).toISOString(),
    latestReading: reading(), now, expectedUnit: 'W',
  });
  assert.equal(good.usable, true);
  assert.equal(good.connection, 'connected');
  assert.equal(good.dataQuality, 'fresh');

  const oldData = buildSourceStatus({
    provider: 'Example', configured: true, connectionStatus: 'connected',
    latestReading: reading(1200, 'W', -240000, -240000), now,
  });
  assert.equal(oldData.connection, 'connected');
  assert.equal(oldData.dataQuality, 'stale');
  assert.equal(oldData.usable, false);
});

test('unconfigured providers never become usable even if sample data is present', () => {
  const result = buildSourceStatus({
    provider: 'Huawei', configured: false, connectionStatus: 'connected',
    latestReading: reading(), now,
  });
  assert.equal(result.connection, 'not_configured');
  assert.equal(result.usable, false);
});
