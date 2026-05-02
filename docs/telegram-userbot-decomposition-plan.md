# План декомпозиции `telegram-userbot.service.ts`

**Цель:** довести модуль до тонкого фасада + доменных сервисов по образцу `apps/api/src/modules/bybit/`, сохранив поведение и публичный API `TelegramUserbotService` (`TelegramUserbotController`). Актуальные размеры (`wc -l`): фасад `telegram-userbot.service.ts` **~875**, оркестратор ingest `ingest/telegram-userbot-ingest-pipeline.service.ts` **~1236**, рядом lookup/reply/levels-watch/pair-direction в `ingest/*-ingest-*.service.ts`, скан `scan/telegram-userbot-scan.service.ts` **~314** (ориентиры на дату обновления документа).

**Ограничения проекта:** behavior-preserving рефакторинг; типы в `*.types.ts`, утилиты в `*.util.ts`; без искусственного дробления; автотесты не добавляем — DoD: `npm run build` в `apps/api` + ручной smoke.

**Связь:** общая очередь и волны W1–W5 см. `docs/refactor-decomposition-large-files-plan.md`, §1.

---

## Публичный контракт (контроллер → фасад)

Методы должны остаться на `TelegramUserbotService` (делегирование внутрь допускается):

- Статус: `getStatus`, `getTodayMetrics`
- Сессия: `connectFromStoredSession`, `disconnect`, `startQrLogin`, `getQrStatus`, `cancelQrLogin`
- Чаты: `syncChats`, `listChats`
- OpenRouter: `getOpenrouterSpendAnalytics`, `getOpenrouterBalance`
- Ingest: `listIngestLinkCandidates`, `scanTodayMessages`, `rereadIngestMessage`, `rereadAllIngestMessages`
- Фильтры: `listFilterGroups`, `listFilterExamples`, `listFilterPatterns`, `createFilterExample`, `deleteFilterExample`, `createFilterPattern`, `deleteFilterPattern`, `generateFilterPatterns`
- Публикация: `listPublishGroups`, `createOrUpdatePublishGroup`, `deletePublishGroup`
- Настройки чата: `updateChat`

Точные маршруты и имена — в `telegram-userbot.controller.ts` (при реализации не менять контракт API без согласования с web).

---

## Карта кластеров (по файлам, без жёстких номеров строк)

Нумерация строк в монолите устарела; ориентир — **имя файла / публичный метод**.

| Область | Где сейчас |
|---------|------------|
| Фасад `TelegramUserbotService` | `telegram-userbot.service.ts` — lifecycle, HTTP-методы, делегаты в `settings` / `filters` / `mirror` / `scan`, `handleIncomingMessage`, polling hooks, `refreshEnabledChatsCache` |
| Очередь ingest, `ingestChatMessage` | `ingest/telegram-userbot-ingest.service.ts` |
| `processIngestRecord`, classify, balance guard, уведомления об ошибках, pair-cooldown wait | `ingest/telegram-userbot-ingest-pipeline.service.ts` + `ingest/telegram-userbot-ingest-pair-direction.service.ts` |
| Reply (reentry/close/result без входа), `signalFromDb` | `ingest/telegram-userbot-ingest-signal-reply.service.ts` |
| Lookup по reply / external id, цепочка root, `fetchChatMessageMeta` | `ingest/telegram-userbot-ingest-signal-lookup.service.ts` |
| Edit-watch после `signal_levels_validation` | `ingest/telegram-userbot-ingest-levels-watch.service.ts` |
| `scanTodayMessagesCore`, `pollTick`, `getTodayMetrics`, курсор last-seen, окно recency | `scan/telegram-userbot-scan.service.ts` |
| MTProto / QR / сессия | `client/telegram-userbot-client.service.ts` |
| OpenRouter spend | `openrouter/telegram-userbot-openrouter.service.ts` |
| CRUD фильтров, matching | `filters/telegram-userbot-filters.service.ts` |
| Чаты / карты источников / `updateChat` | `settings/telegram-userbot-settings.service.ts` |
| Зеркало, publish groups | `mirror/telegram-userbot-mirror.service.ts` |
| Таймер цикла опроса | `polling/telegram-userbot-polling.service.ts` |

---

## Риски и меры

| Риск | Митигирование |
|------|----------------|
| Shared state (`clientsByUserId`, очереди, таймеры) | Один владелец состояния на домен (например отдельный `client/*` и `ingest/*` сервис); не дублировать мапы |
| `CabinetContextService` | Не кэшировать `cabinetId` в полях сервиса; оборачивать job’ы в `runWithCabinet` на границах |
| Циклы Nest | Доменные сервисы не экспортировать из модуля; утилиты без импорта сервисов; ingest не импортирует MTProto-auth напрямую — только тонкий API-слой или callback |
| Порядок шагов в `processIngestRecord` | Не менять порядок classify → parse → дедуп → confirm → place без отдельного аудита |
| `forwardRef` / require | Новые связи не усложнять; проверять старт приложения после каждой волны |

---

## Целевая структура каталогов

```
apps/api/src/modules/telegram-userbot/
  telegram-userbot.module.ts
  telegram-userbot.controller.ts
  telegram-userbot.service.ts          # тонкий фасад
  telegram-userbot.constants.ts
  telegram-userbot.types.ts
  telegram-userbot-source.util.ts
  userbot-signal-hash.*

  client/                              # MTProto, сессия, QR, attach
  polling/                             # poll loop, scan core
  ingest/                              # очередь, processIngestRecord, reply flows, lookup, edit-watch
  filters/                             # match + CRUD (или разделить при росте)
  mirror/                              # publish groups CRUD, зеркалирование
  openrouter/                          # spend, balance, cost util
  settings/                            # updateChat, transcript overrides, source maps
  utils/                               # parse, text, similarity (чистые функции)
```

Имена файлов — предложение (`telegram-userbot-mtproto.service.ts` и т.д.); уточнять при реализации.

**Правило зависимостей:** фасад и `TelegramUserbotModule` по-прежнему экспортируют только `TelegramUserbotService`; внутренние сервисы — `providers`, не `exports`.

---

## Волны реализации

### W1 — Утилиты и типы (низкий риск)

**Сделать:** вынести чистые функции (парсинг, similarity, форматирование mirror, openrouter cost, `read*` / `resolveChatId*` / `limitTrace`) в `utils/*.util.ts` и при необходимости `mirror/*-format.util.ts`.

**Оставить в фасаде:** все публичные методы; только заменить тела `private` helper’ов на вызовы утилит.

**DoD:** сборка; smoke: `GET status`, `GET chats`, `GET openrouter-balance`.

---

### W2 — MTProto / клиент / QR

**Сделать:** сервис(ы) в `client/`: сессия, connect/disconnect, QR, проверка авторизации, регистрация `NewMessage`, хранение `clientsByUserId` / QR state. Inbound: callback в ingest без прямого импорта тяжёлого ingest из auth.

**DoD:** сборка; connect или QR start/status/cancel; `syncChats`.

---

### W3 — Ingest (высокий риск, основной объём)

**Сделать:** очередь (`enqueue` / `pump` / `run`), `ingestChatMessage`, `processIngestRecord`, reply-сценарии, lookup, edit-watch, pair/cooldown guards. Возможная нарезка: `ingest-queue.service`, `ingest.service`, `signal-lookup.service`, `signal-levels-watch.service`.

**DoD:** сборка; realtime сообщение в чат; `scan-today`; `reread` по ingestId; при включённом confirm — ветка подтверждения.

---

### W4 — OpenRouter

**Сделать:** `openrouter.service` + cost util: аналитика, баланс, spend по чатам за день, уведомления.

**DoD:** сборка; `openrouter-spend`, `openrouter-balance`.

---

### W5 — Тонкий фасад

**Сделать:** `TelegramUserbotService` только делегирует в доменные сервисы; `onModuleInit`/`onModuleDestroy` координируют stop таймеров/дисконнект.

**DoD:** полный короткий smoke из W1–W4; размер фасада ориентировочно <800 строк (целевой ориентир плана).

---

## Чеклист после каждой волны

1. `npm run build` в `apps/api`.
2. Smoke: status → chats/sync → (опционально) QR или connect → тестовое сообщение в трекнутый чат → scan/reread при необходимости → openrouter endpoints.
3. После disconnect / destroy: нет «висящих» QR-задач и интервалов edit-watch.
4. Форматы ответов публичных методов не менять без обновления web.

---

## Повторный аудит размера

После завершения волн:

```bash
wc -l apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts
find apps/api/src/modules/telegram-userbot -name "*.ts" ! -path "*/node_modules/*" | xargs wc -l | sort -n
```

Обновить при необходимости `docs/refactor-decomposition-large-files-plan.md` (строка в таблице инвентаря).
