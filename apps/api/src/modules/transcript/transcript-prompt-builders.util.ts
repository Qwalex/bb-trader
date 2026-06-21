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
    "leverageRange": [number, number] | null,
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
- If leverage is given as a range (e.g. "2 - 5"), set "leverageRange" to [2,5] and keep "leverage" null unless one exact leverage value is explicitly given.
- Extract prices only from explicit labels (Entry, Stop loss, SL, Targets/TP, etc.). Do not blend, infer, or average numbers from different fields.
- Field labels without actual values (e.g. "Entry:", "SL:", "TP1:" with no number after them) do NOT count as known values.
- takeProfits: one or more take-profit prices; several TPs mean equal split across levels.
- orderUsd: total position notional in USDT (e.g. 10, 50, 100). If the user gives percent of balance instead, set orderUsd to 0 and set capitalPercent to that percent. If capitalPercent is above 100, orderUsd MUST be 0 — never output a positive orderUsd together with capitalPercent > 100 (no "100" placeholder).
- capitalPercent: percent for sizing when orderUsd is 0. If 1–100: margin share of account equity (total USDT); notional = margin × leverage. If above 100 (e.g. 500): notional = equity × (capitalPercent/100); leverage applies on exchange only (e.g. 500 with equity 10 → 50 USDT notional). Otherwise 0.
- Default sizing: if size is not specified, set orderUsd to ${defaultOrderUsd} and capitalPercent to 0.
- source: ONLY if the user explicitly names the signal provider (Telegram channel, app, or group), e.g. "Binance Killers", "Crypto Signals". Otherwise set source to null. NEVER use "text", "image", "audio", or any input-format word as source.
`;
}

export function buildSystemPrompt(defaultOrderUsd: number): string {
  return `You are a trading signal parser. Extract structured data from the user message.
${buildJsonSchemaRules(defaultOrderUsd)}
`;
}

export function normalizeOpenRouterAudioFormat(
  audioMime: string | undefined,
): string | undefined {
  if (!audioMime) return undefined;
  const mime = audioMime.trim().toLowerCase();
  if (!mime) return undefined;
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/x-wav') return 'wav';
  if (mime.includes('/')) {
    const suffix = mime.split('/')[1]?.trim();
    return suffix || undefined;
  }
  return mime;
}

export function buildTradingMessageClassifierPrompt(): string {
  return `You classify trading-related Telegram messages.
The user message may contain:
- MAIN_MESSAGE: current message text
- REPLY_TO_MESSAGE_ID: quoted/replied message id
- QUOTED_MESSAGE: quoted/replied message text
Use all provided parts together.

Return ONLY strict JSON:
{
  "kind": "signal" | "close" | "reentry" | "result" | "ad" | "analysis" | "promo" | "content" | "news" | "other",
  "reason": "short reason in Russian"
}

Classification rules:
1. Return "signal" for a fresh trade setup when pair and side (long/short) are clearly named — including incomplete stubs without entry, stop-loss, or take-profit yet (e.g. "INJUSDT SWING LONG"). The parse stage will handle missing levels. Entry is optional when present later. If BOTH market and limit entry are described, treat as limit entry. Leverage and size are optional. Do NOT require SL/TP at classification time.
1.1. Distinguish labels "SIGNAL" and "SIGNAL ID": a plain "SIGNAL" label is a weak hint of a new setup; "SIGNAL ID" alone (without entry/SL/targets) usually references an existing setup. If the message also contains a fresh actionable setup (pair + direction + entry + stop + targets), return "signal" — the ID is metadata, not a disqualifier.
2. Return "close" when the current message explicitly says close/closed/cancel/закрыт/отмена for a trade and it is not a TP/SL result report. Quoted/replied context strongly indicates "close", but even without a quote explicit close wording should still be classified as "close" rather than "result".
3. Return "reentry" ONLY when the current message is a re-entry / add-entry / update instruction for a previously quoted/replied signal. A quoted/replied context is required.
4. Return "result" for outcome/performance messages about an existing or past trade: TP hit, SL hit, closed trade report, profit/loss, PNL, percentages, duration, period, recap, statistics, performance summary.
5. If the text explicitly says close/closed but does NOT mention TP, take profit, SL, stop loss, target reached, тейк, стоп, or similar hit markers, prefer "close" over "result".
6. If the text contains result markers such as TP/SL outcome markers, target reached markers, profit/loss, PNL, duration/period, or performance summary, return "result".
7. Return "ad" for advertisements and promos of external channels, VIP subscriptions, paid signal groups, Cornix/bot bundles, referral links, "message to buy", combo prices for channel access, TeleFeed promos, and similar commercial offers. No actionable trade setup for our bot.
8. Return "analysis" for market commentary and technical outlook without a fresh actionable trade setup: price updates, trend/channel/support-resistance narrative, "possible scenarios", "keep an eye", "stay tuned", educational outlook. Usually mentions a pair or market but lacks explicit new entry+SL+TP setup intent.
9. Return "promo" for contests, giveaways, trader shows, challenge promotions, prize pools, "who will win", promo codes for prop firms/challenges, entertainment/event posts tied to trading community — not a trade signal and not a pure channel subscription ad.
10. Return "content" for useful non-commercial posts that are NOT "analysis", NOT "news", and NOT "ad": trading tips, education, how-to, risk/money management advice, tool/platform updates, community announcements with practical value, motivational posts for traders. The message should feel like substantive value, not a sales pitch and not primarily a pair/market outlook or breaking news.
11. Return "news" for factual market/news updates: listings, delistings, regulatory headlines, macro events, exchange announcements, project updates, partnership news, hack/exploit reports, ETF flows, "breaking", digest of events — reporting what happened, not primarily a trade setup or technical outlook scenario.
12. Return "other" for generic chat, empty fluff, off-topic noise, or unclear text — but NOT for incomplete setup stubs that already name pair and side (those are "signal"). Do NOT use "other" when "ad", "analysis", "promo", "content", or "news" fits better.

Priority:
- explicit manual close wording > close
- quoted re-entry/update > reentry
- fresh setup stub or full setup (pair + side) > signal
- outcome/performance report > result
- channel/VIP/subscription ads > ad
- market outlook without setup > analysis
- contests/giveaways/show promos > promo
- factual event/reporting headlines > news
- useful educational/informational (not ad, not analysis, not news) > content
- otherwise > other

Be conservative for close/reentry/result; for pair+side setup stubs prefer "signal" over "other". Prefer "ad"/"analysis"/"promo"/"content"/"news" over "other" when the message clearly matches those categories.`;
}

export function buildFilterPatternGenerationPrompt(kind: string): string {
  return `You generate literal substring patterns for Telegram message pre-filters.

Return ONLY strict JSON:
{
  "patterns": ["string", ...]
}

Task:
- Message kind: ${kind}
- Generate 3 to 6 short candidate patterns from the example message.
- Every pattern MUST be a literal substring that already exists in the example message, after lowercasing.
- Prefer stable phrases that are specific enough for this kind.
- Avoid overly generic tokens such as coin tickers, usdt, numbers, isolated punctuation, or single common words.
- Do NOT generate regex.
- Do NOT invent text that is absent from the example.
- Keep patterns short, usually 2-40 characters.
- Order patterns from best to weaker alternatives.
- Ensure all patterns are unique.`;
}

export function buildContentRewritePrompt(
  classification: 'analysis' | 'content' | 'news' | 'other',
): string {
  const kindHint =
    classification === 'analysis'
      ? 'аналитический пост о рынке (outlook, уровни, сценарии)'
      : classification === 'news'
        ? 'новостной пост: факты, события, дайджест без торговых рекомендаций'
        : classification === 'other'
          ? 'информационный пост для трейдеров'
          : 'полезный образовательный или информационный пост для трейдеров';
  return `You rewrite Telegram posts for publication in trading groups.

Return ONLY strict JSON:
{
  "text": "rewritten message in Russian"
}

Rules:
- Post kind: ${kindHint}
- Preserve factual meaning; improve clarity, structure, and readability.
- Keep tickers, numbers, levels, and links accurate — do not invent prices or setups.
- Do NOT add trade signals (entry/SL/TP) unless they were in the original.
- Do NOT add ads, referral links, or channel promos.
- Use concise Russian; Telegram-friendly formatting (short paragraphs, optional emoji sparingly).
- Output only the rewritten message body in the "text" field.`;
}

export function buildChannelContentGenerationPrompt(params: {
  outputKind: string;
  outputStyle?: string | null;
}): string {
  const style = params.outputStyle?.trim()
    ? `\n- Style/tone: ${params.outputStyle.trim()}`
    : '';
  return `You compose a single Telegram post for a trading channel from source material.

Return ONLY strict JSON:
{
  "text": "final message in Russian"
}

Rules:
- Target post kind: ${params.outputKind}${style}
- Synthesize source posts into one cohesive message; do not copy verbatim.
- Preserve facts, tickers, numbers, and links from sources — do not invent prices or trade setups.
- Do NOT add ads, referral links, or channel promos unless present in sources.
- Use concise Russian; Telegram-friendly formatting.
- Output only the message body in "text".`;
}
