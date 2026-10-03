import { availability, onAiStateChange } from "./ai-client.js";

// Подсказка о доступности ИИ. inlineHint — узел внутри строки с полем ввода:
// там текст выводится своей строкой под полем, не перекрывая плейсхолдер.
function setHint(anchor, id, reason, { inlineHint = false } = {}) {
  if (!anchor) return;
  let hint = document.getElementById(id);
  if (!hint) {
    hint = document.createElement("p");
    hint.id = id;
    hint.className = reason && inlineHint ? "status ai-status-inline" : "status";
    anchor.after(hint);
  }
  hint.classList.toggle("ai-status-inline", Boolean(reason) && inlineHint);
  hint.textContent = reason;
  hint.hidden = !reason;
}

// Кнопки ИИ приглушаются, когда запрос невозможен, и рядом показывается причина.
export function initAiAvailability() {
  const render = () => {
    const { reason, busy } = availability();
    const buttons = [
      document.getElementById("calculateMealButton"),
      document.querySelector("#assistant .send"),
      document.getElementById("manualPhotoButton"),
    ];
    for (const button of buttons) {
      if (!button) continue;
      button.dataset.readyTitle ??= button.title;
      button.classList.toggle("ai-unavailable", Boolean(reason) || busy);
      button.title = reason || button.dataset.readyTitle || "";
    }
    const send = document.querySelector("#assistant .send");
    if (send) send.disabled = busy;

    setHint(document.querySelector("#assistant .ask"), "aiAvailabilityStatus", reason);
    setHint(document.querySelector(".meal-name-control"), "aiMealAvailabilityStatus", reason, { inlineHint: true });
  };
  onAiStateChange(render);
  window.addEventListener("nutrition-auth-changed", render);
  window.addEventListener("nutritionstore-ready", render);
  window.addEventListener("online", render);
  render();
  // Экспорт для диагностики и тестов.
  window.renderAiAvailability = render;
}
