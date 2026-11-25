import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from '../server.mjs';

const now = Date.now();
function makeServer(overrides = {}) {
  const tibberMonitor = {
    getStatus: () => ({
      configured: true,
      status: 'connected',
      latest: {timestamp: new Date(now - 1000).toISOString(), power: 1200},
      receivedAt: new Date(now - 500).toISOString(),
    }),
    getHistory: () => ({}), getPrices: () => ({}), close() {},
    ...overrides.tibberMonitor,
  };
  const nordPoolPrices = {
    getStatus: () => ({
      area: 'SE3', currency: 'SEK', unit: 'SEK/kWh',
      prices: [{startsAt: new Date(now).toISOString(), priceSekPerKwh: 1.2}],
      fetchedAt: new Date(now - 1000).toISOString(), error: null,
    }),
    refresh: async () => ({}),
    ...overrides.nordPoolPrices,
  };
  const myUplink = {
    status: callback => callback(200, JSON.stringify({connected: true, provider: 'myUplink'})),
    close() {},
    ...overrides.myUplink,
  };
  const nibeHistory = {
    getLatest: () => [{
      parameterId: 'BT6', parameterName: 'BT6', value: 45, unit: '°C',
      timestamp: new Date(now - 1000).toISOString(),
      sourceTimestamp: new Date(now - 1000).toISOString(),
      receivedAt: new Date(now - 1000).toISOString(),
    }],
    close() {},
    ...overrides.nibeHistory,
  };
  return createServer({tibberMonitor,nordPoolPrices,myUplink,nibeHistory,autoCollect:false});
}

test('GET /api/status aggregates provider states without exposing credentials', async t => {
  const server = makeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/status');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sources.length, 3);
    assert.deepEqual(body.sources.map(source => source.provider), [
      'Tibber', 'myUplink / NIBE', 'Nord Pool (Spotpris.nu)',
    ]);
    assert.equal(body.sources[0].usable, true);
    assert.equal(body.sources[1].connection, 'unknown');
    assert.equal(body.sources[1].usable, false);
    assert.equal(body.sources[2].usable, true);
    assert.equal(body.summary.total, 3);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes('access_token'), false);
    assert.equal(serialized.includes('refresh_token'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('GET /api/status keeps unconfigured and missing providers unavailable', async t => {
  const server = makeServer({
    tibberMonitor: {getStatus: () => ({configured:false,status:'not_configured',latest:null,receivedAt:null})},
    myUplink: {status: callback => callback(200, JSON.stringify({connected:false}))},
    nibeHistory: {getLatest: () => []},
    nordPoolPrices: {getStatus: () => ({area:'SE3',currency:'SEK',unit:'SEK/kWh',prices:[],fetchedAt:null,error:null})},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/status');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sources.every(source => source.usable === false), true);
    assert.equal(body.summary.usable, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('GET /api/status uses verified live myUplink device connection', async () => {
  const server = makeServer({
    myUplink: {
      connectionStatus: async () => ({
        configured: true,
        connectionState: 'connected',
        lastSuccessAt: new Date().toISOString(),
        devices: [{deviceName: 'Nibe F1255', connectionState: 'Connected'}],
      }),
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/status');
    const body = await response.json();
    const nibe = body.sources.find(source => source.provider === 'myUplink / NIBE');
    assert.equal(response.status, 200);
    assert.equal(nibe.connection, 'connected');
    assert.equal(nibe.connectionFreshness, 'fresh');
    assert.equal(nibe.usable, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('GET /api/myuplink/history/quality returns per-point diagnostics', async () => {
  const quality = {
    hours: 720, retentionDays: 30, count: 1,
    points: [{parameterId: 'BT7', parameterName: 'Varmvatten topp (BT7)', value: 48.5, unit: '°C', sampleCount: 120, gapsOver10Minutes: 2, maxGapMinutes: 15, ageMs: 1000, quality: 'fresh'}],
    counts: {fresh: 1, stale: 0},
    generatedAt: new Date().toISOString(),
  };
  const server = makeServer({nibeHistory: {getPointStats: hours => ({...quality, hours})}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/myuplink/history/quality?hours=24');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hours, 24);
    assert.equal(body.points[0].parameterId, 'BT7');
    assert.equal(body.points[0].sampleCount, 120);
    assert.equal(body.points[0].gapsOver10Minutes, 2);
    assert.equal(body.points[0].maxGapMinutes, 15);
    assert.equal(body.counts.fresh, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
