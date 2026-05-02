import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { BybitService } from '../../bybit/bybit.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import {
  parseLeverageRangeMode,
} from '../../settings/leverage-policy.util';
import {
  parseSourceTpSlStepMap,
  parseSourceTpSlStepRangeMap,
  parseTpSlStepStart,
  type SourceTpSlStepMap,
  type SourceTpSlStepRangeMap,
  type TpSlStepStartMode,
} from '../../settings/tp-sl-step.util';
import type { TranscriptParseOverrides } from '../../transcript/transcript.types';
import {
  parseSourceMartingaleMap,
  type SourceMartingaleMap,
} from '../telegram-userbot-source.util';

@Injectable()
export class TelegramUserbotSettingsService {
  private readonly logger = new Logger(TelegramUserbotSettingsService.name);
  private static readonly SOURCE_MAP_SKIP_LOG_CAP = 400;
  private readonly sourceTpMapSkipLogged = new Set<string>();
  private enabledChatsRefresh: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
    private readonly settings: SettingsService,
    private readonly bybit: BybitService,
  ) {}

  /** Вызывается из фасада после init — обновление кэша включённых чатов после `updateChat`. */
  setEnabledChatsRefreshCallback(cb: () => Promise<void>): void {
    this.enabledChatsRefresh = cb;
  }

  normalizeSourcePriority(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.max(0, Math.floor(n));
  }

  async getScopedChatMeta(chatId: string): Promise<{
    title: string | null;
    sourcePriority: number;
  }> {
    const [chat, scoped] = await Promise.all([
      this.prisma.tgUserbotChat.findUnique({
        where: { chatId },
        select: { title: true, sourcePriority: true },
      }),
      this.cabinetContext.getCabinetId()
        ? this.prisma.cabinetTelegramSource.findUnique({
            where: {
              cabinetId_chatId: {
                cabinetId: this.cabinetContext.getCabinetId()!,
                chatId,
              },
            },
            select: { sourcePriority: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      title: chat?.title?.trim() || null,
      sourcePriority: this.normalizeSourcePriority(
        scoped?.sourcePriority ?? chat?.sourcePriority,
      ),
    };
  }

  async getSourceMartingaleMap(): Promise<SourceMartingaleMap> {
    const raw = await this.settings.get('SOURCE_MARTINGALE_MULTIPLIERS');
    return parseSourceMartingaleMap(raw);
  }

  private takeSourceTpMapSkipLogSlot(
    kind: 'start' | 'range',
    entryKey: string,
    val: unknown,
  ): boolean {
    const sig = `${kind}:${entryKey}:${JSON.stringify(val)}`;
    if (this.sourceTpMapSkipLogged.has(sig)) {
      return false;
    }
    if (
      this.sourceTpMapSkipLogged.size >=
      TelegramUserbotSettingsService.SOURCE_MAP_SKIP_LOG_CAP
    ) {
      this.sourceTpMapSkipLogged.clear();
    }
    this.sourceTpMapSkipLogged.add(sig);
    return true;
  }

  async getSourceTpSlStepMap(): Promise<SourceTpSlStepMap> {
    const raw = await this.settings.get('SOURCE_TP_SL_STEP_START');
    return parseSourceTpSlStepMap(raw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      this.logger.warn(
        `Userbot SOURCE_TP_SL_STEP_START: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
  }

  async getSourceTpSlStepRangeMap(): Promise<SourceTpSlStepRangeMap> {
    const raw = await this.settings.get('SOURCE_TP_SL_STEP_RANGE');
    return parseSourceTpSlStepRangeMap(raw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      this.logger.warn(
        `Userbot SOURCE_TP_SL_STEP_RANGE: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
  }

  async setSourceTpSlStepStart(
    sourceName: string,
    mode: TpSlStepStartMode | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceTpSlStepMap();
    if (mode === null) {
      delete map[source];
    } else {
      map[source] = mode;
    }
    await this.settings.set('SOURCE_TP_SL_STEP_START', JSON.stringify(map));
  }

  async setSourceTpSlStepRange(
    sourceName: string,
    range: number | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceTpSlStepRangeMap();
    if (range === null || !Number.isFinite(range)) {
      delete map[source];
    } else {
      const n = Math.trunc(range);
      if (n < 1 || n > 5) {
        delete map[source];
      } else {
        map[source] = n;
      }
    }
    await this.settings.set('SOURCE_TP_SL_STEP_RANGE', JSON.stringify(map));
  }

  async setSourceMartingaleMultiplier(
    sourceName: string,
    multiplier: number | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceMartingaleMap();
    if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 1) {
      delete map[source];
    } else {
      map[source] = Math.round(multiplier * 1_000_000) / 1_000_000;
    }
    await this.settings.set('SOURCE_MARTINGALE_MULTIPLIERS', JSON.stringify(map));
  }

  async buildTranscriptParseOverrides(chatId: string): Promise<TranscriptParseOverrides> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const [chat, scoped, details] = await Promise.all([
      this.prisma.tgUserbotChat.findUnique({
        where: { chatId },
        select: {
          defaultLeverage: true,
          forcedLeverage: true,
          leverageRangeMode: true,
          minLeverage: true,
          maxLeverage: true,
          defaultEntryUsd: true,
          title: true,
        },
      }),
      cabinetId
        ? this.prisma.cabinetTelegramSource.findUnique({
            where: { cabinetId_chatId: { cabinetId, chatId } },
            select: {
              defaultLeverage: true,
              forcedLeverage: true,
              leverageRangeMode: true,
              minLeverage: true,
              maxLeverage: true,
              defaultEntryUsd: true,
            },
          })
        : Promise.resolve(null),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);
    const defaultOrderUsd = await this.settings.resolveDefaultEntryUsd({
      rawOverride: scoped?.defaultEntryUsd ?? chat?.defaultEntryUsd,
      balanceTotalUsd: details?.totalUsd,
    });
    const leverageDefault =
      scoped?.defaultLeverage != null && scoped.defaultLeverage >= 1
        ? scoped.defaultLeverage
        : chat?.defaultLeverage != null && chat.defaultLeverage >= 1
          ? chat.defaultLeverage
          : undefined;
    return {
      defaultOrderUsd,
      leverageDefault,
      chatForcedLeverage:
        scoped?.forcedLeverage != null && scoped.forcedLeverage >= 1
          ? scoped.forcedLeverage
          : chat?.forcedLeverage != null && chat.forcedLeverage >= 1
            ? chat.forcedLeverage
            : undefined,
      leverageRangeMode:
        scoped?.leverageRangeMode != null
          ? parseLeverageRangeMode(scoped.leverageRangeMode)
          : chat?.leverageRangeMode != null
            ? parseLeverageRangeMode(chat.leverageRangeMode)
            : undefined,
      minAllowedLeverage:
        scoped?.minLeverage != null && scoped.minLeverage >= 1
          ? scoped.minLeverage
          : chat?.minLeverage != null && chat.minLeverage >= 1
            ? chat.minLeverage
            : undefined,
      maxAllowedLeverage:
        scoped?.maxLeverage != null && scoped.maxLeverage >= 1
          ? scoped.maxLeverage
          : chat?.maxLeverage != null && chat.maxLeverage >= 1
            ? chat.maxLeverage
            : undefined,
    };
  }

  async updateChat(
    chatId: string,
    body: {
      enabled?: boolean;
      defaultLeverage?: number | null;
      forcedLeverage?: number | null;
      leverageRangeMode?: 'min' | 'max' | 'mid' | null;
      minLeverage?: number | null;
      maxLeverage?: number | null;
      defaultEntryUsd?: string | null;
      martingaleMultiplier?: number | null;
      sourcePriority?: number | null;
      minLotBump?: boolean | null;
      tpSlStepStart?: string | null;
      tpSlStepRange?: number | null;
    },
  ): Promise<{ ok: true }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const existing = await this.prisma.cabinetTelegramSource.findUnique({
      where: { cabinetId_chatId: { cabinetId, chatId } },
      select: { minLeverage: true, maxLeverage: true },
    });
    const entryNorm =
      body.defaultEntryUsd !== undefined
        ? body.defaultEntryUsd === null || body.defaultEntryUsd.trim() === ''
          ? null
          : body.defaultEntryUsd.trim()
        : undefined;
    const levNorm =
      body.defaultLeverage === undefined
        ? undefined
        : body.defaultLeverage === null
          ? null
          : body.defaultLeverage >= 1
            ? Math.floor(body.defaultLeverage)
            : null;
    const forcedLevNorm =
      body.forcedLeverage === undefined
        ? undefined
        : body.forcedLeverage === null
          ? null
          : body.forcedLeverage >= 1
            ? Math.floor(body.forcedLeverage)
            : null;
    const rangeModeNorm =
      body.leverageRangeMode === undefined
        ? undefined
        : body.leverageRangeMode === null
          ? null
          : body.leverageRangeMode === 'min' ||
              body.leverageRangeMode === 'max' ||
              body.leverageRangeMode === 'mid'
            ? parseLeverageRangeMode(body.leverageRangeMode)
            : (() => {
                throw new BadRequestException(
                  `leverageRangeMode: ожидается "min", "max", "mid" или null, получено ${JSON.stringify(body.leverageRangeMode)}`,
                );
              })();
    const minLeverageNorm =
      body.minLeverage === undefined
        ? undefined
        : body.minLeverage === null
          ? null
          : Number.isFinite(body.minLeverage) && body.minLeverage >= 1
            ? Math.floor(body.minLeverage)
            : null;
    const maxLeverageNorm =
      body.maxLeverage === undefined
        ? undefined
        : body.maxLeverage === null
          ? null
          : Number.isFinite(body.maxLeverage) && body.maxLeverage >= 1
            ? Math.floor(body.maxLeverage)
            : null;
    const minEff =
      minLeverageNorm === undefined ? (existing?.minLeverage ?? undefined) : minLeverageNorm;
    const maxEff =
      maxLeverageNorm === undefined ? (existing?.maxLeverage ?? undefined) : maxLeverageNorm;
    if (
      minEff != null &&
      maxEff != null &&
      Number.isFinite(minEff) &&
      Number.isFinite(maxEff) &&
      minEff > maxEff
    ) {
      throw new BadRequestException(
        `Ограничения плеча некорректны: minLeverage (${minEff}) не может быть больше maxLeverage (${maxEff})`,
      );
    }
    const martingaleNorm =
      body.martingaleMultiplier === undefined
        ? undefined
        : body.martingaleMultiplier === null
          ? null
          : Number.isFinite(body.martingaleMultiplier) &&
              body.martingaleMultiplier > 1
            ? Math.round(body.martingaleMultiplier * 1_000_000) / 1_000_000
            : null;
    const sourcePriorityNorm =
      body.sourcePriority === undefined
        ? undefined
        : body.sourcePriority === null
          ? 0
          : Number.isFinite(body.sourcePriority)
            ? Math.max(0, Math.floor(body.sourcePriority))
            : 0;
    const minLotBumpNorm =
      body.minLotBump === undefined
        ? undefined
        : body.minLotBump === null
          ? null
          : Boolean(body.minLotBump);

    await this.prisma.tgUserbotChat.upsert({
      where: { chatId },
      create: {
        chatId,
        title: chatId,
        enabled: false,
      },
      update: {},
    });
    const tpSlStartNorm =
      body.tpSlStepStart === undefined
        ? undefined
        : body.tpSlStepStart === null || String(body.tpSlStepStart).trim() === ''
          ? null
          : parseTpSlStepStart(String(body.tpSlStepStart));
    const tpSlRangeNorm =
      body.tpSlStepRange === undefined
        ? undefined
        : body.tpSlStepRange === null
          ? null
          : (() => {
              if (!Number.isFinite(body.tpSlStepRange)) {
                throw new BadRequestException(
                  'tpSlStepRange: ожидается null или целое 1–5',
                );
              }
              const n = Math.trunc(body.tpSlStepRange as number);
              if (n < 1 || n > 5) {
                throw new BadRequestException(
                  `tpSlStepRange: ожидается целое 1–5, получено ${JSON.stringify(body.tpSlStepRange)}`,
                );
              }
              return n;
            })();

    await this.prisma.cabinetTelegramSource.upsert({
      where: { cabinetId_chatId: { cabinetId, chatId } },
      create: {
        cabinetId,
        chatId,
        enabled: body.enabled === true,
        sourcePriority: sourcePriorityNorm ?? 0,
        defaultLeverage: levNorm ?? null,
        forcedLeverage: forcedLevNorm ?? null,
        leverageRangeMode: rangeModeNorm ?? null,
        minLeverage: minLeverageNorm ?? null,
        maxLeverage: maxLeverageNorm ?? null,
        defaultEntryUsd: entryNorm ?? null,
        minLotBump: minLotBumpNorm ?? null,
        martingaleMultiplier: martingaleNorm ?? null,
        tpSlStepStart: tpSlStartNorm ?? null,
        tpSlStepRange: tpSlRangeNorm ?? null,
      },
      update: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(sourcePriorityNorm !== undefined ? { sourcePriority: sourcePriorityNorm } : {}),
        ...(levNorm !== undefined ? { defaultLeverage: levNorm } : {}),
        ...(forcedLevNorm !== undefined ? { forcedLeverage: forcedLevNorm } : {}),
        ...(rangeModeNorm !== undefined ? { leverageRangeMode: rangeModeNorm } : {}),
        ...(minLeverageNorm !== undefined ? { minLeverage: minLeverageNorm } : {}),
        ...(maxLeverageNorm !== undefined ? { maxLeverage: maxLeverageNorm } : {}),
        ...(entryNorm !== undefined ? { defaultEntryUsd: entryNorm } : {}),
        ...(minLotBumpNorm !== undefined ? { minLotBump: minLotBumpNorm } : {}),
        ...(martingaleNorm !== undefined ? { martingaleMultiplier: martingaleNorm } : {}),
        ...(tpSlStartNorm !== undefined ? { tpSlStepStart: tpSlStartNorm } : {}),
        ...(tpSlRangeNorm !== undefined ? { tpSlStepRange: tpSlRangeNorm } : {}),
      },
    });

    if (this.enabledChatsRefresh) {
      await this.enabledChatsRefresh();
    }
    return { ok: true };
  }
}
