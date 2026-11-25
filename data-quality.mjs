const DEFAULT_MAX_READING_AGE_MS = 3 * 60 * 1000;
const DEFAULT_FUTURE_TOLERANCE_MS = 30 * 1000;
const DEFAULT_MAX_CONNECTION_AGE_MS = 10 * 60 * 1000;

function validTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10) === day;
}

function ageOf(value, now) {
  if (!validTimestamp(value)) return null;
  return now - Date.parse(value);
}

/** Assess a normalized measurement without interpreting provider semantics. */
export function assessReadingQuality(reading, {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_READING_AGE_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
  expectedUnit = null,
} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
      !Number.isFinite(futureToleranceMs) || futureToleranceMs < 0) {
    throw new TypeError('now, maxAgeMs and futureToleranceMs must be valid non-negative numbers.');
  }
  if (reading == null) return {quality: 'missing', usable: false, reason: 'reading_missing'};
  if (typeof reading !== 'object' || Array.isArray(reading)) {
    return {quality: 'invalid', usable: false, reason: 'reading_invalid'};
  }
  if (typeof reading.value !== 'number' || !Number.isFinite(reading.value)) {
    return {quality: 'invalid', usable: false, reason: 'value_invalid'};
  }
  if (typeof reading.unit !== 'string' || !reading.unit.trim()) {
    return {quality: 'invalid', usable: false, reason: 'unit_missing'};
  }
  if (expectedUnit && reading.unit !== expectedUnit) {
    return {quality: 'invalid', usable: false, reason: 'unit_mismatch', expectedUnit, actualUnit: reading.unit};
  }
  if (!validTimestamp(reading.sourceAt) || !validTimestamp(reading.receivedAt)) {
    return {quality: 'invalid', usable: false, reason: 'timestamp_invalid'};
  }

  const sourceAgeMs = ageOf(reading.sourceAt, now);
  const receivedAgeMs = ageOf(reading.receivedAt, now);
  if (sourceAgeMs < -futureToleranceMs || receivedAgeMs < -futureToleranceMs) {
    return {quality: 'invalid', usable: false, reason: 'timestamp_in_future', sourceAgeMs, receivedAgeMs};
  }
  if (sourceAgeMs > maxAgeMs || receivedAgeMs > maxAgeMs) {
    return {quality: 'stale', usable: false, reason: 'reading_stale', sourceAgeMs, receivedAgeMs};
  }

  return {
    quality: 'fresh',
    usable: true,
    reason: null,
    sourceAgeMs: Math.max(0, sourceAgeMs),
    receivedAgeMs: Math.max(0, receivedAgeMs),
    value: reading.value,
    unit: reading.unit,
    source: typeof reading.source === 'string' ? reading.source : null,
    sourceAt: reading.sourceAt,
    receivedAt: reading.receivedAt,
  };
}

/** Assess connection state independently from measurement freshness. */
export function assessConnectionStatus({
  configured = false,
  status = null,
  lastSuccessAt = null,
  now = Date.now(),
  maxConnectionAgeMs = DEFAULT_MAX_CONNECTION_AGE_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxConnectionAgeMs) || maxConnectionAgeMs < 0 ||
      !Number.isFinite(futureToleranceMs) || futureToleranceMs < 0) {
    throw new TypeError('now, maxConnectionAgeMs and futureToleranceMs must be valid non-negative numbers.');
  }
  if (!configured) {
    return {configured: false, state: 'not_configured', freshness: 'unknown', lastSuccessAt: null, ageMs: null};
  }

  const raw = typeof status === 'string' ? status.toLowerCase() : '';
  let state = 'unknown';
  if (['connected', 'ready', 'online'].includes(raw)) state = 'connected';
  else if (['starting', 'connecting', 'reconnecting'].includes(raw)) state = 'connecting';
  else if (['disconnected', 'closed', 'offline'].includes(raw)) state = 'disconnected';
  else if (['error', 'auth_error', 'failed'].includes(raw)) state = 'error';
  else if (['needs_home', 'needs_attention', 'unauthorized'].includes(raw)) state = 'needs_attention';

  if (lastSuccessAt == null) {
    return {configured: true, state, freshness: 'unknown', lastSuccessAt: null, ageMs: null};
  }
  if (!validTimestamp(lastSuccessAt)) {
    return {configured: true, state, freshness: 'invalid', lastSuccessAt, ageMs: null};
  }
  const ageMs = now - Date.parse(lastSuccessAt);
  if (ageMs < -futureToleranceMs) {
    return {configured: true, state, freshness: 'invalid', lastSuccessAt, ageMs};
  }
  return {
    configured: true,
    state,
    freshness: ageMs > maxConnectionAgeMs ? 'stale' : 'fresh',
    lastSuccessAt,
    ageMs: Math.max(0, ageMs),
  };
}

/** Build a provider-neutral status object with independent connection and data states. */
export function buildSourceStatus({
  provider,
  configured = false,
  connectionStatus = null,
  lastSuccessAt = null,
  latestReading = null,
  now = Date.now(),
  maxReadingAgeMs = DEFAULT_MAX_READING_AGE_MS,
  maxConnectionAgeMs = DEFAULT_MAX_CONNECTION_AGE_MS,
  expectedUnit = null,
} = {}) {
  if (typeof provider !== 'string' || !provider.trim()) {
    throw new TypeError('provider must be a non-empty string.');
  }
  const connection = assessConnectionStatus({
    configured, status: connectionStatus, lastSuccessAt, now, maxConnectionAgeMs,
  });
  const reading = assessReadingQuality(latestReading, {
    now, maxAgeMs: maxReadingAgeMs, expectedUnit,
  });
  const usable = connection.configured &&
    connection.state === 'connected' &&
    connection.freshness !== 'stale' &&
    connection.freshness !== 'invalid' &&
    reading.usable;

  return {
    provider,
    configured: connection.configured,
    connection: connection.state,
    connectionFreshness: connection.freshness,
    lastSuccessAt: connection.lastSuccessAt,
    connectionAgeMs: connection.ageMs,
    dataQuality: reading.quality,
    dataReason: reading.reason,
    readingAgeMs: reading.receivedAgeMs ?? null,
    usable,
  };
}
