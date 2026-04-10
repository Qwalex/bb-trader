# Agent memory (signalsBot)

## Learned User Preferences

- **Автотесты:** в репозитории не используются; агент не создаёт тесты и тестовую инфраструктуру (правило `.cursor/rules/no-automated-tests.mdc`).
- Предпочитать русский язык для ответов и текстов в Telegram-боте.
- При выборе уровня доступа к боту — более простой вариант (whitelist по user id без лишних шагов).
- Поле источника сигнала (`source`) — это название канала/группы/приложения для сравнения качества сигналов (например Binance Killers, Crypto Signals), а не тип контента (text/image/audio).
- Архитектура проекта: NestJS-монолит + отдельный Next.js, Docker Compose, REST между web и API; очереди — опционально позже.
- Дашборд на старте — средний уровень (фильтры, графики PnL), не минимальный.

## Learned Workspace Facts

- Монорепо: API в `apps/api` (NestJS), web в `apps/web` (Next.js 16), общие типы в `packages/shared`, БД через Prisma и **PostgreSQL** (`DATABASE_URL`). Локально и в Docker — сервис `postgres` в compose; на Railway — плагин PostgreSQL и переменная `DATABASE_URL` на сервисе API.
- Расшифровка сигналов — OpenRouter; бот — Telegraf; запросы к LLM могут быть долгими — таймауты обработчика и HTTP выставлены с большим запасом (порядка 180 с).
- Загрузка переменных: корень монорепозитория и `apps/api` (поздний файл перекрывает ранний). Значения в БД со страницы `/settings` для того же ключа перекрывают переменные окружения.
- Bybit: отдельные ключи для testnet (`BYBIT_API_KEY_TESTNET` / `BYBIT_API_SECRET_TESTNET`) и mainnet (`BYBIT_API_KEY_MAINNET` / `BYBIT_API_SECRET_MAINNET`); переключение `BYBIT_TESTNET`; общих legacy-ключей `BYBIT_API_KEY` / `BYBIT_API_SECRET` в логике нет.
- Клиент Bybit (`bybit-api`) может отдавать ошибки не как `Error`; перед логом и сообщением в чат нормализовать в строку (например общим `formatError`).
- Массовое приветствие в Telegram при старте API: доставка возможна только пользователям, которые уже открыли чат с ботом (ограничение Telegram).
- Сигналы: подтверждение в Telegram перед выставлением ордеров; при неполных данных — многоходовый сбор с сохранением контекста до готовности.
- Проверка дубликата пары: при наличии ключей Bybit приоритет у состояния биржи по API; торговая пара нормализуется для БД и запросов; зависшие записи `ORDERS_PLACED` в БД снимаются при «чистой» бирже.
- TP: только отдельные reduce-only лимитки после исполнения всех входов — **по одному ордеру на каждый уровень TP**, объём позиции делится поровну между уровнями; SL на позицию через `setTradingStop` Full; при слишком малом лоте число уровней уменьшается или один ордер на первый TP.
- Логи ключевых этапов и обмена с OpenRouter (без утечки секретов) хранятся в БД и доступны на странице `/logs`.

### Railway (деплой)

- Два сервиса из одного репозитория: **API** и **Web**; отдельно **PostgreSQL** (New → Database → PostgreSQL, привязать к API).
- **Railpack** (билдер по умолчанию на Railway): в корне **`railpack.json`** — Node 22, сборка `turbo` только для **api**, старт `start:railway`. Для сервиса **Web** в Variables задать **`RAILPACK_CONFIG_FILE=railpack.web.json`** (путь относительно корня репо). Файлы **`nixpacks.toml`** при Railpack **не используются**.
- Если удобнее без JSON: переменные **`RAILPACK_INSTALL_CMD`** (`npm ci`), **`RAILPACK_BUILD_CMD`**, **`RAILPACK_START_CMD`** (см. [Railpack env](https://railpack.com/config/environment-variables)).
- **Переменные API:** как локально + `DATABASE_URL`; `API_SWAGGER_SERVER` без nginx-прокси — часто `/` или полный публичный URL API.
- **Web:** `NEXT_PUBLIC_API_URL=https://<api>.up.railway.app`, `API_INTERNAL_URL` — тот же или internal URL; корень домена — `NEXT_BASE_PATH` не задавать.
- **Docker:** `Dockerfile.api` / `Dockerfile.web`, контекст — корень репозитория.
