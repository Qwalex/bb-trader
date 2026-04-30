# Deploy And Rollback

## Deploy Paths
- Railway: API and Web as separate services from one repo.
- Docker/VPS scripts: `restart.sh`, `restart-dev.sh`, `restart-test.sh`.

## Deploy Safety Checklist
- Validate env keys for target environment.
- Verify healthcheck endpoints after deploy.
- Confirm DB migration compatibility before restart.
- Confirm external integrations (Bybit/Telegram/OpenRouter/VK) are reachable.

## Rollback Rules
- Prefer fast revert/redeploy over manual server patching.
- Avoid destructive server-side git operations where possible.
- If rollback changes behavior, register incident and mitigation in `04-operational-runbooks.md`.

## Audit Notes
- Track all deploy/rollback risks in `03-security-risks-register.md`.
