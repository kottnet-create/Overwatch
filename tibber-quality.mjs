import {buildSourceStatus} from './data-quality.mjs';

/**
 * Adapt the existing Tibber monitor status to the shared data-quality contract.
 * Tibber power is reported here as a source reading only; this adapter does
 * not infer solar production, battery flow, or import/export sign semantics.
 */
export function assessTibberSource(status, {now = Date.now()} = {}) {
  const latest = status?.latest;
  const latestReading = latest && typeof latest === 'object'
    ? {
        value: latest.power,
        unit: 'W',
        source: 'Tibber Pulse',
        sourceAt: latest.timestamp,
        receivedAt: status.receivedAt,
      }
    : null;

  return buildSourceStatus({
    provider: 'Tibber',
    configured: status?.configured === true,
    connectionStatus: status?.status || null,
    latestReading,
    now,
    expectedUnit: 'W',
  });
}
