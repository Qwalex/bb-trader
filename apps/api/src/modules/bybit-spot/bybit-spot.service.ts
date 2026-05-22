import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { AppLogService } from '../app-log/app-log.service';
import { BybitService } from '../bybit/bybit.service';
import type { PlaceOrdersResult, SignalOrderOrigin } from '../bybit/types/bybit.types';
import { OrdersService } from '../orders/orders.service';
import { TelegramSpotFlowService } from '../telegram/services/telegram-spot-flow.service';
import { BybitSpotInstrumentService } from './instrument/bybit-spot-instrument.service';
import { BybitSpotLifecyclePollService } from './poll/bybit-spot-lifecycle-poll.service';
import type {
  BybitSpotLifecyclePollPorts,
  RouteUserbotSignalPlacementParams,
  UserbotPlacementRouteResult,
} from './types/bybit-spot.types';

@Injectable()
export class BybitSpotService {
  private readonly logger = new Logger(BybitSpotService.name);

  constructor(
    private readonly instrument: BybitSpotInstrumentService,
    private readonly appLog: AppLogService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    @Inject(forwardRef(() => TelegramSpotFlowService))
    private readonly spotFlow: TelegramSpotFlowService,
    private readonly spotLifecyclePoll: BybitSpotLifecyclePollService,
  ) {}

  createSpotLifecyclePollPorts(): BybitSpotLifecyclePollPorts {
    return {
      getClient: () => this.instrument.getClient(),
      orders: this.orders,
      appLog: this.appLog,
    };
  }

  async pollSpotSignals(): Promise<void> {
    await this.spotLifecyclePoll.pollSpotSignals(this.createSpotLifecyclePollPorts());
  }

  async resolveUserbotPlacementRoute(params: {
    signal: { pair: string; direction: string };
    ingestId: string;
  }): Promise<
    | { kind: 'linear' }
    | { kind: 'spot_prompt' }
    | { kind: 'blocked'; error: string; userbotStatus?: 'place_error' | 'cancelled' }
  > {
    const symbol = normalizeTradingPair(params.signal.pair);
    const avail = await this.instrument.resolveAvailability(params.signal.pair);
    if (!avail.linear && !avail.spot) {
      return {
        kind: 'blocked',
        error: `Пары ${symbol} нет на бирже Bybit`,
        userbotStatus: 'place_error',
      };
    }
    if (!avail.linear && avail.spot) {
      if (params.signal.direction !== 'long') {
        return {
          kind: 'blocked',
          error: 'На споте доступна только покупка (long)',
          userbotStatus: 'place_error',
        };
      }
      return { kind: 'spot_prompt' };
    }
    return { kind: 'linear' };
  }

  async routeUserbotSignalPlacement(
    params: RouteUserbotSignalPlacementParams,
  ): Promise<UserbotPlacementRouteResult> {
    const resolve = await this.resolveUserbotPlacementRoute({
      signal: params.signal,
      ingestId: params.ingestId,
    });
    if (resolve.kind === 'blocked') {
      return {
        kind: 'blocked',
        error: resolve.error,
        userbotStatus: resolve.userbotStatus,
      };
    }
    if (resolve.kind === 'spot_prompt') {
      const started = await this.spotFlow.startSpotPrompt({
        ingestId: params.ingestId,
        signal: params.signal,
        rawMessage: params.rawMessage,
        origin: params.origin,
      });
      return {
        kind: 'spot_prompt',
        message: started.ok
          ? 'Ожидает решение по споту'
          : (started.error ?? 'Ожидает решение по споту'),
      };
    }

    const placement = await this.bybit.placeSignalOrders(
      params.signal,
      params.rawMessage,
      params.origin,
    );
    if (!placement.ok && (await this.shouldFallbackToSpotAfterLinearFailure(params, placement))) {
      const started = await this.spotFlow.startSpotPrompt({
        ingestId: params.ingestId,
        signal: params.signal,
        rawMessage: params.rawMessage,
        origin: params.origin,
      });
      return {
        kind: 'spot_prompt',
        message: started.ok
          ? 'Пара доступна только на споте — ожидает решение'
          : (started.error ?? 'Ожидает решение по споту'),
      };
    }
    return { kind: 'linear', placement };
  }

  private async shouldFallbackToSpotAfterLinearFailure(
    params: RouteUserbotSignalPlacementParams,
    placement: PlaceOrdersResult,
  ): Promise<boolean> {
    if (placement.ok || params.signal.direction !== 'long') {
      return false;
    }
    const err = formatError(placement.error).toLowerCase();
    const isLeverageOrContract =
      err.includes('setleverage') ||
      err.includes('10001') ||
      err.includes('110074') ||
      err.includes('contract is not live') ||
      err.includes('not live');
    if (!isLeverageOrContract) {
      return false;
    }
    const avail = await this.instrument.resolveAvailability(params.signal.pair);
    return !avail.linear && avail.spot;
  }
}
