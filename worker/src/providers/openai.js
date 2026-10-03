import { instructionsFor } from "./instructions.js";

const product = { type: "object", properties: { title: { type: "string" }, portion: { type: "number" }, calories: { type: "number" }, protein: { type: "number" }, fat: { type: "number" }, carbs: { type: "number" }, mealType: { type: "string", enum: ["Завтрак", "Обед", "Ужин", "Перекус"] } }, required: ["title", "portion", "calories", "protein", "fat", "carbs", "mealType"], additionalProperties: false };
const schema = { type: "object", properties: { advice: { type: "string" }, proposedMeal: { anyOf: [{ type: "null" }, { type: "object", properties: { title: { type: "string" }, calories: { type: "number" }, mealType: { type: "string", enum: ["Завтрак", "Обед", "Ужин", "Перекус"] } }, required: ["title", "calories", "mealType"], additionalProperties: false }] }, proposedProducts: { type: "array", maxItems: 8, items: product } }, required: ["advice", "proposedMeal", "proposedProducts"], additionalProperties: false };

const FALLBACK = '{"advice":"Не удалось сформировать ответ.","proposedMeal":null,"proposedProducts":[]}';

export function createOpenAIProvider(apiKey) {
  if (!apiKey) throw new Error("OpenAI provider is missing its Worker secret");
  return {
    supportsVision: true,
    async advise(message, image = null) {
      const input = image
        ? [{ role: "user", content: [{ type: "input_text", text: message }, { type: "input_image", image_url: image.dataUrl }] }]
        : message;
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions: instructionsFor(image),
          input,
          max_output_tokens: 300,
          text: { format: { type: "json_schema", name: "nutrition_advice", strict: true, schema } },
        }),
      });
      if (!response.ok) throw new Error("OpenAI request failed");
      const data = await response.json();
      try {
        return JSON.parse(data.output_text || FALLBACK);
      } catch {
        throw new Error("OpenAI returned an invalid response format");
      }
    },
  };
}
