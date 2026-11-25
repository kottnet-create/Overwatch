import {assessReadingQuality} from './data-quality.mjs';

/**
 * Assess locally stored myUplink/NIBE samples without confusing a saved OAuth
 * token with a verified live API connection. myUplink's current status route
 * only confirms that credentials are stored, so connection remains unknown.
 */
export function assessNibeSource({accountStatus, latestMeasurements = [], now = Date.now(), maxReadingAgeMs = 3 * 60 * 1000} = {}) {
  const configured = accountStatus?.connected === true;
  const readings = (Array.isArray(latestMeasurements) ? latestMeasurements : []).map(sample => {
    const quality = assessReadingQuality({
      value: sample?.value,
      unit: sample?.unit,
      source: 'myUplink',
      sourceAt: sample?.sourceTimestamp,
      receivedAt: sample?.receivedAt || sample?.timestamp,
    }, {now, maxAgeMs: maxReadingAgeMs});
    return {
      parameterId: sample?.parameterId ?? null,
      parameterName: sample?.parameterName ?? null,
      unit: sample?.unit ?? null,
      quality: quality.quality,
      reason: quality.reason,
      sourceAgeMs: quality.sourceAgeMs ?? null,
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
    connection: configured ? 'unknown' : 'not_configured',
    connectionFreshness: 'unknown',
    lastSuccessAt: null,
    dataQuality,
    usable: false,
    reason: configured
      ? 'live_connection_not_verified_by_current_myUplink_status'
      : 'myuplink_account_not_connected',
    readingCount: readings.length,
    counts,
    readings,
  };
}
