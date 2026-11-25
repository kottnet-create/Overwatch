import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateEnergyBalance} from '../energy-flow.mjs';

const now = Date.parse('2026-11-26T12:00:00.000Z');
const reading = (value, source = 'test', sourceOffsetMs = 0, receivedOffsetMs = 0) => ({
  value,
  unit: 'W',
  source,
  sourceAt: new Date(now + sourceOffsetMs).toISOString(),
  receivedAt: new Date(now + receivedOffsetMs).toISOString(),
});

test('derives site load with grid export and battery charging without attributing export to solar alone', () => {
  const result = calculateEnergyBalance({
    gridNet: reading(-1000, 'Tibber Pulse'),
    solarPower: reading(6000, 'Huawei'),
    batteryNetPower: reading(-2000, 'Emaldo'),
    now,
  });
  assert.equal(result.available, true);
  assert.equal(result.value, 3000);
  assert.equal(result.derived, true);
  assert.equal(result.inputs.gridNet.source, 'Tibber Pulse');
});

test('derives site load when battery is discharging and grid is importing', () => {
  const result = calculateEnergyBalance({
    gridNet: reading(2000),
    solarPower: reading(5000),
    batteryNetPower: reading(1000),
    now,
  });
  assert.equal(result.value, 8000);
});

test('does not turn missing, stale, misaligned or invalid readings into zero', () => {
  const base = {
    gridNet: reading(1000),
    solarPower: reading(2000),
    batteryNetPower: reading(0),
    now,
  };
  assert.equal(calculateEnergyBalance({...base, solarPower: null}).reason, 'solar_missing');
  assert.equal(calculateEnergyBalance({...base, batteryNetPower: reading(0, 'battery', 0, -240000)}).reason, 'battery_stale');
  assert.equal(calculateEnergyBalance({...base, solarPower: reading(2000, 'solar', -120000)}).reason, 'readings_not_simultaneous');
  assert.equal(calculateEnergyBalance({...base, solarPower: reading(2000, 'solar', 0, 0)}).available, true);
  assert.equal(calculateEnergyBalance({...base, solarPower: reading(-1)}).reason, 'solar_negative');
  assert.equal(calculateEnergyBalance({...base, batteryNetPower: reading(-5000)}).reason, 'energy_balance_inconsistent');
  assert.equal(calculateEnergyBalance({...base, solarPower: {...reading(2000), sourceAt: '2026-02-30T12:00:00.000Z'}}).reason, 'solar_invalid_timestamp');
  assert.equal(calculateEnergyBalance({...base, gridNet: reading(1000, 'grid', -240000)}).reason, 'grid_stale');
});

test('requires watts and valid source and receipt timestamps', () => {
  const base = {
    gridNet: reading(1000),
    solarPower: reading(2000),
    batteryNetPower: reading(0),
    now,
  };
  assert.equal(calculateEnergyBalance({...base, gridNet: {...reading(1000), unit: 'kW'}}).reason, 'grid_invalid_unit');
  assert.equal(calculateEnergyBalance({...base, gridNet: {...reading(1000), sourceAt: 'yesterday'}}).reason, 'grid_invalid_timestamp');
});
