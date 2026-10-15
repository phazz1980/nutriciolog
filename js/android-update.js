// The public release registry describes the downloadable APK, independently of the Web version.
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const VERSION = /^[0-9]+[.][0-9]+[.][0-9]+$/;

export function createUpdateController({ plugin, render = () => {}, now = Date.now }) {
  let state = { checking: false, opening: false, release: null, message: '' };
  let pending = null;
  let lastSuccess = null;
  const emit = patch => { state = { ...state, ...patch }; render({ ...state }); };
  function check(force = false) {
    if (pending) return pending;
    if (!force && lastSuccess !== null && now() - lastSuccess < CHECK_INTERVAL) return Promise.resolve();
    emit({ checking: true, message: 'Проверяем обновления…' });
    pending = Promise.resolve().then(() => plugin.checkUpdate()).then(result => {
      if (!VERSION.test(result?.version) || !VERSION.test(result?.currentVersion)
        || !Number.isSafeInteger(result.versionCode) || !Number.isSafeInteger(result.currentCode)
        || result.currentCode < 1 || result.versionCode < 1 || typeof result.available !== 'boolean') {
        throw new Error('Invalid native update response');
      }
      const available = result.available && result.versionCode > result.currentCode;
      lastSuccess = now();
      emit({ release: available ? { version: result.version, code: result.versionCode } : null,
        currentVersion: result.currentVersion,
        message: available ? 'Доступна версия ' + result.version
          : result.requiresNewerAndroid ? 'Для новой версии требуется более новая версия Android.' : 'Установлена последняя версия.' });
    }).catch(() => {
      emit({ message: 'Не удалось проверить обновления. Проверьте интернет и попробуйте ещё раз.' });
    }).finally(() => { pending = null; emit({ checking: false }); });
    return pending;
  }
  async function download() {
    if (!state.release || state.opening) return;
    emit({ opening: true });
    try {
      await plugin.openUpdate();
      emit({ message: 'APK открыт в браузере. После скачивания установите его поверх приложения.' });
    } catch {
      emit({ message: 'Не удалось открыть скачивание. Попробуйте ещё раз.' });
    } finally { emit({ opening: false }); }
  }
  return { check, download, status: () => ({ ...state }) };
}

export function initAndroidUpdate({ win = window, doc = document } = {}) {
  const plugin = win.Capacitor?.getPlatform?.() === 'android' ? win.Capacitor.Plugins?.NutritionAppUpdate : null;
  const documents = doc.getElementById('profileDocuments');
  const main = doc.querySelector('main.phone');
  if (!plugin?.checkUpdate || !plugin?.openUpdate || !documents || !main || doc.getElementById('androidUpdateCard')) return;
  const card = doc.createElement('section');
  card.className = 'card android-update';
  card.id = 'androidUpdateCard';
  card.innerHTML = '<h2>Обновление приложения</h2><small class="hello" id="androidInstalledVersion"></small><p class="hello" id="androidUpdateStatus" role="status"></p><div class="android-update-actions"><button type="button" class="secondary" id="androidCheckUpdate">Проверить обновления</button><button type="button" class="secondary" id="androidInstallUpdate" hidden>Скачать обновление</button></div><small class="hello">После скачивания откройте APK и подтвердите установку поверх приложения, не удаляя его.</small>';
  documents.before(card);
  const notice = doc.createElement('aside');
  notice.className = 'card android-update-notice';
  notice.id = 'androidUpdateNotice';
  notice.hidden = true;
  notice.setAttribute('aria-label', 'Новая версия приложения');
  notice.innerHTML = '<p role="status" aria-live="polite" id="androidUpdateNoticeText"></p><div class="android-update-actions"><button type="button" class="secondary" id="androidNoticeDownload">Скачать обновление</button><button type="button" class="link" id="androidNoticeDismiss">Позже</button></div>';
  main.prepend(notice);
  const element = id => doc.getElementById(id);
  let dismissed = '';
  try { dismissed = win.localStorage.getItem('nutriciolog-update-dismissed') || ''; } catch {}
  const controller = createUpdateController({ plugin, render: state => {
    element('androidCheckUpdate').disabled = state.checking;
    element('androidUpdateStatus').textContent = state.message;
    if (state.currentVersion) element('androidInstalledVersion').textContent = 'Установлена версия ' + state.currentVersion;
    element('androidInstallUpdate').hidden = !state.release;
    element('androidInstallUpdate').disabled = state.opening;
    element('androidNoticeDownload').disabled = state.opening;
    notice.hidden = !state.release || state.release.version === dismissed;
    if (state.release) element('androidUpdateNoticeText').textContent = 'Доступна новая версия ' + state.release.version;
  } });
  Promise.resolve().then(() => plugin.getVersion?.()).then(result => {
    if (VERSION.test(result?.currentVersion)) element('androidInstalledVersion').textContent = 'Установлена версия ' + result.currentVersion;
  }).catch(() => {});
  element('androidCheckUpdate').addEventListener('click', () => controller.check(true));
  element('androidInstallUpdate').addEventListener('click', () => controller.download());
  element('androidNoticeDownload').addEventListener('click', () => controller.download());
  element('androidNoticeDismiss').addEventListener('click', () => {
    dismissed = controller.status().release?.version || '';
    notice.hidden = true;
    try { win.localStorage.setItem('nutriciolog-update-dismissed', dismissed); } catch {}
  });
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) controller.check(); });
  win.addEventListener('online', () => controller.check());
  Promise.resolve().then(() => plugin.addListener?.('resume', () => controller.check())).catch(() => {});
  controller.check();
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initAndroidUpdate();
