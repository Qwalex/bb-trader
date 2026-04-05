export const TRANSCRIPT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'incomplete'] },
    signal: {
      type: 'object',
      properties: {
        pair: {
          type: ['string', 'null'],
          description:
            'USDT linear perp symbol BASEUSDT (e.g. BTCUSDT). If the message names only the base (BTC), output BTCUSDT. Null if unknown — separators/case normalized server-side',
        },
        direction: { type: ['string', 'null'], enum: ['long', 'short', null] },
        entries: { type: ['array', 'null'], items: { type: 'number' }, minItems: 1 },
        entryIsRange: {
          type: ['boolean', 'null'],
          description:
            'true: entries are ONE zone [low, high] (range/zone wording); false: entries are DCA list; null if single entry or market',
        },
        stopLoss: { type: ['number', 'null'] },
        takeProfits: {
          type: ['array', 'null'],
          items: { type: 'number' },
          minItems: 1,
        },
        leverage: { type: ['number', 'null'], minimum: 1 },
        orderUsd: { type: 'number', minimum: 0 },
        capitalPercent: { type: 'number', minimum: 0, maximum: 100 },
        source: { type: ['string', 'null'] },
      },
      required: [
        'pair',
        'direction',
        'entries',
        'entryIsRange',
        'stopLoss',
        'takeProfits',
        'leverage',
        'orderUsd',
        'capitalPercent',
        'source',
      ],
      additionalProperties: false,
    },
    missing: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['pair', 'direction', 'entries', 'stopLoss', 'takeProfits', 'leverage'],
      },
    },
    prompt: { type: ['string', 'null'] },
  },
  required: ['status', 'signal', 'missing', 'prompt'],
  additionalProperties: false,
} as const;

export const CLASSIFIER_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['signal', 'close', 'reentry', 'result', 'other'] },
    reason: { type: 'string' },
  },
  required: ['kind', 'reason'],
  additionalProperties: false,
} as const;

export const FILTER_PATTERN_GENERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: { type: 'string', minLength: 2 },
      minItems: 1,
    },
  },
  required: ['patterns'],
  additionalProperties: false,
} as const;
