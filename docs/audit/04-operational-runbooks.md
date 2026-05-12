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
