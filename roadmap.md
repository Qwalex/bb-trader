Коротко — проект уже сильно усилен, но для следующего качественного шага я бы сделал вот это:

- **Ротация секретов как отдельный инцидент-плейбук**  
  Не просто “потом заменю”, а чеклист + дедлайн + подтверждение, что старые ключи реально отозваны у провайдеров.

- **Единый server-side auth для web API route’ов**  
  Сейчас часть страниц делает прямые `fetch`. Лучше централизовать через один API client/обертку с единым retry, auth headers и обработкой 401/403.

- **Rate limit на чувствительные endpoint’ы**  
  `settings`, `orders/*`, `bybit/*`, `telegram-userbot/*` — ограничить частоту запросов (например через Nest throttler), чтобы исключить случайный/злой спам.

- **Аудит-лог админских действий**  
  Кто/когда вызвал `reset`, `purge-secrets`, ручной `close`, редактирование PnL/source. Это сильно помогает при разборе инцидентов.

- **Декомпозиция `bybit.service.ts` (реальный refactor, не косметика)**  
  Выделить `BybitOrderService`, `BybitPositionService`, `BybitPnlService`, `BybitReconcileService` + фасад. Снизит риск регрессий.

- **Фоновая очередь для тяжёлых операций**  
  `recalc closed pnl`, bulk-операции userbot, diagnostics — через очередь/воркер с persistence и retry policy.

- **WAL и busy_timeout для SQLite**  
  Для стабильности под конкурирующей нагрузкой (`poll + web + userbot`).

Если хочешь, могу следующим сообщением дать конкретный **roadmap на 2 спринта** (что в Sprint 1 / Sprint 2, с оценкой по сложности и риску).

---

## Отдельно: roadmap по пайплайну сигналов через БД и воркеры

Цель: перевести обработку сигналов на устойчивую stage-модель, где каждый шаг пишет состояние в БД, а следующие шаги обрабатываются фоновыми воркерами.

### Целевая схема

1. **Userbot ingest worker**
   - принимает сообщения Telegram;
   - пишет в БД сырое событие (`incoming message`) со статусом `pending_ai`.

2. **OpenRouter AI worker**
   - читает записи `pending_ai`;
   - выполняет классификацию/парсинг;
   - сохраняет структурный результат и действия (`signal/action plan`);
   - переводит запись в `pending_execution` или `ignored/failed`.

3. **Bybit execution worker**
   - читает `pending_execution`;
   - выставляет/обновляет/закрывает ордера;
   - фиксирует результат (`executed/failed/retry_scheduled`).

### Этап 1 (минимальный, без big-bang)

- Добавить таблицу задач обработки сообщения (например `UserbotMessageTask`):
  - `id`, `chatId`, `messageId`, `payload`, `stage`, `status`, `attempts`, `nextRetryAt`, `lastError`, `createdAt`, `updatedAt`.
- Сделать idempotency-ограничение по `chatId + messageId`.
- Перенести OpenRouter parse/classify в фоновый cron-воркер.
- В основном обработчике userbot оставить только ingest + enqueue.
- Добавить детальные stage-логи в БД (`queued`, `claimed`, `processed`, `failed`).

### Этап 2 (исполнение ордеров в фоне)

- Добавить таблицу действий (например `TradeActionTask`):
  - `signalId`, `actionType`, `payload`, `status`, `attempts`, `nextRetryAt`, `lastError`.
- Перенести вызовы Bybit в execution worker.
- Добавить protection от дублей исполнения (idempotency key на действие).
- Ввести backoff policy и terminal states (`failed_permanent`).

### Этап 3 (наблюдаемость и эксплуатация)

- Dashboard/виджеты:
  - количество `pending/failed` по каждому stage;
  - среднее время от ingest до execution.
- Команды админа:
  - `requeue task`, `force fail`, `retry now`.
- Алерты:
  - рост очереди;
  - >N ошибок подряд по OpenRouter/Bybit.

### Технические принципы

- Один источник истины по состоянию — БД.
- Каждая стадия атомарно меняет `status` + пишет `lastError`.
- Claim-механизм для воркеров (чтобы одну задачу не взяли два воркера).
- Четкие terminal состояния: `done`, `ignored`, `failed_permanent`.

### Риски и как гасить

- **Дубли исполнения:** уникальные ключи + idempotency.
- **Зависшие задачи:** `nextRetryAt` + watchdog job.
- **Рост таблиц:** retention/purge для старых `done`/`ignored`.
- **Сложность миграции:** поэтапное включение через feature flags.

### Критерии готовности

- Userbot ingestion не блокируется ожиданием OpenRouter/Bybit.
- При временной недоступности внешних API задачи не теряются, а корректно ретраятся.
- По каждой задаче видно полный жизненный цикл в БД.

в этой схеме нужно понимание того что торговые сетапы могут устареть