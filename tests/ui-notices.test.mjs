import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = path => readFile(new URL(path, import.meta.url), "utf8");
const warning = "ИИ временно недоступен. Можно повторить запрос позже.";

test("AI warning is highlighted in both forms and clears without affecting other reasons", async () => {
  const hints = new Map();
  const anchor = { after(node) { hints.set(node.id, node); } };
  const document = {
    getElementById: id => hints.get(id),
    createElement() {
      const classes = new Set();
      return { classList: {
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        contains(name) { return classes.has(name); },
      } };
    },
    querySelector: selector => selector === "#assistant .send" ? null : anchor,
  };
  let reason = warning;
  let render;
  const script = (await source("../js/ai-availability.js"))
    .replace(/^import .*;\r?\n/m, "").replace("export function", "function");
  vm.runInNewContext(script + "\ninitAiAvailability();", {
    document, availability: () => ({ reason, busy: false }),
    onAiStateChange: callback => { render = callback; },
    window: { addEventListener() {} },
  });
  for (const id of ["aiAvailabilityStatus", "aiMealAvailabilityStatus"]) {
    assert.equal(hints.get(id).textContent, warning);
    assert.ok(hints.get(id).classList.contains("ai-service-warning"));
    assert.equal(hints.get(id).hidden, false);
  }
  reason = "Сначала войдите в аккаунт.";
  render();
  for (const hint of hints.values()) assert.equal(hint.classList.contains("ai-service-warning"), false);
  reason = "";
  render();
  for (const hint of hints.values()) assert.equal(hint.hidden, true);
});

test("watch button is inside an accessible card describing Wear OS and the code", async () => {
  let mounted;
  const node = () => ({
    children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
  });
  const script = (await source("../js/wear-pairing.js")).replace(/^import .*;\r?\n/m, "");
  vm.runInNewContext(script, {
    document: {
      createElement: node,
      getElementById: () => ({ before: card => { mounted = card; } }),
    },
    window: { addEventListener() {} },
    location: { hash: "" },
  });
  assert.equal(mounted.className, "card watch-pairing-card");
  const [heading, description, button] = mounted.children;
  assert.equal(mounted.attributes["aria-labelledby"], heading.id);
  assert.match(description.textContent, /Wear OS.*Мой нутрициолог/);
  assert.match(description.textContent, /Войти с телефона/);
  assert.equal(button.attributes["aria-describedby"], description.id);
  assert.equal(button.textContent, "Подключить часы");
  assert.equal(typeof button.onclick, "function");
});

test("voice hint is initially hidden but operational feedback remains available", async () => {
  const html = await source("../index.html");
  assert.ok(!html.includes("Голосовой ввод зависит от поддержки браузера."));
  assert.match(html, /id="voiceStatus"[^>]*role="status"[^>]*hidden/);
  const app = await source("../js/app.js");
  assert.match(app, /status.hidden = !text/);
  assert.match(app, /Слушаю…/);
});
