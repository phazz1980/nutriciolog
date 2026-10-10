import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Cost panel is restricted and cleared when switching accounts; quota stays visible', () => {
  const source = readFileSync(new URL('../js/ai-quota.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
  const element = () => ({ children: [], append(...items) { this.children.push(...items); },
    replaceChildren() { this.children = []; }, after() {} });
  const nodes = { aiQuotaStatus: element(), aiQuotaDetail: element(), refreshAiQuotaButton: element() };
  let auth = { signedIn: true }, email = 'other@example.com', render, panel;
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], querySelectorAll: () => [],
      createElement: tag => { const node = element(); if (tag === 'div' && !panel) panel = node; return node; } },
    window: { addEventListener() {} }, getAuthStatus: () => auth,
    accountDefaults: () => ({ email }), onAiStateChange: callback => { render = callback; },
    refreshQuota() {}, quotaState: () => ({ quota: { remaining: 900, limit: 1000, used: 100, resetsAt: '2027-01-01' } }),
  });
  vm.runInContext(`${source}\ninitAiQuota();`, context);
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
  assert.match(nodes.aiQuotaStatus.textContent, /Осталось/);
  email = '340052@gmail.com'; render();
  assert.equal(panel.hidden, false);
  assert.equal(panel.children[0].textContent, 'Расходы ИИ · оценка');
  email = 'other@example.com'; render();
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
  auth = { signedIn: false }; email = '340052@gmail.com'; render();
  assert.equal(panel.hidden, true);
});
