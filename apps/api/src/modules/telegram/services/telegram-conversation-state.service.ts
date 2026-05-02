import { Injectable } from '@nestjs/common';

import {
  DRAFT_TTL_MS,
  EXTERNAL_CONFIRM_TTL_MS,
} from '../constants/telegram.constants';
import type {
  DraftSession,
  ExternalConfirmationRequest,
} from '../types/telegram.types';

/**
 * In-memory состояние диалогов Telegram (черновики, override источника, внешние подтверждения userbot).
 * Синхронизируется с периодической очисткой из TelegramService.
 */
@Injectable()
export class TelegramConversationStateService {
  /** Один черновик сигнала на пользователя (до подтверждения или отмены). */
  readonly drafts = new Map<number, DraftSession>();
  /** Переопределение «канал/приложение» для сигналов (важнее настройки SIGNAL_SOURCE). */
  readonly sourceOverrideByUser = new Map<number, string>();
  /** Подтверждения сигналов из userbot, ключ = requestId (cabinetId|ingestId). */
  readonly externalConfirmations = new Map<string, ExternalConfirmationRequest>();

  getActiveDraft(userId: number): DraftSession | undefined {
    const draft = this.drafts.get(userId);
    if (!draft) {
      return undefined;
    }
    if (Date.now() - (draft.updatedAtMs ?? 0) > DRAFT_TTL_MS) {
      this.drafts.delete(userId);
      return undefined;
    }
    return draft;
  }

  /**
   * Очистка in-memory структур (вызывается из интервала в TelegramService).
   * @returns счётчики для лога
   */
  runMemoryCleanup(now: number): {
    expiredDrafts: number;
    removedExternal: number;
  } {
    let expiredDrafts = 0;
    for (const [uid, draft] of this.drafts.entries()) {
      if (now - (draft.updatedAtMs ?? 0) > DRAFT_TTL_MS) {
        this.drafts.delete(uid);
        expiredDrafts += 1;
      }
    }
    const maxDrafts = 500;
    if (this.drafts.size > maxDrafts) {
      const excess = this.drafts.size - maxDrafts;
      const keys = Array.from(this.drafts.keys()).slice(0, excess);
      for (const k of keys) this.drafts.delete(k);
    }
    const maxOverrides = 500;
    if (this.sourceOverrideByUser.size > maxOverrides) {
      const excess = this.sourceOverrideByUser.size - maxOverrides;
      const keys = Array.from(this.sourceOverrideByUser.keys()).slice(0, excess);
      for (const k of keys) this.sourceOverrideByUser.delete(k);
    }
    let removed = 0;
    for (const [id, req] of this.externalConfirmations.entries()) {
      if (now - (req.createdAt ?? 0) > EXTERNAL_CONFIRM_TTL_MS) {
        this.externalConfirmations.delete(id);
        removed += 1;
      }
    }
    return { expiredDrafts, removedExternal: removed };
  }
}
