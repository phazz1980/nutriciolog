import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { nutritionTargets } from '../js/core.js';
const source = readFileSync(new URL('../js/daily-advice.js', import.meta.url), 'utf8')
  .split('export function initDailyAdvice')[0].replace(/^import .*;\r?$/gm, '').replace(/export /g, '');
const context = vm.createContext({ nutritionTargets });
vm.runInContext(source, context);
const { dailyAdvicePrompt, dailyAdviceFingerprint } = context;

const diary = [{ title: 'Каша', calories: 600, protein: 10, fat: 35, carbs: 60 }];
const products = [
  { title: 'Творог', portion: 200, calories: 200, protein: 40, fat: 4, carbs: 6 },
  { title: 'Яйцо', portion: 2, unitWeight: 50, calories: 150, protein: 13, fat: 10, carbs: 1 },
];
test('next meal advice includes actual intake, daily goals and own foods with normalized macros', () => {
  const prompt = dailyAdvicePrompt(diary, products, { calories: 1800 });
  assert.match(prompt, /600\/10\/35\/60/);
  assert.match(prompt, /1800\/135\/60\/180/);
  assert.ok(prompt.includes('["Творог",100,20,2,3]'));
  assert.ok(prompt.includes('["Яйцо",150,13,10,1]'));
  assert.match(prompt, /только из базы/);
  assert.match(prompt, /перекос БЖУ/);
  assert.match(prompt, /незавершённый день не считай дефицитом/);
  assert.ok(prompt.length <= 1000);
});
test('large library and diary stay within gateway limit; all meals count toward totals', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...products[0], title: 'Длинное название продукта '.repeat(5) + i }));
  const prompt = dailyAdvicePrompt(Array.from({ length: 20 }, () => diary[0]), many, { calories: 1800 });
  assert.ok(prompt.length <= 1000);
  assert.match(prompt, /12000\/200\/700\/1200/);
  assert.match(prompt, /Всего записей: 20/);
});
test('cache changes for food, portion, library and targets, not reordered library', () => {
  const key = dailyAdviceFingerprint(diary, products, { calories: 1800 });
  assert.equal(key, dailyAdviceFingerprint(diary, [...products].reverse(), { calories: 1800 }));
  assert.notEqual(key, dailyAdviceFingerprint([...diary, diary[0]], products, { calories: 1800 }));
  assert.notEqual(key, dailyAdviceFingerprint(diary, products.slice(1), { calories: 1800 }));
  assert.notEqual(key, dailyAdviceFingerprint(diary, products, { calories: 1900 }));
});
test('empty or incomplete library uses general guidance without fabricated nutrition', () => {
  const prompt = dailyAdvicePrompt([], [{ title: 'Без порции', calories: 999 }], {});
  assert.ok(prompt.includes('["Без порции"]'));
  assert.ok(!prompt.includes('999'));
  assert.match(prompt, /общую рекомендацию/);
  assert.ok(!prompt.includes('NaN'));
});
