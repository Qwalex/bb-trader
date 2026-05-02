import { Injectable } from '@nestjs/common';
import type { ContentKind } from '@repo/shared';

import { SettingsService } from '../settings/settings.service';
import { normalizeModelName } from './transcript-openrouter-parse.util';

@Injectable()
export class TranscriptOpenRouterModelChainService {
  constructor(private readonly settings: SettingsService) {}

  async getModelChainForKind(kind: ContentKind, primaryModel: string): Promise<string[]> {
    const chain: string[] = [primaryModel];
    const fallbackKey =
      kind === 'image'
        ? 'OPENROUTER_MODEL_IMAGE_FALLBACK_1'
        : kind === 'audio'
          ? 'OPENROUTER_MODEL_AUDIO_FALLBACK_1'
          : 'OPENROUTER_MODEL_TEXT_FALLBACK_1';
    const fallbackModel = normalizeModelName(await this.settings.get(fallbackKey));
    if (fallbackModel) {
      chain.push(fallbackModel);
    }
    const deduped: string[] = [];
    for (const m of chain) {
      if (!deduped.includes(m)) {
        deduped.push(m);
      }
    }
    return deduped;
  }

  async resolveModelKeyWithDefault(modelKey: string): Promise<string | undefined> {
    const specific = normalizeModelName(await this.settings.get(modelKey));
    if (specific) {
      return specific;
    }
    return normalizeModelName(await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
  }
}
