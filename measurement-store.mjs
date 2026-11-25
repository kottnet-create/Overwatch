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

  function recordBatch({source, systemId = '', deviceId, measurements}) {
    assertOpen();
    source = safeText(source, 'source', 80);
    systemId = systemId === '' ? '' : safeText(systemId, 'systemId', 200);
    deviceId = safeText(deviceId, 'deviceId', 200);
    if (!Array.isArray(measurements)) throw new TypeError('measurements must be an array.');
    const receivedAt = new Date(now()).toISOString();
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

  return {
    recordBatch, getHistory, getLatest, stats, prune,
    close() { if (!closed.value) { db.close(); closed.value = true; } },
  };
}
