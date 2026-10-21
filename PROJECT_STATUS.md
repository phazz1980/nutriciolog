# PROJECT_STATUS.md — текущее состояние проекта

Последняя проверка: 2026-10-21
Версия клиента в исходниках: `v0.4.16` (Android versionCode 31, PWA `shell-v88`)
Версия AI-шлюза: `0.1.25` (Яндекс — версия `d4e0bc115h7hpfbepk63`, $latest; Cloudflare-резерв обновляется автоматически из `main`)
Скачиваемый APK: `0.4.14` / code 29 (`android-release.json`)

Подробный журнал до v0.4.15 перенесён в `docs/history/PROJECT_STATUS-journal-2026-09-10.md`.
Этот файл описывает только текущее состояние — не дописывайте сюда журнал задач.

## Архитектура

- Общий клиент Web/Android: `index.html`, `styles.css`, `js/`, `firebase-client.js`. Android — Capacitor-оболочка (`android/`, `scripts/build-android-web.mjs` собирает `www/` из тех же исходников).
- Сайт: Yandex Object Storage `nutriciolog-x20`, публикация через GitHub Actions при push в `main` (`.github/workflows/deploy-yandex.yml`).
- Данные: Firebase Auth + Firestore (`firestore.rules`, доступ по UID), local-first очередь и гостевой режим.
- AI: `worker/src/` — общий код шлюза; основной — Yandex Cloud Functions (`yandex/`, квота в YDB), резерв — Cloudflare Worker (`worker/src/cloudflare.js`). Провайдер Blackroute, ключ только в Lockbox / Worker secrets.
- Wear OS: `wearos/` (приложение) и `wear-auth/` (сопряжение часов, отдельная функция Яндекса).

## Изменено в v0.4.16

Сайт опубликован 2026-10-21: коммит `3df8cd9`, тег `v0.4.16`. Deploy 39649890526 и Test Firestore rules 39649891235 завершились success (тест правил теперь запускается один раз). Пять ключевых файлов сайта совпадают с коммитом. Шлюз 0.1.25 опубликован в Яндексе 2026-10-21 через консоль: версия `d4e0bc115h7hpfbepk63` Active/$latest, прежние Node 22/`index.handler`/256 МБ/1 мин/`x20-ai`, переменные YDB и секрет Lockbox сохранены, добавлена `AI_ADMIN_EMAILS`. Health 0.1.25/`quotaConfigured: true`, CORS для сайта и `https://localhost`, чужой origin не отражается, 401 без токена и с неверным токеном.

- Шлюз требует `email_verified` в Firebase ID token. Неподтверждённые email/password-аккаунты получают `403` с `code: "email_unverified"`; токены часов (`sign_in_provider: "custom"`) пропускаются.
- Email владельца убран из исходников. Исключение из месячной квоты, выбор модели и показ расходов определяются переменной окружения `AI_ADMIN_EMAILS` (через запятую) и только для подтверждённого email.
- Клиент показывает панель расходов, только если шлюз вернул `costs`, и выводит понятное сообщение для неподтверждённого email.
- `test-firestore.yml` запускается только на push веток, без повторного запуска на тегах.
- Из корня удалены пустой файл `git` и скриншоты `nav-check.png`, `plan-tab.png`.

## Требует внешней настройки

1. Вход владельца проверен пользователем 2026-10-21: «Без месячного лимита» и расходы показываются. Осталось проверить, что новый аккаунт без подтверждения email получает сообщение «Подтвердите email».
2. Cloudflare Worker уже 0.1.25 (автосборка из `main`), но без `AI_ADMIN_EMAILS`: перед включением резерва добавить её как secret.
3. Резервный Cloudflare Worker отвечает `quotaConfigured: false`, поэтому резерв ИИ фактически возвращает `503`. Его панель была недоступна; включить общий счётчик или убрать резерв из `js/ai-transport.js`.
4. Firestore rules публикуются вручную в Firebase Console.

## Известные проблемы

- APK хранятся в Git (`downloads/`, ~9,6 МБ каждый). Нужно перенести раздачу в GitHub Releases или только в Object Storage; `deploy-yandex.yml` синхронизирует `downloads/` с `--delete`, поэтому простое удаление файлов из Git удалит их с сайта.
- `js/app.js` (~2100 строк) и `firebase-client.js` (~1000 строк) снова стали монолитами.
- Список кэша `service-worker.js` ведётся вручную; Firebase SDK в браузере 10.14.1, в тестах — 12.19.0.
- `README.md` и `ROADMAP.md` очень большие и содержат историю; их стоит сократить так же, как этот файл.
- На GitHub остались открытый PR от qwen-chat и старые ветки; `main` без защиты.
- Рабочая папка лежит в OneDrive: это уже приводило к рассинхрону файлов и `.git` между ПК.

## Проверки v0.4.16

- `node scripts/build-android-web.mjs && node --test tests/*.test.mjs`: 117 passed, 1 skipped (`QUOTA_RUNTIME_TEST=1` для локального Wrangler/SQLite).
- `BROWSER_CHANNEL=msedge node tests/auth-network.cjs`: 37 сценариев PASS. В тесте расходов email владельца теперь фиксированный: его определяет сервер.
- `node --check` для `js/`, `worker/src/`, `firebase-client.js` — без ошибок.
- Android-сборка (Gradle) и Firestore-эмулятор локально не запускались; их проверяет CI.

## Следующий шаг

Проверить неподтверждённый аккаунт в приложении, затем вынести APK из Git.
