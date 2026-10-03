import { safeNumber, MEAL_TYPES } from "./core.js";
import { openDialog, toast } from "./ui.js";

// Ответ ИИ на фото блюда приходит двумя строками:
//   «Название блюда»
//   «Б: 12 г · Ж: 8 г · У: 3 г»
const RECOGNITION_PATTERN = /^([^\r\n]+)\r?\nБ:\s*([\d.,]+)\s*г\s*·\s*Ж:\s*([\d.,]+)\s*г\s*·\s*У:\s*([\d.,]+)\s*г$/;

export function parseMealEstimate(data) {
  const products = Array.isArray(data?.proposedProducts) ? data.proposedProducts : [];
  const product = products.find(item => item?.title && Number.isFinite(Number(item.calories)));
  const estimate = product || data?.proposedMeal;
  if (!estimate?.title || !Number.isFinite(Number(estimate.calories))) return null;
  return estimate;
}

function parseRecognition(text) {
  const match = String(text || "").trim().match(RECOGNITION_PATTERN);
  if (!match) return null;
  const number = value => Number(String(value).replace(",", "."));
  return { title: match[1].trim(), protein: number(match[2]), fat: number(match[3]), carbs: number(match[4]) };
}

// Окно результата распознавания. Когда ответ содержит БЖУ, пользователь вводит
// вес порции и переносит данные в форму; запись всё равно создаётся только
// кнопкой «Сохранить» в форме.
export function showPhotoRecognitionDialog(message, { title = "Результат распознавания", onTransfer } = {}) {
  const parsed = parseRecognition(message);
  const { dialog, close } = openDialog({
    id: "photoRecognitionDialog",
    labelledBy: "photoRecognitionTitle",
    html: '<section class="sheet"><h2 id="photoRecognitionTitle"></h2><p class="hello"></p><div class="photo-add-controls" hidden><label class="field">Вес, г<input type="number" min="1" step="1" value="100" inputmode="numeric"></label><button class="primary" type="button">Перенести в форму</button></div><button class="link" type="button" data-close="true">Закрыть</button></section>',
  });
  dialog.querySelector("h2").textContent = title;
  const messageElement = dialog.querySelector("p");
  messageElement.textContent = message;
  dialog.querySelector("[data-close]").onclick = close;

  if (!parsed) {
    dialog.querySelector("button").focus();
    return { dialog, close, transferred: false };
  }

  const controls = dialog.querySelector(".photo-add-controls");
  const weight = controls.querySelector("input");
  const transfer = controls.querySelector("button");
  controls.hidden = false;

  const values = () => {
    const ratio = Math.max(safeNumber(weight.value), 0) / 100;
    return {
      protein: Number((parsed.protein * ratio).toFixed(1)),
      fat: Number((parsed.fat * ratio).toFixed(1)),
      carbs: Number((parsed.carbs * ratio).toFixed(1)),
    };
  };
  const render = () => {
    const value = values();
    messageElement.textContent = `${parsed.title}\nБ: ${value.protein} г · Ж: ${value.fat} г · У: ${value.carbs} г`;
  };
  weight.oninput = render;
  render();

  transfer.onclick = () => {
    const amount = safeNumber(weight.value);
    if (amount <= 0) {
      weight.focus();
      return;
    }
    const value = values();
    const estimate = {
      ...value,
      title: parsed.title,
      portion: amount,
      calories: Math.round(value.protein * 4 + value.fat * 9 + value.carbs * 4),
    };
    onTransfer?.(estimate);
    close();
  };
  transfer.focus();
  return { dialog, close, transferred: true };
}

// Перенос распознанного блюда в стандартную форму добавления.
export function fillMealForm(estimate) {
  const name = document.getElementById("mealName");
  const portion = document.getElementById("portion");
  if (!name || !portion) return;
  const mealType = document.getElementById("mealType");
  if (mealType && MEAL_TYPES.includes(estimate.mealType)) mealType.value = estimate.mealType;
  name.value = String(estimate.title || "").trim();
  const amount = Math.round(safeNumber(estimate.portion));
  portion.value = amount > 0 ? String(amount) : "";
  const unit = document.getElementById("portionUnit");
  if (unit) unit.value = "г";
  setFormNutrition(estimate);
}

export function setFormNutrition(estimate) {
  const set = (id, value) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  };
  set("calories", Math.round(safeNumber(estimate.calories)));
  set("protein", Number(safeNumber(estimate.protein).toFixed(1)));
  set("fat", Number(safeNumber(estimate.fat).toFixed(1)));
  set("carbs", Number(safeNumber(estimate.carbs).toFixed(1)));
}

export function clearFormNutrition() {
  for (const id of ["calories", "protein", "fat", "carbs"]) {
    const input = document.getElementById(id);
    if (input) input.value = "";
  }
}

export function readFormNutrition() {
  return {
    calories: safeNumber(document.getElementById("calories")?.value),
    protein: safeNumber(document.getElementById("protein")?.value),
    fat: safeNumber(document.getElementById("fat")?.value),
    carbs: safeNumber(document.getElementById("carbs")?.value),
  };
}

export function toastPhotoTransfer() {
  toast("Результат фото перенесён в форму — проверьте и нажмите «Сохранить»");
}
