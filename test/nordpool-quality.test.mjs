import assert from 'node:assert/strict';
import test from 'node:test';
import {assessNordPoolSource} from '../nordpool-quality.mjs';

const now = Date.parse('2026-11-26T12:00:00.000Z');
const validStatus = (overrides = {}) => ({
  source: 'Spotpris.nu / Nord Pool',
  area: 'SE3',
  currency: 'SEK',
  unit: 'SEK/kWh',
  prices: [
    {startsAt: '2026-11-26T12:00:00.000Z', priceSekPerKwh: 1.25},
    {startsAt: '2026-11-26T13:00:00.000Z', priceSekPerKwh: 1.1},
  ],
  current: {startsAt: '2026-11-26T12:00:00.000Z', priceSekPerKwh: 1.25},
  fetchedAt: new Date(now - 60 * 1000).toISOString(),
  error: null,
  ...overrides,
});

test('accepts a fresh valid SE3 price series', () => {
  const result = assessNordPoolSource(validStatus(), {now});
  assert.equal(result.connection, 'connected');
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.usable, true);
  assert.equal(result.priceCount, 2);
  assert.equal(result.currentPriceAvailable, true);
});

test('treats future price intervals as valid when the snapshot is fresh', () => {
  const result = assessNordPoolSource(validStatus({
    prices: [{startsAt: '2026-11-27T01:00:00.000Z', priceSekPerKwh: 0.8}],
  }), {now});
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.usable, true);
});

test('reports missing price cache distinctly', () => {
  const result = assessNordPoolSource(validStatus({prices: [], fetchedAt: null}), {now});
  assert.equal(result.dataQuality, 'missing');
  assert.equal(result.usable, false);
});

test('reports an old cached price series as stale', () => {
  const result = assessNordPoolSource(validStatus({
    fetchedAt: new Date(now - 31 * 60 * 1000).toISOString(),
  }), {now});
  assert.equal(result.connection, 'disconnected');
  assert.equal(result.dataQuality, 'stale');
  assert.equal(result.usable, false);
});

test('rejects malformed intervals and incorrect market units', () => {
  const malformed = assessNordPoolSource(validStatus({
    prices: [{startsAt: 'not-a-date', priceSekPerKwh: 1.2}],
  }), {now});
  assert.equal(malformed.dataQuality, 'invalid');
  assert.equal(malformed.invalidPriceCount, 1);

  const wrongMarket = assessNordPoolSource(validStatus({unit: 'öre/kWh'}), {now});
  assert.equal(wrongMarket.dataQuality, 'invalid');
  assert.equal(wrongMarket.usable, false);
});

test('preserves an upstream refresh error even when cached prices remain', () => {
  const result = assessNordPoolSource(validStatus({error: 'HTTP 503'}), {now});
  assert.equal(result.connection, 'error');
  assert.equal(result.error, 'HTTP 503');
  assert.equal(result.usable, false);
});

test('does not require a current interval when a valid future price series exists', () => {
  const result = assessNordPoolSource(validStatus({current: null}), {now});
  assert.equal(result.dataQuality, 'fresh');
  assert.equal(result.currentPriceAvailable, false);
  assert.equal(result.usable, true);
});
