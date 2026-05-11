import { Injectable, Logger } from '@nestjs/common';

import { SettingsService } from '../settings/settings.service';
import { BybitService, type LiveExposureItem } from './bybit.service';

export type LiveExposurePayload = {
  bybitConnected: boolean;
  items: LiveExposureItem[];
};

export type LiveExposureCachedResponse = LiveExposurePayload & {
  liveCache: {
    /** Когда последний раз успешно обновили снимок с биржи */
    fetchedAt: string;
    /** Сколько мс прошло с fetchedAt */
    ageMs: number;
    /** Минимальный интервал между запросами к Bybit (из настроек) */
    refreshIntervalMs: number;
    /** Снимок взят из кэша без нового запроса к бирже */
    servedFromCache: boolean;
  };
};

const SETTING_KEY = 'BYBIT_LIVE_REFRESH_MS';
const DEFAULT_REFRESH_MS = 4_000;
const MIN_REFRESH_MS = 500;

@Injectable()
export class BybitLiveSnapshotCacheService {
  private readonly logger = new Logger(BybitLiveSnapshotCacheService.name);
  private snapshot: LiveExposurePayload | null = null;
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly bybit: BybitService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Сброс после действий, меняющих снимок (закрытие сделки и т.п.).
   */
  invalidate(): void {
    this.snapshot = null;
    this.fetchedAt = 0;
  }

  private async resolveRefreshIntervalMs(): Promise<number> {
    const raw = await this.settings.get(SETTING_KEY);
    if (raw === '0' || raw?.trim() === '0') {
      return 0;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return DEFAULT_REFRESH_MS;
    }
    if (n > 0 && n < MIN_REFRESH_MS) {
      return MIN_REFRESH_MS;
    }
    return n > 0 ? n : DEFAULT_REFRESH_MS;
  }

  /**
   * HTTP GET /bybit/live: частые вызовы читают память; к бирже — не чаще refreshIntervalMs
   * и не параллельно (single-flight).
   */
  async getLiveExposure(): Promise<LiveExposureCachedResponse> {
    const refreshIntervalMs = await this.resolveRefreshIntervalMs();
    const now = Date.now();

    if (refreshIntervalMs === 0) {
      const fresh = await this.bybit.getLiveExposureSnapshot();
      this.snapshot = fresh;
      this.fetchedAt = now;
      return this.wrap(fresh, now, refreshIntervalMs, false);
    }

    /** После неудачного refresh snapshot может остаться null — не опрашивать Bybit чаще интервала */
    if (
      !this.snapshot &&
      this.fetchedAt > 0 &&
      now - this.fetchedAt < refreshIntervalMs
    ) {
      return this.wrap(
        { bybitConnected: false, items: [] },
        now,
        refreshIntervalMs,
        true,
      );
    }

    if (
      this.snapshot &&
      now - this.fetchedAt < refreshIntervalMs
    ) {
      return this.wrap(this.snapshot, now, refreshIntervalMs, true);
    }

    await this.runRefreshLocked();

    const body = this.snapshot ?? {
      bybitConnected: false,
      items: [],
    };
    return this.wrap(body, Date.now(), refreshIntervalMs, false);
  }

  private wrap(
    body: LiveExposurePayload,
    now: number,
    refreshIntervalMs: number,
    servedFromCache: boolean,
  ): LiveExposureCachedResponse {
    const baseAt = this.fetchedAt || now;
    return {
      ...body,
      liveCache: {
        fetchedAt: new Date(baseAt).toISOString(),
        ageMs: Math.max(0, now - baseAt),
        refreshIntervalMs,
        servedFromCache,
      },
    };
  }

  private async runRefreshLocked(): Promise<void> {
    if (this.inflight) {
      await this.inflight;
      return;
    }

    this.inflight = (async () => {
      try {
        this.snapshot = await this.bybit.getLiveExposureSnapshot();
      } catch (e) {
        this.logger.warn(
          `live snapshot refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        /** И при ошибке сдвигаем окно, чтобы не долбить Bybit на каждом HTTP-запросе */
        this.fetchedAt = Date.now();
        this.inflight = null;
      }
    })();

    await this.inflight;
  }
}
