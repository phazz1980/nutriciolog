window.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
      .then(registration => registration?.update())
      .catch(() => { /* A failed update must not interrupt the app on a weak connection. */ });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem("my-nutritionist:pwa-reloaded")) return;
      sessionStorage.setItem("my-nutritionist:pwa-reloaded", "1");
      window.location.reload();
    });
  }
});
