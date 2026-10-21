export const SHARED_QUOTA_ENDPOINT = "https://my-nutritionist-advice.340052.workers.dev/internal/quota";

// Trusted server-to-server transport only. The bearer credential lives in
// Lockbox/Worker secrets, never in client configuration or Firebase.
export function createRemoteQuotaStore({ endpoint, secret, fetcher = fetch }) {
  if (endpoint !== SHARED_QUOTA_ENDPOINT || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Invalid shared quota configuration");
  }
  async function call(uid, operation, fields) {
    const response = await fetcher(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ uid, operation, ...fields }),
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

export async function sharedQuotaRequest(request, env, store) {
  const json = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = env.SHARED_QUOTA_SECRET;
  const authorization = request.headers.get("Authorization") || "";
  if (typeof secret !== "string" || secret.length < 32 || authorization.length > 512) return json({ error: "Unauthorized" }, 401);
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([`Bearer ${secret}`, authorization].map(value =>
    crypto.subtle.digest("SHA-256", encoder.encode(value)).then(buffer => new Uint8Array(buffer))));
  let different = 0;
  for (let index = 0; index < expected.length; index++) different |= expected[index] ^ actual[index];
  if (different) return json({ error: "Unauthorized" }, 401);
  if (!store || env.SHARED_QUOTA_READY !== "true") return json({ error: "Storage unavailable" }, 503);
  try {
    const body = await request.text();
    if (encoder.encode(body).length > 4096) return json({ error: "Request too large" }, 413);
    const { uid, operation, period, limit, unlimited = false, id, nanoUsd, unknown, start, end } = JSON.parse(body);
    if (typeof uid !== "string" || !uid || uid.length > 128) throw new Error();
    let result;
    switch (operation) {
      case "read": result = await store.read(uid, period); break;
      case "consume": result = await store.consume(uid, period, limit, unlimited); break;
      case "startCost": result = await store.startCost(uid, id); break;
      case "finishCost": result = await store.finishCost(uid, id, nanoUsd, unknown); break;
      case "readCosts": result = await store.readCosts(uid, start, end); break;
      default: return json({ error: "Invalid operation" }, 400);
    }
    return json(result, 200);
  } catch { return json({ error: "Storage operation failed" }, 503); }
}
