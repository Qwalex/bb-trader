import { describe, expect, it, jest } from '@jest/globals';

import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  it('deletes a trade by signal id', async () => {
    const findUniqueMock = jest.fn(async () => ({
      id: 'sig-1',
      status: 'CLOSED_WIN',
      deletedAt: null,
    }));
    const updateMock = jest.fn(async () => ({ id: 'sig-1' }));
    const service = new OrdersService({
      signal: {
        findUnique: findUniqueMock,
        update: updateMock,
      },
    } as never);

    await service.deleteTrade('sig-1');

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      select: { id: true, status: true, deletedAt: true },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('does not return deleted trade in getSignalWithOrders', async () => {
    const findFirstMock = jest.fn(async () => null);
    const service = new OrdersService({
      signal: {
        findFirst: findFirstMock,
      },
    } as never);

    const result = await service.getSignalWithOrders('sig-1');

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'sig-1', deletedAt: null },
      include: { orders: true },
    });
  });

  it('updates status only for non-deleted trade', async () => {
    const updateManyMock = jest.fn(async () => ({ count: 1 }));
    const service = new OrdersService({
      signal: {
        updateMany: updateManyMock,
      },
    } as never);

    const result = await service.updateSignalStatus('sig-1', {
      status: 'CLOSED_MIXED',
    });

    expect(result).toEqual({ count: 1 });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'sig-1', deletedAt: null },
      data: { status: 'CLOSED_MIXED' },
    });
  });
});
