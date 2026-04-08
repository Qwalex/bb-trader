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

- **Набор smoke-check скриптов после деплоя**  
  Автоматически проверять: health, auth, readonly endpoints, mutate endpoints, статус userbot, bybit live.

Если хочешь, могу следующим сообщением дать конкретный **roadmap на 2 спринта** (что в Sprint 1 / Sprint 2, с оценкой по сложности и риску).