import assert from 'node:assert/strict';
import test from 'node:test';
import {assessTibberSource} from '../tibber-quality.mjs';

const now = Date.parse('2026-11-26T12:00:00.000Z');
const freshStatus = (overrides = {}) => ({
  configured: true,
  status: 'connected',
  latest: {timestamp: new Date(now - 1000).toISOString(), power: 1450},
  receivedAt: new Date(now - 500).toISOString(),
  ...overrides,
});

test('maps a connected Tibber live reading into the shared status contract', () => {
  const result = assessTibberSource(freshStatus(), {now});
  assert.equal(result.provider, 'Tibber');
  assert.equal(result.connection, 'connected');
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.usable, true);
});

test('reports a connected Tibber socket with no live reading as missing data', () => {
  const result = assessTibberSource(freshStatus({latest: null, receivedAt: null}), {now});
  assert.equal(result.connection, 'connected');
  assert.equal(result.dataQuality, 'missing');
  assert.equal(result.usable, false);
});

test('reports stale Tibber live readings as unusable without changing connection state', () => {
  const result = assessTibberSource(freshStatus({
    latest: {timestamp: new Date(now - 4 * 60 * 1000).toISOString(), power: 1450},
    receivedAt: new Date(now - 4 * 60 * 1000).toISOString(),
  }), {now});
  assert.equal(result.connection, 'connected');
  assert.equal(result.dataQuality, 'stale');
  assert.equal(result.usable, false);
});

test('does not mark an unconfigured Tibber provider usable', () => {
  const result = assessTibberSource({
    configured: false, status: 'not_configured', latest: null, receivedAt: null,
  }, {now});
  assert.equal(result.connection, 'not_configured');
  assert.equal(result.usable, false);
});

test('rejects malformed Tibber power and timestamps', () => {
  const result = assessTibberSource(freshStatus({
    latest: {timestamp: 'invalid', power: '1450'},
  }), {now});
  assert.equal(result.dataQuality, 'invalid');
  assert.equal(result.usable, false);
});
