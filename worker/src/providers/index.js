import { createOpenAIProvider } from "./openai.js";

// Every provider must expose supportsVision and advise(message, image?) and return exactly:
// { advice: string, proposedMeal: null | { title: string, calories: number, mealType: string } }
export function getProvider(env) {
  const provider = env.AI_PROVIDER || "openai";
  if (provider === "openai") return createOpenAIProvider(env.OPENAI_API_KEY);
  // Future adapters (for example Gigachat or YandexGPT) belong here. Their keys stay Worker secrets.
  throw new Error(`AI provider '${provider}' is not configured`);
}
