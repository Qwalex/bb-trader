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
- `SEC-001` (Medium), `apps/web/app/api/auth/route.ts` + `apps/web/lib/api.ts`, browser-readable auth token remains for compatibility but token/cookie parsing moved to isolated utilities and auth boundary centralized, status `mitigated` (residual risk accepted for current flow).
- `SEC-002` (Low), `scripts/watch-ssh-availability.sh`, switched from disabled host checks to configurable strict host checking with known_hosts and HTTPS notify default, status `mitigated`.
- `SEC-003` (Low), `docker-compose*.yml`, hardcoded DB credentials and browser-exposed API token env reduced via env-substitution defaults and removal of `NEXT_PUBLIC_API_ACCESS_TOKEN` from compose environments, status `mitigated`.
