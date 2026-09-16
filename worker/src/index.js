import { getProvider } from "./providers/index.js";

const cors = {
  "Access-Control-Allow-Origin": "https://YOUR_GITHUB_USERNAME.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const { message, image = null } = await request.json();
      if (typeof message !== "string" || !message.trim() || message.length > 1000) {
        return json({ error: "Введите вопрос до 1000 символов." }, 400);
      }
      if (image && (!/^image\/(jpeg|png|webp)$/.test(image.mimeType || "") || typeof image.dataUrl !== "string" || image.dataUrl.length > 5_600_000)) return json({ error: "Недопустимое фото. Используйте JPEG, PNG или WebP до 4 МБ." }, 400);
      const provider = getProvider(env);
      if (image && !provider.supportsVision) return json({ advice: "Этот ИИ пока не умеет анализировать фото. Опишите, пожалуйста, блюдо и примерную порцию текстом.", proposedMeal: null });
      const result = await provider.advise(message.trim(), image);
      return json(result);
    } catch {
      return json({ error: "Некорректный запрос." }, 400);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
