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
}

