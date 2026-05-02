# План рефакторинга и декомпозиции (крупные файлы API)

Документ фиксирует **отдельную очередь** работ по уменьшению «god-файлов» в `apps/api`. Правила декомпозиции: `.cursor/rules/decomposition-and-file-boundaries.mdc`, типы — `.cursor/rules/typing-separation-standard.mdc`, шаги без смены поведения там, где возможно.

## Что не входит в инвентарь

Следующие пути **намеренно исключены** из поиска «больших файлов» для этого плана:

- `package-lock.json` и прочие lock-файлы (генерируемые артефакты).
- `scripts/**` (операционные скрипты, не прикладной код API).

Сборки и кэши (`dist/`, `.next/`, `.turbo/cache/`) также не считаются исходниками.

## Инвентарь (порог: >2000 строк, TypeScript в `apps/api`)

| Приоритет | Файл | Строк (оценка на момент составления) | Примечание |
|-----------|------|--------------------------------------|------------|
| P0 | `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts` | ~5508 | Основной долг; один сервис тянет MTProto, очередь ingest, парсинг, настройки источников, уведомления. |
| P1 | `apps/api/src/modules/telegram/telegram.service.ts` | ~2270 | Telegraf: жизненный цикл бота, хендлеры, меню, подтверждения, форматирование. |
| P2 | `apps/api/src/modules/bybit/bybit.service.ts` | ~2211 | Фасад после многих вынесенных сервисов; остаётся толстым слоем оркестрации. |

Пересчёт: `wc -l` по перечисленным путям (без lock и `scripts/`).

---

## 1. `telegram-userbot.service.ts` (P0)

**Уже есть рядом:** `telegram-userbot.constants.ts`, `telegram-userbot.types.ts`, `telegram-userbot-source.util.ts`, `userbot-signal-hash.*`.

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

## 2. `telegram.service.ts` (P1)

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

## 3. `bybit.service.ts` (P2)

**Уже вынесено (фрагменты):** `bybit-client.service`, `bybit-poll`, `bybit-tpsl`, `bybit-pnl`, `bybit-notify`, `bybit-recalc`, `bybit-signal-placement`, `bybit-position-close`, `bybit-order-lifecycle-poll`, `balance-snapshot`, `bybit-exposure`, утилиты и `bybit-ports.types`.

**Оставшаяся цель:** довести фасад до **тонкой оркестрации** — по возможности группировать оставшиеся методы по сценариям и вынести следующие крупные блоки в отдельные сервисы только после явного аудита зависимостей (избегать новых циклов с `TelegramService` / `OrdersService`).

**Предлагаемая стратегия:**

1. Пройти файл **сверху вниз** и пометить оставшиеся регионы (комментарии или внутренний чеклист в задаче).
2. Для каждого региона >~200–300 строк: кандидат на новый `bybit-*.service.ts` + делегирование из `BybitService`.
3. Сохранить **единую точку входа** для других модулей (`BybitService`), чтобы не плодить импорты десятка сервисов снаружи модуля.

**DoD:** сборка; регрессионная ручная проверка торгового сценария (testnet): размещение, TP/SL, закрытие по минимальному happy-path из операционного ранбука.

---

## Связанные документы

- `docs/audit/06-progress-tracker.md` — карточки выполненных волн по Bybit/Telegram.
- `docs/audit/07-full-audit-backlog.md` — общий бэклог аудита.

---

## Повторный аудит размера

После серии волн полезно перезапустить:

```bash
find apps/api/src -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -path "*/node_modules/*" ! -path "*/dist/*" | while read -r f; do
  n=$(wc -l < "$f"); [ "$n" -gt 2000 ] && echo "$n $f"
done | sort -rn
```

Исключения этого плана (`package-lock.json`, `scripts/**`) к команде не добавляются — они не лежат под `apps/api/src`.
