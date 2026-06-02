import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import type { ActiveSignalLookup } from '../telegram-userbot.types';
import { TelegramUserbotClientService } from '../client/telegram-userbot-client.service';
import { TelegramUserbotSettingsService } from '../settings/telegram-userbot-settings.service';
import { extractReplyToMessageId, readString } from '../utils/telegram-userbot-parse.util';

@Injectable()
export class TelegramUserbotIngestSignalLookupService {
  private readonly logger = new Logger(TelegramUserbotIngestSignalLookupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
    private readonly userbotClient: TelegramUserbotClientService,
    private readonly userbotSettings: TelegramUserbotSettingsService,
  ) {}

  private async getCurrentUserClient(): Promise<TelegramClient | null> {
    return this.userbotClient.getCurrentUserClient();
  }

  private async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    return this.userbotClient.isClientAuthorized(client);
  }

  private async resolvedCabinetScopeWhere(): Promise<{ cabinetId: string }> {
    const fromCtx = this.cabinetContext.getCabinetId();
    if (fromCtx) {
      return { cabinetId: fromCtx };
    }
    return { cabinetId: await this.cabinets.getDefaultCabinetId() };
  }

  async fetchChatMessageMeta(
    chatId: string,
    messageId: string,
  ): Promise<{ text?: string; replyToMessageId?: string; error?: string }> {
    const client = await this.getCurrentUserClient();
    if (!client || !(await this.isClientAuthorized(client))) {
      return { error: 'telegram_client_unavailable' };
    }
    try {
      const list = (await client.getMessages(chatId, {
        ids: [Number(messageId)],
        limit: 1,
      })) as unknown as Array<Record<string, unknown>>;
      const msg = list[0];
      return {
        text: readString(msg?.message),
        replyToMessageId: extractReplyToMessageId(
          msg?.replyTo ?? msg?.reply_to ?? msg?.replyToMsgId ?? msg?.reply_to_msg_id,
        ),
      };
    } catch (e) {
      const err = formatError(e);
      this.logger.warn(
        `fetchChatMessageMeta failed chat=${chatId} msg=${messageId}: ${err}`,
      );
      return { error: err };
    }
  }

  async fetchChatMessageText(chatId: string, messageId: string): Promise<string | undefined> {
    const meta = await this.fetchChatMessageMeta(chatId, messageId);
    return meta.text;
  }

  async findActiveSignalForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<ActiveSignalLookup | null> {
    const wantPair = normalizeTradingPair(pair);
    const scope = await this.resolvedCabinetScopeWhere();
    const rows = await this.prisma.signal.findMany({
      where: {
        ...scope,
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
        direction,
      },
      select: {
        id: true,
        cabinetId: true,
        pair: true,
        direction: true,
        entries: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
        sourceChatId: true,
        sourceMessageId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const hit = rows.find((row) => normalizeTradingPair(row.pair) === wantPair);
    return (hit ?? null) as ActiveSignalLookup | null;
  }

  /** Активные сигналы из группы по паре (для result без цитаты). */
  async findActiveSignalsForChatAndPair(
    chatId: string,
    pair: string,
  ): Promise<ActiveSignalLookup[]> {
    const wantPair = normalizeTradingPair(pair);
    const scope = await this.resolvedCabinetScopeWhere();
    const rows = await this.prisma.signal.findMany({
      where: {
        ...scope,
        deletedAt: null,
        sourceChatId: chatId.trim(),
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
      select: {
        id: true,
        cabinetId: true,
        pair: true,
        direction: true,
        entries: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
        sourceChatId: true,
        sourceMessageId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => normalizeTradingPair(row.pair) === wantPair) as ActiveSignalLookup[];
  }

  async resolveSourcePriorityForSignal(signal: {
    source: string | null;
    sourceChatId: string | null;
  }): Promise<{ priority: number; sourceName: string | null }> {
    const sourceName = signal.source?.trim() || null;
    const chatId = signal.sourceChatId?.trim() || null;
    if (!chatId) {
      return { priority: 0, sourceName };
    }
    const chat = await this.userbotSettings.getScopedChatMeta(chatId);
    return {
      priority: this.userbotSettings.normalizeSourcePriority(chat?.sourcePriority),
      sourceName: chat?.title || sourceName || chatId,
    };
  }

  async findActiveSignalFromReply(params: {
    chatId: string;
    replyToMessageId?: string;
    signalExternalId?: string;
    flowLabel: 'Close' | 'Reentry' | 'Result';
  }): Promise<
    | {
        ok: true;
        signal: ActiveSignalLookup;
        rootSource: {
          messageId: string;
          chain: string[];
          matchedSignalMessageIds: string[];
          stopReason: string;
        };
      }
    | { ok: false; error: string }
  > {
    const replyToMessageId = params.replyToMessageId?.trim() || undefined;
    const signalExternalId = params.signalExternalId?.trim() || undefined;
    if (!replyToMessageId && !signalExternalId) {
      return {
        ok: false,
        error: 'Нужна цитата исходного сигнала или SIGNAL ID',
      };
    }
    if (!replyToMessageId && signalExternalId) {
      const signal = await this.findActiveSignalByExternalId(params.chatId, signalExternalId);
      if (signal) {
        return {
          ok: true,
          signal,
          rootSource: {
            messageId: signal.sourceMessageId ?? '',
            chain: [],
            matchedSignalMessageIds: [],
            stopReason: 'resolved_by_signal_external_id',
          },
        };
      }
      return {
        ok: false,
        error: `Для SIGNAL ID ${signalExternalId} активный сигнал не найден`,
      };
    }
    const rootSource = await this.resolveRootSignalSourceMessageId(
      params.chatId,
      replyToMessageId!,
    );
    const scope = await this.resolvedCabinetScopeWhere();
    const signal = await this.prisma.signal.findFirst({
      where: {
        ...scope,
        deletedAt: null,
        sourceChatId: params.chatId,
        sourceMessageId: rootSource.messageId,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cabinetId: true,
        pair: true,
        direction: true,
        entries: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
        sourceChatId: true,
        sourceMessageId: true,
      },
    });
    if (!signal) {
      if (signalExternalId) {
        const signalByExternalId = await this.findActiveSignalByExternalId(
          params.chatId,
          signalExternalId,
        );
        if (signalByExternalId) {
          return {
            ok: true,
            signal: signalByExternalId,
            rootSource: {
              messageId: signalByExternalId.sourceMessageId ?? rootSource.messageId,
              chain: rootSource.chain,
              matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
              stopReason: `${rootSource.stopReason};fallback_signal_external_id`,
            },
          };
        }
      }
      const lookup = await this.collectSignalLookupDiagnostics(
        params.chatId,
        rootSource.messageId,
        rootSource.chain,
      );
      void this.appLog.append(
        'warn',
        'telegram',
        `${params.flowLabel}: active signal not found for resolved root`,
        {
          sourceChatId: params.chatId,
          quotedMessageId: replyToMessageId,
          signalExternalId: signalExternalId ?? null,
          rootSourceMessageId: rootSource.messageId,
          rootResolution: {
            chain: rootSource.chain,
            matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
            stopReason: rootSource.stopReason,
          },
          lookup,
        },
      );
      return {
        ok: false,
        error: `Для цитаты ${params.chatId}:${replyToMessageId} активный сигнал не найден (root: ${rootSource.messageId})`,
      };
    }
    return { ok: true, signal, rootSource };
  }

  private async findActiveSignalByExternalId(
    chatId: string,
    signalExternalId: string,
  ): Promise<ActiveSignalLookup | null> {
    const scope = await this.resolvedCabinetScopeWhere();
    const row = await (this.prisma as any).signal.findFirst({
      where: {
        ...scope,
        deletedAt: null,
        sourceChatId: chatId,
        signalExternalId,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cabinetId: true,
        pair: true,
        direction: true,
        entries: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
        sourceChatId: true,
        sourceMessageId: true,
        signalExternalId: true,
      },
    });
    return (row ?? null) as ActiveSignalLookup | null;
  }

  async resolveRootSignalSourceMessageId(
    chatId: string,
    messageId: string,
  ): Promise<{
    messageId: string;
    chain: string[];
    matchedSignalMessageIds: string[];
    stopReason: string;
  }> {
    const startId = messageId.trim();
    if (!startId) {
      return {
        messageId,
        chain: [],
        matchedSignalMessageIds: [],
        stopReason: 'empty_start_id',
      };
    }

    const visited = new Set<string>();
    const chain: string[] = [];
    const matchedSignalMessageIds: string[] = [];
    let currentId: string | undefined = startId;
    let oldestMatchedId: string | undefined;
    let stopReason = 'chain_end';

    for (let depth = 0; depth < 20 && currentId; depth += 1) {
      if (visited.has(currentId)) {
        stopReason = 'cycle_detected';
        break;
      }
      visited.add(currentId);
      chain.push(currentId);

      const hasSignal = await this.hasAnySignalForSourceMessage(chatId, currentId);
      if (hasSignal) {
        oldestMatchedId = currentId;
        matchedSignalMessageIds.push(currentId);
      }

      const meta = await this.fetchChatMessageMeta(chatId, currentId);
      if (meta.error) {
        stopReason = `fetch_failed:${meta.error}`;
        break;
      }
      const nextId = meta.replyToMessageId?.trim();
      if (!nextId) {
        stopReason = 'chain_end';
        break;
      }
      currentId = nextId;
    }

    if (chain.length >= 20 && currentId) {
      stopReason = 'depth_limit_reached';
    }

    return {
      messageId: oldestMatchedId ?? startId,
      chain,
      matchedSignalMessageIds,
      stopReason,
    };
  }

  private async hasAnySignalForSourceMessage(
    chatId: string,
    messageId: string,
  ): Promise<boolean> {
    const scope = await this.resolvedCabinetScopeWhere();
    const count = await this.prisma.signal.count({
      where: {
        ...scope,
        sourceChatId: chatId,
        sourceMessageId: messageId,
      },
    });
    return count > 0;
  }

  private async collectSignalLookupDiagnostics(
    chatId: string,
    rootSourceMessageId: string,
    chain: string[],
  ): Promise<{
    rootAnyCount: number;
    rootActiveCount: number;
    rootStatuses: string[];
    chainMatches: Array<{ messageId: string; total: number; active: number; statuses: string[] }>;
  }> {
    const scope = await this.resolvedCabinetScopeWhere();
    const rootSignals = await this.prisma.signal.findMany({
      where: {
        ...scope,
        sourceChatId: chatId,
        sourceMessageId: rootSourceMessageId,
      },
      select: {
        id: true,
        status: true,
        deletedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const chainUnique = Array.from(new Set(chain)).slice(0, 20);
    const chainRows = await Promise.all(
      chainUnique.map(async (messageId) => {
        const rows = await this.prisma.signal.findMany({
          where: {
            ...scope,
            sourceChatId: chatId,
            sourceMessageId: messageId,
          },
          select: {
            status: true,
            deletedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const active = rows.filter(
          (row) =>
            row.deletedAt == null && ['ORDERS_PLACED', 'OPEN', 'PARSED'].includes(row.status),
        ).length;
        return {
          messageId,
          total: rows.length,
          active,
          statuses: rows.map((row) => row.status),
        };
      }),
    );

    const rootActive = rootSignals.filter(
      (row) =>
        row.deletedAt == null && ['ORDERS_PLACED', 'OPEN', 'PARSED'].includes(row.status),
    ).length;

    return {
      rootAnyCount: rootSignals.length,
      rootActiveCount: rootActive,
      rootStatuses: rootSignals.map((row) => row.status),
      chainMatches: chainRows.filter((row) => row.total > 0),
    };
  }
}
