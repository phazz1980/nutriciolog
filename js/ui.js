import { safeNumber } from "./core.js";

export function toast(message) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = String(message ?? "");
  element.classList.add("show");
  window.clearTimeout(element.hideTimer);
  element.hideTimer = window.setTimeout(() => element.classList.remove("show"), 2200);
}

export function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

export function showScreen(id) {
  for (const screen of document.querySelectorAll(".screen")) screen.classList.remove("active");
  document.getElementById(id)?.classList.add("active");
  for (const nav of document.querySelectorAll(".nav")) nav.classList.toggle("active", nav.dataset.nav === id);
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  modal.classList.add("show");
  const focusable = modal.querySelector("input,select,button.primary");
  focusable?.focus();
  return modal;
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("show");
}

// Диалог с переданной разметкой: возвращает узел и умеет закрываться по Escape,
// возвращая фокус туда, где он был до открытия. onClose вызывается при закрытии.
export function openDialog({ id, className = "modal show", html, labelledBy, onClose }) {
  const existing = id ? document.getElementById(id) : null;
  if (existing) existing.remove();
  const dialog = document.createElement("div");
  if (id) dialog.id = id;
  dialog.className = className;
  dialog.innerHTML = html;
  const sheet = dialog.querySelector(".sheet");
  sheet?.setAttribute("role", "dialog");
  sheet?.setAttribute("aria-modal", "true");
  if (labelledBy) sheet?.setAttribute("aria-labelledby", labelledBy);
  const previousFocus = document.activeElement;
  const close = () => {
    dialog.remove();
    onClose?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not(:disabled),input,select")].filter(element => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(dialog);
  return { dialog, close };
}

// Раскрываемый блок с «сырым» ответом ИИ для диагностики формата.
export function showAiDiagnostic(anchor, containerId, rawResponse) {
  if (!anchor || typeof rawResponse !== "string" || !rawResponse) return;
  let panel = document.getElementById(containerId);
  if (!panel) {
    panel = document.createElement("details");
    panel.id = containerId;
    panel.className = "ai-response-diagnostic";
    const summary = document.createElement("summary");
    summary.textContent = "Показать ответ ИИ для диагностики";
    const content = document.createElement("pre");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "link";
    copy.textContent = "Скопировать";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(content.textContent);
        copy.textContent = "Скопировано";
      } catch {
        copy.textContent = "Не удалось скопировать";
      }
    };
    panel.append(summary, content, copy);
    anchor.after(panel);
  }
  panel.querySelector("pre").textContent = rawResponse;
  panel.open = true;
}

export function removeAiDiagnostic(containerId) {
  document.getElementById(containerId)?.remove();
}

export function setAiDebug(text) {
  const panel = document.getElementById("aiDebug");
  if (!panel) return;
  panel.textContent = `Отладка: ${text}`;
  panel.style.display = "block";
}

export function clearAiDebug() {
  const panel = document.getElementById("aiDebug");
  if (!panel) return;
  panel.textContent = "";
  panel.style.display = "none";
}

export function showCalculationResult({ title, portionLabel, calories, protein, fat, carbs, error }) {
  const heading = error ? "Не удалось рассчитать" : "Расчёт ИИ";
  const message = error ? error : `${title} · ${portionLabel}`;
  const values = error ? "" : `<p class="hello">${Math.round(calories).toLocaleString("ru-RU")} ккал · Б ${formatMacro(protein)} г · Ж ${formatMacro(fat)} г · У ${formatMacro(carbs)} г</p>`;
  const { dialog } = openDialog({
    id: "aiCalculationResult",
    html: `<section class="sheet"><h2></h2><p class="hello"></p>${values}<button class="primary" type="button">Понятно</button></section>`,
  });
  dialog.querySelector("h2").textContent = heading;
  dialog.querySelector("p").textContent = message;
  const close = dialog.querySelector(".primary");
  close.onclick = () => dialog.remove();
  close.focus();
}

function formatMacro(value) {
  return safeNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}
