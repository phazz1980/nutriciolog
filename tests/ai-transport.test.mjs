import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchAi, AI_ENDPOINT, AI_RESERVE_ENDPOINT } from "../js/ai-transport.js";

const options = { method: "POST", headers: { "X-X20-Authorization": "Bearer test-only" }, body: '{"message":"test"}' };
test("primary success; no retry on validation, auth, quota or redirect errors", async () => {
  for (const status of [200, 302, 400, 401, 403, 422, 429]) {
    let calls = 0;
    const response = await fetchAi(options, { fetcher: async (url, init) => {
      calls++;
      assert.equal(url, AI_ENDPOINT);
      assert.equal(init.headers.get("X-X20-Authorization"), "Bearer test-only");
      assert.equal(init.headers.get("Authorization"), null);
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      return new Response("body", { status });
    } });
    assert.equal(response.status, status);
    assert.equal(await response.text(), "body");
    assert.equal(calls, 1);
  }
});
test("one silent retry on network or 5xx, same payload with reserve auth header", async () => {
  for (const failure of [new TypeError("network"), 500, 503, 599]) {
    let calls = 0;
    const response = await fetchAi(options, { fetcher: async (url, init) => {
      calls++;
      assert.equal(init.body, options.body);
      if (calls === 1) {
        if (failure instanceof Error) throw failure;
        return new Response("unavailable", { status: failure });
      }
      assert.equal(url, AI_RESERVE_ENDPOINT);
      assert.equal(init.headers.get("Authorization"), "Bearer test-only");
      assert.equal(init.headers.get("X-X20-Authorization"), null);
      return new Response("reserve");
    } });
    assert.equal(await response.text(), "reserve");
    assert.equal(calls, 2);
  }
});
test("reserve failure never retries again", async () => {
  let calls = 0;
  await assert.rejects(fetchAi(options, { fetcher: async () => { calls++; throw new TypeError("offline"); } }));
  assert.equal(calls, 2);
});
test("timeout retries, caller cancellation and account change do not", async () => {
  let calls = 0;
  await fetchAi(options, { timeoutMs: 5, fetcher: async (url, init) => {
    if (++calls === 2) return new Response("ok");
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError"))));
  } });
  assert.equal(calls, 2);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(fetchAi({ ...options, signal: controller.signal }, { fetcher: async () => {
    calls++; controller.abort(); throw new TypeError("network");
  } }));
  assert.equal(calls, 1);
  let current = true;
  calls = 0;
  await assert.rejects(fetchAi(options, { isCurrent: () => current, fetcher: async () => {
    calls++; current = false; return new Response("failure", { status: 503 });
  } }));
  assert.equal(calls, 1);
});
test("unexpected code errors do not cause extra paid calls", async () => {
  let calls = 0;
  await assert.rejects(fetchAi(options, { fetcher: async () => { calls++; throw new Error("bug"); } }));
  assert.equal(calls, 1);
});
test("phone and website ship identical transport and clients", async t => {
  const phoneRoot = process.env.PHONE_SOURCE_ROOT || "C:/Users/fotne/.codex/worktrees/5f26/nutriciolog";
  try { await readFile(phoneRoot + "/js/ai-client.js"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Set PHONE_SOURCE_ROOT to the separate phone checkout");
    return;
  }
  for (const file of ["ai-transport.js", "ai-client.js"]) {
    assert.equal(await readFile(new URL("../js/" + file, import.meta.url), "utf8"),
      await readFile(phoneRoot + "/js/" + file, "utf8"));
  }
});
