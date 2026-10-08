// Единственная точка доступа к хранилищу приложения. firebase-client.js
// публикует window.nutritionStore и сам решает, писать в Firestore или локально.
function store() {
  return window.nutritionStore;
}

export function hasStore() {
  return Boolean(window.nutritionStore);
}

export function has(method) {
  return typeof window.nutritionStore?.[method] === "function";
}

export function call(method, ...args) {
  const target = store();
  if (typeof target?.[method] !== "function") return undefined;
  return target[method](...args);
}

export async function loadProfile() {
  if (!has("loadProfile")) return null;
  return window.nutritionStore.loadProfile();
}

export function accountDefaults() {
  return window.nutritionStore?.getAccountProfileDefaults?.() || {};
}

export function cachedProfilePreview() {
  return window.nutritionStore?.getCachedProfilePreview?.() || null;
}

export function getAuthErrorMessage(error) {
  return window.getAuthErrorMessage?.(error) || "Не удалось выполнить действие. Проверьте соединение и повторите.";
}

export function getFirebaseIdToken() {
  return window.getFirebaseIdToken;
}

export function onAuthChanged(handler) {
  window.addEventListener("nutrition-auth-changed", handler);
}

export function onStoreReady(handler) {
  window.addEventListener("nutritionstore-ready", handler);
}

// Профиль обновился в фоне после чтения из Firestore.
export function onProfileUpdated(handler) {
  window.addEventListener("nutrition-profile-updated", handler);
}

