import assert from 'node:assert/strict';
import test from 'node:test';
import {findNibePointCandidates} from '../nibe-point-diagnostics.mjs';

test('finds compressor frequency candidates without changing the point catalogue', () => {
  const result = findNibePointCandidates({devices:[
    {deviceName:'NIBE F1255',points:[
      {parameterId:'1',parameterName:'BT50 Room temperature',value:21.5,unit:'°C'},
      {parameterId:'2',parameterName:'Kompressor frekvens',value:42,unit:'Hz',timestamp:'2026-11-26T12:00:00Z'},
      {parameterId:'3',parameterName:'Compressor speed',value:1200,unit:'rpm'},
    ]},
  ]});
  assert.equal(result.totalDevices,1);
  assert.equal(result.totalPoints,3);
  assert.equal(result.candidateCount,2);
  assert.equal(result.candidates[0].parameterId,'2');
  assert.equal(result.candidates[0].value,42);
  assert.equal(result.candidates[0].unit,'Hz');
  assert.equal(result.candidates[1].parameterId,'3');
  assert.equal(result.readOnly,true);
});

test('returns an empty diagnostic result for missing or malformed point data', () => {
  const result = findNibePointCandidates({devices:[{points:null}]});
  assert.equal(result.totalPoints,0);
  assert.equal(result.candidateCount,0);
  assert.deepEqual(result.candidates,[]);
});


test('finds frequency-like units even when the point name is not descriptive', () => {
  const result = findNibePointCandidates({devices:[{points:[
    {parameterId:'11',parameterName:'Parameter 11',value:48,unit:'Hz'},
    {parameterId:'12',parameterName:'Parameter 12',value:1450,unit:'rpm'},
    {parameterId:'13',parameterName:'BT50 Room temperature',value:21,unit:'°C'},
  ]}]});
  assert.equal(result.totalPoints,3);
  assert.equal(result.frequencyUnitCount,2);
  assert.equal(result.candidateCount,2);
  assert.equal(result.candidates[0].frequencyUnit,true);
  assert.equal(result.candidates[1].frequencyUnit,true);
  assert.equal(result.unitCounts['°C'],1);
});
