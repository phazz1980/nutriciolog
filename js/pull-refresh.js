// Refresh data, not the WebView: meal drafts and local state remain intact.
export function initPullRefresh({ refresh, onResult = () => {}, doc = document, win = window }) {
  if (win.Capacitor?.getPlatform?.() !== 'android') return () => {};
  const indicator = doc.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.hidden = true;
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  doc.body.append(indicator);
  let start = null, distance = 0, busy = false;
  const top = () => (win.scrollY || doc.scrollingElement?.scrollTop || 0) <= 0;
  const reset = () => { start = null; distance = 0; if (!busy) indicator.hidden = true; };
  const begin = event => {
    if (busy || !top() || event.touches.length !== 1 || doc.querySelector('.modal.show, dialog[open]') || event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const move = event => {
    if (!start) return;
    if (!top() || event.touches.length !== 1) { reset(); return; }
    const dy = event.touches[0].clientY - start.y;
    const dx = Math.abs(event.touches[0].clientX - start.x);
    if (dy <= 0 || dx > Math.max(20, dy)) { reset(); return; }
    if (dy < 12) return;
    if (event.cancelable) event.preventDefault();
    distance = Math.min(160, dy);
    indicator.hidden = false;
    indicator.textContent = distance >= 120 ? 'Отпустите, чтобы обновить' : 'Потяните вниз для обновления';
    indicator.style.transform = `translate(-50%, ${Math.min(70, distance / 2)}px)`;
  };
  const end = async () => {
    if (!start || distance < 120 || busy) { reset(); return; }
    busy = true; start = null;
    indicator.textContent = 'Обновляем…';
    try { await refresh(); onResult(null); }
    catch (error) { onResult(error); }
    finally { busy = false; reset(); }
  };
  doc.addEventListener('touchstart', begin, { passive: true });
  doc.addEventListener('touchmove', move, { passive: false });
  doc.addEventListener('touchend', end, { passive: true });
  doc.addEventListener('touchcancel', reset, { passive: true });
  return () => {
    for (const [type, handler] of [['touchstart',begin],['touchmove',move],['touchend',end],['touchcancel',reset]]) doc.removeEventListener(type, handler);
    indicator.remove();
  };
}
