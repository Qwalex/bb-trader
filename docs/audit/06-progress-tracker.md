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
