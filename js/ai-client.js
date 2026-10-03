import { AI_TIMEOUT_MS } from "./core.js";
import { getAuthErrorMessage, getAuthStatus, getFirebaseIdToken } from "./storage.js";
import { toast } from "./ui.js";

export const AI_ENDPOINT = "https://my-nutritionist-advice.340052.workers.dev/api/advice";

const listeners = new Set();
let tokenError = "";
let serviceError = "";
let activeRequests = 0;

export function onAiStateChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function notify() {
  for (const handler of listeners) handler(availability());
}

export function setTokenError(message) {
  tokenError = message || "";
  notify();
}

export function clearErrors() {
  tokenError = "";
  serviceError = "";
  notify();
}

export function availability() {
  const auth = getAuthStatus();
  const reason = navigator.onLine === false ? "Нет интернета — ИИ недоступен."
    : !auth || auth.state === "loading" ? "Подключаем аккаунт — ИИ пока недоступен."
      : auth.state === "error" ? "Сервис входа недоступен. Повторите подключение в профиле."
        : !auth.signedIn ? "Для ИИ нужен вход в аккаунт."
          : tokenError || serviceError;
  return { reason, busy: activeRequests > 0, signedIn: Boolean(auth?.signedIn) };
}

// Токен нужен до запроса к ИИ. undefined означает «повторять не нужно»:
// нет сети или не удалось проверить вход. null означает «нужен вход».
export async function getAiToken() {
  if (navigator.onLine === false) {
    toast("Нет интернета. ИИ станет доступен после подключения.");
    return undefined;
  }
  const getIdToken = getFirebaseIdToken();
  if (!getIdToken) {
    toast("Сервис входа ещё загружается. Подождите немного.");
    return undefined;
  }
  try {
    const token = await getIdToken();
    setTokenError("");
    return token;
  } catch (error) {
    const message = getAuthErrorMessage(error);
    setTokenError(message);
    toast(message);
    return undefined;
  }
}

function logResponse(response) {
  response.clone().text().then(body => {
    let payload = body;
    try { payload = JSON.parse(body); } catch { /* Оставляем текст как есть. */ }
    console.info("[ИИ] Ответ Worker", { status: response.status, ok: response.ok, payload });
  }).catch(() => console.info("[ИИ] Получен ответ Worker", { status: response.status, ok: response.ok }));
}

export async function requestAiAdvice(options) {
  const { timeline, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  activeRequests++;
  notify();
  timeline?.start();
  try {
    const response = await fetch(AI_ENDPOINT, { ...fetchOptions, signal: controller.signal });
    logResponse(response);
    if (response.ok) serviceError = "";
    else if (response.status === 401 || response.status === 403) serviceError = "Не удалось подтвердить доступ к ИИ. Повторите вход в профиле.";
    else if (response.status === 429 || response.status >= 500) serviceError = "ИИ временно недоступен. Можно повторить запрос позже.";
    return response;
  } catch (error) {
    serviceError = error?.name === "AbortError"
      ? "ИИ не ответил вовремя. Проверьте соединение и повторите запрос."
      : "Не удалось подключиться к ИИ. Проверьте интернет и повторите запрос.";
    throw new Error(serviceError);
  } finally {
    window.clearTimeout(timer);
    timeline?.finish();
    activeRequests--;
    notify();
  }
}

// POST к Worker с токеном и разбором тела ответа в одном месте.
export async function askAi({ message, image = null, timeline = null }) {
  const token = await getAiToken();
  if (token === undefined) return { status: "no-token" };
  if (!token) return { status: "signed-out" };
  const response = await requestAiAdvice({
    timeline,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, ...(image ? { image } : {}) }),
  });
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Worker вернул ответ не в JSON-формате");
  }
  return { status: response.ok ? "ok" : "error", response, data };
}

export function clearServiceError() {
  serviceError = "";
  notify();
}

window.addEventListener("nutrition-auth-status", notify);
window.addEventListener("offline", notify);
