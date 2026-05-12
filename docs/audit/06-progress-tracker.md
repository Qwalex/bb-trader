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
