# Deploy And Rollback

## Deploy Paths

- Railway: API and Web as separate services from one repo.
- Railway-only policy: VPS restart scripts and VPS deploy workflows are intentionally removed from the repository.
- **Окружение `cabinets` (схема B):** три процесса из одного образа API — **Api** (`API_PROCESS_ROLE=api`), **Worker-UB** (`worker-userbot`: MTProto userbot, ingest, VK), **Worker-Bybit** (`worker-bybit`: poll, private WS, весь Bybit REST). Общий Postgres. Railpack: `railpack.json` / `railpack.worker-userbot.json` / `railpack.worker-bybit.json`; healthcheck `/health` → `{ status, service: role }`.

## Worker split rollout (cabinets)

1. Push в ветку `cabinets`.
2. Deploy **Worker-Bybit** → `GET /health` → `service: worker-bybit`.
3. Deploy **Worker-UB** → userbot reconnect.
4. Deploy **Api** (proxy) → Web `/health`.
5. Rollback: redeploy предыдущего deployment Api **или** временно `API_PROCESS_ROLE=all` на одном Api и остановить worker-сервисы.

## Deploy Safety Checklist

- Validate env keys for target environment.
- **Worker split:** на **Api**, **Worker-UB** и **Worker-Bybit** один и тот же `AUTH_JWT_SECRET` **или** `API_ACCESS_TOKEN` (как на Api) — иначе proxy userbot/Bybit на worker даёт `401 Auth is not configured`.
- Verify healthcheck endpoints after deploy.
- Confirm DB migration compatibility before restart.
- Confirm external integrations (Bybit/Telegram/OpenRouter/VK) are reachable.

## Rollback Rules

- Prefer fast revert/redeploy over manual server patching.
- Avoid destructive server-side git operations where possible.
- If rollback changes behavior, register incident and mitigation in `04-operational-runbooks.md`.

## Audit Notes

- Track all deploy/rollback risks in `03-security-risks-register.md`.
