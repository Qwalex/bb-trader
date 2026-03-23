import { describe, expect, it } from '@jest/globals';

import { BybitService } from './bybit.service';

describe('BybitService TP coverage helpers', () => {
  const service = new BybitService(
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as {
    hasOpenEntryOrders: (
      orders: { orderKind: string; status: string | null }[],
    ) => boolean;
  };

  it('detects that entry ladder is still active', () => {
    const hasOpenEntries = service.hasOpenEntryOrders([
      { orderKind: 'ENTRY', status: 'Filled' },
      { orderKind: 'DCA', status: 'New' },
      { orderKind: 'TP', status: 'New' },
    ]);

    expect(hasOpenEntries).toBe(true);
  });

  it('treats cancelled and filled entries as settled', () => {
    const hasOpenEntries = service.hasOpenEntryOrders([
      { orderKind: 'ENTRY', status: 'Cancelled' },
      { orderKind: 'DCA', status: 'Filled' },
    ]);

    expect(hasOpenEntries).toBe(false);
  });

  it('normalizes api credentials from settings storage', async () => {
    const settings = {
      get: async (key: string): Promise<string | undefined> => {
        const map: Record<string, string> = {
          BYBIT_TESTNET: ' false ',
          BYBIT_API_KEY_MAINNET: ' "main_key_123" ',
          BYBIT_API_SECRET_MAINNET: " 'main_secret_456' ",
        };
        return map[key];
      },
    };
    const bybit = new BybitService(
      settings as never,
      {} as never,
      {} as never,
    ) as unknown as {
      getBybitCredentials: () => Promise<{
        key: string;
        secret: string;
        testnet: boolean;
      } | null>;
    };

    const creds = await bybit.getBybitCredentials();

    expect(creds).toEqual({
      key: 'main_key_123',
      secret: 'main_secret_456',
      testnet: false,
    });
  });

  it('does not treat failed TP records as live TP protection', () => {
    const bybit = new BybitService(
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      hasLiveTpOrders: (
        orders: { orderKind: string; status: string | null }[],
      ) => boolean;
    };

    const hasLiveTps = bybit.hasLiveTpOrders([
      { orderKind: 'TP', status: 'FAILED' },
      { orderKind: 'ENTRY', status: 'New' },
    ]);

    expect(hasLiveTps).toBe(false);
  });

  it('detects live TP orders by open status', () => {
    const bybit = new BybitService(
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      hasLiveTpOrders: (
        orders: { orderKind: string; status: string | null }[],
      ) => boolean;
    };

    const hasLiveTps = bybit.hasLiveTpOrders([
      { orderKind: 'TP', status: 'New' },
      { orderKind: 'ENTRY', status: 'Filled' },
    ]);

    expect(hasLiveTps).toBe(true);
  });

  it('splits TP level into child orders by entry count', () => {
    const bybit = new BybitService(
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      splitQtyForChildOrders: (
        totalQtyBase: number,
        childCount: number,
        qtyStep: string,
        minQty: string,
      ) => string[];
    };

    const parts = bybit.splitQtyForChildOrders(4, 2, '1', '1');
    expect(parts).toEqual(['2', '2']);
  });

  it('falls back to a single TP child order when minQty blocks split', () => {
    const bybit = new BybitService(
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      splitQtyForChildOrders: (
        totalQtyBase: number,
        childCount: number,
        qtyStep: string,
        minQty: string,
      ) => string[];
    };

    const parts = bybit.splitQtyForChildOrders(1.5, 2, '0.1', '1');
    expect(parts).toEqual(['1.5']);
  });
});
