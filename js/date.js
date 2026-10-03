// Календарные ключи дневника. Считаются по локальному времени устройства:
// toISOString() отдаёт UTC и в Москве переключал бы сутки в 03:00.
const pad = value => String(value).padStart(2, "0");

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dateKey();
}

export function tomorrowKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

export function dateKeyFor(when) {
  return when === "tomorrow" ? tomorrowKey() : todayKey();
}

// Даты дневника форматируются из ключа «YYYY-MM-DD» как локальная полночь.
export function parseDateKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatDayTitle(key) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parseDateKey(key));
}

export function formatFullDate(key) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(parseDateKey(key));
}

export function formatShortDate(key) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseDateKey(key));
}

export function diaryTitleForDate(key) {
  if (key === todayKey()) return "Сегодня";
  if (key === tomorrowKey()) return "Завтра";
  return formatDayTitle(key);
}

export function minutesUntilNextLocalDay(date = new Date()) {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(0, nextDay.getTime() - date.getTime());
}
