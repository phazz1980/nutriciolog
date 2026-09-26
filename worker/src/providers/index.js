import { createOpenAIProvider } from "./openai.js";
import { createBlackrouteProvider } from "./blackroute.js";

// Every provider must expose supportsVision and advise(message, image?) and return exactly:
// { advice: string, proposedMeal: null | { title: string, calories: number, mealType: string }, proposedProducts: [] }
const blackrouteModels = new Set([
  "deepseek-v3.2-maas",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "grok-4.20-non-reasoning",
  "gpt-oss-120b-maas",
  "qwen3-235b-a22b-instruct-2507-maas",
]);

export function getProvider(env, requestedModel = null, image = null) {
  const provider = env.AI_PROVIDER || "openai";
  if (provider === "openai") return createOpenAIProvider(env.OPENAI_API_KEY);
  if (provider === "blackroute") {
    const model = requestedModel || (image ? env.BLACKROUTE_VISION_MODEL : env.BLACKROUTE_MODEL) || "deepseek-v3.2-maas";
    if (!blackrouteModels.has(model)) throw new Error("Blackroute model is not allowed");
    return createBlackrouteProvider(env.BLACKROUTE_API_KEY, model);
  }
  // Future adapters (for example Gigachat or YandexGPT) belong here. Their keys stay Worker secrets.
  throw new Error(`AI provider '${provider}' is not configured`);
}
