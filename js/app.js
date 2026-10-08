import { parsePortionDescription, matchingProducts, APP_VERSION, RELEASE_DATE, DEFAULT_PROFILE, MEAL_TYPES, MAX_PHOTO_BYTES, safeNumber, formatNumber, firstName, normalizeTitle, mealTypeRank, mealTypeIcon, nutritionTargets, scaleNutrition, addNutrition, subtractNutrition, macroFields } from "./core.js";
import { todayKey, dateKeyFor, diaryTitleForDate, formatDayTitle, formatShortDate, minutesUntilNextLocalDay } from "./date.js";
import { hasStore, has, call, loadProfile as loadStoredProfile, accountDefaults, cachedProfilePreview, onAuthChanged, onStoreReady, onProfileUpdated } from "./storage.js";
import { toast, setText, showScreen, openModal, closeModal, openDialog, showAiDiagnostic, removeAiDiagnostic, setAiDebug, clearAiDebug, showCalculationResult } from "./ui.js";
import { askAi, getAiToken, requestAiAdvice, clearErrors, clearServiceError, availability } from "./ai-client.js";
import { initAiAvailability } from "./ai-availability.js";
import { initDailyAdvice } from "./daily-advice.js";
import { initAiQuota } from "./ai-quota.js";
import { createMealTimeline } from "./timeline.js";
import { preparePhoto, openPhotoPicker } from "./photo-picker.js";
import { showPhotoRecognitionDialog, parseMealEstimate, fillMealForm, setFormNutrition, clearFormNutrition, readFormNutrition, toastPhotoTransfer } from "./photo.js";

/* ------------------------------------------------------------------ state */

const todayNutrition = { calories: 0, protein: 0, fat: 0, carbs: 0 };
const planMeals = { Завтрак: [{ name: "Омлет с овощами", calories: 310 }], Обед: [{ name: "Боул с курицей", calories: 520 }], Ужин: [], Перекус: [{ name: "Яблоко и йогурт", calories: 170 }] };

let currentProfile = { ...DEFAULT_PROFILE };
let currentAccount = {};
let profileNameReady = false;
let profileLoadVersion = 0;
let profileNameFallbackTimer;

let selectedDiaryDate = todayKey();
let diaryLoadVersion = 0;

let water = 0;
let waterLogDate = todayKey();
let waterTimer = null;

let weightHistory = [];

let selectedPhoto = null;
let editingPlan = null;
let lastSelectedMealType = "";
let lastCalculatedUnitWeight = null;
let lastNutritionClarification = null;
let recognizedManualMealEstimate = null;
let savedMealEstimate = null;
let describedPortion = null;
let mealCalculationBusy = false;
let savedMealProducts = [];
let savedMealProductsUid = "";
let savedMealProductsLoading = null;
let skipMealSuggestionsOnFocus = false;
let voiceOn = false;

const element = id => document.getElementById(id);

/* ------------------------------------------------------- today and macros */

function renderNutrition() {
  const calories = safeNumber(currentProfile?.calories);
  const targets = nutritionTargets(currentProfile);
  setText("greeting", greetingText());
  setText("todayTitle", `Сегодня, ${formatDayTitle(todayKey())}`);
  setText("eaten", formatNumber(todayNutrition.calories));
  setText("calorieGoal", formatNumber(calories));
  setText("remain", `${formatNumber(Math.max(0, calories - todayNutrition.calories))} ккал`);
  setText("goalPercent", `${Math.round(Math.min(100, calories ? todayNutrition.calories / calories * 100 : 0))}%`);
  renderMacro("protein", todayNutrition.protein, targets.protein);
  renderMacro("fat", todayNutrition.fat, targets.fat);
  renderMacro("carbs", todayNutrition.carbs, targets.carbs);
  renderTodayAvatar();
}

function renderMacro(name, total, target) {
  setText(`${name}Total`, `${formatNumber(total)} / ${formatNumber(target)} г`);
  const bar = element(`${name}Bar`);
  if (bar) bar.style.width = `${Math.min(100, target ? total / target * 100 : 0)}%`;
  // Белки вне коридора 80–115% цели подсвечиваются оранжевым.
  if (name !== "protein") return;
  const ratio = target ? total / target : 0;
  element("proteinBarRow")?.classList.toggle("orange", ratio < 0.8 || ratio > 1.15);
}

function greetingText() {
  const hour = new Date().getHours();
  const salutation = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : hour < 23 ? "Добрый вечер" : "Доброй ночи";
  const name = profileNameReady ? firstName(currentProfile?.name) : "";
  return `${salutation}${name ? `, ${name}` : ""}`;
}

function renderTodayAvatar() {
  const avatar = element("todayAvatar");
  if (!avatar) return;
  avatar.replaceChildren();
  if (currentAccount.photoUrl) {
    const photo = document.createElement("img");
    photo.src = currentAccount.photoUrl;
    photo.alt = "Фото профиля";
    photo.referrerPolicy = "no-referrer";
    photo.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
    avatar.append(photo);
  } else {
    avatar.textContent = "🌿";
  }
}

/* ------------------------------------------------------------- diary view */

function createMealGroup(type) {
  const card = document.createElement("details");
  card.className = "card meal-group";
  card.dataset.mealType = type;
  card.open = true;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "meal-group-title";
  title.textContent = `${mealTypeIcon(type)} ${type}`;
  const total = document.createElement("b");
  total.className = "meal-group-total";
  total.textContent = "0 ккал";
  summary.append(title, total);
  const body = document.createElement("div");
  body.className = "meal-group-body";
  card.append(summary, body);
  return card;
}

function updateMealGroupSummary(card) {
  if (!card) return;
  const total = [...card.querySelectorAll(".entry")].reduce((sum, row) => sum + safeNumber(row.dataset.calories), 0);
  const totalElement = card.querySelector(".meal-group-total");
  if (totalElement) totalElement.textContent = `${formatNumber(total)} ккал`;
}

// Данные записи хранятся в dataset, поэтому удаление больше не разбирает текст строки.
function createDiaryEntryRow(entry, { deletable = false } = {}) {
  const item = document.createElement("div");
  item.className = "entry";
  item.dataset.entryId = entry.id || "";
  item.dataset.calories = String(safeNumber(entry.calories));
  item.dataset.protein = String(safeNumber(entry.protein));
  item.dataset.fat = String(safeNumber(entry.fat));
  item.dataset.carbs = String(safeNumber(entry.carbs));
  if (deletable) item.style.cssText = "position:relative;padding-right:36px";

  const description = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = entry.title;
  const details = document.createElement("small");
  details.textContent = `${entry.portion || "—"} ${entry.portionUnit || "г"} · Б ${formatNumber(safeNumber(entry.protein))} · Ж ${formatNumber(safeNumber(entry.fat))} · У ${formatNumber(safeNumber(entry.carbs))}`;
  const calories = document.createElement("b");
  calories.textContent = `${formatNumber(safeNumber(entry.calories))} ккал`;
  description.append(title, details);
  item.append(description, calories);

  if (deletable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link";
    remove.dataset.deleteDiaryEntry = entry.id || "";
    remove.textContent = "×";
    remove.title = `Удалить ${entry.title}`;
    remove.setAttribute("aria-label", `Удалить ${entry.title}`);
    remove.style.cssText = "position:absolute;right:0;top:8px;margin:0;padding:0 4px;color:#b44747;font-size:22px;line-height:1;font-weight:700";
    remove.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      window.deleteDiaryEntry(entry.id, item);
    };
    item.append(remove);
  }
  return item;
}

function appendEntriesByMeal(list, entries, options = {}) {
  const groups = new Map();
  for (const entry of entries) {
    const type = entry.mealType || "Перекус";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(entry);
  }
  for (const type of MEAL_TYPES) {
    const items = groups.get(type);
    if (!items?.length) continue;
    const card = createMealGroup(type);
    const body = card.querySelector(".meal-group-body");
    for (const entry of items) body.append(createDiaryEntryRow(entry, options));
    updateMealGroupSummary(card);
    list.append(card);
  }
}

function emptyDiaryCard() {
  const message = document.createElement("section");
  message.className = "card";
  const text = document.createElement("p");
  text.className = "hello";
  text.textContent = "Записей пока нет. Добавьте первый продукт или блюдо.";
  message.append(text);
  return message;
}

function clearDiaryView() {
  const list = element("mealList");
  list.replaceChildren(emptyDiaryCard());
}

async function loadDiary() {
  if (!has("loadDiaryEntries")) return;
  const version = ++diaryLoadVersion;
  todayNutrition.calories = 0;
  todayNutrition.protein = 0;
  todayNutrition.fat = 0;
  todayNutrition.carbs = 0;
  clearDiaryView();
  renderNutrition();
  try {
    const entries = await call("loadDiaryEntries", todayKey());
    if (version !== diaryLoadVersion) return;
    const sorted = [...(entries || [])].sort((left, right) => mealTypeRank(left.mealType) - mealTypeRank(right.mealType));
    for (const entry of sorted) addNutrition(todayNutrition, entry);
    renderNutrition();
    if (!sorted.length) return;
    element("mealList").replaceChildren();
    appendEntriesByMeal(element("mealList"), sorted, { deletable: true });
  } catch {
    if (version === diaryLoadVersion) toast("Не удалось загрузить дневник. Попробуйте обновить страницу.");
  }
}

// Добавление записи в уже отрисованный дневник без полной перезагрузки.
function addDiaryEntryToView(entry) {
  if (!entry || entry.date !== todayKey()) return;
  entry.id ||= crypto.randomUUID();
  addNutrition(todayNutrition, entry);
  renderNutrition();
  element("mealList").querySelector(".hello")?.closest(".card")?.remove();
  const type = entry.mealType || "Перекус";
  let card = element("mealList").querySelector(`[data-meal-type="${CSS.escape(type)}"]`);
  if (!card) {
    card = createMealGroup(type);
    const rank = mealTypeRank(type);
    const next = [...element("mealList").querySelectorAll("[data-meal-type]")].find(existing => mealTypeRank(existing.dataset.mealType) > rank);
    element("mealList").insertBefore(card, next || null);
  }
  card.querySelector(".meal-group-body").append(createDiaryEntryRow(entry, { deletable: true }));
  updateMealGroupSummary(card);
}

async function deleteDiaryEntry(id, item) {
  const row = item || element("mealList").querySelector(`[data-entry-id="${CSS.escape(String(id))}"]`);
  if (!row) {
    toast("Не удалось определить запись для удаления");
    return;
  }
  const values = { calories: row.dataset.calories, protein: row.dataset.protein, fat: row.dataset.fat, carbs: row.dataset.carbs };
  const card = row.closest("[data-meal-type]");
  row.remove();
  if (card && !card.querySelector(".entry")) card.remove();
  else updateMealGroupSummary(card);
  // Без этого дневник оставался полностью пустым после удаления последней записи.
  if (!element("mealList").querySelector(".entry")) element("mealList").replaceChildren(emptyDiaryCard());
  subtractNutrition(todayNutrition, values);
  renderNutrition();
  try {
    await call("deleteDiaryEntry", id);
    toast("Запись удалена из дневника");
  } catch {
    await loadDiary();
    toast("Не удалось сохранить удаление. Попробуйте ещё раз.");
  }
}

async function renderDiaryForDate(date) {
  selectedDiaryDate = date;
  setText("diaryTitle", diaryTitleForDate(date));
  const calendar = element("diaryCalendar");
  if (calendar) calendar.value = date;
  if (date === todayKey()) {
    await loadDiary();
    return;
  }
  const list = element("mealList");
  list.replaceChildren();
  const hint = document.createElement("p");
  hint.className = "hello";
  hint.textContent = "Просмотр сохранённого рациона";
  list.append(hint);
  try {
    const entries = await call("loadDiaryEntries", date) || [];
    if (!entries.length) {
      const empty = document.createElement("section");
      empty.className = "card";
      empty.textContent = "За этот день записей нет.";
      list.append(empty);
      return;
    }
    const total = entries.reduce((sum, entry) => sum + safeNumber(entry.calories), 0);
    const summary = document.createElement("p");
    summary.className = "hello";
    summary.textContent = `Всего: ${formatNumber(total)} ккал`;
    list.append(summary);
    appendEntriesByMeal(list, entries);
  } catch {
    toast("Не удалось загрузить рацион. Попробуйте ещё раз.");
  }
}

/* ------------------------------------------------------------ water, plan */

function renderWater() {
  const drops = element("drops");
  if (!drops) return;
  drops.replaceChildren();
  for (let index = 0; index < 8; index++) {
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = `drop${index < water ? " full" : ""}`;
    drop.textContent = "💧";
    drop.setAttribute("aria-label", `Отметить ${index + 1} стаканов воды`);
    drop.onclick = () => toggleWater(index);
    drops.append(drop);
  }
  setText("waterText", `${water} из 8 стаканов`);
}

function ensureWaterDate() {
  const date = todayKey();
  if (waterLogDate === date) return;
  waterLogDate = date;
  water = 0;
  renderWater();
}

function saveWaterLog() {
  persist("saveWaterLog", { date: waterLogDate, glasses: water });
}

async function loadWater() {
  const date = todayKey();
  waterLogDate = date;
  try {
    const saved = await call("loadWaterLog", date);
    if (waterLogDate !== date || todayKey() !== date) return;
    water = Math.max(0, Math.min(8, Math.round(Number(saved?.glasses) || 0)));
    renderWater();
  } catch {
    if (waterLogDate === date) {
      water = 0;
      renderWater();
    }
  }
}

function addWater() {
  ensureWaterDate();
  if (water < 8) water++;
  renderWater();
  saveWaterLog();
  toast("Стакан воды добавлен");
}

function toggleWater(index) {
  ensureWaterDate();
  water = index + 1;
  renderWater();
  saveWaterLog();
}

function renderPlan() {
  const list = element("planList");
  if (!list) return;
  list.replaceChildren();
  let total = 0;
  for (const [type, items] of Object.entries(planMeals)) {
    const sum = items.reduce((value, item) => value + safeNumber(item.calories), 0);
    total += sum;
    const card = document.createElement("section");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "section-head";
    head.style.margin = "0 0 8px";
    const heading = document.createElement("h2");
    heading.textContent = `${mealTypeIcon(type)} ${type}`;
    const sumElement = document.createElement("b");
    sumElement.textContent = `${formatNumber(sum)} ккал`;
    head.append(heading, sumElement);
    card.append(head);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "hello";
      empty.textContent = "Ничего не запланировано";
      card.append(empty);
    }
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "entry";
      button.style.cssText = "width:100%;background:none;text-align:left";
      const label = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = item.name;
      const hint = document.createElement("small");
      hint.textContent = "Нажмите, чтобы изменить";
      label.append(name, hint);
      const calories = document.createElement("b");
      calories.textContent = `${formatNumber(item.calories)} ккал`;
      button.append(label, calories);
      button.onclick = () => openPlanItem(type, index);
      card.append(button);
    });
    list.append(card);
  }
  const goal = safeNumber(currentProfile?.calories);
  const remaining = goal - total;
  setText("plannedTotal", formatNumber(total));
  setText("plannedRemaining", `${remaining >= 0 ? "" : "+"}${formatNumber(Math.abs(remaining))} ккал`);
  setText("planPercent", `${Math.round(Math.max(0, total / (goal || 1) * 100))}%`);
}

function openPlanItem(type, index) {
  editingPlan = typeof index === "number" ? { type, index } : null;
  setText("planFormTitle", editingPlan ? "Изменить блюдо" : "Запланировать блюдо");
  element("planType").value = editingPlan ? type : "Завтрак";
  element("planName").value = editingPlan ? planMeals[type][index].name : "";
  element("planCalories").value = editingPlan ? planMeals[type][index].calories : "";
  let remove = element("deletePlanItemButton");
  if (!remove) {
    remove = document.createElement("button");
    remove.id = "deletePlanItemButton";
    remove.type = "button";
    remove.className = "link";
    remove.style.cssText = "display:none;margin:14px auto 0;color:#b44747";
    remove.textContent = "Удалить блюдо";
    remove.onclick = deletePlanItem;
    element("planCancelButton")?.before(remove);
  }
  remove.style.display = editingPlan ? "block" : "none";
  openModal("planModal");
}

function closePlanItem() {
  closeModal("planModal");
}

function savePlanItem(event) {
  event.preventDefault();
  const type = element("planType").value;
  const item = { name: element("planName").value.trim(), calories: safeNumber(element("planCalories").value) };
  if (editingPlan) {
    planMeals[editingPlan.type].splice(editingPlan.index, 1);
    planMeals[type].push(item);
  } else {
    planMeals[type].push(item);
  }
  closePlanItem();
  renderPlan();
  persist("saveDayPlan", { date: todayKey(), meals: structuredClone(planMeals) });
  toast("План обновлён");
}

function deletePlanItem() {
  if (!editingPlan) return;
  planMeals[editingPlan.type].splice(editingPlan.index, 1);
  closePlanItem();
  renderPlan();
  persist("saveDayPlan", { date: todayKey(), meals: structuredClone(planMeals) });
  toast("Блюдо удалено из плана");
}

/* --------------------------------------------------------------- profile */

function renderProfile() {
  setText("profileName", profileNameReady ? currentProfile.name : "Загружаем профиль…");
  const avatar = element("profileAvatar");
  if (avatar) {
    avatar.replaceChildren();
    if (currentAccount.photoUrl) {
      const photo = document.createElement("img");
      photo.src = currentAccount.photoUrl;
      photo.alt = "Фото профиля";
      photo.referrerPolicy = "no-referrer";
      photo.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
      avatar.append(photo);
    } else {
      avatar.textContent = "🌿";
    }
  }
  setText("profileSummary", ` · ${currentProfile.age} лет · ${formatNumber(currentProfile.height)} см · ${formatNumber(currentProfile.weight)} кг`);
  setText("profileGoal", currentProfile.goal);
  setText("profileRate", `Цель: ${formatNumber(currentProfile.targetWeight)} кг`);
  setText("profileCalories", `${formatNumber(currentProfile.calories)} ккал`);
  setText("releaseInfo", `Версия ${APP_VERSION} · ${RELEASE_DATE}`);
  renderNutrition();
  renderPlan();
}

function shouldUseAccountName(saved, account) {
  return Boolean(firstName(account.name)) && (!saved || !saved.name || saved.name === DEFAULT_PROFILE.name);
}

function applyProfile(saved, account) {
  currentAccount = account || {};
  currentProfile = { ...DEFAULT_PROFILE, ...(saved || {}) };
  if (shouldUseAccountName(saved, account)) currentProfile.name = firstName(account.name);
  profileNameReady = Boolean(firstName(account?.name)) || Boolean(saved?.name && saved.name !== DEFAULT_PROFILE.name);
  if (profileNameReady) window.clearTimeout(profileNameFallbackTimer);
  renderProfile();
}

async function loadCurrentProfile() {
  if (!hasStore()) return;
  const version = ++profileLoadVersion;
  let saved = null;
  try {
    saved = await loadStoredProfile();
  } catch { /* Оставляем ранее показанный профиль. */ }
  if (version !== profileLoadVersion) return;
  applyProfile(saved, accountDefaults());
}

function refreshProfileFromAccount() {
  if (!hasStore()) return;
  const account = accountDefaults();
  if (account.uid !== currentAccount.uid) {
    profileLoadVersion++;
    // Показываем данные аккаунта сразу, не дожидаясь Firestore.
    applyProfile(null, account);
  }
  loadCurrentProfile();
}

function openProfileEditor() {
  const account = accountDefaults();
  if (firstName(account.name) && currentProfile.name === DEFAULT_PROFILE.name) {
    currentProfile.name = firstName(account.name);
    currentAccount = account;
    renderProfile();
  }
  element("profileNameInput").value = currentProfile.name;
  element("profileAgeInput").value = currentProfile.age;
  element("profileHeightInput").value = currentProfile.height;
  element("profileWeightInput").value = currentProfile.weight;
  element("profileTargetWeightInput").value = currentProfile.targetWeight;
  element("profileGoalInput").value = currentProfile.goal;
  element("profileCaloriesInput").value = currentProfile.calories;
  openModal("profileModal");
}

function closeProfileEditor() {
  closeModal("profileModal");
}

async function saveProfile(event) {
  event.preventDefault();
  const profile = {
    name: element("profileNameInput").value.trim(),
    age: Number(element("profileAgeInput").value),
    height: Number(element("profileHeightInput").value),
    weight: Number(element("profileWeightInput").value),
    targetWeight: Number(element("profileTargetWeightInput").value),
    goal: element("profileGoalInput").value,
    calories: Number(element("profileCaloriesInput").value),
  };
  if (!profile.name || !Object.values(profile).every(value => typeof value !== "number" || Number.isFinite(value))) {
    toast("Проверьте заполнение профиля");
    return;
  }
  if (!hasStore()) {
    toast("Хранилище ещё загружается");
    return;
  }
  const previousProfile = currentProfile;
  const accountUid = currentAccount.uid;
  profileLoadVersion++;
  currentProfile = profile;
  renderProfile();
  closeProfileEditor();
  toast("Профиль сохранён");
  try {
    await call("saveProfile", profile);
  } catch {
    if (currentAccount.uid === accountUid) {
      currentProfile = previousProfile;
      renderProfile();
    }
    toast("Не удалось синхронизировать профиль. Попробуйте ещё раз.");
  }
}

/* ---------------------------------------------------------------- weight */

function renderWeightProgress() {
  const chart = element("weightChart");
  const change = element("weightChange");
  const summary = element("weightSummary");
  const percent = element("weightPercent");
  if (!chart) return;
  const entries = [...weightHistory]
    .filter(entry => entry.date && Number.isFinite(Number(entry.weight)))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const target = Number(currentProfile?.targetWeight);
  setText("weightGoalText", Number.isFinite(target) && target > 0 ? `Цель: ${formatNumber(target)} кг` : "Цель: не указана");
  chart.replaceChildren();
  if (!entries.length) {
    change.textContent = "Нет данных";
    summary.textContent = "Добавьте первую запись веса";
    percent.textContent = "—";
    const hint = document.createElement("p");
    hint.className = "hello";
    hint.textContent = "Нет записей за последние 30 дней.";
    chart.append(hint);
    return;
  }
  const since = new Date();
  since.setDate(since.getDate() - 29);
  const recent = entries.filter(entry => new Date(`${entry.date}T00:00:00`) >= since).slice(-7);
  const monthEntries = entries.filter(entry => new Date(`${entry.date}T00:00:00`) >= since);
  const first = monthEntries[0] || entries.at(-1);
  const last = monthEntries.at(-1) || entries.at(-1);
  const delta = Number(last.weight) - Number(first.weight);
  change.textContent = monthEntries.length > 1 ? `${delta > 0 ? "+" : ""}${formatNumber(delta)} кг` : `${formatNumber(last.weight)} кг`;
  summary.textContent = monthEntries.length > 1
    ? `Старт: ${formatNumber(first.weight)} кг · Сейчас: ${formatNumber(last.weight)} кг`
    : `Текущий вес: ${formatNumber(last.weight)} кг`;
  percent.textContent = monthEntries.length > 1 && Number(first.weight)
    ? `${delta > 0 ? "+" : ""}${formatNumber(delta / Number(first.weight) * 100)}%`
    : "—";
  const values = recent.map(entry => Number(entry.weight));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  for (const entry of recent) {
    const bar = document.createElement("i");
    bar.dataset.day = formatShortDate(entry.date);
    bar.dataset.weight = formatNumber(entry.weight);
    bar.style.height = `${values.length === 1 ? 55 : 25 + (Number(entry.weight) - min) / range * 65}%`;
    bar.title = `${formatShortDate(entry.date)}: ${formatNumber(entry.weight)} кг`;
    chart.append(bar);
  }
}

async function loadWeightProgress() {
  if (!has("loadWeightEntries")) return;
  try {
    weightHistory = await call("loadWeightEntries") || [];
    renderWeightProgress();
  } catch {
    weightHistory = [];
    renderWeightProgress();
    toast("Не удалось загрузить прогресс веса.");
  }
}

function addWeight() {
  const { dialog, close } = openDialog({
    html: '<form class="sheet"><h2>Записать вес</h2><label class="field">Дата<input type="date" required></label><label class="field">Вес, кг<input type="number" min="20" max="500" step="0.1" required></label><button class="primary">Сохранить</button><button class="link" type="button" data-close="true" style="display:block;margin:14px auto 0">Отмена</button></form>',
  });
  const form = dialog.querySelector("form");
  const [dateInput, weightInput] = form.querySelectorAll("input");
  dateInput.value = todayKey();
  const latestEntry = [...weightHistory]
    .filter(entry => entry?.date && Number.isFinite(Number(entry.weight)))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .at(-1);
  weightInput.value = Number(latestEntry?.weight ?? currentProfile?.weight) || "";
  dialog.querySelector("[data-close]").onclick = close;
  form.onsubmit = async event => {
    event.preventDefault();
    const weight = Number(weightInput.value);
    if (!Number.isFinite(weight) || weight < 20 || weight > 500) {
      weightInput.focus();
      return;
    }
    const entry = { date: dateInput.value, weight };
    try {
      await call("saveWeightEntry", entry);
      weightHistory = weightHistory.filter(item => item.date !== entry.date).concat(entry);
      if (entry.date === todayKey()) {
        currentProfile = { ...currentProfile, weight };
        renderProfile();
      }
      renderWeightProgress();
      close();
      toast("Вес сохранён");
    } catch {
      toast("Не удалось сохранить вес. Попробуйте ещё раз.");
    }
  };
  weightInput.focus();
}

/* ------------------------------------------------------- meal form fields */

const countableFoodPattern = /яйцо|яиц|яйц|яблок|груш|банан|мандарин|апельсин|персик|слив|котлет|сырник|конфет|печень|кусоч|ломтик|булоч|пирож|йогурт|батончик/i;

// Штуки предлагаем только для счётных продуктов и небольших целых количеств.
function resolvePortionUnit(title, amount) {
  return Number.isInteger(amount) && amount > 0 && amount < 10 && countableFoodPattern.test(title) ? "шт." : "г";
}

function portionUnit() {
  return element("portionUnit")?.value || "г";
}

function setPortionUnit(value) {
  const input = element("portionUnit");
  if (input) input.value = value;
}

function setAutomaticPortionUnit() {
  if (describedPortion?.title === normalizeTitle(element("mealName").value) && describedPortion.amount === Number(element("portion").value)) { setPortionUnit(describedPortion.unit); return; }
  const described = parsePortionDescription(element("mealName").value);
  if (described.amount === Number(element("portion").value)) { setPortionUnit(described.unit); return; }
  setPortionUnit(resolvePortionUnit(element("mealName").value.trim(), Number(element("portion").value)));
}

function openMeal() {
  openModal("modal");
  if (lastSelectedMealType) element("mealType").value = lastSelectedMealType;
}

function closeMeal() {
  closeModal("modal");
}

function clearMealEstimateError(input) {
  element(`${input.id}Error`)?.remove();
  input.setCustomValidity("");
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  if (input.id === "mealName") input.placeholder = "Например, салат с курицей";
}

function validateMealEstimate() {
  const name = element("mealName");
  const portion = element("portion");
  [name, portion].forEach(clearMealEstimateError);
  const amount = Number(portion.value);
  const input = !name.value.trim() ? name : (portion.value.trim() && (!Number.isFinite(amount) || amount <= 0) ? portion : null);
  if (!input) return true;
  const message = input === name
    ? "Введите название блюда."
    : "Укажите порцию: вес в граммах или количество штук, больше нуля.";
  if (input === name) {
    const error = document.createElement("span");
    error.id = `${input.id}Error`;
    error.className = "field-error sr-only";
    error.setAttribute("role", "alert");
    error.textContent = message;
    input.placeholder = message;
    input.after(error);
    input.setAttribute("aria-describedby", error.id);
  } else {
    input.setCustomValidity(message);
    input.reportValidity();
  }
  input.setAttribute("aria-invalid", "true");
  input.focus();
  input.scrollIntoView({ block: "nearest" });
  return false;
}

function buildMealEntry() {
  const unit = portionUnit();
  const title = element("mealName").value.trim();
  const amount = safeNumber(element("portion").value);
  const unitWeight = unit === "шт." && lastCalculatedUnitWeight?.title === normalizeTitle(title)
    ? lastCalculatedUnitWeight.weight
    : null;
  return {
    date: dateKeyFor(element("mealDate").value),
    mealType: element("mealType").value,
    title,
    portion: amount,
    portionUnit: unit,
    unitWeight,
    ...readFormNutrition(),
    source: "manual",
  };
}

// Форма добавления блюда: запись появляется в дневнике только после «Сохранить».
function saveMeal(event) {
  event.preventDefault();
  applyDescriptionPortion();
  if (!Number(element("portion").value)) { toast("Укажите количество в названии или рассчитайте порцию с ИИ"); element("portion").focus(); return; }
  setAutomaticPortionUnit();
  const entry = buildMealEntry();
  const stored = { ...entry, id: crypto.randomUUID() };
  const isTomorrow = entry.date === dateKeyFor("tomorrow");
  addDiaryEntryToView(stored);
  persist("saveDiaryEntry", stored);
  const clarification = lastNutritionClarification;
  const hasClarification = clarification?.title === normalizeTitle(entry.title);
  persist("saveProduct", {
    title: entry.title,
    portion: entry.portion,
    unitWeight: entry.unitWeight,
    calories: entry.calories,
    protein: entry.protein,
    fat: entry.fat,
    carbs: entry.carbs,
    ...(hasClarification ? { aiClarification: { question: clarification.question, additionalIngredients: clarification.additionalIngredients } } : {}),
  });
  closeMeal();
  event.target.reset();
  lastCalculatedUnitWeight = null;
  lastNutritionClarification = null;
  savedMealEstimate = null;
  recognizedManualMealEstimate = null;
  showScreen("diary");
  renderDiaryForDate(entry.date === todayKey() ? todayKey() : selectedDiaryDate);
  toast(`Блюдо добавлено на ${isTomorrow ? "завтра" : "сегодня"}`);
}

/* --------------------------------------------------- personal product base */

const suggestions = () => element("mealNameSuggestions");

function renderMealSuggestions(products) {
  const container = suggestions();
  const input = element("mealName");
  if (!container) return;
  container.replaceChildren();
  const query = normalizeTitle(parsePortionDescription(input?.value).title);
  const unique = [...new Map(products.map(product => [normalizeTitle(product.title), product])).values()];
  const matches = unique
    .filter(product => !query || matchingProducts([product], input?.value).length)
    .sort((left, right) => left.title.localeCompare(right.title, "ru"))
    .slice(0, 30);
  for (const product of matches) {
    const row = document.createElement("div");
    row.className = "meal-suggestion-row";
    const option = document.createElement("button");
    option.type = "button";
    option.className = "meal-suggestion";
    option.setAttribute("role", "option");
    option.textContent = product.title.trim();
    option.onmousedown = event => event.preventDefault();
    option.onclick = () => {
      applyDescriptionPortion();
      const chosenUnit = portionUnit();
      input.value = product.title.trim();
      if (describedPortion) describedPortion.title = normalizeTitle(input.value);
      applySavedMealProduct(chosenUnit);
      container.hidden = true;
      input.setAttribute("aria-expanded", "false");
      skipMealSuggestionsOnFocus = true;
      input.focus();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "meal-suggestion-delete";
    remove.textContent = "Удалить";
    remove.setAttribute("aria-label", `Удалить «${product.title.trim()}» из личной базы`);
    remove.onclick = () => deleteSavedMealProduct(product);
    row.append(option, remove);
    container.append(row);
  }
  container.hidden = !matches.length;
  input?.setAttribute("aria-expanded", String(Boolean(matches.length)));
}

async function deleteSavedMealProduct(product) {
  const title = String(product?.title || "").trim();
  if (!title || !has("deleteProduct")) {
    toast("Не удалось определить блюдо для удаления");
    return;
  }
  if (!window.confirm(`Удалить «${title}» из личной базы? Записи в дневнике останутся.`)) return;
  try {
    await call("deleteProduct", title);
    savedMealProducts = savedMealProducts.filter(item => normalizeTitle(item.title) !== normalizeTitle(title));
    if (savedMealEstimate?.title === normalizeTitle(title)) savedMealEstimate = null;
    renderMealSuggestions(savedMealProducts);
    toast("Блюдо удалено из личной базы");
  } catch {
    toast("Не удалось удалить блюдо. Проверьте соединение и повторите.");
  }
}

async function loadMealSuggestions() {
  const account = accountDefaults();
  if (savedMealProductsUid === account.uid && savedMealProducts.length) return savedMealProducts;
  if (savedMealProductsLoading) return savedMealProductsLoading;
  savedMealProductsLoading = Promise.resolve(call("listProducts"))
    .then(products => {
      savedMealProducts = Array.isArray(products) ? products : [];
      savedMealProductsUid = account.uid;
      renderMealSuggestions(savedMealProducts);
      return savedMealProducts;
    })
    .catch(() => [])
    .finally(() => { savedMealProductsLoading = null; });
  return savedMealProductsLoading;
}

// Выбор из личной базы не задаёт порцию: БЖУ пересчитаются после её ввода.
function applySavedMealProduct(chosenUnit) {
  applyDescriptionPortion();
  if (typeof chosenUnit === "string") setPortionUnit(chosenUnit);
  const title = normalizeTitle(element("mealName")?.value);
  const product = savedMealProducts.find(item => normalizeTitle(item.title) === title);
  if (!product) return;
  savedMealEstimate = {
    title,
    portion: Number(product.portion),
    unitWeight: Number(product.unitWeight) || null,
    portionUnit: product.unitWeight ? "шт." : "г",
    calories: Number(product.calories),
    protein: Number(product.protein),
    fat: Number(product.fat),
    carbs: Number(product.carbs),
  };
  if (product.unitWeight) lastCalculatedUnitWeight = { title, weight: Number(product.unitWeight) };
  clearFormNutrition();
  if (Number(element("portion").value) > 0) {
    fillSavedMealNutrition();
    if (!element("calories").value) toast("Для количества штук нужен вес: нажмите ✦, ИИ предложит оценку");
  } else toast("Укажите количество в названии или нажмите ✦ для оценки порции");
}

function fillSavedMealNutrition() {
  const base = savedMealEstimate;
  if (!base) return;
  if (base.title !== normalizeTitle(element("mealName")?.value)) {
    savedMealEstimate = null;
    return;
  }
  let target = Number(element("portion").value);
  const targetUnit = portionUnit();
  if (base.portionUnit !== targetUnit) {
    const weight = base.unitWeight || (lastCalculatedUnitWeight?.title === base.title ? lastCalculatedUnitWeight.weight : null);
    if (!weight) { clearFormNutrition(); return; }
    target = targetUnit === "шт." ? target * weight : target / weight;
  }
  const scaled = scaleNutrition(base, target);
  if (!scaled) {
    clearFormNutrition();
    return;
  }
  setFormNutrition(scaled);
}

function fillRecognizedMealNutrition() {
  const base = recognizedManualMealEstimate;
  if (!base) return;
  const scaled = scaleNutrition(base, Number(element("portion").value));
  if (!scaled) {
    clearFormNutrition();
    return;
  }
  setFormNutrition(scaled);
}

function fillMealNutritionFromPortion() {
  setAutomaticPortionUnit();
  if (savedMealEstimate) fillSavedMealNutrition();
  else fillRecognizedMealNutrition();
}

/* -------------------------------------------------------------- AI: meal */

function showNutritionClarification(question) {
  const { dialog, close } = openDialog({
    html: '<section class="sheet"><h2>Уточните блюдо</h2><p class="hello"></p><label class="field">Ваш ответ<input id="nutritionClarification" required placeholder="Например, с майонезом, 2 ложки"></label><button class="primary" type="button">Рассчитать</button><button class="link" type="button" data-close="true" style="display:block;margin:14px auto 0">Отмена</button></section>',
  });
  dialog.querySelector(".hello").textContent = question;
  const answer = dialog.querySelector("input");
  const submit = dialog.querySelector(".primary");
  dialog.querySelector("[data-close]").onclick = close;
  submit.onclick = async () => {
    const value = answer.value.trim();
    if (!value) {
      answer.focus();
      return;
    }
    lastNutritionClarification = {
      title: normalizeTitle(element("mealName").value),
      question: String(question).trim(),
      additionalIngredients: value,
    };
    close();
    await calculateMealNutrition(value);
  };
  answer.focus();
}

function setCalculateButton(busy) {
  const button = element("calculateMealButton");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Рассчитываю…" : "✦ Рассчитать с ИИ";
}

// Количество берём из названия или поля; иначе ИИ предлагает типичную порцию.
// Подходящий продукт базы пользователь выбирает до расчёта.
function applyDescriptionPortion() {
  const parsed = parsePortionDescription(element("mealName").value);
  if (!element("portion").value && parsed.amount) {
    element("portion").value = String(parsed.amount);
    setPortionUnit(parsed.unit);
    describedPortion = { ...parsed, title: normalizeTitle(element("mealName").value) };
  }
}

async function calculateMealNutrition(clarification = "") {
  if (mealCalculationBusy) return;
  mealCalculationBusy = true;
  try {
  applyDescriptionPortion();
  setAutomaticPortionUnit();
  if (!validateMealEstimate()) return;
  await loadMealSuggestions();
  if (!savedMealEstimate && matchingProducts(savedMealProducts, element("mealName").value).length) {
    renderMealSuggestions(savedMealProducts);
    toast("Выберите подходящий продукт из вашей базы");
    return;
  }
  const selectedBase = savedMealEstimate;
  const title = element("mealName").value.trim();
  const originalPortion = element("portion").value;
  const hasPortion = Number(originalPortion) > 0;
  const calculationPortion = hasPortion ? Number(originalPortion) : null;
  const unit = hasPortion ? portionUnit() : "г";

  clearFormNutrition();
  savedMealEstimate = null;
  recognizedManualMealEstimate = null;


  const timeline = createMealTimeline("calculation");
  setCalculateButton(true);
  let failure = "";
  let estimate = null;
  try {
    const savedProduct = unit === "шт." ? await call("loadProduct", title) : null;
    const savedUnitWeight = Number(savedProduct?.unitWeight);
    const weightHint = unit === "шт."
      ? (Number.isFinite(savedUnitWeight) && savedUnitWeight > 0
        ? `В личной базе указано: одна штука весит ${savedUnitWeight} г. Используй это значение.`
        : "Используй типичный вес одной штуки.")
      : "Количество указано в граммах.";
    const clarificationHint = clarification
      ? `Пользователь уточнил: «${clarification}». Теперь выполни расчёт.`
      : "Если для сложного блюда не хватает важной детали, не рассчитывай наугад: верни пустой список продуктов и задай в поле advice один короткий уточняющий вопрос.";
    const portionHint = hasPortion ? `для порции ${calculationPortion} ${unit}` : "для обычной порции: количество/вес из названия имеет приоритет, иначе предложи типичную порцию и явно обозначь её как оценочную";
    const message = `Оцени пищевую ценность блюда «${title}» ${portionHint}. ${weightHint} ${clarificationHint} Верни один продукт с калориями, белками, жирами и углеводами именно для этой порции. В поле portion верни общий вес порции в граммах.`;
    const result = await askAi({ message, timeline });
    if (result.status === "no-token") return;
    if (result.status === "signed-out") {
      window.showAuthRequiredDialog();
      return;
    }
    if (result.status === "error") {
      if (typeof result.data?.debugResponse === "string" && result.data.debugResponse) {
        showCalculationResult({ error: "ИИ вернул ответ в неподходящем формате. Повторите расчёт." });
        showAiDiagnostic(element("calculateMealButton"), "aiCalculationDiagnostic", result.data.debugResponse);
        return;
      }
      throw new Error(result.data?.error || "Ошибка сервиса");
    }
    estimate = parseMealEstimate(result.data);
    if (!estimate) {
      const advice = typeof result.data?.advice === "string" ? result.data.advice.trim() : "";
      if (advice) {
        showNutritionClarification(advice);
        return;
      }
      throw new Error("ИИ не вернул расчёт");
    }
  } catch (error) {
    failure = error.message;
  } finally {
    timeline?.finish();
    setCalculateButton(false);
  }

  if (failure) {
    // При ошибке оставляем исходную порцию без подстановки оценочного веса.
    if (!hasPortion) element("portion").value = originalPortion;
    showCalculationResult({ error: `Не удалось рассчитать: ${failure}` });
    return;
  }

  setFormNutrition(estimate);
  const result = {
    title,
    portionLabel: hasPortion ? `${calculationPortion} ${unit}` : `${estimate.portion} г (оценка ИИ)`,
    calories: estimate.calories,
    protein: estimate.protein,
    fat: estimate.fat,
    carbs: estimate.carbs,
  };
  if (!hasPortion) {
    const proposedWeight = Number(estimate.portion);
    if (!Number.isFinite(proposedWeight) || proposedWeight <= 0 || proposedWeight > 10000) {
      clearFormNutrition(); showCalculationResult({ error: "ИИ не предложил корректный вес. Укажите количество и повторите." }); return;
    }
    element("portion").value = String(proposedWeight);
    setPortionUnit("г");
  }
  recognizedManualMealEstimate = { portion: Number(element("portion").value), ...readFormNutrition() };
  if (hasPortion && unit === "шт." && Number(estimate.portion) > 0) {
    lastCalculatedUnitWeight = { title: normalizeTitle(title), weight: Number(estimate.portion) / calculationPortion };
  }
  if (selectedBase) {
    savedMealEstimate = selectedBase;
    fillSavedMealNutrition();
    Object.assign(result, readFormNutrition());
  }
  showCalculationResult(result);
  } finally { mealCalculationBusy = false; }
}

/* ------------------------------------------------------------- AI: photo */

async function recognizeMealPhoto(file) {
  if (!file) return;
  if (file.size > MAX_PHOTO_BYTES) {
    toast("Фото должно быть не больше 4 МБ");
    return;
  }
  const token = await getAiToken();
  if (token === undefined) return;
  if (!token) {
    window.showAuthRequiredDialog();
    return;
  }
  const button = element("manualPhotoButton");
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "…";
  }
  try {
    const image = await preparePhoto(file);
    const result = await askAi({
      timeline: createMealTimeline("photo"),
      message: "Распознай блюдо на фотографии. Верни один наиболее заметный продукт или блюдо с ориентировочными калориями, белками, жирами, углеводами и весом порции в граммах. Не сохраняй ничего.",
      image,
    });
    if (result.status === "error") {
      if (typeof result.data?.debugResponse === "string" && result.data.debugResponse) {
        showPhotoRecognitionDialog(result.data.debugResponse, { title: "Ответ ИИ" });
        return;
      }
      throw new Error(result.data?.error || "Ошибка сервиса");
    }
    const answer = String(result.data?.advice || "").trim();
    if (!answer) throw new Error("ИИ не вернул результат распознавания");
    const normalized = answer.toLowerCase();
    const isNotFood = normalized === "это не еда." || normalized === "это не еда";
    const isUnknown = normalized === "не удалось распознать блюдо." || normalized === "не удалось распознать блюдо";
    showPhotoRecognitionDialog(isNotFood ? "🪨 Это не еда." : answer, {
      title: isNotFood || isUnknown ? "Распознавание фото" : "Результат распознавания",
      onTransfer: estimate => {
        openMeal();
        element("mealDate").value = "today";
        fillMealForm(estimate);
        loadMealSuggestions().then(products => { if (matchingProducts(products, estimate.title).length) { renderMealSuggestions(products); toast("Можно выбрать соответствующий продукт из вашей базы"); } });
        // Сохраняем базу распознавания, иначе при изменении порции БЖУ не пересчитаются.
        recognizedManualMealEstimate = {
          portion: Number(estimate.portion) || 100,
          calories: Number(estimate.calories) || 0,
          protein: Number(estimate.protein) || 0,
          fat: Number(estimate.fat) || 0,
          carbs: Number(estimate.carbs) || 0,
        };
        toastPhotoTransfer();
      },
    });
  } catch (error) {
    toast(`Не удалось распознать фото: ${error.message}`);
  } finally {
    const input = element("manualMealPhoto");
    if (input) input.value = "";
    if (button) {
      button.disabled = false;
      button.textContent = label || "📷";
    }
  }
}

function openPhotoMealInAddForm(data) {
  const estimate = parseMealEstimate(data);
  if (!estimate) {
    toast("ИИ не смог определить блюдо на фото");
    return;
  }
  openMeal();
  element("mealDate").value = "today";
  element("mealType").value = MEAL_TYPES.includes(estimate.mealType) ? estimate.mealType : "Перекус";
  fillMealForm(estimate);
  loadMealSuggestions().then(products => { if (matchingProducts(products, estimate.title).length) { renderMealSuggestions(products); toast("Можно выбрать соответствующий продукт из вашей базы"); } });
  // Сохраняем базу распознавания, иначе при изменении порции БЖУ не пересчитаются.
  recognizedManualMealEstimate = {
    portion: Number(estimate.portion) || 100,
    calories: Number(estimate.calories) || 0,
    protein: Number(estimate.protein) || 0,
    fat: Number(estimate.fat) || 0,
    carbs: Number(estimate.carbs) || 0,
  };
  toast("Данные по фото перенесены в форму — проверьте и нажмите «Сохранить»");
}

/* --------------------------------------------------------- AI: assistant */

function appendBubble(className, text) {
  const bubble = document.createElement("div");
  bubble.className = className;
  bubble.textContent = text;
  element("chatlog").append(bubble);
  return bubble;
}

function showMealProposal(meal) {
  const title = String(meal?.title || "").trim();
  if (!title || !Number.isFinite(Number(meal.calories))) return;
  const mealType = MEAL_TYPES.includes(meal.mealType) ? meal.mealType : "Перекус";
  const { dialog, close } = openDialog({
    html: '<section class="sheet"><h2>Добавить в дневник?</h2><p class="hello"></p><label class="field">Когда добавить<select><option value="today">Сегодня</option><option value="tomorrow">Завтра</option></select></label><p class="notice">Проверьте предложение перед сохранением. Блюдо не будет добавлено без вашего подтверждения.</p><button class="primary" type="button">Добавить</button><button class="link" type="button" data-close="true" style="display:block;margin:14px auto 0">Отмена</button></section>',
  });
  // Название блюда приходит от ИИ, поэтому вставляется текстом, а не разметкой.
  dialog.querySelector("p").textContent = `ИИ предлагает: ${title} · ${safeNumber(meal.calories)} ккал · ${mealType}`;
  const dateSelect = dialog.querySelector("select");
  dialog.querySelector("[data-close]").onclick = close;
  dialog.querySelector(".primary").onclick = async () => {
    const date = dateKeyFor(dateSelect.value);
    const entry = { ...meal, title, mealType, date, calories: safeNumber(meal.calories), source: "ai-confirmed" };
    try {
      await window.addProposedMeal(entry);
      addDiaryEntryToView({ ...entry, id: entry.id || crypto.randomUUID() });
      close();
      toast(`Блюдо добавлено на ${dateSelect.value === "today" ? "сегодня" : "завтра"}`);
    } catch {
      toast("Не удалось сохранить блюдо");
    }
  };
}

// Предложения по отдельным продуктам: один клик — одна запись.
async function showProductProposals(products) {
  const list = Array.isArray(products) ? products.slice(0, 8) : [];
  for (const proposal of list) {
    if (!proposal?.title || !Number.isFinite(Number(proposal.calories))) continue;
    let product = { ...proposal };
    try {
      const saved = await call("loadProduct", proposal.title);
      if (saved) product = { ...product, ...saved, mealType: proposal.mealType || "Перекус" };
    } catch { /* Предложение ИИ остаётся рабочим без личной базы. */ }
    const basePortion = Number(product.portion);

    const card = document.createElement("section");
    card.className = "card";
    const title = document.createElement("h2");
    title.textContent = product.title;
    const details = document.createElement("p");
    details.className = "hello";
    const weightLabel = document.createElement("label");
    weightLabel.className = "field";
    weightLabel.textContent = "Вес порции, г";
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "1";
    weightInput.step = "1";
    weightInput.inputMode = "numeric";
    weightInput.value = Number.isFinite(basePortion) && basePortion > 0 ? basePortion : "";
    weightLabel.append(weightInput);

    const scaledProduct = () => {
      const weight = Number(weightInput.value);
      if (!Number.isFinite(weight) || weight <= 0) return null;
      const ratio = basePortion > 0 ? weight / basePortion : 1;
      return {
        ...product,
        portion: weight,
        calories: Math.round(safeNumber(product.calories) * ratio),
        protein: Number((safeNumber(product.protein) * ratio).toFixed(1)),
        fat: Number((safeNumber(product.fat) * ratio).toFixed(1)),
        carbs: Number((safeNumber(product.carbs) * ratio).toFixed(1)),
      };
    };
    const renderDetails = () => {
      const entry = scaledProduct() || product;
      details.textContent = `${entry.portion || "—"} г · ${formatNumber(safeNumber(entry.calories))} ккал · Б ${formatNumber(safeNumber(entry.protein))} г · Ж ${formatNumber(safeNumber(entry.fat))} г · У ${formatNumber(safeNumber(entry.carbs))} г`;
    };
    renderDetails();
    weightInput.oninput = renderDetails;

    const typeLabel = document.createElement("label");
    typeLabel.className = "field";
    typeLabel.textContent = "Приём пищи";
    const typeSelect = document.createElement("select");
    for (const type of MEAL_TYPES) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = type === (product.mealType || "Перекус");
      typeSelect.append(option);
    }
    typeLabel.append(typeSelect);

    const dateLabel = document.createElement("label");
    dateLabel.className = "field";
    dateLabel.textContent = "Когда добавить";
    const dateSelect = document.createElement("select");
    dateSelect.add(new Option("Сегодня", "today"));
    dateSelect.add(new Option("Завтра", "tomorrow"));
    dateLabel.append(dateSelect);

    const button = document.createElement("button");
    button.className = "primary";
    button.type = "button";
    button.textContent = "Добавить";
    button.onclick = async () => {
      const entry = scaledProduct();
      if (!entry) {
        weightInput.focus();
        toast("Укажите вес порции в граммах");
        return;
      }
      button.disabled = true;
      const date = dateKeyFor(dateSelect.value);
      const mealType = typeSelect.value;
      try {
        await window.addProposedProduct({ ...entry, mealType, date, source: "ai-product-confirmed" });
        addDiaryEntryToView({ ...entry, id: crypto.randomUUID(), mealType, date });
        card.remove();
        toast(`Продукт добавлен на ${dateSelect.value === "today" ? "сегодня" : "завтра"} и в личную базу`);
      } catch {
        button.disabled = false;
        toast("Не удалось сохранить продукт");
      }
    };
    card.append(title, details, weightLabel, typeLabel, dateLabel, button);
    element("chatlog").append(card);
  }
}

async function requestAdvice(event) {
  event?.preventDefault();
  const text = element("question").value.trim();
  if (!text) return;
  const hadPhoto = Boolean(selectedPhoto);
  removeAiDiagnostic("aiResponseDiagnostic");
  appendBubble("bubble user", text);
  element("question").value = "";
  setText("chatStatus", "Формирую ответ…");
  setAiDebug("запрос отправлен");
  try {
    const result = await askAi({
      message: text,
      image: selectedPhoto,
      timeline: hadPhoto ? createMealTimeline("photo") : null,
    });
    if (result.status === "no-token") return;
    if (result.status === "signed-out") {
      setText("chatStatus", "Войдите по email в профиле, чтобы воспользоваться ИИ.");
      showScreen("profile");
      return;
    }
    if (result.status === "error") {
      setAiDebug(`Worker ответил HTTP ${result.response.status}`);
      showAiDiagnostic(element("aiDebug"), "aiResponseDiagnostic", result.data?.debugResponse);
      throw new Error(result.data?.error || "Ошибка сервиса");
    }    if (typeof result.data.advice !== "string") throw new Error("Worker вернул неполный ответ");
    setAiDebug("Worker ответил успешно");
    appendBubble("bubble", result.data.advice);
    setText("chatStatus", "Ответ носит справочный характер.");
    if (hadPhoto) openPhotoMealInAddForm(result.data);
    else {
      if (result.data.proposedProducts) await showProductProposals(result.data.proposedProducts);
      if (result.data.proposedMeal) showMealProposal(result.data.proposedMeal);
    }
    removePhoto();
    speak(result.data.advice);
  } catch (error) {
    if (!element("aiDebug")?.textContent.includes("HTTP")) setAiDebug("ошибка запроса");
    setText("chatStatus", `Не удалось получить ответ: ${error.message}`);
  }
}

/* ------------------------------------------------------------- AI: voice */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let voiceCancelled = false;

function setVoiceStatus(text) {
  setText("voiceStatus", text);
}

function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  window.speechSynthesis.speak(utterance);
}

function startRecognition({ onEnd, onError, target }) {
  recognition = new Recognition();
  recognition.lang = "ru-RU";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = event => {
    target.value = Array.from(event.results).map(result => result[0].transcript).join("");
  };
  recognition.onerror = onError;
  recognition.onend = () => {
    recognition = null;
    onEnd();
  };
  recognition.start();
}

function toggleVoice() {
  if (!Recognition) {
    setVoiceStatus("Голосовой ввод не поддерживается этим браузером. Введите вопрос текстом.");
    return;
  }
  if (recognition) {
    voiceCancelled = true;
    recognition.abort();
    return;
  }
  voiceCancelled = false;
  const button = element("micButton");
  button.textContent = "■";
  setVoiceStatus("Слушаю… Нажмите ■ для отмены.");
  startRecognition({
    target: element("question"),
    onError: event => {
      if (event.error === "not-allowed") setVoiceStatus("Нет доступа к микрофону. Разрешите его или используйте текст.");
      else if (event.error !== "aborted") setVoiceStatus("Не удалось распознать речь. Попробуйте ещё раз.");
    },
    onEnd: () => {
      button.textContent = "🎙";
      if (element("question").value.trim() && !voiceCancelled) {
        setVoiceStatus("Отправляю распознанный вопрос…");
        requestAdvice();
      } else {
        setVoiceStatus("Голосовой ввод отменён.");
      }
    },
  });
}

function setupMealVoiceButton(button) {
  if (!Recognition || !button) return;
  button.textContent = "🎙";
  button.title = "Ввести название голосом";
  button.setAttribute("aria-label", "Ввести название блюда голосом");
  button.onclick = () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    button.classList.add("is-listening");
    button.textContent = "■";
    button.setAttribute("aria-label", "Остановить голосовой ввод");
    startRecognition({
      target: element("mealName"),
      onError: () => toast("Не удалось распознать название блюда."),
      onEnd: () => {
        button.classList.remove("is-listening");
        button.textContent = "🎙";
        button.setAttribute("aria-label", "Ввести название блюда голосом");
      },
    });
  };
}

/* ------------------------------------------------------------- ai auth UI */

function showAuthRequiredDialog() {
  if (element("authRequiredDialog")) return;
  const { dialog, close } = openDialog({
    id: "authRequiredDialog",
    className: "modal show",
    labelledBy: "authRequiredTitle",
    html: '<section class="sheet auth-sheet"><div class="auth-mark" aria-hidden="true">🌿</div><p class="auth-brand">Мой нутрициолог</p><h2 id="authRequiredTitle">Войти в аккаунт</h2><p class="auth-description">Сохраняйте свой дневник и получайте<br>подсказки ИИ о питании.</p><button class="primary" type="button">Войти по email</button><button class="link auth-later" type="button" data-close="true">Позже</button><p class="auth-note">Откроется раздел профиля. Ваш черновик блюда останется на месте.</p></section>',
  });
  const signIn = dialog.querySelector(".primary");
  const cancel = dialog.querySelector(".auth-later");
  cancel.onclick = close;
  signIn.onclick = () => { close(); showScreen("profile"); };
  signIn.focus();
}

/* ------------------------------------------------------------------ photo */

async function selectPhoto(file) {
  if (!file) {
    selectedPhoto = null;
    element("photoPreview").style.display = "none";
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    toast("Фото должно быть не больше 4 МБ");
    element("mealPhoto").value = "";
    return;
  }
  try {
    selectedPhoto = await preparePhoto(file);
    const preview = element("photoPreview");
    preview.replaceChildren();
    preview.append(`Фото: ${file.name} `);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link";
    remove.textContent = "Удалить";
    remove.onclick = removePhoto;
    preview.append(remove);
    preview.style.display = "block";
  } catch {
    toast("Не удалось прочитать фото. Попробуйте другое изображение.");
  }
}

function removePhoto() {
  selectedPhoto = null;
  element("mealPhoto").value = "";
  element("photoPreview").style.display = "none";
}

/* ------------------------------------------------------------- lifecycle */

function persist(method, value) {
  if (!has(method)) return;
  Promise.resolve(call(method, value)).catch(() => {
    toast("Не удалось синхронизировать данные. Они останутся на этом устройстве.");
  });
}

function initProfile() {
  const preview = cachedProfilePreview();
  if (preview?.profile) applyProfile(preview.profile, { uid: preview.uid });
  loadCurrentProfile();
}

function initDiaryCalendar() {
  const input = element("diaryCalendar");
  const button = element("diaryCalendarButton");
  if (!input) return;
  input.max = dateKeyFor("tomorrow");
  input.value = selectedDiaryDate;
  input.addEventListener("change", () => {
    if (input.value) renderDiaryForDate(input.value);
  });
  // Кнопка открывает нативный выбор даты; поле даты при этом скрыто.
  button?.addEventListener("click", () => {
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  });
}

function initMealForm() {
  const form = document.querySelector("#modal form");
  const name = element("mealName");
  name.name = "meal-title";
  name.autocomplete = "off";
  name.setAttribute("autocorrect", "off");
  name.setAttribute("autocapitalize", "none");
  name.spellcheck = false;
  form?.setAttribute("autocomplete", "off");
  form?.addEventListener("submit", saveMeal);
  form?.addEventListener("reset", () => {
    ["mealName", "portion"].forEach(id => clearMealEstimateError(element(id)));
    clearFormNutrition();
    setPortionUnit("г");
    describedPortion = null;
    savedMealEstimate = null;
    recognizedManualMealEstimate = null;
    lastCalculatedUnitWeight = null;
    lastNutritionClarification = null;
  });
  element("mealCancelButton").onclick = closeMeal;
  element("calculateMealButton").onclick = () => calculateMealNutrition();

  for (const id of ["mealName", "portion"]) {
    element(id).addEventListener("input", () => clearMealEstimateError(element(id)));
  }
  element("portion").addEventListener("invalid", () => {
    const portion = element("portion");
    if (!Number.isFinite(Number(portion.value)) || Number(portion.value) <= 0) {
      portion.setCustomValidity("Укажите порцию: вес в граммах или количество штук, больше нуля.");
    }
  });
  element("portion").addEventListener("input", fillMealNutritionFromPortion);
  element("portion").addEventListener("change", () => {
    const base = savedMealEstimate;
    if (Number(element("portion").value) > 0 && portionUnit() === "шт." && base?.portionUnit === "г"
        && !base.unitWeight && !(lastCalculatedUnitWeight?.title === base.title && lastCalculatedUnitWeight.weight > 0)) {
      void calculateMealNutrition();
    }
  });
  element("mealType").addEventListener("change", () => { lastSelectedMealType = element("mealType").value; });
  element("mealDate").addEventListener("change", () => setPortionUnit(portionUnit()));

  // Кнопки внутри поля названия: фото, голос и расчёт ИИ.
  const actions = element("mealNameActions");
  const photoButton = element("manualPhotoButton");
  photoButton.classList.add("meal-name-action", "meal-photo-action");
  photoButton.style.cssText = "";
  actions.append(photoButton);
  const voiceButton = document.createElement("button");
  voiceButton.type = "button";
  voiceButton.className = "secondary meal-name-action";
  actions.append(voiceButton);
  setupMealVoiceButton(voiceButton);
  const calculateButton = element("calculateMealButton");
  calculateButton.className = "secondary meal-name-action meal-calculate-action";
  calculateButton.style.cssText = "";
  calculateButton.textContent = "✦";
  calculateButton.title = "Рассчитать БЖУ с ИИ";
  calculateButton.setAttribute("aria-label", "Рассчитать БЖУ с ИИ");
  actions.append(calculateButton);

  const suggestionsBox = document.createElement("div");
  suggestionsBox.id = "mealNameSuggestions";
  suggestionsBox.className = "meal-suggestions";
  suggestionsBox.setAttribute("role", "listbox");
  suggestionsBox.hidden = true;
  actions.closest(".meal-name-control").after(suggestionsBox);
  name.setAttribute("aria-controls", suggestionsBox.id);
  name.setAttribute("aria-expanded", "false");

  name.addEventListener("focus", () => {
    if (skipMealSuggestionsOnFocus) {
      skipMealSuggestionsOnFocus = false;
      return;
    }
    loadMealSuggestions().then(() => renderMealSuggestions(savedMealProducts));
  });
  name.addEventListener("change", applySavedMealProduct);
  name.addEventListener("input", () => {
    savedMealEstimate = null;
    recognizedManualMealEstimate = null;
    renderMealSuggestions(savedMealProducts);
  });
  name.addEventListener("blur", () => window.setTimeout(() => {
    suggestionsBox.hidden = true;
    name.setAttribute("aria-expanded", "false");
  }, 120));
}

function initPhotoInputs() {
  const adviceButton = element("advicePhotoButton");
  const manualButton = element("manualPhotoButton");
  const adviceInput = element("mealPhoto");
  const manualInput = element("manualMealPhoto");
  adviceButton.onclick = () => openPhotoPicker(adviceButton, adviceInput, { onNativeCameraPhoto: selectPhoto });
  manualButton.onclick = () => openPhotoPicker(manualButton, manualInput, { onNativeCameraPhoto: recognizeMealPhoto });
  adviceInput.addEventListener("change", () => selectPhoto(adviceInput.files[0]));
  manualInput.addEventListener("change", () => {
    const file = manualInput.files[0];
    if (file) recognizeMealPhoto(file);
  });
}

function initPlan() {
  document.querySelector("#planModal form").addEventListener("submit", savePlanItem);
  element("planCancelButton").onclick = closePlanItem;
  element("planAddButton").onclick = () => openPlanItem();
  renderPlan();
}

function initNavigation() {
  for (const nav of document.querySelectorAll("[data-nav]")) {
    nav.addEventListener("click", () => showScreen(nav.dataset.nav));
  }
  element("todayAddMealButton").onclick = openMeal;
  element("diaryAddButton").onclick = openMeal;
  element("addWaterButton").onclick = addWater;
  element("addWeightButton").onclick = addWeight;
  element("editProfileButton").onclick = openProfileEditor;
  element("editProfileCaloriesButton").onclick = openProfileEditor;
  document.querySelector("#profileModal form").addEventListener("submit", saveProfile);
  element("profileCancelButton").onclick = closeProfileEditor;
  element("micButton").onclick = toggleVoice;
  document.querySelector("#askForm").addEventListener("submit", requestAdvice);
  element("mealList").addEventListener("click", event => {
    const button = event.target.closest("[data-delete-diary-entry]");
    if (button) deleteDiaryEntry(button.dataset.deleteDiaryEntry);
  });
  element("speechToggle").remove();
}

function initViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const update = () => {
    if (Math.abs(viewport.scale - 1) > 0.01) return;
    document.documentElement.style.setProperty("--form-viewport-height", `${viewport.height}px`);
    document.documentElement.style.setProperty("--form-viewport-top", `${viewport.offsetTop}px`);
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
}

function startDayWatchers() {
  // Один таймер на обе задачи: смена суток для воды и обновление приветствия.
  const schedule = () => {
    waterTimer = window.setTimeout(() => {
      ensureWaterDate();
      loadWater();
      renderNutrition();
      renderDiaryForDate(selectedDiaryDate);
      schedule();
    }, Math.max(1000, minutesUntilNextLocalDay() + 1000));
  };
  schedule();
  window.setInterval(renderNutrition, 60_000);
}

/* ------------------------------------------------------------------- boot */

function boot() {
  window.show = showScreen;
  window.openMeal = openMeal;
  window.closeMeal = closeMeal;
  window.addWater = addWater;
  window.toggleWater = toggleWater;
  window.addWeight = addWeight;
  window.openProfileEditor = openProfileEditor;
  window.closeProfileEditor = closeProfileEditor;
  window.saveProfile = saveProfile;
  window.saveMeal = saveMeal;
  window.askAI = requestAdvice;
  window.calculateMealNutrition = calculateMealNutrition;
  window.deleteDiaryEntry = deleteDiaryEntry;
  window.showAuthRequiredDialog = showAuthRequiredDialog;
  window.addDiaryEntryToView = addDiaryEntryToView;
  window.renderNutrition = renderNutrition;
  window.renderPlan = renderPlan;
  window.openPlanItem = openPlanItem;
  window.savePlanItem = savePlanItem;
  window.toggleVoice = toggleVoice;
  window.removePhoto = removePhoto;
  window.todayNutrition = todayNutrition;
  // Поверхность для диагностики и браузерных проверок.
  window.getAiToken = getAiToken;
  window.requestAiAdvice = requestAiAdvice;
  window.aiAvailability = availability;

  // initMealForm перестраивает кнопку расчёта, поэтому доступность ИИ
  // рассчитывается уже после неё и видит итоговую разметку.
  initNavigation();
  initMealForm();
  initPhotoInputs();
  initPlan();
  initDiaryCalendar();
  initViewport();
  initAiAvailability();
  initAiQuota();
  initDailyAdvice();

  // Хранилище создаётся модулем firebase-client.js до этого модуля, поэтому
  // начальная загрузка запускается напрямую, а события обслуживают обновления.
  onAuthChanged(refreshProfileFromAccount);
  onAuthChanged(() => {
    savedMealProducts = [];
    savedMealProductsUid = "";
    savedMealEstimate = null;
    suggestions()?.replaceChildren();
    if (suggestions()) suggestions().hidden = true;
    loadWater();
    renderDiaryForDate(selectedDiaryDate);
    loadWeightProgress();
  });
  onStoreReady(loadWater);
  onAuthChanged(loadWater);
  onStoreReady(loadWeightProgress);
  onAuthChanged(loadWeightProgress);
  onStoreReady(() => renderDiaryForDate(selectedDiaryDate));
  window.addEventListener("online", clearErrors);
  window.addEventListener("online", clearServiceError);

  onProfileUpdated(event => {
    const account = accountDefaults();
    if (!account.uid || account.uid !== event.detail?.uid) return;
    profileLoadVersion++;
    applyProfile(event.detail.profile, account);
  });

  profileNameFallbackTimer = window.setTimeout(() => {
    profileNameReady = true;
    renderProfile();
  }, 10_000);

  // preview показывается сразу, синхронизация с Firebase идёт следом.
  initProfile();
  loadWater();
  renderDiaryForDate(selectedDiaryDate);
  renderWeightProgress();
  startDayWatchers();
}

boot();
