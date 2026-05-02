# План рефакторинга и декомпозиции (крупные файлы монорепо)

Документ фиксирует **очередь** работ по уменьшению «god-файлов» в `apps/api` и `apps/web`. Правила декомпозиции: `.cursor/rules/decomposition-and-file-boundaries.mdc`, типы — `.cursor/rules/typing-separation-standard.mdc`, шаги без смены поведения там, где возможно.

**Ориентиры по размеру:** до **~800 строк** на файл — комфортная зона для навигации и работы с AI-агентом; **800+** — кандидаты на постепенную нарезку; **2000+** — высокий приоритет.

## Что не входит в инвентарь

Следующие пути **намеренно исключены** из поиска:

- `package-lock.json` и прочие lock-файлы (генерируемые артефакты).
- `scripts/**` (операционные скрипты, не прикладной код приложений).

Сборки и кэши (`dist/`, `.next/`, `.turbo/cache/`) не считаются исходниками.

---

## Инвентарь: >800 строк (TS/TSX в `apps/` и `packages/`)

Снимок на момент обновления документа (`wc -l`, без `node_modules` / `dist` / `.next`). Порог **>800**.

| Строк | Приоритет | Файл | Слой |
|------:|-------------|------|------|
| ~875 | P0 | `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts` | API (фасад: wiring, HTTP-делегаты, inbound, polling hooks) |
| ~1236 | P1 | `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts` | API (оркестратор `processIngestRecord` + classify/balance/notify; lookup/reply/watch/pair-cooldown — отдельные `ingest/*-service.ts`, см. AUD-044) |
| ~1241 | P1 | `apps/api/src/modules/telegram/services/telegram.service.ts` (+ `telegram/index.ts`, см. §2) | API (фасад после волн W1–W6; см. AUD-045, AUD-046, §2) |
| ~1524 | P1 | `apps/api/src/modules/transcript/transcript.service.ts` | API (часть промптов/JSON-схем вынесена в `transcript-prompt-builders.util.ts`, `transcript-model-json-schemas.ts`; см. AUD-047, §4) |
| 1663 | P1 | `apps/web/app/settings/page.tsx` | Web |
| 1626 | P1 | `apps/web/app/telegram-userbot/page.tsx` | Web |
| ~540 | — | `apps/api/src/modules/bybit/bybit.service.ts` | API (фасад после декомпозиции; см. §3) |
| 1388 | P2 | `apps/api/src/modules/vk/vk-bot.service.ts` | API |
| 1346 | P2 | `apps/api/src/modules/orders/orders.service.ts` | API |
| 962 | P3 | `apps/web/app/filters/page.tsx` | Web |

**В `packages/shared` и остальных путях** при том же сканировании файлов >800 **не обнаружено** (если появятся — добавить строкой в таблицу при следующем аудите).

Подмножество **>2000 строк** в `apps/api` на момент обновления — **ingest-pipeline** (`telegram-userbot-ingest-pipeline.service.ts`, **~1236** строк, 2026-05); фасад userbot ~875 строк; `telegram.service.ts` после AUD-046 — **~1241** строк (ниже порога 2000). Bybit-фасад из инвентаря >800 исключён как уже приведённый к целевому размеру. Для крупных кандидатов — развёрнутые секции 1–2; §3 — статус Bybit-модуля.

---

## 1. `telegram-userbot.service.ts` (P0)

**Статус (код):** фасад `telegram-userbot.service.ts` **~875 строк** (`wc -l`, 2026-05); цель «&lt; ~800 строк» для фасада **почти достигнута**. Оркестратор ingest — `ingest/telegram-userbot-ingest-pipeline.service.ts` (**~1236 строк**); рядом `ingest/telegram-userbot-ingest-signal-lookup.service.ts`, `ingest/telegram-userbot-ingest-signal-reply.service.ts`, `ingest/telegram-userbot-ingest-levels-watch.service.ts`, `ingest/telegram-userbot-ingest-pair-direction.service.ts` (AUD-044). Сканирование/poll-тик и метрики дня — в `scan/telegram-userbot-scan.service.ts` (**~314 строк**).

**Рядом с фасадом (после волн):** `utils/`, `openrouter/`, `client/`, `ingest/` (`TelegramUserbotIngestService` + очередь; `TelegramUserbotIngestPipelineService` — `processIngestRecord` и цепочка), `scan/` (`TelegramUserbotScanService`), `polling/`, `filters/`, `settings/`, `mirror/`; плюс `telegram-userbot.constants.ts`, `telegram-userbot.types.ts`, `telegram-userbot-source.util.ts`, `userbot-signal-hash.*`.

**Наблюдаемые домены внутри монолита (ориентиры для нарезки):**

1. **Клиент MTProto и сессия** — карты `clientsByUserId`, QR-логин (`qrClientByUserId`, `qrStateByUserId`), `attachClient`, переподключение (`tryReconnectFromStoredSession`).
2. **Polling и фоновые таймеры** — `pollTimer`, `pollTick`, `startPollingLoop` / `stopPollingLoop`, интервалы из настроек.
3. **Очередь и воркеры ingest** — `processingQueue`, `enqueueIngestJob`, `pumpIngestQueue`, `runIngestJob`, `processIngestRecord`.
4. **Обработка входящих сообщений** — `handleIncomingMessage`, `ingestChatMessage`, фильтры/паттерны (`matchFilterKindByExamples`, `matchFilterKindByPatterns`), re-entry/reply.
5. **Расходы OpenRouter и алерты** — `getTodayOpenRouterSpendByChatId`, бакеты периодов, `notifyOpenrouterLowBalance`, извлечение cost из ответов.
6. **Карты источников (TP/SL, мартингейл, шаги)** — чтение/запись настроек по источникам, валидация уровней с таймерами.
7. **Связка с торговлей** — вызовы `BybitService`, `OrdersService`, дедуп/хеш (частично уже `UserbotSignalHashService`).

**Предлагаемая стратегия волн:**

| Волна | Действие | Риск |
|-------|----------|------|
| W1 | Вынести чистые утилиты (числа, сходство текста, parse helpers) в `*.util.ts` без изменения сигнатур публичного API модуля. | Низкий |
| W2 | Выделить **UserbotTelegramClientService** (или аналог): подключение, QR, reconnect, `attachClient`, регистрация handler. | Средний (состояние сессии) |
| W3 | Выделить **UserbotIngestOrchestrator** (очередь + `runIngestJob` + запись в БД на этапе ingest). | Средний |
| W4 | Вынести **OpenRouter spend / budget** в отдельный сервис или `openrouter-spend.util.ts` + тонкий сервис. | Низкий–средний |
| W5 | Сжать `TelegramUserbotService` до координации и делегирования (как текущий `BybitService` к доменным сервисам). | Средний |

**DoD для каждой волны:** `npm run -w apps/api build`; ручная проверка: приём сообщений из отслеживаемых чатов, QR-флоу при необходимости, отсутствие регрессов в логах `/logs`.

---

## 2. `telegram` (P1; фасад `services/telegram.service.ts`, ~1241 строк)

**Раскладка каталога:** `telegram/telegram.module.ts`; публичный barrel `telegram/index.ts` (`TelegramModule`, `TelegramService`, основные типы) — внешние модули импортируют `from '…/telegram'`; внутри модуля — `services/` (Nest-сервисы + `services/index.ts`), `utils/` (`*.util.ts` + `utils/index.ts`), `types/`, `constants/`.

**Уже есть (утилиты и UI, AUD-045):** в `utils/`: `telegram-trade-parse.util.ts`, `telegram-html.util.ts`, `telegram-keyboards.util.ts`, `telegram-dashboard-html.util.ts`, `telegram-signal-message-format.util.ts`, `telegram-api-notify-html.util.ts`, `telegram-external-request-key.util.ts`, `telegram-trade-event-titles.util.ts`, `telegram-trade-status.util.ts`; в `types/` — `telegram.types.ts`; в `constants/` — `telegram.constants.ts`.

**Уже есть (волны 2–6, AUD-046):** в `utils/` — `telegram-whitelist.util.ts`, `telegram-draft.util.ts`; в `services/` — `telegram-conversation-state.service.ts`, `telegram-bot-registry.service.ts`, `telegram-chat-menu.service.ts`, `telegram-signal-draft-flow.service.ts`. На фасаде `registerHandlers` разбит на приватные `registerTelegramAccessMiddleware` / `registerTelegramMainMenuHandlers` / `registerTelegramDraftActionHandlers` / `registerTelegramUserbotActionHandlers` / `registerTelegramMediaHandlers` + `clearTelegramInlineKeyboard`. Отдельный `TelegramBotBootstrapService` не введён: запуск и карта ботов сосредоточены в `TelegramBotRegistryService` + `initializeBots` на фасаде (достаточно для текущего размера).

**Остаётся на фасаде:** bootstrap (`initializeBots`, retry, приветствие, cleanup-таймеры), whitelist/cabinet wiring, `registerHandlers` как точка сборки, уведомления по событиям сделок, `requestExternalSignalConfirmation` и связка с userbot-коллбеками.

**Предлагаемая стратегия (остаток):**

| Волна | Статус / действие |
|-------|---------------------|
| W1 | **Сделано:** форматирование и клавиатуры в перечисленных `*.util.ts` (см. выше). |
| W2 | **Сделано:** whitelist parse в `telegram-whitelist.util.ts`; ключи external — `telegram-external-request-key.util.ts`; состояние подтверждений — в `TelegramConversationStateService`. |
| W3 | **Сделано:** меню/диагностика — `TelegramChatMenuService` (Nest-провайдер), без подпапки `handlers/` (граница по файлу сервиса). |
| Дальше | По росту фасада: опционально `TelegramBotBootstrapService` или дальнейший перенос notify/bootstrap при >~1000 строк на фасаде. |

**DoD:** сборка API; смоук: старт бота, команда из whitelist, сценарий подтверждения сигнала (если используется).

---

## 3. Модуль `bybit` и `bybit.service.ts` (целевое состояние)

**Сделано:** доменная логика вынесена в отдельные сервисы (`instrument`, `exposure`, `orders`, `position`, `tpsl`, `pnl`, `poll`, `notify`, `overrides`, `types`); фасад `bybit.service.ts` — **~540 строк**, оркестрация и делегирование. Публичный API для остальных модулей по-прежнему **`BybitService`** (см. `docs/audit/06-progress-tracker.md`, AUD-038/AUD-039).

**Оставшаяся цель (низкий приоритет):** при росте фасада снова пройти файл сверху вниз; крупные оставшиеся регионы — кандидаты на новый `bybit-*.service.ts` только после проверки циклов с `TelegramService` / `OrdersService`. Риск `SEC-004` в реестре отражает это состояние как `mitigated` (остаточная внимательность к оркестрации на фасаде).

**DoD при дальнейших правках:** `npm run build` в `apps/api`; смоук торгового сценария (testnet) по операционному ранбуку.

---

## 4. `transcript.service.ts` (P1)

Крупный сервис расшифровки/LLM. **Сделано (AUD-047, первая волна):** строгие JSON-схемы для OpenRouter — `transcript-model-json-schemas.ts`; текстовые промпты и правила разбора/классификатора/паттернов — `transcript-prompt-builders.util.ts` (`buildJsonSchemaRules`, `buildSystemPrompt`, `normalizeOpenRouterAudioFormat`, `buildTradingMessageClassifierPrompt`, `buildFilterPatternGenerationPrompt`). Фасад по-прежнему `TranscriptService`.

**Остаётся:** слой вызовов OpenRouter (`callOpenRouter`, ретраи, логирование) и нормализация ответов (`parseModelContent`, `tryParseModelContent`, …) — кандидаты на `transcript-openrouter-*.service.ts` или узкие `*.util.ts` без смены публичного API; при необходимости расширить `transcript.types.ts`.

**DoD:** `npm run -w apps/api build`; смоук: один проход расшифровки тестового сообщения.

---

## 5. `settings/page.tsx` и 6. `telegram-userbot/page.tsx` (P1)

Страницы настроек с большим количеством секций и форм. **Направления:** разбить на компоненты `app/settings/*` или `components/settings/*` по секциям; вынести типы форм и константы ключей; общие куски (карточки, поля, вызовы API) — в переиспользуемые компоненты/hooks.

**DoD:** `npm run -w apps/web build`; ручная проверка: сохранение настроек и отображение ошибок API.

---

## 7. `vk-bot.service.ts` (P2)

По структуре сопоставим с Telegram-ботом: жизненный цикл, хендлеры, форматирование. **Направления:** зеркалировать подход из секции 2 — `vk-*.util.ts` для текста/клавиатур, опционально подпапка `vk/handlers/*`, общие вещи с Telegram только через `packages/shared`, если появится реальное дублирование.

**DoD:** сборка API; смоук отправки/ответа в VK (если среда подключена).

---

## 8. `orders.service.ts` (P2)

Оркестрация заказов и состояний в БД. **Направления:** вынести маппинг DTO и чистую логику статусов в `orders-*.util.ts`; тяжёлые сценарии (reconcile, дубликаты пар) — в отдельные сервисы при повторном дублировании с Bybit.

**DoD:** сборка API; смоук списка ордеров в UI или через API.

---

## 9. `filters/page.tsx` (P3)

**Направления:** таблицы/модалки вынести в `components/filters/*`; состояние фильтров — в hook `useFiltersPage.ts` при росте логики.

**DoD:** `npm run -w apps/web build`; открытие страницы и применение фильтра.

---

## Связанные документы

- `docs/audit/06-progress-tracker.md` — карточки выполненных волн по Bybit/Telegram.
- `docs/audit/07-full-audit-backlog.md` — общий бэклог аудита.
- `docs/telegram-userbot-decomposition-plan.md` — поэтапный план декомпозиции `telegram-userbot.service.ts` (ведётся по мере реализации).

---

## Повторный аудит размера

Порог **800** (полный список кандидатов):

```bash
find apps packages -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -path "*/node_modules/*" ! -path "*/dist/*" ! -path "*/.next/*" | while read -r f; do
  n=$(wc -l < "$f"); [ "$n" -gt 800 ] && echo "$n $f"
done | sort -rn
```

Порог **2000** (тяжёлые монолиты API):

```bash
find apps/api/src -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -path "*/node_modules/*" ! -path "*/dist/*" | while read -r f; do
  n=$(wc -l < "$f"); [ "$n" -gt 2000 ] && echo "$n $f"
done | sort -rn
```

Исключения плана (`package-lock.json`, `scripts/**`) в перечисление не входят — они вне `apps/` / `packages/` или не являются TS/TSX.
