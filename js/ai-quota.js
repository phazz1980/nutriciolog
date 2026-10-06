import { quotaState, refreshQuota, onAiStateChange } from "./ai-client.js";
import { getAuthStatus } from "./storage.js";

export function initAiQuota() {
  const status = document.getElementById("aiQuotaStatus");
  const detail = document.getElementById("aiQuotaDetail");
  const button = document.getElementById("refreshAiQuotaButton");
  const costPanel = document.createElement('div');
  costPanel.className = 'ai-costs';
  costPanel.id = 'aiCosts';
  detail.after(costPanel);
  const render = () => {
    const auth = getAuthStatus();
    const { quota, costs, error, loading } = quotaState();
    costPanel.replaceChildren();
    if (auth?.signedIn) {
      const heading = document.createElement('h3');
      heading.textContent = 'Расходы ИИ · оценка';
      costPanel.append(heading);
      const valid = costs?.status === 'ok' && costs.currency === 'USD' && ['day', 'week', 'month'].every(period => {
        const value = costs.totals?.[period];
        return value && [value.nanoUsd, value.requests, value.unknown].every(n => Number.isSafeInteger(n) && n >= 0);
      });
      if (valid) {
        const grid = document.createElement('div');
        grid.className = 'ai-costs-grid';
        for (const [period, label] of [['day', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц']]) {
          const value = costs.totals[period], cell = document.createElement('div');
          const title = document.createElement('small'), amount = document.createElement('b');
          title.textContent = label;
          amount.textContent = value.requests ? `$${(value.nanoUsd / 1e9).toFixed(6)}${value.unknown ? ' *' : ''}` : 'Нет данных';
          if (value.unknown && value.nanoUsd === 0) amount.textContent = 'Неизвестно *';
          cell.append(title, amount); grid.append(cell);
        }
        const note = document.createElement('small');
        note.textContent = 'USD · по заданным тарифам от 06.10.2026. День и месяц по UTC, неделя с понедельника. Только запросы после включения учёта; прошлые расходы не восстановлены.';
        if (Object.values(costs.totals).some(value => value.unknown)) note.textContent += ' * Сумма неполная: часть запросов без данных о токенах или ещё обрабатывается.';
        costPanel.append(grid, note);
      } else {
        const note = document.createElement('small');
        note.textContent = loading ? 'Загружаем расходы…' : 'Учёт расходов пока недоступен.';
        costPanel.append(note);
      }
    }
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
