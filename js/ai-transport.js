// Only these two authenticated gateways may receive Firebase tokens.
export const AI_ENDPOINT = "https://functions.yandexcloud.net/d4evergfv4q48plpsdbu";
export const AI_RESERVE_ENDPOINT = "https://my-nutritionist-advice.340052.workers.dev";

export async function fetchAi(options, { timeoutMs = 60_000, isCurrent = () => true, fetcher = fetch } = {}) {
  const endpoints = [AI_ENDPOINT, AI_RESERVE_ENDPOINT];
  for (let index = 0; index < endpoints.length; index++) {
    if (options.signal?.aborted || !isCurrent()) throw new DOMException("Cancelled", "AbortError");
    const headers = new Headers(options.headers);
    const token = headers.get("X-X20-Authorization") || headers.get("Authorization");
    headers.delete("X-X20-Authorization");
    headers.delete("Authorization");
    if (token) headers.set(index === 0 ? "X-X20-Authorization" : "Authorization", token);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(endpoints[index], {
        ...options, headers, signal: controller.signal, redirect: "error", cache: "no-store",
      });
      if (index === 1 || response.status < 500 || response.status > 599) {
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      }
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      // Retry only transport errors/timeouts, never caller cancellation or programming errors.
      if (index === 1 || options.signal?.aborted || !isCurrent() ||
          !(error instanceof TypeError || error?.name === "AbortError" || error?.name === "TimeoutError")) throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
}
