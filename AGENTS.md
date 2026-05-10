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
- Ежедневный дайджест в Telegram-боте (баланс USDT, Σ PnL/winrate, закрытия за 24 ч, дельты к кумулятиву до окна, топы источников): env `TELEGRAM_DAILY_DIGEST_CRON` (по умолчанию `0 0 9 * * *` — 09:00 UTC), выключение `TELEGRAM_DAILY_DIGEST_ENABLED=false`; получатели — `TELEGRAM_WHITELIST` кабинета, только если у кабинета запущен бот.
- Запуск Telegraf на кабинет (`deleteWebhook` + `launch`): таймаут задаётся `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS` (по умолчанию 60000 мс, диапазон 5000–180000); при медленной сети к Bot API имеет смысл поднять на Railway.
- Сигналы: подтверждение в Telegram перед выставлением ордеров; при неполных данных — многоходовый сбор с сохранением контекста до готовности.
- Проверка дубликата пары: при наличии ключей Bybit приоритет у состояния биржи по API; торговая пара нормализуется для БД и запросов; зависшие записи `ORDERS_PLACED` в БД снимаются при «чистой» бирже.
- TP: только отдельные reduce-only лимитки после исполнения всех входов — **по одному ордеру на каждый уровень TP**, объём позиции делится поровну между уровнями; SL на позицию через `setTradingStop` Full; при слишком малом лоте число уровней уменьшается или один ордер на первый TP.
- Логи ключевых этапов и обмена с OpenRouter (без утечки секретов) хранятся в БД и доступны на странице `/logs`.
- **Модуль Telegram (API):** `apps/api/src/modules/telegram` — вложенные папки `services/` (Nest-сервисы), `utils/` (`*.util.ts`), `types/`, `constants/`; в каждой папке есть `index.ts` (barrel). Публичный вход: `telegram/index.ts` — снаружи импорт `TelegramModule` / `TelegramService` через `from '…/telegram'` или `from './modules/telegram'`, не через старые пути `telegram/telegram.service`. Подробности: `.cursor/rules/telegram-module-layout.mdc`.
- **Модуль transcript (API):** снаружи только **`TranscriptService`**. OpenRouter вынесены в `transcript-openrouter-parse.util.ts`, `transcript-openrouter-model-chain.service.ts`, `transcript-openrouter-billing.service.ts`, `transcript-openrouter-client.service.ts`; в **`transcript.module.ts`** для биллинга generation cost подключён **`CabinetModule`** (см. AUD-048).
- **Userbot (API):** фасад `telegram-userbot.service.ts` — координация; часть ingest (в т.ч. `listIngestLinkCandidates`, `rereadIngestMessage`, `rereadAllIngestMessages`) — в **`ingest/telegram-userbot-ingest-pipeline.service.ts`** (см. AUD-048, `docs/telegram-userbot-decomposition-plan.md`). **Одна** глобальная MTProto-сессия на **AuthUser** (`TELEGRAM_USERBOT_SESSION_OWNER_USER_ID` в `Setting`, при QR/ручном connect); клиент общий для всех кабинетов этого пользователя — в UI «подключено», если `cabinet.ownerUserId` совпадает с владельцем сессии. Восстановление после деплоя: `connectFromStoredSession({ sessionOwnerUserId })` без выбора кабинета; если ключ владельца пуст — fallback при ровно одном `AuthUser` в БД. Выключение автоподъёма: `TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE=true` (см. AUD-069). Несколько реплик API с одной и той же MTProto-сессией могут гоняться за соединением и провоцировать повторный вход (AUD-078).
- **Крупные страницы Web (App Router):** рядом с `page.tsx` допустимы **`settings-page.constants.ts` / `settings-page.util.ts`**, **`filters-page.*`**, **`telegram-userbot-page.util.ts`** — константы, чистые хелперы и типы без смешивания с JSX (см. `.cursor/rules/decomposition-and-file-boundaries.mdc`).

### Railway (деплой)

- Два сервиса из одного репозитория: **API** и **Web**; отдельно **PostgreSQL** (New → Database → PostgreSQL, привязать к API).
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

## Cursor Cloud specific instructions

### Сервисы и запуск

- **PostgreSQL:** требуется Docker. Запуск: `sudo dockerd &>/tmp/dockerd.log &` (если демон не запущен), затем `sudo docker run -d --name signals-postgres -e POSTGRES_USER=signals -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals -p 5432:5432 postgres:16-alpine`. Docker в Cloud Agent VM — nested Docker-in-Docker, нужен fuse-overlayfs и iptables-legacy (см. инструкции ниже).
- **API (NestJS):** `npm run dev -w api` — порт 3001, healthcheck `GET /health` → `{"status":"ok"}`. Swagger: `http://localhost:3001/docs`.
- **Web (Next.js 16):** `npm run dev -w web` — порт 3000, healthcheck `GET /health` → 200.
- **Lint:** `npm run lint` (turbo, все workspace'ы). Только warnings, 0 errors.
- **Build:** `npm run build` (turbo, вся сборка).

### Env для локальной разработки

- `cp .env.example .env && cp .env apps/api/.env` — базовый набор переменных с dev-дефолтами (PostgreSQL `signals:signals@localhost:5432/signals`).
- `AUTH_ALLOW_PUBLIC_REGISTER=true` — для создания пользователя через `POST /auth/register`.
- `API_INTERNAL_URL=http://localhost:3001` в `.env` обязательна при локальном запуске (без Docker), иначе Next.js SSR пойдёт на `http://api:3001` (Docker-hostname).

### Миграции БД

- `cd apps/api && npx prisma migrate deploy` — применение миграций (idempotent).
- `cd apps/api && npx prisma generate` — генерация Prisma Client (включена в update script).

### Docker-in-Docker (Cloud Agent VM)

Если dockerd не запущен, инициализация:
1. Установка: `sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin fuse-overlayfs iptables`
2. Конфиг: `sudo mkdir -p /etc/docker && echo '{"storage-driver":"fuse-overlayfs"}' | sudo tee /etc/docker/daemon.json`
3. iptables legacy: `sudo update-alternatives --set iptables /usr/sbin/iptables-legacy && sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy`
4. Запуск: `sudo dockerd &>/tmp/dockerd.log &`

### Auth (hello-world)

- Регистрация: `POST /auth/register` с `{"login":"admin","password":"TestPass123!"}` (поле `login`, не `username`).
- Логин: `POST /auth/login` — возвращает `accessToken` (JWT Bearer).

### Порядок сборки shared-пакетов

`@repo/shared` → `@repo/api` → далее `api` и `web`. Update script уже включает `npm run build -w @repo/shared` и `npm run build -w @repo/api`.
