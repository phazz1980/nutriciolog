import { todayKey } from './date.js';
import { accountDefaults, onAuthChanged } from './storage.js';
import { openDialog, toast } from './ui.js';
import { latestHealthWeight, stepsProgress, healthBurnedCalories } from './health-data.js';
import { createNutritionSync } from './health-nutrition.js';

let summary = null;
let pending = null;
let mounted = false;
const health = () => window.Capacitor?.getPlatform?.() === 'android' ? window.Capacitor.Plugins?.NutritionHealth : null;
const goalKey = () => `my-nutritionist:steps-goal:${accountDefaults().uid || 'guest'}`;
let nutritionSync = null;
let diaryRevision = 0;
function renderNutrition() {
  const input = document.getElementById('healthNutritionToggle');
  if (!input || !nutritionSync) return;
  const state = nutritionSync.status();
  input.checked = state.enabled;
  document.getElementById('healthNutritionStatus').textContent = !state.enabled ? 'Передача питания выключена.'
    : `${state.message || 'Передача питания включена.'}${state.pending ? ` Ожидают отправки: ${state.pending}.` : ''}`;
}

async function exportToday() {
  const owner = accountDefaults().uid || '';
  const revision = diaryRevision;
  const entries = await window.nutritionStore?.loadDiaryEntries?.(todayKey());
  if (owner !== (accountDefaults().uid || '') || !nutritionSync.status().enabled) return;
  // A deletion/edit made while loading must never be overwritten by the old snapshot.
  if (revision !== diaryRevision) { toast('Дневник изменился во время загрузки. Нажмите передачу ещё раз.'); return; }
  for (const entry of entries || []) nutritionSync.enqueue({ owner, entry });
  await nutritionSync.flush();
}
function savedGoal() {
  try { return stepsProgress(null, Number(localStorage.getItem(goalKey())), todayKey()).goal; }
  catch { return 8000; }
}

function render() {
  const activity = document.getElementById('healthActivity');
  if (activity) activity.hidden = !(summary?.stepsGranted || summary?.energyGranted);
  const value = stepsProgress(summary, savedGoal(), todayKey());
  const count = document.getElementById('stepsCount');
  if (!count) return;
  count.textContent = value.steps === null ? '—' : value.steps.toLocaleString('ru-RU');
  document.getElementById('stepsGoalText').textContent = ` / ${value.goal.toLocaleString('ru-RU')}`;
  document.getElementById('stepsNote').textContent = value.steps === null
    ? 'Подключите Health Connect в профиле, чтобы видеть шаги за сегодня.' : 'Шаги за текущий день из Health Connect.';
  const weight = latestHealthWeight(summary, todayKey());
  const burned = healthBurnedCalories(summary, todayKey());
  document.getElementById('healthBurnedCalories').textContent = burned === null ? '—' : burned.toLocaleString('ru-RU');
  document.getElementById('healthBurnedNote').textContent = !summary?.energyGranted
    ? 'Разрешите чтение расхода калорий в профиле.' : burned === null
    ? 'В Health Connect пока нет данных расхода за сегодня.' : 'Общий расход с начала дня, включая основной обмен. Цель питания не изменяется.';
  document.getElementById('healthWeight').textContent = !summary?.weightGranted ? 'Вес: доступ не выдан.'
    : weight ? `Последний вес: ${weight.weight.toLocaleString('ru-RU')} кг · ${weight.date.split('-').reverse().join('.')}`
    : 'В Health Connect нет записей веса за последние 30 дней.';
  const goalInput = document.getElementById('stepsGoalInput');
  if (document.activeElement !== goalInput) goalInput.value = String(value.goal);
}

export async function refreshHealth() {
  const plugin = health();
  if (!plugin || !mounted) return null;
  if (pending) return pending;
  pending = (async () => {
    const statusText = document.getElementById('healthStatus');
    const connect = document.getElementById('healthConnectButton');
    try {
      const status = await plugin.getStatus();
      document.getElementById('healthRefreshButton').hidden = status.availability !== 'available';
      document.getElementById('healthSettingsButton').hidden = status.availability === 'unavailable';
      connect.hidden = status.availability === 'unavailable';
      connect.textContent = status.availability === 'install_required' ? 'Установить Health Connect' : 'Подключить / изменить доступ';
      if (status.availability !== 'available') {
        summary = null;
        statusText.textContent = status.availability === 'install_required'
          ? 'Установите или обновите Health Connect на телефоне.' : 'Health Connect недоступен на этом устройстве.';
      } else if (status.stepsGranted || status.weightGranted || status.energyGranted) {
        summary = await plugin.readSummary();
        statusText.textContent = status.stepsGranted && status.weightGranted && status.energyGranted ? 'Подключено: шаги, вес и расход калорий.' : 'Подключено частично. Шаги, вес и расход калорий можно разрешить отдельно.';
      } else {
        summary = null;
        statusText.textContent = 'Разрешите чтение шагов, веса и расхода калорий. Доступ можно отозвать в любой момент.';
      }
    } catch (error) {
      summary = null;
      statusText.textContent = error.message || 'Не удалось прочитать данные. Нажмите «Обновить».';
    }
    render();
    await nutritionSync?.flush();
    return latestHealthWeight(summary, todayKey());
  })().finally(() => { pending = null; });
  return pending;
}

export async function getHealthWeight() {
  if (!health()) return null;
  return refreshHealth();
}

export function initHealthConnect() {
  if (!health() || mounted) return;
  mounted = true;
  const card = document.createElement('section');
  card.className = 'card device-connect-card';
  card.id = 'healthCard';
  card.innerHTML = `<h2>Health Connect</h2>
    <p class="hello">Читайте шаги, вес и общий расход калорий с телефона и приложений здоровья. Вес подставляется в форму «Записать вес»; запись сохраняется только по кнопке «Сохранить». Доступ можно отозвать в настройках телефона.</p>
    <p id="healthStatus" role="status" aria-live="polite">Проверяем доступ…</p>
    <p class="hello" id="healthWeight"></p>
    <div class="device-actions"><button type="button" class="secondary" id="healthConnectButton">Подключить</button><button type="button" class="link" id="healthRefreshButton">Обновить</button><button type="button" class="link" id="healthSettingsButton">Управление доступом</button></div>
    <label class="health-nutrition-toggle"><input type="checkbox" id="healthNutritionToggle"> Передавать питание в Health Connect</label>
    <p class="hello">После включения передадим сегодняшние блюда, затем новые сохранённые записи, их изменения и удаления с этого телефона. Калории и БЖУ станут доступны приложениям, которым вы разрешили чтение питания. Записи на завтра передаются в день приёма пищи. Выключение останавливает передачу, но не удаляет уже переданные записи.</p>
    <p id="healthNutritionStatus" role="status" aria-live="polite"></p>
    <button type="button" class="link" id="healthExportToday">Передать сегодняшний дневник ещё раз</button>
    <form id="stepsGoalForm"><label class="field">Дневная цель шагов<input id="stepsGoalInput" type="number" min="100" max="100000" step="100" inputmode="numeric" required></label><button class="secondary" type="submit">Сохранить цель</button><p class="hello">Цель хранится на этом телефоне отдельно для вашего аккаунта.</p></form>`;
  document.getElementById('profileDocuments')?.before(card);
  nutritionSync = createNutritionSync({ storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, owner: () => accountDefaults().uid || '', plugin: health, today: todayKey, changed: renderNutrition });
  window.addEventListener('nutrition-diary-saved', event => { diaryRevision++; nutritionSync.enqueue(event.detail); });
  window.addEventListener('nutrition-diary-deleted', event => { diaryRevision++; nutritionSync.enqueue({ ...event.detail, deleted: true }); });
  document.getElementById('healthNutritionToggle').onchange = async event => {
    const input = event.target;
    if (!input.checked) { nutritionSync.setEnabled(false); return; }
    input.checked = false;
    input.disabled = true;
    const owner = accountDefaults().uid || '';
    try {
      const status = await health().connect({ nutrition: true });
      if (owner !== (accountDefaults().uid || '')) return;
      if (!status.nutritionGranted) { toast('Запись питания не разрешена. Передача остаётся выключенной.'); return; }
      nutritionSync.setEnabled(true);
      await exportToday();
    } catch { toast('Не удалось включить передачу питания. Проверьте Health Connect.'); }
    finally { input.disabled = false; renderNutrition(); }
  };
  document.getElementById('healthExportToday').onclick = () => {
    if (!nutritionSync.status().enabled) { toast('Сначала включите передачу питания.'); return; }
    exportToday().catch(() => toast('Не удалось загрузить сегодняшний дневник. Повторите попытку.'));
  };
  renderNutrition();
  const activity = document.createElement('div');
  activity.className = 'activity-block';
  activity.id = 'healthActivity';
  activity.hidden = true;
  activity.innerHTML = `<h2>Активность</h2><div class="activity-cards"><section class="card activity-card"><button type="button" class="goal-metric" id="stepsOpenProfile" aria-describedby="stepsNote"><span class="goal-metric-label">Шаги <span aria-hidden="true">›</span></span><span class="goal-metric-value"><b id="stepsCount">—</b></span></button><p class="goal-accessible-note" id="stepsNote"></p></section><section class="card activity-card"><button type="button" class="goal-metric" id="healthBurnedDetails" aria-describedby="healthBurnedNote"><span class="goal-metric-label">Расход <span aria-hidden="true">ⓘ</span></span><span class="goal-metric-value"><b id="healthBurnedCalories">—</b> <span>ккал</span></span></button><p class="goal-accessible-note" id="healthBurnedNote"></p></section></div>`;
  document.querySelector('#today .water')?.before(activity);
  const target = document.createElement('b');
  target.id = 'stepsGoalText';
  document.getElementById('stepsCount').after(target);
  document.getElementById('healthBurnedDetails').onclick = () => {
    const { dialog, close } = openDialog({ html: '<section class="sheet"><h2>Расход калорий</h2><p id="burnedExplanation"></p><p class="hello">Источник — Health Connect. Это расход за прошедшую часть дня, не прогноз на сутки и не изменение веса. Дневная цель питания остаётся прежней.</p><button type="button" class="primary" id="closeBurnedDetails">Понятно</button></section>' });
    dialog.querySelector('#burnedExplanation').textContent = document.getElementById('healthBurnedNote').textContent;
    dialog.querySelector('#closeBurnedDetails').onclick = close;
  };
  document.getElementById('stepsOpenProfile').onclick = () => { window.show('profile'); card.scrollIntoView({ block: 'center' }); };
  document.getElementById('healthRefreshButton').onclick = () => refreshHealth();
  document.getElementById('healthSettingsButton').onclick = () => health().openSettings().catch(error => toast(error.message));
  document.getElementById('healthConnectButton').onclick = async () => {
    try {
      const status = await health().getStatus();
      if (status.availability === 'install_required') { await health().openSettings(); return; }
      const { dialog, close } = openDialog({ html: '<section class="sheet"><h2>Подключить Health Connect</h2><p>Приложение будет читать шаги, вес и общий расход калорий за день. Шаги и потраченные калории отображаются на главной. Вес подставляется в форму ввода: после вашего сохранения он попадёт в дневник и синхронизируется с аккаунтом, если вы вошли. Данные не отправляются ИИ. Передача питания включается отдельно.</p><button type="button" class="primary" id="confirmHealth">Продолжить</button><button type="button" class="link" id="cancelHealth">Отмена</button></section>' });
      dialog.querySelector('#cancelHealth').onclick = close;
      dialog.querySelector('#confirmHealth').onclick = async () => {
        close();
        try { await health().connect(); await refreshHealth(); }
        catch (error) { toast(error.message || 'Не удалось открыть разрешения.'); }
      };
    } catch (error) { toast(error.message); }
  };
  document.getElementById('stepsGoalForm').onsubmit = event => {
    event.preventDefault();
    const goal = Number(document.getElementById('stepsGoalInput').value);
    if (!Number.isInteger(goal) || goal < 100 || goal > 100000) return;
    try { localStorage.setItem(goalKey(), String(goal)); render(); toast('Цель шагов сохранена'); }
    catch { toast('Не удалось сохранить цель на телефоне.'); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHealth(); });
  onAuthChanged(() => { summary = null; render(); renderNutrition(); refreshHealth(); });
  window.setInterval(() => { if (!document.hidden) refreshHealth(); }, 60_000);
  render();
  refreshHealth();
}
