import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';

/** Запущенные боты по кабинетам и primary для fallback-уведомлений. */
@Injectable()
export class TelegramBotRegistryService {
  private readonly bots = new Map<string, Telegraf>();
  private primaryBot: Telegraf | null = null;

  getPrimaryBot(): Telegraf | null {
    return this.primaryBot;
  }

  setPrimaryBot(bot: Telegraf | null): void {
    this.primaryBot = bot;
  }

  getBotForCabinet(cabinetId: string | null): Telegraf | null {
    if (cabinetId) {
      const scoped = this.bots.get(cabinetId);
      if (scoped) return scoped;
    }
    return this.primaryBot;
  }

  /** Экземпляр по кабинету без fallback на primary (синхронизация токенов, reuse одного Telegraf). */
  getScopedBotOnly(cabinetId: string): Telegraf | undefined {
    return this.bots.get(cabinetId);
  }

  addLaunchedBot(cabinetId: string, bot: Telegraf): void {
    this.bots.set(cabinetId, bot);
  }

  removeCabinetBot(cabinetId: string): void {
    this.bots.delete(cabinetId);
  }

  get launchedCount(): number {
    return this.bots.size;
  }

  entries(): IterableIterator<[string, Telegraf]> {
    return this.bots.entries();
  }

  values(): IterableIterator<Telegraf> {
    return this.bots.values();
  }

  clear(): void {
    this.bots.clear();
    this.primaryBot = null;
  }
}
