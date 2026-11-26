import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNibeHistory} from '../nibe-history.mjs';

test('stores and retrieves the verified NIBE compressor frequency point by parameter ID', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'overwatch-nibe-frequency-'));
  const dbPath=path.join(directory,'overwatch.sqlite');
  const now=Date.parse('2026-11-26T12:05:00.000Z');
  const history=createNibeHistory({dbPath,now:()=>now});
  try {
    const result=history.record({devices:[{
      systemId:'system-1',
      deviceId:'device-1',
      points:[
        {parameterId:'41778',parameterName:'Aktuell kompressor­frekvens',value:60,unit:'Hz',timestamp:'2026-11-26T12:04:00.000Z'},
        {parameterId:'43122',parameterName:'Min kompressor­frekvens',value:20,unit:'Hz',timestamp:'2026-11-25T22:38:23.000Z'},
        {parameterId:'49999',parameterName:'Unrelated diagnostic value',value:7,unit:'%',timestamp:'2026-11-26T12:04:00.000Z'},
      ],
    }]});
    assert.equal(result.inserted,1);
    const latest=history.getLatest();
    assert.equal(latest.length,1);
    assert.equal(latest[0].parameterId,'41778');
    assert.equal(latest[0].parameterName,'Aktuell kompressor­frekvens');
    assert.equal(latest[0].value,60);
    assert.equal(latest[0].unit,'Hz');
    const saved=history.getHistory(24).samples;
    assert.equal(saved.length,1);
    assert.equal(saved[0].parameterId,'41778');
    assert.equal(saved[0].value,60);
  } finally {
    history.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
