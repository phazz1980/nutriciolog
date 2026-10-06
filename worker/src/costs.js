// User-supplied estimates, 2026-10-06. Integer nanodollars per token.
export const TOKEN_RATES = Object.freeze({
  'deepseek-v3.2-maas': [270, 1100],
  'gemini-2.5-flash': [1250, 10000],
});

export function estimateUsage(model, usage) {
  const rates = TOKEN_RATES[model];
  const input = usage?.prompt_tokens, output = usage?.completion_tokens;
  if (!rates || ![input, output].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000)) return null;
  return input * rates[0] + output * rates[1];
}

export function costPeriods(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const monday = new Date(`${day}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return { day, week: monday.toISOString().slice(0, 10), month: `${day.slice(0, 7)}-01` };
}

export async function readCosts(env, uid, now = new Date()) {
  const store = env.AI_QUOTA_STORE;
  if (!store?.readCosts) return { status: 'unavailable' };
  try {
    const periods = costPeriods(now);
    const rows = await store.readCosts(uid, Object.values(periods).sort()[0], periods.day);
    const totals = {};
    for (const [name, start] of Object.entries(periods)) {
      const selected = rows.filter(row => row.day >= start && row.day <= periods.day);
      const nanoUsd = selected.reduce((sum, row) => sum + row.nanoUsd, 0);
      if (!Number.isSafeInteger(nanoUsd)) throw new Error('Invalid cost total');
      totals[name] = { start, end: periods.day, nanoUsd, requests: selected.length,
        unknown: selected.reduce((sum, row) => sum + row.unknown, 0) };
    }
    return { status: 'ok', currency: 'USD', source: 'user-rates-2026-10-06', timeZone: 'UTC', totals };
  } catch { return { status: 'unavailable' }; }
}
