import { describe, expect, it, jest } from '@jest/globals';

import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  it('deletes a trade by signal id', async () => {
    const findUniqueMock = jest.fn(async () => ({
      id: 'sig-1',
      status: 'CLOSED_WIN',
    }));
    const deleteMock = jest.fn(async () => ({ id: 'sig-1' }));
    const service = new OrdersService({
      signal: {
        findUnique: findUniqueMock,
        delete: deleteMock,
      },
    } as never);

    await service.deleteTrade('sig-1');

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      select: { id: true, status: true },
    });
    expect(deleteMock).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
    });
  });
});
