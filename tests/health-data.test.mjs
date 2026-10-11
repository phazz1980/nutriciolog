import test from 'node:test';
import assert from 'node:assert/strict';
import { latestHealthWeight, stepsProgress, healthBurnedCalories } from '../js/health-data.js';

test('burned calories distinguish zero from no data and require current-day permission', () => {
  const summary = {energyGranted:true,energyDate:'2026-10-11',burnedCalories:1820.6};
  assert.equal(healthBurnedCalories(summary,'2026-10-11'),1821);
  assert.equal(healthBurnedCalories({...summary,burnedCalories:0},'2026-10-11'),0);
  for (const burnedCalories of [undefined,null,-1,Infinity,'1800']) assert.equal(healthBurnedCalories({...summary,burnedCalories},'2026-10-11'),null);
  assert.equal(healthBurnedCalories({...summary,energyGranted:false},'2026-10-11'),null);
  assert.equal(healthBurnedCalories(summary,'2026-10-12'),null);
});

test('steps are hidden after permission revocation or at the next local day', () => {
  const summary = { stepsGranted: true, stepsDate: '2026-10-11', steps: 4200 };
  assert.equal(stepsProgress(summary, 8000, '2026-10-11').percent, 53);
  assert.equal(stepsProgress({ ...summary, stepsGranted: false }, 8000, '2026-10-11').steps, null);
  assert.equal(stepsProgress(summary, 8000, '2026-10-12').steps, null);
});

test('goal progress caps at 100 and handles missing or invalid counts', () => {
  assert.equal(stepsProgress({ stepsGranted: true, stepsDate: '2026-10-11', steps: 12000 }, 8000, '2026-10-11').percent, 100);
  assert.equal(stepsProgress(null, 0, '2026-10-11').goal, 8000);
  assert.equal(stepsProgress({ stepsGranted: true, stepsDate: '2026-10-11', steps: -1 }, 8000, '2026-10-11').steps, null);
});

test('weight prefill rejects denied access, future dates and weights outside diary bounds', () => {
  const summary = { weightGranted: true, weightDate: '2026-10-10', weight: 85.3 };
  assert.deepEqual(latestHealthWeight(summary, '2026-10-11'), { weight: 85.3, date: '2026-10-10' });
  assert.equal(latestHealthWeight({ ...summary, weightGranted: false }, '2026-10-11'), null);
  assert.equal(latestHealthWeight({ ...summary, weightDate: '2026-10-12' }, '2026-10-11'), null);
  assert.equal(latestHealthWeight({ ...summary, weight: 0 }, '2026-10-11'), null);
});
