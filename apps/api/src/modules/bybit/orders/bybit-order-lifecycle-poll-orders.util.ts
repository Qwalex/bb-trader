import type { OrdersService } from '../../orders/orders.service';
import type { BybitOrderLifecyclePollPorts } from '../types/bybit-ports.types';

/** Порты orders для linear poll: явная делегация (spread класса теряет методы prototype). */
export function createLinearPollOrdersPorts(
  orders: OrdersService,
): BybitOrderLifecyclePollPorts['orders'] {
  return {
    listOpenSignals: () => orders.listOpenLinearSignals(),
    getSignalWithOrders: (id) => orders.getSignalWithOrders(id),
    updateOrder: (id, data) => orders.updateOrder(id, data),
    reconcileStaleOpenSignalsForPairAndDirection: (pair, direction) =>
      orders.reconcileStaleOpenSignalsForPairAndDirection(pair, direction),
  };
}
