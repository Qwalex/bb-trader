import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { parseNumberArrayFromJson } from '../../bybit/instrument/bybit-json.util';
import { TelegramSpotFlowService } from '../../telegram/services/telegram-spot-flow.service';
import { BybitSpotInstrumentService } from '../instrument/bybit-spot-instrument.service';
import type { SpotLevelHitKind } from '../types/bybit-spot.types';
import {
  parseSpotNotifiedJson,
  serializeSpotNotifiedJson,
} from '../utils/bybit-spot-notified.util';

export type SpotLevelHit = {
  signalId: string;
  pair: string;
  kind: SpotLevelHitKind;
  levelIndex: number;
  levelPrice: number;
  lastPrice: number;
};

export type SpotPriceWatchSignal = {
  id: string;
  pair: string;
  direction: string;
  status: string;
  stopLoss: number;
  takeProfits: string;
  spotBaseQty: number | null;
  spotNotifiedJson: string | null;
};

@Injectable()
export class BybitSpotPriceWatchService {
  private readonly logger = new Logger(BybitSpotPriceWatchService.name);

  constructor(
    private readonly instrument: BybitSpotInstrumentService,
    @Inject(forwardRef(() => TelegramSpotFlowService))
    private readonly spotFlow: TelegramSpotFlowService,
  ) {}

  async checkOpenSpotSignals(
    client: RestClientV5,
    signals: SpotPriceWatchSignal[],
  ): Promise<Map<string, string>> {
    const updatedNotified = new Map<string, string>();
    for (const sig of signals) {
      if (sig.status !== 'OPEN' || !(sig.spotBaseQty != null && sig.spotBaseQty > 0)) {
        continue;
      }
      if (sig.direction !== 'long') {
        continue;
      }
      try {
        const symbol = normalizeTradingPair(sig.pair);
        const lastPrice = await this.instrument.getSpotLastPrice(client, symbol);
        if (lastPrice == null) {
          continue;
        }
        const tps = parseNumberArrayFromJson(sig.takeProfits);
        const notified = parseSpotNotifiedJson(sig.spotNotifiedJson);
        let changed = false;

        for (let i = 0; i < tps.length; i += 1) {
          const tp = tps[i];
          if (tp == null || !Number.isFinite(tp)) {
            continue;
          }
          if (notified.tpHit.includes(i)) {
            continue;
          }
          if (lastPrice >= tp) {
            notified.tpHit.push(i);
            changed = true;
            await this.spotFlow.notifySpotLevelHit({
              signalId: sig.id,
              pair: symbol,
              kind: 'tp',
              levelIndex: i,
              levelPrice: tp,
              lastPrice,
            });
          }
        }

        if (
          !notified.slHit &&
          Number.isFinite(sig.stopLoss) &&
          sig.stopLoss > 0 &&
          lastPrice <= sig.stopLoss
        ) {
          notified.slHit = true;
          changed = true;
          await this.spotFlow.notifySpotLevelHit({
            signalId: sig.id,
            pair: symbol,
            kind: 'sl',
            levelIndex: 0,
            levelPrice: sig.stopLoss,
            lastPrice,
          });
        }

        if (changed) {
          updatedNotified.set(sig.id, serializeSpotNotifiedJson(notified));
        }
      } catch (e) {
        this.logger.debug(`checkOpenSpotSignals ${sig.id}: ${formatError(e)}`);
      }
    }
    return updatedNotified;
  }
}
