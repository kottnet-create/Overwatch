import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const DEFAULT_RETENTION_DAYS = 30;
const MAX_QUERY_HOURS = 24 * 30;

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a timezone-qualified ISO timestamp.');
  const date = new Date(value);
  const day = value.slice(0, 10);
  const parts = day.split('-').map(Number);
  const calendarDay = parts.length === 3 ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toISOString().slice(0, 10) : '';
  if (!Number.isFinite(date.getTime()) || calendarDay !== day ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)) {
    throw new TypeError(label + ' must be a valid timezone-qualified ISO timestamp.');
  }
  return date.toISOString();
}

function safeText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(label + ' must be a non-empty string of at most ' + max + ' characters.');
  }
  return value.trim();
}

export function createMeasurementStore({
  dbPath = path.join(process.cwd(), 'data', 'overwatch.sqlite'),
  now = () => Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
} = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new RangeError('retentionDays must be an integer from 1 to 3650.');
  }
  fs.mkdirSync(path.dirname(dbPath), {recursive: true});
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS measurements (',
    ' id INTEGER PRIMARY KEY,',
    ' source TEXT NOT NULL,',
    ' system_id TEXT NOT NULL,',
    ' device_id TEXT NOT NULL,',
    ' parameter_id TEXT NOT NULL,',
    ' parameter_name TEXT NOT NULL,',
    ' value REAL NOT NULL,',
    " unit TEXT NOT NULL DEFAULT '',",
    ' source_at TEXT NOT NULL,',
    ' received_at TEXT NOT NULL,',
    ' UNIQUE(source, device_id, parameter_id, received_at)',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_measurements_source_time ON measurements(source, source_at);',
    'CREATE INDEX IF NOT EXISTS idx_measurements_device_parameter_time ON measurements(device_id, parameter_id, source_at);'
  ].join('\n'));

  const insert = db.prepare('INSERT OR IGNORE INTO measurements ' +
    '(source, system_id, device_id, parameter_id, parameter_name, value, unit, source_at, received_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const pruneStatement = db.prepare('DELETE FROM measurements WHERE received_at < ?');
  const closed = {value: false};
  function assertOpen() { if (closed.value) throw new Error('Measurement store is closed.'); }

  function recordBatch({source, systemId = '', deviceId, measurements, receivedAt: suppliedReceivedAt}) {
    assertOpen();
    source = safeText(source, 'source', 80);
    systemId = systemId === '' ? '' : safeText(systemId, 'systemId', 200);
    deviceId = safeText(deviceId, 'deviceId', 200);
    if (!Array.isArray(measurements)) throw new TypeError('measurements must be an array.');
    const receivedAt = isoTimestamp(suppliedReceivedAt || new Date(now()).toISOString(), 'receivedAt');
    let inserted = 0, skipped = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of measurements) {
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.value !== 'number' || !Number.isFinite(item.value)) {
          skipped++;
          continue;
        }
        const parameterId = safeText(item.parameterId, 'parameterId', 200);
        const parameterName = safeText(item.parameterName ?? parameterId, 'parameterName', 200);
        const unit = item.unit == null ? '' : safeText(item.unit, 'unit', 32);
        const sourceAt = isoTimestamp(item.sourceAt, 'sourceAt');
        const result = insert.run(source, systemId, deviceId, parameterId, parameterName, item.value, unit, sourceAt, receivedAt);
        inserted += Number(result.changes || 0);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    prune();
    return {inserted, skipped, receivedAt, retentionDays};
  }

  function prune() {
    assertOpen();
    const cutoff = new Date(now() - retentionDays * 86400000).toISOString();
    return Number(pruneStatement.run(cutoff).changes || 0);
  }

  function getHistory({source, hours = 24, deviceId, parameterId, limit = 20000} = {}) {
    assertOpen();
    const boundedHours = Math.max(1, Math.min(MAX_QUERY_HOURS, Number(hours) || 24));
    const boundedLimit = Math.max(1, Math.min(100000, Math.trunc(Number(limit) || 20000)));
    const since = new Date(now() - boundedHours * 3600000).toISOString();
    const clauses = ['received_at >= ?'];
    const params = [since];
    if (source) { clauses.push('source = ?'); params.push(safeText(source, 'source', 80)); }
    if (deviceId) { clauses.push('device_id = ?'); params.push(safeText(deviceId, 'deviceId', 200)); }
    if (parameterId) { clauses.push('parameter_id = ?'); params.push(safeText(parameterId, 'parameterId', 200)); }
    params.push(boundedLimit);
    const sql = 'SELECT source, system_id AS systemId, device_id AS deviceId, ' +
      'parameter_id AS parameterId, parameter_name AS parameterName, value, unit, ' +
      'source_at AS sourceAt, received_at AS receivedAt FROM measurements WHERE ' +
      clauses.join(' AND ') + ' ORDER BY received_at ASC, source ASC, device_id ASC, parameter_id ASC LIMIT ?';
    const rows = db.prepare(sql).all(...params);
    return {hours: boundedHours, retentionDays, count: rows.length, samples: rows};
  }

  function getLatest({source, limit = 499} = {}) {
    assertOpen();
    const boundedLimit = Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 499)));
    const base = 'SELECT source, system_id AS systemId, device_id AS deviceId, ' +
      'parameter_id AS parameterId, parameter_name AS parameterName, value, unit, ' +
      'source_at AS sourceAt, received_at AS receivedAt FROM measurements';
    if (source) return db.prepare(base + ' WHERE source = ? ORDER BY received_at DESC LIMIT ?')
      .all(safeText(source, 'source', 80), boundedLimit).reverse();
    return db.prepare(base + ' ORDER BY received_at DESC LIMIT ?').all(boundedLimit).reverse();
  }

  function stats({source} = {}) {
    assertOpen();
    const row = source
      ? db.prepare('SELECT COUNT(*) AS count, MIN(source_at) AS oldest, MAX(source_at) AS newest FROM measurements WHERE source = ?').get(safeText(source, 'source', 80))
      : db.prepare('SELECT COUNT(*) AS count, MIN(source_at) AS oldest, MAX(source_at) AS newest FROM measurements').get();
    return {count: Number(row.count), oldest: row.oldest, newest: row.newest, retentionDays, databasePath: dbPath};
  }

  function getPointStats({source, hours = 24 * retentionDays} = {}) {
    assertOpen();
    const boundedHours = Math.max(1, Math.min(MAX_QUERY_HOURS, Number(hours) || 24));
    const since = new Date(now() - boundedHours * 3600000).toISOString();
    const params = [since];
    let sourceClause = '';
    if (source) { sourceClause = ' AND source = ?'; params.push(safeText(source, 'source', 80)); }
    const rows = db.prepare(
      'WITH filtered AS (' +
      ' SELECT source, system_id, device_id, parameter_id, parameter_name, value, unit, source_at, received_at' +
      ' FROM measurements WHERE received_at >= ?' + sourceClause +
      '), ordered AS (' +
      ' SELECT *, LAG(received_at) OVER (PARTITION BY source, system_id, device_id, parameter_id ORDER BY received_at) AS previous_received_at' +
      ' FROM filtered' +
      '), grouped AS (' +
      ' SELECT source, system_id, device_id, parameter_id, COUNT(*) AS sample_count,' +
      ' MIN(received_at) AS first_received_at, MAX(received_at) AS last_received_at,' +
      ' SUM(CASE WHEN previous_received_at IS NOT NULL AND (julianday(received_at)-julianday(previous_received_at))*86400 > 600 THEN 1 ELSE 0 END) AS gaps_over_10m,' +
      ' MAX(CASE WHEN previous_received_at IS NOT NULL THEN (julianday(received_at)-julianday(previous_received_at))*86400 ELSE 0 END) AS max_gap_seconds' +
      ' FROM ordered GROUP BY source, system_id, device_id, parameter_id' +
      ') SELECT g.source, g.system_id AS systemId, g.device_id AS deviceId,' +
      ' g.parameter_id AS parameterId, m.parameter_name AS parameterName,' +
      ' m.value, m.unit, m.source_at AS sourceAt, m.received_at AS receivedAt,' +
      ' g.sample_count AS sampleCount, g.first_received_at AS firstReceivedAt,' +
      ' g.last_received_at AS lastReceivedAt, g.gaps_over_10m AS gapsOver10Minutes,' +
      ' ROUND(g.max_gap_seconds / 60.0, 2) AS maxGapMinutes' +
      ' FROM grouped g JOIN ordered m ON m.source = g.source' +
      ' AND m.system_id = g.system_id AND m.device_id = g.device_id' +
      ' AND m.parameter_id = g.parameter_id AND m.received_at = g.last_received_at' +
      ' ORDER BY g.source, g.device_id, g.parameter_id'
    ).all(...params);
    const expectedSamples = Math.ceil(boundedHours * 12);
    const points = rows.map(row => ({
      ...row,
      expectedSamples,
      coveragePercent: Math.min(100, Number((row.sampleCount / expectedSamples * 100).toFixed(2))),
      coveredHours: Number(((Date.parse(row.lastReceivedAt) - Date.parse(row.firstReceivedAt)) / 3600000).toFixed(2)),
    }));
    return {hours: boundedHours, retentionDays, expectedSamples, count: points.length, points};
  }

  // Enforce retention when the database is opened, even if the provider is offline.
  prune();

  return {
    recordBatch, getHistory, getLatest, getPointStats, stats, prune,
    close() { if (!closed.value) { db.close(); closed.value = true; } },
  };
}
