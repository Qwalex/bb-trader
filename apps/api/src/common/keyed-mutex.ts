/**
 * In-process keyed mutex: serialises concurrent calls sharing the same string key.
 * Guarantees that for any given key only one `runExclusive` body executes at a time.
 */
export class KeyedMutex {
  private readonly locks = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();

    let releaseFn!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    this.locks.set(key, gate);

    await prev;
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      releaseFn();
    }
  }
}
