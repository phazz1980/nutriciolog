// System bars are native-only; the browser keeps the normal web theme.
const appearance = window.Capacitor?.getPlatform?.() === 'android'
  ? window.Capacitor.Plugins?.NutritionAppearance : null;

if (appearance?.setTheme) {
  const sync = () => {
    Promise.resolve(appearance.setTheme({
      dark: document.documentElement.dataset.theme === 'dark'
    })).catch(() => { /* Optional native appearance must not block the UI. */ });
  };
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme']
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  sync();
}
