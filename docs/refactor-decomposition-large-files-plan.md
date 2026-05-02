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
| ~2420 | P0 | `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts` | API (ingest-пайплайн: `processIngestRecord` + reply/lookup/classify/watch; без цикла с фасадом) |
| 2270 | P0 | `apps/api/src/modules/telegram/telegram.service.ts` | API |
| 1741 | P1 | `apps/api/src/modules/transcript/transcript.service.ts` | API |
| 1663 | P1 | `apps/web/app/settings/page.tsx` | Web |
| 1626 | P1 | `apps/web/app/telegram-userbot/page.tsx` | Web |
| ~540 | — | `apps/api/src/modules/bybit/bybit.service.ts` | API (фасад после декомпозиции; см. §3) |
| 1388 | P2 | `apps/api/src/modules/vk/vk-bot.service.ts` | API |
| 1346 | P2 | `apps/api/src/modules/orders/orders.service.ts` | API |
| 962 | P3 | `apps/web/app/filters/page.tsx` | Web |

**В `packages/shared` и остальных путях** при том же сканировании файлов >800 **не обнаружено** (если появятся — добавить строкой в таблицу при следующем аудите).

Подмножество **>2000 строк** — сейчас **`telegram-userbot-ingest-pipeline.service.ts`** и **`telegram.service.ts`** (фасад userbot ~875 строк; Bybit-фасад из инвентаря >800 исключён как уже приведённый к целевому размеру). Для них — развёрнутые секции 1–2; §3 — статус Bybit-модуля.

---

## 1. `telegram-userbot.service.ts` (P0)

**Статус (код):** фасад `telegram-userbot.service.ts` **~875 строк** (`wc -l`, 2026-05); цель «&lt; ~800 строк» для фасада **почти достигнута**. Основной объём ingest-пайплайна перенесён в `ingest/telegram-userbot-ingest-pipeline.service.ts` (**~2420 строк**); сканирование/poll-тик и метрики дня — в `scan/telegram-userbot-scan.service.ts` (**~314 строк**). **Остаточный риск:** крупный pipeline-файл — при росте нарезать по `docs/telegram-userbot-decomposition-plan.md` (reply/lookup/watch отдельными сервисами).

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

## 2. `telegram.service.ts` (P0)

**Уже есть:** `telegram.constants.ts`, `telegram.types.ts`, `telegram-trade-parse.util.ts`.

**Наблюдаемые кластеры:**

1. Запуск/ретраи бота, мульти-кабинетные `Telegraf`, приветствие при старте, очистка памяти.
2. Whitelist, `runWithUserCabinet`, разрешение `source`, внешние подтверждения (`externalConfirmations`, клавиатуры).
3. Форматирование HTML/таблиц сигналов, клавиатуры (`confirmKeyboard`, меню, `splitTelegramHtml`).
4. Обработчики меню (summary, ratings, diagnostics, …) и сценарии черновиков (`drafts`).

**Предлагаемая стратегия:**

| Волна | Действие |
|-------|----------|
| W1 | Вынести **форматирование и клавиатуры** в `telegram-format.util.ts` / `telegram-keyboards.util.ts` (или один `telegram-ui.util.ts`, если не раздуется). |
| W2 | Вынести **external confirm** в `telegram-external-confirm.service.ts` или узкий helper + минимальный сервис. |
| W3 | Группировать **хендлеры по областям** (меню / диалоги / торговые команды) в подмодули `telegram/handlers/*` с регистрацией из фасада — только если границы ясны и нет циклических импортов. |

**DoD:** сборка API; смоук: старт бота, команда из whitelist, сценарий подтверждения сигнала (если используется).

---

## 3. Модуль `bybit` и `bybit.service.ts` (целевое состояние)

**Сделано:** доменная логика вынесена в отдельные сервисы (`instrument`, `exposure`, `orders`, `position`, `tpsl`, `pnl`, `poll`, `notify`, `overrides`, `types`); фасад `bybit.service.ts` — **~540 строк**, оркестрация и делегирование. Публичный API для остальных модулей по-прежнему **`BybitService`** (см. `docs/audit/06-progress-tracker.md`, AUD-038/AUD-039).

**Оставшаяся цель (низкий приоритет):** при росте фасада снова пройти файл сверху вниз; крупные оставшиеся регионы — кандидаты на новый `bybit-*.service.ts` только после проверки циклов с `TelegramService` / `OrdersService`. Риск `SEC-004` в реестре отражает это состояние как `mitigated` (остаточная внимательность к оркестрации на фасаде).

**DoD при дальнейших правках:** `npm run build` в `apps/api`; смоук торгового сценария (testnet) по операционному ранбуку.

---

## 4. `transcript.service.ts` (P1)

Крупный сервис расшифровки/LLM. **Направления:** вынести промпты и шаблоны в `transcript-prompts.constants.ts` или `transcript/*.util.ts`; отдельный слой для вызовов OpenRouter и нормализации ответов; типы ответов — в `transcript.types.ts` или расширение существующего файла типов. Сохранить единую точку входа для остальных модулей.

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
