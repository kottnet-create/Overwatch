import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeTibberLiveMeasurement} from '../tibber.mjs';

const timestamp = '2026-11-26T10:00:00.000Z';

test('normalizes a valid Tibber live event and preserves optional missing values', () => {
  const result = normalizeTibberLiveMeasurement({
    timestamp, power: 1250, powerProduction: null,
    accumulatedConsumption: 12.5, accumulatedCost: 18.2,
    currency: 'SEK', minPower: 200, averagePower: 900, maxPower: 2200,
    accumulatedProduction: null, lastMeterProduction: null, lastMeterConsumption: 5000,
  });
  assert.equal(result.power, 1250);
  assert.equal(result.powerProduction, null);
  assert.equal(result.accumulatedConsumption, 12.5);
  assert.equal(result.currency, 'SEK');
  assert.equal(result.lastMeterConsumption, 5000);
});

test('does not convert missing, empty or invalid power into zero', () => {
  for (const power of [null, undefined, '', 'not-a-number']) {
    assert.equal(normalizeTibberLiveMeasurement({timestamp, power}), null);
  }
});

test('accepts a real zero-watt reading but rejects an invalid timestamp', () => {
  assert.equal(normalizeTibberLiveMeasurement({timestamp, power: 0}).power, 0);
  assert.equal(normalizeTibberLiveMeasurement({timestamp: 'not-a-date', power: 0}), null);
});

test('invalid optional numeric fields remain unavailable rather than becoming NaN', () => {
  const result = normalizeTibberLiveMeasurement({
    timestamp, power: 1000, powerProduction: 'unknown', accumulatedConsumption: '',
  });
  assert.equal(result.powerProduction, null);
  assert.equal(result.accumulatedConsumption, null);
});
