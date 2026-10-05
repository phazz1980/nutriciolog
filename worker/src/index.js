import { getProvider } from "./providers/index.js";
import { AiResponseFormatError } from "./providers/blackroute.js";
import { userQuota, QuotaExceededError, QuotaUnavailableError } from "./quota.js";

const WORKER_VERSION = "0.1.19";

const ALLOWED_ORIGINS = new Set([
  "https://nutriciolog.pages.dev",
  "https://nutriciolog-x20.website.yandexcloud.net",
]);

const DEFAULT_ORIGIN = "https://nutriciolog.pages.dev";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-X20-Authorization",
    "Vary": "Origin",
  };
}

const MODEL_SELECTOR_EMAIL = "340052@gmail.com";
const MAX_MESSAGE_LENGTH = 1000;
const MAX_IMAGE_DATA_URL_LENGTH = 5_600_000;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    if (request.method === "GET" && new URL(request.url).pathname === "/api/health") {
      return json({
        status: "ok",
        version: WORKER_VERSION,
        provider: env.AI_PROVIDER || null,
        textModel: env.BLACKROUTE_MODEL || null,
        visionModel: env.BLACKROUTE_VISION_MODEL || null,
        apiKeyConfigured: Boolean(env.BLACKROUTE_API_KEY),
        quotaConfigured: Boolean(env.AI_QUOTA_STORE),
      }, 200, request);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, request);
    let quota;
    try {
      const claims = await verifyFirebaseToken(request.headers.get("Authorization"));
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Тело запроса должно быть корректным JSON." }, 400, request);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "Тело запроса должно быть объектом." }, 400, request);
      if (payload.action === "usage") return json({ quota: await userQuota(env, claims.sub) }, 200, request);
      if (payload.action !== undefined) return json({ error: "Неизвестное действие." }, 400, request);
      const { message, image = null, model = null } = payload;
      if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
        return json({ error: `Введите вопрос до ${MAX_MESSAGE_LENGTH} символов.` }, 400, request);
      }
      if (model !== null && typeof model !== "string") return json({ error: "Недопустимая модель." }, 400, request);
      if (image && (!/^image\/(jpeg|png|webp)$/.test(image.mimeType || "") || typeof image.dataUrl !== "string" || image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH)) {
        return json({ error: "Недопустимое фото. Используйте JPEG, PNG или WebP до 4 МБ." }, 400, request);
      }
      const requestedModel = claims.email?.toLowerCase() === MODEL_SELECTOR_EMAIL ? model : null;
      const provider = getProvider(env, requestedModel, image);
      if (image && !provider.supportsVision) {
        return json({ advice: "Этот ИИ пока не умеет анализировать фото. Опишите, пожалуйста, блюдо и примерную порцию текстом.", proposedMeal: null, proposedProducts: [] }, 200, request);
      }
      quota = await userQuota(env, claims.sub, true);
      const result = await provider.advise(message.trim(), image, AbortSignal.timeout(45_000));
      return json({ ...result, quota }, 200, request);
    } catch (error) {
      const response = errorResponse(error, request);
      if (!quota) return response;
      return json({ ...await response.json(), quota }, response.status, request);
    }
  },
};

function errorResponse(error, request) {
  if (error instanceof QuotaExceededError) return json({ error: error.message, code: "quota_exceeded", quota: error.quota }, 429, request);
  if (error instanceof QuotaUnavailableError) return json({ error: error.message, code: "quota_unavailable" }, 503, request);
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return json({ error: "ИИ не ответил вовремя. Повторите запрос позже." }, 504, request);
  if (error instanceof AccessError) return json({ error: error.message }, 401, request);
  if (!(error instanceof Error)) return json({ error: "Некорректный запрос." }, 400, request);
  if (error.message === "Blackroute provider is missing its Worker secret") {
    return json({ error: "В Worker не найден секрет Blackroute API. Добавьте BLACKROUTE_API_KEY как Secret и сохраните настройки." }, 500, request);
  }
  if (error.message === "OpenAI provider is missing its Worker secret") {
    return json({ error: "В Worker не найден секрет OpenAI. Добавьте OPENAI_API_KEY как Secret." }, 500, request);
  }
  if (error.message === "Blackroute network request failed" || error.message === "OpenAI request failed") {
    return json({ error: "Worker не смог подключиться к API провайдера ИИ." }, 502, request);
  }
  // Ответ модели в неверном формате возвращается клиенту как текст, а не как 502:
  // вкладка «Совет» показывает его в диагностическом блоке.
  if (error instanceof AiResponseFormatError) return json({ advice: error.rawResponse, proposedMeal: null, proposedProducts: [] }, 200, request);
  if (error.message === "Blackroute model is not allowed") return json({ error: "Выбранная модель недоступна." }, 400, request);
  if (error.message.startsWith("AI provider") || error.message.startsWith("Blackroute provider")) {
    return json({ error: "Провайдер ИИ не настроен в Worker." }, 500, request);
  }
  if (error instanceof SyntaxError) return json({ error: "ИИ вернул ответ в неподходящем формате. Повторите запрос." }, 502, request);
  if (error.message.startsWith("Blackroute request failed")) {
    const status = error.message.match(/\((\d{3})/)?.[1];
    const message = status === "401" ? "Blackroute не принял ключ API. Проверьте секрет Worker."
      : status === "404" ? "Выбранная модель недоступна в Blackroute."
        : status === "429" ? "Лимит Blackroute исчерпан. Попробуйте позже."
          : "Blackroute временно не принял запрос. Попробуйте другую модель.";
    return json({ error: message }, 502, request);
  }
  if (error.message.startsWith("Blackroute returned")) {
    return json({ error: "Blackroute вернул неполный ответ. Повторите запрос или выберите другую модель." }, 502, request);
  }
  return json({ error: "Некорректный запрос." }, 400, request);
}

const FIREBASE_PROJECT_ID = "my-nutritionist-67ce8";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const textEncoder = new TextEncoder();
let firebaseJwks = { expiresAt: 0, keys: {} };

class AccessError extends Error {}

async function verifyFirebaseToken(authorization) {
  if (!authorization?.startsWith("Bearer ")) throw new AccessError("Войдите через Google, чтобы воспользоваться ИИ.");
  const [encodedHeader, encodedPayload, encodedSignature] = authorization.slice(7).split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new AccessError("Недействительный токен входа.");
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || claims.aud !== FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` || typeof claims.sub !== "string" || !claims.sub || claims.exp <= now || claims.iat > now || claims.auth_time > now) throw new AccessError("Недействительный токен входа.");
  const jwk = await getFirebaseJwk(header.kid);
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, base64UrlToBytes(encodedSignature), textEncoder.encode(`${encodedHeader}.${encodedPayload}`));
  if (!valid) throw new AccessError("Недействительный токен входа.");
  return claims;
}

async function getFirebaseJwk(kid) {
  if (Date.now() >= firebaseJwks.expiresAt || !firebaseJwks.keys[kid]) {
    const response = await fetch(FIREBASE_JWKS_URL, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new AccessError("Не удалось проверить вход.");
    const maxAge = Number((response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/)?.[1] || 300);
    const payload = await response.json();
    const keys = Object.fromEntries((payload.keys || []).filter(key => typeof key.kid === "string").map(key => [key.kid, key]));
    firebaseJwks = { keys, expiresAt: Date.now() + maxAge * 1000 };
  }
  if (!firebaseJwks.keys[kid]) throw new AccessError("Недействительный токен входа.");
  return firebaseJwks.keys[kid];
}

function decodeJwtPart(value) {
  try { return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))); }
  catch { throw new AccessError("Недействительный токен входа."); }
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
}

function json(body, status = 200, request) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
