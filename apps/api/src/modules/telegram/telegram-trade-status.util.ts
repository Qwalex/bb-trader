export function tradeCanCancelFromTelegram(status: string): boolean {
  return (
    status === 'ORDERS_PLACED' ||
    status === 'OPEN' ||
    status === 'PARSED'
  );
}
