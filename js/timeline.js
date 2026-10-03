import { AI_TIMEOUT_MS } from "./core.js";

// Таймлайн этапов запроса к ИИ внутри формы добавления блюда.
export function createMealTimeline(kind) {
  const form = document.querySelector("#modal form");
  if (!form) return null;
  let element = document.getElementById("mealAiTimeline");
  if (!element) {
    element = document.createElement("section");
    element.id = "mealAiTimeline";
    element.className = "meal-ai-timeline";
    element.hidden = true;
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.innerHTML = '<div class="meal-ai-timeline-head"><b></b><span></span></div><div class="meal-ai-progress"><i></i></div><ol><li>Отправка</li><li>Анализ</li><li>Результат</li></ol>';
    const anchor = document.getElementById("nutritionPrecisionHint") || document.getElementById("calculateMealButton");
    if (anchor) anchor.before(element);
    else form.prepend(element);
  }

  const title = element.querySelector("b");
  const time = element.querySelector("span");
  const bar = element.querySelector("i");
  const steps = [...element.querySelectorAll("li")];
  const started = Date.now();
  let timer = null;

  const render = () => {
    const elapsed = Math.min(Date.now() - started, AI_TIMEOUT_MS);
    const progress = Math.min(elapsed / AI_TIMEOUT_MS, 1);
    const stage = progress < 0.15 ? 0 : progress < 0.65 ? 1 : 2;
    const remaining = Math.max(0, Math.ceil((AI_TIMEOUT_MS - elapsed) / 1000));
    bar.style.setProperty("--ai-progress", `${progress * 100}%`);
    time.textContent = remaining ? `Ожидание ответа · ${remaining} с` : "Ожидание ответа…";
    steps.forEach((step, index) => step.classList.toggle("is-current", index === stage));
  };

  return {
    start() {
      window.clearInterval(timer);
      element.hidden = false;
      element.classList.add("is-active");
      title.textContent = kind === "photo" ? "Распознаём блюдо на фото…" : "Рассчитываем калории и БЖУ…";
      render();
      timer = window.setInterval(render, 250);
    },
    finish() {
      window.clearInterval(timer);
      timer = null;
      element.classList.remove("is-active");
      element.hidden = true;
    },
  };
}
