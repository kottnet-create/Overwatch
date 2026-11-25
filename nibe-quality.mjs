import {assessReadingQuality} from './data-quality.mjs';

/**
 * Assess locally stored myUplink/NIBE samples without confusing a saved OAuth
 * token with a verified live API connection. The aggregate status path supplies
 * the result of a read-only live myUplink systems query.
 */
export function assessNibeSource({accountStatus, latestMeasurements = [], now = Date.now(), maxReadingAgeMs = 7 * 60 * 1000} = {}) {
  const configured = accountStatus?.configured === true || accountStatus?.connected === true;
  const liveState = String(accountStatus?.connectionState || '').toLowerCase();
  const connection = ['connected', 'online', 'ready'].includes(liveState) ? 'connected'
    : ['disconnected', 'offline', 'closed'].includes(liveState) ? 'disconnected'
    : liveState === 'error' ? 'error'
    : configured ? 'unknown' : 'not_configured';
  const lastSuccessAt = accountStatus?.lastSuccessAt || null;
  const connectionAgeMs = lastSuccessAt ? Math.max(0, now - Date.parse(lastSuccessAt)) : null;
  const connectionFresh = Number.isFinite(connectionAgeMs) && connectionAgeMs <= 10 * 60 * 1000;
  // getLatest() currently returns a bounded history window, not one row per
  // parameter. Keep only the newest received sample for each NIBE point.
  const newestByPoint = new Map();
  for (const sample of (Array.isArray(latestMeasurements) ? latestMeasurements : [])) {
    const key = String(sample?.parameterId ?? sample?.parameterName ?? '');
    if (!key) continue;
    const previous = newestByPoint.get(key);
    const received = Date.parse(sample?.receivedAt || sample?.timestamp || '');
    const previousReceived = Date.parse(previous?.receivedAt || previous?.timestamp || '');
    if (!previous || (Number.isFinite(received) && (!Number.isFinite(previousReceived) || received >= previousReceived))) {
      newestByPoint.set(key, sample);
    }
  }
  const readings = [...newestByPoint.values()].map(sample => {
    const quality = assessReadingQuality({
      value: sample?.value,
      unit: sample?.unit,
      source: 'myUplink',
      // myUplink's point timestamp describes when the value last changed.
      // The endpoint returns the current snapshot, so polling receipt time
      // determines whether the snapshot itself is fresh.
      sourceAt: sample?.receivedAt || sample?.timestamp,
      receivedAt: sample?.receivedAt || sample?.timestamp,
    }, {now, maxAgeMs: maxReadingAgeMs});
    const sourceAgeMs = sample?.sourceTimestamp ? now - Date.parse(sample.sourceTimestamp) : null;
    return {
      parameterId: sample?.parameterId ?? null,
      parameterName: sample?.parameterName ?? null,
      unit: sample?.unit ?? null,
      quality: quality.quality,
      reason: quality.reason,
      sourceAgeMs: Number.isFinite(sourceAgeMs) ? Math.max(0, sourceAgeMs) : null,
      receivedAgeMs: quality.receivedAgeMs ?? null,
    };
  });

  const counts = readings.reduce((acc, item) => {
    acc[item.quality] = (acc[item.quality] || 0) + 1;
    return acc;
  }, {fresh: 0, stale: 0, invalid: 0, missing: 0});

  let dataQuality = 'missing';
  if (readings.length) {
    const categories = Object.keys(counts).filter(key => counts[key] > 0);
    dataQuality = categories.length === 1 ? categories[0] : 'partial';
  }

  return {
    provider: 'myUplink / NIBE',
    configured,
    connection,
    connectionFreshness: connectionFresh ? 'fresh' : 'unknown',
    lastSuccessAt,
    connectionAgeMs,
    dataQuality,
    usable: connection === 'connected' && connectionFresh && counts.fresh > 0,
    reason: connection !== 'connected' ? (configured ? 'live_connection_not_verified' : 'myuplink_account_not_connected')
      : !connectionFresh ? 'live_connection_status_stale'
      : counts.fresh === 0 ? 'no_fresh_nibe_snapshot' : null,
    readingCount: readings.length,
    counts,
    readings,
  };
}
