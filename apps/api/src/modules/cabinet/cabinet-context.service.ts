import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

type CabinetRuntimeStore = {
  cabinetId: string | null;
};

@Injectable()
export class CabinetContextService {
  private readonly storage = new AsyncLocalStorage<CabinetRuntimeStore>();

  getCabinetId(): string | null {
    return this.storage.getStore()?.cabinetId ?? null;
  }

  runWithCabinet<T>(cabinetId: string | null, fn: () => T): T {
    return this.storage.run({ cabinetId }, fn);
  }

  /**
   * Для async-колбэков из HTTP-handlers: гарантирует сохранение store AsyncLocalStorage на время Promise
   * (синхронный `runWithCabinet` + «просто вернуть Promise» зависит от версии Node и может терять контекст).
   */
  async runWithCabinetAsync<T>(
    cabinetId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      this.storage.run({ cabinetId }, () => {
        Promise.resolve(fn()).then(resolve, reject);
      });
    });
  }
}

