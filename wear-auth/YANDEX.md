# Сервис сопряжения в Yandex Cloud

Сервис развёрнут 09.10.2026: `https://functions.yandexcloud.net/d4e5bfebi143u6kitt0v`, версия `d4e538jobh5uc76a89s8`, Node.js 22, 128 МБ, 30 секунд, публичный вызов подтверждён пользователем. Lockbox подключён, логи выключены, YDB wear_pairing/deleteAt TTL ENABLED. Лимиты на зону: 1 экземпляр, 2 одновременных вызова, без резервирования экземпляров. Проверены реальные start/poll/cancel (pending/cancelled), отказ approve без входа 401, чужой origin 403 и разрешённый OPTIONS 204 с no-store. Подтверждение телефона, подпись custom token и Firebase-вход часов ещё не проверены.

Ниже — инструкция повторного развёртывания. Этот вариант не использует Cloud Run или именованную Firestore-базу; Google Cloud billing для них подключать не нужно. Используются существующий Firebase Auth и отдельные Yandex Cloud Functions + YDB + Lockbox. У Yandex возможны расходы; лимиты не являются месячным денежным бюджетом. Это не обход региональных ограничений.

## Изоляция и подготовка

1. В Yandex создайте новую функцию `wear-auth` и отдельный сервисный аккаунт `x20-wear-auth`. Не изменяйте функцию `nutrition`, её аккаунт `x20-ai`, AI-ключ или таблицу квот.
2. Создайте отдельную serverless-базу YDB с Document API для сопряжения. Дайте `x20-wear-auth` роль `ydb.editor` только на этой базе, а не на базе дневника/расходов ИИ. Запишите её публичный Document API endpoint. Постоянный ключ YDB не нужен: адаптер берёт IAM token из `context.token.access_token` при каждом вызове.
3. Через Document API `CreateTable` создайте документную таблицу по `ydb-table.json` (`wear_pairing`, единственный HASH-ключ `id`, String). Не создавайте обычную SQL-таблицу вместо документной. Включите `UpdateTimeToLive` с JSON:

   ```json
   {"TableName":"wear_pairing","TimeToLiveSpecification":{"AttributeName":"deleteAt","Enabled":true}}
   ```

   `deleteAt` — число секунд Unix, TTL удаляет асинхронно. Приложение само запрещает истёкшие 5-минутные коды даже до физического удаления. Таблица хранит хеш секрета, временный UID, статус и ревизию; custom token и пароль не записываются. UID очищается при успешной выдаче/отмене. Запись с CAS и согласованное чтение не допускают повторную выдачу при параллельных вызовах. Счётчики лимитов хранятся в этой же отдельной таблице с TTL.

## Google signing key — только Lockbox

Для работы вне Google-managed runtime нужен приватный ключ **отдельного Google service account `wear-auth`**, не `firebase-adminsdk`. В Google Cloud → IAM & Admin → Service accounts → wear-auth → Keys → Add key → Create new key → JSON. Если создание ключей запрещено политикой организации, не отключайте защиту: остановитесь и согласуйте другой способ (Workload Identity Federation).

Ключ даёт возможность подписывать Firebase-токены любого UID этого проекта: храните его как особо чувствительный серверный секрет. Роль Firebase Authentication Viewer уже назначена для проверки отзыва токена. Назначенные ранее права на именованную Firestore-базу здесь не используются; право signBlob через Google IAM для локальной подписи приватным ключом также не требуется.

Не присылайте JSON в чат, не кладите в репозиторий, ZIP, APK, `firebase.properties`, браузерный конфиг или AI-функцию. Перенесите весь JSON в отдельный секрет Yandex Lockbox (ключ записи `firebase-service-account-json`). Аккаунту `x20-wear-auth` выдайте `lockbox.payloadViewer` только на этом секрете. Привяжите запись к переменной версии функции `FIREBASE_SERVICE_ACCOUNT_JSON` через раздел «Секреты», не как обычную переменную. После настройки обеспечьте безопасное удаление/хранение скачанного файла вне репозитория и возможность ротации/отзыва ключа.

## ZIP и версия функции

Из корня проекта:

```powershell
& .\wear-auth\build-yandex.ps1
```

Сборщик использует явный список файлов. В `wear-auth/function.zip` включены только код, package.json и lockfile, без node_modules, ключей или локальных конфигураций. Функция устанавливает Firebase Admin SDK по package.json.

В новой функции выберите Node.js 22, источник ZIP, прикрепите `function.zip`, точка входа `index.handler`, память 256 МБ, таймаут 30 секунд, аккаунт `x20-wear-auth`. Ограничьте число экземпляров/вызовов и настройте бюджет; лимиты приложения не заменяют защиту от DoS. Для вызова до входа часы требуют публичный доступ к этой **отдельной** функции; это не делает Firestore/YDB публичными. Не включайте логирование тела запроса/заголовков/секретов.

Обычные переменные:

| Переменная | Значение |
|---|---|
| FIREBASE_PROJECT_ID | my-nutritionist-67ce8 |
| WEB_APP_URL | https://nutriciolog-x20.website.yandexcloud.net |
| ALLOWED_ORIGINS | https://nutriciolog-x20.website.yandexcloud.net |
| YDB_DOCAPI_ENDPOINT | Document API endpoint отдельной базы |
| YDB_PAIRING_TABLE | wear_pairing |

Секрет: `FIREBASE_SERVICE_ACCOUNT_JSON` из Lockbox. Не добавляйте BLACKROUTE_API_KEY или права Firestore/ИИ-таблиц.

## Подключение клиентов и приёмка

Получите адрес `https://functions.yandexcloud.net/<FUNCTION_ID>`, без `?integration=raw`. Передайте только публичный URL. В PWA `js/wear-config.js` и локальном Android `WEAR_AUTH_ENDPOINT` должен быть одинаковый адрес. Клиенты Yandex используют `?action=start|inspect|approve|poll|cancel`; телефон передаёт Firebase token в `X-X20-Authorization`, потому что стандартный Authorization может обрабатываться платформой. Адаптер восстанавливает только этот пользовательский заголовок. CORS разрешает точный origin, не `*`, API не кэшируется.

Пересоберите APK, обновите versionCode перед установкой релиза, опубликуйте PWA с новой версией/тегом. Проверьте start → inspect → отдельное approve → poll → Firebase signInWithCustomToken на часах. Также: отмену, истечение, повторное использование, другой UID, сеть и отсутствие доступа auth-сервиса к дневнику. Потеря ответа с токеном требует нового кода. Локальные mock-тесты не подтверждают реальную работу YDB, Lockbox и Firebase.

Документация: [Node.js функция](https://yandex.cloud/ru/docs/functions/quickstart/create-function/node-function-quickstart), [контекст и IAM token](https://yandex.cloud/ru/docs/functions/lang/nodejs/context), [Lockbox в функции](https://yandex.cloud/ru/docs/lockbox/operations/serverless/functions), [YDB TTL](https://yandex.cloud/ru/docs/ydb/docapi/api-ref/actions/updateTimeToLive), [Firebase Admin вне Google](https://firebase.google.com/docs/admin/setup).
