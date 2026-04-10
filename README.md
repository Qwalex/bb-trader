# SignalsBot

Полуавтоматизированная торговая система: Telegram-сигналы → OpenRouter (распознавание) → Bybit (ордера) → PostgreSQL через Prisma (история, winrate, PnL). Веб-дашборд на Next.js 16.

## Структура

- `apps/api` — NestJS: Telegram, Transcript (OpenRouter), Bybit, Orders, Settings, Prisma.
- `apps/web` — Next.js 16: дашборд, сделки, **логи** (`/logs`), настройки.
- `packages/shared` — общие типы (`SignalDto` и др.).

## Быстрый старт

1. Скопируйте `.env.example` в `apps/api/.env` и заполните ключи (или задайте их позже в UI `/settings`).

2. Установка и БД: поднимите PostgreSQL и задайте `DATABASE_URL` (например `postgresql://user:pass@localhost:5432/signals?schema=public` в `apps/api/.env` или в корневом `.env`).

```bash
npm install
cd packages/shared && npm run build && cd ../..
cd apps/api && npx prisma migrate deploy && cd ../..
```

1. Добавьте защиту API (обязательно для dev/test/prod):

```bash
# apps/api/.env
API_ACCESS_TOKEN=change-me-very-strong-token
API_CORS_ORIGINS=http://localhost:3000

# apps/web/.env.local
NEXT_PUBLIC_API_ACCESS_TOKEN=change-me-very-strong-token
```

1. Разработка (API на `:3001`, web на `:3000`):

```bash
npm run dev
```

Переменная для фронта: `NEXT_PUBLIC_API_URL=http://localhost:3001` (см. `.env.example`).

## Docker

```bash
docker compose up --build
```

- API: `http://localhost:3001` (health: `/health`)
- Web: `http://localhost:3000`
- PostgreSQL: сервис `postgres` в compose, данные в volume `postgres-data`. Просмотр — `npx prisma studio` из `apps/api` (при необходимости пробросьте порт к БД с хоста).

## Логи приложения (UI)

- Веб: **`/logs`** — список записей из БД (`GET /logs` API), фильтр по категории и лимит строк.
- Категории: **`openrouter`** (запрос/ответ к LLM, без секрета в теле), **`telegram`**, **`bybit`**, **`orders`**, **`system`**.
- После изменений схемы Prisma: `cd apps/api && npx prisma migrate dev` (локально) или `npx prisma migrate deploy` (CI/прод).

## Логи и отладка Telegram

- **`LOG_LEVEL=debug`** в `.env` — в консоли Nest будут уровни `debug` / `verbose` (см. `apps/api/src/main.ts`).
- В логах API ищите префиксы: **`TG inbound`** (каждое обновление), **`parse:`** / **`applyCorrection:`** (OpenRouter), **`handleParseResult`**, ошибки **`Telegraf unhandled error`**.
- Если в чате «тишина», а в логах **нет** строки `TG inbound` — бот не получает апдейты (неверный токен, второй инстанс с тем же токеном, сеть).
- Если есть **`доступ запрещён`** — ваш `user id` не в `TELEGRAM_WHISTELIST` или переменная не подхватилась.
- **`.env`:** при запуске из `apps/api` подключаются `../../.env` и локальный `apps/api/.env` (позже перекрывает). Ключи можно держать в **корневом** `.env`.
- **Приветствие при старте:** в логах `sendStartupGreeting` — при `whitelist loaded=false` whitelist не попал в процесс; при ошибке отправки — откройте чат с ботом и нажмите **Start** (или разблокируйте бота).
- Раньше обработчик Telegraf обрывался через **90 с**, а OpenRouter мог отвечать дольше — сейчас **`handlerTimeout=180s`** и таймаут axios **180s**.

## Telegram: подтверждение и правки

1. После расшифровки сигнала бот показывает поля и кнопки **«Подтвердить»** / **«Отмена»** — ордера на Bybit **не** выставляются сразу.
2. Если в сообщении **не хватает полей**, бот переходит в режим **допроса**: задаёт вопрос на русском, сохраняет **все ваши сообщения** в сессии до успешного разбора. Кнопка **«Подтвердить»** активна только когда сигнал полностью собран (до этого — только **«Отмена»**).
3. Можно отправить **текст с правками** (когда таблица уже готова) — вызывается OpenRouter (`applyCorrection`) с текущим JSON и комментарием; бот снова показывает результат и те же кнопки.
4. **«Подтвердить»** — проверка дубликата по паре и выставление ордеров. После **успешной** постановки черновик и контекст диалога сбрасываются. **«Отмена»** или `/cancel` — сброс черновика.
5. **Размер позиции:** в сигнале задаётся **сумма в USDT** (номинал по всем входам). Если в тексте не указано иначе, подставляется значение настройки **`DEFAULT_ORDER_USD`** (БД/`/settings` или переменная окружения; при отсутствии — 10 USDT). Старый вариант «процент от депозита» поддерживается, если в JSON задан только `capitalPercent` (без суммы в USDT).
6. **Дубликат пары:** при настроенных ключах Bybit решение принимается по **API биржи** (учитываются только ордера со статусами «живых» — New, Untriggered и т.д., не Filled/Cancelled/Deactivated). Пара нормализуется (`BTC-USDT` → `BTCUSDT`), чтобы совпадали БД и биржа. Если биржа «чистая», а в БД остался `ORDERS_PLACED`, запись **автоматически переводится** в `CLOSED_MIXED`. Без ключей Bybit возможна только проверка по БД.

## Security incident checklist

Если секреты когда-либо были доступны через `GET /settings/raw`, выполните:

1. `POST /settings/incident/purge-secrets` с телом `{ "confirm": true }` (очистка секретов в БД).
2. Ротацию во внешних системах: Bybit API keys, OpenRouter key, Telegram bot token, Telegram userbot session/API hash/2FA.
3. Перезапуск `api` и `web` с новыми значениями env.
4. Проверку, что `GET /settings/raw` без авторизации недоступен.

## Важно

- **Bybit — testnet и боевой счёт:** ключи задаются **раздельно**: `BYBIT_API_KEY_TESTNET` / `BYBIT_API_SECRET_TESTNET` и `BYBIT_API_KEY_MAINNET` / `BYBIT_API_SECRET_MAINNET`. Режим переключается **`BYBIT_TESTNET=true`** (тестовая сеть) или **`false`** (основной).
- **Whitelist Telegram:** `TELEGRAM_WHITELIST` — список числовых user id через запятую. При старте API каждому из них уходит приветственное сообщение (если пользователь уже хотя бы раз писал боту). Текст можно задать в настройках ключом `TELEGRAM_STARTUP_MESSAGE` или переменной окружения с тем же именем.
- **Bybit:** при **одном** TP — первый вход может нести TP и SL в одном ордере. При **нескольких** TP лимитные входы **без** TP/SL на ордере; SL на позицию — `setTradingStop` с **`tpslMode: Full`**, **`slOrderType: Market`** ([документация](https://bybit-exchange.github.io/docs/v5/position/trading-stop)). Несколько уровней TP — **`tpslMode: Partial`** + `tpOrderType: Limit`, `tpSize`, `takeProfit`/`tpLimitPrice` по каждому уровню; при отказе API — запасной вариант reduce-only лимитка. Объём позиции делится поровну с учётом шага лота и **tick** цены.
- **Несколько входов (DCA):** общий номинал делится **50% на первый вход**, оставшиеся **50% — поровну** между остальными уровнями (2 уровня → 50/50, 3 → 50/25/25, 4 → 50% + по 16.67% на три DCA и т.д.).
- **Аудио:** распознавание через ту же модель; для лучшего качества можно добавить отдельный ASR.
