import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../firebase-client.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function finishCredentialAutofill()'), source.indexOf('window.firebaseSignInWithEmail ='));
const attempt = source.slice(source.indexOf('function startEmailAttempt(action)'), source.indexOf('async function finishCredentialAutofill()'));

function harness(platform = 'android', plugin = {}) {
  const calls = [];
  const context = vm.createContext({
    window: { Capacitor: { getPlatform: () => platform, Plugins: { CredentialAutofill: plugin } }, getAuthErrorMessage: () => 'error' },
    document: { getElementById: () => ({}) }, navigator: { onLine: true }, setTimeout, clearTimeout,
    updateStatus: () => calls.push('status'), authError: code => new Error(code),
  });
  vm.runInContext('let signInAttempt=null, authState="ready", authMessage="";'+helper+attempt, context);
  return { context, calls };
}

test('Android commits system autofill only after successful credentials, with no credential arguments', async () => {
  const events = [];
  const { context } = harness('android', { completeLogin: async (...args) => { assert.equal(args.length, 0); events.push('commit'); } });
  context.action = async () => { events.push('success'); return { user: { uid: 'test' } }; };
  await vm.runInContext('startEmailAttempt(action)', context);
  assert.deepEqual(events, ['success', 'commit']);
  context.action = async () => { throw new Error('invalid password'); };
  await assert.rejects(vm.runInContext('startEmailAttempt(action)', context));
  assert.deepEqual(events, ['success', 'commit']);
});

test('browser never calls native autofill; missing/failed manager does not prevent login', async () => {
  for (const [platform, plugin] of [
    ['web', { completeLogin: () => { throw new Error('Must not be called'); } }],
    ['android', undefined],
    ['android', { completeLogin: async () => { throw new Error('manager unavailable'); } }],
  ]) {
    const { context } = harness(platform, plugin);
    context.action = async () => ({ user: { uid: 'test' } });
    assert.equal((await vm.runInContext('startEmailAttempt(action)', context)).user.uid, 'test');
  }
});

test('native integration enables WebView autofill and never accepts password arguments', () => {
  const native = fs.readFileSync(new URL('../android/app/src/main/java/ru/phazz/nutriciolog/CredentialAutofillPlugin.java', import.meta.url), 'utf8');
  const activity = fs.readFileSync(new URL('../android/app/src/main/java/ru/phazz/nutriciolog/MainActivity.java', import.meta.url), 'utf8');
  assert.match(activity, /registerPlugin\(CredentialAutofillPlugin.class\)/);
  assert.match(activity, /IMPORTANT_FOR_AUTOFILL_YES/);
  assert.match(native, /manager.commit\(\)/);
  assert.doesNotMatch(native, /call.getString|SharedPreferences|password/i);
});
