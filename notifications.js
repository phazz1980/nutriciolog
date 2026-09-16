const reminderDefaults = { water: true, meals: true, weight: false };
const reminderState = { ...reminderDefaults, ...JSON.parse(localStorage.getItem("my-nutritionist:reminders") || "{}") };

window.addEventListener("DOMContentLoaded", renderNotificationSettings);

function renderNotificationSettings() {
  const host = document.getElementById("profile");
  if (!host || document.getElementById("notificationSettings")) return;
  const card = document.createElement("section");
  card.id = "notificationSettings";
  card.className = "card";
  card.innerHTML = `<b>Напоминания</b><p class="hello" id="notificationStatus">Уведомления включаются только после вашего разрешения. Поддержка зависит от браузера и платформы.</p>${toggle("water","Вода",reminderState.water)}${toggle("meals","Приёмы пищи",reminderState.meals)}${toggle("weight","Вечерняя отметка веса",reminderState.weight)}<button class="secondary" id="enableNotifications" type="button">Разрешить уведомления</button>`;
  host.append(card);
  card.querySelectorAll("input").forEach(input => input.onchange = () => { reminderState[input.dataset.kind] = input.checked; localStorage.setItem("my-nutritionist:reminders", JSON.stringify(reminderState)); });
  card.querySelector("#enableNotifications").onclick = enableNotifications;
}

function toggle(kind, label, checked) { return `<label class="setting"><span>${label}</span><input type="checkbox" data-kind="${kind}" ${checked ? "checked" : ""}></label>`; }

async function enableNotifications() {
  const status = document.getElementById("notificationStatus");
  if (!("Notification" in window)) { status.textContent = "Этот браузер не поддерживает уведомления."; return; }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") { status.textContent = "Разрешение не получено. Его можно изменить в настройках браузера."; return; }
  status.textContent = "Локальные напоминания включены. Они надёжнее всего работают, пока приложение открыто.";
  scheduleLocalReminder();
}

function scheduleLocalReminder() {
  clearTimeout(window.__nutritionReminderTimer);
  window.__nutritionReminderTimer = setTimeout(async () => {
    const registration = await navigator.serviceWorker?.ready;
    const body = reminderState.water ? "Не забудьте выпить воды." : reminderState.meals ? "Проверьте план питания на сегодня." : "Можно внести вечерний вес.";
    if (registration) registration.showNotification("Мой нутрициолог", { body, icon: "./icons/app-icon.svg" });
    else new Notification("Мой нутрициолог", { body });
  }, 60 * 60 * 1000);
}
