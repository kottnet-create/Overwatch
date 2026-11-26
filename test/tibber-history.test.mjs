import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createTibberHistory} from '../tibber-history.mjs';

test('Tibber history stores numeric fields in shared SQLite and keeps legacy JSON readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-tibber-history-'));
  const dbPath = path.join(dir, 'overwatch.sqlite');
  const legacyHistoryFile = path.join(dir, 'tibber-history.json');
  const legacy = [{timestamp: '2026-11-25T10:00:00.000Z', power: 420, powerProduction: null}];
  fs.writeFileSync(legacyHistoryFile, JSON.stringify(legacy));
  const originalLegacy = fs.readFileSync(legacyHistoryFile, 'utf8');
  const now = () => Date.parse('2026-11-25T12:00:05.000Z');

  try {
    const history = createTibberHistory({dbPath, legacyHistoryFile, now});
    const result = history.recordSample({
      timestamp: '2026-11-25T12:00:00.000Z',
      power: 850,
      powerProduction: 120,
      accumulatedConsumption: 8.25,
      accumulatedCost: 14.5,
      currency: 'SEK',
      minPower: 100,
      averagePower: 600,
      maxPower: 2100,
      accumulatedProduction: null,
      lastMeterProduction: null,
      lastMeterConsumption: 1234.5,
      currentL1: 1.7,
      currentL2: 1.9,
      currentL3: 1.2,
      voltagePhase1: 233.8,
      voltagePhase2: 235.2,
      voltagePhase3: 236.2,
    }, {systemId: 'test-home'});

    assert.equal(result.inserted, 14);
    const samples = history.getHistory();
    assert.equal(samples.length, 2);
    assert.equal(samples[1].power, 850);
    assert.equal(samples[1].powerProduction, 120);
    assert.equal(samples[1].accumulatedConsumption, 8.25);
    assert.equal(samples[1].accumulatedCost, 14.5);
    assert.equal(samples[1].currency, 'SEK');
    assert.equal(samples[1].lastMeterConsumption, 1234.5);
    assert.equal(samples[1].currentL1, 1.7);
    assert.equal(samples[1].currentL2, 1.9);
    assert.equal(samples[1].currentL3, 1.2);
    assert.equal(samples[1].voltagePhase1, 233.8);
    assert.equal(samples[1].voltagePhase2, 235.2);
    assert.equal(samples[1].voltagePhase3, 236.2);
    assert.equal(samples[1].receivedAt, '2026-11-25T12:00:05.000Z');
    assert.equal(fs.readFileSync(legacyHistoryFile, 'utf8'), originalLegacy);
    history.close();

    const reopened = createTibberHistory({dbPath, legacyHistoryFile, now});
    assert.equal(reopened.getHistory().length, 2);
    assert.equal(reopened.getHistory()[1].power, 850);
    assert.equal(reopened.getHistory()[1].currentL1, 1.7);
    assert.equal(reopened.getHistory()[1].voltagePhase3, 236.2);
    reopened.close();
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('Tibber history keeps the five-minute sampling guard and rejects missing timestamps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-tibber-interval-'));
  const dbPath = path.join(dir, 'overwatch.sqlite');
  const now = () => Date.parse('2026-11-25T12:05:05.000Z');

  try {
    const history = createTibberHistory({dbPath, legacyHistoryFile: path.join(dir, 'missing.json'), now});
    const first = history.recordSample({timestamp: '2026-11-25T12:00:00.000Z', power: 500});
    const tooSoon = history.recordSample({timestamp: '2026-11-25T12:04:59.000Z', power: 510});
    const invalid = history.recordSample({timestamp: 'not-a-date', power: 520});
    assert.equal(first.inserted, 1);
    assert.equal(tooSoon.reason, 'sampling_interval');
    assert.equal(invalid.reason, 'invalid_timestamp');
    assert.equal(history.getHistory().length, 1);
    history.close();
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
