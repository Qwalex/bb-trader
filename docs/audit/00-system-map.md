# System Map

## Scope

- Monorepo: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (shared contracts).
- Runtime: Docker Compose (local/dev/test), Railway (API/Web), PostgreSQL.

## Core Flows

- `web -> api`: SSR/route handlers call API endpoints with auth headers/cookies.
- `api -> postgres`: Prisma-based persistence for signals, orders, logs, settings.
- `api -> external`: Bybit API, OpenRouter, Telegram/VK integrations.

## High-Risk Domains

- Trading execution and reconciliation in `apps/api/src/modules/bybit`.
- Bot orchestration in `apps/api/src/modules/telegram` and `telegram-userbot`.
- Signal parsing and LLM workflows in `apps/api/src/modules/transcript`.
- Auth/session boundary in `apps/web/app/api/auth/route.ts` and `apps/web/lib/api.ts`.

## Priority Large Files

- `apps/api/src/modules/bybit/bybit.service.ts`
- `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts` (фасад сжат; тяжёлый ingest — `ingest/telegram-userbot-ingest-pipeline.service.ts`)
- `apps/api/src/modules/telegram/telegram.service.ts`
- `apps/api/src/modules/transcript/transcript.service.ts` (OpenRouter — отдельные `transcript-openrouter-*`, см. AUD-048)
- `apps/api/src/modules/orders/orders.service.ts` (часть статистики — `orders-stats.util.ts`)
- `apps/web/app/settings/page.tsx` (константы/утилиты — `settings-page.*.ts`)
- `apps/web/app/telegram-userbot/page.tsx` (util URL — `telegram-userbot-page.util.ts`)
- `apps/web/app/filters/page.tsx` (типы/константы/util — `filters-page.*.ts`)

## Coverage Rule

- Every task must update `06-progress-tracker.md` and, if needed, `03-security-risks-register.md`.
