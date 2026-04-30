# Full Project Audit Backlog

## Goal
- Cover the whole repository in controlled waves: audit -> fix/refactor -> docs sync.
- Keep context stable between sessions via small `AUD-###` tasks and explicit status transitions.

## Workflow Per Task
1. Set task status to `in_progress` in `06-progress-tracker.md`.
2. Audit the scoped files for bugs, vulnerabilities, shortcuts, and decomposition candidates.
3. Implement small behavior-safe changes.
4. Update `03-security-risks-register.md` when risk is found/changed.
5. Record manual verification and set status to `done` (or `blocked` with reason).

## Global Coverage Matrix
- `apps/api`:
  - `modules/bybit/*`
  - `modules/telegram-userbot/*`
  - `modules/telegram/*`
  - `modules/transcript/*`
  - `modules/orders/*`
  - remaining modules + `common/*` + `prisma/*`
- `apps/web`:
  - route handlers in `app/api/*`
  - pages in `app/*`
  - shared UI components
  - API/auth client utilities in `lib/*`
- `packages/shared/*`
- deploy/runtime/config:
  - `docker-compose*.yml`, `Dockerfile*`, `railway*.toml`, `railpack*.json`
  - scripts in `scripts/*`
  - CI workflows in `.github/workflows/*`
- docs and agent guidance:
  - `docs/*`, `docs/audit/*`, `.cursor/rules/*`, `AGENTS.md`

## Wave Plan (Small Tasks)
### Wave A: Critical Large Files (decomposition-first)
- `AUD-006`: `apps/api/src/modules/bybit/bybit.service.ts`
- `AUD-007`: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`
- `AUD-008`: `apps/api/src/modules/telegram/telegram.service.ts`
- `AUD-009`: `apps/api/src/modules/transcript/transcript.service.ts`
- `AUD-010`: `apps/api/src/modules/orders/orders.service.ts`
- `AUD-011`: `apps/web/app/settings/page.tsx`
- `AUD-012`: `apps/web/app/telegram-userbot/page.tsx`

### Wave B: Security and Boundary Review
- `AUD-013`: auth/session/cookie boundary (`apps/web/app/api/auth/*`, `apps/web/lib/api*`, related API guards)
- `AUD-014`: secret exposure and unsafe defaults in configs/scripts/compose/railway
- `AUD-015`: input validation and error normalization on high-risk API controllers/services

### Wave C: Remaining Repository Sweep
- `AUD-016`: remaining API modules (`vk`, `diagnostics`, `cabinet`, `settings`, `worker-queue`, `app-log`)
- `AUD-017`: remaining web pages/components for anti-pattern cleanup and decomposition
- `AUD-018`: shared package contracts/types sanity and drift checks
- `AUD-019`: docs consistency + missing agent documentation completion

## Definition Of Done For Each `AUD-###`
- Scope fully checked and findings captured.
- Changes are behavior-safe or explicitly documented.
- Manual verification captured.
- `06-progress-tracker.md` updated.
- `03-security-risks-register.md` updated when needed.
