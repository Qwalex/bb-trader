# Operational Runbooks

## Incident Classes

- Auth/session failures.
- Exchange execution mismatch.
- Signal parsing degradation.
- External provider downtime (Telegram/VK/OpenRouter/Bybit).

## Generic Response Steps

1. Triage and classify severity.
2. Stabilize user-facing behavior (degrade safely).
3. Capture logs and affected IDs.
4. Apply rollback/hotfix.
5. Document root cause and preventive action.

## Mandatory Artifacts

- Incident summary.
- Scope and impact.
- Mitigation and residual risk.
- Follow-up `AUD-###` task IDs.

## Railway: SSH, переменные и кабинеты в БД

Кабинеты **не задаются отдельными env** (кроме косвенных вроде `BYBIT_WS_MULTI_CABINET` в настройках). Список кабинетов и привязка сделок живут в **PostgreSQL** (`Cabinet`, `Signal.cabinetId`, `AuthUser` и т.д.).

### Подготовка CLI

Из корня репозитория (после `railway link`):

```bash
railway status
railway service <имя-сервиса-API>   # если «No service linked»
```

Дальше примеры с сервисом **`api`** (замените на своё имя из дашборда Railway).

### Переменные среды (без вывода полного `DATABASE_URL`)

```bash
railway ssh -s api 'printenv | grep -i CABINET || true'
railway ssh -s api 'test -n "$DATABASE_URL" && echo DATABASE_URL=set || echo DATABASE_URL=missing'
```

Ожидаемо: строк с `CABINET_*` нет. Важно, что **`DATABASE_URL`** у сервиса API указывает на ту же БД, куда пишутся сделки (плагин Postgres в Railway → переменная привязана к сервису API).

### Список таблиц и кабинетов в Postgres (через Prisma в контейнере)

```bash
railway ssh -s api 'cd /app/apps/api && node -e "
const { PrismaClient } = require(\"@prisma/client\");
const p = new PrismaClient();
const run = async () => {
  const tables = await p.\$queryRawUnsafe(
    \"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\",
  );
  console.log(\"tables:\", tables.map((t) => t.tablename).join(\", \"));
  try {
    const cabs = await p.cabinet.findMany({ orderBy: { createdAt: \"asc\" }, take: 50 });
    console.log(JSON.stringify(cabs, null, 2));
  } catch (e) {
    console.error(\"cabinet:\", e.message);
  }
};
run().finally(() => p.\$disconnect());
"'
```

Если **`relation \"Cabinet\" does not exist`** или в списке таблиц **нет `Cabinet`**, а в `Signal` **нет колонки `cabinetId`**: схема БД отстаёт от репозитория — нужен **`npx prisma migrate deploy`** (или восстановление бэкапа) на **той** базе, что в `DATABASE_URL`, и проверка что Web/API смотрят в одну БД.

### Симптом: в Network к `/api/backend/cabinets?cabinetId=…` уходит один id, а HTML `/trades` — всегда одни сделки

Частая причина (исправлено в коде): **клиентский** `fetchApi` раньше подставлял кабинет **только из `localStorage`**, а **SSR** страницы `/trades` брал **`?cabinetId=` из URL и cookie** — контексты расходились. Сейчас в браузере используется тот же приоритет, что и в `readActiveCabinetIdClient`: **URL → `localStorage` → cookie**.

### Подключение к Postgres как к сервису (альтернатива)

```bash
railway connect <имя-postgres-сервиса>
```

Дальше в `psql`: `\dt` и `SELECT * FROM "Cabinet" LIMIT 20;`.

## Telegram assist-бот (long polling): таймауты и диагностика

Окружение ветки **`cabinets`** на Railway → сервис **API** (не Web). Не выводить в чат полный `TELEGRAM_BOT_TOKEN`.

### Исходящий HTTPS к Bot API

```bash
railway ssh -s api 'curl -sS -o /dev/null -w "code=%{http_code} time_total=%{time_total}\n" "https://api.telegram.org/"'
```

Ожидается быстрый ответ (обычно менее 2 с). Долгое `time_total` или зависание — проверить egress/DNS и лимиты Railway.

### Переменные только по именам

```bash
railway ssh -s api 'printenv | grep -E "^TELEGRAM_BOT_" || true'
```

Проверить наличие при необходимости: `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS`, `TELEGRAM_BOT_LAUNCH_STAGGER_MS`, `TELEGRAM_BOT_DELETE_WEBHOOK_TIMEOUT_MS`.

### Реплики и дубликаты

- Для long polling на один токен держите **одну реплику** сервиса API (или отдельный режим с webhook), иначе возможны конфликты `getUpdates`.
- Убедитесь, что нет второго процесса (локальный бот, старый деплой) с тем же токеном.

### Логи в приложении

После деплоя с фазовыми логами в Nest ищите строки `Telegram bot launch phase=…` и `activePhase=` при ошибке; в `/logs` (AppLog) — предупреждения по запуску и `Telegram bot launch recovered` после восстановления.

## QPulse sync (signalsBot ↔ QPulse)

Полная карта для агентов: **`docs/qpulse-ecosystem.md`**. QPulse admin (seed): `admin@qpulse.app` / `admin123` — см. QPulse `docs/runbooks/deploy-railway.md`.

Кабинетные ключи в БД (`Setting`): `QPULSE_SYNC_ENABLED`, `QPULSE_API_URL`, `QPULSE_API_KEY`. UI: `/my-group`.

На QPulse API (Railway, ветка `master` / production): `INTEGRATIONS_API_KEY` — тот же секрет, что `QPULSE_API_KEY` в кабинете.

```bash
# QPulse — задать ключ интеграции (после railway link на qpulse-api)
openssl rand -hex 32   # сохранить локально
railway variables set INTEGRATIONS_API_KEY="<key>" -s qpulse-api

# signalsBot — redeploy cabinets после migrate
cd /path/to/signalsBotProd
railway link   # environment cabinets
railway service api
railway redeploy
```

Проверка: ingest сигналов в группу с `linkedToApp=true` → `POST /integrations/signals` в логах QPulse; группа без галочки — только Telegram mirror.
