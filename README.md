# Мой нутрициолог

PWA-дневник питания с ИИ-помощником: дневник, вода, вес, профиль с целями КБЖУ, личная база продуктов, расчёт БЖУ, распознавание фото и голосовой ввод. Один и тот же клиент работает как сайт и как Android-приложение (Capacitor); есть отдельное приложение для Wear OS.

- Сайт: https://nutriciolog-x20.website.yandexcloud.net/
- Текущее состояние и порядок выпуска: `PROJECT_STATUS.md`
- План: `ROADMAP.md`
- Правила для ИИ-агентов: `AGENTS.md`
- История решений и подробный журнал до 22.10.2026: `docs/history/`

## Архитектура

```
Браузер / Android (Capacitor)
  ├─ Firebase Auth + Firestore  — вход и данные пользователя (правила: firestore.rules)
  ├─ localStorage               — гостевой режим и local-first очередь записей
  └─ AI-шлюз (POST)             — Yandex Cloud Functions, резерв: Cloudflare Worker
                                    └─ Blackroute → модель
```

- Данные пишет только клиентский Firebase SDK под текущим пользователем. Шлюз ИИ не имеет доступа к Firestore и не получает service account.
- ИИ только предлагает блюдо (`proposedMeal`, `proposedProducts`). В дневник оно попадает лишь после нажатия «Добавить».
- Фото используется только в одном запросе и нигде не сохраняется.
- Голосовой ввод работает в браузере (Web Speech API).

## Структура

| Путь | Назначение |
|---|---|
| `index.html`, `styles.css`, `js/` | интерфейс; `js/app.js` собирает экраны, `js/core.js` — версия, цели БЖУ, расчёты |
| `firebase-client.js` | Firebase Auth/Firestore, кэш профиля, гостевой режим, офлайн-очередь |
| `service-worker.js`, `pwa.js`, `manifest.webmanifest`, `icons/` | PWA и кэш оболочки |
| `worker/src/` | общий код AI-шлюза: проверка Firebase ID token, CORS, квота, расходы, провайдеры |
| `yandex/` | адаптер для Yandex Cloud Functions, сборка `function.zip` |
| `android/`, `scripts/build-android-web.mjs` | Capacitor-приложение; `www/` собирается из тех же исходников |
| `wearos/`, `wear-auth/` | приложение для часов и сервис сопряжения по коду |
| `tests/` | модульные, интеграционные и браузерные проверки |

## AI-шлюз

`POST` с заголовком `Authorization: Bearer <Firebase ID token>` (в Яндексе — `X-X20-Authorization`) и JSON-телом:

- `{ "message": "...", "image": { "mimeType": "image/jpeg", "dataUrl": "..." } }` → `{ advice, proposedMeal, proposedProducts, quota }`;
- `{ "action": "usage" }` → `{ quota }` (и `costs` для владельцев).

`GET /api/health` возвращает версию, провайдера, модели и наличие ключа и квоты, но не сам ключ.

Правила доступа:
- нужен вход по Firebase и **подтверждённый email** (`email_verified`), иначе `403` с `code: "email_unverified"`; исключение — сессии часов по custom token;
- **1000 запросов на UID в календарный месяц UTC**, общий счётчик в YDB; после исчерпания — `429` `quota_exceeded`, при недоступном счётчике — `503` без вызова модели;
- владельцы из переменной `AI_ADMIN_EMAILS` (через запятую, только подтверждённые email) не ограничены месячным лимитом, могут выбирать модель и видят оценку расходов;
- CORS разрешён только для сайта, `https://nutriciolog.pages.dev` и `https://localhost` (Android).

Модели Blackroute: `gemini-2.5-flash-lite` для текста, `gemini-2.5-flash` для фото. С 24.10.2026 Blackroute отвечает 404 на модели `*-maas` (в том числе прежнюю текстовую `deepseek-v3.2-maas`). Новый провайдер добавляется в `worker/src/providers/` с тем же контрактом; его ключ хранится только в секретах сервера.

## Развёртывание

**Сайт.** Push в `main` запускает `.github/workflows/deploy-yandex.yml`: тесты и компиляция Android, затем публикация в бакет `nutriciolog-x20` (секреты `YC_ACCESS_KEY_ID`, `YC_SECRET_ACCESS_KEY` в GitHub Actions) и тег `vX.Y.Z` по `APP_VERSION`.

**APK.** В Git не хранятся. APK прикрепляется к GitHub Release `vX.Y.Z`, а `android-release.json` указывает версию и SHA-256. Deploy скачивает APK из релиза, сверяет хеш и выкладывает его в `downloads/` на сайте; старые APK остаются. Порядок выпуска — в `PROJECT_STATUS.md`.

**Шлюз в Яндексе** (функция `nutrition`, публикуется вручную). Подробности — в `yandex/README.md`.
1. `python yandex/build.py` собирает `yandex/function.zip` без секретов.
2. В консоли создать новую версию из ZIP, сохранив Node.js 22, `index.handler`, 256 МБ, 1 минуту, сервисный аккаунт `x20-ai`, секрет Lockbox `BLACKROUTE_API_KEY` и переменные `AI_PROVIDER`, `BLACKROUTE_MODEL`, `BLACKROUTE_VISION_MODEL`, `AI_MONTHLY_REQUEST_LIMIT`, `YDB_DOCAPI_ENDPOINT`, `YDB_QUOTA_TABLE`, `AI_ADMIN_EMAILS`.
3. Проверить `GET` health: новая версия и `quotaConfigured: true`.

**Резервный Cloudflare Worker** (`worker/wrangler.toml`, `worker/README.md`) собирается из `main` автоматически. Секреты `BLACKROUTE_API_KEY`, `SHARED_QUOTA_SECRET`, `AI_ADMIN_EMAILS` задаются через `wrangler secret put`, а не в `wrangler.toml`.

**Firebase** (проект `my-nutritionist-67ce8`). Включён провайдер Email/Password. В Authorized domains должны быть домены сайта и `localhost` для Android. `firestore.rules` публикуются вручную в Firebase Console. Web config в `firebase-client.js` публичный и секретом не является.

## Проверки

```bash
node scripts/build-android-web.mjs
```
```bash
node --test tests/*.test.mjs
```
```bash
node tests/auth-network.cjs
```

- Браузерные проверки нуждаются в Playwright; на Windows используется `BROWSER_CHANNEL=msedge`.
- `npm run test:rules` запускает эмулятор Firestore (нужны Node.js 22 и Java 21) и проверяет правила и офлайн-очередь с реальным SDK. В CI это делает workflow `test-firestore.yml`.
- Перед публикацией проверьте `git diff`: нет секретов, CORS не ослаблен, блюдо сохраняется только после подтверждения.

## Безопасность

- Ключи провайдеров ИИ — только в Yandex Lockbox или Cloudflare Worker secrets. Никогда не помещайте их в Git, HTML, Firebase config, `wrangler.toml` или логи.
- Email владельцев (`AI_ADMIN_EMAILS`) задаётся только в настройках сервера.
- Проект не реализует обход региональных ограничений провайдеров.
