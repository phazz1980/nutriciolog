import { WEAR_AUTH_ENDPOINT } from './wear-config.js';

const errors = {
  invalid_code: 'Введите 10 символов кода с ваших часов.',
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
  const response = await fetch(`${WEAR_AUTH_ENDPOINT.replace(/\/$/, '')}/${action}`, {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    <label class="field">Код с часов<input name="code" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
    <p role="status" aria-live="polite"></p>
    <button class="primary" type="submit">Проверить код</button>
    <button class="link" type="button" style="display:block;margin:14px auto">Отмена</button>
  </form>`;
  const form = dialog.querySelector('form');
  const input = form.elements.code;
  input.value = initialCode;
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
  input.oninput = () => { checkedCode = null; submit.textContent = 'Проверить код'; status.textContent = ''; };
  form.onsubmit = async event => {
    event.preventDefault();
    const code = input.value.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(code)) { status.textContent = errors.invalid_code; return; }
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
        status.textContent = `Подключить ваши часы с кодом ${code.slice(0, 5)}-${code.slice(5)} к текущему аккаунту? Подтверждайте только код на собственных часах.`;
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
  const match = location.hash.match(/^#connect-watch=([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10})$/i);
  if (match) { history.replaceState(null, '', location.pathname + location.search); openPairing(match[1]); }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
