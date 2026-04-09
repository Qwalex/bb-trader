/**
 * Зеркалирование уведомлений whitelist на VK (копия текстов из telegram.service.ts).
 * Вызывается после TelegramService — логику Telegram не меняем.
 */
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import type { SignalDto } from '@repo/shared';

import { BybitService } from '../bybit/bybit.service';
import { SettingsService } from '../settings/settings.service';

import {
  vkFormatEntryLineText,
  vkFormatExternalSignalTable,
  vkSplitMessage,
} from './vk-bot-format.util';
import { VkApiClient } from './vk-api.client';
import type { VkBotService } from './vk-bot.service';
import { vkInlineKeyboard, vkPayload } from './vk-keyboard.util';

type ExternalConfirmationResult = {
  decision: 'confirmed' | 'rejected';
  ok: boolean;
  error?: string;
  signalId?: string;
  bybitOrderIds?: string[];
  actorUserId?: number;
};

@Injectable()
export class VkNotifyMirrorService {
  private readonly logger = new Logger(VkNotifyMirrorService.name);

  constructor(
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    private readonly vkApi: VkApiClient,
    @Inject(
      forwardRef(() => {
        // Иначе цикл bybit → vk-notify → vk-bot → transcript: TranscriptService в VkBotService = undefined.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('./vk-bot.service').VkBotService;
      }),
    )
    private readonly vkBot: VkBotService,
  ) {}

  private async tokenOk(): Promise<boolean> {
    return this.vkBot.vkEnabled();
  }

  private async whitelistIds(): Promise<number[]> {
    const raw =
      (await this.settings.get('VK_WHITELIST')) ?? process.env.VK_WHITELIST;
    if (!raw?.trim()) return [];
    return raw
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }

  private staleCancelKb(signalId: string): string {
    return vkInlineKeyboard([
      [
        {
          action: {
            type: 'callback',
            label: 'Отменить',
            payload: vkPayload({ a: 'usc', s: signalId }),
          },
        },
      ],
    ]);
  }

  private externalConfirmKb(ingestId: string): string {
    return vkInlineKeyboard([
      [
        {
          action: {
            type: 'callback',
            label: '✅ Подтвердить',
            payload: vkPayload({ a: 'ubc', i: ingestId }),
          },
          color: 'positive',
        },
        {
          action: {
            type: 'callback',
            label: '❌ Отклонить',
            payload: vkPayload({ a: 'ubr', i: ingestId }),
          },
          color: 'negative',
        },
      ],
    ]);
  }

  async mirrorRequestExternalSignalConfirmation(params: {
    ingestId: string;
    signal: SignalDto;
    rawMessage?: string;
    onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
  }): Promise<void> {
    if (!(await this.tokenOk())) return;
    const ids = await this.whitelistIds();
    if (ids.length === 0) return;

    const bal = await this.bybit.getUnifiedUsdtBalanceDetails();
    const def = await this.settings.getDefaultOrderUsd(bal?.totalUsd);
    const msg = vkFormatExternalSignalTable(params.signal, def);
    const kb = this.externalConfirmKb(params.ingestId);

    this.vkBot.registerVkExternalConfirmation({
      ingestId: params.ingestId,
      signal: params.signal,
      rawMessage: params.rawMessage,
      createdAt: Date.now(),
      onResult: params.onResult,
    });

    let delivered = 0;
    for (const uid of ids) {
      try {
        const parts = vkSplitMessage(msg, 3900);
        for (let i = 0; i < parts.length; i++) {
          const keyboard = i === parts.length - 1 ? kb : undefined;
          await this.vkApi.sendMessage({
            peerId: uid,
            message: parts[i]!,
            keyboard,
          });
        }
        delivered += 1;
      } catch (e) {
        this.logger.warn(`VK mirror external confirm -> ${uid}: ${String(e)}`);
      }
    }
    if (delivered === 0) {
      this.vkBot.unregisterVkExternalConfirmation(params.ingestId);
    }
  }

  async mirrorNotifyUserbotSignalFailure(params: {
    ingestId: string;
    chatId: string;
    groupTitle?: string;
    token: string;
    stage: 'classify' | 'transcript' | 'bybit';
    error: string;
    missingData?: string[];
  }): Promise<void> {
    if (!(await this.tokenOk())) return;
    const ids = await this.whitelistIds();
    if (ids.length === 0) return;

    const stageText =
      params.stage === 'classify'
        ? 'классификации'
        : params.stage === 'transcript'
          ? 'транскрибации/разбора'
          : 'установки ордеров на Bybit';
    const missing =
      params.missingData && params.missingData.length > 0
        ? `\nНе хватило данных: ${params.missingData.join(', ')}`
        : '';
    const sourceLine =
      params.groupTitle && params.groupTitle.trim().length > 0
        ? `Группа / канал: ${params.groupTitle.trim()}\n`
        : `Источник (chatId): ${params.chatId}\n`;
    const msg =
      `Ошибка обработки сигнала из группы\n` +
      sourceLine +
      `Токен: ${params.token}\n` +
      `Этап: ${stageText}\n` +
      `Причина: ${params.error}${missing}\n\n` +
      `ingestId: ${params.ingestId}`;

    for (const uid of ids) {
      try {
        await this.vkApi.sendMessage({ peerId: uid, message: msg });
      } catch (e) {
        this.logger.warn(`VK mirror failure -> ${uid}: ${String(e)}`);
      }
    }
  }

  async mirrorNotifyUserbotResultWithoutEntry(params: {
    ingestId: string;
    chatId: string;
    groupTitle?: string;
    pair: string;
    signalId: string;
    resultMessageText: string;
    quotedSnippet?: string;
  }): Promise<void> {
    if (!(await this.tokenOk())) return;
    const ids = await this.whitelistIds();
    if (ids.length === 0) return;

    const pair = (params.pair ?? '').trim().toUpperCase();
    const sourceLine =
      params.groupTitle && params.groupTitle.trim().length > 0
        ? `Группа / канал: ${params.groupTitle.trim()}\n`
        : `Источник (chatId): ${String(params.chatId)}\n`;
    const resultBody = (params.resultMessageText ?? '').trim() || '—';
    const quoteBody = (params.quotedSnippet ?? '').trim();
    const quoteBlock =
      quoteBody.length > 0 ? `\n\nЦитата из группы:\n${quoteBody}\n` : '\n';
    const msg =
      `Возможно ваш ордер для монеты ${pair} не актуален\n` +
      sourceLine +
      `\nПолучен результат:\n${resultBody}` +
      quoteBlock +
      `\nА вход так и не был осуществлен по сделке (${params.signalId})\n\n` +
      `ingestId: ${params.ingestId}`;

    const kb = this.staleCancelKb(params.signalId);
    for (const uid of ids) {
      try {
        await this.vkApi.sendMessage({ peerId: uid, message: msg, keyboard: kb });
      } catch (e) {
        this.logger.warn(`VK mirror result w/o entry -> ${uid}: ${String(e)}`);
      }
    }
  }

  async mirrorNotifyApiTradeCancelled(params: {
    signalId: string;
    pair: string;
    direction: string;
    entries: number[];
    entryIsRange?: boolean;
    stopLoss: number;
    takeProfits: number[];
    leverage: number;
    orderUsd: number;
    capitalPercent: number;
    source?: string | null;
    reason?: string;
  }): Promise<void> {
    const raw = (await this.settings.get('TELEGRAM_NOTIFY_API_TRADE_CANCELLED'))
      ?.trim()
      .toLowerCase();
    const explicitlyOff =
      raw === 'false' || raw === '0' || raw === 'no' || raw === 'off';
    if (explicitlyOff) return;
    if (!(await this.tokenOk())) return;
    const ids = await this.whitelistIds();
    if (ids.length === 0) return;

    const entryLine =
      params.entries.length > 0
        ? vkFormatEntryLineText({
            entryPrices: params.entries,
            entryIsRange: params.entryIsRange,
          })
        : '—';
    const size =
      params.capitalPercent > 0
        ? `${params.capitalPercent}% от депозита`
        : `$${params.orderUsd} USDT`;
    const reasonLine = params.reason ? `\nПричина: ${params.reason}` : '';
    const msg =
      `Сделка отменена\n` +
      `Пара: ${(params.pair ?? '').trim().toUpperCase()}\n` +
      `ID сделки: ${params.signalId}\n` +
      `Направление: ${(params.direction ?? '').trim().toUpperCase()}\n` +
      `${entryLine}\n` +
      `Stop Loss: ${params.stopLoss}\n` +
      `Take Profit: ${params.takeProfits.length > 0 ? params.takeProfits.join(', ') : '—'}\n` +
      `Плечо: ${params.leverage}x\n` +
      `Размер: ${size}\n` +
      `Источник: ${params.source?.trim() || '—'}${reasonLine}`;

    for (const uid of ids) {
      try {
        await this.vkApi.sendMessage({ peerId: uid, message: msg });
      } catch (e) {
        this.logger.warn(`VK mirror trade cancelled -> ${uid}: ${String(e)}`);
      }
    }
  }
}
