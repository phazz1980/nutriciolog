import { getProvider } from "./providers/index.js";

const cors = {
  "Access-Control-Allow-Origin": "https://nutriciolog.pages.dev",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method === "GET" && new URL(request.url).pathname === "/api/health") {
      return json({ status: "ok", version: "0.1.11", provider: env.AI_PROVIDER || null, model: env.BLACKROUTE_MODEL || null, apiKeyConfigured: Boolean(env.BLACKROUTE_API_KEY) });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      await verifyFirebaseToken(request.headers.get("Authorization"));
      const { message, image = null, model = null } = await request.json();
      if (typeof message !== "string" || !message.trim() || message.length > 1000) {
        return json({ error: "Введите вопрос до 1000 символов." }, 400);
      }
      if (model !== null && typeof model !== "string") return json({ error: "Недопустимая модель." }, 400);
      if (image && (!/^image\/(jpeg|png|webp)$/.test(image.mimeType || "") || typeof image.dataUrl !== "string" || image.dataUrl.length > 5_600_000)) return json({ error: "Недопустимое фото. Используйте JPEG, PNG или WebP до 4 МБ." }, 400);
      const provider = getProvider(env, model);
      if (image && !provider.supportsVision) return json({ advice: "Этот ИИ пока не умеет анализировать фото. Опишите, пожалуйста, блюдо и примерную порцию текстом.", proposedMeal: null });
      const result = await provider.advise(message.trim(), image);
      return json(result);
    } catch (error) {
      if (error instanceof AccessError) return json({ error: error.message }, 401);
      if (error instanceof Error && error.message === "Blackroute provider is missing its Worker secret") return json({ error: "В Worker не найден секрет Blackroute API. Добавьте BLACKROUTE_API_KEY как Secret и сохраните настройки." }, 500);
      if (error instanceof Error && error.message === "Blackroute network request failed") return json({ error: "Worker не смог подключиться к API Blackroute." }, 502);
      if (error instanceof SyntaxError) return json({ error: "ИИ вернул ответ в неподходящем формате. Повторите запрос." }, 502);
      if (error instanceof Error && error.message.startsWith("Blackroute request failed")) {
        const status = error.message.match(/\((\d{3})/)?.[1];
        const message = status === "401" ? "Blackroute не принял ключ API. Проверьте секрет Worker." : status === "404" ? "Выбранная модель недоступна в Blackroute." : status === "429" ? "Лимит Blackroute исчерпан. Попробуйте позже." : "Blackroute временно не принял запрос. Попробуйте другую модель.";
        return json({ error: message }, 502);
      }
      if (error instanceof Error && error.message.startsWith("Blackroute returned")) return json({ error: "Blackroute вернул неполный ответ. Повторите запрос или выберите другую модель." }, 502);
      return json({ error: "Некорректный запрос." }, 400);
    }
  },
};

const FIREBASE_PROJECT_ID = "my-nutritionist-67ce8";
const FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const textEncoder = new TextEncoder();
let firebaseCerts = { expiresAt: 0, keys: {} };

class AccessError extends Error {}

async function verifyFirebaseToken(authorization) {
  if (!authorization?.startsWith("Bearer ")) throw new AccessError("Войдите через Google, чтобы воспользоваться ИИ.");
  const [encodedHeader, encodedPayload, encodedSignature] = authorization.slice(7).split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new AccessError("Недействительный токен входа.");
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || claims.aud !== FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` || typeof claims.sub !== "string" || !claims.sub || claims.exp <= now || claims.iat > now || claims.auth_time > now) throw new AccessError("Недействительный токен входа.");
  const certificate = await getFirebaseCertificate(header.kid);
  const publicKey = await crypto.subtle.importKey("spki", pemToBytes(certificate), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, base64UrlToBytes(encodedSignature), textEncoder.encode(`${encodedHeader}.${encodedPayload}`));
  if (!valid) throw new AccessError("Недействительный токен входа.");
  return claims;
}

async function getFirebaseCertificate(kid) {
  if (Date.now() >= firebaseCerts.expiresAt || !firebaseCerts.keys[kid]) {
    const response = await fetch(FIREBASE_CERTS_URL);
    if (!response.ok) throw new AccessError("Не удалось проверить вход.");
    const maxAge = Number((response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/)?.[1] || 300);
    firebaseCerts = { keys: await response.json(), expiresAt: Date.now() + maxAge * 1000 };
  }
  if (!firebaseCerts.keys[kid]) throw new AccessError("Недействительный токен входа.");
  return firebaseCerts.keys[kid];
}

function decodeJwtPart(value) {
  try { return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))); }
  catch { throw new AccessError("Недействительный токен входа."); }
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
}

function pemToBytes(pem) {
  return base64UrlToBytes(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
