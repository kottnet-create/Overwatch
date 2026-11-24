import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(ROOT, 'data', 'nordpool-se3-prices.json');
const CACHE_MS = 15 * 60 * 1000;

export function createNordPoolPrices({ fetchImpl = fetch, cacheFile = CACHE_FILE } = {}) {
  let cache = readCache();
  let lastFetch = cache.fetchedAt ? Date.parse(cache.fetchedAt) : 0;
  let inFlight = null;

  function readCache() {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (parsed?.area === 'SE3' && Array.isArray(parsed.prices)) return parsed;
    } catch {}
    return { source: 'Spotpris.nu / Nord Pool', area: 'SE3', currency: 'SEK', unit: 'SEK/kWh', prices: [], current: null, lowest: null, highest: null, generatedAt: null, fetchedAt: null, error: null };
  }

  function normalize(payload) {
    const sek = payload?.currencies?.SEK;
    if (!sek || !Array.isArray(sek.prices)) throw new Error('Price source did not return a SEK price series.');
    const factor = sek.unit === 'sek_ore_per_kwh' ? 0.01 : sek.unit === 'sek_per_kwh' ? 1 : null;
    if (factor === null) throw new Error('Unsupported price unit from source: ' + String(sek.unit));
    const convert = item => item && Number.isFinite(item.price) && Number.isFinite(Date.parse(item.time))
      ? { startsAt: item.time, priceSekPerKwh: item.price * factor, originalPrice: item.price, originalUnit: sek.unit }
      : null;
    const prices = sek.prices.map(convert).filter(Boolean);
    if (!prices.length) throw new Error('Price source returned no valid SE3 price intervals.');
    return {
      source: 'Spotpris.nu / Nord Pool',
      area: 'SE3',
      currency: 'SEK',
      unit: 'SEK/kWh',
      prices,
      current: convert(sek.current),
      lowest: convert(sek.lowest),
      highest: convert(sek.highest),
      generatedAt: payload.generated_at || null,
      fetchedAt: new Date().toISOString(),
      error: null
    };
  }

  async function refresh(force = false) {
    if (inFlight) return inFlight;
    if (!force && lastFetch && Date.now() - lastFetch < CACHE_MS) return getStatus();
    inFlight = (async () => {
      try {
        const response = await fetchImpl('https://www.spotpris.nu/api/SE3.json', {
          headers: { accept: 'application/json', 'user-agent': 'Overwatch/0.1.0' },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) throw new Error('Spotpris.nu returned HTTP ' + response.status);
        const payload = await response.json();
        cache = normalize(payload);
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
        const temp = cacheFile + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 });
        fs.renameSync(temp, cacheFile);
        lastFetch = Date.now();
      } catch (error) {
        cache = { ...cache, error: error.message };
        // Failed requests are retried after one minute; cached prices remain visible as stale.
        lastFetch = Date.now() - CACHE_MS + 60 * 1000;
      } finally {
        inFlight = null;
      }
      return getStatus();
    })();
    return inFlight;
  }

  function getStatus() {
    return { ...cache, stale: !cache.fetchedAt || Date.now() - Date.parse(cache.fetchedAt) > 30 * 60 * 1000 };
  }

  return { refresh, getStatus };
}
