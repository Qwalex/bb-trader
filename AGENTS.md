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
- Репозиторий использует **npm**-скрипты (без `pnpm` в корневых/пакетных scripts); базовый шаблон переменных — корневой `.env.example`.
- Docker compose healthcheck для Postgres параметризован через `POSTGRES_USER`/`POSTGRES_DB` (с безопасными дефолтами), чтобы dev/test/prod окружения не требовали правок YAML.
- Расшифровка сигналов — OpenRouter; бот — Telegraf; запросы к LLM могут быть долгими — таймауты обработчика и HTTP выставлены с большим запасом (порядка 180 с).
- Загрузка переменных: корень монорепозитория и `apps/api` (поздний файл перекрывает ранний). Значения в БД со страницы `/settings` для того же ключа перекрывают переменные окружения.
- Bybit: отдельные ключи для testnet (`BYBIT_API_KEY_TESTNET` / `BYBIT_API_SECRET_TESTNET`) и mainnet (`BYBIT_API_KEY_MAINNET` / `BYBIT_API_SECRET_MAINNET`); переключение `BYBIT_TESTNET`; общих legacy-ключей `BYBIT_API_KEY` / `BYBIT_API_SECRET` в логике нет.
- Клиент Bybit (`bybit-api`) может отдавать ошибки не как `Error`; перед логом и сообщением в чат нормализовать в строку (например общим `formatError`).
- Bybit при нескольких кабинетах: private WS по умолчанию не поднимается (`BYBIT_WS_MULTI_CABINET=auto`, см. `BybitClientService`); каждый REST к Bybit на кабинет идёт через `BybitRateLimitService.runBybitCall` — одна очередь на кабинет, интервал `BYBIT_ACCOUNT_REQUEST_INTERVAL_MS` между запросами, backoff/retry при rate limit (`retCode=10006` и аналоги); `BYBIT_ACCOUNT_MAX_CONCURRENCY>1` в рантайме игнорируется (ключ зарезервирован); placement/stale in-memory ключи включают `cabinetId`.
- Массовое приветствие в Telegram при старте API: доставка возможна только пользователям, которые уже открыли чат с ботом (ограничение Telegram).
- Ежедневный дайджест в Telegram-боте (баланс USDT, Σ PnL/winrate, закрытия за 24 ч, дельты к кумулятиву до окна, топы источников): env `TELEGRAM_DAILY_DIGEST_CRON` (по умолчанию `0 0 9 * * *` — 09:00 UTC), выключение `TELEGRAM_DAILY_DIGEST_ENABLED=false`; получатели — `TELEGRAM_WHITELIST` кабинета **и** числовой Telegram владельца кабинета и активных участников (`CabinetMember`), только если у кабинета запущен бот. Тот же состав получателей для проактивных уведомлений бота (ошибки userbot, события сделки и т.д.).
- Запуск Telegraf на кабинет (`deleteWebhook` + `launch`): **глобальная очередь** — одновременно не более одного launch на процесс API; между запусками — пауза `TELEGRAM_BOT_LAUNCH_STAGGER_MS` (по умолчанию 2000 мс, `0` — выкл.). Таймаут одной попытки: `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS` (по умолчанию 60000 мс, диапазон 5000–180000); при медленной сети к Bot API имеет смысл поднять на Railway.
- У каждого кабинета свой `TELEGRAM_BOT_TOKEN` в настройках (или env с разрешением по кабинету): long polling поднимает `syncBotsWithCabinetTokens` из **`OnApplicationBootstrap`** (после Prisma/кабинета/настроек, без гонки с `onModuleInit`); **исходящие** уведомления (userbot, диагностика, сделки и т.д.) идут через Telegraf кабинета в процессе либо через временный клиент по токену этого кабинета — без подмены бота другого кабинета и с доставки с реплики API, где нет активного `getUpdates` (входящие апдейты по-прежнему только там, где успешно `launch`).
- Сигналы: подтверждение в Telegram перед выставлением ордеров; при неполных данных — многоходовый сбор с сохранением контекста до готовности.
- Проверка дубликата пары: при наличии ключей Bybit приоритет у состояния биржи по API; торговая пара нормализуется для БД и запросов; зависшие записи `ORDERS_PLACED` в БД снимаются при «чистой» бирже.
- TP: только отдельные reduce-only лимитки после исполнения всех входов — **по одному ордеру на каждый уровень TP**, объём позиции делится поровну между уровнями; SL на позицию через `setTradingStop` Full; при слишком малом лоте число уровней уменьшается или один ордер на первый TP.
- Логи ключевых этапов и обмена с OpenRouter (без утечки секретов) хранятся в БД и доступны на странице `/logs`.
- **Модуль Telegram (API):** `apps/api/src/modules/telegram` — вложенные папки `services/` (Nest-сервисы), `utils/` (`*.util.ts`), `types/`, `constants/`; в каждой папке есть `index.ts` (barrel). Публичный вход: `telegram/index.ts` — снаружи импорт `TelegramModule` / `TelegramService` через `from '…/telegram'` или `from './modules/telegram'`, не через старые пути `telegram/telegram.service`. Подробности: `.cursor/rules/telegram-module-layout.mdc`.
- **Модуль transcript (API):** снаружи только **`TranscriptService`**. OpenRouter вынесены в `transcript-openrouter-parse.util.ts`, `transcript-openrouter-model-chain.service.ts`, `transcript-openrouter-billing.service.ts`, `transcript-openrouter-client.service.ts`; в **`transcript.module.ts`** для биллинга generation cost подключён **`CabinetModule`** (см. AUD-048).
- **Userbot (API):** фасад `telegram-userbot.service.ts` — координация; часть ingest (в т.ч. `listIngestLinkCandidates`, `rereadIngestMessage`, `rereadAllIngestMessages`) — в **`ingest/telegram-userbot-ingest-pipeline.service.ts`** (см. AUD-048, `docs/telegram-userbot-decomposition-plan.md`). **Одна** глобальная MTProto-сессия на **AuthUser** (`TELEGRAM_USERBOT_SESSION_OWNER_USER_ID` в `Setting`, при QR/ручном connect); клиент общий для всех кабинетов этого пользователя — в UI «подключено», если `cabinet.ownerUserId` совпадает с владельцем сессии. Восстановление после деплоя: `connectFromStoredSession({ sessionOwnerUserId })` без выбора кабинета; если ключ владельца пуст — fallback при ровно одном `AuthUser` в БД. Выключение автоподъёма: `TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE=true` (см. AUD-069). Актуальная строка `TELEGRAM_USERBOT_SESSION` периодически и при graceful shutdown записывается в БД из GramJS (`TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS`), чтобы после редеплоя не откатываться на устаревшую сессию. **Несколько реплик API** с одной и той же MTProto-сессией по-прежнему могут гоняться за соединением и провоцировать повторный вход — для стабильности userbot держите **одну реплику** сервиса API (см. AUD-078, AUD-093).
- **Крупные страницы Web (App Router):** рядом с `page.tsx` допустимы **`settings-page.constants.ts` / `settings-page.util.ts`**, **`filters-page.*`**, **`telegram-userbot-page.util.ts`** — константы, чистые хелперы и типы без смешивания с JSX (см. `.cursor/rules/decomposition-and-file-boundaries.mdc`).

### Railway (деплой)

- **Ветка → окружение:** `cabinets` → окружение `cabinets`, `master` → `production`, `test` → `test`, `ultra` → `ultra`. В каждом окружении одинаковый набор: **Web**, **API**, **PostgreSQL**.
- **Диагностика:** при необходимости допустим **Railway SSH** в контейнер сервиса; если требуется авторизация в Railway или недоступен CLI/ключ — агент **уведомляет пользователя** и не продолжает без его участия (см. `.cursor/rules/railway-diagnostics-and-branches.mdc`).
- Два сервиса приложения из одного репозитория: **API** и **Web**; отдельно **PostgreSQL** (New → Database → PostgreSQL, привязать к API).
- **Railpack** (билдер по умолчанию на Railway): в корне **`railpack.json`** — Node 22, сборка через **`npm run build -w`** (shared → api / shared → api types → web), старт `start:railway` (без `turbo.json` в образе). Для сервиса **Web** в Variables задать **`RAILPACK_CONFIG_FILE=railpack.web.json`** (путь относительно корня репо). Nixpacks-конфиги удалены из репозитория как неиспользуемые.
- Если удобнее без JSON: переменные **`RAILPACK_INSTALL_CMD`** (`npm ci`), **`RAILPACK_BUILD_CMD`**, **`RAILPACK_START_CMD`** (см. [Railpack env](https://railpack.com/config/environment-variables)).
- **Порт и healthcheck:** Railway подставляет **`PORT`**; API слушает **`PORT`**, затем `API_PORT`. В UI сервиса указать **Config-as-code** → **`/railway.api.toml`** и **`/railway.web.toml`** соответственно (health: **`/health`**, таймаут 120 с). У web маршрут `GET /health` в приложении; если задан **`NEXT_BASE_PATH`**, в `railway.web.toml` поправить **`healthcheckPath`** на `/<basePath>/health`. При фильтрации по Host разрешить **`healthcheck.railway.app`** ([док](https://docs.railway.com/deployments/healthchecks)).
- **Переменные API:** как локально + `DATABASE_URL`; `API_SWAGGER_SERVER` без nginx-прокси — часто `/` или полный публичный URL API.
- **Web:** `NEXT_PUBLIC_API_URL=https://<api>.up.railway.app`, `API_INTERNAL_URL` — тот же или internal URL; корень домена — `NEXT_BASE_PATH` не задавать.
- **Docker:** `Dockerfile.api` / `Dockerfile.web`, контекст — корень репозитория.

## Audit Execution Memory

- Базовая аудит-документация ведется в `docs/audit/*`:
  - `00-system-map.md`
  - `01-env-and-secrets-matrix.md`
  - `02-deploy-and-rollback.md`
  - `03-security-risks-register.md`
  - `04-operational-runbooks.md`
  - `05-agent-work-contract.md`
  - `06-progress-tracker.md`
- План полного покрытия и очередность волн поддерживаются в `docs/audit/07-full-audit-backlog.md`.
- Любая заметная доработка должна синхронно обновлять минимум `06-progress-tracker.md`; при рисках/уязвимостях также обновлять `03-security-risks-register.md`.
- Для крупного аудита вести работу малыми карточками `AUD-###`: одновременно только одна `in_progress`, остальные `todo/blocked/done`, и обязательно фиксировать ручную проверку.
- Стандарт декомпозиции: утилиты, константы, хуки, типы, мапперы и адаптеры выносить в отдельные файлы (предпочтительно 1 сущность = 1 файл), но без искусственного дробления.
- Политика деплоя: Railway-only. VPS restart-скрипты и VPS-specific GitHub workflows не поддерживаются в этом репозитории.
