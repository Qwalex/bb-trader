# Security Risks Register

## Severity

- Critical
- High
- Medium
- Low

## Risk Template

- ID: `SEC-###`
- Severity:
- Area/File:
- Risk:
- Impact:
- Mitigation plan:
- Status: `open | in_progress | mitigated | accepted`
- Linked task: `AUD-###`

## Active Risks

- `SEC-001` (Medium), `apps/web/app/api/auth/route.ts` + `apps/web/lib/api.ts`, browser-readable auth token and public-token fallback risk reduced: `NEXT_PUBLIC_API_ACCESS_TOKEN` fallback removed and `sb_auth_token` limited to non-production only; residual compatibility cookie remains in dev, status `mitigated`, linked task `AUD-013`.
- `SEC-002` (Low), `scripts/watch-ssh-availability.sh`, switched from disabled host checks to configurable strict host checking with known_hosts and HTTPS notify default, status `mitigated`.
- `SEC-003` (Low), `docker-compose*.yml`, hardcoded DB credentials and browser-exposed API token env reduced via env-substitution defaults and removal of `NEXT_PUBLIC_API_ACCESS_TOKEN` from compose environments, status `mitigated`.
- `SEC-004` (Medium), `apps/api/src/modules/bybit/bybit.service.ts`, historically oversized orchestration raised review/regression risk; mitigated by wave decomposition (domain services under `modules/bybit/*`, facade ~540 lines, ports in `types/bybit-ports.types.ts`). Residual: cross-cutting orchestration and thick port wiring on the facade still require careful review on changes, status `mitigated`, linked tasks `AUD-006`, `AUD-038`, `AUD-039`.
- `SEC-005` (High), `apps/api/src/modules/settings/settings.controller.ts`, raw settings endpoint exposed unmasked secret values; mitigated by admin-only gate for `GET /settings/raw`, status `mitigated`, linked task `AUD-013`.
- `SEC-006` (High), `apps/api/src/modules/app-log/app-log.controller.ts`, operational logs were accessible to any authenticated user; mitigated by admin-only gate for `GET /logs`, status `mitigated`, linked task `AUD-013`.
- `SEC-007` (Medium), `apps/api/src/common/cabinet-context.middleware.ts`, malformed cookie value could throw during decode and break request flow; mitigated by safe `decodeURIComponent` fallback, status `mitigated`, linked task `AUD-013`.
- `SEC-008` (High), `.github/workflows/deploy*.yml` + root deploy scripts, VPS deployment drift removed by deleting VPS-specific workflows/scripts and switching repo policy to Railway-only, status `mitigated`, linked task `AUD-014`.
- `SEC-009` (High), `apps/api/src/modules/auth/auth.service.ts`, unrestricted public self-registration at `/auth/register`; mitigated by env-controlled gate `AUTH_ALLOW_PUBLIC_REGISTER` (default deny in production), status `mitigated`, linked task `AUD-013`.
- `SEC-010` (Medium), `apps/web/app/telegram-userbot/page.tsx`, source stats were loaded via raw unauthenticated `fetch` bypassing common auth/cabinet headers and masking API errors as zero metrics; mitigated by switching to shared `apiFetch` wrapper, status `mitigated`, linked task `AUD-013`.
- `SEC-011` (Low), `nixpacks*.toml` legacy config drift could cause deploy ambiguity; mitigated by removing Nixpacks config files and keeping Railpack-only config surface (`railpack*.json` + `railway*.toml`), status `mitigated`, linked task `AUD-014`.
- `SEC-012` (Low), `apps/api/src/modules/orders/orders.controller.ts` + `apps/api/src/modules/app-log/app-log.controller.ts` + `apps/api/src/modules/telegram-userbot/telegram-userbot.controller.ts`, unbounded/weak query `limit`/pagination parsing could amplify heavy reads; mitigated by strict integer normalization and sane caps for public query parameters, status `mitigated`, linked task `AUD-015`.
