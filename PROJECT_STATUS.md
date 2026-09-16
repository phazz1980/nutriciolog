# PROJECT_STATUS.md — текущее состояние проекта

Последняя проверка репозитория: 2026-09-16

## Проект

«Мой нутрициолог» — статическое PWA с дневником питания, планом питания, водой/весом, ИИ-советами, фото блюда, браузерным голосовым вводом и заготовкой уведомлений.

Целевая схема:

`GitHub Pages (клиент) → Cloudflare Worker (ИИ-шлюз) → OpenAI/другой провайдер`

Пользовательские данные синхронизируются через Firebase клиентом, а не Worker.

## Что присутствует в текущем архиве

- `index.html` — основной интерфейс приложения.
- `firebase-client.js` — Firebase Web config, Auth/Firestore и локальная работа.
- `firestore.rules` — доступ к `users/{uid}/...` только текущему авторизованному UID.
- `manifest.webmanifest`, `service-worker.js`, `pwa.js`, `notifications.js`, `icons/app-icon.svg` — PWA/уведомления.
- `worker/wrangler.toml` — Worker `my-nutritionist-advice`, `AI_PROVIDER = "openai"`.
- `worker/src/index.js` — HTTP-обработчик `/api/advice`/Worker: POST/OPTIONS, CORS, валидация текста и фото, вызов выбранного ИИ-провайдера.
- `README.md` — инструкции по GitHub Pages, Cloudflare Worker, Firebase, фото, голосу, PWA и уведомлениям.

## Текущие настройки, требующие внимания

- `AI_ENDPOINT` настроен на опубликованный Cloudflare Worker `my-nutritionist-advice`.
- CORS Worker разрешает только origin GitHub Pages `https://phazz1980.github.io`.
- Firebase Web config в `firebase-client.js` заполнен для проекта `my-nutritionist-67ce8`.
- `googleAuthReady = false`: Google Authentication намеренно не активирован до настройки Google provider/support email/authorized domain.
- `OPENAI_API_KEY` должен существовать только как Cloudflare Worker secret; в репозитории его быть не должно.

## Проверенная конфигурация Worker

- Адаптеры `worker/src/providers/index.js` и `worker/src/providers/openai.js` присутствуют и подключены.
- Worker создан в Cloudflare как `my-nutritionist-advice`, GitHub-репозиторий подключён для сборок.
- `OPENAI_API_KEY` добавлен пользователем в Cloudflare как секрет и не находится в репозитории.
- Домен `workers.dev` включён; URL Worker настроен в клиенте.

## Ключевые архитектурные решения

- GitHub Pages содержит только публичный клиентский код.
- ИИ-секреты хранятся только в Cloudflare Worker secrets.
- Worker не имеет Firebase service account и не записывает дневник.
- Ответ ИИ имеет единый контракт `{ advice, proposedMeal }`.
- `proposedMeal` является предложением: запись выполняется только после явного подтверждения пользователя.
- Фото JPEG/PNG/WebP до 4 МБ отправляется на один ИИ-запрос и по умолчанию не сохраняется.
- Голосовой режим использует браузерные Web Speech API / Speech Synthesis и не требует отдельного аудио-backend.
- Service Worker кэширует оболочку приложения; облачные Firebase/ИИ-функции требуют сети.

## Известные ограничения / незавершённая внешняя настройка

- Нужно проверить запрос к Worker после публикации сайта на GitHub Pages.
- Google sign-in пока отключён.
- Надёжные межустройственные push-уведомления/FCM не настроены; текущая реализация — локальная браузерная заготовка.
- Фото постоянно не хранятся; Firebase Storage не настроен и сейчас не требуется.

## Следующий рекомендуемый шаг

1. Включить GitHub Pages для ветки `main` и проверить опубликованный сайт.
2. Отправить тестовый вопрос во вкладке «Совет» и убедиться, что Worker отвечает.
3. При необходимости настроить Firebase и Google sign-in отдельно.

## Для следующей сессии Codex

Сначала прочитать `AGENTS.md`, этот файл и `README.md`, затем выполнить `git status` и проверить фактические файлы. Не считать Worker готовым к публикации, пока не решено отсутствие `worker/src/providers/`.
