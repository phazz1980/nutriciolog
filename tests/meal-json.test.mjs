import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../js/core.js', import.meta.url), 'utf8');
const { parseMealJson, MEAL_JSON_PROMPT } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const meal = { title: 'Салат', portion: 250.5, protein: 20, fat: 10, carbs: 30 };

test('JSON and Markdown JSON produce a meal, with calories for the whole portion', () => {
  assert.deepEqual(parseMealJson(JSON.stringify(meal)), { ...meal, calories: 290 });
  assert.equal(parseMealJson('```json\n' + JSON.stringify({ ...meal, calories: 315 }) + '\n```').calories, 315);
  assert.equal(parseMealJson('Что добавить к завтраку?'), null);
  assert.equal(parseMealJson('Салат 250 г'), null);
  assert.ok(MEAL_JSON_PROMPT.includes('не на 100 г'));
});

test('Invalid data cannot silently overwrite nutrition with zero or accept nonnumeric values', () => {
  for (const value of [null, {}, { ...meal, title: '' }, { ...meal, portion: 0 }, { ...meal, protein: '20' }, { ...meal, fat: null }, { ...meal, carbs: -1 }, { ...meal, calories: 10001 }]) {
    if (value === null) continue;
    assert.throws(() => parseMealJson(JSON.stringify(value)));
  }
  assert.throws(() => parseMealJson('{broken'));
  assert.equal(parseMealJson(JSON.stringify({ ...meal, protein: 0 })).protein, 0);
});
