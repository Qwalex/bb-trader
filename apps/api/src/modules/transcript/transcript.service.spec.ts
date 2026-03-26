import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@openrouter/sdk', () => {
  return {
    OpenRouter: class OpenRouterMock {},
  };
});

import { TranscriptService } from './transcript.service';

describe('TranscriptService audio messages', () => {
  it('builds input_audio content part for audio payload', () => {
    const service = new TranscriptService(
      {} as never,
      {} as never,
    ) as unknown as {
      buildMessages: (
        kind: 'audio',
        payload: {
          audioBase64?: string;
          audioMime?: string;
          text?: string;
          continuationContext?: {
            partial: Record<string, unknown>;
            userTurns: string[];
          };
        },
        _defaultOrderUsd: number,
      ) => Array<{
        role: 'system' | 'user';
        content: unknown;
      }>;
    };

    const messages = service.buildMessages('audio', {
      audioBase64: 'ZmFrZS1hdWRpby1iYXNlNjQ=',
      audioMime: 'audio/ogg',
    }, 10);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toEqual([
      {
        type: 'text',
        text: 'Audio attached (audio/ogg). Transcribe and parse signal as JSON.',
      },
      {
        type: 'input_audio',
        inputAudio: {
          data: 'ZmFrZS1hdWRpby1iYXNlNjQ=',
          format: 'ogg',
        },
      },
    ]);
  });
});
