import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = process.env.MEAL_CLIENT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "js/app.js"), "utf8");
const start = source.indexOf("async function calculateMealNutrition(");
const end = source.indexOf("async function recognizeMealPhoto(", start);
assert.ok(start >= 0 && end > start);

for (const selected of [false, true]) {
  test(`Похожий коктейль не блокирует расчёт молока; выбранная база: ${selected}`, async () => {
    const title = { value: "молоко 3,5" };
    const portion = { value: "200" };
    const notices = [];
    let reachedCalculation = false;
    const context = vm.createContext({
      mealCalculationBusy: false,
      savedMealEstimate: selected ? { title: "молоко 3,5" } : null,
      savedMealProducts: [{ title: "Молочный коктейль" }],
      matchingProducts: () => [{ title: "Молочный коктейль" }],
      applyDescriptionPortion() {}, setAutomaticPortionUnit() {},
      validateMealEstimate: () => true,
      loadMealSuggestions: async () => [],
      renderMealSuggestions() {}, toast: text => notices.push(text),
      element: name => name === "mealName" ? title : portion,
      portionUnit: () => "г",
      // Stop before any network request; verify the actual function passes the old blocking point.
      clearFormNutrition() { reachedCalculation = true; throw new Error("calculation-reached"); },
    });
    vm.runInContext(source.slice(start, end), context);
    await assert.rejects(context.calculateMealNutrition(), /calculation-reached/);
    assert.equal(reachedCalculation, true);
    assert.equal(title.value, "молоко 3,5");
    assert.deepEqual(notices, []);
    assert.equal(context.mealCalculationBusy, false);
  });
}
