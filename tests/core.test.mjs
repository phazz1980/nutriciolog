// node --test tests/core.test.mjs
// Быстрые проверки чистой логики: календарные ключи и пересчёт БЖУ.
// Часовой пояс фиксируется, иначе проверка даты зависела бы от машины.
process.env.TZ = "Europe/Moscow";

import assert from "node:assert/strict";
import test from "node:test";
import { dateKey, todayKey, tomorrowKey, dateKeyFor, parseDateKey, minutesUntilNextLocalDay } from "../js/date.js";
import { parsePortionDescription, matchingProducts, nutritionTargets, scaleNutrition, safeNumber, formatNumber, firstName, normalizeTitle, mealTypeRank, subtractNutrition } from "../js/core.js";

function withFakeNow(iso, run) {
  const Original = Date;
  class FakeDate extends Original {
    constructor(...args) {
      if (args.length) super(...args);
      else super(iso);
    }
  }
  globalThis.Date = FakeDate;
  try {
    run();
  } finally {
    globalThis.Date = Original;
  }
}

test("dateKey использует локальную дату, а не UTC", () => {
  // 22:30 по Москве — это ещё 3 октября локально и уже 19:30 UTC.
  withFakeNow("2026-10-03T22:30:00+03:00", () => {
    assert.equal(dateKey(), "2026-10-03");
    assert.equal(dateKeyFor("today"), "2026-10-03");
    assert.equal(tomorrowKey(), "2026-10-04");
  });
  // 01:00 по Москве 4 октября — уже 22:00 UTC 3 октября.
  // UTC-дата вернула бы «2026-10-03», то есть вчерашний день.
  withFakeNow("2026-10-04T01:00:00+03:00", () => {
    assert.equal(dateKey(), "2026-10-04", "после местной полуночи должен быть новый день");
    assert.equal(todayKey(), "2026-10-04");
  });
  // Контрольная проверка: именно toISOString давал бы неверный день.
  assert.equal(new Date("2026-10-04T01:00:00+03:00").toISOString().slice(0, 10), "2026-10-03");
});

test("dateKey не использует toISOString", () => {
  const source = String(dateKey);
  assert.equal(source.includes("toISOString"), false);
});

test("parseDateKey читает ключ как локальную полночь", () => {
  const date = parseDateKey("2026-10-03");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 3);
  assert.equal(date.getHours(), 0);
  // Проверка на устойчивость к смещению часового пояса.
  assert.equal(parseDateKey("2026-01-01").getDate(), 1);
});

test("minutesUntilNextLocalDay считает до местной полуночи", () => {
  const beforeMidnight = new Date(2026, 9, 3, 23, 30, 0);
  assert.equal(minutesUntilNextLocalDay(beforeMidnight), 30 * 60 * 1000);
  assert.equal(minutesUntilNextLocalDay(new Date(2026, 9, 3, 0, 0, 0)), 24 * 60 * 60 * 1000);
});

test("цели БЖУ считаются из калорийности", () => {
  assert.deepEqual(nutritionTargets({ calories: 1800 }), { protein: 135, fat: 60, carbs: 180 });
  assert.deepEqual(nutritionTargets({ calories: 0 }), { protein: 0, fat: 0, carbs: 0 });
  assert.deepEqual(nutritionTargets(undefined), { protein: 0, fat: 0, carbs: 0 });
});

test("scaleNutrition пересчитывает БЖУ пропорционально порции", () => {
  const base = { portion: 100, calories: 200, protein: 10, fat: 5, carbs: 20 };
  assert.deepEqual(scaleNutrition(base, 200), { portion: 200, calories: 400, protein: 20, fat: 10, carbs: 40 });
  assert.deepEqual(scaleNutrition(base, 50), { portion: 50, calories: 100, protein: 5, fat: 2.5, carbs: 10 });
  assert.equal(scaleNutrition(base, 0), null);
  assert.equal(scaleNutrition(base, -5), null);
  assert.equal(scaleNutrition({ portion: 0, calories: 100 }, 50), null, "нулевая база не масштабируется");
  assert.equal(scaleNutrition({ portion: 100 }, "abc"), null);
});

test("числовые помощники не превращают мусор в NaN", () => {
  assert.equal(safeNumber("12,5"), 0);
  assert.equal(safeNumber("12.5"), 12.5);
  assert.equal(safeNumber(undefined), 0);
  assert.equal(safeNumber(null), 0);
  assert.equal(firstName("  Анна Петрова "), "Анна");
  assert.equal(firstName(""), "");
  assert.equal(normalizeTitle("  Омлет  "), "омлет");
});

test("порядок приёмов пищи и вычитание БЖУ", () => {
  assert.equal(mealTypeRank("Завтрак"), 0);
  assert.equal(mealTypeRank("Перекус"), 3);
  assert.equal(mealTypeRank("Что-то"), 4);
  const total = { calories: 10, protein: 5, fat: 4, carbs: 3 };
  subtractNutrition(total, { calories: 20, protein: 1, fat: 1, carbs: 1 });
  assert.deepEqual(total, { calories: 0, protein: 4, fat: 3, carbs: 2 }, "сумма не уходит ниже нуля");
});

test("formatNumber форматирует по-русски", () => {
  assert.equal(formatNumber(1234.56).replace(/\u00a0/g, " "), "1 234,6");
  assert.equal(formatNumber(0), "0");
});


test('Порция из названия сохраняет граммы и штуки, не принимает проценты за вес', () => {
  assert.deepEqual(parsePortionDescription('2 яйца'), { title: 'яйца', amount: 2, unit: 'шт.' });
  assert.deepEqual(parsePortionDescription('50гр сыра'), { title: 'сыра', amount: 50, unit: 'г' });
  assert.deepEqual(parsePortionDescription('сыр 0,05 кг'), { title: 'сыр', amount: 50, unit: 'г' });
  assert.equal(parsePortionDescription('сыр 45%').amount, null);
  assert.equal(parsePortionDescription('0 г сыра').amount, null);
  assert.equal(parsePortionDescription('10001 г сыра').amount, null);
  assert.equal(parsePortionDescription('150 мл молока').unit, 'мл');
});
test('Личная база предлагает варианты продукта после удаления количества', () => {
  const products = [{title:'Яйцо варёное'}, {title:'Сыр российский'}, {title:'Сыр творожный'}, {title:'Груша'}];
  assert.deepEqual(matchingProducts(products, '2 яйца'), [products[0]]);
  assert.deepEqual(matchingProducts(products, '50гр сыра'), [products[1],products[2]]);
});
