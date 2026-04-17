/**
 * VK-бот: параллельная копия сценариев telegram.service.ts (без правок Telegram).
 * При изменении логики в Telegram — синхронизировать вручную.
 */
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import type { SignalDto } from '@repo/shared';

import type { Order, Signal } from '@prisma/client';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { SettingsService } from '../settings/settings.service';
import {
  mergePartialSignals,
  sanitizeSignalSource,
} from '../transcript/partial-signal.util';
/** До Bybit/Orders: иначе orders → … → vk раньше transcript и TranscriptService в DI = undefined. */
import { TranscriptService } from '../transcript/transcript.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';

import {
  vkFormatExternalSignalTable,
  vkFormatPartialPreview,
  vkFormatRuDate,
  vkFormatSignalTable,
  vkFormatTradeDetailPlain,
  vkFormatTradesListPlain,
  vkSplitMessage,
} from './vk-bot-format.util';
import { VkApiClient } from './vk-api.client';
import { vkInlineKeyboard, vkPayload } from './vk-keyboard.util';

type DraftPhase = 'collecting' | 'ready' | 'awaiting_source';

type DraftSession = {
  phase: DraftPhase;
  userTurns: string[];
  signal?: SignalDto;
  partial?: Partial<SignalDto>;
  pendingSources?: string[];
};

type ExternalConfirmationResult = {
  decision: 'confirmed' | 'rejected';
  ok: boolean;
  error?: string;
  signalId?: string;
  bybitOrderIds?: string[];
  actorUserId?: number;
};

type ExternalConfirmationRequest = {
  ingestId: string;
  signal: SignalDto;
  rawMessage?: string;
  createdAt: number;
  onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
};

const DRAFT_TTL_MS = 45 * 60_000;
const EXTERNAL_CONFIRM_TTL_MS = 20 * 60_000;

@Injectable()
export class VkBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VkBotService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly drafts = new Map<number, DraftSession>();
  private readonly sourceOverrideByUser = new Map<number, string>();
  private readonly vkExternalConfirmations = new Map<string, ExternalConfirmationRequest>();

  constructor(
    private readonly settings: SettingsService,
    private readonly transcript: TranscriptService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly prisma: PrismaService,
    private readonly vkApi: VkApiClient,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = (await this.settings.get('VK_GROUP_ACCESS_TOKEN'))?.trim();
    if (!token) {
      this.logger.warn('VK_GROUP_ACCESS_TOKEN not set — VK callback обрабатывается, рассылка отключена');
    }
    this.startCleanupLoop();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private startCleanupLoop(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      try {
        const now = Date.now();
        const maxDrafts = 500;
        if (this.drafts.size > maxDrafts) {
          const excess = this.drafts.size - maxDrafts;
          const keys = Array.from(this.drafts.keys()).slice(0, excess);
          for (const k of keys) this.drafts.delete(k);
        }
        if (this.sourceOverrideByUser.size > maxDrafts) {
          const excess = this.sourceOverrideByUser.size - maxDrafts;
          const keys = Array.from(this.sourceOverrideByUser.keys()).slice(0, excess);
          for (const k of keys) this.sourceOverrideByUser.delete(k);
        }
        let removed = 0;
        for (const [id, req] of this.vkExternalConfirmations.entries()) {
          if (now - (req.createdAt ?? 0) > EXTERNAL_CONFIRM_TTL_MS) {
            this.vkExternalConfirmations.delete(id);
            removed += 1;
          }
        }
        if (removed > 0) {
          this.logger.log(`VkBotService: cleaned vkExternalConfirmations=${removed}`);
        }
      } catch (e) {
        this.logger.warn(`VkBotService cleanup: ${formatError(e)}`);
      }
    }, 60_000);
  }

  async getConfirmationCode(): Promise<string | undefined> {
    return this.settings.get('VK_CALLBACK_CONFIRMATION');
  }

  async getExpectedSecret(): Promise<string | undefined> {
    return this.settings.get('VK_CALLBACK_SECRET');
  }

  async vkEnabled(): Promise<boolean> {
    const t = (await this.settings.get('VK_GROUP_ACCESS_TOKEN'))?.trim();
    return Boolean(t);
  }

  private async getWhitelistVkUserIds(): Promise<number[]> {
    const raw =
      (await this.settings.get('VK_WHITELIST')) ?? process.env.VK_WHITELIST;
    if (!raw?.trim()) return [];
    return raw
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }

  private async isAllowedVk(userId: number): Promise<boolean> {
    const ids = await this.getWhitelistVkUserIds();
    return ids.includes(userId);
  }

  private async getResolvedDefaultOrderUsd(): Promise<number> {
    const d = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(d?.totalUsd);
  }

  private async buildVkTranscriptOverrides(userId: number) {
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    return { defaultOrderUsd };
  }

  private async resolveSourceForUser(
    userId: number,
    llmSource: string | undefined,
  ): Promise<string | undefined> {
    const o = this.sourceOverrideByUser.get(userId)?.trim();
    if (o) return o;
    const fromSettings = (await this.settings.get('SIGNAL_SOURCE'))?.trim();
    if (fromSettings) return fromSettings;
    return sanitizeSignalSource(llmSource);
  }

  private async applySourceToSignal(userId: number, signal: SignalDto): Promise<void> {
    const resolved = await this.resolveSourceForUser(userId, signal.source);
    if (resolved) {
      signal.source = resolved;
    } else {
      delete signal.source;
    }
  }

  private async getDistinctSources(): Promise<string[]> {
    const rows = await this.prisma.signal.findMany({
      where: { source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => r.source!).filter(Boolean);
  }

  private confirmKeyboardVk(): string {
    return vkInlineKeyboard([
      [
        {
          action: {
            type: 'callback',
            label: '✅ Подтвердить',
            payload: vkPayload({ a: 'sig_confirm' }),
          },
          color: 'positive',
        },
        {
          action: {
            type: 'callback',
            label: '❌ Отмена',
            payload: vkPayload({ a: 'sig_cancel' }),
          },
          color: 'negative',
        },
      ],
    ]);
  }

  private cancelOnlyKeyboardVk(): string {
    return vkInlineKeyboard([
      [
        {
          action: {
            type: 'callback',
            label: '❌ Отмена',
            payload: vkPayload({ a: 'sig_cancel' }),
          },
          color: 'negative',
        },
      ],
    ]);
  }

  private externalConfirmKeyboardVk(ingestId: string): string {
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

  private staleCancelKeyboardVk(signalId: string): string {
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

  private sourceSelectionKeyboardVk(sources: string[]): string {
    const rows: Parameters<typeof vkInlineKeyboard>[0] = sources.map((s, i) => [
      {
        action: {
          type: 'callback',
          label: s.slice(0, 40),
          payload: vkPayload({ a: 'sp', n: String(i) }),
        },
      },
    ]);
    rows.push([
      {
        action: {
          type: 'callback',
          label: '➡️ Без источника',
          payload: vkPayload({ a: 'sn' }),
        },
      },
    ]);
    rows.push([
      {
        action: {
          type: 'callback',
          label: '❌ Отмена',
          payload: vkPayload({ a: 'sig_cancel' }),
        },
        color: 'negative',
      },
    ]);
    return vkInlineKeyboard(rows);
  }

  private menuKeyboardVk(): string {
    return vkInlineKeyboard([
      [
        { action: { type: 'callback', label: 'Сводка', payload: vkPayload({ a: 'menu', m: 'sum' }) } },
        { action: { type: 'callback', label: 'Рейтинги', payload: vkPayload({ a: 'menu', m: 'rate' }) } },
      ],
      [
        { action: { type: 'callback', label: 'Сделки', payload: vkPayload({ a: 'menu', m: 'tr' }) } },
        { action: { type: 'callback', label: 'Диагностика', payload: vkPayload({ a: 'menu', m: 'diag' }) } },
        { action: { type: 'callback', label: 'Логи', payload: vkPayload({ a: 'menu', m: 'log' }) } },
      ],
    ]);
  }

  private refreshSummaryKeyboardVk(): string {
    return vkInlineKeyboard([
      [
        {
          action: { type: 'callback', label: 'Обновить сводку', payload: vkPayload({ a: 'mrs' }) },
        },
      ],
    ]);
  }

  private tradesNumberKeyboardVk(items: Array<{ id: string }>): string {
    const row: Parameters<typeof vkInlineKeyboard>[0][number] = [];
    for (let i = 0; i < items.length; i++) {
      row.push({
        action: {
          type: 'callback',
          label: String(i + 1),
          payload: vkPayload({ a: 'td', s: items[i]!.id }),
        },
      });
    }
    const grid: Parameters<typeof vkInlineKeyboard>[0] = [];
    for (let i = 0; i < row.length; i += 5) {
      grid.push(row.slice(i, i + 5));
    }
    return vkInlineKeyboard(grid);
  }

  /** Регистрация подтверждения userbot для VK (вызывается из VkNotifyMirrorService). */
  registerVkExternalConfirmation(req: ExternalConfirmationRequest): void {
    this.vkExternalConfirmations.set(req.ingestId, req);
  }

  unregisterVkExternalConfirmation(ingestId: string): void {
    this.vkExternalConfirmations.delete(ingestId);
  }

  private async sendPeer(peerId: number, text: string, keyboard?: string): Promise<void> {
    if (!(await this.vkEnabled())) return;
    const parts = vkSplitMessage(text, 3900);
    for (let i = 0; i < parts.length; i++) {
      const kb = i === parts.length - 1 ? keyboard : undefined;
      await this.vkApi.sendMessage({ peerId, message: parts[i]!, keyboard: kb });
    }
  }

  async handleCallbackEvent(body: Record<string, unknown>): Promise<void> {
    const t = body.type;
    if (t === 'message_new') {
      const obj = body.object as Record<string, unknown>;
      const msg = (obj?.message as Record<string, unknown>) ?? obj;
      await this.handleVkMessageNew(msg);
    } else if (t === 'message_event') {
      const obj = body.object as Record<string, unknown>;
      await this.handleVkMessageEvent(obj);
    }
  }

  private async handleVkMessageNew(msg: Record<string, unknown>): Promise<void> {
    const fromId = Number(msg.from_id);
    if (!Number.isFinite(fromId) || fromId <= 0) {
      return;
    }
    const peerId = Number(msg.peer_id ?? fromId);
    if (!(await this.isAllowedVk(fromId))) {
      this.logger.warn(`VK: доступ запрещён userId=${fromId}`);
      await this.sendPeer(peerId, 'Доступ запрещён.');
      return;
    }

    this.logger.log(`VK inbound: from_id=${fromId} peer_id=${peerId}`);

    if (msg.payload) {
      try {
        const pl =
          typeof msg.payload === 'string'
            ? (JSON.parse(msg.payload) as Record<string, string>)
            : (msg.payload as Record<string, string>);
        if (pl?.command === 'start' || pl?.a === 'start') {
          await this.sendStartHelp(peerId);
          return;
        }
      } catch {
        // ignore
      }
    }

    const attachments = (msg.attachments as unknown[]) ?? [];
    for (const att of attachments) {
      const a = att as Record<string, unknown>;
      if (a.type === 'photo') {
        const url = this.extractPhotoUrl(a.photo as Record<string, unknown>);
        if (url) {
          await this.handleVkPhoto(fromId, peerId, url);
          return;
        }
      }
      if (a.type === 'audio_message') {
        const link = (a.audio_message as Record<string, unknown>)?.link as string | undefined;
        if (link) {
          await this.handleVkAudio(fromId, peerId, link);
          return;
        }
      }
      if (a.type === 'doc') {
        const doc = a.doc as Record<string, unknown>;
        const type = doc.type;
        if (type === 4) {
          const preview = doc.preview as Record<string, unknown> | undefined;
          const audioMsg = preview?.audio_message as { link?: string } | undefined;
          const url =
            (typeof doc.url === 'string' ? doc.url : undefined) ?? audioMsg?.link;
          if (typeof url === 'string') {
            await this.handleVkAudio(fromId, peerId, url);
            return;
          }
        }
      }
    }

    const text = String(msg.text ?? '').trim();
    if (text) {
      await this.handleVkText(fromId, peerId, text);
    }
  }

  private extractPhotoUrl(photo: Record<string, unknown>): string | undefined {
    const sizes = photo.sizes as Array<{ url?: string; width?: number }> | undefined;
    if (!sizes?.length) return undefined;
    const best = sizes.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
    return best.url;
  }

  private async handleVkPhoto(fromId: number, peerId: number, imageUrl: string): Promise<void> {
    try {
      const buf = await fetch(imageUrl).then((r) => r.arrayBuffer());
      const base64 = Buffer.from(buf).toString('base64');
      const draft = this.drafts.get(fromId);
      const continuation =
        draft?.phase === 'collecting' || draft?.phase === 'ready'
          ? {
              continuationContext: {
                partial:
                  draft.phase === 'ready' && draft.signal
                    ? draft.signal
                    : (draft.partial ?? {}),
                userTurns: draft.userTurns,
              },
            }
          : {};
      const res = await this.transcript.parse(
        'image',
        {
          imageBase64: base64,
          imageMime: 'image/jpeg',
          ...continuation,
        },
        await this.buildVkTranscriptOverrides(fromId),
      );
      await this.handleParseResultVk(fromId, peerId, res, '[photo]');
    } catch (e) {
      await this.sendPeer(peerId, `Ошибка: ${formatError(e)}`);
    }
  }

  private async handleVkAudio(fromId: number, peerId: number, audioUrl: string): Promise<void> {
    try {
      const buf = await fetch(audioUrl).then((r) => r.arrayBuffer());
      const base64 = Buffer.from(buf).toString('base64');
      const draft = this.drafts.get(fromId);
      const continuation =
        draft?.phase === 'collecting' || draft?.phase === 'ready'
          ? {
              continuationContext: {
                partial:
                  draft.phase === 'ready' && draft.signal
                    ? draft.signal
                    : (draft.partial ?? {}),
                userTurns: draft.userTurns,
              },
            }
          : {};
      const res = await this.transcript.parse(
        'audio',
        {
          audioBase64: base64,
          audioMime: 'audio/ogg',
          ...continuation,
        },
        await this.buildVkTranscriptOverrides(fromId),
      );
      await this.handleParseResultVk(fromId, peerId, res, '[voice]');
    } catch (e) {
      await this.sendPeer(peerId, `Ошибка: ${formatError(e)}`);
    }
  }

  private async sendStartHelp(peerId: number): Promise<void> {
    const t =
      'Отправьте сигнал текстом, фото или голосом. Если чего-то не хватает — бот задаст вопросы.\n' +
      'После полного разбора проверьте таблицу, при необходимости пришлите правки текстом, затем «Подтвердить».\n' +
      'Источник: настройки API или команда /source Название.\n' +
      'Сводка, диагностика, логи — кнопки ниже или /stats, /diag, /logs, /events.\n' +
      '/cancel — отменить черновик; /menu — меню.';
    await this.sendPeer(peerId, t, this.menuKeyboardVk());
  }

  private async handleVkText(fromId: number, peerId: number, text: string): Promise<void> {
    try {
      if (text.startsWith('/')) {
        if (text === '/source' || text.startsWith('/source ')) {
          const rest = text.slice('/source'.length).trim();
          if (!rest) {
            const cur =
              this.sourceOverrideByUser.get(fromId)?.trim() ??
              (await this.settings.get('SIGNAL_SOURCE'))?.trim() ??
              '';
            await this.sendPeer(
              peerId,
              cur
                ? `Текущий источник: ${cur}`
                : 'Источник не задан. Укажите в настройках API (SIGNAL_SOURCE) или: /source Binance Killers',
            );
            return;
          }
          if (rest.toLowerCase() === 'off' || rest === '-') {
            this.sourceOverrideByUser.delete(fromId);
            await this.sendPeer(
              peerId,
              'Переопределение источника сброшено (используются настройки API или текст сигнала).',
            );
            return;
          }
          this.sourceOverrideByUser.set(fromId, rest);
          await this.sendPeer(peerId, `Источник для следующих сигналов: ${rest}`);
          return;
        }
        const eventsCmd = text.match(/^\/(events|события)\s+(\S+)/i);
        if (eventsCmd?.[2]) {
          await this.handleMenuSignalEventsVk(peerId, eventsCmd[2]);
          return;
        }
        if (
          text === '/stats' ||
          text === '/сводка' ||
          text === '/balance' ||
          text === '/баланс' ||
          text === '/diag' ||
          text === '/диагностика' ||
          text === '/logs' ||
          text === '/логи' ||
          text === '/help' ||
          text === '/команды'
        ) {
          if (text === '/stats' || text === '/сводка') {
            await this.handleMenuSummaryVk(peerId);
          } else if (text === '/balance' || text === '/баланс') {
            const d = await this.bybit.getUnifiedUsdtBalanceDetails();
            await this.sendPeer(
              peerId,
              d !== undefined && Number.isFinite(d.availableUsd)
                ? `Баланс: ${d.totalUsd.toFixed(2)} USDT\nДоступный баланс: ${d.availableUsd.toFixed(2)} USDT`
                : 'Баланс недоступен (проверьте ключи Bybit).',
            );
          } else if (text === '/diag' || text === '/диагностика') {
            await this.handleMenuDiagnosticsVk(peerId);
          } else if (text === '/logs' || text === '/логи') {
            await this.handleMenuLogsVk(peerId);
          } else {
            await this.sendPeer(
              peerId,
              [
                'Команды:',
                '/menu — меню кнопками',
                '/stats — сводка',
                '/balance — баланс USDT',
                '/diag — диагностика',
                '/logs — лог',
                '/events ID — события по сделке',
                '/source — источник сигнала',
                '/cancel — сброс черновика',
              ].join('\n'),
              this.menuKeyboardVk(),
            );
          }
          return;
        }
        if (text === '/start') {
          await this.sendStartHelp(peerId);
          return;
        }
        if (text === '/menu') {
          await this.sendPeer(peerId, 'Разделы:', this.menuKeyboardVk());
          return;
        }
        if (text === '/cancel') {
          if (this.drafts.delete(fromId)) {
            await this.sendPeer(peerId, 'Черновик отменён.');
          } else {
            await this.sendPeer(peerId, 'Нет активного черновика.');
          }
          return;
        }
        return;
      }

      if (text === 'Сводка') {
        await this.handleMenuSummaryVk(peerId);
        return;
      }
      if (text === 'Рейтинги') {
        await this.handleMenuRatingsVk(peerId);
        return;
      }
      if (text === 'Сделки') {
        await this.handleMenuTradesVk(peerId);
        return;
      }
      if (text === 'Диагностика') {
        await this.handleMenuDiagnosticsVk(peerId);
        return;
      }
      if (text === 'Логи') {
        await this.handleMenuLogsVk(peerId);
        return;
      }

      if (this.drafts.has(fromId)) {
        const draft = this.drafts.get(fromId)!;
        if (draft.phase === 'collecting') {
          const res = await this.transcript.continueSignalDraft(
            draft.partial ?? {},
            draft.userTurns,
            text,
            await this.buildVkTranscriptOverrides(fromId),
          );
          await this.handleParseResultVk(fromId, peerId, res, text);
          return;
        }
        if (draft.phase === 'ready' && draft.signal) {
          const res = await this.transcript.applyCorrection(
            draft.signal,
            text,
            await this.buildVkTranscriptOverrides(fromId),
          );
          await this.handleParseResultVk(fromId, peerId, res, text);
          return;
        }
      }

      const res = await this.transcript.parse(
        'text',
        { text },
        await this.buildVkTranscriptOverrides(fromId),
      );
      await this.handleParseResultVk(fromId, peerId, res, text);
    } catch (e) {
      this.logger.error(`VK text: ${formatError(e)}`);
      await this.sendPeer(peerId, `Ошибка бота: ${formatError(e)}`);
    }
  }

  private async handleVkMessageEvent(obj: Record<string, unknown>): Promise<void> {
    const userId = Number(obj.user_id);
    const peerId = Number(obj.peer_id ?? obj.user_id);
    const eventId = String(obj.event_id ?? '');
    if (!Number.isFinite(userId) || userId <= 0) return;

    if (!(await this.isAllowedVk(userId))) {
      return;
    }

    let payload: Record<string, string> = {};
    try {
      const raw = obj.payload;
      if (typeof raw === 'string' && raw.length > 0) {
        payload = JSON.parse(raw) as Record<string, string>;
      } else if (raw && typeof raw === 'object') {
        payload = raw as Record<string, string>;
      }
    } catch {
      payload = {};
    }

    if (eventId) {
      try {
        await this.vkApi.sendMessageEventAnswer({
          eventId,
          userId,
          peerId,
        });
      } catch {
        // ignore
      }
    }

    const a = payload.a;
    if (a === 'menu') {
      const m = payload.m;
      if (m === 'sum') await this.handleMenuSummaryVk(peerId);
      else if (m === 'rate') await this.handleMenuRatingsVk(peerId);
      else if (m === 'tr') await this.handleMenuTradesVk(peerId);
      else if (m === 'diag') await this.handleMenuDiagnosticsVk(peerId);
      else if (m === 'log') await this.handleMenuLogsVk(peerId);
      return;
    }
    if (a === 'mrs') {
      await this.handleMenuSummaryVk(peerId);
      return;
    }
    if (a === 'sig_confirm') {
      await this.actionSigConfirmVk(userId, peerId);
      return;
    }
    if (a === 'sig_cancel') {
      this.drafts.delete(userId);
      await this.sendPeer(peerId, 'Черновик сигнала отменён.');
      return;
    }
    if (a === 'sp') {
      await this.actionSrcPickVk(userId, peerId, parseInt(payload.n ?? '', 10));
      return;
    }
    if (a === 'sn') {
      await this.actionSrcNoneVk(userId, peerId);
      return;
    }
    if (a === 'ubc' && payload.i) {
      await this.actionUbConfirmVk(userId, peerId, payload.i);
      return;
    }
    if (a === 'ubr' && payload.i) {
      await this.actionUbRejectVk(userId, peerId, payload.i);
      return;
    }
    if (a === 'usc' && payload.s) {
      await this.actionUbStaleCancelVk(userId, peerId, payload.s);
      return;
    }
    if (a === 'td' && payload.s) {
      await this.actionTradeDetailVk(peerId, payload.s);
      return;
    }
    if (a === 'ev' && payload.s) {
      await this.handleMenuSignalEventsVk(peerId, payload.s);
      return;
    }
  }

  private async actionSigConfirmVk(userId: number, peerId: number): Promise<void> {
    const draft = this.drafts.get(userId);
    if (!draft) {
      await this.sendPeer(peerId, 'Нет черновика сигнала.');
      return;
    }
    if (draft.phase !== 'ready' || !draft.signal) {
      await this.sendPeer(peerId, 'Сначала дополните все поля сигнала ответами в чате.');
      return;
    }
    await this.applySourceToSignal(userId, draft.signal);
    const rawCombined = draft.userTurns.join('\n---\n');
    void this.appLog.append('info', 'vk', 'Подтверждение: выставление ордеров', {
      userId,
      pair: draft.signal.pair,
      source: draft.signal.source,
    });
    const place = await this.bybit.placeSignalOrders(draft.signal, rawCombined);
    if (place.ok) {
      this.drafts.delete(userId);
      void this.appLog.append('info', 'vk', 'Ордера выставлены', {
        userId,
        signalId: place.signalId,
        bybitOrderIds: place.bybitOrderIds,
      });
      await this.sendPeer(
        peerId,
        `Ордера выставлены. signalId=${place.signalId ?? ''}\n\nКонтекст сброшен — можно отправить новый сигнал.`,
      );
    } else {
      void this.appLog.append('error', 'vk', 'Ошибка выставления ордеров', {
        userId,
        error: formatError(place.error),
      });
      await this.sendPeer(peerId, `Не удалось выставить ордера: ${formatError(place.error)}`);
    }
  }

  private async actionSrcPickVk(userId: number, peerId: number, idx: number): Promise<void> {
    const draft = this.drafts.get(userId);
    if (draft?.phase !== 'awaiting_source' || !draft.signal) {
      await this.sendPeer(peerId, 'Нет активного черновика.');
      return;
    }
    const chosen = draft.pendingSources?.[idx];
    if (!chosen) {
      await this.sendPeer(peerId, 'Неверный индекс источника.');
      return;
    }
    draft.signal.source = chosen;
    this.drafts.set(userId, { phase: 'ready', signal: draft.signal, userTurns: draft.userTurns });
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    await this.sendPeer(
      peerId,
      vkFormatSignalTable(draft.signal, defaultOrderUsd),
      this.confirmKeyboardVk(),
    );
  }

  private async actionSrcNoneVk(userId: number, peerId: number): Promise<void> {
    const draft = this.drafts.get(userId);
    if (draft?.phase !== 'awaiting_source' || !draft.signal) {
      await this.sendPeer(peerId, 'Нет активного черновика.');
      return;
    }
    delete draft.signal.source;
    this.drafts.set(userId, { phase: 'ready', signal: draft.signal, userTurns: draft.userTurns });
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    await this.sendPeer(
      peerId,
      vkFormatSignalTable(draft.signal, defaultOrderUsd),
      this.confirmKeyboardVk(),
    );
  }

  private async actionUbConfirmVk(userId: number, peerId: number, ingestId: string): Promise<void> {
    const req = this.vkExternalConfirmations.get(ingestId);
    const placed = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { status: true },
    });
    if (placed?.status === 'placed') {
      await this.sendPeer(peerId, 'Сигнал уже был подтверждён ранее.');
      this.vkExternalConfirmations.delete(ingestId);
      return;
    }
    const fallback = await this.confirmFromIngestIdVk(ingestId);
    if (!fallback.ok) {
      await req?.onResult?.({
        decision: 'confirmed',
        ok: false,
        error: fallback.error,
        actorUserId: userId,
      });
      await this.sendPeer(peerId, `Подтверждение не выполнено: ${fallback.error}`);
      return;
    }
    this.vkExternalConfirmations.delete(ingestId);
    await req?.onResult?.({
      decision: 'confirmed',
      ok: true,
      signalId: fallback.signalId,
      bybitOrderIds: fallback.bybitOrderIds,
      actorUserId: userId,
    });
    await this.sendPeer(
      peerId,
      `Сигнал подтверждён. Ордера выставлены. signalId=${fallback.signalId ?? ''}`,
    );
  }

  private async actionUbRejectVk(userId: number, peerId: number, ingestId: string): Promise<void> {
    const req = this.vkExternalConfirmations.get(ingestId);
    this.vkExternalConfirmations.delete(ingestId);
    await req?.onResult?.({
      decision: 'rejected',
      ok: true,
      actorUserId: userId,
    });
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: ingestId },
        data: {
          status: 'cancelled_by_confirmation',
          error: `Отклонено пользователем VK ${userId}`,
        },
      })
      .catch(() => undefined);
    await this.sendPeer(peerId, 'Сигнал отклонён.');
  }

  private async actionUbStaleCancelVk(
    userId: number,
    peerId: number,
    signalId: string,
  ): Promise<void> {
    try {
      const closed = await this.bybit.closeSignalManually(signalId);
      if (closed.ok) {
        void this.appLog.append('info', 'vk', 'Result без входа: отмена по кнопке', {
          userId,
          signalId,
          cancelledOrders: closed.cancelledOrders,
          closedPositions: closed.closedPositions,
        });
        await this.sendPeer(peerId, `Ордера по сделке отменены. signalId=${signalId}`);
      } else {
        const err =
          closed.error ?? closed.details ?? 'Не удалось отменить ордера на Bybit';
        await this.sendPeer(peerId, `Не удалось отменить: ${err}`);
      }
    } catch (e) {
      await this.sendPeer(peerId, `Ошибка: ${formatError(e)}`);
    }
  }

  private tradeCanCancelVk(status: string): boolean {
    return status === 'ORDERS_PLACED' || status === 'OPEN' || status === 'PARSED';
  }

  private async actionTradeDetailVk(peerId: number, signalId: string): Promise<void> {
    const row = await this.orders.getSignalWithOrders(signalId);
    if (!row) {
      await this.sendPeer(peerId, 'Сделка не найдена.');
      return;
    }
    const text = vkFormatTradeDetailPlain(row);
    const rows: Parameters<typeof vkInlineKeyboard>[0] = [];
    if (this.tradeCanCancelVk(row.status)) {
      rows.push([
        {
          action: {
            type: 'callback',
            label: 'Отменить',
            payload: vkPayload({ a: 'usc', s: signalId }),
          },
        },
      ]);
    }
    rows.push([
      {
        action: {
          type: 'callback',
          label: 'События',
          payload: vkPayload({ a: 'ev', s: signalId }),
        },
      },
    ]);
    await this.sendPeer(peerId, text, vkInlineKeyboard(rows));
  }

  private async handleParseResultVk(
    fromId: number,
    peerId: number,
    res: import('@repo/shared').TranscriptResult,
    raw: string | undefined,
  ): Promise<void> {
    if (res.ok === false) {
      void this.appLog.append('warn', 'vk', 'parse / transcript error', {
        userId: fromId,
        error: res.error,
        details: res.details,
      });
      await this.sendPeer(
        peerId,
        `Ошибка: ${res.error}${res.details ? `\n${res.details}` : ''}`,
      );
      return;
    }

    const prev = this.drafts.get(fromId);
    const nextTurns = raw ? [...(prev?.userTurns ?? []), raw] : (prev?.userTurns ?? []);

    if (res.ok === 'incomplete') {
      const merged =
        prev?.phase === 'ready' && prev.signal
          ? mergePartialSignals(prev.signal, res.partial)
          : mergePartialSignals(prev?.partial, res.partial);

      this.drafts.set(fromId, {
        phase: 'collecting',
        partial: merged,
        userTurns: nextTurns,
      });
      void this.appLog.append('info', 'vk', 'черновик: неполный сигнал', {
        userId: fromId,
        missing: res.missing,
        prompt: res.prompt,
      });
      await this.sendPeer(
        peerId,
        `${res.prompt}\n\n${vkFormatPartialPreview(merged)}\n\n` +
          `Ответьте сообщением. /cancel — отменить.`,
        this.cancelOnlyKeyboardVk(),
      );
      return;
    }

    const dup = await this.bybit.wouldDuplicateActivePairDirection(res.signal.pair, res.signal.direction);
    if (dup) {
      void this.appLog.append('warn', 'vk', 'отклонено: дубликат пары и стороны', {
        userId: fromId,
        pair: res.signal.pair,
        direction: res.signal.direction,
      });
      this.drafts.delete(fromId);
      await this.sendPeer(
        peerId,
        `По паре ${res.signal.pair.toUpperCase()} уже есть активный сигнал ${res.signal.direction.toUpperCase()} или открытая позиция/ордера в эту сторону.`,
      );
      return;
    }

    await this.applySourceToSignal(fromId, res.signal);

    if (!res.signal.source) {
      const existingSources = await this.getDistinctSources();
      if (existingSources.length > 0) {
        this.drafts.set(fromId, {
          phase: 'awaiting_source',
          signal: res.signal,
          userTurns: nextTurns,
          pendingSources: existingSources,
        });
        void this.appLog.append('info', 'vk', 'черновик: выбор источника', {
          userId: fromId,
          pair: res.signal.pair,
          sources: existingSources,
        });
        const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
        await this.sendPeer(
          peerId,
          vkFormatSignalTable(res.signal, defaultOrderUsd) +
            '\n\nВыберите источник сигнала или продолжите без него:',
          this.sourceSelectionKeyboardVk(existingSources),
        );
        return;
      }
    }

    this.drafts.set(fromId, {
      phase: 'ready',
      signal: res.signal,
      userTurns: nextTurns,
    });
    void this.appLog.append('info', 'vk', 'черновик готов к подтверждению', {
      userId: fromId,
      pair: res.signal.pair,
      direction: res.signal.direction,
      orderUsd: res.signal.orderUsd,
    });
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    await this.sendPeer(
      peerId,
      vkFormatSignalTable(res.signal, defaultOrderUsd),
      this.confirmKeyboardVk(),
    );
  }

  /** Копия private confirmFromIngestId из telegram.service.ts */
  private async confirmFromIngestIdVk(ingestId: string): Promise<{
    ok: boolean;
    error?: string;
    signalId?: string;
    bybitOrderIds?: string[];
  }> {
    const row = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { text: true, chatId: true, messageId: true },
    });
    const text = row?.text?.trim();
    if (!text) {
      return { ok: false, error: 'Текст сообщения для подтверждения не найден' };
    }
    const [chat, details] = await Promise.all([
      row?.chatId
        ? this.prisma.tgUserbotChat.findFirst({
            where: { chatId: row.chatId },
            select: {
              title: true,
              defaultLeverage: true,
              forcedLeverage: true,
              defaultEntryUsd: true,
            },
          })
        : Promise.resolve(null),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);
    const defaultOrderUsd = await this.settings.resolveDefaultEntryUsd({
      rawOverride: chat?.defaultEntryUsd,
      balanceTotalUsd: details?.totalUsd,
    });
    const leverageDefault =
      chat?.defaultLeverage != null && chat.defaultLeverage >= 1
        ? chat.defaultLeverage
        : undefined;
    const chatForcedLeverage =
      chat?.forcedLeverage != null && chat.forcedLeverage >= 1
        ? chat.forcedLeverage
        : undefined;
    const parsed = await this.transcript.parse(
      'text',
      { text },
      { defaultOrderUsd, leverageDefault, chatForcedLeverage },
    );
    if (parsed.ok !== true) {
      return {
        ok: false,
        error:
          parsed.ok === false ? parsed.error : `Сигнал неполный: ${parsed.prompt}`,
      };
    }
    if (chat?.title) {
      parsed.signal.source = chat.title;
    }
    const place = await this.bybit.placeSignalOrders(parsed.signal, text, {
      chatId: row?.chatId ?? undefined,
      messageId: row?.messageId ?? undefined,
    });
    if (!place.ok) {
      return { ok: false, error: formatError(place.error) };
    }
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: ingestId },
        data: { status: 'placed', error: null },
      })
      .catch(() => undefined);
    return {
      ok: true,
      signalId: place.signalId,
      bybitOrderIds: place.bybitOrderIds,
    };
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private todayDateKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'true';
  }

  private async handleMenuSummaryVk(peerId: number): Promise<void> {
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    const balStr =
      details !== undefined && Number.isFinite(details.availableUsd)
        ? `баланс ${details.totalUsd.toFixed(2)} · доступный ${details.availableUsd.toFixed(2)} USDT`
        : '—';
    const stats = await this.orders.getDashboardStats();
    const pnlDay = await this.orders.getPnlSeries('day');
    const todayKey = this.todayDateKey();
    const todayRow = pnlDay.find((p) => p.date === todayKey);
    const todayPnlStr = todayRow !== undefined ? todayRow.pnl.toFixed(2) : '—';
    const top = await this.orders.getTopSources({ limit: 5 });
    const best = top.bestWinrate;
    const worst = top.worstWinrate;
    let lines =
      `📊 Сводка\n` +
      `USDT (Bybit): ${balStr}\n` +
      `PnL сегодня: ${todayPnlStr}\n` +
      `Winrate: ${stats.winrate.toFixed(1)}%\n` +
      `Σ PnL: ${stats.totalPnl.toFixed(2)}\n` +
      `Закрыто: ${stats.totalClosed} (W ${stats.wins} / L ${stats.losses})\n` +
      `Открытые сигналы: ${stats.openSignals}`;
    if (best) {
      lines += `\n\n▲ Лучший WR: ${best.source ?? '—'} — ${best.winrate.toFixed(1)}% · W/L ${best.wL}`;
    }
    if (worst) {
      lines += `\n▼ Худший WR: ${worst.source ?? '—'} — ${worst.winrate.toFixed(1)}% · W/L ${worst.wL}`;
    }
    await this.sendPeer(peerId, lines, this.refreshSummaryKeyboardVk());
  }

  private async handleMenuRatingsVk(peerId: number): Promise<void> {
    const top = await this.orders.getTopSources({ limit: 5 });
    await this.sendPeer(peerId, '⭐ Рейтинги (топ-5 в каждом блоке)');
    const blocks: [string, string, typeof top.byPnl][] = [
      ['💰', 'Топ по PnL', top.byPnl],
      ['📈', 'Топ по Winrate', top.byWinrate],
      ['📉', 'Худший PnL', top.byWorstPnl],
      ['⚠️', 'Худший Winrate', top.byWorstWinrate],
    ];
    for (const [emoji, title, rows] of blocks) {
      let body = `${emoji} ${title}\n`;
      if (rows.length === 0) {
        body += 'нет данных';
      } else {
        body += rows
          .map(
            (r, i) =>
              `${i + 1}. ${r.source ?? '—'}\nPnL ${r.totalPnl.toFixed(2)} · WR ${r.winrate.toFixed(1)}% · W/L ${r.wL}`,
          )
          .join('\n\n');
      }
      await this.sendPeer(peerId, body);
    }
  }

  private async handleMenuTradesVk(peerId: number): Promise<void> {
    const { items } = await this.orders.listTrades({ page: 1, pageSize: 20 });
    if (items.length === 0) {
      await this.sendPeer(peerId, 'Сделок пока нет.');
      return;
    }
    const ordered = [...items].reverse();
    await this.sendPeer(peerId, vkFormatTradesListPlain(ordered));
    await this.sendPeer(
      peerId,
      'Открыть карточку — номер как в списке (1 — верхний).',
      this.tradesNumberKeyboardVk(ordered),
    );
  }

  private async handleMenuDiagnosticsVk(peerId: number): Promise<void> {
    const [
      userbotEnabled,
      apiId,
      apiHash,
      session,
      chatsTotal,
      chatsEnabled,
      minBalRaw,
    ] = await Promise.all([
      this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
      this.settings.get('TELEGRAM_USERBOT_API_ID'),
      this.settings.get('TELEGRAM_USERBOT_API_HASH'),
      this.settings.get('TELEGRAM_USERBOT_SESSION'),
      this.prisma.tgUserbotChat.count(),
      this.prisma.tgUserbotChat.count({ where: { enabled: true } }),
      this.settings.get('TELEGRAM_USERBOT_MIN_BALANCE_USD'),
    ]);
    const start = this.startOfToday();
    const [ingestTotal, ingestSignal, ingestPlaced, parseIncomplete, parseError] =
      await Promise.all([
        this.prisma.tgUserbotIngest.count({ where: { createdAt: { gte: start } } }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, classification: 'signal' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'placed' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_incomplete' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_error' },
        }),
      ]);
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    const balance = details?.availableUsd;
    const totalBal = details?.totalUsd;
    const minBal = Number(minBalRaw ?? '3');
    const paused =
      balance !== undefined &&
      Number.isFinite(balance) &&
      Number.isFinite(minBal) &&
      balance < minBal;
    let live: { bybitConnected: boolean; items: unknown[] };
    try {
      live = await this.bybit.getLiveExposureSnapshot();
    } catch {
      live = { bybitConnected: false, items: [] };
    }
    const openDb = await this.prisma.signal.count({
      where: {
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
    });
    const text =
      `🔧 Диагностика\n` +
      `Userbot: ${userbotEnabled ? 'да' : 'нет'}\n` +
      `Креды: ID ${apiId?.trim() ? '✓' : '✗'} Hash ${apiHash?.trim() ? '✓' : '✗'} сессия ${session?.trim() ? '✓' : '✗'}\n` +
      `Чаты: ${chatsEnabled} вкл / ${chatsTotal} всего\n` +
      `Ingest сегодня: всего ${ingestTotal}, сигнал ${ingestSignal}, placed ${ingestPlaced}\n` +
      `parse_incomplete ${parseIncomplete} · parse_error ${parseError}\n` +
      `Баланс: ${totalBal?.toFixed(2) ?? '—'} · доступный ${balance?.toFixed(2) ?? '—'}\n` +
      `Порог ${minBal} · пауза: ${paused ? 'да' : 'нет'}\n` +
      `Bybit: ${live.bybitConnected ? 'ок' : 'нет'} · откр. в БД ${openDb} · экспозиция ${live.items.length}`;
    await this.sendPeer(peerId, text);
  }

  private async handleMenuLogsVk(peerId: number): Promise<void> {
    const rows = await this.appLog.list({ limit: 12, category: 'all' });
    if (rows.length === 0) {
      await this.sendPeer(peerId, 'В логе пока нет записей.');
      return;
    }
    const blocks = rows.map((r) => {
      const msg = r.message.replace(/\s+/g, ' ').slice(0, 320);
      const when = vkFormatRuDate(new Date(r.createdAt));
      return `${r.level} · ${r.category}\n${when}\n${msg}`;
    });
    await this.sendPeer(
      peerId,
      `Журнал · ${rows.length} записей\n\n` + blocks.join('\n\n────────\n\n'),
    );
  }

  private async handleMenuSignalEventsVk(peerId: number, signalId: string): Promise<void> {
    const sid = signalId.trim();
    if (!sid) {
      await this.sendPeer(peerId, 'Укажите ID сделки: /events signalId');
      return;
    }
    const exists = await this.prisma.signal.findFirst({
      where: { id: sid, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      await this.sendPeer(peerId, 'Сделка не найдена.');
      return;
    }
    const ev = await this.prisma.signalEvent.findMany({
      where: { signalId: sid },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (ev.length === 0) {
      await this.sendPeer(peerId, `Событий нет.\n${sid}`);
      return;
    }
    const lines = ev.map((e) => {
      const payload = e.payload ? e.payload.slice(0, 480) : '—';
      return `${e.type}\n${vkFormatRuDate(e.createdAt)}\n${payload}`;
    });
    await this.sendPeer(peerId, `События сделки ${sid}\n\n` + lines.join('\n\n────────\n\n'));
  }
}
