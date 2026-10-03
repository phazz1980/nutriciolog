export const APP_VERSION = "v0.2.39";
export const RELEASE_DATE = "3 октября 2026";

export const MEAL_TYPES = ["Завтрак", "Обед", "Ужин", "Перекус"];
export const MEAL_ICONS = { Завтрак: "☀️", Обед: "🍽️", Ужин: "🌙", Перекус: "🍏" };

export const DEFAULT_PROFILE = { name: "Анна", age: 27, height: 165, weight: 65.4, targetWeight: 62, goal: "Похудение", calories: 1800 };

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const AI_TIMEOUT_MS = 60_000;

// Доли калорийности: 30% белки, 30% жиры, 40% углеводы.
export const MACRO_SPLIT = { protein: 0.3 / 4, fat: 0.3 / 9, carbs: 0.4 / 4 };

export function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatNumber(value) {
  return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

export function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

export function normalizeTitle(title) {
  return String(title || "").trim().toLocaleLowerCase("ru-RU");
}

export function mealTypeRank(type) {
  const rank = MEAL_TYPES.indexOf(String(type || "").trim());
  return rank < 0 ? MEAL_TYPES.length : rank;
}

export function mealTypeIcon(type) {
  return MEAL_ICONS[type] || "🍽️";
}

export function nutritionTargets(profile) {
  const calories = safeNumber(profile?.calories);
  return {
    protein: Math.round(calories * MACRO_SPLIT.protein),
    fat: Math.round(calories * MACRO_SPLIT.fat),
    carbs: Math.round(calories * MACRO_SPLIT.carbs),
  };
}

// Пересчёт БЖУ с базовой порции на нужную. Без корректной базы масштаб не применяется.
export function scaleNutrition(base, amount) {
  const basePortion = Number(base?.portion);
  const target = Number(amount);
  if (!Number.isFinite(basePortion) || basePortion <= 0) return null;
  if (!Number.isFinite(target) || target <= 0) return null;
  const ratio = target / basePortion;
  const round = value => Number((safeNumber(value) * ratio).toFixed(1));
  return {
    portion: target,
    calories: Math.round(safeNumber(base.calories) * ratio),
    protein: round(base.protein),
    fat: round(base.fat),
    carbs: round(base.carbs),
  };
}

export function emptyNutrition(entry) {
  return {
    calories: safeNumber(entry?.calories),
    protein: safeNumber(entry?.protein),
    fat: safeNumber(entry?.fat),
    carbs: safeNumber(entry?.carbs),
  };
}

export function addNutrition(total, entry) {
  const values = emptyNutrition(entry);
  total.calories += values.calories;
  total.protein += values.protein;
  total.fat += values.fat;
  total.carbs += values.carbs;
  return total;
}

export function subtractNutrition(total, values) {
  total.calories = Math.max(0, total.calories - safeNumber(values.calories));
  total.protein = Math.max(0, total.protein - safeNumber(values.protein));
  total.fat = Math.max(0, total.fat - safeNumber(values.fat));
  total.carbs = Math.max(0, total.carbs - safeNumber(values.carbs));
  return total;
}

// Поля макронутриентов для записи дневника: без числовых примеров в форме,
// поэтому пустые значения означают ноль.
export function macroFields(source) {
  return {
    calories: safeNumber(source?.calories),
    protein: safeNumber(source?.protein),
    fat: safeNumber(source?.fat),
    carbs: safeNumber(source?.carbs),
  };
}
