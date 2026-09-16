let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderInstallAction();
});

window.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
  renderInstallAction();
});

function renderInstallAction() {
  if (matchMedia("(display-mode: standalone)").matches || document.getElementById("installAction")) return;
  const host = document.getElementById("profile");
  if (!host) return;
  const card = document.createElement("section");
  card.id = "installAction";
  card.className = "card";
  card.innerHTML = `<b>Установить приложение</b><p class="hello">Добавьте приложение на главный экран. Гостевые данные и основные экраны доступны офлайн; синхронизация и ИИ требуют интернет.</p><button class="secondary" type="button">${deferredInstallPrompt ? "Установить" : "Как установить"}</button><p class="hello" hidden>В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</p>`;
  const button = card.querySelector("button");
  const help = card.querySelector("p[hidden]");
  button.onclick = async () => {
    if (!deferredInstallPrompt) { help.hidden = false; return; }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.textContent = "Как установить";
  };
  host.append(card);
}
