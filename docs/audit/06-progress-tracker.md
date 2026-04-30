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
- Findings: reviewed core API, Web, compose/deploy scripts, and agent documentation surfaces; remaining decomposition should continue in subsequent waves for very large files (`bybit.service.ts`, `transcript.service.ts`, `orders.service.ts`, `settings/page.tsx`, `telegram-userbot/page.tsx`).
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
