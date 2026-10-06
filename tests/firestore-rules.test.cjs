const { before, after, test } = require('node:test');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, updateDoc, serverTimestamp } = require('firebase/firestore');
let env;
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run npm run test:rules against the local demo emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-x20-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
const fixtures = {
  'profile/main': { name: 'Test', age: 30, height: 170, weight: 70, targetWeight: 65, goal: 'Похудение', calories: 1900 },
  'foodDiary/meal': { id: 'meal', date: '2026-10-06', mealType: 'Перекус', title: 'Test meal', portion: 100, portionUnit: 'г', unitWeight: null, calories: 100, protein: 10, fat: 3, carbs: 8, source: 'manual' },
  'products/test': { title: 'Test', normalizedName: 'test', portion: 100, unitWeight: null, calories: 100, protein: 10, fat: 3, carbs: 8 },
  'waterLogs/2026-10-06': { date: '2026-10-06', glasses: 3 },
  'weightEntries/2026-10-06': { date: '2026-10-06', weight: 70 },
  'dayPlans/2026-10-06': { date: '2026-10-06', meals: { Завтрак: [{ name: 'Test', calories: 100 }], Обед: [], Ужин: [], Перекус: [] } },
};
for (const [path, value] of Object.entries(fixtures)) {
  test(`${path}: owner can create/read/update/delete; other UID and guest cannot`, async () => {
    const owner = env.authenticatedContext('owner').firestore();
    const foreign = env.authenticatedContext('other').firestore();
    const guest = env.unauthenticatedContext().firestore();
    const ref = db => doc(db, `users/owner/${path}`);
    await assertSucceeds(setDoc(ref(owner), { ...value, updatedAt: serverTimestamp() }));
    await assertSucceeds(getDoc(ref(owner)));
    for (const db of [foreign, guest]) {
      await assertFails(getDoc(ref(db)));
      await assertFails(setDoc(ref(db), { ...value, updatedAt: serverTimestamp() }));
      await assertFails(deleteDoc(ref(db)));
    }
    await assertSucceeds(updateDoc(ref(owner), { updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(owner), { secret: 'unexpected' }));
    await assertFails(updateDoc(ref(owner), { updatedAt: 'not a timestamp' }));
    await assertSucceeds(deleteDoc(ref(owner)));
  });
}
test('Malformed values, document IDs and unknown collections are denied', async () => {
  const db = env.authenticatedContext('owner').firestore();
  const reject = (path, data) => assertFails(setDoc(doc(db, `users/owner/${path}`), { ...data, updatedAt: serverTimestamp() }));
  for (const field of ['calories', 'protein', 'fat', 'carbs']) {
    await reject('foodDiary/meal', { ...fixtures['foodDiary/meal'], [field]: -1 });
    await reject('foodDiary/meal', { ...fixtures['foodDiary/meal'], [field]: '100' });
  }
  await reject('foodDiary/wrong', fixtures['foodDiary/meal']);
  await reject('foodDiary/meal', { ...fixtures['foodDiary/meal'], unitWeight: 0 });
  await reject('products/wrong', fixtures['products/test']);
  await reject('waterLogs/2026-10-06', { date: '2026-10-07', glasses: 1 });
  await reject('waterLogs/2026-10-06', { date: '2026-10-06', glasses: 9 });
  await reject('weightEntries/2026-10-06', { date: '2026-10-06', weight: 0 });
  await reject('profile/main', { calories: 0 });
  await reject('other/test', { arbitrary: true });
});
test('Plan validates nested items and accepts the 20-item boundary', async () => {
  const db = env.authenticatedContext('owner').firestore();
  const ref = doc(db, 'users/owner/dayPlans/2026-10-06');
  const make = meals => ({ date: '2026-10-06', meals, updatedAt: serverTimestamp() });
  const base = { Завтрак: [], Обед: [], Ужин: [], Перекус: [] };
  await assertSucceeds(setDoc(ref, make({ ...base, Завтрак: Array.from({length:20}, () => ({name:'Test', calories:100})) })));
  for (const item of [{name:'Bad',calories:-1}, {name:'',calories:100}, {name:'Bad',calories:'100'}, {name:'Bad',calories:100,extra:true}]) {
    await assertFails(setDoc(ref, make({ ...base, Перекус: [item] })));
  }
  await assertFails(setDoc(ref, make([])));
  await assertFails(setDoc(ref, make({ ...base, Другой: [] })));
  await assertFails(setDoc(ref, make({ ...base, Завтрак: Array.from({length:21}, () => ({name:'Test', calories:100})) })));
});
