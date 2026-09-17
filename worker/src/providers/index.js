import { createOpenAIProvider } from "./openai.js";
import { createBlackrouteProvider } from "./blackroute.js";

// Every provider must expose supportsVision and advise(message, image?) and return exactly:
// { advice: string, proposedMeal: null | { title: string, calories: number, mealType: string } }
const blackrouteModels = new Set(["deepseek", "gemini", "grok", "qwen", "gpt-oss"]);

export function getProvider(env, requestedModel = null) {
  const provider = env.AI_PROVIDER || "openai";
  if (provider === "openai") return createOpenAIProvider(env.OPENAI_API_KEY);
  if (provider === "blackroute") {
    const model = requestedModel || env.BLACKROUTE_MODEL || "deepseek";
    if (!blackrouteModels.has(model)) throw new Error("Blackroute model is not allowed");
    return createBlackrouteProvider(env.BLACKROUTE_API_KEY, model);
  }
  // Future adapters (for example Gigachat or YandexGPT) belong here. Their keys stay Worker secrets.
  throw new Error(`AI provider '${provider}' is not configured`);
}
