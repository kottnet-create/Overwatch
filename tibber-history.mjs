import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMeasurementStore} from './measurement-store.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HISTORY_FILE = path.join(ROOT, 'data', 'tibber-history.json');
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 30;

const FIELDS = {
  power: 'W',
  powerProduction: 'W',
  accumulatedConsumption: 'kWh',
  accumulatedProduction: 'kWh',
  accumulatedCost: null,
  minPower: 'W',
  averagePower: 'W',
  maxPower: 'W',
  lastMeterProduction: 'kWh',
  lastMeterConsumption: 'kWh',
  currentL1: 'A',
  currentL2: 'A',
  currentL3: 'A',
  voltagePhase1: 'V',
  voltagePhase2: 'V',
  voltagePhase3: 'V',
};

function readLegacyHistory(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length > 9000) return [];
    return parsed.filter(item =>
      item && typeof item.timestamp === 'string' &&
      Number.isFinite(Date.parse(item.timestamp))
    );
  } catch {
    return [];
  }
}

export function createTibberHistory({
  dbPath = path.join(ROOT, 'data', 'overwatch.sqlite'),
  legacyHistoryFile = DEFAULT_HISTORY_FILE,
  now = () => Date.now(),
} = {}) {
  const store = createMeasurementStore({dbPath, now, retentionDays: RETENTION_DAYS});
  const legacySamples = readLegacyHistory(legacyHistoryFile);
  const initialStats = store.stats({source: 'tibber'});
  let lastStoredAt = Math.max(
    Date.parse(initialStats.newest || '') || 0,
    ...legacySamples.map(item => Date.parse(item.timestamp) || 0),
  );
  let closed = false;

  function recordSample(sample, {systemId = ''} = {}) {
    if (closed) throw new Error('Tibber history store is closed.');
    const sourceAtMs = Date.parse(sample?.timestamp);
    if (!Number.isFinite(sourceAtMs)) return {inserted: 0, skipped: 1, reason: 'invalid_timestamp'};
    if (sourceAtMs - lastStoredAt < SAMPLE_INTERVAL_MS) {
      return {inserted: 0, skipped: 1, reason: 'sampling_interval'};
    }

    const measurements = [];
    for (const [parameterId, defaultUnit] of Object.entries(FIELDS)) {
      const value = sample[parameterId];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (parameterId === 'accumulatedCost' &&
          (typeof sample.currency !== 'string' || !sample.currency.trim())) continue;
      const unit = parameterId === 'accumulatedCost' ? sample.currency : defaultUnit;
      measurements.push({
        parameterId,
        parameterName: parameterId,
        value,
        unit,
        sourceAt: sample.timestamp,
      });
    }

    if (!measurements.length) return {inserted: 0, skipped: 1, reason: 'no_numeric_measurements'};
    const receivedAt = new Date(now()).toISOString();
    const result = store.recordBatch({
      source: 'tibber',
      systemId,
      deviceId: 'pulse',
      measurements,
      receivedAt,
    });
    if (result.inserted > 0) lastStoredAt = sourceAtMs;
    return result;
  }

  function getHistory() {
    if (closed) throw new Error('Tibber history store is closed.');
    const rows = store.getHistory({source: 'tibber', hours: 24 * RETENTION_DAYS, limit: 100000}).samples;
    const grouped = new Map();
    for (const row of rows) {
      const key = row.sourceAt + '\u0000' + row.receivedAt;
      let sample = grouped.get(key);
      if (!sample) {
        sample = {timestamp: row.sourceAt, receivedAt: row.receivedAt};
        grouped.set(key, sample);
      }
      sample[row.parameterId] = row.value;
      if (row.parameterId === 'accumulatedCost' && row.unit) sample.currency = row.unit;
    }
    return [...legacySamples, ...grouped.values()]
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  return {
    recordSample,
    getHistory,
    latestTimestamp: () => lastStoredAt,
    stats: () => store.stats({source: 'tibber'}),
    close() {
      if (!closed) {
        store.close();
        closed = true;
      }
    },
  };
}
