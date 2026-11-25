const DEFAULT_MAX_AGE_MS = 3 * 60 * 1000;
const DEFAULT_MAX_SKEW_MS = 90 * 1000;

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value);
}

function validateReading(reading, name, now, maxAgeMs) {
  if (!reading || typeof reading !== 'object') return {ok: false, reason: name + '_missing'};
  if (typeof reading.value !== 'number' || !Number.isFinite(reading.value)) {
    return {ok: false, reason: name + '_invalid_value'};
  }
  if (reading.unit !== 'W') return {ok: false, reason: name + '_invalid_unit'};
  if (!validTimestamp(reading.sourceAt) || !validTimestamp(reading.receivedAt)) {
    return {ok: false, reason: name + '_invalid_timestamp'};
  }
  const receivedAt = Date.parse(reading.receivedAt);
  const ageMs = now - receivedAt;
  if (ageMs < -30_000 || ageMs > maxAgeMs) return {ok: false, reason: name + '_stale'};
  return {ok: true, reading, sourceAtMs: Date.parse(reading.sourceAt)};
}

/**
 * Derive whole-site load only from normalized, simultaneous readings.
 *
 * Sign convention:
 * - gridNet: positive = import, negative = export
 * - solarPower: non-negative PV generation
 * - batteryNetPower: positive = discharge, negative = charge
 *
 * Conservation: siteLoad = solarPower + gridNet + batteryNetPower.
 * This function does not interpret provider-specific fields. Adapters must
 * verify provider semantics and normalize signs before calling it.
 */
export function calculateEnergyBalance({
  gridNet,
  solarPower,
  batteryNetPower,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
      !Number.isFinite(maxSkewMs) || maxSkewMs < 0) {
    throw new TypeError('now, maxAgeMs and maxSkewMs must be valid non-negative numbers.');
  }

  const readings = [
    validateReading(gridNet, 'grid', now, maxAgeMs),
    validateReading(solarPower, 'solar', now, maxAgeMs),
    validateReading(batteryNetPower, 'battery', now, maxAgeMs),
  ];
  const invalid = readings.find(result => !result.ok);
  if (invalid) return {available: false, value: null, unit: 'W', reason: invalid.reason};

  const [grid, solar, battery] = readings.map(result => result.reading);
  if (solar.value < 0) return {available: false, value: null, unit: 'W', reason: 'solar_negative'};
  const sourceTimes = readings.map(result => result.sourceAtMs);
  const skewMs = Math.max(...sourceTimes) - Math.min(...sourceTimes);
  if (skewMs > maxSkewMs) return {available: false, value: null, unit: 'W', reason: 'readings_not_simultaneous', skewMs};

  const value = solar.value + grid.value + battery.value;
  if (!Number.isFinite(value) || value < 0) {
    return {available: false, value: null, unit: 'W', reason: 'energy_balance_inconsistent', skewMs};
  }

  return {
    available: true,
    value,
    unit: 'W',
    metric: 'siteLoad',
    derived: true,
    formula: 'solarPower + gridNet + batteryNetPower',
    sourceAt: new Date(Math.max(...sourceTimes)).toISOString(),
    receivedAt: new Date(Math.max(...readings.map(result => Date.parse(result.reading.receivedAt)))).toISOString(),
    inputs: {
      gridNet: {value: grid.value, source: gridNet.source || null},
      solarPower: {value: solar.value, source: solarPower.source || null},
      batteryNetPower: {value: battery.value, source: batteryNetPower.source || null},
    },
    skewMs,
  };
}
