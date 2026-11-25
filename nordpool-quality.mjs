import {assessReadingQuality} from './data-quality.mjs';

/**
 * Assess the cached SE3 price series. Interval startsAt values may legitimately
 * be in the future, so freshness is based on fetchedAt, not the interval time.
 */
export function assessNordPoolSource(status, {now = Date.now(), maxAgeMs = 30 * 60 * 1000} = {}) {
  const snapshot = status && typeof status === 'object' ? status : {};
  const prices = Array.isArray(snapshot.prices) ? snapshot.prices : [];
  const fetchQuality = snapshot.fetchedAt
    ? assessReadingQuality({
        value: 1,
        unit: 'snapshot',
        source: 'Spotpris.nu / Nord Pool',
        sourceAt: snapshot.fetchedAt,
        receivedAt: snapshot.fetchedAt,
      }, {now, maxAgeMs, expectedUnit: 'snapshot'})
    : {quality: 'missing', reason: 'price_snapshot_missing', receivedAgeMs: null};

  const validIntervals = prices.filter(item =>
    item && typeof item === 'object' &&
    typeof item.priceSekPerKwh === 'number' &&
    Number.isFinite(item.priceSekPerKwh) &&
    typeof item.startsAt === 'string' &&
    Number.isFinite(Date.parse(item.startsAt)) &&
    item.unit !== 'invalid'
  );
  const invalidIntervals = prices.length - validIntervals.length;
  const correctMarket = snapshot.area === 'SE3' &&
    snapshot.currency === 'SEK' &&
    snapshot.unit === 'SEK/kWh';
  const seriesValid = prices.length > 0 && invalidIntervals === 0 && correctMarket;

  let dataQuality = fetchQuality.quality;
  let dataReason = fetchQuality.reason;
  if (dataQuality === 'fresh' && !seriesValid) {
    dataQuality = 'invalid';
    dataReason = !correctMarket ? 'price_market_or_unit_mismatch' :
      prices.length === 0 ? 'price_series_missing' : 'price_interval_invalid';
  }

  const error = typeof snapshot.error === 'string' && snapshot.error.length ? snapshot.error : null;
  let connection = 'unknown';
  if (error) connection = 'error';
  else if (dataQuality === 'fresh') connection = 'connected';
  else if (dataQuality === 'stale') connection = 'disconnected';

  return {
    provider: 'Nord Pool (Spotpris.nu)',
    area: snapshot.area || null,
    configured: true,
    connection,
    connectionFreshness: fetchQuality.quality,
    lastSuccessAt: snapshot.fetchedAt || null,
    dataQuality,
    dataReason,
    priceCount: prices.length,
    validPriceCount: validIntervals.length,
    invalidPriceCount: invalidIntervals,
    unit: snapshot.unit || null,
    currency: snapshot.currency || null,
    currentPriceAvailable: Boolean(snapshot.current &&
      typeof snapshot.current.priceSekPerKwh === 'number' &&
      Number.isFinite(snapshot.current.priceSekPerKwh)),
    error,
    usable: !error && dataQuality === 'fresh' && seriesValid,
  };
}
