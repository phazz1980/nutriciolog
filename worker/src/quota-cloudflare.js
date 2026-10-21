// One SQLite-backed Durable Object per verified Firebase UID. Public AI clients
// never receive the binding or the credential of the server-only bridge.
export function createCloudflareQuotaStore(namespace) {
  async function call(uid, operation, fields) {
    const stub = namespace.get(namespace.idFromName(uid));
    const response = await stub.fetch("https://quota.internal/", {
      method: "POST", body: JSON.stringify({ operation, ...fields }),
    });
    if (!response.ok) throw new Error("Quota storage unavailable");
    return response.json();
  }
  return {
    read: (uid, period) => call(uid, "read", { period }),
    consume: (uid, period, limit, unlimited = false) => call(uid, "consume", { period, limit, unlimited }),
    startCost: (uid, id) => call(uid, "startCost", { id }),
    finishCost: (uid, id, nanoUsd, unknown) => call(uid, "finishCost", { id, nanoUsd, unknown }),
    readCosts: (uid, start, end) => call(uid, "readCosts", { start, end }),
  };
}

export class AiQuotaObject {
  constructor(state, env = {}) { this.storage = state.storage; this.limit = Number(env.AI_MONTHLY_REQUEST_LIMIT ?? 1000); }

  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      const input = await request.json();
      const { operation, period, limit, unlimited = false, id, nanoUsd, unknown, start, end } = input;
      const validCount = n => Number.isSafeInteger(n) && n >= 0;
      const validId = typeof id === "string" && /^cost:\d{4}-\d{2}-\d{2}:[a-f0-9-]{36}$/.test(id);
      const validPeriod = typeof period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
      if (["read", "consume"].includes(operation) && (!validPeriod ||
          (operation === "consume" && (typeof unlimited !== "boolean" || !validCount(limit) || limit < 1 || limit !== this.limit)))) throw new Error();
      let result;
      if (operation === "read") {
        result = await this.storage.get(`quota:${period}`) ?? 0;
        if (!validCount(result)) throw new Error();
      } else if (operation === "consume") {
        result = await this.storage.transaction(async tx => {
          const used = await tx.get(`quota:${period}`) ?? 0;
          if (!validCount(used)) throw new Error();
          if (!unlimited && used >= limit) return null;
          if (!Number.isSafeInteger(used + 1)) throw new Error();
          await tx.put(`quota:${period}`, used + 1);
          return used + 1;
        });
      } else if (operation === "startCost") {
        if (!validId) throw new Error();
        await this.storage.transaction(async tx => {
          if (await tx.get(id)) throw new Error();
          await tx.put(id, { nanoUsd: 0, unknown: 1, pending: true });
        });
        result = true;
      } else if (operation === "finishCost") {
        if (!validId || !validCount(nanoUsd) || !validCount(unknown)) throw new Error();
        await this.storage.transaction(async tx => {
          if (!(await tx.get(id))?.pending) throw new Error();
          await tx.put(id, { nanoUsd, unknown, pending: false });
        });
        result = true;
      } else if (operation === "readCosts") {
        if (![start, end].every(day => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) || start > end) throw new Error();
        result = [];
        let cursor;
        do {
          const rows = await this.storage.list({ ...(cursor ? { startAfter: cursor } : { start: `cost:${start}:` }), end: `cost:${end}:~`, limit: 500 });
          for (const [key, row] of rows) {
            if (!validCount(row.nanoUsd) || !validCount(row.unknown)) throw new Error();
            result.push({ day: key.slice(5, 15), nanoUsd: row.nanoUsd, unknown: row.unknown });
          }
          cursor = rows.size === 500 ? Array.from(rows.keys()).at(-1) : null;
        } while (cursor);
      } else throw new Error();
      return Response.json(result);
    } catch { return Response.json({ error: "Storage operation failed" }, { status: 503 }); }
  }
}
