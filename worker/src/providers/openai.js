const instructions = `Ты помощник по общим вопросам питания. Отвечай по-русски, кратко и доброжелательно. Давай только общие wellness-рекомендации: не диагностируй, не назначай лечение, лекарства или лечебные диеты. При симптомах, беременности, хронических болезнях, расстройствах пищевого поведения или запросах о лечении — рекомендуй обратиться к врачу или квалифицированному специалисту. Верни JSON с полями advice и proposedMeal. proposedMeal должен быть null, кроме явной просьбы добавить/запланировать еду. Тогда предложи только одно блюдо с title, calories и mealType (Завтрак, Обед, Ужин или Перекус). Никогда не утверждай, что что-либо сохранено: пользователь должен подтвердить это в приложении.`;

const schema = { type: "object", properties: { advice: { type: "string" }, proposedMeal: { anyOf: [{ type: "null" }, { type: "object", properties: { title: { type: "string" }, calories: { type: "number" }, mealType: { type: "string", enum: ["Завтрак", "Обед", "Ужин", "Перекус"] } }, required: ["title", "calories", "mealType"], additionalProperties: false }] } }, required: ["advice", "proposedMeal"], additionalProperties: false };

export function createOpenAIProvider(apiKey) {
  if (!apiKey) throw new Error("OpenAI provider is missing its Worker secret");
  return { supportsVision: true, async advise(message, image = null) {
    const input = image ? [{ role: "user", content: [{ type: "input_text", text: message }, { type: "input_image", image_url: image.dataUrl }] }] : message;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4.1-mini", instructions, input, max_output_tokens: 300, text: { format: { type: "json_schema", name: "nutrition_advice", strict: true, schema } } }) });
    if (!response.ok) throw new Error("OpenAI request failed");
    const data = await response.json();
    return JSON.parse(data.output_text || '{"advice":"Не удалось сформировать ответ.","proposedMeal":null}');
  }};
}
