# Progress Tracker

## Status Legend

- `todo`
- `in_progress`
- `blocked`
- `done`

## Task Card Template

### AUD-###

- Status:
- Scope:
- Files:
- Findings:
- Changes:
- Decomposition notes (`utils/constants/hooks/types`):
- Manual verification:
- Docs updated:
- Linked risks (`SEC-###`):

## Active Queue

### AUD-001

- Status: `in_progress`
- Scope: Bootstrap `docs/audit` and task governance.
- Files: `docs/audit/*`
- Findings: Need unified DoD and stable per-task format.
- Changes: Created audit docs baseline and templates.
- Decomposition notes (`utils/constants/hooks/types`): N/A for docs bootstrap.
- Manual verification: files created and linked between tracker/risk register.
- Docs updated: `00`..`06`.
- Linked risks (`SEC-###`): N/A

### AUD-002

- Status: `done`
- Scope: API Wave 1 (high-risk large files).
- Files: `apps/api/src/modules/telegram/*`, `apps/api/src/modules/telegram-userbot/*`, `apps/api/src/modules/settings/*`
- Findings: large services contained many inline constants and repeated config lists.
- Changes: extracted constants into `telegram.constants.ts`, `telegram-userbot.constants.ts`, `settings.constants.ts`; unified admin/global settings key sets; fixed missing shared key import path through constants module.
- Decomposition notes (`utils/constants/hooks/types`): isolated constants by domain; one concern per file.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `03-security-risks-register.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-001`, `SEC-003`

### AUD-003

- Status: `done`
- Scope: Web Wave 1 (high-risk pages and auth/api layer).
- Files: `apps/web/lib/api.ts`, `apps/web/lib/api.constants.ts`, `apps/web/lib/api-auth.util.ts`, `apps/web/app/api/auth/route.ts`, `apps/web/app/components/TopNav.tsx`
- Findings: duplicated auth header enrichment and repeated literal constants in API/auth layer.
- Changes: extracted API constants and auth cookie utilities, deduplicated server token enrichment in API client, fixed `TopNav` ref typing for stable build.
- Decomposition notes (`utils/constants/hooks/types`): moved constants and cookie utilities to dedicated files.
- Manual verification: `npm run -w apps/web build` passed.
- Docs updated: `03-security-risks-register.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-001`

### AUD-004

- Status: `done`
- Scope: Infra Wave 1.
- Files: root compose/railway/scripts.
- Findings: destructive git reset path in deploy script; weak SSH host key policy and plaintext notify default; hardcoded compose credentials and browser token env exposure.
- Changes: replaced `git reset --hard` with ff-only pull flow in `restart.sh`; hardened SSH check script defaults; converted compose DB credentials to env-based values and removed `NEXT_PUBLIC_API_ACCESS_TOKEN` from compose environments.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: web/api builds completed after infra-aligned changes.
- Docs updated: `03-security-risks-register.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-002`, `SEC-003`

### AUD-005

- Status: `done`
- Scope: Full coverage of remaining files.
- Files: repository-wide.
- Findings: reviewed core API, Web, compose/deploy scripts, and agent documentation surfaces; remaining decomposition should continue in subsequent waves for very large files (`transcript.service.ts`, `orders.service.ts`, `settings/page.tsx`, `telegram-userbot/page.tsx`, `telegram.service.ts`); `bybit.service.ts` is a small facade after module split (see AUD-038/039, `docs/refactor-decomposition-large-files-plan.md` §3).
- Changes: established persistent audit framework and completed first cross-cutting decomposition/security-hardening pass across all major layers.
- Decomposition notes (`utils/constants/hooks/types`): baseline extracted; next tasks should continue one-entity-per-file strategy with pragmatic boundaries.
- Manual verification: `apps/api` build OK, `apps/web` build OK, lint diagnostics for touched files clean.
- Docs updated: all files in `docs/audit/*` + `AGENTS.md`.
- Linked risks (`SEC-###`): `SEC-001`, `SEC-002`, `SEC-003`

### AUD-006

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/api/src/modules/bybit/bybit.service.ts`.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-json.util.ts`, `docs/audit/07-full-audit-backlog.md`, `AGENTS.md`, `docs/audit/05-agent-work-contract.md`.
- Findings: Repeated JSON parsing logic in orchestration service increased file size/noise and raised maintenance risk; key giant-file candidates confirmed for wave order.
- Changes: Added `07-full-audit-backlog.md`; extracted JSON parse helpers to `bybit-json.util.ts` and reused them in `BybitService` (behavior-preserving); synced agent workflow rules for context retention.
- Decomposition notes (`utils/constants/hooks/types`): First extraction done (`bybit-json.util.ts`); next slices should continue moving pure parsers/mappers/constants out of `bybit.service.ts`.
- **Current state (post AUD-038/039):** domain logic lives in `instrument/`, `exposure/`, `orders/`, `position/`, `tpsl/`, `pnl/`, `poll/`, `notify/`, `overrides/`, `types/`; `bybit.service.ts` is orchestration-only (~540 lines). Further work is optional readability or new domains if the facade grows.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `05-agent-work-contract.md`, `06-progress-tracker.md`, `07-full-audit-backlog.md`, `AGENTS.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-007

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`.
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot-source.util.ts`
- Findings: large service contained inline parser for source martingale map, increasing coupling and reducing reuse.
- Changes: extracted source martingale parser/type into `telegram-userbot-source.util.ts` and reused in service.
- Decomposition notes (`utils/constants/hooks/types`): moved pure parser + type out of service orchestration layer.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-008

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/api/src/modules/telegram/telegram.service.ts`.
- Files: `apps/api/src/modules/telegram/telegram.service.ts`, `apps/api/src/modules/telegram/telegram-trade-parse.util.ts`
- Findings: trade detail formatter duplicated JSON parsing logic for entries/TP display inside service.
- Changes: extracted trade parsing/display helpers to `telegram-trade-parse.util.ts`; service now focuses on orchestration/formatting.
- Decomposition notes (`utils/constants/hooks/types`): moved pure parsing helpers to dedicated util file.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-009

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/api/src/modules/transcript/transcript.service.ts`.
- Files: `apps/api/src/modules/transcript/transcript.service.ts`, `apps/api/src/modules/transcript/transcript.constants.ts`
- Findings: OpenRouter runtime constants were mixed with service logic, making config surface harder to review.
- Changes: extracted OpenRouter URLs/retry/batch constants into `transcript.constants.ts` and reused in service.
- Decomposition notes (`utils/constants/hooks/types`): moved runtime constants to dedicated constants module.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-010

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/api/src/modules/orders/orders.service.ts`.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders-source.util.ts`
- Findings: source exclusion list parser was embedded into service and mixed with domain queries.
- Changes: extracted source list parser into `orders-source.util.ts`; service uses util for excluded sources set.
- Decomposition notes (`utils/constants/hooks/types`): moved pure parse helper to isolated util.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-011

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/web/app/settings/page.tsx`.
- Files: `apps/web/app/settings/*`
- Findings: settings UI still referenced legacy SQLite storage model, creating operator confusion against real PostgreSQL runtime.
- Changes: updated settings page copy to PostgreSQL wording for reset/save informational blocks.
- Decomposition notes (`utils/constants/hooks/types`): no structural split in this slice; focus on correctness and operational clarity.
- Manual verification: `npm run -w apps/web build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-010`

### AUD-012

- Status: `done`
- Scope: Deep audit + safe decomposition of `apps/web/app/telegram-userbot/page.tsx`.
- Files: `apps/web/app/telegram-userbot/page.tsx`, `apps/web/lib/cabinet-client.util.ts`, `apps/web/app/filters/page.tsx`, `apps/web/app/my-group/page.tsx`
- Findings: cabinet id resolution logic and API-call scaffolding were duplicated across large client pages.
- Changes: extracted shared client cabinet resolver (`cabinet-client.util.ts`) and reused across `telegram-userbot`, `filters`, and `my-group` pages; kept auth-aware fetch path centralized.
- Decomposition notes (`utils/constants/hooks/types`): moved repeated client cabinet helper out of page-level files.
- Manual verification: `npm run -w apps/web build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-010`

### AUD-013

- Status: `done`
- Scope: Auth/session boundary sweep for web+api integration.
- Files: `apps/web/app/api/auth/*`, `apps/web/lib/api*`, `apps/api/src/common/*`, `apps/api/src/modules/auth/*`
- Findings: Confirmed API-side critical exposure points (`settings/raw`, `/logs`, malformed cookie decode) and web-side auth boundary drift (`NEXT_PUBLIC_API_ACCESS_TOKEN` fallback + production browser-readable token cookie).
- Changes: Added admin-only guard for `GET /settings/raw`; added admin-only guard for `GET /logs`; hardened cookie decode in `CabinetContextMiddleware`; removed `NEXT_PUBLIC_API_ACCESS_TOKEN` fallback in web API client; limited `sb_auth_token` issuance/cleanup to non-production only; removed README guidance to set public API token in browser env; added `AUTH_ALLOW_PUBLIC_REGISTER` gate in `AuthService` (default deny in production); replaced raw unauthenticated `fetch` in `telegram-userbot` source stats with shared `apiFetch`.
- Decomposition notes (`utils/constants/hooks/types`): N/A for this security hardening slice.
- Manual verification: `npm run -w apps/api build` passed; `npm run -w apps/web build` passed.
- Docs updated: `01-env-and-secrets-matrix.md`, `03-security-risks-register.md`, `06-progress-tracker.md`, `README.md`, `docs/auth-post-deploy-checklist.md`.
- Linked risks (`SEC-###`): `SEC-001`, `SEC-005`, `SEC-006`, `SEC-007`, `SEC-009`, `SEC-010`

### AUD-014

- Status: `done`
- Scope: Config/infra secrets and unsafe defaults review.
- Files: `docker-compose*.yml`, `railway*.toml`, `railpack*.json`, `scripts/*`, `.github/workflows/*`
- Findings: Deploy workflows referenced `restart*.sh` scripts that were absent in repository, making VPS deploy flow non-reproducible from git source.
- Changes: Removed VPS-only deployment surface (`restart.sh`, `restart-dev.sh`, `restart-test.sh`, `.github/workflows/deploy*.yml`) and aligned docs to Railway-only deployment policy; removed `nixpacks.toml` and `nixpacks.web.toml` to keep a single Railpack config path.
- Decomposition notes (`utils/constants/hooks/types`): N/A unless scripts are split.
- Manual verification: repository grep confirms no references to `restart*.sh` or VPS deploy workflows remain in active deployment path docs/config.
- Docs updated: `02-deploy-and-rollback.md`, `03-security-risks-register.md`, `06-progress-tracker.md`, `AGENTS.md`, `.gitignore`.
- Linked risks (`SEC-###`): `SEC-008`, `SEC-011`

### AUD-015

- Status: `done`
- Scope: Input validation and error normalization in high-risk API endpoints.
- Files: controllers/services in `apps/api/src/modules/*` (priority: trading, bots, diagnostics).
- Findings: found weak limit/pagination parsing paths that allowed overly large values and inconsistent handling in read-heavy endpoints.
- Changes: added bounded integer normalization in `orders.controller.ts`, `app-log.controller.ts`, and `telegram-userbot.controller.ts`.
- Decomposition notes (`utils/constants/hooks/types`): validation helpers kept local to controllers to avoid cross-domain coupling.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `03-security-risks-register.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-012`

### AUD-016

- Status: `done`
- Scope: Remaining API modules sweep.
- Files: `apps/api/src/modules/vk/*`, `diagnostics/*`, `cabinet/*`, `settings/*`, `worker-queue/*`, `app-log/*`
- Findings: no new critical auth or secret-leak regressions found after latest hardening; residual tech debt remains mostly in large orchestration services and typed Prisma adapters.
- Changes: no behavior changes required in this slice beyond already applied validation hardening.
- Decomposition notes (`utils/constants/hooks/types`): additional decomposition remains backlog work for future slices when touching those domains.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-017

- Status: `done`
- Scope: Remaining web pages/components sweep.
- Files: `apps/web/app/**/*`, excluding tasks already covered by `AUD-011..012`.
- Findings: found stale storage wording (SQLite) and one React hooks dependency warning in settings page; no new critical auth bypasses detected in remaining pages.
- Changes: updated UI wording to PostgreSQL and fixed hooks dependency chain in `settings/page.tsx` via `useCallback` wrapping.
- Decomposition notes (`utils/constants/hooks/types`): reused extracted `settings.types.ts` and client utilities from prior waves.
- Manual verification: `npm run -w apps/web build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-010`

### AUD-018

- Status: `done`
- Scope: Shared types/contracts drift check.
- Files: `packages/shared/src/*` + usages in api/web.
- Findings: contracts remain compatible with current api/web integration after type extraction; no breaking drift found requiring `packages/shared` edits in this pass.
- Changes: no code changes needed in `packages/shared` for current slice.
- Decomposition notes (`utils/constants/hooks/types`): cross-domain types continue to live in `packages/shared`; local domain types extracted to co-located `*.types.ts`.
- Manual verification: `npm run -w apps/api build` and `npm run -w apps/web build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-019

- Status: `done`
- Scope: Agent documentation completion and cross-doc consistency.
- Files: `AGENTS.md`, `.cursor/rules/*`, `docs/audit/*`, key operational docs in `docs/*`.
- Findings: docs drift was present around Railway-only deploy policy and post-deploy auth checklist assumptions.
- Changes: synchronized Railway-only policy in docs and AGENTS memory; aligned auth post-deploy checklist with admin-only endpoints and registration gate semantics.
- Decomposition notes (`utils/constants/hooks/types`): N/A for docs.
- Manual verification: docs consistency re-check completed against active deploy config files.
- Docs updated: `AGENTS.md`, `docs/auth-post-deploy-checklist.md`, `docs/audit/02-deploy-and-rollback.md`, `docs/audit/03-security-risks-register.md`, `docs/audit/06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-008`, `SEC-011`

### AUD-020

- Status: `done`
- Scope: Additional typing decomposition for large API/Web files (`*.types.ts` extraction).
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.types.ts`, `apps/api/src/modules/telegram/telegram.types.ts`, `apps/api/src/modules/transcript/transcript.types.ts`, `apps/web/app/settings/settings.types.ts`, `apps/web/app/telegram-userbot/telegram-userbot.types.ts` + corresponding service/page imports.
- Findings: large orchestration files still contained substantial inline typing blocks, reducing readability and slowing safe edits.
- Changes: moved non-trivial inline types from services/pages to co-located `*.types.ts` files and rewired type imports; kept behavior unchanged.
- Decomposition notes (`utils/constants/hooks/types`): typing layer separated from runtime logic for major api/web modules.
- Manual verification: `npm run -w apps/api build` passed; `npm run -w apps/web build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): `SEC-004`, `SEC-010`

### AUD-021

- Status: `done`
- Scope: Safe decomposition slice for `BybitService` (types/constants + pure util extractions) with behavior-preserving delegation.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.types.ts`, `apps/api/src/modules/bybit/bybit.constants.ts`, `apps/api/src/modules/bybit/bybit-qty.util.ts`, `apps/api/src/modules/bybit/bybit-exposure.util.ts`, `apps/api/src/modules/bybit/bybit-tpsl.util.ts`, `apps/api/src/modules/bybit/bybit-pnl.util.ts`.
- Findings: `bybit.service.ts` concentrated domain orchestration and low-level helpers; extraction can proceed safely by first moving stable pure blocks and constants/types, while preserving method contracts and call order.
- Changes: moved public/internal Bybit domain types into `bybit.types.ts`; moved status/log/reconcile constants into `bybit.constants.ts`; extracted qty/price/split helpers into `bybit-qty.util.ts`; extracted exposure/tpsl/pnl pure helpers to dedicated util files and rewired service methods to delegate.
- Decomposition notes (`utils/constants/hooks/types`): orchestration remains in `BybitService`; low-level deterministic logic is now separated in dedicated util/type/constant files for safer next-stage service extraction.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A (behavior-preserving refactor slice, no new runtime permissions/secrets surface).

### AUD-022

- Status: `done`
- Scope: Stage-3 decomposition continuation — dedicated exposure service with DI delegation.
- Files: `apps/api/src/modules/bybit/bybit-exposure.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`, `apps/api/src/modules/bybit/bybit.service.ts`.
- Findings: duplicate/exposure read-model logic was tightly coupled to `BybitService`, but can be moved safely as method-for-method delegation without flow changes.
- Changes: added `BybitExposureService`; moved exchange exposure/active orders/positions retrieval logic there; switched `BybitService` methods to DI delegation; registered new provider in module.
- Decomposition notes (`utils/constants/hooks/types`): orchestration and outward API remain in `BybitService`; exchange exposure internals are now isolated in dedicated service.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-023

- Status: `done`
- Scope: Stage-4/5 safe continuation for Bybit decomposition (TP/SL + PnL service boundaries with behavior-preserving delegation).
- Files: `apps/api/src/modules/bybit/bybit-tpsl.service.ts`, `apps/api/src/modules/bybit/bybit-pnl.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: high-risk trading flows remain orchestration-heavy, so extraction proceeded in method-for-method delegation slices to avoid reordering side effects.
- Changes: introduced `BybitTpSlService` and delegated `applyPositionStopLossFull` + `ensureStopLossForMultiTpOpenPosition`; introduced `BybitPnlService` and delegated `fetchClosedPnlRowsForSymbol` + `buildClosedPnlWindow`; registered both providers in Bybit module.
- Decomposition notes (`utils/constants/hooks/types`): orchestration stays in `BybitService`; reusable TP/SL and PnL fetch/window logic now isolated behind dedicated services for subsequent incremental extraction.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-024

- Status: `done`
- Scope: Additional file-size reduction in `BybitService` by moving closed-pnl parsing/aggregation logic to `BybitPnlService`.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-pnl.service.ts`.
- Findings: closed-pnl mapping helpers were self-contained and safe to isolate without changing poll/close behavior.
- Changes: moved `extractClosedPnlOrderId`, `parseFiniteNumber`, `extractClosedPnlTimestampMs`, `sumClosedPnlForSignal` implementation into `BybitPnlService`; `BybitService` now delegates via `bybitPnl.sumClosedPnlForSignal(...)`.
- Decomposition notes (`utils/constants/hooks/types`): deterministic data-mapping/aggregation moved from orchestration service into domain helper service.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-025

- Status: `done`
- Scope: Additional PnL decomposition to reduce `BybitService` size (execution fallback and liquidation detection).
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-pnl.service.ts`.
- Findings: execution-based fallback and liquidation scan are isolated from orchestration and can be delegated safely.
- Changes: moved `estimateClosedPnlFromExecutions` and `detectLiquidationByExecutions` implementations into `BybitPnlService`; `BybitService` now delegates both methods.
- Decomposition notes (`utils/constants/hooks/types`): PnL execution analytics is now concentrated in one service, reducing orchestration-file surface.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-026

- Status: `done`
- Scope: Continued PnL decomposition by moving trade breakdown orchestration from `BybitService` to `BybitPnlService`.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-pnl.service.ts`.
- Findings: `getTradePnlBreakdown` used only PnL-domain operations and could be moved with callback-based dependencies while preserving contracts.
- Changes: added `BybitPnlService.getTradePnlBreakdown(...)`; `BybitService.getTradePnlBreakdown(...)` now delegates via callbacks to `orders.getSignalWithOrders` and `getClient`.
- Decomposition notes (`utils/constants/hooks/types`): PnL-specific request handling is now concentrated in `BybitPnlService`, reducing orchestration density of `BybitService`.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-027

- Status: `done`
- Scope: Large decomposition wave `AUD-BYBIT-DECOMP-06..10` for `BybitService` orchestration boundaries.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-tpsl.service.ts`, `apps/api/src/modules/bybit/bybit-pnl.service.ts`, `apps/api/src/modules/bybit/bybit-signal-placement.service.ts`, `apps/api/src/modules/bybit/bybit-order-lifecycle-poll.service.ts`, `apps/api/src/modules/bybit/bybit-position-close.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: major orchestration hotspots (placement, poll lifecycle, manual close/flatten, TP/SL heavy paths) can be split into dedicated services while preserving public contracts and side-effect order.
- Changes: introduced `BybitSignalPlacementService`, `BybitOrderLifecyclePollService`, `BybitPositionCloseService`; moved large execution flows from `BybitService` into dedicated services with callback/port delegation; expanded `BybitTpSlService`/`BybitPnlService` usage; registered all new providers in `BybitModule`.
- Decomposition notes (`utils/constants/hooks/types`): `BybitService` reduced toward facade role; domain flows now grouped by concern (placement, lifecycle poll, close, TP/SL, PnL).
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A (behavior-preserving refactor; monitor runtime logs for edge cases in delegated callback paths).

### AUD-028

- Status: `done`
- Scope: `AUD-BYBIT-DECOMP-11` — poll hard split with façade-only `pollOpenOrders` in `BybitService`.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit-order-lifecycle-poll.service.ts`.
- Findings: poll lifecycle already existed in dedicated service but core orchestration was still duplicated in `BybitService`.
- Changes: removed inlined poll flow from `BybitService.pollOpenOrders`; switched to full delegation into `BybitOrderLifecyclePollService` via explicit callback ports; extracted close-classification branch into `finalizeSignalCloseIfNeeded(...)`.
- Decomposition notes (`utils/constants/hooks/types`): orchestration boundary tightened; `BybitService` acts as façade for poll scenario.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-029

- Status: `done`
- Scope: `AUD-BYBIT-DECOMP-12` — typed callback ports and `any` reduction in cross-service contracts.
- Files: `apps/api/src/modules/bybit/bybit-ports.types.ts`, `apps/api/src/modules/bybit/bybit-signal-placement.service.ts`, `apps/api/src/modules/bybit/bybit-order-lifecycle-poll.service.ts`, `apps/api/src/modules/bybit/bybit-position-close.service.ts`.
- Findings: key decomposition services still accepted untyped `ports: any`, which weakened refactor safety.
- Changes: introduced `bybit-ports.types.ts` with typed contracts for placement/poll/manual-close ports; migrated service signatures to typed port interfaces.
- Decomposition notes (`utils/constants/hooks/types`): callback contracts centralized in dedicated types file to reduce drift.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-030

- Status: `done`
- Scope: `AUD-BYBIT-DECOMP-13` — TP/SL boundary cleanup in `BybitService`.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`.
- Findings: leftover legacy TP split glue (`placeTpSplitIfNeededLegacy`) remained despite extracted TP/SL service ownership.
- Changes: removed legacy no-op helper and simplified TP split port fallback to inline no-op callback; kept behavior and logging flow unchanged.
- Decomposition notes (`utils/constants/hooks/types`): removed obsolete glue layer; TP/SL flow remains owned by `BybitTpSlService`.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-031

- Status: `done`
- Scope: `AUD-BYBIT-DECOMP-14` — helper dedup pass between façade and extracted services.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`.
- Findings: stale import-level helper duplicates from pre-extraction TP/SL configuration parsing remained unused.
- Changes: removed unused TP/SL parser imports and unused constants import to align helper ownership with extracted services.
- Decomposition notes (`utils/constants/hooks/types`): duplicate helper surfaces reduced; imports now reflect active boundaries.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-032

- Status: `done`
- Scope: `AUD-BYBIT-DECOMP-15` — façade finalization and module-boundary validation.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: with poll split and typed ports completed, `BybitService` boundary is now orchestration façade over dedicated domain services.
- Changes: finalized façade delegation paths and validated module/provider graph by successful API build.
- Decomposition notes (`utils/constants/hooks/types`): `BybitService` remains entry façade; placement/poll/close/TP-SL/PnL execution details stay in extracted services.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-033

- Status: `done`
- Scope: Bybit client/session split from façade (`getBybitCredentials`, `getClient`, private WS bootstrap/handlers).
- Files: `apps/api/src/modules/bybit/bybit-client.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: Bybit credentials + WS sync lifecycle were still embedded in `BybitService`, increasing orchestration-file size and mixing transport/runtime concerns.
- Changes: introduced `BybitClientService`; moved credentials normalization/selection and private WS startup/update handling into dedicated service; `BybitService` now delegates client creation and WS start.
- Decomposition notes (`utils/constants/hooks/types`): transport/client concern moved to dedicated service boundary; façade kept behavior-preserving delegation.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-034

- Status: `done`
- Scope: Notification boundary split from `BybitService` (`trade cancelled`, `liquidation`, stale reconcile notify job).
- Files: `apps/api/src/modules/bybit/bybit-notify.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: notification orchestration (Telegram/VK + queue trigger for stale reconcile) remained coupled to trading façade and duplicated dependency surface.
- Changes: introduced `BybitNotifyService`; moved notification workflows (`notifyApiTradeCancelled`, `notifyApiTradeLiquidation`, `processTradeCancelledNotificationJob`, `notifyStaleReconcileTradeCancelled`) into dedicated service; `BybitService` now delegates these flows.
- Decomposition notes (`utils/constants/hooks/types`): side-effect notification concern isolated from trading orchestration; callback expectations preserved.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-035

- Status: `done`
- Scope: Recalc closed PnL workflow split from `BybitService`.
- Files: `apps/api/src/modules/bybit/bybit-recalc.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`.
- Findings: queue-driven recalculation state machine (`queued/running/completed/failed`) and bulk recalc execution were still inside façade service.
- Changes: introduced `BybitRecalcService`; moved in-memory job registry/retention, queue-job processing, job status retrieval and recalc loop into dedicated service; `BybitService` now delegates via explicit callback ports for Bybit/PnL-specific operations.
- Decomposition notes (`utils/constants/hooks/types`): long-running recalculation concern isolated from trading orchestration; façade role in `BybitService` strengthened.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-036

- Status: `done`
- Scope: Отдельный план декомпозиции для файлов >2000 строк (исключая `package-lock.json` и `scripts/**`).
- Files: `docs/refactor-decomposition-large-files-plan.md`, `06-progress-tracker.md`
- Findings: в инвентарь попали три TS-сервиса (`telegram-userbot`, `telegram`, `bybit`); для Bybit значительная часть логики уже вынесена, фасад остаётся крупным.
- Changes: добавлен структурированный MD-план с приоритетами P0–P2, волнами вынесения и DoD; зафиксированы исключения lock/scripts.
- Decomposition notes (`utils/constants/hooks/types`): план ссылается на существующие `*.util.ts` / `*.types.ts` / отдельные сервисы в `bybit/*`.
- Manual verification: пути и `wc -l` согласованы с репозиторием.
- Docs updated: `refactor-decomposition-large-files-plan.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-037

- Status: `done`
- Scope: Расширение плана декомпозиции: инвентарь файлов **>800 строк** (TS/TSX в `apps/` и `packages/`), обновление секций и команд пересчёта.
- Files: `docs/refactor-decomposition-large-files-plan.md`, `06-progress-tracker.md`
- Findings: 9 файлов >800 (в т.ч. `transcript`, `vk`, `orders`, три страницы `apps/web`); в `packages/shared` при сканировании >800 не найдено.
- Changes: сводная таблица с приоритетами P0–P3, краткие направления для новых кандидатов, ориентир ~800 строк для AI/навигации; два скрипта аудита (пороги 800 и 2000).
- Decomposition notes (`utils/constants/hooks/types`): для web — вынос компонентов/hooks; для API — утилиты и узкие сервисы по доменам.
- Manual verification: `find` + `wc -l` по перечисленным путям.
- Docs updated: `refactor-decomposition-large-files-plan.md`, `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-038

- Status: `done`
- Scope: Декомпозиция `BybitService` до целевого размера фасада (~800–1000 строк; фактически ~540 после выноса логики).
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `bybit.module.ts`, новые `bybit-balance-instrument.service.ts`, `bybit-order-exchange-query.service.ts`, `bybit-placement-validation.service.ts`, `bybit-signal-overrides.service.ts`, `bybit-live-snapshot.service.ts`, `bybit-poll-finalize.service.ts`, `bybit-exchange-cleanup.service.ts`, `bybit-order-status.util.ts`, `bybit-position-pick.util.ts`.
- Findings: фасад сочетал баланс/инструмент, запросы статусов ордеров, валидацию постановки, оверрайды сигнала, live/debug снимки, финализацию poll и cleanup удаления; часть — дублирующие обёртки к `BybitPnl`/`BybitTpSl`.
- Changes: публичный API `BybitService` сохранён (делегирование); вынесены перечисленные сервисы и утилиты; `recalcClosedSignalsPnl` вызывает `BybitPnlService` напрямую через порты; `finalizeSignalCloseIfNeeded` — в `BybitPollFinalizeService`; удаление сделки с биржи — в `BybitExchangeCleanupService`.
- Decomposition notes (`utils/constants/hooks/types`): чистые функции статусов ордеров и выбора строки позиции — в `*.util.ts`; узкие сервисы по зонам ответственности.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-039

- Status: `done`
- Scope: Структурирование `apps/api/src/modules/bybit` по подпапкам без смены поведения (только пути импортов).
- Files: корень модуля (`bybit.module.ts`, `bybit.service.ts`, `bybit.controller.ts`, `bybit.constants.ts`, `balance-snapshot.service.ts`); подпапки `instrument/`, `exposure/`, `orders/`, `position/`, `tpsl/`, `pnl/`, `poll/`, `notify/`, `overrides/`, `types/`.
- Findings: плоский список из 20+ файлов затруднял навигацию; публичные точки входа остаются в корне.
- Changes: `git mv` сервисов/утилит в доменные подпапки; относительные импорты к `common`, `prisma`, соседним модулям скорректированы на +1 уровень вглубь; импорты между подпапками — через явные относительные пути.
- Decomposition notes (`utils/constants/hooks/types`): типы в `types/`; константы — `bybit.constants.ts` в корне модуля.
- Manual verification: `npm run build` в `apps/api` passed.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-040

- Status: `done`
- Scope: Актуализация `docs/refactor-decomposition-large-files-plan.md` под текущий статус (Bybit-фасад ~540 строк, структура модуля по подпапкам); отдельный детальный план декомпозиции `telegram-userbot.service.ts`.
- Files: `docs/refactor-decomposition-large-files-plan.md`, `docs/telegram-userbot-decomposition-plan.md`, `06-progress-tracker.md`.
- Findings: инвентарь >800 обновлён; секция Bybit отражает завершённую декомпозицию фасада и раскладку `bybit/*`; P0 для userbot остаётся; подмножество >2000 строк — `telegram-userbot` + `telegram.service`.
- Changes: таблица строк/приоритетов; §3 переименован и описывает целевое состояние модуля Bybit; §1 ссылается на новый план; добавлен `telegram-userbot-decomposition-plan.md` (кластеры методов, риски, волны W1–W5, структура каталогов, чеклист).
- Decomposition notes (`utils/constants/hooks/types`): N/A (только документация).
- Manual verification: согласованность путей и ссылок между документами.
- Docs updated: перечисленные файлы.
- Linked risks (`SEC-###`): N/A

### AUD-041

- Status: `done`
- Scope: Декомпозиция `telegram-userbot.service.ts` по волнам W1–W5 (план `docs/telegram-userbot-decomposition-plan.md` / `.cursor/plans`, без правки файла плана).
- Files: `apps/api/src/modules/telegram-userbot/utils/*`, `openrouter/*`, `mirror/*.util.ts` + `mirror/telegram-userbot-mirror.service.ts`, `client/telegram-userbot-client.service.ts`, `ingest/telegram-userbot-ingest.service.ts`, `polling/telegram-userbot-polling.service.ts`, `filters/telegram-userbot-filters.service.ts`, `settings/telegram-userbot-settings.service.ts`, `telegram-userbot.module.ts`, `telegram-userbot.service.ts` (фасад ~3960 строк), `docs/refactor-decomposition-large-files-plan.md`.
- Findings: публичный API контроллера и `exports` модуля без изменений; `processIngestRecord` и связанный reply/lookup/watch-пайплайн остаются на фасаде, очередь и `ingestChatMessage` — в `TelegramUserbotIngestService` с `setProcessIngestRecord` в `onModuleInit`.
- Changes: W1 утилиты; W4 `TelegramUserbotOpenrouterService`; W2 `TelegramUserbotClientService` (MTProto/QR, inbound через setter); W3 очередь + ingest entry; W5 `Polling`/`Mirror`/`Filters`/`Settings` сервисы + тонкое делегирование.
- Decomposition notes: без автотестов; избегание циклов Nest — ingest вызывает фасад только через callback, клиент — через `setInboundHandler` / `setAfterAttachHook`.
- Manual verification: `npm run build` в `apps/api` passed.
- Docs updated: `06-progress-tracker.md`, `docs/refactor-decomposition-large-files-plan.md`.
- Linked risks (`SEC-###`): N/A

### AUD-043

- Status: `done`
- Scope: Волны userbot после W1–W5: фаза 1 (CRUD фильтров / publish / `updateChat` и карты источников в `settings`/`filters`/`mirror`, делегаты на фасаде), фаза 2 (`TelegramUserbotScanService`: poll-тик, `scanTodayMessagesCore`, метрики дня, recency/last-seen), фаза 3 (`TelegramUserbotIngestPipelineService`: `processIngestRecord` и цепочка; wiring через `setProcessIngestRecord` → pipeline, без импорта фасада из ingest), фаза 4 (актуализация `docs/telegram-userbot-decomposition-plan.md`, `docs/refactor-decomposition-large-files-plan.md`, трекер).
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `telegram-userbot.module.ts`, `settings/telegram-userbot-settings.service.ts`, `filters/telegram-userbot-filters.service.ts`, `mirror/telegram-userbot-mirror.service.ts`, `scan/telegram-userbot-scan.service.ts`, `ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts` (дубликат импорта устранён при сборке), `docs/telegram-userbot-decomposition-plan.md`, `docs/refactor-decomposition-large-files-plan.md`, `docs/audit/06-progress-tracker.md`.
- Findings: цель «фасад &lt; ~800» почти достигнута (~875); основной объём перенесён в pipeline (**~2420 строк**) — остаточный риск навигации; цикла Nest фасад↔ingest нет (callback на метод pipeline).
- Changes: делегаты фазы 1; scan-сервис; генерация pipeline из бывшего тела фасада + публичные `getBalanceGuardSnapshot` / `fetchChatMessageMeta` для `getStatus` и reread; восстановлены на фасаде `refreshEnabledChatsCache`, `getBoolSetting`, `isClientAuthorized` после узкого удаления диапазона.
- Decomposition notes: ingest queue остаётся в `TelegramUserbotIngestService`; pipeline зависит от `TelegramUserbotIngestService` односторонне.
- Manual verification: `npm run build` в `apps/api` passed; смоук ingest/polling по чеклисту decomposition-plan — не запускался в среде агента (нет живого Telegram).
- Docs updated: перечисленные `docs/*`, этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-044

- Status: `done`
- Scope: Декомпозиция `TelegramUserbotIngestPipelineService` по плану ingest (levels-watch → signal-lookup → signal-reply; общее состояние pair/cooldown в отдельном сервисе без циклов с фасадом).
- Files: `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-levels-watch.service.ts`, `telegram-userbot-ingest-signal-lookup.service.ts`, `telegram-userbot-ingest-signal-reply.service.ts`, `telegram-userbot-ingest-pair-direction.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot.module.ts`, `docs/refactor-decomposition-large-files-plan.md`, `docs/telegram-userbot-decomposition-plan.md`, `docs/audit/06-progress-tracker.md`.
- Findings: публичный контракт фасада не менялся (`processIngestRecord`, `getBalanceGuardSnapshot`, `fetchChatMessageMeta`, `clearAllSignalLevelsValidationWatches` остаются на pipeline с делегированием где нужно); `resolveRootSignalSourceMessageId` публичен на lookup для зеркала close/result.
- Changes: вынесены watch / lookup+fetch / reply-ветки / pair-direction; выровнены отступы `private` у методов оркестратора (колонка 0 → два пробела).
- Decomposition notes: `TelegramUserbotIngestPairDirectionService` добавлен для общих мап transition/cooldown между pipeline и reply (поведение как до выноса методов из одного класса).
- Manual verification: `npm run build` в `apps/api` passed; смоук ingest/reply/watch в живом Telegram не выполнялся в среде агента.
- Docs updated: перечисленные `docs/*`, этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-045

- Status: `done`
- Scope: Первая волна декомпозиции `apps/api/src/modules/telegram/telegram.service.ts` — вынос чистых утилит без изменения поведения бота и уведомлений.
- Files: `telegram.service.ts` (~2271 → ~1880 строк); новые `telegram-html.util.ts`, `telegram-external-request-key.util.ts`, `telegram-trade-event-titles.util.ts`, `telegram-signal-message-format.util.ts`, `telegram-keyboards.util.ts`, `telegram-trade-status.util.ts`, `telegram-dashboard-html.util.ts`, `telegram-api-notify-html.util.ts`; тип `TelegramSourceRatingRow` в `telegram.types.ts`.
- Findings: в одном файле смешаны HTML/formatting, callback-клавиатуры, ключи external confirm и тяжёлые хендлеры — сложно сопровождать.
- Changes: форматирование сигналов/сводок/сделок, escape/split HTML, заголовки событий, клавиатуры, ключи `cabinetId|ingestId`, тексты API/userbot-уведомлений и проверка статуса отмены вынесены в `*.util.ts`; сервис импортирует функции и сохраняет оркестрацию (`registerHandlers`, черновики, Bybit, Prisma).
- Decomposition notes (`utils/constants/hooks/types`): именованный тип строки рейтинга в `telegram.types.ts`; без новых автотестов (политика репозитория).
- Manual verification: `npm run build -w apps/api` passed; полный смоук Telegram в среде агента не выполнялся.
- Docs updated: `06-progress-tracker.md`.
- Linked risks (`SEC-###`): N/A

### AUD-046

- Status: `done`
- Scope: Продолжение декомпозиции `apps/api/src/modules/telegram/telegram.service.ts` по плану (волны 2–6): утилиты whitelist/draft/HTML chunks, вынос состояния диалога и реестра ботов, меню чата, поток черновика/ingest confirm, структурное разбиение `registerHandlers`, без отдельного bootstrap-сервиса (достаточно `TelegramBotRegistryService`). Структура каталога: `services/`, `utils/`, `types/`, `constants/` + barrel `index.ts` в каждой папке и публичный `telegram/index.ts` (`TelegramModule`, `TelegramService`, типы).
- Files: `telegram/services/*`, `telegram/utils/*`, `telegram/types/*`, `telegram/constants/*`, `telegram/index.ts`, `telegram/telegram.module.ts`; потребители импортируют `from '../telegram'` / `from './modules/telegram'`; правило для агента: `.cursor/rules/telegram-module-layout.mdc`, ссылка в `decomposition-and-file-boundaries.mdc` и `AGENTS.md`.
- Findings: дубли меню/черновика на фасаде после первого выноса устранены — делегирование в `chatMenu` / `draftFlow`; повторные `handleParseResult` / `confirmFromIngestId` удалены с фасада.
- Changes: `registerHandlers` → `registerTelegramAccessMiddleware`, `registerTelegramMainMenuHandlers`, `registerTelegramDraftActionHandlers`, `registerTelegramUserbotActionHandlers`, `registerTelegramMediaHandlers`; `clearTelegramInlineKeyboard`; DI новых сервисов в модуле.
- Decomposition notes (`utils/constants/hooks/types`): чистые функции в `*.util.ts`; состояние и сценарии — отдельные `@Injectable()` в том же модуле `telegram`.
- Manual verification: `npm run build -w apps/api` passed; полный смоук Telegram в среде агента не выполнялся.
- Docs updated: `06-progress-tracker.md`, `docs/refactor-decomposition-large-files-plan.md` §2 и строка инвентаря для `telegram.service.ts`.
- Linked risks (`SEC-###`): N/A

### AUD-047

- Status: `done`
- Scope: Первая волна декомпозиции `apps/api/src/modules/transcript/transcript.service.ts` по плану §4 — вынос JSON Schema для structured output и длинных текстовых промптов в отдельные файлы без смены поведения.
- Files: `transcript.service.ts` (~1742 → ~1524 строк); новые `transcript-model-json-schemas.ts`, `transcript-prompt-builders.util.ts`; `docs/refactor-decomposition-large-files-plan.md` §4, инвентарь.
- Findings: схемы и промпты занимали сотни строк в начале сервиса; `callOpenRouter` и постобработка ответа остаются на фасаде.
- Changes: импорт схем в `callOpenRouter`; промпты парсера, классификатора, фильтров и `normalizeOpenRouterAudioFormat` — из util.
- Decomposition notes (`utils/constants/hooks/types`): чистые константы/функции в `*.ts` рядом с модулем; публичный API модуля — `TranscriptService` без изменений.
- Manual verification: `npm run build -w apps/api` passed; полный LLM-смоук не выполнялся в среде агента.
- Docs updated: `06-progress-tracker.md`, `docs/refactor-decomposition-large-files-plan.md`.
- Linked risks (`SEC-###`): N/A

### AUD-048

- Status: `done`
- Scope: Пакет по плану декомпозиции (бэклог): ре-аудит строк в плане; userbot — перенос ingest link/reread на pipeline; transcript — волна 2 OpenRouter (parse util, model chain, billing, client); web — константы/утилиты settings и filters, util для URL userbot/filters; P2 — `orders-stats.util`, `vk-bot.constants`.
- Files: `telegram-userbot.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `transcript.service.ts`, `transcript.module.ts`, `transcript-openrouter-parse.util.ts`, `transcript-openrouter-model-chain.service.ts`, `transcript-openrouter-billing.service.ts`, `transcript-openrouter-client.service.ts`, `apps/web/app/settings/settings-page.constants.ts`, `settings-page.util.ts`, `page.tsx`, `telegram-userbot-page.util.ts`, `telegram-userbot/page.tsx`, `filters-page.types.ts`, `filters-page.constants.ts`, `filters-page.util.ts`, `filters/page.tsx`, `orders.service.ts`, `orders-stats.util.ts`, `vk-bot.service.ts`, `vk-bot.constants.ts`, `docs/refactor-decomposition-large-files-plan.md`, `06-progress-tracker.md`.
- Findings: фасад userbot снижен ниже ~800 строк; pipeline вырос за счёт переноса ручного reread; `TranscriptModule` импортирует `CabinetModule` для биллинга generation cost.
- Changes: поведение API и публичные методы модулей без изменений контрактов (`TelegramUserbotService`, `TranscriptService`); web — только вынесение данных/хелперов.
- Decomposition notes: OpenRouter — отдельные `@Injectable()` + чистый `transcript-openrouter-parse.util.ts`; web — `*.constants.ts` / `*.util.ts` / `*.types.ts` рядом со страницей.
- Manual verification: `npm run build -w apps/api` и `npm run build -w apps/web` passed; смоук Telegram/VK/OpenRouter в среде агента не выполнялся.
- Docs updated: `docs/refactor-decomposition-large-files-plan.md`, `docs/telegram-userbot-decomposition-plan.md`, `docs/audit/00-system-map.md`, этот трекер; нормы агента: `AGENTS.md`, `.cursor/rules/decomposition-and-file-boundaries.mdc`, `.cursor/rules/typing-separation-standard.mdc`.
- Linked risks (`SEC-###`): N/A

### AUD-042

- Status: `done`
- Scope: Читаемость фасада `BybitService` + актуализация аудита по Bybit (SEC-004, AUD-005/006, план декомпозиции).
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/types/bybit.types.ts`, `apps/api/src/modules/bybit/types/bybit-ports.types.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `docs/audit/03-security-risks-register.md`, `docs/audit/06-progress-tracker.md`, `docs/refactor-decomposition-large-files-plan.md`.
- Findings: SEC-004 и AUD-005 описывали устаревший размер монолита Bybit; фасад собирал крупные литералы портов inline.
- Changes: `SEC-004` → `mitigated` с актуальной формулировкой; правки Findings AUD-005 и хвоста AUD-006; строка в §3 плана декомпозиции; тип `SignalOrderOrigin`; фабрики `createSignalPlacementPorts` / `createOrderLifecyclePollPorts` / `createPositionClosePorts`; секционные комментарии в фасаде.
- Decomposition notes (`utils/constants/hooks/types`): именованный тип происхождения ордера в `bybit.types.ts`; порты по-прежнему в `bybit-ports.types.ts`.
- Manual verification: `npm run -w apps/api build` passed.
- Docs updated: перечисленные файлы.
- Linked risks (`SEC-###`): `SEC-004`

### AUD-049

- Status: `done`
- Scope: Исправление 401 на SSR при наличии `API_ACCESS_TOKEN` в окружении Web.
- Files: `apps/web/lib/api.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `getApiAuthHeaders` на сервере выставлял `Authorization` из `API_ACCESS_TOKEN` до чтения cookie; `enrichAuthHeaderForServer` не подменял заголовок, если он уже был — в запрос уходил неверный токен относительно `AUTH_JWT_SECRET` на API.
- Changes: на сервере Bearer из env перенесён в enrich после попытки `sb_auth`; при наличии cookie всегда используется сессия пользователя.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run build -w apps/web` (ожидается pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-050

- Status: `done`
- Scope: Падение API на старте (Railway 502): Nest `CircularDependencyException` в `BybitModule` / соседних модулях.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/bybit/pnl/bybit-recalc.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в Nest 10 `CircularDependencyException` при сканировании срабатывает и при **falsy-провайдере** (часто из‑за циклического `require()` в CommonJS): `BybitService` оказывался `undefined` в момент объявения `BybitModule`; дополнительно `BybitRecalcService` тянул `OrdersService` без `forwardRef` при цепочке на `BybitService`.
- Changes: `import type` + ленивый `require('../bybit/bybit.service').BybitService` внутри `@Inject(forwardRef(() => …))` для `OrdersService` и `WorkerQueueService`; `@Inject(forwardRef(() => OrdersService))` в `BybitRecalcService`.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npx nest build` в `apps/api`; `node dist/main.js` — модули и маршруты инициализируются; далее ожидаемая ошибка Prisma без локального `DATABASE_URL` (не относится к DI).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-051

- Status: `done`
- Scope: 401 на клиентских Web-запросах к API после перехода на httpOnly auth cookie.
- Files: `apps/web/app/api/backend/[...path]/route.ts`, `apps/web/lib/base-path.ts`, `apps/web/lib/api.ts`, `apps/web/middleware.ts`, `apps/web/app/login/page.tsx`, `apps/web/app/diagnostics/page.tsx`, `apps/web/app/openrouter-spend/page.tsx`, `apps/web/app/my-group/page.tsx`, `apps/web/app/settings/settings-page.util.ts`, `turbo.json`, `docs/audit/03-security-risks-register.md`, `docs/audit/06-progress-tracker.md`
- Findings: в production Web выставляет JWT только в httpOnly `sb_auth`, а browser-side `fetchApiResponse` не мог прочитать эту cookie и отправлял запросы к API без Bearer.
- Changes: добавлен same-origin BFF-прокси `/api/backend/*`, который на сервере читает `sb_auth` и проксирует запросы в API с `Authorization`; клиентский `getApiBase()` направлен на этот прокси; вынесен общий `withAppBasePath` helper в `lib/base-path.ts`; прямые вызовы `fetch('/api/auth')` переведены на basePath-aware helper; middleware нормализует path относительно `NEXT_PUBLIC_BASE_PATH` и пропускает proxy route без HTML-redirect; runtime env для Web/API внесены в `turbo.json`.
- Decomposition notes (`utils/constants/hooks/types`): новый route handler изолирует server-side auth proxy от общего API-клиента.
- Manual verification: `npm run lint -w web` (pass, только исторические warning), `npm run check-types -w web` (pass), `npm run build -w web` (pass); требуется browser check после запуска web/api: клиентские запросы должны идти на `/api/backend/*` и больше не получать 401 при валидной сессии.
- Docs updated: этот трекер, `03-security-risks-register.md`.
- Linked risks (`SEC-###`): `SEC-013`

### AUD-052

- Status: `done`
- Scope: Разделение settings endpoints для admin/raw и user/cabinet-safe чтения + устранение точки входа в `/logs` из навигации.
- Files: `apps/api/src/modules/settings/settings.controller.ts`, `apps/web/app/settings/page.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/trades/page.tsx`, `apps/web/app/telegram-userbot/page.tsx`, `packages/shared/src/nav-menu.ts`, `docs/audit/06-progress-tracker.md`
- Findings: Web-страницы читали только `/settings/raw` (admin-only), из-за чего пользовательские/кабинетные сценарии теряли доступ к безопасным незамаскированным ключам; в навигации оставался пункт `/logs` при отсутствии согласованного публичного UX на эту страницу.
- Changes: добавлен `GET /settings/effective` (для admin — полный набор как `raw`, для non-admin — фильтр без `ADMIN_ONLY_GLOBAL_KEYS`); все web-read path для настроек переведены на `/settings/effective`; пункт `logs` убран из `NAV_MENU_ITEMS`.
- Decomposition notes (`utils/constants/hooks/types`): endpoint-логика разделена по ролям в контроллере без изменения бизнес-логики `SettingsService`.
- Manual verification: `npm run lint -w api` (pass, только исторические warning), `npx tsc -p apps/api/tsconfig.json --noEmit` (pass), `npm run lint -w web` (pass, только исторические warning), `npm run check-types -w web` (pass), `npm run build -w web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): `SEC-005`, `SEC-006`

### AUD-053

- Status: `done`
- Scope: Усиление торговых инвариантов по активным сигналам и безопасный rollback/reconcile при partial placement Bybit.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `apps/api/src/modules/bybit/types/bybit-ports.types.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/prisma/migrations/20260503095000_signal_active_unique_open_parsed/migration.sql`, `docs/audit/06-progress-tracker.md`
- Findings: дубли активной сделки могли пройти при legacy-формате пары в БД и/или после перехода сигнала в `OPEN`/`PARSED`; при фейле размещения после частичного успеха часть ордеров могла остаться на бирже при `FAILED` в БД.
- Changes: `createSignalRecord` получил pre-guard с нормализацией пары по `cabinetId + pair + direction + active statuses`; `hasActiveSignalForPairAndDirection` и stale-reconcile переведены на полный active lifecycle (`PENDING`, `ORDERS_PLACED`, `OPEN`, `PARSED`); добавлена SQL-миграция для partial unique индекса по полному набору active статусов; в `BybitSignalPlacementService` добавлен rollback созданных bybitOrderIds при ошибках и fallback в `ORDERS_PLACED` + событие reconcile-required, если отмена ордеров неполная.
- Decomposition notes (`utils/constants/hooks/types`): ports-контракт для placement расширен `createSignalEvent` для фиксации rollback/reconcile состояния без утечки деталей фасада.
- Manual verification: `npm run lint -w api` (pass, только исторические warning), `npx tsc -p apps/api/tsconfig.json --noEmit` (pass), `npm run build -w api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-054

- Status: `done`
- Scope: Recovery зависших `running` worker jobs + усиление безопасности password reset.
- Files: `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260503102000_auth_reset_attempts_lockout/migration.sql`, `docs/audit/03-security-risks-register.md`, `docs/audit/06-progress-tracker.md`
- Findings: worker-очередь не восстанавливала stale `running` jobs после падения процесса; reset flow раскрывал существование аккаунта на request и не ограничивал brute-force подтверждения кода.
- Changes: при старте worker добавлен recovery stale `running` jobs (`lockedAt` старше TTL) с переводом в `pending`/`failed` и увеличением `attempts`; в run loop очищается `lockedAt` при завершении/ретрае; в reset flow request всегда возвращает одинаковый `ok` без user enumeration, введены `attempts` + `lockedUntil` для кода восстановления, при успешном подтверждении consume всех активных reset-кодов пользователя.
- Decomposition notes (`utils/constants/hooks/types`): безопасность reset-кода вынесена в явные поля модели `AuthPasswordReset` (`attempts`, `lockedUntil`) и DB-миграцию.
- Manual verification: `npm run lint -w api` (pass, только исторические warning), `npm run build -w api` (pass, включая `prisma generate`), `npx tsc -p apps/api/tsconfig.json --noEmit` (pass).
- Docs updated: этот трекер, `03-security-risks-register.md`.
- Linked risks (`SEC-###`): `SEC-014`

### AUD-055

- Status: `done`
- Scope: Web UX/error hardening для userbot, dashboard и `CabinetSwitcher`.
- Files: `apps/web/app/telegram-userbot/page.tsx`, `apps/web/app/components/CabinetSwitcher.tsx`, `apps/web/app/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: `telegram-userbot` парсил JSON без проверки `res.ok` и маскировал ошибки source stats значением `0`; `CabinetSwitcher` вызывал `setState` внутри `useMemo`; дашборд падал целиком при ошибке одного из критичных endpoint в `Promise.all`.
- Changes: в userbot добавлен `res.ok`-gate перед `json()` и null-state для недоступных source stats (без подстановки `0`); синхронизация fallback-кабинета перенесена из `useMemo` в `useEffect`; загрузка дашборда переведена на `Promise.allSettled` с частичной деградацией и сохранением доступных блоков.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run lint -w web` (pass, только исторические warning), `npm run check-types -w web` (pass), `npm run build -w web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-057

- Status: `done`
- Scope: Userbot `POST .../telegram-userbot/qr/start` отдавал HTTP 500 при ошибках конфигурации/сети или при отсутствии владельца кабинета в контексте.
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: проверка `ownerUserId` выполнялась после `getApiCreds()` / `connect()`; `getApiCreds()` и связанные шаги бросали необработанный `Error` → Nest 500.
- Changes: ранний `return { ok: false, ... }` при пустом `ownerUserId`; обёртка инициализации клиента в `try/catch` с `formatError`, `setQrState` и `disconnect` при фейле; ответ с `ok: false` и текстом ошибки вместо падения.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-056

- Status: `done`
- Scope: Ops hygiene — `.env.example`, npm-only scripts, параметризация Postgres healthcheck, синхронизация Railway web healthcheck/basePath в docs-config.
- Files: `.env.example`, `package.json`, `packages/api/package.json`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml`, `railway.web.toml`, `README.md`, `docs/audit/01-env-and-secrets-matrix.md`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: отсутствовал репозиторный env-template; в npm-монорепо оставались `pnpm`-скрипты; compose healthcheck Postgres был захардкожен под один DB/user; `railway.web.toml` требовал явной фиксации соответствия `NEXT_BASE_PATH`.
- Changes: добавлен безопасный `.env.example` с placeholder-значениями; корневые/пакетные scripts переведены на npm-эквиваленты; `pg_isready` в compose-файлах параметризован через `POSTGRES_USER`/`POSTGRES_DB`; в `railway.web.toml` уточнены правила синхронизации `healthcheckPath` с `NEXT_BASE_PATH`; добавлены ссылки на env-template в README и audit env-matrix.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run lint -w api` (pass, только исторические warning), `npm run lint -w web` (pass, только исторические warning), `npm run build -w api` (pass), `npm run build -w web` (pass).
- Docs updated: этот трекер, `01-env-and-secrets-matrix.md`, `README.md`, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-058

- Status: `done`
- Scope: Исправление чтения глобальных Telegram userbot app credentials при QR-входе.
- Files: `apps/api/src/modules/settings/settings.constants.ts`, `apps/web/app/settings/settings-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `TELEGRAM_USERBOT_API_ID` / `TELEGRAM_USERBOT_API_HASH` отображались на странице настроек в режиме «Аккаунт», но не были классифицированы как account/global ключи; из-за этого QR-логин мог видеть их пустыми.
- Changes: добавил оба ключа в backend `GLOBAL_SHARED_SETTING_KEYS` и frontend `ADMIN_GLOBAL_KEYS`, чтобы сохранение и чтение использовали одну область настроек.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run lint -w api` (pass, только исторические warning), `npm run lint -w web` (pass, только исторические warning), `npm run build -w api` (pass), `npm run check-types -w web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-059

- Status: `done`
- Scope: Стабилизация Bybit под мультикабинет + пост-ревью hardening limiter/backoff/cabinet-scope.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/exposure/bybit-exposure.util.ts`, `apps/api/src/modules/bybit/orders/bybit-placement-validation.service.ts`, `apps/api/src/modules/bybit/instrument/bybit-rate-limit.service.ts`, `apps/api/src/modules/bybit/instrument/bybit-balance-instrument.service.ts`, `apps/api/src/modules/bybit/instrument/bybit-client.service.ts`, `apps/api/src/modules/bybit/orders/bybit-order-exchange-query.service.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `apps/api/src/modules/bybit/exposure/bybit-exposure.service.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tpsl.service.ts`, `apps/api/src/modules/bybit/pnl/bybit-pnl.service.ts`, `apps/api/src/modules/bybit/position/bybit-position-close.service.ts`, `apps/api/src/modules/bybit/bybit.module.ts`, `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-signal-lookup.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-signal-reply.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.types.ts`, `apps/api/src/modules/settings/settings.constants.ts`, `apps/web/app/settings/settings-page.constants.ts`, `.env.example`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: placement-lock и stale-reconcile maps использовали только `pair:direction`; один глобальный private WS не соответствовал нескольким кабинетам с разными ключами; limiter мог пропускать параллельные вызовы одного кабинета из-за глобального reentry depth; backoff не видел rate-limit ответы Bybit с `retCode`.
- Changes: ключи stale/placement включают сегмент кабинета; `suspendStaleReconcile` / `resumeStaleReconcile` принимают `cabinetId` (userbot передаёт из сигнала); `BybitRateLimitService` переведён на `AsyncLocalStorage` reentry (вложенные вызовы без deadlock, параллельные вызовы не bypass'ят очередь), добавлен параметр `BYBIT_ACCOUNT_MAX_CONCURRENCY`, helper `runBybitCall` для `retCode/retMsg` и retry/backoff при `10006`; poll-heavy вызовы в `bybit-order-exchange-query`, `bybit-exposure`, `bybit-tpsl` обновлены для rethrow rate-limit; userbot signal lookup заскоуплен по `cabinetId`; worker queue пишет backlog/slow reconcile; при `cabinet.count > 1` и `BYBIT_WS_MULTI_CABINET=auto` private WS не поднимается; ключи и labels новых настроек добавлены в backend/web settings constants и `.env.example`.
- Changes (post-review strict limiter): `BybitRateLimitService` — одна очередь `Promise` на кабинет, без ALS/reentry bypass; каждый `runBybitCall` ждёт spacing и retry внутри очереди; убраны внешние `rateLimit.run` вокруг composite (order status / exposure / TP-SL); `BYBIT_ACCOUNT_MAX_CONCURRENCY>1` логируется как reserved и не даёт параллельных lane; оставшиеся REST (`getExchange*`, balance/tickers/wallet, placement/close/PnL) завернуты в `runBybitCall`.
- Decomposition notes (`utils/constants/hooks/types`): новый сервис `bybit-rate-limit.service.ts`; ключи в `bybit-exposure.util` / placement-validation.
- Manual verification: `npm run build -w api` (pass), `ReadLints` по изменённым файлам (no lints); логически: два кабинета с одной парой не делят placement-lock/stale maps; параллельные `rateLimit.run()` на один кабинет проходят через очередь, вложенные `run()` не deadlock'ят; `retCode=10006` приводит к backoff/retry; при >1 кабинете WS не стартует без `BYBIT_WS_MULTI_CABINET=force`.
- Manual verification (strict limiter): два параллельных `runBybitCall` на один cabinet key не стартуют одновременно; последовательные вызовы внутри `fetchOrderStatusFromExchange` проходят spacing каждый раз; composite TP/SL без внешнего `run` — нет deadlock из-за вложенного limiter; `retCode=10006` блокирует очередь на время backoff/retry.
- Docs updated: этот трекер, `.env.example`, `AGENTS.md`.
- Linked risks (`SEC-###`): `SEC-015`

### AUD-060

- Status: `done`
- Scope: QR userbot — чтение глобального `TELEGRAM_USERBOT_2FA_PASSWORD` (и согласованные userbot-секреты) при залогиненном владельце кабинета.
- Files: `apps/api/src/modules/settings/settings.constants.ts`, `apps/web/app/settings/settings-page.constants.ts`, `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `SettingsService.get()` не обращался к глобальной таблице `Setting` для ключей вне `GLOBAL_SHARED_SETTING_KEYS`, если есть `ownerUserId`; `TELEGRAM_USERBOT_2FA_PASSWORD` не был в этом множестве → пустой пароль в `signInUserWithQrCode` → ошибка `Password is empty`; повторный `startQrLogin` при ещё идущей задаче возвращал «QR-вход уже запущен» при `phase: error`.
- Changes: добавлены `TELEGRAM_USERBOT_2FA_PASSWORD`, `TELEGRAM_USERBOT_SESSION`, `TELEGRAM_USERBOT_MTPROXY_URL` в `GLOBAL_SHARED_SETTING_KEYS`; в web `ADMIN_GLOBAL_KEYS` — `TELEGRAM_USERBOT_2FA_PASSWORD`, `TELEGRAM_USERBOT_MTPROXY_URL` (как у API_ID/HASH в AUD-058); при повторном `startQrLogin` после `phase: error|cancelled` — сброс QR-клиента и задачи, чтобы не залипало «уже запущен».
- Decomposition notes (`utils/constants/hooks/types`): только константы ключей.
- Manual verification: `npm run build -w api` (pass); после деплоя: сохранить 2FA в глобальных настройках → `cancelQrLogin` при зависшем QR → `startQrLogin` → скан; пароль подхватывается из глобальной `Setting`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-061

- Status: `done`
- Scope: Userbot QR — пароль 2FA только при входе (без хранения в настройках).
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.types.ts`, `apps/api/src/modules/settings/settings.constants.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/web/app/settings/settings-page.constants.ts`, `apps/web/app/telegram-userbot/page.tsx`, `.env.example`, `docs/telegram-userbot-decomposition-plan.md`, `docs/audit/06-progress-tracker.md`
- Findings: секрет 2FA в БД настроек нежелателен; GramJS вызывает `password` только если у аккаунта включён 2FA.
- Changes: `POST /telegram-userbot/qr/password` + фазы `need_password` / `completing_login`, таймаут 2 мин, очистка при cancel/stop/finally; ключ `TELEGRAM_USERBOT_2FA_PASSWORD` удалён из settings/env; `qr/start|status|cancel` через `runWithCabinet`.
- Decomposition notes (`utils/constants/hooks/types`): N/A
- Manual verification: `npm run build -w api`, `npm run check-types -w web` (pass).
- Docs updated: этот трекер, `docs/telegram-userbot-decomposition-plan.md`.
- Linked risks (`SEC-###`): N/A

### AUD-062

- Status: `done`
- Scope: Аудит размещения второй стороны по паре в hedge (лонг при открытом шорте и наоборот): логи, SignalEvent, Telegram.
- Files: `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `apps/api/src/modules/bybit/types/bybit-ports.types.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/notify/bybit-notify.service.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders-active-signal-snapshot.types.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/utils/telegram-api-notify-html.util.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`
- Findings: при one-way противоположная сторона блокируется до ордера; при hedge второй вход возможен — нужна явная трассировка, чтобы убедиться, что первый вход не закрыт ошибочно.
- Changes: снимок противоположной активной сделки в БД до размещения; после успешного `ORDERS_PLACED` при hedge и (биржа противоположная ИЛИ запись в БД) — `appLog`, `Logger`, `SignalEvent` `BYBIT_HEDGE_OPPOSITE_PLACEMENT_AUDIT` (тип исключён из дублирующего `notifyTradeSignalEvent`), HTML в бот через `TELEGRAM_NOTIFY_HEDGE_OPPOSITE_PLACEMENT`; форматтер `formatHedgeOppositePlacementAuditHtml`.
- Decomposition notes (`utils/constants/hooks/types`): тип снимка сделки в `orders-active-signal-snapshot.types.ts`.
- Manual verification: `npm run build -w apps/api` (ожидается pass); в hedge при втором входе — сообщение в бот и событие в `/logs` по новой сделке.
- Docs updated: этот трекер, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-063

- Status: `done`
- Scope: QR userbot — понятные сообщения при `PASSWORD_HASH_INVALID` и подсказка на web про облачный пароль.
- Files: `apps/api/src/modules/telegram-userbot/utils/telegram-userbot-qr-auth-error.util.ts`, `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/web/app/telegram-userbot/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: ошибка Telegram `auth.CheckPassword` / `PASSWORD_HASH_INVALID` при неверном облачном пароле попадала в UI как сырой RPC-текст; фаза `completing_login` выставлялась до фактической проверки пароля.
- Changes: `normalizeCloudPasswordInput` (NFC + trim), `formatUserbotQrAuthErrorForUser` для HASH_INVALID и родственных кодов; `completing_login` только после успешного `signInUserWithQrCode`; уточнён текст подсказки на странице userbot.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-064

- Status: `done`
- Scope: Userbot — автоматическая первая синхронизация групп после успешного attach (QR / сессия).
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: после входа список чатов пуст до ручного POST `chats/sync`.
- Changes: `onAfterUserbotAttach` после `refreshEnabledChatsCache`: если для текущего кабинета нет `TgUserbotChat`, привязанных через `CabinetTelegramSource`, вызывается `syncChats()` с логированием результата.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-064

- Status: `done`
- Scope: Ежедневный дайджест в Telegram-ассистенте: баланс, PnL/WR, сделки за 24 ч, дельты к состоянию до окна, топы источников.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders-digest.types.ts`, `apps/api/src/modules/telegram/services/telegram-digest-scheduler.service.ts`, `apps/api/src/modules/telegram/utils/telegram-daily-digest-html.util.ts`, `apps/api/src/modules/telegram/telegram.module.ts`, `apps/api/src/modules/telegram/services/index.ts`, `apps/api/src/modules/telegram/utils/index.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`
- Findings: сводка по меню уже есть; не хватало плановой рассылки и среза «последние 24 ч» относительно кумулятива до окна.
- Changes: `OrdersService.getDailyDigestModel()` (учёт exclude/STATS_RESET_AT); `TelegramDigestSchedulerService` + `CronJob` из `TELEGRAM_DAILY_DIGEST_CRON` (дефолт `0 0 9 * * *` UTC), выкл. `TELEGRAM_DAILY_DIGEST_ENABLED=false`; рассылка по `TELEGRAM_WHITELIST` только кабинетов с запущенным ботом; HTML `formatTelegramDailyDigestHtml`.
- Decomposition notes (`utils/constants/hooks/types`): типы дайджеста в `orders-digest.types.ts`, разметка в `telegram-daily-digest-html.util.ts`.
- Manual verification: `npm run build` в `apps/api` (pass); в проде проверить время cron (UTC) и whitelist.
- Docs updated: этот трекер, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-065

- Status: `done`
- Scope: Главная дашборд — карточки по всем кабинетам (win/lose/winrate/PnL/bаланс) и блок подключённых Telegram-групп.
- Files: `apps/api/src/modules/orders/orders-dashboard-cabinets.types.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders.controller.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, `apps/web/app/home-dashboard.types.ts`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: на главной не было сводки по кабинетам и явного списка включённых источников userbot.
- Changes: `GET /orders/dashboard-cabinets` (агрегация `getDashboardStats` + USDT balance в контексте каждого кабинета); `GET /telegram-userbot/dashboard-connected-groups`; UI секции с сеткой карточек и чипами групп.
- Decomposition notes (`utils/constants/hooks/types`): DTO в `orders-dashboard-cabinets.types.ts`, UI-типы в `home-dashboard.types.ts`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass); вручную открыть `/` после входа — карточки и группы при наличии данных.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-069

- Status: `done`
- Scope: Userbot — восстановление MTProto-сессии после деплоя/рестарта API.
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`
- Findings: клиент хранится только в памяти процесса; при старте не вызывался `connectFromStoredSession`; `POST /telegram-userbot/connect` и `disconnect` не оборачивались в `runWithCabinet` (в отличие от остальных эндпоинтов).
- Changes: `tryRestoreUserbotOnStartup` после `refreshEnabledChatsCache`: при `TELEGRAM_USERBOT_ENABLED` + непустой глобальной сессии — `runWithCabinet` для кабинета по умолчанию или первого с `ownerUserId`; env `TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE=true` — отключить; удалены неиспользуемые поля reconnect; connect/disconnect через `runWithCabinet`.
- Manual verification: `npm run build -w apps/api` (pass); после рестарта при наличии сессии в БД — в логах строка о восстановлении, polling userbot видит клиента.
- Docs updated: этот трекер, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-068

- Status: `done`
- Scope: `POLLING_INTERVAL_MS` — глобальная админская настройка, дефолт 2000 мс.
- Files: `packages/shared/src/cabinet-settings.ts`, `apps/api/src/modules/settings/settings.constants.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/api/src/modules/bybit/poll/bybit-poll.service.ts`, `apps/web/app/settings/settings-page.constants.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`
- Findings: ключ был в `CABINET_SCOPED` и в UI кабинета; при пустом значении poll использовал 30 с; устаревшие `CabinetSetting` могли перекрывать глобальное значение в `list()`.
- Changes: ключ перенесён в `GLOBAL_SHARED_SETTING_KEYS` + `ENV_FALLBACK=2000`; валидация при `set` (пусто → 2000, 0 или 250–600000); poll fallback 2000 и кламп; в web — `ADMIN_GLOBAL_KEYS`, секция «Диагностика», убрано из кабинетного «Торговые параметры»; `list()` не перезаписывает глобальные ключи из `CabinetSetting`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (после сборки shared при необходимости).
- Docs updated: этот трекер, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-067

- Status: `done`
- Scope: Userbot фоновый опрос по всем кабинетам владельца; постановка TP reduce-only после входа (раньше порт был заглушкой).
- Files: `apps/api/src/modules/telegram-userbot/scan/telegram-userbot-scan.service.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tpsl.service.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tp-split-ports.types.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `pollTick` сканировал только «дефолтный» кабинет пользователя — чаты, привязанные только к другим кабинетам, не подтягивались до ручного скана в UI. В `BybitService.placeTpSplitIfNeeded` в `BybitTpSlService` передавался пустой `placeTpSplitIfNeededPort` — лимитки TP не выставлялись после fill, оставался только SL.
- Changes: для каждого подключённого userbot-клиента цикл `listCabinetsForUser` + `runWithCabinet` + `scanTodayMessagesCore`; реализован `placeTpSplitIfNeeded` (позиция на бирже, нет открытых ENTRY/DCA, нет живых TP в БД, `splitPositionQtyForTps`, снижение числа уровней при minQty, `submitOrder` Limit reduceOnly, событие `BYBIT_TP_LIMITS_PLACED`).
- Manual verification: `npm run build -w apps/api` (pass); на стенде — фоновый опрос для не-дефолтного кабинета; после входа в позицию появляются TP в БД и на Bybit.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-071

- Status: `done`
- Scope: Web — cookie `cabinet_id` при навигации с `?cabinetId=` (SSR для сделок).
- Files: `apps/web/middleware.ts`, `docs/audit/06-progress-tracker.md`
- Findings: переключатель кабинета пишет cookie только в `useEffect` на клиенте; при редиректе с `?cabinetId=` первый SSR к `/trades` мог идти без cookie (до эффекта), список пустой до клиента.
- Changes: для авторизованных запросов middleware выставляет `cabinet_id` из query (как `CabinetSwitcher`: path `/`, max-age, SameSite=Lax, Secure в production).
- Manual verification: `npm run check-types -w apps/web`; после смены кабинета обновить `/trades` без query — сделки видны.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-070

- Status: `done`
- Scope: Web — страница «Сделки» и активный кабинет (SSR).
- Files: `apps/web/app/trades/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: `/trades` брала `cabinetId` только из query; при прямом заходе или обновлении без `?cabinetId=` серверный `fetchJson` не передавал кабинет, API резолвил другой кабинет (дефолт пользователя), список сделок был пустым при сигналах в выбранном кабинете. Главная (`/`) уже использовала cookie `cabinet_id`.
- Changes: как на главной — `cabinetId = query || cookie('cabinet_id')` перед запросами к `/orders/trades`, `/orders/sources`, `/settings/effective`.
- Decomposition notes (`utils/constants/hooks/types`): N/A (2 строки контекста в существующей странице).
- Manual verification: `npm run check-types -w apps/web` или `npm run build -w apps/web`; вручную — активный кабинет с сделками, открыть `/trades` без query (с установленной cookie переключателя) — список не пустой.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-071

- Status: `done`
- Scope: Userbot — повторный сигнал по той же паре/направлению после закрытия позиции не должен помечаться дубликатом из‑за «залипшего» дедуп-хеша.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `wouldDuplicateActivePairDirection` при чистой бирже вызывает `reconcileStaleOpenSignalsForPairAndDirection`, который закрывал сделки через `updateMany` без `UserbotSignalHashService.releaseForSignalId`; следующий ingest с теми же уровнями падал на `tryCreate(signalHash)` («Сигнал уже обрабатывался ранее»), хотя позиции на бирже уже нет.
- Changes: после успешного reconcile для каждого закрытого `signalId` вызывается `releaseForSignalId` (как при `updateSignalStatus` на CLOSED_*).
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-072

- Status: `done`
- Scope: Web — пункт меню «Логи» (`/logs`).
- Files: `packages/shared/src/nav-menu.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в `NAV_MENU_ITEMS` не было записи для `/logs` (страница и admin-only API остаются); пункт не рендерился ни в шапке, ни в бургере.
- Changes: добавлен `{ id: 'logs', label: 'Логи', href: '/logs', adminOnly: true, defaultHidden: true }` — виден только админу, по умолчанию в блоке бургера (как «Диагностика»).
- Manual verification: `npm run build -w packages/shared` (или общий web build).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A (`GET /logs` по-прежнему только admin)

### AUD-066

- Status: `done`
- Scope: Изоляция торговых и кабинетных настроек между кабинетами.
- Files: `apps/api/src/modules/settings/settings.constants.ts`, `apps/api/src/modules/settings/settings.service.ts`, `packages/shared/src/cabinet-settings.ts`, `apps/web/app/settings/settings-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: ключи из `CABINET_SCOPED` одновременно были в `GLOBAL_SHARED_SETTING_KEYS` → `get`/`set` обходили `cabinetSetting` и писали в глобальную таблицу `Setting` (одно значение на всё приложение); плюс fallback на `userSetting` для кабинетных ключей давал общий слой между кабинетами одного пользователя.
- Changes: убрано пересечение кабинетных ключей с `GLOBAL_SHARED_SETTING_KEYS`; `POLLING_INTERVAL_MS` и `BYBIT_ACCOUNT_MAX_CONCURRENCY` добавлены в `CABINET_SCOPED_SETTING_KEYS`; при активном кабинете для кабинетных ключей не подмешиваются `userSetting`/глобальная `Setting` в `get`/`getMany`/`list` (и `set` не пишет в `userSetting` для этой комбинации); в web `ADMIN_GLOBAL_KEYS` убраны те же торговые ключи, чтобы не скрывать их не-админу в режиме кабинета.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass); смена активного кабинета и `/settings` — разные значения после отдельного сохранения; старые значения в глобальной `Setting` для этих ключей больше не подставляются в кабинет без строки в `CabinetSetting` (см. `.env`/дефолты).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-073

- Status: `done`
- Scope: Bybit — постановка SL/TP после входа.
- Files: `apps/api/src/modules/bybit/tpsl/bybit-tpsl.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `ensureStopLossForMultiTpOpenPosition` выходил при `takeProfits.length <= 1`, поэтому для одного TP `setTradingStop` никогда не вызывался; проверка «есть любой ордер kind=TP» блокировала SL при мёртвых TP в БД (failed/cancelled).
- Changes: ранний SL для любой позиции при валидном `stopLoss` и отсутствии **живых** TP (`hasLiveTpOrders`); убрана зависимость от числа уровней take-profit.
- Decomposition notes (`utils/constants/hooks/types`): переиспользован `hasLiveTpOrders` из `bybit-order-status.util`.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-074

- Status: `done`
- Scope: Bybit — защита от ложного stale-reconcile при сбоях API (`Forbidden`/`retCode != 0`).
- Files: `apps/api/src/modules/bybit/exposure/bybit-exposure.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/scripts/restore-incident-stale-reconcile-2026-05-07.sql`, `docs/audit/06-progress-tracker.md`
- Findings: проверка экспозиции возвращала `false` при частичных ошибках запросов к Bybit, из-за чего поллинг считал сторону «чистой» и снимал `ORDERS_PLACED`, хотя ордера/позиции на бирже оставались.
- Changes: добавлен вердикт экспозиции `exposed|flat|unknown`; при `unknown` сторона считается небезопасной для reconcile; в duplicate-check при `unknown` используется fallback на БД; добавлен SQL-скрипт восстановления ошибочно закрытых сигналов в окне инцидента.
- Decomposition notes (`utils/constants/hooks/types`): логика вынесена в существующий `exposure`-сервис без расширения фасада бизнес-операциями.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-075

- Status: `done`
- Scope: Nest DI — падение старта API (Railway) из-за цикла модулей userbot ↔ orders ↔ telegram.
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `UndefinedDependencyException` у `TelegramUserbotService`, параметр с индексом 8 (`TelegramService` как `?`): при циклическом `require` класс `TelegramService` оказывался `undefined` на этапе метаданных DI.
- Changes: `@Inject(forwardRef(() => TelegramService))` для `telegramBot` в конструкторе (аналогично `OrdersService`).
- Manual verification: `npm run build -w apps/api` (pass); после деплоя — успешный `start:railway` без `UndefinedDependencyException`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-076

- Status: `done`
- Scope: Railway / прод-шум в логах: reconcile backlog, таймаут Telegraf, CHANNEL_INVALID при userbot sync.
- Files: `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `.env.example`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: возраст pending в `WorkerQueueService` считали от `createdAt`; при upsert по `jobKey` поле не обновлялось → ложные «14 дней» backlog. Таймаут запуска бота 20s часто не хватал. `getDialogs` без catch давал сырой поток RPC при `CHANNEL_INVALID`.
- Changes: backlog по `updatedAt`; `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS` (дефолт 60s, 5s–180s); обработка `getDialogs` + сообщение про недоступные каналы.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-077

- Status: `done`
- Scope: Userbot — после деплоя снова нужно было «подключать» сессию / иногда QR: восстановление шло только для дефолтного кабинета.
- Files: `apps/api/src/modules/settings/settings.constants.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: MTProto-клиент кладётся в `clientsByUserId` под `cabinet.ownerUserId`; при старте `connectFromStoredSession` вызывался в контексте **дефолтного** кабинета, а не того, где пользователь прошёл QR — для «своего» кабинета в UI клиент оказывался «чужим».
- Changes: глобальная настройка `TELEGRAM_USERBOT_SESSION_OWNER_USER_ID`; запись при успешном QR и `connectFromStoredSession`; `resolveCabinetIdForStoredSessionRestore()` для старта и watchdog; при очистке `TELEGRAM_USERBOT_SESSION` удаляется и привязка владельца.
- Manual verification: `npm run build -w apps/api` (pass); один раз «Подключить из сессии» или QR после деплоя старой версии — записывает owner; следующие деплои восстанавливают нужный кабинет.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-078

- Status: `done`
- Scope: Userbot — одна MTProto-сессия на AuthUser для всех кабинетов; восстановление после деплоя без `runWithCabinet`.
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: старт/watchdog вызывали `connectFromStoredSession` в контексте **кабинета**, найденного по владельцу сессии; при отсутствии кабинета с `ownerUserId` или рассинхроне восстановление не поднимало клиент, UI показывал «отключено».
- Changes: `connectFromStoredSession({ sessionOwnerUserId })` и `attachClient(client, ownerUserId)`; активный клиент в UI — если `cabinet.ownerUserId === TELEGRAM_USERBOT_SESSION_OWNER_USER_ID`; `resolveSessionOwnerUserIdForRestore()` (настройка + fallback при ровно одном `AuthUser`); удалены `resolveCabinetIdForStoredSessionRestore` / `CabinetService` из фасада; `onAfterUserbotAttach` подбирает кабинет владельца сессии только для autosync чатов.
- Manual verification: `npm run build -w apps/api` (pass); деплой при `TELEGRAM_USERBOT_ENABLED` + непустая сессия + известный owner — MTProto поднимается без привязки к выбранному кабинету.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-079

- Status: `done`
- Scope: Userbot ingest — изоляция дедупа и pair/cooldown между кабинетами при общих Telegram-группах.
- Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260512143000_userbot_signal_hash_cabinet_scope/migration.sql`, `apps/api/src/modules/telegram-userbot/userbot-signal-hash.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pair-direction.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-signal-reply.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-signal-lookup.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `TgUserbotSignalHash` был глобальным по `hash` — второй кабинет с тем же распарсенным сигналом получал `duplicate_signal`; in-memory кулдаун/transition по паре не учитывал `cabinetId`; при отсутствии ALS `findActiveSignal*` мог смотреть все кабинеты.
- Changes: таблица `TgUserbotSignalHash` с `cabinetId` и `@@unique([cabinetId, hash])`; `release(hash)` по-прежнему снимает hash для всех кабинетов (правка текста сообщения); `releaseForSignalId` — по `(cabinetId, hash)`; pair-direction методы принимают `cabinetId`; `resolvedCabinetScopeWhere` с fallback на дефолтный кабинет.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass); ожидаемо: два кабинета, одна группа, **разные** Bybit-ключи — оба могут зарегистрировать тот же контентный hash; при **одинаковых** ключах Bybit дубликат по бирже остаётся (один аккаунт).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-081

- Status: `done`
- Scope: Уведомления Telegram и зеркало VK — явная подпись кабинета (имя из БД).
- Files: `apps/api/src/modules/cabinet/cabinet.service.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/vk/vk-notify-mirror.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: при нескольких кабинетах и общем whitelist сложно понять, к какому кабинету относится сообщение; webhook `[CRITICAL API UNAVAILABLE]` не содержал кабинет.
- Changes: `CabinetService.getCabinetDisplayLabel`; префикс «Кабинет: …» в Telegram (HTML/plain по типу сообщения) и в `VkNotifyMirrorService` для всех зеркалируемых сценариев; контекст кабинета + fallback на дефолтный id; в `notifyCriticalExternalApiUnavailable` — строки `cabinetId` / `cabinet` и дедуп по `cabinetId`.
- Decomposition notes (`utils/constants/hooks/types`): подпись в `CabinetService`, префиксы — приватные хелперы сервисов уведомлений.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-083

- Status: `done`
- Scope: Web/API — в карточках сделок (`/trades`) показывать название кабинета.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/web/app/trades/page.tsx`, `apps/web/app/trades/trades-list.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: в ответе `GET /orders/trades` не было человекочитаемой подписи кабинета для строки сделки.
- Changes: в `listTrades` — `include.cabinet` (`name`, `slug`), в JSON — поле `cabinetName` (имя, иначе slug, иначе `cabinetId`); в UI — строка «Кабинет» в мета-блоке карточки.
- Decomposition notes (`utils/constants/hooks/types`): без вынесения — одна точка в `OrdersService`.
- Manual verification: `npm run build -w apps/api` (pass); вручную: `/trades` — в карточках видно имя кабинета.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-084

- Status: `done`
- Scope: API/Web — выбранный кабинет игнорировался, всегда показывался один и тот же (первый у пользователя в БД).
- Files: `apps/api/src/common/cabinet-request.util.ts`, `apps/web/lib/api.ts`, `apps/web/lib/search-param.util.ts`, `apps/web/app/trades/page.tsx`, `apps/web/app/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: при двух `cabinetId` в query (дубль из `q` + `withCabinetQuery`) Nest отдаёт `string[]`; `String([id,id])` давало невалидный id → `resolveCabinetIdForUser` не находил кабинет и падал в `ensureUserDefaultCabinet` (первый кабинет по `createdAt`). На RSC `searchParams.cabinetId` как `string[]` терялся при проверке `typeof === 'string'`.
- Changes: `pickRequestedCabinetId` — нормализация query/header через первый валидный скаляр; `withCabinetQuery` — не добавлять второй `cabinetId`, если уже есть; `searchParamFirst` для `/` и `/trades`.
- Decomposition notes (`utils/constants/hooks/types`): `search-param.util.ts` для App Router.
- Manual verification: `npm run build -w apps/api` и `npm run build -w apps/web` (pass); вручную: два кабинета — `/trades` и дашборд отдают данные выбранного кабинета.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-085

- Status: `done`
- Scope: Ops — runbook: Railway SSH / env / проверка кабинетов в Postgres.
- Files: `docs/audit/04-operational-runbooks.md`
- Findings: отдельных `CABINET_*` в env нет; кабинеты только в БД; на связанном с репо Railway (`railway ssh -s api`) выборка показала БД **без** таблицы `Cabinet` и без `Signal.cabinetId` (устаревшая схема или не тот `DATABASE_URL`/проект).
- Changes: раздел «Railway: SSH, переменные и кабинеты в БД» с командами `railway ssh`, проверкой `DATABASE_URL`, списком таблиц и `prisma.cabinet.findMany`.
- Manual verification: `railway ssh -s api` (pass); node + Prisma в контейнере (pass).
- Docs updated: `04-operational-runbooks.md`, этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-086

- Status: `done`
- Scope: Web — расхождение `cabinetId` в запросах `/api/backend/cabinets` и данных SSR `/trades`.
- Files: `apps/web/lib/api.ts`, `docs/audit/04-operational-runbooks.md`, `docs/audit/06-progress-tracker.md`
- Findings: `getClientCabinetId()` для `fetchJson`/`fetchApiResponse` учитывал только `localStorage`; RSC `/trades` использовал `searchParams` + cookie → в Network видны одни `cabinetId`, список сделок строился по другому контексту.
- Changes: в браузере `getClientCabinetId` делегирует в `readActiveCabinetIdClient()` (порядок: URL → storage → cookie); в runbook — короткий пункт про симптом и диагностику.
- Manual verification: `npm run build -w apps/web` (pass); вручную: смена кабинета — `/cabinets` и перезагрузка `/trades` согласованы.
- Docs updated: `04-operational-runbooks.md`, этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-080

- Status: `done`
- Scope: Настройки — запрет одинакового Bybit API key в двух кабинетах.
- Files: `apps/api/src/modules/settings/settings.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: один и тот же ключ в `CabinetSetting` у разных кабинетов давал общую биржу и ложные «дубликаты» сигналов при разной логике UI.
- Changes: при `set` для `BYBIT_API_KEY_MAINNET` / `BYBIT_API_KEY_TESTNET` — trim значения и проверка уникальности значения ключа между кабинетами; `BadRequestException`, если ключ уже сохранён у другого кабинета (аналогично `TELEGRAM_BOT_TOKEN`).
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-082

- Status: `done`
- Scope: Web — `/trades`: смена кабинета не обновляла список сделок.
- Files: `apps/web/app/trades/trades-filters.tsx`, `apps/web/app/trades/page.tsx`, `apps/web/app/components/CabinetSwitcher.tsx`, `apps/web/lib/cabinet-client.util.ts`, `docs/audit/06-progress-tracker.md`
- Findings: клиентский `router.replace` при правках фильтров собирал query без `cabinetId`, SSR подставлял только cookie — возможна рассинхронизация с выбранным кабинетом; переключатель кабинета полагался на `useEffect` для cookie до навигации.
- Changes: в конце `replaceQuery` и при «Сброс» закрепляется `cabinetId` из URL или `readActiveCabinetIdClient()`; `CabinetSwitcher` синхронно пишет cookie/localStorage перед `location.assign`; `export const dynamic = 'force-dynamic'` на странице сделок; безопасный `decodeURIComponent` в `readActiveCabinetIdClient`.
- Decomposition notes (`utils/constants/hooks/types`): переиспользован существующий `cabinet-client.util`.
- Manual verification: `npm run build -w apps/web` (ожидается pass); вручную: два кабинета, `/trades`, смена кабинета и смена фильтра/сброс — список и total соответствуют кабинету.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-087

- Status: `done`
- Scope: Ассистент-бот — события сделки (SignalEvent) и ошибки userbot: контекст кабинета, дубликаты ingest; critical util для userbot/OpenRouter (не ассист-поток).
- Files: `apps/api/src/common/critical-notify.constants.ts`, `apps/api/src/common/critical-notify.util.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/utils/telegram-api-notify-html.util.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.constants.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/api/src/modules/telegram-userbot/openrouter/telegram-userbot-openrouter.service.ts`, `apps/api/src/modules/vk/vk-notify-mirror.service.ts`
- Findings: `notifyTradeSignalEvent` вызывался через `void` после выхода из `runWithCabinet` — ALS без `cabinetId`, whitelist пуст, Telegram молчал; hedge audit — тот же класс `void` на notify; дубликаты userbot не вызывали `notifySignalFailureToBot`.
- Changes: разрешение `cabinetId` по `signalId` и выполнение trade-event + настройки внутри `runWithCabinet`; `postCriticalNotifyText` + вынесенный `CRITICAL_NOTIFY_URL` для **операционных** алертов (pipeline `notifyCriticalExternalApiUnavailable`, OpenRouter low balance), без дублирования обычных ассист-уведомлений в Telegram; `await notifyTradeSignalEvent` из `createSignalEvent`; `await` hedge audit из placement; этап `ingest` и уведомления по веткам `duplicate_signal`; pipeline/openrouter на общий util для critical POST.
- Decomposition notes (`utils/constants/hooks/types`): `critical-notify.{constants,util}.ts` в `common/`.
- Manual verification: `npm run build -w api` (pass); ожидаемо: `TP_SL_STEPPED` и дубликаты ingest — только Telegram whitelist; `CRITICAL_NOTIFY_URL` — по-прежнему при `[CRITICAL API UNAVAILABLE]` / low balance OpenRouter.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-088

- Status: `done`
- Scope: Уточнение AUD-087 — не слать обычные ассист-уведомления (trade-events, userbot-failure, hedge audit) на `CRITICAL_NOTIFY_URL`.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: дублирование ассист-сообщений на qnotify засоряло канал ops.
- Changes: удалены вызовы `postCriticalNotifyText` из `notifyTradeSignalEvent`, `notifyUserbotSignalFailure`, `notifyHedgeOppositePlacementAudit`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-089

- Status: `done`
- Scope: Пороговые уведомления о equity (totalUsd) по кабинетам на `CRITICAL_NOTIFY_URL` (edge-триггер).
- Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260512180000_cabinet_balance_alert_rules/migration.sql`, `apps/api/src/modules/bybit/balance-alert/*`, `apps/api/src/modules/bybit/bybit.module.ts`, `apps/web/app/settings/page.tsx`, `apps/web/app/settings/settings.types.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`
- Findings: N/A (новая фича по плану).
- Changes: модель `CabinetBalanceAlertRule`; CRUD `bybit/balance-alerts`; `BalanceAlertSchedulerService` (env `BALANCE_ALERT_ENABLED`, `BALANCE_ALERT_CRON`); cron обходит кабинеты с `runWithCabinet`, сравнивает `getUnifiedUsdtBalanceDetails().totalUsd`, шлёт `postCriticalNotifyText` при переходе в зону порога; секция на `/settings` (режим кабинет).
- Decomposition notes (`utils/constants/hooks/types`): отдельная папка `balance-alert/` под модулем Bybit; тип строки правила в `settings.types.ts`.
- Manual verification: `npm run build -w api`, `npm run build -w web` (pass); вручную: CRUD на `/settings`, миграция на стенде `prisma migrate deploy`.
- Docs updated: этот трекер, `.env.example`.
- Linked risks (`SEC-###`): N/A (при нескольких репликах API возможен редкий дубликат POST на qnotify без advisory lock).

### AUD-090

- Status: `done`
- Scope: Telegram whitelist для уведомлений (userbot failure, digest) — выравнивание с цепочкой `SettingsService.get` и env.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/services/telegram-digest-scheduler.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `getWhitelistUserIdsForCabinet` читал только `CabinetSetting` в БД; VK-зеркало использует `settings.get`/`process.env` — при whitelist только в `.env` VK получал сообщения, ассист-бот возвращал `TELEGRAM_WHITELIST пуст`.
- Changes: разрешение whitelist через `runWithCabinet` + `settings.get('TELEGRAM_WHITELIST')`; дайджест — тот же источник внутри одного `runWithCabinet`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass); при пустом ключе в БД и заданном `TELEGRAM_WHITELIST` в env — ошибка userbot должна уйти в Telegram тем же списком id, что и раньше ожидался из настроек.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-091

- Status: `done`
- Scope: Правило агента — Railway SSH, уведомление при необходимости авторизации, карта ветка→окружение.
- Files: `.cursor/rules/railway-diagnostics-and-branches.mdc`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: N/A (операционная память для агента и людей).
- Changes: always-on rule; в `AGENTS.md` — краткое резюме и ссылка на правило.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: файлы правки читаемы; дубликатов секции Railway нет.
- Docs updated: этот трекер, `AGENTS.md`, новое правило.
- Linked risks (`SEC-###`): N/A (SSH/CLI — только с согласия владельца проекта; секреты в чат не выводить).

### AUD-092

- Status: `done`
- Scope: Telegram — исходящие уведомления (ошибки userbot, события сделки, стартовое приветствие, дайджест): те же получатели, что нужны при доступе по привязанному аккаунту без whitelist.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/services/telegram-digest-scheduler.service.ts`, `apps/api/src/modules/telegram/utils/telegram-whitelist.util.ts`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Findings: `isAllowed` допускает и whitelist, и любого `AuthUser` с тем же `telegramUserId`; проактивные `sendMessage` шли только на `TELEGRAM_WHITELIST` → команды работали, уведомления нет.
- Changes: объединение получателей: whitelist ∪ числовой Telegram владельца кабинета ∪ активные `CabinetMember`; публичный `listCabinetTelegramNotifyRecipientIds` для дайджеста; хелперы слияния id в `telegram-whitelist.util.ts`.
- Decomposition notes (`utils/constants/hooks/types`): расширен только существующий whitelist-util.
- Manual verification: `npm run build -w apps/api` (pass); после деплоя — ошибка ingest duplicate должна приходить владельцу с привязанным Telegram даже при пустом whitelist (если нужна изоляция только по whitelist — заполнить whitelist и не полагаться на owner).
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A (владелец/участники получают больше сообщений, чем при чистом whitelist-only — это намеренное выравнивание с доступом к боту).

### AUD-093

- Status: `done`
- Scope: Userbot MTProto — сохранение актуальной StringSession в БД после работы GramJS и перед рестартом процесса.
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.constants.ts`, `.env.example`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: строка `TELEGRAM_USERBOT_SESSION` обновлялась в основном при QR; GramJS может менять сессию (DC и т.д.) во время работы — в БД оставалась старая версия → после редеплоя `connectFromStoredSession` получал «Сессия недействительна». Отдельно: несколько реплик API с одной сессией по-прежнему рискуют инвалидировать вход (операционное ограничение).
- Changes: периодическая запись `session.save()` при авторизованном клиенте (`TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS`, дефолт 10 мин); запись перед `disconnect`/`disconnectAll` и при замене клиента в `attachClient`; очистка maps в `disconnectAll`; комментарии в `.env.example` и `AGENTS.md` про 1 реплику API.
- Decomposition notes (`utils/constants/hooks/types`): константы интервала в `telegram-userbot.constants.ts`.
- Manual verification: `npm run build -w apps/api` (pass); после деплоя при включённом userbot и одной реплике — без QR, если сессия была активна до рестарта и успела сохраниться (интервал или SIGTERM).
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-094

- Status: `done`
- Scope: Диагностика доставки уведомлений userbot (Telegram + VK) со страницы `/diagnostics`.
- Files: `apps/api/src/modules/diagnostics/diagnostics.controller.ts`, `apps/api/src/modules/diagnostics/diagnostics.module.ts`, `apps/api/src/modules/diagnostics/diagnostics-notify-test.service.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/vk/vk-notify-mirror.service.ts`, `apps/web/app/diagnostics/page.tsx`, `docs/auth-protected-routes.md`, `docs/audit/06-progress-tracker.md`
- Findings: N/A (кнопка для проверки каналов без воспроизведения ошибки пайплайна).
- Changes: `POST /diagnostics/notify-test` (admin + same-origin); `TelegramService.notifyDiagnosticsPing`, `VkNotifyMirrorService.mirrorDiagnosticsPing`; карточка на `/diagnostics` с ответом JSON (`cabinetId`, `telegram`, `vk`).
- Decomposition notes (`utils/constants/hooks/types`): отдельный сервис `diagnostics-notify-test.service.ts`.
- Manual verification: `npm run build -w apps/api`, `npm run build -w apps/web` (pass); админ на `/diagnostics` — кнопка отправляет тест и показывает счётчики или текст ошибки.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A (эндпоинт только admin).

### AUD-095

- Status: `done`
- Scope: Настройки — выравнивание переключателя `TELEGRAM_NOTIFY_API_TRADE_CANCELLED` с opt-out логикой API.
- Files: `apps/web/app/settings/settings-page.util.ts`, `apps/web/app/settings/page.tsx`, `apps/web/app/settings/settings-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: API считает пустое значение «уведомления включены»; UI для boolean показывал только `true` как вкл. → пустой ключ выглядел как «выкл» при фактической отправке уведомлений.
- Changes: `isTelegramNotifyApiTradeCancelledEnabled` по тем же правилам, что `notifyApiTradeCancelled`; подпись поля уточнена.
- Decomposition notes (`utils/constants/hooks/types`): хелпер в `settings-page.util.ts`.
- Manual verification: на `/settings` при пустом значении ключа переключатель в состоянии «вкл»; сохранение «выкл» даёт `false` и отключает уведомления.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-096

- Status: `done`
- Scope: Critical webhook — не помечать «Telegram bot не запущен» / отсутствие whitelist как `[CRITICAL API UNAVAILABLE]`.
- Files: `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: при падении `notifyUserbotSignalFailure` из‑за незапущенного бота для кабинета на `CRITICAL_NOTIFY_URL` уходило сообщение с `api=telegram`, хотя это конфигурация/деплой, а не недоступность Bot API.
- Changes: для `api === 'telegram'` в `isLikelyApiUnavailable` оставлены только общие сетевые/HTTP-признаки (`common`), без подстрок «telegram bot не запущен» / «telegram_whitelist пуст».
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass); при «бот не запущен» — нет POST на critical URL; при ошибке с `timeout`/`econnrefused` в тексте — по-прежнему critical.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A (меньше шума в ops-канале; саму проблему бота по-прежнему видно в логах API и VK-зеркале).

### AUD-097

- Status: `done`
- Scope: Запуск Telegraf при `TELEGRAM_BOT_TOKEN` из env / глобальных слоёв без строки в `CabinetSetting`.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/services/telegram-bot-registry.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `syncBotsWithCabinetTokens` читал токен только из Prisma `cabinet.settings`; `SettingsService.get` подставляет env и `Setting`, из‑за чего токен мог существовать для приложения, а бот не поднимался → «Telegram bot не запущен».
- Changes: разрешение токена через `runWithCabinet` + `settings.get`; остановка процесса только если токен больше ни одним кабинетом не используется; повторное использование одного экземпляра Telegraf для кабинетов с одним и тем же токеном (одно long polling).
- Decomposition notes (`utils/constants/hooks/types`): `TelegramBotRegistryService.getScopedBotOnly`.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): общий токен в нескольких кабинетах — один стек handlers привязан к кабинету первого успешного launch в текущем синке (редкий случай одного env на несколько кабинетов).

### AUD-098

- Status: `done`
- Scope: `POST /telegram-userbot/connect` — 500 и контекст кабинета для async-handlers.
- Files: `apps/api/src/modules/cabinet/cabinet-context.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: необработанные исключения в `connectFromStoredSession` (`getApiCreds`, MTProxy, `client.connect`, …) давали 500; async-chain мог терять `AsyncLocalStorage` без явной привязки Promise к `storage.run`.
- Changes: `runWithCabinetAsync`; userbot controller переведён на него; `connectFromStoredSession` в try/catch с возвратом `{ ok: false, error }` и отключением клиента; `TELEGRAM_USERBOT_*` / proxy — `BadRequestException` вместо `throw new Error`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-099

- Status: `done`
- Scope: UI userbot — повторный QR после истечения показывал старый код из‑за merge состояния.
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/web/app/telegram-userbot/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: `setQrStateForUser` делал `{ ...prev, ...next }`; при `phase: 'starting'` и переходах в ошибку сохранялись прежние `qrDataUrl` / `loginUrl` / `error`, пока GramJS не отдал новый `qrCode` — карточка «QR авторизация» показывала истёкшее изображение после повторного «Войти по QR» и перезагрузки страницы.
- Changes: константа `QR_STATE_VISUAL_CLEAR`; сброс визуальных полей при `starting`, `need_password`, `completing_login`, `authorized`, `cancelled` и при всех `phase: 'error'` в QR-потоке; на web показывать `<img>` только при `waiting_scan` и наличии `qrDataUrl`, иначе фазы-специфичный текст.
- Decomposition notes (`utils/constants/hooks/types`): локальная константа рядом с клиентом userbot.
- Manual verification: `npm run build -w apps/api`, `npm run build -w apps/web` (pass); повторный старт QR до прихода нового токена — «Подготовка QR…», без старого data URL.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-100

- Status: `done`
- Scope: Разные боты по кабинетам — исходящие уведомления без «чужого» primary и без Telegraf на реплике.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Findings: `getBotForCabinet` в реестре отдавал `primaryBot`, если у кабинета не было scoped-экземпляра в этом процессе — при нескольких кабинетах с разными токенами возможна подмена бота; при нескольких репликах API на «пустой» реплике уведомления не уходили, хотя Bot API доступен по токену.
- Changes: `getCabinetOutboundTelegraf(cabinetId)` — сначала `getScopedBotOnly`, иначе временный `Telegraf(token)` по `TELEGRAM_BOT_TOKEN` кабинета; все перечисленные notify + `sendPasswordResetCode` / `getBotForTelegramUserId`; `runWithCabinetAsync` для async-тел hedge/trade events и ранее переведённых notify; явный `cabinetId` до колбэка.
- Decomposition notes (`utils/constants/hooks/types`): N/A (логика в фасаде `TelegramService`).
- Manual verification: `npm run build -w apps/api` (pass); ручная проверка: тест «Диагностика» и userbot-уведомления с двумя кабинетами / двумя токенами и при необходимости второй реплике API.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-101

- Status: `done`
- Scope: AppLog по кабинетам при общем `TELEGRAM_BOT_TOKEN` и ссылка «Логи» в навигации.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/app-log/app-log.service.ts`, `packages/shared/src/nav-menu.ts`, `docs/audit/06-progress-tracker.md`
- Findings: при reuse одного Telegraf на несколько кабинетов с одним токеном `registerTelegramAccessMiddleware` оставался с `cabinetId` первого запуска → ACL и `AppLog.append` шли в первый кабинет; пункт меню `/logs` без `cabinetAware` не добавлял `cabinetId` в URL.
- Changes: карта `botTokenCabinetRouting` (актуальный список кабинетов на токен, обновляется каждый sync); middleware перебирает кандидатов и берёт первый, где `isAllowed`; контекст через `runWithCabinetAsync`; в `AppLog.append` снимок `cabinetId` до первого `await`; в `NAV_MENU_ITEMS` у «Логи» — `cabinetAware: true`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api`, `npm run build -w apps/web` (pass); при двух кабинетах с одним токеном — новые записи AppLog в кабинете, для которого пользователь проходит whitelist первым в порядке кабинетов по токену.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-102

- Status: `done`
- Scope: Web — синхрон `?cabinetId=`, cookie и селект кабинета в шапке.
- Files: `apps/web/app/components/TopNav.tsx`, `apps/web/app/components/CabinetSwitcher.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: `readActiveCabinetIdClient` отдаёт приоритет query, а `CabinetSwitcher` инициализировался только из localStorage/cookie; ссылки в `TopNav` строились из cookie сервера без учёта URL → рассинхрон GET и выпадающего списка при клиентских переходах.
- Changes: `readActiveCabinetIdClient` + ключ `cabinetSyncKey` из `useSearchParams` под `Suspense`; пересчёт `linkCabinetId` для `cabinetAware` ссылок; `CabinetSwitcher` синхронизирует выбор с URL и использует `ACTIVE_CABINET_STORAGE_KEY`.
- Decomposition notes (`utils/constants/hooks/types`): переиспользованы `readActiveCabinetIdClient`, `ACTIVE_CABINET_STORAGE_KEY`.
- Manual verification: `npm run build -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-103

- Status: `done`
- Scope: Web — единый `cabinetId` в ссылках: дашборд, шапка, навигация между страницами.
- Files: `apps/web/lib/cabinet-page-href.util.ts`, `apps/web/app/components/TopNav.tsx`, `apps/web/app/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: логотип и «Сброс» на дашборде вели на `/` без `cabinetId`; карточки кабинетов собирали query вручную; ссылки в шапке дублировали логику `?cabinetId=` — риск расхождения с селектом и cookie после смены кабинета.
- Changes: `withCabinetPageHref`; бренд в `TopNav` и пункты меню через неё; карточки кабинетов на главной и сброс фильтра источника сохраняют выбранный кабинет в URL (middleware по-прежнему дублирует query в cookie для SSR).
- Decomposition notes (`utils/constants/hooks/types`): выделен `cabinet-page-href.util.ts`.
- Manual verification: `npm run build -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-104

- Status: `done`
- Scope: Userbot — изоляция ручного перечитывания (`reread` / `reread-all`) по кабинету.
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/web/app/telegram-userbot/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: `rereadIngestMessage` и `rereadAllIngestMessages` ставили задачи для всех кабинетов с `listEnabledCabinetIdsForChat(chatId)`; эндпоинты `POST reread/*` не использовали `runWithCabinet` — дубликат/уведомления уходили во все кабинеты на ту же группу.
- Changes: `runWithCabinet` + `@Query cabinetId` / `@ApiQuery` на обоих POST; один кабинет из `CabinetContextService`, проверка `CabinetTelegramSource` (enabled) для чата; один `enqueueIngestJob`; `reread-all` — ingest с `routes.some(cabinetId)`, поле ответа `skippedNoEnabledSource`; UI userbot — строка в сообщении об успехе.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api`, `npm run build -w apps/web` (pass); рекомендуется ручная проверка: два кабинета, одна группа — «перечитать» только из кабинета A не триггерит очередь кабинета B.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-105

- Status: `done`
- Scope: Telegram assist — приветствие при каждом подъёме бота кабинета (не только после первого sync при старте API).
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `sendStartupGreeting` вызывался один раз из `initializeBots` после первого `syncBotsWithCabinetTokens`; при появлении токена позже, после таймаута launch или при reuse одного Telegraf на второй кабинет пользователи не получали стартовое сообщение.
- Changes: `sendStartupGreetingForCabinet` + `resolveStartupGreetingText`; вызов после успешного `launch` и при attach по общему токену; глобальный вызов из `initializeBots` убран (избежание дубля с per-cabinet); `sendStartupGreeting()` делегирует всем кабинетам для legacy `launchBotWithRetry`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass); рекомендуется: добавить токен кабинету после старта API — приходит то же сообщение, что и при `TELEGRAM_STARTUP_MESSAGE` / дефолт.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-106

- Status: `done`
- Scope: Telegram assist — старт long polling после полной инициализации приложения.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `initializeBots` вызывался из `onModuleInit` параллельно с другими хуками без гарантии порядка; первый `syncBotsWithCabinetTokens` иногда не видел `TELEGRAM_BOT_TOKEN` (ещё не готовы Prisma/кабинет/слой настроек) → ложное предупреждение «боты выключены» при живых токенах.
- Changes: перенос на `OnApplicationBootstrap`; текст предупреждения при `launched === 0` уточняет первый sync и повтор по интервалу.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-107

- Status: `done`
- Scope: Telegram assist — очередь и пауза между запусками Telegraf (несколько кабинетов / таймауты launch).
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `.env.example`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: подряд несколько `deleteWebhook`+`launch` к Bot API и фоновый `launch` после `Promise.race` timeout повышали риск таймаутов и «залипших» поллеров.
- Changes: `withTelegramBotLaunchSerialized` — не более одного launch одновременно на процесс; `TELEGRAM_BOT_LAUNCH_STAGGER_MS` (дефолт 2000, `0` — выкл.) — пауза между завершением одной попытки и началом следующей; при ошибке/таймауте — `bot.stop('SIGTERM')`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-108

- Status: `done`
- Scope: Bybit private WS — старт после готовности приложения и исправление «залипшего» отказа при первом пустом чтении ключей.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/instrument/bybit-client.service.ts`, `AGENTS.md`, `docs/audit/06-progress-tracker.md`
- Findings: `startPrivateWsSync` вызывался из `onModuleInit` и выставлял `wsStarted` до проверки `getBybitCredentials` — при раннем пустом ответе настройки лог «no credentials» и повторная попытка при появлении ключей невозможны.
- Changes: вызов из `OnApplicationBootstrap`; `wsStarted` только после успешного создания клиента или осознанного отключения (sync off / multi-cabinet); при `no credentials` или ошибке init — `false` и одна отложенная повторная попытка через 10 с из `BybitService`; при ошибке init — попытка `closeAll` и сброс `wsClient`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-109

- Status: `done`
- Scope: Bybit private WS — глобальные ключи `BYBIT_PRIVATE_WS_*` + fallback на дефолтный кабинет; Telegraf — устранение гонки таймаута с фоновым `launch()`.
- Files: `apps/api/src/modules/bybit/instrument/bybit-client.service.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `.env.example`, `AGENTS.md`, `docs/audit/01-env-and-secrets-matrix.md`, `docs/audit/06-progress-tracker.md`
- Findings: private WS не видел ключи только в `CabinetSetting`; `Promise.race` по таймауту давал ERROR и затем лог «Telegram bot started» из завершившегося позже `bot.launch()`.
- Changes: `resolveCredentialsForPrivateWs` (приоритет `BYBIT_PRIVATE_WS_*` → `runWithCabinetAsync` дефолтного кабинета → `getBybitCredentials`); секреты в `COMPROMISED_SECRET_KEYS`; в `launchCabinetBotWithTimeout` — флаг `timedOut`, после таймаута не регистрировать бота; дефолт `TELEGRAM_BOT_LAUNCH_STAGGER_MS` при пустом env снова 2000 мс.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`, `docs/audit/01-env-and-secrets-matrix.md`.
- Linked risks (`SEC-###`): N/A

### AUD-110

- Status: `done`
- Scope: Userbot — ручное перечитывание снимает дедуп по `signalHash`, чтобы не блокировало «Сигнал уже обрабатывался ранее» при пустой бирже.
- Files: `apps/api/src/modules/telegram-userbot/userbot-signal-hash.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: дедуп — таблица `TgUserbotSignalHash` (хеш от пары/направления/уровней, не позиция на Bybit); `tryCreate` после первого прохода оставлял запись; `reread` передавал `signalHash: null` в job, но не удалял строку в `TgUserbotSignalHash` и не обнулял `TgUserbotIngest.signalHash` в БД.
- Changes: `releaseForCabinetAndHash`; для `manual-reread` / `manual-reread-all` перед `tryCreate` — снятие хеша для `effectiveCabinetId`; при постановке в очередь reread — `signalHash: null` на `TgUserbotIngest`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass); повторный reread того же SUI-сообщения в кабинете — проходит стадию дедупа (при отсутствии других блокировок).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-111

- Status: `done`
- Scope: Userbot — в уведомлении об ошибке сигнала показывать пару из парсера, а не только эвристику по сырому тексту.
- Files: `apps/api/src/modules/telegram-userbot/utils/telegram-userbot-text.util.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: поле «Токен» в `notifyUserbotSignalFailure` заполнялось `extractTokenHint(text)` (regex `XXXUSDT` или первое слово); в VIP-постах часто нет подстроки `SUIUSDT` → `UNKNOWN`, хотя `signal.pair` уже корректен.
- Changes: `tokenHintForSignalFailure(text, pair)`; на стадиях ingest после успешного `parse` — `signal.pair` в подсказке токена.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-112

- Status: `done`
- Scope: Bybit — пояснение minQty: доступный vs equity баланс; формулировка для одного уровня входа.
- Files: `apps/api/src/modules/bybit/orders/bybit-placement-validation.service.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: номинал считается от `availableUsd`; при одном лимите сообщение «Доля номинала на вход 1» вводило в заблуждение (весь номинал позиции); пользователь сравнивал с equity ~21 USDT.
- Changes: при одном `effectiveEntries` — текст «Номинал позиции …»; при отказе до ордера — блок `buildMinQtySizingHint` + расширенный `appLog`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-113

- Status: `done`
- Scope: Размер позиции — дефолт 6 USDT vs %: приоритет `orderUsd` в placement; эвристика в transcript.
- Files: `apps/api/src/modules/transcript/transcript.service.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в `ENV_FALLBACK` заданы `DEFAULT_ORDER_USD=6` и `MIN_CAPITAL_AMOUNT=6` (пол в БД/env); при `orderUsd>0` в сигнале процент не используется; модель часто оставляет `orderUsd` = числу из промпта вместе с `capitalPercent` из поста.
- Changes: `resolveOrderUsd`: если `capitalPercent` 1–100 и `orderUsd` ≈ дефолту промпта — `orderUsd`→0 (режим %); расширен текст `buildMinQtySizingHint` для ветки фикса и редкого «без полей».
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-114

- Status: `done`
- Scope: Документация и подсказки minQty — `capitalPercent` > 100 vs плечо.
- Files: `packages/shared/src/index.ts`, `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `apps/api/src/modules/transcript/transcript.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: текст `buildMinQtySizingHint` везде говорил «× плечо = номинал»; при `capitalPercent > 100` в коде номинал = `balance×(pct/100)` без повторного × leverage.
- Changes: раздельные формулировки для 1–100 и >100; JSDoc `SignalDto.capitalPercent`; комментарий у `resolveOrderUsd`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-115

- Status: `done`
- Scope: Bybit placement — `capitalPercent` от equity (`totalUsd`), не от `availableUsd`.
- Files: `apps/api/src/modules/bybit/orders/bybit-signal-placement.service.ts`, `packages/shared/src/index.ts`, `apps/api/src/modules/transcript/transcript-prompt-builders.util.ts`, `apps/api/src/modules/transcript/transcript.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: 50% от ~21 USDT в UI давали ~10.55 маржи при 1x, но код брал `availableUsd` → заниженный номинал и слайсы.
- Changes: `equityForPct = totalUsd || availableUsd` для веток `capitalPercent`; подсказки minQty и промпт/JSDoc согласованы с equity; короче текст про `orderUsd`.
- Decomposition notes (`utils/constants/hooks/types`): N/A.
- Manual verification: `npm run build -w packages/shared && npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): возможен отказ Bybit по марже, если номинал по equity превышает доступное — осознанный компромисс.

### AUD-117

- Status: `done`
- Scope: Главная — сводка по всем кабинетам и лента активности за 24 ч.
- Files: `apps/api/src/modules/orders/orders-dashboard-cabinets.types.ts`, `apps/api/src/modules/orders/orders-dashboard-summary.util.ts`, `apps/api/src/modules/orders/orders-dashboard-activity.types.ts`, `apps/api/src/modules/orders/orders-dashboard-activity.util.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders.controller.ts`, `apps/web/app/home-dashboard.types.ts`, `apps/web/app/components/DashboardCrossCabinetSection.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: карточки кабинетов уже есть; не хватало агрегатов и пользовательской ленты без admin AppLog.
- Changes: `summary` в `GET /orders/dashboard-cabinets`; `GET /orders/dashboard-activity` (ingest routes + сигналы); UI блок KPI + таймлайн.
- Decomposition notes (`utils/constants/hooks/types`): чистые утилиты `orders-dashboard-summary.util.ts`, `orders-dashboard-activity.util.ts`; DTO активности отдельным файлом.
- Manual verification: `npm run build -w apps/api` и `npm run build -w apps/web`; главная при ≥1 кабинете показывает блок и ленту.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-116

- Status: `done`
- Scope: Дашборд / userbot — понятная изоляция balance guard по кабинетам (UI + карточки).
- Files: `apps/api/src/modules/orders/orders-dashboard-cabinets.types.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/web/app/home-dashboard.types.ts`, `apps/web/app/page.tsx`, `apps/web/app/telegram-userbot/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: ingest уже в `runWithCabinet` по маршруту; баннер на главной без имени кабинета; `getDashboardCabinetsOverviewForUser` вызывал `getStatus`, но отбрасывал `balanceGuard`.
- Changes: DTO карточки + проброс `balanceGuard`; на главной — префикс кабинета и пояснение, предупреждение на карточке; на `/telegram-userbot` — имя кабинета из `/cabinets` и то же пояснение.
- Decomposition notes (`utils/constants/hooks/types`): тип снимка вынесен рядом с DTO дашборда.
- Manual verification: два кабинета — пауза только у кабинета с низким available; переключение `cabinetId` меняет баннер; `npm run build -w apps/api` и `npm run build -w apps/web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-118

- Status: `done`
- Scope: Дашборд — «Текущие ордера и позиции» сразу после смены кабинета по ссылке.
- Files: `apps/web/app/components/LiveExposurePanel.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: клиентский `LiveExposurePanel` вызывал `/bybit/live` только на mount; переход по `Link` с новым `?cabinetId=` не обновлял данные.
- Changes: `useSearchParams`, передача кабинета в `fetchApiResponse` для live/close/signal; сброс раскрытий при смене; `Suspense` вокруг тела панели.
- Manual verification: `npm run build -w apps/web`; переключение кабинета карточкой на главной обновляет блок.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-119

- Status: `done`
- Scope: Страница калькулятора доходности при привлечении заёмных средств (агрегат по всем кабинетам).
- Files: `apps/api/src/modules/orders/orders-dashboard-cabinets.types.ts`, `apps/api/src/modules/orders/orders-dashboard-summary.util.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/web/app/home-dashboard.types.ts`, `apps/web/app/leverage-calculator/*`, `packages/shared/src/nav-menu.ts`, `docs/audit/06-progress-tracker.md`
- Findings: сводка `dashboard-cabinets` не отдавала полей stats для EV по каждому кабинету и кросс-кабинетных агрегатов ожидаемого PnL/день.
- Changes: в карточку и `summary` добавлены поля stats и `aggregateExpectedPnlPerDayUsd` / `aggregateRealizedPnlPerDayUsd` / `aggregateStatsPeriodDaysMax`; UI `/leverage-calculator` с вводом суммы кредита, срока, платежа; модель r=G/E, масштабирование капитала E+L, точка безубыточности C*, окупаемость переплаты, месячная симуляция и горизонт после кредита.
- Decomposition notes (`utils/constants/hooks/types`): чистые функции в `leverage-calculator-page.util.ts`.
- Manual verification: `npm run build -w apps/api` и `npm run build -w apps/web`; пункт меню «Кредит / доходность» (по умолчанию скрыт, как прочие advanced).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): прогнозы ориентировочные; пользователь не должен воспринимать как финансовую рекомендацию.

### AUD-120

- Status: `done`
- Scope: UI/UX страницы `/leverage-calculator`: дата закрытия кредита, графики, сохранение пресета в БД.
- Files: `apps/web/app/leverage-calculator/*`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: параметры вводились заново; неочевидно, когда заканчивается договор; не хватало визуализации траектории.
- Changes: пресет v1 в `UserSetting` ключ `LEVERAGE_CALCULATOR_PRESET` (PUT `/settings`, не cabinet-scoped); поле даты начала договора и крупный блок «когда кредит закрыт»; Recharts линии капитала и накопленных выплат; сетка метрик и стили `.leverage*`; автосохранение с debounce (без первого лишнего PUT).
- Decomposition notes: `leverage-calculator-preset.util.ts`, `LeverageCalculatorCharts.tsx`, константы ключа в `leverage-calculator-page.constants.ts`.
- Manual verification: `npm run build -w apps/web`; после входа — изменение суммы/срока, перезагрузка страницы, значения подставляются из БД.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): в JSON пресете нет секретов; размер ограничен `PRESET_JSON_MAX_LEN`.

### AUD-121

- Status: `done`
- Scope: Дашборд — блок «Все кабинеты»: APR/APY (реализ.), потенциальная доходность EV (7/30/365 дн.), график Σ equity по дням.
- Files: `apps/api/src/modules/orders/orders-dashboard-cabinets.types.ts`, `apps/api/src/modules/orders/orders-dashboard-summary.util.ts`, `apps/api/src/modules/orders/orders-dashboard-cross-cabinet-yield.util.ts`, `apps/api/src/modules/orders/orders-dashboard-aggregate-balance-history.util.ts`, `apps/api/src/modules/orders/orders.service.ts`, `apps/web/app/home-dashboard.types.ts`, `apps/web/app/page.tsx`, `apps/web/app/components/DashboardCrossCabinetSection.tsx`, `apps/web/app/components/BalanceChart.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: `GET /orders/dashboard-cabinets` не отдавал агрегированную историю `BalanceSnapshot`; метрики доходности по Σ кабинетов без общей формулы с главной пришлось бы дублировать на web.
- Changes: в `summary` — поля `crossCabinetAprRealizedPercent`, `crossCabinetApyRealizedPercent`, EV 7/30/365; в ответе — `aggregatedBalanceHistory` (Σ по UTC-дням, сиды до окна); утилиты агрегации и yield; UI секции + компактный `BalanceChart`.
- Decomposition notes (`utils/constants/hooks/types`): `orders-dashboard-cross-cabinet-yield.util.ts`, `orders-dashboard-aggregate-balance-history.util.ts`.
- Manual verification: `npm run build -w apps/api`, `npm run build -w apps/web`; блок при ≥1 кабинете, график при наличии снимков.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A (прогноз EV как на главной, не инвестиционная рекомендация).

### AUD-122

- Status: `done`
- Scope: Главная — визуальное выделение зоны «текущий кабинет» после формы фильтров (метрики, todo, графики, топы, PnL, экспозиция).
- Files: `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: контент после фильтров визуально сливался с остальной страницей; карточки метрик на глобальном `.card` отличались от блоков «Кабинеты» / «Все кабинеты».
- Changes: обёртка `section.dashboardActiveCabinetSection` с шапкой (имя кабинета, подсказка, фильтр источника); стили панели, `dashboardMetricsGrid`, переопределения `.card`/`.chartWrap`/`.tableWrap` внутри секции; классы `dashboardActiveSubheading`, `dashboardActiveChartBlock`, `dashboardActiveFootnote`; адаптив padding/высота графиков.
- Decomposition notes (`utils/constants/hooks/types`): только разметка главной и CSS.
- Manual verification: `npm run build -w apps/web`; проверка в браузере — секция после «Показать», сетка топов и графики внутри панели.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-123

- Status: `done`
- Scope: Дашборд «Все кабинеты» — график Σ equity по дням vs сумма live по кабинетам.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: агрегат по `BalanceSnapshot` суммировал только кабинеты со снимками в БД; кабинеты без записей давали 0 в сумме, тогда как KPI Σ equity брал live Bybit по каждому кабинету — расхождение (например один кабинет в графике vs несколько в шапке).
- Changes: в `getDashboardCabinetsOverviewForUser` после выборки снимков добавляются синтетические точки: live `totalBalanceUsd` на `now` для всех кабинетов с известным балансом; для кабинетов без ни одного снимка в окне — дополнительная точка на `since`, чтобы carry-forward включал их на всём горизонте (приближение: баланс как сейчас на всём окне, если истории нет).
- Decomposition notes: без выноса (локальная правка в сервисе).
- Manual verification: `npm run build -w apps/api`; главная при ≥2 кабинетах — последняя точка графика согласована с Σ equity при наличии live балансов.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-124

- Status: `done`
- Scope: `/leverage-calculator` — падение клиента (Recharts «Invariant failed»).
- Files: `apps/web/app/leverage-calculator/LeverageCalculatorCharts.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: двойная ось Y + `ResponsiveContainer` при SSR/первом кадре с нулевой шириной или нестабильной вёрстке; возможны нечисловые точки траектории.
- Changes: рендер графика только после `useEffect` (клиентский mount); `minWidth`/`minHeight` у контейнера и `ResponsiveContainer`; фиксированная `width` у обеих осей Y; `yAxisId` у `ReferenceLine`; `ifOverflow="extendDomain"`; санитизация `capitalUsd` / `cumulativePaidUsd` в данных.
- Decomposition notes: без выноса.
- Manual verification: `npm run build -w apps/web`, `npm run check-types -w apps/web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-125

- Status: `done`
- Scope: API — снижение расхода памяти (RSS/heap): переиспользование Bybit REST-клиента и потолок Map в userbot-scan.
- Files: `apps/api/src/modules/bybit/instrument/bybit-client.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.constants.ts`, `apps/api/src/modules/telegram-userbot/scan/telegram-userbot-scan.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: каждый `getClient()` создавал новый `RestClientV5` при частом poll; `lastSeenMessageIds` рос без лимита по числу уникальных `chatId`.
- Changes: кэш одного `RestClientV5` на ключ кабинета (`AsyncLocalStorage`) с отпечатком ключей (SHA-256, без логов); при смене ключей — dispose предыдущего экземпляра (best-effort `close`/`closeAll`); после превышения `USERBOT_LAST_SEEN_MESSAGE_IDS_MAX` вытеснение старейших записей из Map.
- Decomposition notes: константа в `telegram-userbot.constants.ts`.
- Manual verification: `npm run build -w apps/api`; сценарий смены API key в настройках — следующий запрос должен поднять новый клиент без удержания старого в Map.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-126

- Status: `done`
- Scope: Userbot QR (GramJS) — лимит логов Railway при `Cannot send requests while disconnected`.
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `apps/api/src/modules/telegram-userbot/utils/telegram-userbot-qr-auth-error.util.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `signInUserWithQrCode` `onError` вызывался многократно; каждый раз `logger.warn` → сотни строк/сек и rate limit 500 msg/s на Railway.
- Changes: гейт `qrAuthTerminalHandledByUserId` (один раз лог + UI state + `stopQrClient`); для обрыва соединения — одно предупреждение без повторения сырого текста; сброс гейта при новом старте QR, отмене и `finally` задачи; текст для UI в `formatUserbotQrAuthErrorForUser`.
- Decomposition notes: без новых файлов.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-127

- Status: `done`
- Scope: Web `/telegram-userbot` — меньше фонового poll при неподключённом userbot и устойчивее обработка 502 на `qr/password`.
- Files: `apps/web/app/telegram-userbot/page.tsx`, `apps/web/app/telegram-userbot/telegram-userbot-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: интервал ~1.8 с + устаревшее замыкание `status` в `setInterval` давали лишние параллельные запросы; до подключения опрашивались и `qr/status`, и `metrics/today`; при 502 на POST пароль — падение на `res.json()`.
- Changes: `statusForPollRef` для актуального статуса в тике; без `connected` — только `qr/status`, интервал 4.5 с; с `connected` — параллельно status + today, 5 с; `inFlight`, пропуск тика при скрытой вкладке; безопасный разбор ответа POST и сообщение для 502; константы интервалов в `telegram-userbot-page.constants.ts`.
- Decomposition notes: константы страницы — отдельный `*-page.constants.ts`.
- Manual verification: `npm run build -w apps/web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-128

- Status: `done`
- Scope: Web `/leverage-calculator` — сравнение с ростом только на собственном equity (без займа) на графике и в метриках.
- Files: `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `apps/web/app/leverage-calculator/LeverageCalculatorCharts.tsx`, `apps/web/app/leverage-calculator/LeverageCalculatorClient.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: пользователю не хватало контрольной кривой E·(1+r)³⁰ᵐ при той же оценке r для решения о целесообразности кредита.
- Changes: поля outlook `equityOnlyAfterLoanUsd` / `equityOnlyAfterHorizonUsd` и дельты к сценарию со займом; `equityOnlyCapitalAtMonth`, `formatUsdSigned`; вторая линия на графике («только E»); подписи и сноска.
- Decomposition notes: логика в `leverage-calculator-page.util.ts`, тип точки графика экспортирован из `LeverageCalculatorCharts.tsx`.
- Manual verification: `npm run check-types -w web`; визуально — две линии капитала и новые KPI на странице.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-129

- Status: `done`
- Scope: Web `/leverage-calculator` — досрочное погашение, сравнение с полным графиком, подсказки по схеме займа.
- Files: `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `apps/web/app/leverage-calculator/LeverageCalculatorCharts.tsx`, `apps/web/app/leverage-calculator/LeverageCalculatorClient.tsx`, `apps/web/app/leverage-calculator/leverage-calculator-preset.util.ts`, `apps/web/app/leverage-calculator/leverage-calculator-page.types.ts`, `docs/audit/06-progress-tracker.md`
- Findings: нужна оценка выгодности досрочного и ориентиры по заёмной схеме в той же упрощённой модели.
- Changes: `simulateLeverageLoan` (единый цикл); параметры досрочного в пресете; KPI и график (капитал и Σ выплат досрочно vs график); экономия vs M·T и M·(T−k)−closeout; `computeLeverageStrategyHints`; дата досрочного в боковой карточке.
- Decomposition notes: симуляция в `leverage-calculator-page.util.ts`.
- Manual verification: `npm run check-types -w web`, eslint по файлам калькулятора.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-130

- Status: `done`
- Scope: Web `/leverage-calculator` — вердикт «займ vs только E» в карточке `leverageHighlight`.
- Files: `apps/web/app/leverage-calculator/LeverageCalculatorClient.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Changes: блок с тоном win/lose/neutral, крупная дельта на горизонте, подстрочники по концу кредита и досрочному; стили `.leverageVerdict*`.
- Manual verification: `npm run check-types -w web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-131

- Status: `done`
- Scope: ИИ-рекомендации по сценарию кредита на `/leverage-calculator` (OpenRouter, пользователь с сессией).
- Files: `apps/api/src/modules/orders/leverage-ai-advisor.service.ts`, `apps/api/src/modules/orders/leverage-ai-advisor.types.ts`, `apps/api/src/modules/orders/orders.controller.ts`, `apps/api/src/modules/orders/orders.module.ts`, `apps/web/app/leverage-calculator/*`, `docs/auth-protected-routes.md`, `docs/audit/06-progress-tracker.md`
- Changes: `POST /orders/leverage-calculator-ai-advice` — JSON-снимок с клиента, ответ `{ summary, points, disclaimer }`; модель AI_ADVISOR с fallback TEXT/DEFAULT; UI кнопка + textarea; `LeverageCalculatorPayload` вынесен в `leverage-calculator-page.types.ts`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w web`, eslint по новым web-файлам.
- Docs updated: `auth-protected-routes.md`, этот трекер.
- Linked risks (`SEC-###`): N/A — тело запроса только числа/текст пользователя, без секретов; расход OpenRouter как у других вызовов.

### AUD-132

- Status: `done`
- Scope: Web `/leverage-calculator` — платёж M с единого счёта E+L; выбор порядка шага месяца; пресет и снимок для ИИ.
- Files: `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `LeverageCalculatorClient.tsx`, `leverage-calculator-preset.util.ts`, `leverage-calculator-page.types.ts`, `leverage-calculator-ai.util.ts`, `docs/audit/06-progress-tracker.md`
- Changes: `simulateLeverageLoan` / `computeLeverageOutlook` с `loanPaymentTiming`; траектории и график; радио в UI; поле в пресете; `loanPaymentTiming` в `outlookSnapshot`; `grossMonthlyStartUsd` / `netMonthlyStartUsd` согласованы с первым дискретным месяцем; подразумеваемая ставка кредита из аннуитета (L, M, T) — `impliedMonthlyRateFromAnnuity`, поля `loanImpliedMonthlyRate` / `loanNominalApr` / `loanEffectiveAnnualRate` в outlook, блок в UI и в снимке для ИИ.
- Manual verification: `npm run check-types -w web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-133

- Status: `done`
- Scope: Web `/leverage-calculator` — ввод сумм кредита в ₽ с конвертацией в USDT по курсу ЦБ; дублирование сумм в ₽ в UI и тултипе графика.
- Files: `apps/web/app/api/fx/rub-usd/route.ts`, `apps/web/app/leverage-calculator/leverage-calculator-fx.util.ts`, `leverage-calculator-dual-money.tsx`, `LeverageCalculatorClient.tsx`, `LeverageCalculatorCharts.tsx`, `leverage-calculator-preset.util.ts`, `leverage-calculator-page.types.ts`, `docs/audit/06-progress-tracker.md`
- Changes: прокси курса `GET /api/fx/rub-usd` (cbr-xml-daily.ru, revalidate 1 ч); пресет `inputCurrency`; расчёты и сохранение в USDT; `DualUsdRub` / `DualUsdRubSigned`.
- Manual verification: `npm run check-types -w web`; smoke `fetch` к cbr-xml-daily.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): зависимость от внешнего публичного API ЦБ (доступность/формат); без секретов.

### AUD-134

- Status: `done`
- Scope: Web `/leverage-calculator` — прочие расходы в месяц с того же счёта; макс. постоянное доп. снятие без ухода C в минус на горизонте; пресет и снимок для ИИ.
- Files: `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `LeverageCalculatorClient.tsx`, `leverage-calculator-preset.util.ts`, `leverage-calculator-page.types.ts`, `leverage-calculator-ai.util.ts`, `apps/web/app/api/fx/rub-usd/route.ts`, `docs/audit/06-progress-tracker.md`
- Changes: `simulateLeverageLoan` уже учитывал X и D; `computeMaxExtraMonthlyWithdrawalUsd` + поля outlook; UI-поле и метрики; траектории с X; пресет `otherMonthlyExpensesUsd`; `OUTLOOK_SNAPSHOT_KEYS`; подсказка в `computeLeverageStrategyHints`. Дополнительно: резервный курс ₽/USD (ручной ввод + `NEXT_PUBLIC_LEVERAGE_RUB_PER_USD`), уточнённые предупреждения по аннуитету; `GET /api/fx/rub-usd` — цепочка: JSON cbr-xml-daily → XML `cbr.ru` → международный `api.exchangerate-api.com/v4/latest/USD` (`rates.RUB`), таймаут fetch; в UI помечается не-ЦБ источник.
- Manual verification: `npm run check-types -w web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-135

- Status: `done`
- Scope: Web `/leverage-calculator` — постоянный ежемесячный взнос на счёт; целевой капитал C на конец горизонта; оценка минимального взноса для цели; пресет и снимок для ИИ.
- Files: `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `LeverageCalculatorClient.tsx`, `leverage-calculator-preset.util.ts`, `leverage-calculator-page.types.ts`, `leverage-calculator-ai.util.ts`, `docs/audit/06-progress-tracker.md`
- Changes: симуляция и траектории с `monthlyContributionUsd`; `computeMinMonthlyContributionForTargetUsd`; поля outlook и подсказки в `computeLeverageStrategyHints`; UI поля, метрики, автосохранение пресета.
- Manual verification: `npm run check-types -w web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-136

- Status: `done`
- Scope: Userbot «result без входа» — автоотмена по флагу и кнопка «Отменить» в Telegram; видимость ошибок Telegraf на `/logs`.
- Files: `apps/api/src/modules/settings/settings-bool.util.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-signal-reply.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `getBoolSetting` принимал только строку `true` — env `1` не включал автоотмену; `ub_stale_cancel` вызывал Bybit в кабинете из middleware (первый whitelist при общем токене), а `answerCbQuery` вне try ломался на истёкшем callback → `bot.catch` без записи в AppLog.
- Changes: `parseSettingsBool`; отмена по кнопке — `signal.cabinetId` + `runWithCabinetAsync` + проверка `isAllowed` в целевом кабинете; `safeAnswerCbQuery`; `bot.catch` → `appLog.append` с `cabinetId` и текстом ошибки; follow-up: `ub_stale_cancel` — `answerCbQuery` сразу после валидации (до Prisma/whitelist), иначе истекает callback (~10 с) и снова 400 «query is too old».
- Decomposition notes (`utils/constants/hooks/types`): `settings-bool.util.ts`.
- Manual verification: `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-137

- Status: `done`
- Scope: Надёжный запуск assist-бота по кабинетам — фазовые логи, раздельные таймауты deleteWebhook / launch, AppLog, backoff-retry sync, runbook SSH.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/telegram/utils/telegram-bot-launch.util.ts`, `apps/api/src/modules/telegram/utils/index.ts`, `.env.example`, `docs/audit/04-operational-runbooks.md`, `docs/audit/06-progress-tracker.md`
- Findings: единый таймаут на `deleteWebhook`+`launch` затруднял локализацию; следующая попытка только раз в 30 с при периодическом sync; legacy `launchBotWithRetry` не покрывает per-cabinet путь.
- Changes: `syncId` / `correlationId`, логи фаз (`launch_gate_ok`, `launch_stagger`, `delete_webhook_*`, `telegraf_launch`, `launch_complete`) и `activePhase` при ошибке; `TELEGRAM_BOT_DELETE_WEBHOOK_TIMEOUT_MS` + `promiseWithTimeout` для webhook, `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS` только для `bot.launch()`; AppLog warn при сбое и info «recovered» после успеха при предшествующей ошибке; retry `syncBotsWithCabinetTokens` с задержками 5/15/30 с и ожиданием снятия `botSyncInFlight`; очистка таймеров при shutdown; runbook с `curl` и `printenv` для Railway SSH.
- Decomposition notes (`utils/constants/hooks/types`): `telegram-bot-launch.util.ts` — correlation id, маска токена, константы задержек retry.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — в логах API видны фазы и при сбое `activePhase`; при кратковременной недоступности Bot API — повторный sync по backoff; `/logs` — warn по запуску при сбоях и info при восстановлении.
- Docs updated: этот трекер, `04-operational-runbooks.md`.
- Linked risks (`SEC-###`): N/A

### AUD-138

- Status: `done`
- Scope: Повторяющееся critical-уведомление при отключённом userbot при ожидаемой работе (включён флаг и есть сессия).
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.service.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Changes: `@Cron(EVERY_MINUTE)` + `postCriticalNotifyText` при `TELEGRAM_USERBOT_ENABLED` и непустой `TELEGRAM_USERBOT_SESSION`, но без авторизованного MTProto для владельца сессии (или без разрешённого владельца); выкл. env `TELEGRAM_USERBOT_DISCONNECTED_CRITICAL_CRON=false`.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`.
- Linked risks (`SEC-###`): при нескольких репликах API — дублирование минутных POST (как и для других cron); без секретов в теле уведомления.

### AUD-139

- Status: `done`
- Scope: Корректная обработка MTProto `406 AUTH_KEY_DUPLICATED` при `connectFromStoredSession` (backoff, human-readable ошибка, critical notify без спама watchdog/cron).
- Files: `apps/api/src/modules/telegram-userbot/client/telegram-userbot-client.service.ts`, `utils/telegram-userbot-mtproto-error.util.ts`, `telegram-userbot.constants.ts`, `telegram-userbot.service.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Changes: детект `AUTH_KEY_DUPLICATED`; backoff `TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS`; разовый POST на CRITICAL в пределах окна backoff; `attachClient` сбрасывает backoff; watchdog не вызывает connect в backoff; минутный critical «offline» не дублирует сценарий дубликата ключа.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер, `AGENTS.md`, `.env.example`.
- Linked risks (`SEC-###`): N/A

### AUD-141

- Status: `done`
- Scope: Telegram «Сводка» — убрать многоминутные задержки из-за `findMany` по всей истории сигналов.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/telegram/services/telegram-chat-menu.service.ts`, `docs/audit/06-progress-tracker.md`
- Changes: `getTelegramMenuSummaryBundle()` — агрегаты Prisma (`groupBy`, `count`, `aggregate`) + фильтр исключённых источников как в дашборде; `handleMenuSummary` — `Promise.all` Bybit + bundle вместо `getDashboardStats` / `getPnlSeries` / `getTopSources`.
- Manual verification: `npm run build -w apps/api`; ручная проверка «Сводка» в боте — время ответа секунды, цифры согласованы с дашбордом по тем же правилам (STATS_RESET_AT, SOURCE_EXCLUDE_LIST).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-142

- Status: `done`
- Scope: Долгий ответ бота на все команды (в т.ч. `/start`) из-за long polling и тяжёлого разбора сигнала; ускорение ACL и горячего пути настроек.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `apps/api/src/modules/settings/settings.service.ts`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Findings: Telegraf v4 при polling делает `await Promise.all(updates.map(handleUpdate))` — пока не завершится разбор сигнала (LLM), следующий батч `getUpdates` не запрашивается; middleware ACL вызывал `isAllowed` по очереди кабинетов с повторным `authUser.findFirst` на каждый кабинет; `Settings.get` при попадании в кэш всё равно вызывал `resolveCurrentUserId()` (лишний round-trip к БД при промахе owner cache).
- Changes: разбор текста/фото/голоса — `scheduleTelegramHeavyInbound` (очередь по паре кабинет+userId, см. AUD-144; `runWithCabinetAsync`, ответ об ошибке в чат); typing внутри отложенной задачи; ACL middleware — один запрос AuthUser + `Promise.all` whitelist по кабинетам; `Settings.get` — ранний `readCache` до `resolveCurrentUserId`; очистка карты очереди в `onModuleDestroy`.
- Decomposition notes (`utils/constants/hooks/types`): логика остаётся в `telegram.service.ts` (узкая правка поведения polling).
- Manual verification: `npm run build -w apps/api`; после деплоя — при долгом разборе сигнала команды `/start`, `/menu`, кнопки меню отвечают без ожидания LLM; ответ по сигналу приходит из очереди по порядку сообщений пользователя.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-143

- Status: `done`
- Scope: Несколько кабинетов с разными ботами — отвечает быстро только один, остальные «висят» до таймаута launch.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `.env.example`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Findings: `withTelegramBotLaunchSerialized` оборачивал `await bot.launch()`; в Telegraf 4 long polling `launch()` ждёт бесконечный цикл `getUpdates` → глобальный gate не отпускался до `Promise.race` с `TELEGRAM_BOT_LAUNCH_TIMEOUT_MS`, остальные токены стояли в очереди.
- Changes: под сериализацией только `deleteWebhook` + stagger; перед polling — `getMe` с таймаутом (`TELEGRAM_BOT_LAUNCH_TIMEOUT_MS`), регистрация в реестре, затем `void bot.launch().catch(...)`; при ошибке polling — `unlinkTelegrafFromAllCabinets` + retry; лог `launch_complete` без ожидания конца `getUpdates`.
- Manual verification: `npm run build -w apps/api`; после деплоя — в логах подряд `launch_complete` для всех кабинетов с токеном; все боты принимают сообщения без минутной очереди на «второй» токен.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-144

- Status: `done`
- Scope: Несколько ботов кабинетов «по очереди оживают»; когда один шустро обрабатывает сигнал, остальные висят при одном и том же Telegram-пользователе.
- Files: `apps/api/src/modules/telegram/services/telegram.service.ts`, `docs/audit/06-progress-tracker.md`, `AGENTS.md`
- Findings: `scheduleTelegramHeavyInbound` сериализовал LLM-разбор только по `ctx.from.id` — один user id на все кабинеты, общая цепочка `Promise.then` для всех ботов этого пользователя.
- Changes: ключ очереди `${cabinetId}:${uid}` (`telegramHeavyInboundChains`); логи с `cabinetId`; в `AGENTS.md` уточнена семантика очереди.
- Manual verification: `npm run build -w apps/api`; один Telegram-аккаунт пишет двум ботам разных кабинетов — разбор/ответы не блокируют друг друга ожиданием LLM в «чужом» кабинете.
- Docs updated: этот трекер, `AGENTS.md`.
- Linked risks (`SEC-###`): N/A

### AUD-145

- Status: `done`
- Scope: Web `/leverage-calculator` — выбор источника сводки для расчёта (все кабинеты или один кабинет).
- Files: `apps/web/app/leverage-calculator/page.tsx`, `apps/web/app/leverage-calculator/LeverageCalculatorClient.tsx`, `apps/web/app/leverage-calculator/leverage-calculator-page.util.ts`, `apps/web/app/leverage-calculator/leverage-calculator-page.types.ts`, `apps/web/app/leverage-calculator/leverage-calculator-ai.util.ts`, `docs/audit/06-progress-tracker.md`
- Findings: калькулятор всегда использовал агрегаты `summary` по всем кабинетам, хотя `dashboard-cabinets` уже возвращает достаточные поля в `items` для расчёта по одному кабинету.
- Changes: добавлены `buildLeverageStatsPayload*` (all/single + fallback), новый селектор «Сводка для расчёта» в UI, пересчёт KPI/симуляции/AI-снимка от выбранного источника, инициализация `statsCabinetId` из query (`?statsCabinetId=`) с fallback на активный кабинет (`cabinet_id`/`?cabinetId=`), синхронизация query через `history.replaceState`.
- Manual verification: `npm run check-types -w web`; визуально проверить `/leverage-calculator` — переключение «Все кабинеты / конкретный кабинет» пересчитывает KPI и заголовок без reload.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-146

- Status: `done`
- Scope: Web `/leverage-calculator` — в блоке `leverageHighlight` показать годовые проценты по кредиту на основе введённых `L/M/T`.
- Files: `apps/web/app/leverage-calculator/LeverageCalculatorClient.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: в верхней карточке не было понятного годового процента для быстрой оценки выгодности кредита.
- Changes: добавлен расчёт `loanAnnualRate` через `impliedMonthlyRateFromAnnuity(L, M, T)` и вывод в `leverageHighlight` как «Годовые проценты по кредиту (оценка)».
- Manual verification: `ReadLints` для `LeverageCalculatorClient.tsx` (ошибок нет); визуально проверить `/leverage-calculator` при разных `L/M/T`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-148

- Status: `done`
- Scope: Web `/settings?scope=account` — добавить карточки сравнения cabinet-scoped настроек по всем кабинетам с переходом в настройки выбранного кабинета.
- Files: `apps/web/app/settings/page.tsx`, `apps/web/app/settings/CabinetsOverviewSection.tsx`, `apps/web/app/settings/cabinets-overview-page.constants.ts`, `apps/web/app/settings/cabinets-overview-page.util.ts`, `apps/web/app/settings/cabinets-overview-page.types.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в режиме аккаунта не было быстрого способа сравнить настройки между кабинетами, приходилось открывать каждый кабинет отдельно.
- Changes: добавлена секция «Сравнение настроек кабинетов» под общими настройками аккаунта; карточки загружают `/cabinets` и параллельно для каждого кабинета `/settings/effective` + `/bybit/balance-alerts`; показываются торговые параметры, Telegram cabinet-scoped поля, правила уведомлений о балансе и `SOURCE_EXCLUDE_LIST`; Bybit API/secret ключи не отображаются; клик по карточке обновляет `localStorage`/cookie активного кабинета и ведёт на `/settings?scope=cabinet&cabinetId=<id>`.
- Decomposition notes (`utils/constants/hooks/types`): вынесены отдельные `cabinets-overview-page.{constants,util,types}.ts` и компонент `CabinetsOverviewSection.tsx`.
- Manual verification: `ReadLints` по изменённым web-файлам (ошибок нет).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-149

- Status: `done`
- Scope: Web `/settings?scope=account` — заменить карточки сравнения кабинетов на табличный вид для быстрого визуального сравнения по столбцам.
- Files: `apps/web/app/settings/CabinetsOverviewSection.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: карточки удобны для чтения одного кабинета, но затрудняют сравнение одинакового параметра между несколькими кабинетами.
- Changes: секция переведена в 3 сравнительные таблицы (торговые параметры, Telegram/Userbot, дополнительно); строки — параметры, столбцы — кабинеты; заголовок каждого столбца (кнопка с именем кабинета) ведёт в настройки соответствующего кабинета; длинные названия параметров в первом столбце с `ellipsis` + `title`; для широких таблиц добавлен горизонтальный скролл (`overflowX: auto`).
- Manual verification: `ReadLints` для изменённого файла (ошибок нет), `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-150

- Status: `done`
- Scope: Web `/settings?scope=account` — добавить мультиселект групп таблиц сравнения (лейблы-чипы) для показа только нужных секций.
- Files: `apps/web/app/settings/CabinetsOverviewSection.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: даже в табличном режиме иногда нужны не все секции сразу; без фильтра группа таблиц занимала лишнюю высоту страницы.
- Changes: добавлен набор лейблов-групп (`Торговые параметры`, `Telegram / Userbot`, `Дополнительно`) с мультивыбором; по умолчанию включены все группы; при отключении лейбла соответствующая таблица скрывается; если отключены все, показывается подсказка о необходимости включить хотя бы одну группу.
- Manual verification: `ReadLints` для изменённого файла (ошибок нет), `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-151

- Status: `done`
- Scope: Telegram daily digest — при пустом окне 24 ч (нет закрытий и нет топов источников) отправлять короткое сообщение вместо длинного «пустого» отчёта.
- Files: `apps/api/src/modules/telegram/utils/telegram-daily-digest-html.util.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в дни без активности приходил развёрнутый дайджест с множеством блоков «0/нет данных», что создаёт шум и не несёт полезного сигнала.
- Changes: в `formatTelegramDailyDigestHtml` добавлен ранний short-path `isEmptyDailyWindow(...)`; при отсутствии событий за 24 ч формируется компактный дайджест с периодом, строкой «Новостей нет: новых закрытий сделок не было» и текущим балансом Bybit.
- Manual verification: `ReadLints` по изменённому util-файлу (ошибок нет), `npm run build -w apps/api` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-152

- Status: `done`
- Scope: Web `/settings?scope=account` — изменить лейбл-мультиселект: фильтровать отображаемые кабинеты (столбцы), а не группы таблиц; оформить тёмный скроллбар для горизонтального скролла.
- Files: `apps/web/app/settings/CabinetsOverviewSection.tsx`, `apps/web/app/globals.css`, `docs/audit/06-progress-tracker.md`
- Findings: текущие лейблы скрывали/показывали группы таблиц, тогда как требовалась фильтрация именно кабинетов; горизонтальный системный скроллбар на тёмной теме визуально выбивался (светлый).
- Changes: лейблы переключают `enabledCabinetIds` (по умолчанию включены все кабинеты), таблицы всегда по тем же группам, но столбцы показывают только выбранные кабинеты; добавлен notice при выключении всех кабинетов; для контейнера сравнительных таблиц введён класс `settingsCompareScrollbar` с dark-стилями `scrollbar-color` и `::-webkit-scrollbar*`.
- Manual verification: `ReadLints` по изменённым web-файлам (ошибок нет), `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-153

- Status: `done`
- Scope: Web `/settings?scope=account` — визуально подсветить параметры, у которых значения совпадают во всех выбранных кабинетах.
- Files: `apps/web/app/settings/CabinetsOverviewSection.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: при большом числе кабинетов сложно быстро понять, где настройки одинаковые между всеми колонками.
- Changes: в таблицах сравнения добавлена проверка равенства значений по всем видимым кабинетам для каждой строки; при полном совпадении строка получает мягкую зеленоватую подсветку (`rgba(34,197,94,0.12)`) и акцент слева у ячейки названия параметра.
- Manual verification: `ReadLints` по изменённому web-файлу (ошибок нет), `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-154

- Status: `done`
- Scope: Userbot — автоповтор ingest после правки сообщения в канале при `parse_incomplete` / `place_error` (edit-watch, MessageEdited, coalescing очереди, per-cabinet release hash).
- Files: `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-edit-watch.service.ts` (rename с levels-watch), `telegram-userbot-ingest.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot.service.ts`, `client/telegram-userbot-client.service.ts`, `telegram-userbot.constants.ts`, `telegram-userbot.module.ts`, `docs/audit/06-progress-tracker.md`
- Findings: после incomplete→edit→place_error повтор блокировался (нет edit-handler, hash dedup без release, watch только для `signal_levels_validation`, silent drop enqueue, global hash release в multi-cabinet).
- Changes: обобщён edit-watch (poll 25 с / TTL 90 мин) на `parse_incomplete` и любой `place_error` с guard по активному `Signal`; `EditedMessage` + bypass `isMessageRecent` для retriable ingest; `prepareIngestForRerun` + `releaseForCabinetAndHash` при edit-requeue; coalescing `pendingRerunByQueueKey`; статус `parse_incomplete` вместо `ignored`; `canReuseExistingHash` из БД.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — неполный сигнал→правка→placement; place_error→правка без `duplicate_signal`; две быстрые правки при active job; partial ORDERS_PLACED — watch не стартует.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-155

- Status: `done`
- Scope: Userbot «result без входа» — автоотмена ордеров не срабатывала: переключатель в UI не сохранялся; runtime не читал legacy global `Setting`.
- Files: `apps/web/app/settings/settings-page.constants.ts`, `apps/web/app/settings/page.tsx`, `apps/api/src/modules/settings/settings.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY` и парный NOTIFY не входили в `visibleKeySet` cabinet scope → `saveAll` не отправлял PUT; `SettingsService.get()` при активном cabinet context не делал fallback на global `Setting` после пустого `userSetting` (в отличие от `getMany()`).
- Changes: `USER_LEVEL_RESULT_SETTING_KEYS` — два флага видны и сохраняются в «Настройки кабинета» (→ `userSetting` владельца); `get()` — fallback на global `Setting` при не cabinet-isolated ключе.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w web` (pass); на стенде — включить автоотмену в `/settings?scope=cabinet`, сохранить, перезагрузить → ON; result без входа → `result_without_entry_cancelled`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-165

- Status: `done`
- Scope: Userbot — повторный parse после `parse_error` (например «Model did not return valid JSON»).
- Files: `apps/api/src/modules/telegram-userbot/telegram-userbot.constants.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-parse-retry.service.ts`, `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest-pipeline.service.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.types.ts`, `apps/api/src/modules/telegram-userbot/telegram-userbot.module.ts`, `docs/audit/06-progress-tracker.md`
- Findings: при transient JSON-ошибке OpenRouter ingest оставался в `parse_error` без повторной попытки.
- Changes: `TelegramUserbotIngestParseRetryService` — setInterval каждые 5 мин, TTL 1 ч (до 12 попыток); re-enqueue с `source: parse-retry`, без спама в бот; успех/placed → stop; активная сделка по message → skip; повторный fail не сбрасывает окно TTL.
- Manual verification: `npm run build -w apps/api` (pass); после деплоя — `/logs`: `Userbot: запланирован повтор parse`, `Userbot: повтор parse после parse_error`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-164

- Status: `done`
- Scope: Fast TP/SL при многих кабинетах — in-process apply без очереди poll + runtime settings.
- Files: `apps/api/src/modules/bybit/orders/bybit-order-lifecycle-poll-signal.util.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tpsl-fast-apply.service.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tpsl-fast-retry.util.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/orders/bybit-order-lifecycle-poll.service.ts`, `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/settings/settings.constants.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/web/app/settings/settings-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: TP/SL только через тяжёлый poll кабинета (18–30 с, очередь N кабинетов); post-placement не успевал.
- Changes: `BybitTpSlFastApplyService` — retry in-process по CSV `TP_SL_FAST_RETRY_DELAYS_MS`; `runFastTpSlApplyAttempt` после placement; slim poll (skip fetch при OPEN+TP live); settings `TP_SL_FAST_APPLY_ENABLED`, `WORKER_QUEUE_POLL_CONCURRENCY` (runtime); UI Bybit section.
- Manual verification: `npm run build -w apps/api` (pass); после деплoy — `/settings` без рестарта; `/logs` `TP_SL_FAST_APPLY: scheduled/done`; TP/SL < 15 с после fill.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-163

- Status: `done`
- Scope: Multi-cabinet poll — TP/SL не доходили до кабинетов из-за заторa worker queue reconcile.
- Files: `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: interval-sweep каждые ~2 с сбрасывал все `poll-cabinet:*` в pending; ordering по `createdAt` + один worker ≈18 с на тяжёлый кабинет → QSInnerCircleVipFree не получал poll (в логах только `cmobm54…`).
- Changes: pending poll не перезаписывается interval-sweep; priority bump для `post-placement`/WS/`interval-active` (`runAfter` −5 с); ordering `runAfter` + `updatedAt`; `WORKER_QUEUE_POLL_CONCURRENCY` (default 3); sweep сначала кабинеты с открытыми linear-сигналами.
- Manual verification: `npm run build -w apps/api`; Railway cabinets — в логах poll по нескольким cabinetId, TP/SL на TON.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-162

- Status: `done`
- Scope: Poll linear — TP/SL не выставлялись на всех кабинетах (регрессия spread в poll ports).
- Files: `apps/api/src/modules/bybit/orders/bybit-order-lifecycle-poll-orders.util.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: в `createOrderLifecyclePollPorts` `{ ...orders }` не копирует методы prototype (`getSignalWithOrders`, `updateOrder`, `reconcileStaleOpenSignalsForPairAndDirection`); worker job падал до `ensureStopLoss`/`placeTpSplit` (Railway cabinets, TON/QSInnerCircleVipFree).
- Changes: `createLinearPollOrdersPorts(orders)` — явная делегация четырёх методов + `listOpenLinearSignals`.
- Manual verification: `npm run build -w apps/api`; runtime smoke — все 4 метода в ports; Railway cabinets deploy `d02e3e5` SUCCESS, `/health` 200; в логах Api после деплоя 0× `is not a function`, нет `queue job … failed` для poll-cabinet (только slow reconcile).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-161

- Status: `done`
- Scope: Railway cabinets — crash API при старте (Nest DI BybitSpotModule).
- Files: `apps/api/src/modules/bybit/bybit.module.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `BybitSpotInstrumentService` / spot placement требуют `BybitClientService`, `BybitRateLimitService`; `BybitModule` их не экспортировал → `UnknownDependenciesException` на `start:railway`.
- Changes: export `BybitClientService`, `BybitRateLimitService` из `BybitModule`.
- Manual verification: `npm run build -w apps/api`; локальный `node dist/main.js` — `BybitSpotModule dependencies initialized`; Railway cabinets Api deploy SUCCESS.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-160

- Status: `done`
- Scope: Multi-cabinet — poll/TP/SL не должен сводиться к дефолтному кабинету.
- Files: `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/bybit-spot/orders/bybit-spot-placement.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: post-placement/WS poll после AUD-158 брал `defaultCabinetId` без контекста; WS триггерил один кабинет вместо sweep; `enqueue` upsert сбрасывал `running` job в `pending`.
- Changes: post-placement фиксирует `cabinetId` из ALS на входе; без контекста — `enqueuePollSweep` (все кабинеты); WS → sweep с delay 100 ms; `enqueue` не трогает `running`; при running poll — followup job `poll-cabinet:{id}:followup`.
- Manual verification: `npm run build -w apps/api`; 2+ кабинета — вход в не-дефолтном → TP/SL; WS/interval — poll каждого кабинета.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-159

- Status: `done`
- Scope: Web settings — `POLLING_INTERVAL_MS` в секции «Bybit», не «Диагностика».
- Files: `apps/web/app/settings/settings-page.constants.ts`, `docs/audit/06-progress-tracker.md`
- Findings: после AUD-068 ключ оказался в «Диагностика», хотя напрямую влияет на сопровождение сделок (TP/SL, статусы ордеров).
- Changes: перенос в секцию `bybit` (на `scope=account` у админа — блок «Bybit» с интервалом poll; в кабинете ключ по-прежнему не показывается).
- Manual verification: `npm run check-types -w apps/web`; `/settings?scope=account` — «Bybit» → интервал опроса.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-158

- Status: `done`
- Scope: Bybit — ускорение постановки TP/SL после входа (poll не ждал только интервал).
- Files: `apps/api/src/modules/worker-queue/worker-queue.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/orders/bybit-order-exchange-query.service.ts`, `apps/api/src/modules/bybit-spot/orders/bybit-spot-placement.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: TP/SL ставятся только в poll; после placement не было немедленного poll; WS триггерил poll sweep по всем кабинетам; статус ордера тянул тяжёлый hist-scan до executions и StopOrder.
- Changes: `enqueueCabinetPoll` + post-placement poll (200 ms); WS → poll одного кабинета (100 ms); fetch status: active/hist по Order+StopOrder → executions → hist-scan fallback.
- Manual verification: `npm run build -w apps/api` (pass); после входа TP/SL в течение ~1–3 с, не минуты.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-157

- Status: `done`
- Scope: Bybit poll — статус условных входов (`StopOrder`) не обновлялся → TP/SL не выставлялись после fill.
- Files: `apps/api/src/modules/bybit/orders/bybit-order-exchange-query.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `fetchOrderStatusFromExchange` запрашивал только `orderFilter: Order`; входы «stop-limit» (цена входа хуже last) создаются как `StopOrder` — в БД оставались `NEW`, `hasOpenEntryOrders` блокировал `placeTpSplitIfNeeded`.
- Changes: poll перебирает `Order` и `StopOrder` (как exposure/cancel); fallback по executions без изменений.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — вход stop-limit → fill → в poll статус `Filled`, событие `BYBIT_TP_LIMITS_PLACED` и SL на позиции.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-156

- Status: `done`
- Scope: Спот-модуль `bybit-spot` и userbot-флоу: spot-only пары без `setLeverage`, интерактивная покупка/продажа, отдельный lifecycle poll, futures-pайплайн без регрессии.
- Files: `apps/api/prisma/schema.prisma`, `migrations/20260522120000_signal_spot_fields/`, `apps/api/src/modules/bybit-spot/**`, `apps/api/src/modules/telegram/services/telegram-spot-flow.service.ts`, `telegram.service.ts`, `telegram-keyboards.util.ts`, `bybit.service.ts`, `bybit-signal-placement.service.ts`, `bybit.module.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot-ingest-signal-reply.service.ts`, `telegram-userbot-ingest-edit-watch.service.ts`, `orders.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: весь placement шёл через linear perpetual; spot-only пары давали `setLeverage failed: 10001` / `110074`; не было `marketType`, spot poll и Telegram-флоу.
- Changes: Prisma `marketType`/`spotBaseQty`/`spotNotifiedJson`; модуль `bybit-spot` (instrument, placement, order-query, lifecycle poll, price watch, `routeUserbotSignalPlacement`); `TelegramSpotFlowService` (buy prompt, сумма USDT, TP/SL notify + sell); linear poll через `listOpenLinearSignals` без изменений тела; `preflightLinearPlacement` в `placeSignalOrders`; edit-watch guard при активном spot-диалоге.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — spot-only → prompt → market buy; несуществующая пара → «нет на бирже»; BTCUSDT linear без изменений; fill → TP notify → partial sell; edit-watch не requeue во время spot-диалога.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-166

- Status: `done`
- Scope: Userbot — «INJUSDT SWING LONG» и аналоги: incomplete stub → parse_incomplete + edit-watch; misclassified ignored тоже под наблюдением.
- Files: `transcript-prompt-builders.util.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot.constants.ts`, `telegram-userbot-ingest-edit-watch.service.ts`, `apps/web/app/telegram-userbot/page.tsx`, `docs/audit/06-progress-tracker.md`
- Findings: классификатор требовал SL/TP для kind=signal → «INJUSDT SWING LONG» уходил в other/ignored («Не сигнал»); edit-watch не стартовал; UI маскировал parse_incomplete как «Не сигнал».
- Changes: промпт классификатора — pair+side достаточно для signal (без regex-эвристики до LLM); `ignored` в `USERBOT_INGEST_RETRIABLE_STATUSES` + edit-watch после ignored; UI — статусы parse_incomplete/parse_error и «ожидание правки» для ignored.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — stub без уровней → «частично распознано» + edit-watch; правка сообщения → автоповтор без «Перечитать».
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-167

- Status: `done`
- Scope: Userbot edit-watch — сужение после code review (статус `awaiting_edit`, recency/confirm).
- Files: `telegram-userbot.constants.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot.service.ts`, `telegram-userbot-ingest.service.ts`, `telegram-userbot-ingest-edit-watch.service.ts`, `apps/web/app/telegram-userbot/page.tsx`, `orders-dashboard-activity.util.ts`, `schema.prisma`, `docs/audit/06-progress-tracker.md`
- Findings: edit-watch на все `ignored`; `ignored` в RETRIABLE → повтор filter-ignore; bypass подтверждения для misclassified; UI «ожидание правки» для всех ignored.
- Changes: `awaiting_edit` только для AI `other` без close/reentry downgrade; `USERBOT_INGEST_EDIT_REQUEUE_STATUSES` (recency + hash release); edit-watch confirm bypass только для parse/place retry, не для `awaiting_edit`; UI/dashboard по статусу.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass); на стенде — filter ignore без watch; AI other → awaiting_edit + watch; REQUIRE_CONFIRMATION на пути awaiting_edit→edit.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-168

- Status: `done`
- Scope: Bybit — дубли Telegram `BYBIT_TP_LIMITS_PLACED` (6 сообщений на одну сделку после fill).
- Files: `apps/api/src/modules/bybit/tpsl/bybit-tpsl-fast-apply.service.ts`, `apps/api/src/modules/bybit/bybit.service.ts`, `apps/api/src/modules/bybit/tpsl/bybit-tpsl.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `TP_SL_FAST_RETRY_DELAYS_MS` (6 значений) ставили все `setTimeout` сразу — попытки шли параллельно, guard `hasLiveTp` не успевал; post-placement poll и fast-apply вызывали `placeTpSplitIfNeeded` без общего lock; при 110017 rejected TP не попадали в БД.
- Changes: fast-apply — последовательная цепочка с cumulative delay + `generation` при reschedule; `tpSplitInFlight` coalesce-lock на `${cabinetId}:${signalId}` в `BybitService`; break цикла TP при `retCode=110017` / truncated to zero.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — fill → одно `BYBIT_TP_LIMITS_PLACED` в Telegram; `/logs` `TP_SL_FAST_APPLY: scheduled` → `done` на attempt 1; малый лот — без дублей ордеров на бирже.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-169

- Status: `done`
- Scope: Userbot multi-cabinet — второй кабинет «Не сигнал» при успешной установке в первом (coalesce ingest).
- Files: `apps/api/src/modules/telegram-userbot/ingest/telegram-userbot-ingest.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `shouldCoalesceEnqueue` срабатывал на `processingActiveIngestIds` (другой кабинет обрабатывает тот же ingest) — job маршрута B уходил в `pendingRerun` без очереди; `coalesceEnqueue` удалял job из `processingQueue`; `flushPendingRerun` только для своего `queueKey` — pending B не запускался после завершения A; route B оставался `other`/`queued`.
- Changes: coalesce только для того же `queueKey` (очередь / in-flight enqueue / активный job маршрута); не coalesce по чужому кабинету; не удалять job из очереди при coalesce; `flushSiblingPendingReruns` после job — pending других маршрутов ingest, если они не в очереди.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — один чат в двух кабинетах: оба route доходят до classify/place или duplicate, без «Не сигнал» на втором.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-170

- Status: `done`
- Scope: Bybit poll — SL лестница не подтягивалась после TP2+ при OPEN + live TP (XLMUSDT / QSBinanceKillers).
- Files: `apps/api/src/modules/bybit/orders/bybit-order-lifecycle-poll.service.ts`, `apps/api/src/modules/bybit/orders/bybit-order-lifecycle-poll-signal.util.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `shouldSkipExchangeOrderSync` пропускал `syncSignalOrderStatusesFromExchange`; `stepStopLossIfTpFilled` опирается на `order.status=Filled` в БД — после первого TP статусы следующих не обновлялись, `filledCount` застревал на 1.
- Changes: в skipSync-ветке poll перед `stepStopLossIfTpFilled` синхронизировать статусы открытых ордеров с биржи и перечитывать сигнал.
- Manual verification: `npm run build -w apps/api` (pass); на стенде — сделка с 4 TP: после каждого исполнения TP в логах/боте события `TP_SL_STEPPED` по лестнице, `tpSlStep` догоняет число исполненных TP.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-171

- Status: `done`
- Scope: Интеграция signalsBot ↔ QPulse — publish groups `linkedToApp`, ExternalSignalsAdapter, lifecycle sync.
- Files: QPulse `apps/api/src/integrations/*`, `prisma/schema.prisma`; signalsBot `apps/api/src/modules/qpulse-sync/*`, `telegram-userbot/mirror/*`, `orders.service.ts`, `prisma/schema.prisma`, `packages/shared/src/cabinet-settings.ts`, `apps/web/app/my-group/page.tsx`, `docs/contracts/rest-api.md` (QPulse), `docs/audit/04-operational-runbooks.md`, `AGENTS.md`
- Findings: QPulse принимал сигналы только через admin JWT; «Моя группа» публиковала в TG без lifecycle в QPulse; не было связи кабинет → app.
- Changes: QPulse `POST/PATCH /integrations/signals` + `externalId`/`source`; signalsBot `SignalExternalSync`, `QpulseSyncService`, `SignalDistributionService`, `linkedToApp` на `TgUserbotPublishGroup`, UI QPulse + checkbox; mirror trade events (TP/close/cancel); Railway runbook для `INTEGRATIONS_API_KEY`.
- Manual verification: `npm run build -w api` + `npm run build -w web` (pass); QPulse `nest build` (pass); на стенде — linked group N=3 → QPulse admin/mobile только каждый 3-й; non-linked group → только TG; lifecycle PATCH при `SignalExternalSync`.
- Docs updated: этот трекер, runbook, AGENTS.md.
- Linked risks (`SEC-###`): N/A

### AUD-172

- Status: `done`
- Scope: Userbot UI — пустой OpenRouter trace при успешной классификации/parse.
- Files: `apps/api/src/modules/telegram-userbot/scan/telegram-userbot-scan.service.ts`, `docs/audit/06-progress-tracker.md`
- Findings: `metrics/today.recent` отдавал `aiRequest`/`aiResponse` только из `TgUserbotIngest`; при multi-cabinet и `pipeline exception` trace остаётся на `CabinetIngestRoute`, ingest обнуляется.
- Changes: в `recent` приоритет полей маршрута кабинета (`route.aiRequest ?? ingest.aiRequest`).
- Manual verification: после деплоя Trace для ingest с classify/parse на маршруте кабинета показывает JSON; `/logs` → openrouter по `ingestId` без изменений.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-173

- Status: `done`
- Scope: QPulse ↔ bb-trader sync — PnL fields, computed Results, admin delete/batch delete.
- Files: QPulse `packages/shared/src/signal-profit.util.ts`, `results-summary.util.ts`, `apps/api/prisma/migrations/20260531140000_*`, `signals.service.ts`, `results.service.ts`, admin `signals/page.tsx`, `results-summary/page.tsx`, `docs/contracts/rest-api.md`; signalsBot `qpulse-signal-mapper.util.ts`, `signal-distribution.service.ts`
- Findings: `orderUsd` не участвовал в profit%; `ResultsSummary` расходился с CLOSED-сигналами; admin delete на `/results-summary` ломался на enum `THREE_M`; нет batch delete.
- Changes: shared `computeProfitPercentage` / `computeResultsSummary`; Signal `positionSizeUsdt`/`realizedPnlUsdt`; drop `ResultsSummary`; `GET /results` summary из CLOSED; bb-trader status map + cancel→`CANCELLED_BY_CHAT`; admin batch-delete + Results UI.
- Manual verification: `pnpm build` QPulse API/admin; `npm run build -w apps/api` signalsBot; Railway: deploy QPulse API → Admin → cabinets API (migration first).
- Docs updated: QPulse rest-api, architecture, admin; этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-175

- Status: `done`
- Scope: Userbot — типы классификации реклама / анализ / акция.
- Files: `transcript-prompt-builders.util.ts`, `transcript.service.ts`, `transcript-model-json-schemas.ts`, `telegram-userbot.types.ts`, `utils/userbot-message-kind.util.ts`, `filters/*`, web `filters/*`, `telegram-userbot/page.tsx`, `UserbotMessageCard.tsx`
- Findings: VIP/анализ/розыгрыши попадали в `other` («Не сигнал») без отдельной категории.
- Changes: classifier kinds `ad`, `analysis`, `promo`; сохранение в `TgUserbotIngest.classification`, status `ignored`; UI labels; фильтры-примеры для новых типов.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-174

- Status: `done`
- Scope: Рыночный вход без явного entry — подстановка last price вместо 0 в группе и QPulse.
- Files: `common/signal-market-entry.util.ts`, `bybit.service.ts` (`resolveMarketEntryIfMissing`), `orders.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `bybit-signal-placement.service.ts`, `telegram-userbot-mirror-format.util.ts`, `qpulse-signal-mapper.util.ts`
- Findings: при `entries=null/[]` mirror и QPulse mapper давали entry 0; placement на бирже брал lastPrice, но не сохранял в сигнал.
- Changes: last price Bybit (linear/spot) на момент parse/persist; mirror до публикации; `createSignalRecord` перед записью; fallback в QPulse mapper из filled ENTRY order.
- Manual verification: `npm run build -w apps/api` (pass); сигнал без entry → в группе и приложении цена ≈ рынок, не 0.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-176

- Status: `done`
- Scope: Userbot — тип классификации `content` (полезный контент, не реклама и не анализ).
- Files: `transcript-prompt-builders.util.ts`, `userbot-message-kind.util.ts`, `telegram-userbot.types.ts`, web filters/userbot UI
- Changes: kind `content`; промпт LLM; labels «Контент»; фильтры-примеры.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-183

- Status: `done`
- Scope: Mirror/QPulse — сообщения TP/вход, отметка TP в приложении, дедуп trade_tp.
- Files: `bybit-order-fill-events.util.ts`, `signal-distribution.service.ts`, `qpulse-signal-mapper.util.ts`, `telegram-userbot-mirror.service.ts`, `bybit-order-lifecycle-poll.service.ts`
- Findings: в группу уходило «TP step 0» (событие подтягивания SL, не TP); все TP дедуплицировались как `trade_tp` — только первое событие; PATCH в QPulse не отмечал TP из‑за неточного match цены; sync терял cabinet context.
- Changes: события `BYBIT_TP_FILLED` / `BYBIT_ENTRY_FILLED`; тексты «TP N price — достигнут», «вход в позицию»; `TP_SL_STEPPED` без spam в группу; dedupe `tp1/tp2/entry`; улучшен mapper targets.hit + await PATCH.
- Manual verification: `npm run build -w apps/api`; TP1/TP2 → два сообщения в группе; QPulse targets hit; entry message после fill.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-185

- Status: `done`
- Scope: Mirror — PnL в сообщениях о закрытии/SL/ликвидации в процентах, не USDT.
- Files: `qpulse-signal-mapper.util.ts`, `signal-distribution.service.ts`
- Changes: `formatMirrorPnlPercent`; close/sl/liquidation → «PnL +12.50%» (формула как QPulse `profitPercentage`: `(pnl/notional)*100*leverage`).
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-186

- Status: `done`
- Scope: Mirror/QPulse — profit в % во всех исходах (группы + приложение), не USDT.
- Files: `qpulse-signal-mapper.util.ts`, `signal-distribution.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `telegram-userbot-text.util.ts`
- Findings: старый формат «Trade closed PnL: +0.01 USDT» при закрытии Bybit; result из ingest пересылался как raw text источника.
- Changes: «сделка закрыта · Прибыль +X.XX%»; расчёт из `realizedPnl`/notional/leverage или парсинг `%` из result-сообщения; ingest mirror через `buildMirrorOutcomeText`; QPulse PATCH по-прежнему шлёт `profitPercentage`.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-187

- Status: `done`
- Scope: Mirror — сообщение закрытия: SL vs profit, убыток/прибыль, частичные TP.
- Files: `qpulse-signal-mapper.util.ts`, `signal-distribution.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`
- Findings: при SL уходило «✅ сделка закрыта · Прибыль -20%»; не учитывались исполненные TP до SL.
- Changes: `resolveMirrorCloseContext` / `buildMirrorCloseEventText`; SL → «🛑 Stop loss сработал» + TP1..N + «📉 Убыток»; win → «✅ Сделка закрыта» + «📈 Прибыль»; QPulse `slHit` при `CLOSED_LOSS`.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-188

- Status: `done`
- Scope: Mirror group templates — English + profit % on TP hit.
- Files: `telegram-userbot-mirror-format.util.ts`, `qpulse-signal-mapper.util.ts`, `signal-distribution.service.ts`
- Changes: all publish-group event texts in English; TP hit shows `Profit: +X.XX%` from entry→TP move; close/SL/entry/cancel translated.
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-182

- Status: `done`
- Scope: QPulse sync — только 1-й сигнал из серии попадал в приложение.
- Files: `qpulse-sync.service.ts`, `signal-distribution.service.ts`, `telegram-userbot-mirror.service.ts`, `orders.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`
- Findings: `createSignalIfLinked` после `await settings.get` терял cabinet context (QPULSE_* не читались); sync требовал mirror `posted` (ошибка TG блокировала QPulse); вызовы через `void` без await.
- Changes: явный `cabinetId` + `runWithCabinetAsync`; eligibility по linked-группам и `skipped_by_n` (не только posted); await цепочка create→sync; повтор sync после успешного placement в ingest.
- Manual verification: `npm run build -w apps/api`; 3 сигнала с `linkedToApp` + N=1 → 3 записи в QPulse; при N=3 — каждый 3-й; `/logs` — «QPulse: signal created» / «sync failed».
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-177

- Status: `done`
- Scope: Редактор контента — сохранение analysis/content в БД, страница редактирования, AI rewrite (OpenRouter), публикация в группы с чекбоксами.
- Files: Prisma `TgUserbotContentPost`, `TgUserbotContentPublication`, `contentPublishEnabled`; `telegram-userbot-content-editor.service.ts`; ingest hook; transcript `rewriteContentPost`; `apps/web/app/content-editor/*`; `nav-menu.ts`
- Changes: upsert поста при классификации analysis/content; CRUD + publish API; выбор групп `contentPublishEnabled` в БД; UI admin `/content-editor`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`; миграция на стенде; ingest analysis → пост в редакторе → publish в группу с галочкой.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-178

- Status: `done`
- Scope: Дашборд — метрики утилизации капитала по кабинетам (время исполнения сигнала, простой, доля не задействованного баланса).
- Files: `orders-dashboard-utilization.util.ts`, `orders-dashboard-utilization.types.ts`, `orders.service.ts`, `orders-dashboard-cabinets.types.ts`, `balance-snapshot.service.ts`, Prisma `BalanceSnapshot.availableUsd`, migration `20260601120000_balance_snapshot_available_usd`, web `home-dashboard.types.ts`, `home-dashboard.util.ts`, `page.tsx`, `globals.css`
- Findings: не было метрик простоя и задействования баланса; снимки баланса хранили только equity без available.
- Changes: среднее время исполнения (createdAt→closedAt); средняя длительность периодов с 0 открытых сигналов; текущая и 30-дневная средняя доля available/equity; поля в GET `/orders/dashboard-cabinets`; UI в карточках кабинетов; daily snapshot пишет `availableUsd`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web` (pass); после деплоя — миграция БД, открыть дашборд, проверить карточки кабинетов.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-179

- Status: `done`
- Scope: Деактивация кабинета — флаг `isActive`, UI «Активность», остановка userbot и poll Bybit.
- Files: Prisma `Cabinet.isActive`, migration `20260601130000_cabinet_is_active`, `cabinet.service.ts`, `cabinet.controller.ts`, `cabinet.types.ts`, `cabinet-select.util.ts`, `worker-queue.service.ts`, `telegram-userbot-scan.service.ts`, `telegram-userbot-ingest-pipeline.service.ts`, `bybit.service.ts`, web `cabinets/page.tsx`
- Findings: не было способа полностью остановить фоновую работу кабинета без удаления.
- Changes: `isActive` (default true); PATCH `/cabinets/:id` `{ isActive }`; default нельзя деактивировать; inactive skip в poll sweep, enqueueCabinetPoll, ingest pipeline, userbot pollTick; UI toggle на `/cabinets`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`; деактивировать кабинет → нет новых ingest/poll; активировать обратно.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-179 (продолжение)

- Scope: Дашборд — отображение деактивированного кабинета.
- Files: `orders-dashboard-cabinets.types.ts`, `orders.service.ts`, `DashboardCabinetInactiveBanner.tsx`, `page.tsx`, `home-dashboard.types.ts`, `globals.css`
- Changes: `isActive` в карточках dashboard-cabinets; баннер на карточке и в блоке «Текущий кабинет»; бейдж «неактивен»; для inactive не показываются setupWarnings/balanceGuard.
- Manual verification: `npm run check-types -w apps/web`, `npm run build -w apps/api`.

### AUD-180

- Status: `done`
- Scope: Клонирование кабинета; `STATS_RESET_AT` per-cabinet (изоляция сброса статистики).
- Files: `cabinet-clone.util.ts`, `cabinet-clone.types.ts`, `cabinet.service.ts`, `cabinet.controller.ts`, `packages/shared/src/cabinet-settings.ts`, migration `20260601140000_stats_reset_at_per_cabinet`, web `cabinets/page.tsx`, `settings/page.tsx`, `orders.service.ts`
- Findings: `STATS_RESET_AT` писался в глобальную `Setting` — сброс статистики одного кабинета влиял на все.
- Changes: `POST /cabinets/:id/clone` — копия настроек, `CabinetTelegramSource`, publish-групп, balance alert rules, members; без сделок/ingest/snapshots; имя `copy (n)`; уникальные Bybit/TG token пропускаются; clone получает свой `STATS_RESET_AT`; ключ в `CABINET_SCOPED_SETTING_KEYS` + миграция legacy global → CabinetSetting.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`; клон → пустая статистика; сброс stats в кабинете A не меняет метрики B.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-180 (fix)

- Status: `done`
- Scope: Клонирование кабинета — таймаут Prisma interactive transaction.
- Files: `cabinet.service.ts`, `cabinet-clone.util.ts`
- Findings: при большом числе настроек/источников цикл `create()` в `$transaction` превышал дефолтный timeout (~5 с) → «Transaction not found» на `cabinetTelegramSource.create`.
- Changes: проверка дубликатов unique settings одним запросом до транзакции; `createMany` вместо N×`create`; `{ maxWait: 10_000, timeout: 30_000 }`.
- Manual verification: `npm run build -w apps/api`; клон кабинета с множеством telegram sources.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-180 (fix keys copy)

- Status: `done`
- Scope: Клонирование — копировать Bybit/Telegram ключи вместе с остальными настройками.
- Files: `cabinet-clone.util.ts`, `cabinet.service.ts`, `cabinet-clone.types.ts`, `cabinets/page.tsx`
- Findings: проверка «уникальности» находила ключи в исходном кабинете и пропускала их при копировании.
- Changes: убран skip `BYBIT_*` / `TELEGRAM_BOT_TOKEN`; клон получает полную копию настроек (кроме нового `STATS_RESET_AT`).
- Manual verification: клон кабинета → в `/settings` клона те же API-ключи, что у источника.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-181

- Status: `done`
- Scope: Оптимизация отклика UI при навигации и переключении настроек — API dashboard/settings и параллельные fetch на web.
- Files: `orders-dashboard-overview-cache.util.ts`, `orders-async-pool.util.ts`, `orders-dashboard-balance-guard.util.ts`, `orders.service.ts`, `settings-list-resolve.util.ts`, `settings.service.ts`, `apps/web/app/page.tsx`, `apps/web/app/settings/page.tsx`
- Findings: `GET /orders/dashboard-cabinets` последовательно опрашивал Bybit и userbot на каждый кабинет; главная и `/settings` делали цепочку последовательных HTTP; `settings.list()` вызывал тяжёлый `getMany()` по всем ключам.
- Changes: in-memory кэш overview 20 с по userId; параллельная обработка до 3 кабинетов; один `userbot.getStatus()` на overview; skip Bybit для inactive; throttle `upsertToday`; sync fallback в `list()` без N×`get()`; параллельный `Promise.allSettled` на главной (auth, cabinets, userbot, dashboard, activity, groups, balance-history); параллельная загрузка settings+cabinets+balance-alerts; invalidate кэша при сбросе статистики.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`; открыть `/`, `/settings` с несколькими кабинетами — заметно быстрее повторная загрузка (кэш 20 с).
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-183

- Status: `done`
- Scope: Единый часовой пояс `Europe/Moscow` для календарных суток и UI.
- Files: `packages/shared/src/app-timezone.ts`, `balance-snapshot.service.ts`, `orders.service.ts`, `orders-dashboard-aggregate-balance-history.util.ts`, telegram/userbot utils, `apps/web/lib/datetime.ts`, `BalanceChart.tsx`, `DashboardCrossCabinetSection.tsx`, `.env.example`
- Changes: `APP_TIMEZONE` / `NEXT_PUBLIC_DISPLAY_TIMEZONE` (default Moscow); «сегодня», снимки баланса, граф equity, счётчики ingest — по МСК; cron снимка 00:05 МСК.
- Manual verification: `npm run build -w @repo/shared`, `npm run build -w apps/api`, `npm run check-types -w apps/web`.
- Docs updated: `.env.example`, этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-184

- Status: `done`
- Scope: Редактор контента — стили preview/textarea и удаление постов.
- Files: `apps/web/app/content-editor/page.tsx`, `apps/web/app/globals.css`; API `DELETE /telegram-userbot/content/posts/:id` (AUD-177 follow-up).
- Changes: Telegram-like bubble предпросмотр; стилизованный textarea и двухколоночная сетка; список постов с кнопкой «×»; confirm + «Удалить» в панели; даты через `formatDateTimeRu`.
- Manual verification: `npm run check-types -w apps/web` (pass); открыть `/content-editor` — preview, редактирование, удаление поста из списка.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-185

- Status: `done`
- Scope: Зависший poll кабинета (TP/SL не ставились) + ручная постановка TP/SL из UI.
- Files: `worker-queue.service.ts`, `bybit.service.ts`, `bybit.controller.ts`, `bybit-apply-tpsl.types.ts`, `apply-tpsl-button.tsx`, `trades-list.tsx`, `LiveExposurePanel.tsx`
- Findings: `poll-cabinet` завис в `running` >10 ч; followup откладывался каждым interval-sweep; ACE filled на бирже, в БД `Untriggered` → TP/SL не применялись.
- Changes: периодический `recoverStaleRunningJobs`; `releaseStalePollJobForCabinet`; `mergeRunAfter` для followup; `POST /bybit/apply-tpsl/:signalId`; кнопка «TP / SL» на `/trades` и в Live Exposure; `emitOrderFillEventsIfNew` в fast-apply.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`; Railway cabinets — сброс зависшего poll job.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-186

- Status: `done`
- Scope: Обнаружение и отображение «зависших» сделок (расхождение БД/Bybit, нет TP/SL, зависший poll).
- Files: `bybit-stuck-trades.{types,util,service}.ts`, `bybit.controller.ts`, `worker-queue.service.ts` (`getPollJobStuckState`); web `stuck-trades-banner.tsx`, `stuck-trades.types.ts`, `trades/page.tsx`, `trades-list.tsx`, `page.tsx`, `globals.css`
- Changes: `GET /bybit/stuck-trades` — скан активных linear-сигналов vs позиция на бирже; issue kinds `entry_db_stale`, `missing_sl`, `missing_tp`; предупреждение poll >2 мин; баннер на `/trades` и дашборде; жёлтый badge на карточках; кнопка TP/SL в баннере.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-187

- Status: `done`
- Scope: Фоновое auto-heal «зависших» сделок без перегрузки poll/reconcile.
- Files: `bybit-stuck-trades-heal.{types,settings.util,service}.ts`, `bybit-stuck-trades-heal-scheduler.service.ts`, `worker-queue.service.ts`, `worker-queue.types.ts`, `bybit.service.ts` (`applyTpSlManually` context), `bybit.module.ts`, `settings.constants.ts`, `settings.service.ts`, `.env.example`, `stuck-trades-banner.tsx`
- Changes: scheduler каждые ~3 мин → sweep по кабинетам с активными linear-сигналами; job `heal-stuck-trades` в очереди execution (не дублируется pending/running); defer при backlog reconcile и свежем poll; max 2 сделки/run, cooldown 10 мин; сброс зависшего poll перед heal; настройки `STUCK_TRADES_AUTO_HEAL_*`.
- Manual verification: `npm run build -w apps/api`, `npm run check-types -w apps/web`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-188

- Status: `done`
- Scope: Result без цитаты/SIGNAL ID — определение токена и отмена «висящих» ордеров.
- Files: `telegram-userbot-text.util.ts`, `telegram-userbot-ingest-signal-lookup.service.ts`, `telegram-userbot-ingest-signal-reply.service.ts`, `bybit.service.ts` (`hasExchangeExposureForSignal`), `settings-page.constants.ts`, `.env.example`
- Changes: `extractPairFromResultMessage` (RENDER SCALP TRADE → RENDERUSDT); `findActiveSignalsForChatAndPair`; fallback `by_pair` в result-flow; фильтр open entry без filled entry и без позиции на Bybit; те же notify/cancel настройки; exchange-check перед auto-cancel (и для by_reply).
- Manual verification: `npm run build -w apps/api`.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A

### AUD-189

- Status: `done`
- Scope: Railway cabinets API 502 — контейнер exited, Nest DI crash.
- Files: `worker-queue.service.ts`, `bybit.service.ts`
- Findings: `WorkerQueueService` инжектил `BybitStuckTradesHealService` напрямую → цикл с `WorkerQueueService` в heal → Nest `UndefinedDependencyException` при старте.
- Changes: heal job делегируется через `BybitService.runStuckTradesAutoHealForCabinet`; прямой inject heal в worker queue убран.
- Manual verification: `npm run build -w apps/api`; Railway SSH — `node dist/main.js` стартует без DI error.
- Docs updated: этот трекер.
- Linked risks (`SEC-###`): N/A
