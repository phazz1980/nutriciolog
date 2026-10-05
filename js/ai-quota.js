import { quotaState, refreshQuota, onAiStateChange } from "./ai-client.js";
import { getAuthStatus } from "./storage.js";

export function initAiQuota() {
  const status = document.getElementById("aiQuotaStatus");
  const detail = document.getElementById("aiQuotaDetail");
  const button = document.getElementById("refreshAiQuotaButton");
  const render = () => {
    const auth = getAuthStatus();
    const { quota, error, loading } = quotaState();
    button.disabled = !auth?.signedIn || loading;
    if (!auth?.signedIn) {
      status.textContent = "Войдите, чтобы увидеть остаток запросов.";
      detail.textContent = "Лимит общий для всех ваших устройств.";
    } else if (quota) {
      status.textContent = `Осталось ${quota.remaining.toLocaleString("ru-RU")} из ${quota.limit.toLocaleString("ru-RU")} запросов`;
      const date = new Date(quota.resetsAt).toLocaleDateString("ru-RU", { timeZone: "UTC" });
      detail.textContent = error || `Использовано: ${quota.used.toLocaleString("ru-RU")}. Обновление ${date} в 00:00 UTC. Текст, расчёт и фото — по 1 запросу; попытка учитывается и при ошибке ИИ.`;
    } else {
      status.textContent = loading ? "Загружаем остаток запросов…" : error || "Остаток пока неизвестен.";
      detail.textContent = "Лимит общий для всех ваших устройств.";
    }
  };
  button.onclick = refreshQuota;
  onAiStateChange(render);
  for (const event of ["nutrition-auth-changed", "nutritionstore-ready", "online"]) {
    window.addEventListener(event, () => { render(); void refreshQuota(); });
  }
  document.querySelectorAll('[data-nav="profile"]').forEach(button => button.addEventListener("click", refreshQuota));
  render();
  void refreshQuota();
}
