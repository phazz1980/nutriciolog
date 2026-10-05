# Тестовый AI-шлюз x20 в Yandex Cloud Functions

Клиент настроен на https://functions.yandexcloud.net/d4evergfv4q48plpsdbu. Авторизация,
провайдеры и контракт `{ advice, proposedMeal, proposedProducts }` общие с Worker.
Фото не сохраняются. Квоты и биллинг пока не реализованы.

## Подготовка

Из корня репозитория: `python yandex/build.py`.
Архив `yandex/function.zip` содержит только обработчик и серверные модули.

## Создание тестовой функции

1. Создать функцию `x20-ai-test` в выбранном каталоге Yandex Cloud.
2. Создать версию: Node.js 22 (или более новый поддерживаемый runtime), 256 МБ,
   таймаут 60 секунд, точка входа `index.handler`; загрузить `function.zip`.
3. Указать переменные окружения:
   - `AI_PROVIDER=blackroute`
   - `BLACKROUTE_MODEL=deepseek-v3.2-maas`
   - `BLACKROUTE_VISION_MODEL=gemini-2.5-flash`
4. Секрет `BLACKROUTE_API_KEY` подключить из Yandex Lockbox в одноимённую
   переменную. Выдать сервисному аккаунту функции доступ только к нужному секрету
   (роль `lockbox.payloadViewer`). Ключ не помещать в ZIP, Git или клиент.
5. Разрешить публичный вызов функции. Это открывает вход HTTPS, но AI всё равно
   требует проверенный Firebase ID token. Не использовать `integration=raw`.
6. GET `https://functions.yandexcloud.net/<ID>` должен показать health JSON.
   Это проверяет запуск и наличие ключа, но не доказывает доступ к Blackroute.

## Авторизация и переключение

Yandex при прямом HTTP-вызове удаляет `Authorization`, поэтому Firebase-токен
передаётся в `X-X20-Authorization: Bearer <Firebase ID token>`. Обработчик
восстанавливает его для общей проверки подписи. Токен нигде не логируется.
Клиент автоматически выбирает этот заголовок для `functions.yandexcloud.net`.
Для будущего собственного домена/API Gateway потребуется явная конфигурация
заголовка; текущая автоматическая настройка относится только к прямому URL.

Для теста отдельной копии сайта заменить `AI_ENDPOINT` в `js/ai-client.js`
на URL тестовой функции. Origins ограничены двумя текущими доменами. Новый
тестовый домен нужно явно добавить в ALLOWED_ORIGINS и Firebase Authorized domains.
Не менять рабочий сайт до проверки текста, фото, 401, CORS и доступа без VPN.
Откат: вернуть прежний AI_ENDPOINT. Публикация сайта требует повышения версии
интерфейса и кэша согласно AGENTS.md.

Фото перед отправкой преобразуются в JPEG до 1600 px и 1 400 000 символов
Base64 data URL. Исходный лимит выбора 4 МБ сохранён. Обработчик ограничивает
JSON body 1 800 000 байт. Сжатие может ухудшить чтение мелких этикеток;
проверить на физических Android/iPhone. Фото остаётся только в памяти запроса.

Общий таймаут вызовов модели, включая повтор, 45 секунд; клиент — 60 секунд.
При превышении сервер возвращает 504. Проверка Google JWK выполняется отдельно.

## Проверки

`node --test tests/core.test.mjs tests/yandex.test.mjs`

Документация платформы:
- https://yandex.cloud/ru/docs/functions/concepts/function-invoke
- https://yandex.cloud/en/docs/functions/lang/nodejs/handler

Нужны внешние проверки: реальный вход Firebase, доступ функции к Google JWK
и Blackroute, обработка фото, доступ из РФ и других стран, счёт и метрики.
