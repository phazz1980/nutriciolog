// Persistent monthly token quota. The YDB transport is injected so quota
// accounting stays testable and the HTTP handler never receives credentials.
const DEFAULT_LIMIT = 100000;
const RESERVATION = 1000;
export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);
export class QuotaExceededError extends Error {}
export function quotaConfig(env) {
  const limit = Number(env.MONTHLY_TOKEN_LIMIT || DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit < RESERVATION) throw new Error("Invalid MONTHLY_TOKEN_LIMIT");
  return { limit, reservation: RESERVATION };
}
export async function reserveQuota(store, uid, env, date) {
  const { limit, reservation } = quotaConfig(env);
  const allowed = await store.reserve(uid, monthKey(date), reservation, limit);
  if (!allowed) throw new QuotaExceededError("Месячный лимит ИИ исчерпан. Попробуйте в следующем месяце.");
  return { uid, month: monthKey(date), reservation };
}
export async function settleQuota(store, reservation, usage = {}) {
  const actual = Math.max(0, Math.min(reservation.reservation, Number(usage.total_tokens) || reservation.reservation));
  await store.settle(reservation.uid, reservation.month, reservation.reservation, actual);
}
