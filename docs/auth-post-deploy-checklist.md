# Post-Deploy API Checklist

Use this checklist after deploying auth changes to the target domain.

## Variables

- `BASE_URL=https://<your-domain>`
- `LOGIN=<shared-login>`
- `PASSWORD=<shared-password>`

## 1) Registration and Login

- `POST $BASE_URL/auth/register` with JSON:
  - `{ "login": "$LOGIN", "password": "$PASSWORD", "telegramUserId": "<tg-user-id>" }`
- Expect:
  - `200` and user payload
- Repeat register with same login:
  - expect `409`/validation error

- `POST $BASE_URL/auth/login` with JSON:
  - `{ "login": "$LOGIN", "password": "$PASSWORD" }`
- Expect:
  - `200`
  - JSON with `accessToken`, `expiresInSeconds`, `role`

## 2) Lockout Policy

- Do 3 failed logins for one user:
  - expect lock response with `account_locked_24h`
- After lock expires and 3 more failed attempts:
  - expect `account_locked_manual`
- Admin unlock:
  - `POST /auth/users/unlock` with admin token and `{ "login": "<user>" }`
  - expect `200`

## 3) Auth Validation

- `GET $BASE_URL/auth/me` with header:
  - `Authorization: Bearer <accessToken>`
- Expect:
  - `200`, payload with `ok: true`, `role`, `login`

## 4) Password Reset via Assistant Bot

- `POST /auth/password-reset/request` with `{ "login": "$LOGIN" }`
  - expect `200`, code sent to Telegram assistant bot
- `POST /auth/password-reset/confirm` with `{ "login": "$LOGIN", "code": "<from-bot>", "newPassword": "<new-pass>" }`
  - expect `200`
- Login with old password -> fail, with new password -> success

## 5) Public Endpoints

- `GET $BASE_URL/health`
  - expect `200`
- `GET $BASE_URL/vk/callback`
  - should not return auth error
- `POST $BASE_URL/vk/callback` with valid VK payload
  - should not return auth error

## 6) Protected GET Smoke

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

## 7) Protected Mutations Smoke

Run representative writes with valid bearer token and confirm success/validation behavior:

- `PUT /settings`
- `POST /auth/users/unlock` (admin token)
- `PATCH /orders/trades/:id/source`
- `PATCH /orders/trades/:id/pnl`
- `POST /bybit/close/:signalId`
- `PUT /telegram-userbot/chats/:chatId`
- `POST /telegram-userbot/publish-groups`
- `POST /telegram-userbot/filters/examples`

## 8) Negative Auth Cases

For protected routes:

- no token -> expect `401`
- malformed token -> expect `401`
- expired token -> expect `401`
- locked account -> expect lock code in body (`account_locked_24h` or `account_locked_manual`)

## 9) Web Session Checks

- Open `/login`, check tabs Login/Register/Reset.
- Register user, perform login.
- Request reset code and confirm password reset from bot code.
- Open main sections: `/`, `/trades`, `/telegram-userbot`, `/settings`.
- Verify data loads successfully.
- Perform logout (`DELETE /api/auth`) and verify protected pages redirect back to `/login`.
