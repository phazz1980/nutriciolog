import { instructionsFor, redactDiagnostic } from "./instructions.js";

const RETRY_INSTRUCTIONS = "\n\nКРИТИЧЕСКИ: предыдущий ответ не прошёл проверку. Верни ТОЛЬКО один валидный JSON-объект без Markdown, пояснений и блоков кода.";

export class AiResponseFormatError extends Error {
  constructor(rawResponse) {
    super("AI returned an invalid response format");
    this.name = "AiResponseFormatError";
    this.rawResponse = redactDiagnostic(rawResponse);
  }
}

function recoverAdvice(value) {
  const text = String(value ?? "");
  const start = text.match(/"advice"\s*:\s*"([\s\S]*)$/);
  if (!start) return "";
  const closed = start[1].match(/^([\s\S]*?)"\s*(?:,|\})/);
  return (closed ? closed[1] : start[1]).replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
}

export function createBlackrouteProvider(apiKey, model = "deepseek-v3.2-maas") {
  if (!apiKey) throw new Error("Blackroute provider is missing its Worker secret");
  const supportsVision = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.6-flash"]).has(model);
  const parseResult = (rawPayload, image) => {
    let data;
    try { data = JSON.parse(rawPayload); }
    catch { if (image) return { advice: redactDiagnostic(rawPayload), proposedMeal: null, proposedProducts: [] }; throw new AiResponseFormatError(rawPayload); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") { if (image) return { advice: redactDiagnostic(rawPayload), proposedMeal: null, proposedProducts: [] }; throw new AiResponseFormatError(rawPayload); }
    let result;
    try { result = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
    catch { const advice = recoverAdvice(content); if (advice) return { advice, proposedMeal: null, proposedProducts: [] }; if (image) return { advice: redactDiagnostic(content), proposedMeal: null, proposedProducts: [] }; throw new AiResponseFormatError(content); }
    if (typeof result?.advice !== "string") { if (image) return { advice: redactDiagnostic(content), proposedMeal: null, proposedProducts: [] }; throw new AiResponseFormatError(content); }
    const validMeal = result.proposedMeal && typeof result.proposedMeal === "object" && typeof result.proposedMeal.title === "string" && Number.isFinite(result.proposedMeal.calories) && typeof result.proposedMeal.mealType === "string";
    const validProducts = Array.isArray(result.proposedProducts) && result.proposedProducts.length <= 8 && result.proposedProducts.every(product => product && typeof product.title === "string" && [product.portion, product.calories, product.protein, product.fat, product.carbs].every(Number.isFinite));
    return { advice: result.advice, proposedMeal: validMeal ? result.proposedMeal : null, proposedProducts: validProducts ? result.proposedProducts : [] };
  };
  return {
    supportsVision,
    async advise(message, image = null, signal = undefined) {
      const requestAnswer = async retry => {
        let response;
        try {
          response = await fetch("https://blackroute.ironborn.cc/v1/chat/completions", {
            method: "POST",
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: `${instructionsFor(image)}${retry ? RETRY_INSTRUCTIONS : ""}` },
                { role: "user", content: image ? [{ type: "text", text: message }, { type: "image_url", image_url: { url: image.dataUrl } }] : message },
              ],
              temperature: 0.3,
              max_tokens: 1000,
              response_format: { type: "json_object" },
            }),
          });
        } catch (error) { if (signal?.aborted) throw signal.reason; throw new Error("Blackroute network request failed"); }
        if (!response.ok) {
          let code = "";
          try { const error = await response.json(); code = String(error?.error?.code || error?.error?.type || "").slice(0, 60); } catch {}
          throw new Error(`Blackroute request failed (${response.status}${code ? `:${code}` : ""})`);
        }
        return parseResult(await response.text(), image);
      };
      try { return await requestAnswer(false); }
      catch (firstError) {
        if (!(firstError instanceof AiResponseFormatError)) throw firstError;
        try { return await requestAnswer(true); }
        catch (retryError) {
          if (retryError instanceof AiResponseFormatError) throw new AiResponseFormatError(`Первая попытка:\n${firstError.rawResponse}\n\nПовторная попытка:\n${retryError.rawResponse}`);
          throw retryError;
        }
      }
    },
  };
}
