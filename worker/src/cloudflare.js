import gateway from "./index.js";
import { createCloudflareQuotaStore } from "./quota-cloudflare.js";
import { sharedQuotaRequest } from "./quota-remote.js";
export { AiQuotaObject } from "./quota-cloudflare.js";

// No Yandex IAM token or database is used here. Both gateways share this store.
export default {
  fetch(request, env) {
    const store = env.QUOTA_OBJECTS ? createCloudflareQuotaStore(env.QUOTA_OBJECTS) : undefined;
    if (new URL(request.url).pathname === "/internal/quota") return sharedQuotaRequest(request, env, store);
    return gateway.fetch(request, {
      ...env,
      AI_QUOTA_STORE: env.SHARED_QUOTA_READY === "true" ? store : undefined,
    });
  },
};
