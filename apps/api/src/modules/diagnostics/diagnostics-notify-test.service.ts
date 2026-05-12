import { Injectable } from '@nestjs/common';

import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { TelegramService } from '../telegram';
import { VkNotifyMirrorService } from '../vk/vk-notify-mirror.service';

export type DiagnosticsNotifyTestResult = {
  cabinetId: string | null;
  telegram: { ok: boolean; deliveredTo: number; error?: string };
  vk: { deliveredTo: number; skipped?: string };
};

@Injectable()
export class DiagnosticsNotifyTestService {
  constructor(
    private readonly cabinetContext: CabinetContextService,
    private readonly telegram: TelegramService,
    private readonly vkNotifyMirror: VkNotifyMirrorService,
  ) {}

  /** Те же каналы и получатели, что при ошибках userbot (Telegram бот + зеркало VK). */
  async pingNotifyChannels(): Promise<DiagnosticsNotifyTestResult> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const [telegram, vk] = await Promise.all([
      this.telegram.notifyDiagnosticsPing(),
      this.vkNotifyMirror.mirrorDiagnosticsPing(),
    ]);
    return { cabinetId, telegram, vk };
  }
}
