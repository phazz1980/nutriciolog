import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { validateAnnouncement, refreshAnnouncement } from "../js/ai-announcement.js";

const notice = { enabled: true, title: "ИИ недоступен", message: "<img src=x> Только текст.", expiresAt: "2099-01-01T00:00:00Z" };
test("configuration falls back to website without auth or persistence", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers, undefined);
    if (calls.length === 1) throw new TypeError("source unavailable");
    assert.ok(url.includes("/ai-status.json?minute="));
    return Response.json(notice);
  };
  try {
    assert.equal((await refreshAnnouncement()).title, notice.title);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});
test("notice rejects disabled, expired, incomplete and oversized configuration", () => {
  assert.equal(validateAnnouncement(notice).message, notice.message);
  for (const value of [null, {}, { ...notice, enabled: false }, { ...notice, expiresAt: "bad" },
    { ...notice, expiresAt: "2000-01-01" }, { ...notice, title: "" },
    { ...notice, title: "x".repeat(81) }, { ...notice, message: "x".repeat(601) }]) {
    assert.equal(validateAnnouncement(value), null);
  }
});
test("explicit permanent notice remains valid until manually disabled", () => {
  const permanent = { ...notice, expiresAt: null };
  assert.equal(validateAnnouncement(permanent, Date.parse("2200-01-01")).expiresAt, null);
  assert.equal(validateAnnouncement({ ...permanent, enabled: false }), null);
  const missingExpiry = { ...notice };
  delete missingExpiry.expiresAt;
  assert.equal(validateAnnouncement(missingExpiry), null);
});

async function fixture(uid) {
  const source = (await readFile(new URL("../js/daily-advice.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?$/gm, "").replace(/export /g, "");
  const heading = { textContent: "Маленький шаг к балансу" };
  const label = { textContent: "По вашему меню" };
  const footer = { hidden: false }, retry = { hidden: true }, text = { textContent: "" };
  const card = { hidden: true, querySelector: s => ({ h2: heading, ".daily-advice-label": label, ".daily-advice-footer": footer })[s] };
  let active = notice, calls = 0, interval;
  const saved = new Map();
  const context = {
    document: { getElementById: id => ({ dailyAdvice: card, dailyAdviceText: text, retryDailyAdvice: retry })[id] },
    todayKey: () => "2026-10-11", accountDefaults: () => ({ uid }),
    nutritionTargets: () => ({ protein: 0, fat: 0, carbs: 0 }),
    activeAnnouncement: () => active, refreshAnnouncement: async () => active,
    call: async () => [], askAi: async () => { calls++; return { status: "ok", data: { advice: "Совет" } }; },
    onAuthChanged: () => {}, onStoreReady: () => {}, navigator: { onLine: true },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    window: { addEventListener: () => {}, setInterval: fn => { interval = fn; } },
    TextEncoder, crypto: webcrypto,
  };
  vm.runInNewContext(source + "\ninitDailyAdvice();", context);
  const flush = async () => { await new Promise(resolve => setTimeout(resolve, 25)); };
  await flush();
  return { heading, label, footer, retry, text, card, calls: () => calls,
    remove: async () => { active = null; interval(); await flush(); } };
}
test("guest and signed-in user see notice instead of advice; no AI request or HTML rendering", async () => {
  for (const uid of [null, "test-user"]) {
    const ui = await fixture(uid);
    assert.equal(ui.card.hidden, false);
    assert.equal(ui.text.textContent, notice.message);
    assert.equal(ui.heading.textContent, notice.title);
    assert.equal(ui.label.textContent, "Объявление");
    assert.equal(ui.footer.hidden, true);
    assert.equal(ui.retry.hidden, true);
    assert.equal(ui.calls(), 0);
    assert.equal(Object.hasOwn(ui.text, "innerHTML"), false);
  }
});
test("removing notice restores normal advice for account and hides guest card", async () => {
  for (const uid of [null, "test-user"]) {
    const ui = await fixture(uid);
    await ui.remove();
    assert.equal(ui.heading.textContent, "Маленький шаг к балансу");
    assert.equal(ui.footer.hidden, false);
    assert.equal(ui.calls(), uid ? 1 : 0);
    assert.equal(ui.card.hidden, !uid);
    if (uid) assert.equal(ui.text.textContent, "Совет");
  }
});
test("control JSON is never part of PWA shell cache", async () => {
  const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.ok(!source.includes("ai-status.json"));
  assert.ok(source.includes("./js/ai-announcement.js"));
});
