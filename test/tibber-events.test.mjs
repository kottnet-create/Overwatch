import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {createServer} from '../server.mjs';

test('Tibber events endpoint streams the current status and subsequent live updates', async t => {
  let publish;
  const initial = {status: 'connected', stale: false, latest: {power: 1200}};
  const tibberMonitor = {
    getStatus: () => initial,
    subscribe(listener) { publish = listener; return () => { publish = null; }; },
    getHistory: () => ({samples: []}),
    getPrices: () => ({}),
    close() {},
  };
  const server = createServer({
    tibberMonitor,
    nordPoolPrices: {getStatus: () => ({}), close() {}, refresh: async () => {}},
    myUplink: {close() {}},
    nibeHistory: {close() {}, getLatest: () => [], stats: () => ({}), prune() {}},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  const response = await new Promise((resolve, reject) => {
    const request = http.get({host: '127.0.0.1', port, path: '/api/tibber/events'}, resolve);
    request.on('error', reject);
  });
  t.after(() => response.destroy());
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);

  const firstEvent = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for initial SSE status.')), 1000);
    response.once('data', chunk => { clearTimeout(timeout); resolve(chunk.toString()); });
  });
  assert.match(firstEvent, /retry: 3000/);
  assert.match(firstEvent, /"power":1200/);

  const nextStatus = {status: 'connected', stale: false, latest: {power: 850}};
  const nextEvent = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for live SSE update.')), 1000);
    response.once('data', chunk => { clearTimeout(timeout); resolve(chunk.toString()); });
  });
  publish(nextStatus);
  assert.match(await nextEvent, /"power":850/);
});
