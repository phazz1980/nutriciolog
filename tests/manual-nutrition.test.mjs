import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { safeNumber } from "../js/core.js";

const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const photo = readFileSync(new URL("../js/photo.js", import.meta.url), "utf8");
function draft({ per100 = false, portion = "250", protein = "", fat = "4", carbs = "" } = {}) {
  const fields = Object.fromEntries(Object.entries({ mealName: "Гречка", portion, calories: "160", protein, fat, carbs, mealDate: "today", mealType: "Обед", portionUnit: "г" }).map(([id, value]) => [id, { value, focus() {} }]));
  fields.nutritionBasis100 = { checked: per100 };
  fields.nutritionBasisPortion = { checked: !per100 };
  const writes = [];
  const context = vm.createContext({
    window: {}, diaryLoadVersion: 0, optimisticDiaryEntries: new Map(),
    document: { getElementById: id => fields[id] }, element: id => fields[id], safeNumber,
    portionUnit: () => fields.portionUnit.value, normalizeTitle: title => title.toLowerCase(),
    dateKeyFor: () => "2026-10-12", todayKey: () => "2026-10-12", selectedDiaryDate: "2026-10-12",
    lastCalculatedUnitWeight: null, lastNutritionClarification: null, savedMealEstimate: null,
    recognizedManualMealEstimate: null, savedMealProducts: [], crypto: { randomUUID: () => "draft-test" },
    importMealJson: () => false, applyDescriptionPortion() {}, setAutomaticPortionUnit() {},
    addDiaryEntryToView() {}, persist: (name, value) => { writes.push({ name, value }); },
    renderMealSuggestions() {}, closeMeal() {}, showScreen() {}, renderDiaryForDate() {}, toast() {},
  });
  vm.runInContext(photo.slice(photo.indexOf("export function setFormNutrition"), photo.indexOf("export function toastPhotoTransfer")).replace(/export /g, ""), context);
  vm.runInContext(app.slice(app.indexOf("function buildMealEntry()"), app.indexOf("/* --------------------------------------------------- personal product base */")), context);
  return { context, fields, writes };
}

test("на 100 г: дневник и личная база получают итог порции, только после сохранения", () => {
  const { context, fields, writes } = draft({ per100: true });
  assert.equal(writes.length, 0);
  fields.portion.value = "300";
  context.saveMeal({ preventDefault() {}, target: { reset() {} } });
  assert.deepEqual(writes.map(write => [write.name, write.value.calories, write.value.fat]), [["saveDiaryEntry", 480, 12], ["saveProduct", 480, 12]]);
  assert.equal(writes[0].value.portion, 300);
  assert.equal(fields.calories.value, "160");
  assert.equal(fields.protein.value, "");
});

test("на всё блюдо: калории не масштабируются; пустые БЖУ допустимы", () => {
  const { context, writes } = draft({ fat: "" });
  context.saveMeal({ preventDefault() {}, target: { reset() {} } });
  assert.equal(writes[0].value.calories, 160);
  assert.equal(writes[0].value.protein, 0);
  assert.equal(writes[0].value.fat, 0);
  assert.equal(writes[0].value.carbs, 0);
});

test("значения на 100 г нельзя сохранить с порцией в штуках", () => {
  const { context, fields, writes } = draft({ per100: true });
  fields.portionUnit.value = "шт.";
  context.saveMeal({ preventDefault() {}, target: { reset() {} } });
  assert.equal(writes.length, 0);
});

test("заполнение из ИИ переключает форму на всю порцию", () => {
  const { context, fields } = draft({ per100: true });
  context.setFormNutrition({ calories: 400, protein: 25, fat: 10, carbs: 40 });
  assert.equal(fields.nutritionBasisPortion.checked, true);
  assert.equal(fields.calories.value, 400);
});
