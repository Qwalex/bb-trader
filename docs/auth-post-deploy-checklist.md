# Post-Deploy API Checklist

Use this checklist after deploying auth changes to the target domain.

## Variables

- `BASE_URL=https://<your-domain>`
- `LOGIN=<shared-login>`
- `PASSWORD=<shared-password>`

## 1) Login and Token

- `POST $BASE_URL/auth/login` with JSON:
  - `{ "login": "$LOGIN", "password": "$PASSWORD" }`
- Expect:
  - `200`
  - JSON with `accessToken`, `expiresInSeconds`

## 2) Auth Validation

- `GET $BASE_URL/auth/me` with header:
  - `Authorization: Bearer <accessToken>`
- Expect:
  - `200`, payload with `ok: true`

## 3) Public Endpoints

- `GET $BASE_URL/health`
  - expect `200`
- `GET $BASE_URL/vk/callback`
  - should not return auth error
- `POST $BASE_URL/vk/callback` with valid VK payload
  - should not return auth error

## 4) Protected GET Smoke

Call each endpoint with valid bearer token and confirm `200`:

- `/cabinets`
- `/orders/stats`
- `/orders/trades`
- `/orders/sources`
- `/bybit/live`
- `/telegram-userbot/status`
- `/settings/raw`
- `/logs`
- `/diagnostics/runs`

## 5) Protected Mutations Smoke

Run representative writes with valid bearer token and confirm success/validation behavior:

- `PUT /settings`
- `PATCH /orders/trades/:id/source`
- `PATCH /orders/trades/:id/pnl`
- `POST /bybit/close/:signalId`
- `PUT /telegram-userbot/chats/:chatId`
- `POST /telegram-userbot/publish-groups`
- `POST /telegram-userbot/filters/examples`

## 6) Negative Auth Cases

For protected routes:

- no token -> expect `401`
- malformed token -> expect `401`
- expired token -> expect `401`

## 7) Web Session Checks

- Open `/login`, perform login.
- Open main sections: `/`, `/trades`, `/telegram-userbot`, `/settings`.
- Verify data loads successfully.
- Perform logout (`DELETE /api/auth`) and verify protected pages redirect back to `/login`.

