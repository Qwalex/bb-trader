import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

type MemorySample = {
  at: string;
  uptimeSec: number;
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
};

@Injectable()
export class MemoryDiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryDiagnosticsService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly samples: MemorySample[] = [];
  private lastWarnAtMs = 0;

  onModuleInit(): void {
    const enabled = this.readBoolEnv('MEMORY_DIAGNOSTICS_ENABLED', true);
    if (!enabled) {
      return;
    }
    this.pushSample();
    const intervalMs = this.readNumberEnv(
      'MEMORY_DIAGNOSTICS_INTERVAL_MS',
      60_000,
      10_000,
      15 * 60_000,
    );
    this.timer = setInterval(() => {
      this.pushSample();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot() {
    const current = this.captureSample();
    const latest = this.samples[this.samples.length - 1];
    const baseline = this.samples[0];
    const rssDeltaMb =
      baseline !== undefined
        ? Number((current.rssMb - baseline.rssMb).toFixed(1))
        : 0;
    const heapDeltaMb =
      baseline !== undefined
        ? Number((current.heapUsedMb - baseline.heapUsedMb).toFixed(1))
        : 0;
    return {
      current,
      latest,
      baseline,
      trend: {
        rssDeltaMb,
        heapUsedDeltaMb: heapDeltaMb,
      },
      samplesStored: this.samples.length,
    };
  }

  getHistory(limit = 30): MemorySample[] {
    const take = Math.max(1, Math.min(300, Math.floor(limit)));
    const from = Math.max(0, this.samples.length - take);
    return this.samples.slice(from);
  }

  private pushSample(): void {
    const sample = this.captureSample();
    this.samples.push(sample);
    while (this.samples.length > 300) {
      this.samples.shift();
    }
    this.maybeWarn(sample);
  }

  private captureSample(): MemorySample {
    const m = process.memoryUsage();
    const toMb = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(1));
    return {
      at: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      rssMb: toMb(m.rss),
      heapTotalMb: toMb(m.heapTotal),
      heapUsedMb: toMb(m.heapUsed),
      externalMb: toMb(m.external),
      arrayBuffersMb: toMb(m.arrayBuffers),
    };
  }

  private maybeWarn(sample: MemorySample): void {
    const rssWarnMb = this.readNumberEnv(
      'MEMORY_DIAGNOSTICS_WARN_RSS_MB',
      700,
      128,
      16_384,
    );
    if (sample.rssMb < rssWarnMb) {
      return;
    }
    const now = Date.now();
    if (now - this.lastWarnAtMs < 10 * 60_000) {
      return;
    }
    this.lastWarnAtMs = now;
    this.logger.warn(
      `High RSS detected: ${sample.rssMb} MB (heapUsed=${sample.heapUsedMb} MB, external=${sample.externalMb} MB)`,
    );
  }

  private readBoolEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key]?.trim().toLowerCase();
    if (!raw) {
      return fallback;
    }
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private readNumberEnv(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = process.env[key]?.trim();
    const num = raw ? Number(raw) : NaN;
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(num)));
  }
}
