import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const API_URL = 'https://api.tibber.com/v1-beta/gql';
const USER_AGENT = 'Overwatch/0.1.0 (Node.js home-energy-monitor)';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(ROOT, 'data', 'tibber-history.json');
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 9000;
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

export function createTibberMonitor({ token = process.env.TIBBER_TOKEN, homeId = process.env.TIBBER_HOME_ID, historyFile = HISTORY_FILE } = {}) {
  let socket = null;
  let stopped = false;
  let retryTimer = null;
  let retryAttempt = 0;
  let lastStoredAt = 0;
  let history = loadHistory();
  let state = {
    configured: Boolean(token),
    status: token ? 'starting' : 'not_configured',
    message: token ? 'Preparing Tibber connection.' : 'Add TIBBER_TOKEN to your local .env file.',
    homeName: null,
    latest: null,
    receivedAt: null,
  };

  const update = patch => { state = { ...state, ...patch }; };

  function loadHistory() {
    try {
      if (!fs.existsSync(historyFile)) return [];
      const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length > MAX_HISTORY_SAMPLES) return [];
      return parsed.filter(item => item && typeof item.timestamp === 'string' && Number.isFinite(Date.parse(item.timestamp)));
    } catch { return []; }
  }

  function storeSample(sample) {
    const at = Date.parse(sample.timestamp);
    if (!Number.isFinite(at) || at - lastStoredAt < SAMPLE_INTERVAL_MS) return;
    history.push({ ...sample });
    history = history.slice(-MAX_HISTORY_SAMPLES);
    try {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true, mode: 0o700 });
      const temporary = historyFile + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(history), { mode: 0o600 });
      fs.renameSync(temporary, historyFile);
      lastStoredAt = at;
    } catch (error) {
      update({ historyError: 'Could not save local Tibber history: ' + error.message });
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
        if (live && Number.isFinite(Number(live.power)) && Number.isFinite(Date.parse(live.timestamp))) {
          const normalized = {
            timestamp: live.timestamp,
            power: Number(live.power),
            powerProduction: live.powerProduction == null ? null : Number(live.powerProduction),
            accumulatedConsumption: live.accumulatedConsumption == null ? null : Number(live.accumulatedConsumption),
            accumulatedCost: live.accumulatedCost == null ? null : Number(live.accumulatedCost),
            currency: live.currency || null,
            minPower: live.minPower == null ? null : Number(live.minPower),
            averagePower: live.averagePower == null ? null : Number(live.averagePower),
            maxPower: live.maxPower == null ? null : Number(live.maxPower),
            accumulatedProduction: live.accumulatedProduction == null ? null : Number(live.accumulatedProduction),
            lastMeterProduction: live.lastMeterProduction == null ? null : Number(live.lastMeterProduction),
            lastMeterConsumption: live.lastMeterConsumption == null ? null : Number(live.lastMeterConsumption),
          };
          storeSample(normalized);
          update({
            status: 'connected',
            message: 'Receiving live measurements from Tibber.',
            homeName: home.appNickname || 'Home',
            latest: normalized,
            receivedAt: new Date().toISOString(),
          });
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
    close() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) socket.close(1000, 'Overwatch server stopping');
      socket = null;
    },
  };
}
