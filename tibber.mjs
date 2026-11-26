import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTibberHistory} from './tibber-history.mjs';

const API_URL = 'https://api.tibber.com/v1-beta/gql';
const USER_AGENT = 'Overwatch/0.1.0 (Node.js home-energy-monitor)';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(ROOT, 'data', 'tibber-history.json');
const LIVE_QUERY = `subscription OverwatchLiveMeasurement($homeId: ID!) {
  liveMeasurement(homeId: $homeId) {
    timestamp
    power
    accumulatedConsumption
    accumulatedCost
    currency
    minPower
    averagePower
    maxPower
    powerProduction
    accumulatedProduction
    lastMeterProduction
    lastMeterConsumption
  }
}`;

const sleepJitter = ms => Math.round(ms * (0.75 + Math.random() * 0.5));

/** Normalize one Tibber live event without turning absent fields into zero. */
export function normalizeTibberLiveMeasurement(live) {
  if (!live || typeof live !== 'object' || Array.isArray(live) ||
      typeof live.timestamp !== 'string' || !Number.isFinite(Date.parse(live.timestamp)) ||
      live.power == null || live.power === '' || !Number.isFinite(Number(live.power))) {
    return null;
  }

  const optionalNumber = value =>
    value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

  return {
    timestamp: live.timestamp,
    power: Number(live.power),
    powerProduction: optionalNumber(live.powerProduction),
    accumulatedConsumption: optionalNumber(live.accumulatedConsumption),
    accumulatedCost: optionalNumber(live.accumulatedCost),
    currency: typeof live.currency === 'string' && live.currency.trim() ? live.currency : null,
    minPower: optionalNumber(live.minPower),
    averagePower: optionalNumber(live.averagePower),
    maxPower: optionalNumber(live.maxPower),
    accumulatedProduction: optionalNumber(live.accumulatedProduction),
    lastMeterProduction: optionalNumber(live.lastMeterProduction),
    lastMeterConsumption: optionalNumber(live.lastMeterConsumption),
  };
}

export function createTibberMonitor({ token = process.env.TIBBER_TOKEN, homeId = process.env.TIBBER_HOME_ID, historyFile = HISTORY_FILE, dbPath = process.env.OVERWATCH_DB_PATH ? path.resolve(ROOT, process.env.OVERWATCH_DB_PATH) : path.join(ROOT, 'data', 'overwatch.sqlite'), now = () => Date.now() } = {}) {
  let socket = null;
  let stopped = false;
  let retryTimer = null;
  let retryAttempt = 0;
  const historyStore = createTibberHistory({dbPath, legacyHistoryFile: historyFile, now});
  let history = historyStore.getHistory();
  let selectedHomeId = homeId || null;
  let prices = loadPrices();
  let priceFetchedAt = prices.fetchedAt ? Date.parse(prices.fetchedAt) : 0;
  let priceTimer = null;
  const listeners = new Set();
  let state = {
    configured: Boolean(token),
    status: token ? 'starting' : 'not_configured',
    message: token ? 'Preparing Tibber connection.' : 'Add TIBBER_TOKEN to your local .env file.',
    homeName: null,
    latest: null,
    receivedAt: null,
  };

  const update = patch => { state = { ...state, ...patch }; };

  function loadPrices() {
    try {
      const file = path.join(ROOT, 'data', 'tibber-prices.json');
      if (!fs.existsSync(file)) return { today: [], tomorrow: [], fetchedAt: null, currency: null, error: null };
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { today: Array.isArray(parsed.today) ? parsed.today : [], tomorrow: Array.isArray(parsed.tomorrow) ? parsed.tomorrow : [], fetchedAt: parsed.fetchedAt || null, currency: parsed.currency || null, error: null };
    } catch { return { today: [], tomorrow: [], fetchedAt: null, currency: null, error: 'Could not read cached price data.' }; }
  }

  function savePrices() {
    const file = path.join(ROOT, 'data', 'tibber-prices.json');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(prices), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  async function refreshPrices() {
    if (stopped || !token || !selectedHomeId) return;
    const now = Date.now();
    // Prices normally change once per day. Retry sooner only if tomorrow's
    // prices have not been published yet.
    const hasTomorrow = prices.tomorrow.length > 0;
    const refreshAfter = hasTomorrow ? 20 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (priceFetchedAt && now - priceFetchedAt < refreshAfter) return;
    try {
      const data = await gql(`query OverwatchPrices {
        viewer {
          homes {
            id
            currentSubscription {
              priceInfo(resolution: QUARTER_HOURLY) {
                current { startsAt total energy tax currency level }
                today { startsAt total energy tax currency level }
                tomorrow { startsAt total energy tax currency level }
              }
            }
          }
        }
      }`);
      const selectedHome = (data.viewer.homes || []).find(home => home.id === selectedHomeId);
      const info = selectedHome?.currentSubscription?.priceInfo;
      if (!info) throw new Error('No price information was returned for the selected Tibber home. Check that the home has an active electricity subscription.');
      const normalize = list => (list || []).map(item => ({
        startsAt: item.startsAt,
        total: Number.isFinite(item.total) ? item.total : null,
        energy: Number.isFinite(item.energy) ? item.energy : null,
        tax: Number.isFinite(item.tax) ? item.tax : null,
        currency: item.currency || null,
        level: item.level || null,
      })).filter(item => Number.isFinite(Date.parse(item.startsAt)));
      const today = normalize(info.today);
      if (!today.length) throw new Error('Tibber returned no prices for today. Tomorrow’s prices may also be unpublished.');
      prices = {
        today,
        tomorrow: normalize(info.tomorrow),
        current: info.current ? normalize([info.current])[0] : null,
        fetchedAt: new Date().toISOString(),
        currency: today[0]?.currency || null,
        error: null,
      };
      priceFetchedAt = Date.now();
      savePrices();
    } catch (error) {
      prices = { ...prices, error: error.message };
      // Do not mark a failed attempt as successful; retry in one hour.
      priceFetchedAt = 0;
    }
  }

  function storeSample(sample) {
    try {
      const result = historyStore.recordSample(sample, {systemId: selectedHomeId || homeId || ''});
      history = historyStore.getHistory();
      if (result.error) update({historyError: 'Could not save local Tibber history: ' + result.error});
    } catch (error) {
      update({historyError: 'Could not save local Tibber history: ' + error.message});
    }
  }

  async function gql(query, variables = {}) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Tibber API returned HTTP ${response.status}.`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors.map(item => item.message).join('; '));
    if (!body.data) throw new Error('Tibber returned no data.');
    return body.data;
  }

  async function connect() {
    if (stopped || !token) return;
    update({ status: 'connecting', message: 'Connecting to Tibber.' });
    try {
      const data = await gql(`query OverwatchConnection {
        viewer {
          websocketSubscriptionUrl
          homes {
            id
            appNickname
            features { realTimeConsumptionEnabled }
          }
        }
      }`);
      const homes = data.viewer.homes || [];
      const eligible = homes.filter(home => home.features?.realTimeConsumptionEnabled);
      const selected = homeId
        ? eligible.find(home => home.id === homeId)
        : eligible.length === 1 ? eligible[0] : null;
      if (!selected) {
        const message = homeId
          ? 'Configured Tibber home was not found or has no real-time device.'
          : eligible.length > 1
            ? 'More than one Tibber home supports real-time data. Set TIBBER_HOME_ID in .env.'
            : 'No Tibber home currently reports a real-time Pulse or Watty device.';
        update({ status: 'needs_home', message });
        return;
      }
      selectedHomeId = selected.id;
      refreshPrices();
      priceTimer = setInterval(refreshPrices, 60 * 60 * 1000);
      priceTimer.unref?.();
      const url = data.viewer.websocketSubscriptionUrl;
      if (!url || !url.startsWith('wss://')) throw new Error('Tibber did not provide a secure WebSocket URL.');
      openSocket(url, selected);
    } catch (error) {
      update({ status: 'error', message: error.message });
      scheduleReconnect();
    }
  }

  function openSocket(url, home) {
    socket = new WebSocket(url, 'graphql-transport-ws', {
      headers: { 'User-Agent': USER_AGENT },
      handshakeTimeout: 15000,
      perMessageDeflate: false,
    });
    let acknowledged = false;
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'connection_init', payload: { token } }));
    });
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'connection_ack') {
        acknowledged = true;
        retryAttempt = 0;
        update({ status: 'connected', message: 'Connected to Tibber live measurements.', homeName: home.appNickname || 'Home' });
        socket.send(JSON.stringify({
          id: 'overwatch-live',
          type: 'subscribe',
          payload: { query: LIVE_QUERY, variables: { homeId: home.id } },
        }));
      } else if (message.type === 'next') {
        const live = message.payload?.data?.liveMeasurement;
        const normalized = normalizeTibberLiveMeasurement(live);
        if (normalized) {
          storeSample(normalized);
          const receivedAt = new Date().toISOString();
          update({
            status: 'connected',
            message: 'Receiving live measurements from Tibber.',
            homeName: home.appNickname || 'Home',
            latest: normalized,
            receivedAt,
          });
          const snapshot = getStatus();
          for (const listener of listeners) {
            try { listener(snapshot); } catch { /* A disconnected client must not affect Tibber ingestion. */ }
          }
        }
      } else if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', ...(message.payload ? { payload: message.payload } : {}) }));
      } else if (message.type === 'error' || message.type === 'connection_error') {
        const detail = Array.isArray(message.payload) ? message.payload.map(x => x.message).join('; ') : 'Tibber WebSocket reported an error.';
        update({ status: 'error', message: detail });
        socket.close();
      } else if (message.type === 'complete') {
        update({ status: 'disconnected', message: 'Tibber ended the live subscription.' });
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 401 || response.statusCode === 403) {
        update({ status: 'auth_error', message: 'Tibber rejected the token. Check or replace TIBBER_TOKEN in .env.' });
        stopped = true;
      }
    });
    socket.on('error', error => {
      if (!stopped) update({ status: 'error', message: error.message });
    });
    socket.on('close', (code, reason) => {
      socket = null;
      if (stopped) return;
      if (code === 4401 || code === 4403) {
        stopped = true;
        update({ status: 'auth_error', message: 'Tibber rejected the token. Check or replace TIBBER_TOKEN in .env.' });
        return;
      }
      update({
        status: 'disconnected',
        message: acknowledged ? 'Tibber connection closed. Reconnecting.' : `Tibber connection closed (${code}). Reconnecting.`,
      });
      scheduleReconnect(code === 1001 ? 1000 : undefined);
    });
  }

  function scheduleReconnect(minimum) {
    if (stopped || retryTimer || !token) return;
    const base = minimum ?? Math.min(60000, 2000 * (2 ** Math.min(retryAttempt, 5)));
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, sleepJitter(base));
    retryTimer.unref?.();
  }

  if (token) connect();

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Tibber listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStatus() {
      const stale = state.receivedAt ? Date.now() - Date.parse(state.receivedAt) > 180000 : true;
      return {
        ...state,
        latest: state.latest,
        historyCount: history.length,
        historyError: state.historyError || null,
        stale,
      };
    },
    getHistory() {
      return { source: 'Tibber Pulse', intervalMinutes: 5, samples: history };
    },
    getPrices() {
      return { ...prices, stale: !prices.fetchedAt || Date.now() - Date.parse(prices.fetchedAt) > 26 * 60 * 60 * 1000 };
    },
    close() {
      stopped = true;
      if (priceTimer) clearInterval(priceTimer);
      priceTimer = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) socket.close(1000, 'Overwatch server stopping');
      socket = null;
      historyStore.close();
    },
  };
}
