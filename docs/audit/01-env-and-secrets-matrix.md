# Env And Secrets Matrix

## Source Priority

1. Cabinet/user/global values from DB settings (where applicable).
2. `ConfigService` values from environment.
3. Direct `process.env` fallback in legacy paths.

## Environments

- Baseline template: `.env.example` (safe placeholders, no real secrets).
- Local Docker: compose-managed env + `.env` values.
- Development/Test: dedicated compose files and restart scripts.
- Railway: service variables + managed PostgreSQL (`DATABASE_URL`).

## Required Secret Classes

- Exchange credentials: `BYBIT_API_KEY_*`, `BYBIT_API_SECRET_*`; optional global WS-only pair `BYBIT_PRIVATE_WS_API_KEY`, `BYBIT_PRIVATE_WS_API_SECRET` (same rotation rules as API keys).
- AI provider credentials and endpoints.
- Telegram/VK bot tokens and admin identifiers.
- Auth and API shared secrets/tokens.
- Auth policy switches: `AUTH_ALLOW_PUBLIC_REGISTER` (runtime registration gate).

## Hard Rules

- Never log secrets in plain text.
- Keep browser-readable tokens to minimum; prefer server-side cookie/session boundaries.
- Any new secret key must be documented here with scope and rotation owner.
