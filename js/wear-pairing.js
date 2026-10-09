import { WEAR_AUTH_ENDPOINT } from './wear-config.js';

const errors = {
  invalid_code: 'Введите 8 цифр кода с ваших часов.',
  invalid_session: 'Код не найден. Начните вход заново на часах.',
  expired: 'Код истёк. Получите новый код на часах.',
  closed: 'Этот код уже использован или отменён.',
  already_approved: 'Этот код уже подтверждён.',
  unauthorized: 'Сначала войдите в аккаунт в профиле приложения.',
  rate_limited: 'Слишком много попыток. Подождите минуту.',
};

async function request(action, code, signal) {
  if (!WEAR_AUTH_ENDPOINT) throw new Error('Вход с телефона ещё не подключён.');
  const endpoint = new URL(WEAR_AUTH_ENDPOINT);
  if (endpoint.protocol !== 'https:') throw new Error('Нужен защищённый адрес сервиса.');
  const token = await window.getFirebaseIdToken?.();
  if (!token) throw new Error(errors.unauthorized);
  const yandex = endpoint.hostname === 'functions.yandexcloud.net';
  if (yandex) endpoint.searchParams.set('action', action);
  else endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/' + action;
  const response = await fetch(endpoint.href, {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', [yandex ? 'X-X20-Authorization' : 'Authorization']: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] || 'Сервис недоступен. Повторите позже.');
  return result;
}

let closeActiveDialog;
function openPairing(initialCode = '') {
  closeActiveDialog?.();
  const controller = new AbortController();
  const dialog = document.createElement('div');
  dialog.id = 'wearPairingDialog';
  dialog.className = 'modal show';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'wearPairingTitle');
  dialog.innerHTML = `<form class="sheet">
    <h2 id="wearPairingTitle">Подключить часы</h2>
    <p>На ваших часах выберите «Войти с телефона» и введите показанный код.</p>
    <label class="field">Код с часов<input name="code" maxlength="9" inputmode="numeric" autocomplete="off" placeholder="1234-5678" spellcheck="false" required></label>
    <p role="status" aria-live="polite"></p>
    <button class="primary" type="submit">Проверить код</button>
    <button class="link" type="button" style="display:block;margin:14px auto">Отмена</button>
  </form>`;
  const form = dialog.querySelector('form');
  const input = form.elements.code;
  const formatCode = code => code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  input.value = formatCode(initialCode);
  const status = dialog.querySelector('[role=status]');
  const submit = dialog.querySelector('[type=submit]');
  const cancel = dialog.querySelector('[type=button]');
  let checkedCode = null;
  let checkedUid = null;
  const currentUid = () => window.nutritionStore?.getAccountProfileDefaults?.().uid || '';
  const close = () => { controller.abort(); document.removeEventListener('keydown', onKey); dialog.remove(); };
  closeActiveDialog = close;
  const onKey = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  cancel.onclick = close;
  input.oninput = () => {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = formatCode(digits);
    const caret = Math.min(before, digits.length) + (before > 4 ? 1 : 0);
    input.setSelectionRange(caret, caret);
    checkedCode = null;
    submit.textContent = 'Проверить код';
    status.textContent = '';
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const code = input.value.replace(/[\s-]/g, '').toUpperCase();
    if (!/^\d{8}$/.test(code)) { status.textContent = errors.invalid_code; return; }
    submit.disabled = true;
    input.disabled = true;
    try {
      if (checkedCode !== code) {
        const uid = currentUid();
        await request('inspect', code, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (controller.signal.aborted) return;
        if (!uid || currentUid() !== uid) throw new Error('Аккаунт изменился. Проверьте код заново.');
        checkedUid = uid;
        checkedCode = code;
        status.textContent = `Подключить ваши часы с кодом ${formatCode(code)} к текущему аккаунту? Подтверждайте только код на собственных часах.`;
        submit.textContent = 'Подтвердить подключение';
      } else {
        if (!checkedUid || currentUid() !== checkedUid) {
          checkedCode = null;
          submit.textContent = 'Проверить код';
          throw new Error('Аккаунт изменился. Проверьте код заново.');
        }
        await request('approve', code, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (controller.signal.aborted) return;
        status.textContent = 'Подтверждено. Дождитесь завершения входа на часах.';
        submit.hidden = true;
        cancel.textContent = 'Закрыть';
      }
    } catch (error) { if (!controller.signal.aborted) status.textContent = error.message || 'Не удалось подключить часы.'; }
    finally { submit.disabled = false; input.disabled = false; }
  };
  document.body.append(dialog);
  if (!WEAR_AUTH_ENDPOINT) { status.textContent = 'Вход с телефона ещё не подключён.'; submit.disabled = true; }
  input.focus();
}

const button = document.createElement('button');
button.type = 'button';
button.className = 'secondary';
button.textContent = 'Подключить часы';
button.onclick = () => openPairing();
document.getElementById('profileDocuments')?.before(button);
function openFromHash() {
  const match = location.hash.match(/^#connect-watch=(\d{4}-?\d{4})$/);
  if (match) { history.replaceState(null, '', location.pathname + location.search); openPairing(match[1].replace('-', '')); }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
