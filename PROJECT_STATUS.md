# PROJECT_STATUS.md — текущее состояние проекта

Последняя проверка: 2026-10-24
Версия клиента в исходниках: `v0.4.18` (Android versionCode 33, PWA `shell-v90`)
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

## Сбой ИИ 2026-10-24 и v0.4.18

- Причина: Blackroute отвечает 404 на модели `*-maas`. Текстовая модель `deepseek-v3.2-maas` и `qwen3-…-maas` недоступны, хотя остаются в `/v1/models`. Шлюз возвращал `502` «Выбранная модель недоступна в Blackroute». Gemini-модели работают.
- Исправление в Яндексе 2026-10-24: у функции `nutrition` переменная `BLACKROUTE_MODEL=gemini-2.5-flash-lite` (новая версия с тем же кодом 0.1.25, выбор пользователя). Health показывает `textModel: gemini-2.5-flash-lite`, текстовый запрос владельца — 200.
- В коде (шлюз 0.1.26) модель по умолчанию и `wrangler.toml` переведены на `gemini-2.5-flash-lite`. Код 0.1.26 в Яндекс пока не загружался: там работает 0.1.25 с той же моделью через переменную.
- Тарифа `gemini-2.5-flash-lite` нет в `worker/src/costs.js`, поэтому расходы текстовых запросов показываются как неизвестные (`*`), пока пользователь не задаст цену.
- Одновременно в Yandex Cloud шёл сбой зон (YDB, Cloud Functions с ограничениями; Cloud Logging и Monitoring недоступны), поэтому логи функции посмотреть нельзя. К отказу ИИ он не относился: квота в YDB отвечала.

## Изменено в v0.4.17

- Браузерный Firebase SDK обновлён с 10.14.1 до 12.19.0, той же версии, что в эмуляторных тестах (`firebase-client.js`, `index.html`, `service-worker.js`). Используемые API (Auth, Firestore, `initializeFirestore`, email-ссылки, `linkWithCredential`) между версиями не менялись. Локально сайт с SDK 12 загружается, `nutritionStore` инициализируется.
- `tests/service-worker.test.mjs` проверяет, что каждый модуль `js/` и каждый импорт с `?release=` есть в SHELL, а версия Firebase SDK совпадает с `package.json`.
- README и ROADMAP сокращены до текущего состояния; прежние версии — в `docs/history/`.

## Изменено в v0.4.16

Сайт опубликован 2026-10-21: коммит `3df8cd9`, тег `v0.4.16`. Deploy 39649890526 и Test Firestore rules 39649891235 завершились success (тест правил теперь запускается один раз). Пять ключевых файлов сайта совпадают с коммитом. Шлюз 0.1.25 опубликован в Яндексе 2026-10-21 через консоль: версия `d4e0bc115h7hpfbepk63` Active/$latest, прежние Node 22/`index.handler`/256 МБ/1 мин/`x20-ai`, переменные YDB и секрет Lockbox сохранены, добавлена `AI_ADMIN_EMAILS`. Health 0.1.25/`quotaConfigured: true`, CORS для сайта и `https://localhost`, чужой origin не отражается, 401 без токена и с неверным токеном.

- Шлюз требует `email_verified` в Firebase ID token. Неподтверждённые email/password-аккаунты получают `403` с `code: "email_unverified"`; токены часов (`sign_in_provider: "custom"`) пропускаются.
- Email владельца убран из исходников. Исключение из месячной квоты, выбор модели и показ расходов определяются переменной окружения `AI_ADMIN_EMAILS` (через запятую) и только для подтверждённого email.
- Клиент показывает панель расходов, только если шлюз вернул `costs`, и выводит понятное сообщение для неподтверждённого email.
- `test-firestore.yml` запускается только на push веток, без повторного запуска на тегах.
- Из корня удалены пустой файл `git` и скриншоты `nav-check.png`, `plan-tab.png`.

## Выпуск APK (с 2026-10-21)

APK больше не хранятся в Git: `downloads/` в `.gitignore`. APK 0.4.10, 0.4.11, 0.4.13 и 0.4.14 прикреплены к GitHub Releases своих тегов.
1. Собрать и подписать APK прежним ключом, назвать `nutriciolog-X.Y.Z.apk`.
2. Создать GitHub Release `vX.Y.Z` (тег релизного коммита) и прикрепить APK.
3. Обновить `android-release.json` (version, versionCode, url, sha256) и ссылку в `index.html`, отправить в `main`.
4. Deploy скачивает APK из релиза, сверяет SHA-256, выкладывает в `downloads/` бакета; старые APK в бакете не удаляются (`--exclude "downloads/*"`).

## История Git переписана (2026-10-22)

`downloads/` удалён из всей истории (`git filter-branch`), `main` и все теги отправлены с force-push. Хеши коммитов изменились, начиная с подписанных GitHub коммитов «Add files via upload»; содержимое веток и тегов, кроме `downloads/`, не изменилось. Локальная история весит 2,09 МБ вместо 10,76 МБ; GitHub уменьшит размер после своей очистки.
- На другом ПК: `git fetch --force --tags origin` и `git reset --hard origin/main` (сначала сохранить несохранённые изменения) или клонировать заново. Не пушить старую историю.
- Старые ветки `codex/*`, `dividers-for-purposes-f75c3`, `profile-settings-change-8cff2` не переписывались (APK в них нет) и указывают на старые хеши.

## Требует внешней настройки

1. Вход владельца проверен пользователем 2026-10-21: «Без месячного лимита» и расходы показываются. Осталось проверить, что новый аккаунт без подтверждения email получает сообщение «Подтвердите email».
2. Cloudflare Worker уже 0.1.25 (автосборка из `main`), но без `AI_ADMIN_EMAILS`: перед включением резерва добавить её как secret.
3. Резервный Cloudflare Worker отвечает `quotaConfigured: false`, поэтому резерв ИИ фактически возвращает `503`. Его панель была недоступна; включить общий счётчик или убрать резерв из `js/ai-transport.js`.
4. Firestore rules публикуются вручную в Firebase Console.

## Известные проблемы

- `js/app.js` (~2100 строк) и `firebase-client.js` (~1000 строк) снова стали монолитами.
- Список кэша `service-worker.js` по-прежнему ведётся вручную, но расхождения ловит тест.
- На GitHub остались открытый PR #2 от qwen-chat и старые ветки (локальная копия — `refs/backup/*`); удаление требует подтверждения пользователя. `main` без защиты.
- Встроенный браузер Claude не регистрирует Service Worker на `http://127.0.0.1` (и для старой версии); проверять PWA на рабочем сайте или через `tests/auth-network.cjs`.
- Рабочая папка лежит в OneDrive: это уже приводило к рассинхрону файлов и `.git` между ПК.

## Проверки v0.4.17

- `node --test tests/*.test.mjs`: 119 passed, 1 skipped; `node tests/auth-network.cjs` (Edge): 37 PASS.

## Проверки v0.4.16

- `node scripts/build-android-web.mjs && node --test tests/*.test.mjs`: 117 passed, 1 skipped (`QUOTA_RUNTIME_TEST=1` для локального Wrangler/SQLite).
- `BROWSER_CHANNEL=msedge node tests/auth-network.cjs`: 37 сценариев PASS. В тесте расходов email владельца теперь фиксированный: его определяет сервер.
- `node --check` для `js/`, `worker/src/`, `firebase-client.js` — без ошибок.
- Android-сборка (Gradle) и Firestore-эмулятор локально не запускались; их проверяет CI.

## Следующий шаг

Проверить неподтверждённый аккаунт в приложении, затем вынести APK из Git.
