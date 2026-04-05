/** Общая схема ответа модели (с явным статусом); defaultOrderUsd — из настроек DEFAULT_ORDER_USD. */
export function buildJsonSchemaRules(defaultOrderUsd: number): string {
  return `
Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{
  "status": "complete" | "incomplete",
  "signal": {
    "pair": "BTCUSDT" | null,
    "direction": "long" | "short" | null,
    "entries": [number, ...] | null,
    "entryIsRange": boolean | null,
    "stopLoss": number | null,
    "takeProfits": [number, ...] | null,
    "leverage": number | null,
    "orderUsd": number,
    "capitalPercent": number,
    "source": "string | null"
  },
  "missing": ["pair", "direction", ...],
  "prompt": "Краткий вопрос пользователю на русском: каких данных не хватает" | null
}
Decision policy:
1. First decide whether the message is a NEW actionable trade setup.
2. If the message is not clearly a fresh setup, do NOT try to complete a signal. Return status="incomplete", keep required signal fields null, set missing=[], and set prompt=null.
3. Use status="incomplete" with a clarifying question ONLY when the message is clearly a fresh setup but exactly 1 or 2 required fields are unknown or ambiguous.
4. If 3 or more required fields are unknown/ambiguous, or the message is a report/update/commentary, do NOT ask a question. Return status="incomplete", missing=[], prompt=null.

Special update mode:
- If the user input contains sections named BASE_SIGNAL_JSON and UPDATE_MESSAGE, this is NOT a fresh setup classification task.
- In that case, treat BASE_SIGNAL_JSON as the authoritative current signal state.
- Extract only explicit changes from UPDATE_MESSAGE and merge them into BASE_SIGNAL_JSON.
- Keep all unchanged fields from BASE_SIGNAL_JSON as-is.
- ORIGINAL_SIGNAL_MESSAGE and QUOTED_MESSAGE are reference context only; do not discard known BASE_SIGNAL_JSON values just because they are absent in UPDATE_MESSAGE.
- Return the merged signal. Ask a clarifying question only if UPDATE_MESSAGE makes a required field ambiguous after merging.

Messages that are NOT a fresh setup unless they also contain a full new setup:
- trade result or performance report
- TP/SL hit report
- profit/loss/PNL/percentage report
- duration/period/statistics
- closed/закрыт/закрыта/закрыто
- recap, commentary, status update, or partial follow-up without enough setup fields

Required fields for a valid fresh setup:
- pair
- direction
- stopLoss
- takeProfits

Field rules:
- pair: always the USDT linear perpetual symbol as BASEUSDT (e.g. BTCUSDT, ETHUSDT, 1000PEPEUSDT). If the message names only the base asset without a quote (BTC, ETH, SOL, PEPE), append USDT. Forms like ETH/USDT, BTC-USDT, ethusdt are fine; casing and separators are normalized server-side.
- direction must be long or short.
- entries and leverage are optional.
- entries / entryIsRange — classify yourself from the text:
  - Range (one entry band): if the text says opening should happen **within** a range/zone/band of values (English: open in a range, enter between A and B, in the zone; Russian: открытие в диапазоне, в зоне, вход в коридоре, между X и Y как границами одной зоны), that is always entryIsRange=true: entries=[lower, higher] ascending. Same for one interval with two bounds for a single "where to enter" idea (zone/диапазон/зона/коридор, or one "A – B" line as min/max of one band). Server uses range-entry rules; no midpoint; not DCA.
  - List / enumeration (DCA): several separate entry prices (numbered list, multiple bullets, "Entry 1/2", distinct steps) without one band framing min/max of one zone. If prices are **only** listed separated by commas (or similar separators) with **no** dash/hyphen/en-dash between two prices as a single band and **no** wording about range/zone/band/диапазон/зона/коридор, treat as DCA: entryIsRange=false or omit, entries in message order. Server uses DCA rules.
  - If unclear: use range only when both numbers are clearly lower and upper bound of one zone; otherwise treat as DCA list.
- If the user gives no entry price, treat it as market entry: set entries to null and do NOT ask for clarification only because entries are missing. The order will be placed at market at the execution stage.
- If the message gives BOTH a market entry option and a limit entry (labels such as Entry market / Entry limit, маркет и лимит, market vs limit, two entry lines where one is market and the other has a price), ALWAYS prefer the limit: set entries to the limit price(s) only. Do NOT set entries to null because "market" is also mentioned alongside an explicit limit price.
- takeProfits: use only target/TP/цели/закрыть по prices — never put TP prices into entries.
- If leverage is given as a range (e.g. "2 - 5"), use the midpoint and round up (2-5 => 4).
- Extract prices only from explicit labels (Entry, Stop loss, SL, Targets/TP, etc.). Do not blend, infer, or average numbers from different fields.
- Field labels without actual values (e.g. "Entry:", "SL:", "TP1:" with no number after them) do NOT count as known values.
- takeProfits: one or more take-profit prices; several TPs mean equal split across levels.
- orderUsd: total position notional in USDT (e.g. 10, 50, 100). If the user gives percent of balance instead, set orderUsd to 0 and set capitalPercent to that percent.
- capitalPercent: use only when sizing by balance percent; otherwise 0.
- Default sizing: if size is not specified, set orderUsd to ${defaultOrderUsd} and capitalPercent to 0.
- source: ONLY if the user explicitly names the signal provider (Telegram channel, app, or group), e.g. "Binance Killers", "Crypto Signals". Otherwise set source to null. NEVER use "text", "image", "audio", or any input-format word as source.
`;
}

export function buildSystemPrompt(defaultOrderUsd: number): string {
  return `You are a trading signal parser. Extract structured data from the user message.
${buildJsonSchemaRules(defaultOrderUsd)}
`;
}
