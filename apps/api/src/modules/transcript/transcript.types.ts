export type TranscriptParseOverrides = {
  defaultOrderUsd?: number;
  leverageDefault?: number;
  chatForcedLeverage?: number;
  leverageRangeMode?: 'min' | 'max' | 'mid';
  minAllowedLeverage?: number;
  maxAllowedLeverage?: number;
};

export type OpenRouterLogContext = {
  chatId?: string;
  source?: string;
  ingestId?: string;
  stage?: string;
};

export type TranscriptMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } }
  | { type: 'input_audio'; inputAudio: { data: string; format: string } };

export type TranscriptMessage = {
  role: 'system' | 'user';
  content: string | TranscriptMessagePart[];
};
