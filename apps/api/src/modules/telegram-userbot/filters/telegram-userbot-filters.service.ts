import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { USERBOT_FILTER_MATCH_THRESHOLD } from '../telegram-userbot.constants';
import type {
  UserbotFilterExampleMatch,
  UserbotFilterKind,
  UserbotFilterPatternMatch,
} from '../telegram-userbot.types';
import { computeTextSimilarity } from '../utils/telegram-userbot-text-similarity.util';
import { makeTextPreview } from '../utils/telegram-userbot-text.util';

@Injectable()
export class TelegramUserbotFiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly transcript: TranscriptService,
  ) {}

  async matchFilterKindByExamples(
    groupName: string,
    text: string,
    hasQuotedSource: boolean,
  ): Promise<UserbotFilterExampleMatch | undefined> {
    const rows = await this.prisma.tgUserbotFilterExample.findMany({
      where: { enabled: true },
      select: { groupName: true, kind: true, example: true, requiresQuote: true },
    });
    const target = groupName.trim().toLowerCase();
    const scoped = rows.filter((row) => {
      const name = typeof row.groupName === 'string' ? row.groupName.trim().toLowerCase() : '';
      return name === target;
    });
    if (scoped.length === 0) {
      return undefined;
    }

    let bestKind: UserbotFilterKind | undefined;
    let bestScore = 0;
    let bestExampleText = '';
    let bestRequiresQuote = false;
    for (const row of scoped) {
      const kind = row.kind as UserbotFilterKind;
      const exampleText = typeof row.example === 'string' ? row.example : '';
      const requiresQuote = row.requiresQuote === true;
      if (
        kind !== 'signal' &&
        kind !== 'close' &&
        kind !== 'result' &&
        kind !== 'reentry' &&
        kind !== 'ignore'
      ) {
        continue;
      }
      if ((kind === 'close' || kind === 'reentry') && !hasQuotedSource) {
        continue;
      }
      if (requiresQuote && !hasQuotedSource) {
        continue;
      }
      if (!exampleText) {
        continue;
      }
      const score = computeTextSimilarity(String(text), String(exampleText));
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
        bestExampleText = exampleText;
        bestRequiresQuote = requiresQuote;
      }
    }
    if (!bestKind) {
      return undefined;
    }
    return bestScore >= USERBOT_FILTER_MATCH_THRESHOLD
      ? {
          kind: bestKind,
          score: bestScore,
          examplePreview: makeTextPreview(bestExampleText, 220),
          requiresQuote: bestRequiresQuote,
        }
      : undefined;
  }

  async matchFilterKindByPatterns(
    groupName: string,
    text: string,
    hasQuotedSource: boolean,
  ): Promise<UserbotFilterPatternMatch | undefined> {
    const rows = await this.prisma.tgUserbotFilterPattern.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { createdAt: 'asc' }],
      select: { groupName: true, kind: true, pattern: true, requiresQuote: true },
    });
    const target = groupName.trim().toLowerCase();
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const row of rows) {
      const name = typeof row.groupName === 'string' ? row.groupName.trim().toLowerCase() : '';
      const kind = row.kind as UserbotFilterKind;
      const pattern =
        typeof row.pattern === 'string'
          ? String(row.pattern).trim().toLowerCase()
          : '';
      const requiresQuote = row.requiresQuote === true;
      if (name !== target || !pattern) {
        continue;
      }
      if (
        kind !== 'signal' &&
        kind !== 'close' &&
        kind !== 'result' &&
        kind !== 'reentry' &&
        kind !== 'ignore'
      ) {
        continue;
      }
      if ((kind === 'close' || kind === 'reentry') && !hasQuotedSource) {
        continue;
      }
      if (requiresQuote && !hasQuotedSource) {
        continue;
      }
      if (normalizedText.includes(pattern)) {
        return {
          kind,
          pattern,
          requiresQuote,
        };
      }
    }
    return undefined;
  }

  async listFilterGroups(): Promise<{ groups: string[] }> {
    const chatRows = await this.prisma.cabinetTelegramSource.findMany({
      where: {
        cabinetId: this.cabinetContext.getCabinetId() ?? undefined,
        enabled: true,
      },
      orderBy: { chatId: 'asc' },
      select: {
        chat: {
          select: { title: true },
        },
      },
    });
    const names = new Set<string>();
    for (const row of chatRows) {
      const v = typeof row.chat?.title === 'string' ? row.chat.title.trim() : '';
      if (v) names.add(String(v));
    }
    return {
      groups: Array.from(names).sort((a, b) => a.localeCompare(b, 'ru')),
    };
  }

  async listFilterExamples() {
    const rows = await this.prisma.tgUserbotFilterExample.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        groupName: true,
        kind: true,
        example: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { items: rows };
  }

  async listFilterPatterns() {
    const rows = await this.prisma.tgUserbotFilterPattern.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        groupName: true,
        kind: true,
        pattern: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { items: rows };
  }

  async createFilterExample(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    example?: string;
    requiresQuote?: boolean;
  }) {
    const groupName = body.groupName?.trim() ?? '';
    const kind = body.kind;
    const example = body.example?.trim() ?? '';
    const requiresQuote = body.requiresQuote === true;
    if (!groupName) {
      return { ok: false, error: 'groupName обязателен' };
    }
    if (
      kind !== 'signal' &&
      kind !== 'close' &&
      kind !== 'result' &&
      kind !== 'reentry' &&
      kind !== 'ignore'
    ) {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry | ignore' };
    }
    if (example.length < 6) {
      return { ok: false, error: 'example слишком короткий (минимум 6 символов)' };
    }
    const created = await this.prisma.tgUserbotFilterExample.create({
      data: { groupName, kind, example, requiresQuote, enabled: true },
      select: {
        id: true,
        groupName: true,
        kind: true,
        example: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { ok: true, item: created };
  }

  async deleteFilterExample(id: string) {
    await this.prisma.tgUserbotFilterExample.update({
      where: { id },
      data: { enabled: false },
    });
    return { ok: true };
  }

  async createFilterPattern(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    pattern?: string;
    requiresQuote?: boolean;
  }) {
    const groupName = body.groupName?.trim() ?? '';
    const kind = body.kind;
    const pattern = body.pattern?.trim() ?? '';
    const requiresQuote = body.requiresQuote === true;
    if (!groupName) {
      return { ok: false, error: 'groupName обязателен' };
    }
    if (
      kind !== 'signal' &&
      kind !== 'close' &&
      kind !== 'result' &&
      kind !== 'reentry' &&
      kind !== 'ignore'
    ) {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry | ignore' };
    }
    if (pattern.length < 2) {
      return { ok: false, error: 'pattern слишком короткий (минимум 2 символа)' };
    }
    const created = await this.prisma.tgUserbotFilterPattern.create({
      data: { groupName, kind, pattern, requiresQuote, enabled: true },
      select: {
        id: true,
        groupName: true,
        kind: true,
        pattern: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { ok: true, item: created };
  }

  async deleteFilterPattern(id: string) {
    await this.prisma.tgUserbotFilterPattern.update({
      where: { id },
      data: { enabled: false },
    });
    return { ok: true };
  }

  async generateFilterPatterns(body: {
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    example?: string;
  }) {
    const kind = body.kind;
    const example = body.example?.trim() ?? '';
    if (
      kind !== 'signal' &&
      kind !== 'close' &&
      kind !== 'result' &&
      kind !== 'reentry' &&
      kind !== 'ignore'
    ) {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry | ignore' };
    }
    if (example.length < 6) {
      return { ok: false, error: 'example слишком короткий (минимум 6 символов)' };
    }
    return this.transcript.generateFilterPatterns({ kind, example });
  }
}

