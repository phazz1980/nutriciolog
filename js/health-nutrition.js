// Durable device-local outbox. No tokens, photos, or unconfirmed AI proposals.
export function nutritionPayload(entry, today) {
  if (!entry?.id || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null;
  const date = new Date(`${entry.date}T12:00:00`);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(entry.date.slice(0, 4)) || date.getMonth() + 1 !== Number(entry.date.slice(5, 7)) || date.getDate() !== Number(entry.date.slice(8))) return null;
  const values = ['calories', 'protein', 'fat', 'carbs'].map(key => Number(entry[key] ?? 0));
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100000)) return null;
  return { id: String(entry.id), date: entry.date, title: String(entry.title || 'Приём пищи').slice(0, 200), mealType: String(entry.mealType || ''), calories: values[0], protein: values[1], fat: values[2], carbs: values[3] };
}

export function createNutritionSync({ storage, owner, plugin, today, changed = () => {} }) {
  let running = null;
  let message = '';
  const key = uid => `my-nutritionist:health-nutrition:${uid || 'guest'}`;
  const read = uid => {
    const value = JSON.parse(storage.getItem(key(uid)) || '{}');
    return { enabled: value.enabled === true, seq: Number(value.seq) || 0, queue: value.queue || {} };
  };
  const write = (uid, state) => storage.setItem(key(uid), JSON.stringify(state));
  function status() {
    try { const state = read(owner()); return { enabled: state.enabled, pending: Object.keys(state.queue).length, message }; }
    catch { return { enabled: false, pending: 0, message: 'Не удалось открыть очередь передачи питания.' }; }
  }
  function enqueue({ owner: uid, entry, id, deleted = false }) {
    try {
      const state = read(uid);
      if (!state.enabled) return;
      const payload = deleted ? null : nutritionPayload(entry, today());
      if (!deleted && !payload) { message = 'Блюдо сохранено, но его данные не подходят для Health Connect.'; changed(); return; }
      const recordId = String(deleted ? id : payload.id);
      if (!recordId) return;
      state.seq = Math.max(Date.now(), state.seq + 1);
      state.queue[recordId] = { id: recordId, version: state.seq, deleted, entry: payload };
      write(uid, state);
      message = '';
      changed();
      if (uid === owner()) void flush();
    } catch { message = 'Блюдо сохранено, но очередь Health Connect недоступна.'; changed(); }
  }
  function setEnabled(enabled) {
    const uid = owner();
    const state = read(uid);
    state.enabled = enabled;
    // Disabling cancels pending exports; already exported meals stay in Health Connect.
    if (!enabled) state.queue = {};
    write(uid, state);
    message = '';
    changed();
  }
  async function flush() {
    if (running) return running;
    running = (async () => {
      const uid = owner();
      try {
        if (!read(uid).enabled || !plugin()) return;
        const status = await plugin().getStatus();
        if (owner() !== uid || !read(uid).enabled) return;
        if (!status.nutritionGranted) { message = 'Разрешите запись питания в Health Connect. Изменения ждут отправки.'; return; }
        for (;;) {
          if (owner() !== uid || !read(uid).enabled) return;
          const state = read(uid);
          const operation = Object.values(state.queue).find(item => item.deleted || item.entry.date <= today());
          if (!operation) { message = 'Питание синхронизировано. Записи на завтра будут переданы в день приёма пищи.'; return; }
          await plugin().writeNutrition({ owner: uid || 'guest', ...operation });
          const latest = read(uid);
          if (latest.queue[operation.id]?.version === operation.version) {
            delete latest.queue[operation.id];
            write(uid, latest);
          }
        }
      } catch { message = 'Питание сохранено в дневнике. Передача повторится при следующем обновлении Health Connect.'; }
      finally { changed(); }
    })().finally(() => { running = null; });
    return running;
  }
  return { enqueue, setEnabled, flush, status };
}
