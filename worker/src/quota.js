export class QuotaUnavailableError extends Error {
  constructor() { super("Учёт запросов ИИ временно недоступен. Попробуйте позже."); }
}

export class QuotaExceededError extends Error {
  constructor(quota) {
    super("Месячный лимит запросов ИИ исчерпан. Он обновится 1-го числа следующего месяца (UTC).");
    this.quota = quota;
  }
}

export function monthlyLimit(env) {
  const value = Number(env.AI_MONTHLY_REQUEST_LIMIT ?? 1000);
  if (!Number.isSafeInteger(value) || value < 1) throw new QuotaUnavailableError();
  return value;
}

export function quotaPeriod(now = new Date()) {
  return {
    period: now.toISOString().slice(0, 7),
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function snapshot(used, limit, month) {
  if (!Number.isSafeInteger(used) || used < 0) throw new QuotaUnavailableError();
  return { unit: "requests", limit, used, remaining: Math.max(0, limit - used), ...month };
}

// Only a server-provided store is accepted. No in-memory/localStorage fallback.
export async function userQuota(env, uid, consume = false, now = new Date()) {
  const limit = monthlyLimit(env);
  const month = quotaPeriod(now);
  const store = env.AI_QUOTA_STORE;
  if (!store?.read || !store?.consume) throw new QuotaUnavailableError();
  try {
    if (!consume) return snapshot(await store.read(uid, month.period), limit, month);
    const used = await store.consume(uid, month.period, limit);
    if (used === null) {
      const quota = snapshot(await store.read(uid, month.period), limit, month);
      throw new QuotaExceededError(quota);
    }
    return snapshot(used, limit, month);
  } catch (error) {
    if (error instanceof QuotaExceededError) throw error;
    // Never expose database responses, credentials or identifiers to the client.
    throw new QuotaUnavailableError();
  }
}
