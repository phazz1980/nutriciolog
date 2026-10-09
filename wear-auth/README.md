# Отдельный сервис входа Wear OS с телефона

Основной выбранный вариант после отказа от Google billing — [Yandex Cloud Functions + отдельная YDB + Lockbox](YANDEX.md). Сервис опубликован по адресу `https://functions.yandexcloud.net/d4e5bfebi143u6kitt0v`. Проверены создание/опрос/отмена кода, отказ без авторизации и CORS. Реальное подтверждение телефона и Firebase-вход часов ещё не проверены. Описанный ниже Cloud Run остаётся альтернативой и требует своей настройки/биллинга.

Node.js 22+, Firebase Admin SDK, HTTPS endpoint. Не добавляйте этот код, service account или права подписи в AI Worker / Yandex AI-функцию. Сервис не читает и не записывает дневник.

Часы создают 5-минутный код и приватный случайный секрет устройства. Телефон проверяет код и явно подтверждает под собственным Firebase ID token; UID берётся только из проверенного токена. Часы получают одноразовый custom token, входят штатным Firebase Android SDK и далее обращаются к дневнику напрямую по существующим правилам UID. В базе хранится хеш секрета, не сам секрет, пароль или custom token. Повторная выдача блокируется транзакцией; потеря ответа требует нового кода. Отмена и истечение проверяются при каждом запросе, независимо от TTL.

## Развёртывание

Для Cloud Run приложен Dockerfile. Настройка облака и возможные расходы требуют отдельного решения владельца проекта; автоматически тариф/биллинг не включаются.

1. Создайте отдельную runtime identity сервиса и Firestore Native database для временных сессий (предпочтительно именованную `wear-auth`, изолированную IAM от базы дневника). Именованная база и TTL могут требовать биллинг. Не выдавайте Owner/Editor и не используйте identity ИИ-шлюза.
2. Runtime использует Application Default Credentials, без JSON приватного ключа в контейнере. Нужны права чтения пользователя Firebase Auth для проверки отзыва (`firebaseauth.users.get`), `iam.serviceAccounts.signBlob` на выбранном signer account и доступ к документам только выделенной базы через IAM condition по database resource. Включите необходимые Auth, Firestore и IAM API. Admin SDK обходит клиентские Firestore Rules, поэтому именно IAM должен изолировать дневник. Правила клиентского доступа к выделенной базе: запретить все чтения и записи.
3. Установите переменные окружения:

   - `FIREBASE_PROJECT_ID`: проект аккаунтов PWA и часов.
   - `FIREBASE_SIGNER_EMAIL`: service account из этого проекта, подписывающий Firebase custom tokens.
   - `FIRESTORE_DATABASE_ID`: `wear-auth` (по умолчанию код использует `(default)`, но это не рекомендуемая изоляция).
   - `WEB_APP_URL`: полный HTTPS URL PWA.
   - `ALLOWED_ORIGINS`: точные HTTPS origins PWA через запятую, без `*`, пути и завершающего слеша.
   - `PORT`: задаётся платформой, иначе 8080.

4. Для collection groups `_wearPairing` и `_wearPairingLimits` включите TTL по Timestamp-полю `deleteAt`. Удаление TTL асинхронное, не гарантировано сразу после 5 минут; UID хранится до завершения/отмены либо очистки. Успешная выдача и отмена очищают UID сразу. Отключите индексирование TTL-поля, если оно не используется запросами.
5. Разверните контейнер с HTTPS и публичным вызовом API (часы до входа анонимны). Ограничьте масштабирование/расходы платформы и настройте мониторинг ошибок. Встроенный общий лимит создания 120/мин и проверки 30/мин на UID не заменяет полноценную защиту от DoS.
6. Задайте HTTPS адрес сервиса в `js/wear-config.js` и `WEAR_AUTH_ENDPOINT` в локальном `wearos/firebase.properties`; пересоберите часы и опубликуйте PWA, повышая её версию и тег по AGENTS.md. Не кэшируйте auth API в service worker, не журналируйте тела/Authorization/токены, не допускайте proxy-кэширование.

API: POST `/start`, `/inspect`, `/approve`, `/poll`, `/cancel`, JSON до 4096 байт; OPTIONS для разрешённых origins. `/inspect` и `/approve` требуют Bearer Firebase ID token, `/poll` и `/cancel` — код и deviceSecret. Все ответы `Cache-Control: no-store`. CORS защищает браузерные origins, не является авторизацией.

Проверка: `npm ci --ignore-scripts`, `npm test`. Тесты используют транзакционный in-memory store, реальные Firebase/IAM/TTL и вход на физических часах проверяются после развёртывания.

Документация: [Firebase custom tokens и signBlob](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [управление базами Firestore](https://cloud.google.com/firestore/docs/manage-databases), [TTL](https://firebase.google.com/docs/firestore/ttl), [стоимость именованной базы/TTL](https://cloud.google.com/firestore/pricing).
