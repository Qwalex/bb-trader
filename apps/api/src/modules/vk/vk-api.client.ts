import { Injectable, Logger } from '@nestjs/common';

import { SettingsService } from '../settings/settings.service';

/** Тонкий клиент VK API для сообщений сообщества (копия сценариев Telegram, без SDK). */
@Injectable()
export class VkApiClient {
  private readonly logger = new Logger(VkApiClient.name);

  constructor(private readonly settings: SettingsService) {}

  private async token(): Promise<string | undefined> {
    const t = (await this.settings.get('VK_GROUP_ACCESS_TOKEN'))?.trim();
    return t || undefined;
  }

  async call<T>(method: string, params: Record<string, string | number | undefined>): Promise<T> {
    const accessToken = await this.token();
    if (!accessToken) {
      throw new Error('VK_GROUP_ACCESS_TOKEN не задан');
    }
    const u = new URL(`https://api.vk.com/method/${method}`);
    u.searchParams.set('access_token', accessToken);
    u.searchParams.set('v', '5.131');
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
    const res = await fetch(u.toString(), { method: 'GET' });
    const json = (await res.json()) as {
      response?: T;
      error?: { error_msg?: string; error_code?: number };
    };
    if (json.error) {
      const msg = json.error.error_msg ?? 'VK API error';
      this.logger.warn(`VK ${method}: ${msg} (${json.error.error_code})`);
      throw new Error(msg);
    }
    return json.response as T;
  }

  async sendMessage(opts: {
    peerId: number;
    message: string;
    keyboard?: string;
    attachment?: string;
  }): Promise<number> {
    const params: Record<string, string | number | undefined> = {
      peer_id: opts.peerId,
      message: opts.message,
      random_id: Math.floor(Math.random() * 2_147_483_647),
    };
    if (opts.keyboard) {
      params.keyboard = opts.keyboard;
    }
    if (opts.attachment) {
      params.attachment = opts.attachment;
    }
    const mid = await this.call<number>('messages.send', params);
    return mid;
  }

  /** Ответ на нажатие callback-кнопки (message_event). */
  async sendMessageEventAnswer(opts: {
    eventId: string;
    userId: number;
    peerId: number;
    eventData?: string;
  }): Promise<void> {
    const params: Record<string, string | number | undefined> = {
      event_id: opts.eventId,
      user_id: opts.userId,
      peer_id: opts.peerId,
    };
    if (opts.eventData) {
      params.event_data = opts.eventData;
    }
    await this.call<number>('messages.sendMessageEventAnswer', params);
  }

  async getById(attachmentsCsv: string): Promise<unknown> {
    return this.call<unknown>('messages.getById', {
      message_ids: attachmentsCsv,
    });
  }
}
