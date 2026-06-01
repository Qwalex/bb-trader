/** Ограниченный параллелизм (Bybit — отдельная очередь на кабинет). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const list = [...items];
  if (list.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.trunc(concurrency), list.length));
  const results = new Array<R>(list.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await mapper(list[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
