# Protected API Surface

## Public Endpoints

- `GET /health`
- `POST /auth/login`
- `GET /vk/callback`
- `POST /vk/callback`

## Protected Endpoints (Require Auth Token)

### Auth
- `GET /auth/me`

### Cabinets
- `GET /cabinets`

### Logs
- `GET /logs`

### Diagnostics
- `POST /diagnostics/run-latest`
- `GET /diagnostics/runs`
- `GET /diagnostics/runs/:id`
- `POST /diagnostics/trading-advice`
- `GET /diagnostics/memory`

### Settings
- `GET /settings`
- `GET /settings/raw`
- `GET /settings/dashboard-todos`
- `PUT /settings/dashboard-todos`
- `PUT /settings`
- `POST /settings/reset-database`
- `POST /settings/incident/purge-secrets`

### Orders
- `GET /orders/stats`
- `GET /orders/pnl-series`
- `GET /orders/trades`
- `DELETE /orders/trades/:id`
- `POST /orders/trades/delete-all`
- `POST /orders/trades/:id/restore`
- `PATCH /orders/trades/:id/source`
- `PATCH /orders/trades/:id/telegram-source`
- `PATCH /orders/trades/:id/pnl`
- `GET /orders/by-source`
- `GET /orders/top-sources`
- `GET /orders/sources`
- `POST /orders/reset-stats`
- `GET /orders/by-pair`

### Bybit
- `GET /bybit/live`
- `GET /bybit/balance-history`
- `GET /bybit/signal/:signalId`
- `GET /bybit/trade-pnl-breakdown/:signalId`
- `POST /bybit/close/:signalId`
- `POST /bybit/recalc-closed-pnl`
- `GET /bybit/recalc-closed-pnl/:jobId`

### Telegram Userbot
- `GET /telegram-userbot/status`
- `GET /telegram-userbot/metrics/today`
- `POST /telegram-userbot/connect`
- `POST /telegram-userbot/disconnect`
- `POST /telegram-userbot/qr/start`
- `GET /telegram-userbot/qr/status`
- `POST /telegram-userbot/qr/cancel`
- `POST /telegram-userbot/chats/sync`
- `GET /telegram-userbot/chats`
- `GET /telegram-userbot/openrouter-spend`
- `GET /telegram-userbot/openrouter-balance`
- `GET /telegram-userbot/ingest-link-candidates`
- `POST /telegram-userbot/scan-today`
- `POST /telegram-userbot/reread/:ingestId`
- `POST /telegram-userbot/reread-all`
- `GET /telegram-userbot/filters/groups`
- `GET /telegram-userbot/filters/examples`
- `GET /telegram-userbot/filters/patterns`
- `GET /telegram-userbot/publish-groups`
- `POST /telegram-userbot/publish-groups`
- `POST /telegram-userbot/publish-groups/:id/delete`
- `POST /telegram-userbot/filters/examples`
- `POST /telegram-userbot/filters/examples/:id/delete`
- `POST /telegram-userbot/filters/patterns`
- `POST /telegram-userbot/filters/patterns/:id/delete`
- `POST /telegram-userbot/filters/patterns/generate`
- `PUT /telegram-userbot/chats/:chatId`

## Web -> API Call Sites

- `apps/web/app/page.tsx`
- `apps/web/app/trades/page.tsx`
- `apps/web/app/telegram-userbot/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/app/my-group/page.tsx`
- `apps/web/app/filters/page.tsx`
- `apps/web/app/logs/page.tsx`
- `apps/web/app/ai/page.tsx`
- `apps/web/app/diagnostics/page.tsx`
- `apps/web/app/openrouter-spend/page.tsx`
- `apps/web/app/components/LiveExposurePanel.tsx`
- `apps/web/app/components/DashboardTodoList.tsx`
- `apps/web/app/components/CabinetSwitcher.tsx`
- `apps/web/app/trades/delete-trade-button.tsx`
- `apps/web/app/trades/restore-trade-button.tsx`
- `apps/web/app/trades/delete-all-trades-button.tsx`
- `apps/web/app/trades/pnl-edit-control.tsx`
- `apps/web/app/trades/source-select.tsx`
- `apps/web/app/trades/telegram-source-link.tsx`
- `apps/web/app/trades/recalc-closed-pnl-button.tsx`

