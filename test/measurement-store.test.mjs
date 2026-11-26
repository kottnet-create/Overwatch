import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMeasurementStore} from '../measurement-store.mjs';

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-store-'));
  return {directory, dbPath: path.join(directory, 'overwatch.sqlite')};
}

const measurement = (overrides = {}) => ({
  parameterId: 'BT7',
  parameterName: 'Varmvatten topp (BT7)',
  value: 43.3,
  unit: '°C',
  sourceAt: '2026-11-25T11:59:00.000Z',
  ...overrides,
});

test('shared store preserves provider and receipt timestamps across reopen', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  let store = null;
  try {
    store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
    const result = store.recordBatch({
      source: 'myUplink',
      systemId: 'system-1',
      deviceId: 'device-1',
      measurements: [measurement()],
    });
    assert.equal(result.inserted, 1);
    const saved = store.getHistory({source: 'myUplink', hours: 24}).samples[0];
    assert.equal(saved.sourceAt, '2026-11-25T11:59:00.000Z');
    assert.equal(saved.receivedAt, '2026-11-25T12:00:00.000Z');
    store.close();
    store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
    assert.equal(store.stats({source: 'myUplink'}).count, 1);
    assert.equal(store.getLatest({source: 'myUplink'})[0].value, 43.3);
  } finally {
    store?.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('duplicate delivery is ignored but a later poll is retained', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
  try {
    const batch = {source: 'myUplink', systemId: 'system-1', deviceId: 'device-1', measurements: [measurement()]};
    assert.equal(store.recordBatch(batch).inserted, 1);
    assert.equal(store.recordBatch(batch).inserted, 0);
    now += 5 * 60 * 1000;
    assert.equal(store.recordBatch(batch).inserted, 1);
    assert.equal(store.getHistory({source: 'myUplink'}).count, 2);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('missing values are skipped and invalid timestamps roll back the batch', () => {
  const temp = temporaryDatabase();
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => Date.parse('2026-11-25T12:00:00.000Z')});
  try {
    const result = store.recordBatch({
      source: 'Tibber',
      deviceId: 'pulse',
      measurements: [
        {parameterId: 'power', value: 1200, unit: 'W', sourceAt: '2026-11-25T11:59:00Z'},
        {parameterId: 'powerProduction', value: null, unit: 'W', sourceAt: '2026-11-25T11:59:00Z'},
      ],
    });
    assert.equal(result.inserted, 1);
    assert.equal(result.skipped, 1);
    assert.throws(() => store.recordBatch({
      source: 'Tibber',
      deviceId: 'pulse',
      measurements: [
        {parameterId: 'valid', value: 1, unit: 'W', sourceAt: '2026-11-25T11:58:00Z'},
        {parameterId: 'invalid-date', value: 2, unit: 'W', sourceAt: '2026-02-30T12:00:00Z'},
      ],
    }), /valid timezone-qualified ISO timestamp/);
    assert.equal(store.stats().count, 1);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('existing NIBE measurements table is reused without losing rows', () => {
  const temp = temporaryDatabase();
  const seed = new DatabaseSync(temp.dbPath);
  seed.exec([
    'CREATE TABLE measurements (',
    ' id INTEGER PRIMARY KEY, source TEXT NOT NULL, system_id TEXT NOT NULL,',
    ' device_id TEXT NOT NULL, parameter_id TEXT NOT NULL, parameter_name TEXT NOT NULL,',
    ' value REAL NOT NULL, unit TEXT NOT NULL DEFAULT \'\', source_at TEXT NOT NULL,',
    ' received_at TEXT NOT NULL, UNIQUE(source, device_id, parameter_id, received_at));',
    'INSERT INTO measurements (source, system_id, device_id, parameter_id, parameter_name, value, unit, source_at, received_at)',
    "VALUES ('myUplink', 'system-1', 'device-1', 'BT7', 'BT7 Hot water top', 48.5, '°C',",
    "'2026-11-25T11:59:00.000Z', '2026-11-25T12:00:00.000Z');"
  ].join('\n'));
  seed.close();
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => Date.parse('2026-11-25T12:01:00Z')});
  try {
    assert.equal(store.stats({source: 'myUplink'}).count, 1);
    assert.equal(store.getLatest({source: 'myUplink'})[0].value, 48.5);
    assert.equal(store.recordBatch({
      source: 'Tibber',
      deviceId: 'pulse',
      measurements: [{parameterId: 'power', value: 900, unit: 'W', sourceAt: '2026-11-25T12:01:00Z'}],
    }).inserted, 1);
    assert.equal(store.stats().count, 2);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('retention and query windows are bounded and enforced', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => now, retentionDays: 2});
  try {
    store.recordBatch({
      source: 'Tibber',
      deviceId: 'pulse',
      measurements: [{parameterId: 'power', value: 900, unit: 'W', sourceAt: '2026-11-25T12:00:00Z'}],
    });
    assert.equal(store.getHistory({hours: 99999}).hours, 720);
    now += 3 * 86400000;
    assert.equal(store.prune(), 1);
    assert.equal(store.stats().count, 0);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('per-point statistics report sample counts and newest receipt metadata', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:10:00.000Z');
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
  try {
    store.recordBatch({
      source: 'myUplink', systemId: 'system-1', deviceId: 'device-1',
      measurements: [measurement({sourceAt: '2026-11-25T11:59:00.000Z'})],
    });
    now += 5 * 60 * 1000;
    store.recordBatch({
      source: 'myUplink', systemId: 'system-1', deviceId: 'device-1',
      measurements: [measurement({value: 44.1, sourceAt: '2026-11-25T11:59:00.000Z'})],
    });
    const result = store.getPointStats({source: 'myUplink', hours: 24});
    assert.equal(result.count, 1);
    assert.equal(result.points[0].sampleCount, 2);
    assert.equal(result.points[0].value, 44.1);
    assert.equal(result.points[0].unit, '°C');
    assert.equal(result.points[0].firstReceivedAt, '2026-11-25T12:10:00.000Z');
    assert.equal(result.points[0].lastReceivedAt, '2026-11-25T12:15:00.000Z');
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('per-point statistics detect collection gaps over ten minutes', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
  try {
    const batch = {source: 'myUplink', systemId: 'system-1', deviceId: 'device-1', measurements: [measurement()]};
    store.recordBatch(batch);
    now += 5 * 60 * 1000;
    store.recordBatch(batch);
    now += 15 * 60 * 1000;
    store.recordBatch(batch);
    const point = store.getPointStats({source: 'myUplink', hours: 24}).points[0];
    assert.equal(point.sampleCount, 3);
    assert.equal(point.gapsOver10Minutes, 1);
    assert.equal(point.maxGapMinutes, 15);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('per-point statistics report coverage against the five-minute polling window', () => {
  const temp = temporaryDatabase();
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  const store = createMeasurementStore({dbPath: temp.dbPath, now: () => now});
  try {
    const batch = {source: 'myUplink', systemId: 'system-1', deviceId: 'device-1', measurements: [measurement()]};
    store.recordBatch(batch);
    now += 5 * 60 * 1000;
    store.recordBatch(batch);
    const point = store.getPointStats({source: 'myUplink', hours: 24}).points[0];
    assert.equal(point.expectedSamples, 288);
    assert.equal(point.sampleCount, 2);
    assert.equal(point.coveragePercent, 0.69);
    assert.equal(point.coveredHours, 0.08);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});

test('retention is enforced when the database opens, even before a new provider poll', () => {
  const temp = temporaryDatabase();
  const oldTime = Date.parse('2026-11-20T12:00:00.000Z');
  const seed = new DatabaseSync(temp.dbPath);
  seed.exec([
    'CREATE TABLE measurements (',
    ' id INTEGER PRIMARY KEY, source TEXT NOT NULL, system_id TEXT NOT NULL,',
    ' device_id TEXT NOT NULL, parameter_id TEXT NOT NULL, parameter_name TEXT NOT NULL,',
    ' value REAL NOT NULL, unit TEXT NOT NULL DEFAULT \'\', source_at TEXT NOT NULL,',
    ' received_at TEXT NOT NULL, UNIQUE(source, device_id, parameter_id, received_at));',
    'INSERT INTO measurements (source, system_id, device_id, parameter_id, parameter_name, value, unit, source_at, received_at)',
    "VALUES ('myUplink', 'system-1', 'device-1', 'BT7', 'BT7 Hot water top', 48.5, '°C',",
    "'2026-11-20T11:59:00.000Z', '2026-11-20T12:00:00.000Z');"
  ].join('\n'));
  seed.close();
  const store = createMeasurementStore({
    dbPath: temp.dbPath,
    now: () => oldTime + 3 * 86400000,
    retentionDays: 2,
  });
  try {
    assert.equal(store.stats({source: 'myUplink'}).count, 0);
  } finally {
    store.close();
    fs.rmSync(temp.directory, {recursive: true, force: true});
  }
});
