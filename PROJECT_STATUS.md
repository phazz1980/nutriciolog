# PROJECT_STATUS.md — текущее состояние проекта

Последняя проверка репозитория: 2026-09-15

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

- В `index.html` `AI_ENDPOINT` всё ещё равен `https://YOUR-WORKER.workers.dev/api/advice`. Реальный Worker URL не подключён в этой копии.
- В `worker/src/index.js` CORS всё ещё содержит `https://YOUR_GITHUB_USERNAME.github.io`. Перед публикацией нужен реальный GitHub Pages origin.
- Firebase Web config в `firebase-client.js` заполнен для проекта `my-nutritionist-67ce8`.
- `googleAuthReady = false`: Google Authentication намеренно не активирован до настройки Google provider/support email/authorized domain.
- `OPENAI_API_KEY` должен существовать только как Cloudflare Worker secret; в репозитории его быть не должно.

## Важное обнаруженное несоответствие

`worker/src/index.js` импортирует:

`./providers/index.js`

но в предоставленном архиве `x20.zip` папки/файлов `worker/src/providers/` нет. README также описывает эту структуру и адаптеры провайдеров. В текущем виде Worker из этого архива не сможет успешно загрузить этот импорт.

Перед развёртыванием Worker нужно либо восстановить отсутствующие provider-файлы из актуальной версии проекта, либо реализовать их как отдельную согласованную задачу. Не маскировать эту проблему случайным изменением архитектуры.

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

- Нужен реальный URL Cloudflare Worker в `AI_ENDPOINT`.
- Нужен реальный разрешённый GitHub Pages origin в CORS Worker.
- Нужно проверить/восстановить отсутствующий `worker/src/providers/`.
- Google sign-in пока отключён.
- Надёжные межустройственные push-уведомления/FCM не настроены; текущая реализация — локальная браузерная заготовка.
- Фото постоянно не хранятся; Firebase Storage не настроен и сейчас не требуется.

## Следующий рекомендуемый шаг

1. Найти актуальную версию `worker/src/providers/` или подтвердить, что её нужно реализовать заново.
2. После этого локально проверить Worker на корректность импортов и контракт `{ advice, proposedMeal }`.
3. Настроить реальный Cloudflare Worker URL и GitHub Pages CORS origin.
4. Только после проверки выполнить публикацию/синхронизацию через GitHub.

## Для следующей сессии Codex

Сначала прочитать `AGENTS.md`, этот файл и `README.md`, затем выполнить `git status` и проверить фактические файлы. Не считать Worker готовым к публикации, пока не решено отсутствие `worker/src/providers/`.
