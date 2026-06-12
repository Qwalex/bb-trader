import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { NewMessage } from 'telegram/events';
import { EditedMessage } from 'telegram/events/EditedMessage';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as QRCode from 'qrcode';

import { postCriticalNotifyText } from '../../../common/critical-notify.util';
import { formatError } from '../../../common/format-error';
import { shouldRunUserbotMtproto } from '../../../config/process-role.util';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  formatUserbotQrAuthErrorForUser,
  normalizeCloudPasswordInput,
} from '../utils/telegram-userbot-qr-auth-error.util';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import {
  TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY,
} from '../../settings/settings.constants';
import {
  TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_DEFAULT,
  TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MAX,
  TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MIN,
  TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_DEFAULT,
  TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MAX,
  TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MIN,
} from '../telegram-userbot.constants';
import { isTelegramAuthKeyDuplicatedError } from '../utils/telegram-userbot-mtproto-error.util';
import { userbotMtprotoHostError } from '../utils/telegram-userbot-mtproto-host.util';
import type { QrState } from '../telegram-userbot.types';

/** Сброс визуальных полей QR: при `{ ...prev, ...next }` иначе остаются старый data URL и ссылки. */
const QR_STATE_VISUAL_CLEAR: Partial<QrState> = {
  qrDataUrl: undefined,
  loginUrl: undefined,
};

@Injectable()
export class TelegramUserbotClientService {
  private static readonly QR_2FA_WAIT_MS = 120_000;

  private readonly logger = new Logger(TelegramUserbotClientService.name);
  private readonly clientsByUserId = new Map<string, TelegramClient>();
  private readonly messageHandlerRegisteredByUserId = new Set<string>();
  private readonly qrClientByUserId = new Map<string, TelegramClient>();
  private readonly qrTaskByUserId = new Map<string, Promise<void>>();
  private readonly qrStateByUserId = new Map<string, QrState>();
  /** Ожидание пароля 2FA при QR: пароль только в памяти до resolve, не в БД. */
  private readonly qrPasswordDeferredByUserId = new Map<
    string,
    {
      resolve: (p: string) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** После 406 AUTH_KEY_DUPLICATED — не спамить Telegram reconnect (watchdog/старт). */
  private authKeyDuplicateBackoffUntilMs = 0;
  private lastAuthKeyDuplicateCriticalNotifyAt = 0;

  /** GramJS может вызывать `onError` много раз подряд — гейт, чтобы один раз залогировать и остановить QR-клиент. */
  private readonly qrAuthTerminalHandledByUserId = new Set<string>();
  /** Периодически синхронизируем StringSession в Setting — иначе после редеплоя строка в БД бывает устаревшей. */
  private sessionPersistIntervalHandle: ReturnType<typeof setInterval> | null = null;

  private inboundHandler: ((event: unknown) => Promise<void>) | null = null;
  private afterAttachHook: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private readStringSessionSerialized(client: TelegramClient): string | null {
    try {
      const session = client.session as unknown as { save?: () => string };
      const s = session.save?.();
      return typeof s === 'string' && s.trim().length > 0 ? s.trim() : null;
    } catch {
      return null;
    }
  }

  private resolveSessionPersistIntervalMs(): number {
    const raw = process.env.TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS?.trim();
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(n)) {
      return TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_DEFAULT;
    }
    return Math.min(
      TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MAX,
      Math.max(TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MIN, n),
    );
  }

  private clearSessionPersistSchedule(): void {
    if (this.sessionPersistIntervalHandle) {
      clearInterval(this.sessionPersistIntervalHandle);
      this.sessionPersistIntervalHandle = null;
    }
  }

  private ensureSessionPersistSchedule(): void {
    if (this.clientsByUserId.size === 0) {
      this.clearSessionPersistSchedule();
      return;
    }
    if (this.sessionPersistIntervalHandle) {
      return;
    }
    const ms = this.resolveSessionPersistIntervalMs();
    this.sessionPersistIntervalHandle = setInterval(() => {
      void this.persistAllConnectedSessions().catch((e) =>
        this.logger.warn(`Userbot session persist tick: ${formatError(e)}`),
      );
    }, ms);
    this.logger.log(`Userbot: фоновая запись MTProto-сессии в БД каждые ${ms} мс`);
  }

  private async persistConnectedSessionStringIfChanged(client: TelegramClient): Promise<void> {
    const next = this.readStringSessionSerialized(client);
    if (!next) {
      return;
    }
    const current = (await this.settings.get('TELEGRAM_USERBOT_SESSION'))?.trim() ?? '';
    if (next === current) {
      return;
    }
    await this.settings.set('TELEGRAM_USERBOT_SESSION', next);
    this.logger.debug('Userbot: TELEGRAM_USERBOT_SESSION обновлена в БД (GramJS)');
  }

  private async persistAllConnectedSessions(): Promise<void> {
    for (const client of this.clientsByUserId.values()) {
      try {
        if (await this.isClientAuthorized(client)) {
          await this.persistConnectedSessionStringIfChanged(client);
        }
      } catch (e) {
        this.logger.warn(`Userbot session persist: ${formatError(e)}`);
      }
    }
  }

  setInboundHandler(handler: (event: unknown) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  /** Вызывается после успешного attach (например refresh enabled chats на фасаде). */
  setAfterAttachHook(hook: () => Promise<void>): void {
    this.afterAttachHook = hook;
  }

  async getOwnerUserId(): Promise<string | null> {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      return null;
    }
    const row = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      select: { ownerUserId: true },
    });
    return String(row?.ownerUserId ?? '').trim() || null;
  }

  /**
   * Userbot привязан к AuthUser (владелец MTProto-сессии), а не к кабинету.
   * В UI «текущего» кабинета клиент виден, если owner кабинета совпадает с владельцем сохранённой сессии.
   */
  async isClientOwnedByCurrentUser(): Promise<boolean> {
    const client = await this.getCurrentUserClient();
    if (!client) return false;
    return this.isClientAuthorized(client);
  }

  async getCurrentUserClient(): Promise<TelegramClient | null> {
    const sessionOwner = (
      await this.settings.get(TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY)
    )?.trim() || null;
    const cabinetOwner = await this.getOwnerUserId();

    if (sessionOwner) {
      if (cabinetOwner && cabinetOwner !== sessionOwner) {
        return null;
      }
      return this.clientsByUserId.get(sessionOwner) ?? null;
    }
    if (!cabinetOwner) return null;
    return this.clientsByUserId.get(cabinetOwner) ?? null;
  }

  getClientForOwnerUserId(userId: string): TelegramClient | null {
    const id = String(userId ?? '').trim();
    if (!id) return null;
    return this.clientsByUserId.get(id) ?? null;
  }

  getQrStateForUser(userId: string | null): QrState {
    if (!userId) return { phase: 'idle' };
    return this.qrStateByUserId.get(userId) ?? { phase: 'idle' };
  }

  setQrStateForUser(userId: string | null, next: Partial<QrState>) {
    if (!userId) return;
    const now = new Date().toISOString();
    const prev = this.getQrStateForUser(userId);
    this.qrStateByUserId.set(userId, {
      ...prev,
      ...next,
      startedAt: prev.startedAt ?? now,
      updatedAt: now,
    });
  }

  private clearUserbotQrAuthErrorGate(userId: string | null): void {
    if (!userId) return;
    this.qrAuthTerminalHandledByUserId.delete(userId);
  }

  private rejectQrPasswordWait(userId: string | null, err: Error): void {
    if (!userId) return;
    const w = this.qrPasswordDeferredByUserId.get(userId);
    if (!w) return;
    clearTimeout(w.timer);
    this.qrPasswordDeferredByUserId.delete(userId);
    w.reject(err);
  }

  async submitQrPassword(
    password: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const ownerUserId = await this.getOwnerUserId();
    if (!ownerUserId) {
      return { ok: false, error: 'Пользователь не определен для кабинета' };
    }
    const normalized = normalizeCloudPasswordInput(password ?? '');
    if (!normalized) {
      return { ok: false, error: 'Введите пароль облака Telegram (2FA).' };
    }
    const w = this.qrPasswordDeferredByUserId.get(ownerUserId);
    if (!w) {
      return {
        ok: false,
        error: 'Сейчас пароль 2FA не ожидается. Отсканируйте QR ещё раз или дождитесь запроса.',
      };
    }
    clearTimeout(w.timer);
    this.qrPasswordDeferredByUserId.delete(ownerUserId);
    w.resolve(normalized);
    return { ok: true };
  }

  getConnectedClientsCount(): number {
    return this.clientsByUserId.size;
  }

  /** Пока действует backoff после AUTH_KEY_DUPLICATED — внешний код не должен считать это «просто offline». */
  isAuthKeyDuplicateBackoffActive(): boolean {
    return Date.now() < this.authKeyDuplicateBackoffUntilMs;
  }

  private resolveAuthKeyDuplicateBackoffMs(): number {
    const raw = process.env.TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS?.trim();
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(n)) {
      return TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_DEFAULT;
    }
    return Math.min(
      TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MAX,
      Math.max(TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MIN, n),
    );
  }

  private notifyAuthKeyDuplicatedCriticalOnce(backoffMs: number): void {
    const now = Date.now();
    if (now - this.lastAuthKeyDuplicateCriticalNotifyAt < backoffMs) {
      return;
    }
    this.lastAuthKeyDuplicateCriticalNotifyAt = now;
    const mins = Math.max(1, Math.round(backoffMs / 60_000));
    const text =
      `[CRITICAL userbot] AUTH_KEY_DUPLICATED (406): та же MTProto-сессия уже активна в другом процессе (вторая реплика API, параллельный локальный запуск и т.п.). ` +
      `На этом инстансе повторный connect приостановлен на ~${mins} мин. Оставьте одну реплику с userbot или отключите сессию в лишних процессах. ${new Date().toISOString()}`;
    void postCriticalNotifyText(text, (m) => this.logger.warn(m));
  }

  *clientsEntries(): IterableIterator<[string, TelegramClient]> {
    yield* this.clientsByUserId.entries();
  }

  async connectFromStoredSession(opts?: {
    sessionOwnerUserId?: string;
  }): Promise<{ ok: true; connected: true } | { ok: false; error: string }> {
    if (!shouldRunUserbotMtproto()) {
      return { ok: false, error: userbotMtprotoHostError() };
    }
    let client: TelegramClient | undefined;
    try {
      const fromOpt = opts?.sessionOwnerUserId?.trim();
      const fromCabinet = await this.getOwnerUserId();
      const ownerForAttach = fromOpt || fromCabinet;
      if (!ownerForAttach) {
        return {
          ok: false,
          error:
            'Не удалось определить владельца сессии userbot. Войдите по QR из кабинета или задайте TELEGRAM_USERBOT_SESSION_OWNER_USER_ID.',
        };
      }
      if (this.isAuthKeyDuplicateBackoffActive()) {
        const leftMs = Math.max(0, this.authKeyDuplicateBackoffUntilMs - Date.now());
        const mins = Math.max(1, Math.ceil(leftMs / 60_000));
        return {
          ok: false,
          error: `Повторное подключение userbot отложено (~${mins} мин.) после AUTH_KEY_DUPLICATED: одна MTProto-сессия не может быть активна в двух процессах одновременно.`,
        };
      }
      const creds = await this.getApiCreds();
      const clientOptions = await this.getTelegramClientOptions();
      const session = (await this.settings.get('TELEGRAM_USERBOT_SESSION'))?.trim();
      if (!session) {
        return {
          ok: false,
          error: 'Сессия userbot не найдена. Запустите вход по QR.',
        };
      }
      await this.stopQrClient(ownerForAttach);
      client = new TelegramClient(
        new StringSession(session),
        creds.apiId,
        creds.apiHash,
        clientOptions,
      );
      await client.connect();
      const authorized = await this.isClientAuthorized(client);
      if (!authorized) {
        await client.disconnect().catch(() => undefined);
        return {
          ok: false,
          error: 'Сессия недействительна. Выполните повторный вход по QR.',
        };
      }
      await this.attachClient(client, ownerForAttach);
      await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
      await this.settings.set(TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY, ownerForAttach);
      return { ok: true, connected: true };
    } catch (e) {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          /* ignore */
        }
      }
      const msg = formatError(e);
      if (isTelegramAuthKeyDuplicatedError(e)) {
        const backoffMs = this.resolveAuthKeyDuplicateBackoffMs();
        this.authKeyDuplicateBackoffUntilMs = Date.now() + backoffMs;
        this.notifyAuthKeyDuplicatedCriticalOnce(backoffMs);
        const mins = Math.max(1, Math.round(backoffMs / 60_000));
        this.logger.warn(
          `connectFromStoredSession: AUTH_KEY_DUPLICATED — сессия уже используется другим процессом. Повторные попытки приостановлены на ~${mins} мин. (см. CRITICAL уведомление). raw=${msg}`,
        );
        return {
          ok: false,
          error: `Дублирование MTProto-сессии (AUTH_KEY_DUPLICATED): та же сессия уже подключена в другом месте (вторая реплика API или параллельный запуск). Используйте один инстанс с userbot; повторный вход на этом инстансе отложен на ~${mins} мин.`,
        };
      }
      this.logger.error(`connectFromStoredSession failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async disconnect(): Promise<{ ok: true; connected: false }> {
    if (!shouldRunUserbotMtproto()) {
      throw new BadRequestException(userbotMtprotoHostError());
    }
    const sessionOwner =
      (await this.settings.get(TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY))?.trim() || null;
    const cabinetOwner = await this.getOwnerUserId();
    if (!cabinetOwner) {
      return { ok: true, connected: false };
    }
    let ownerKey: string | null = null;
    if (sessionOwner) {
      if (sessionOwner !== cabinetOwner) {
        return { ok: true, connected: false };
      }
      ownerKey = sessionOwner;
    } else {
      ownerKey = cabinetOwner;
    }
    const client = ownerKey ? this.clientsByUserId.get(ownerKey) : null;
    if (!client) {
      return { ok: true, connected: false };
    }
    try {
      await this.persistConnectedSessionStringIfChanged(client);
      await client.disconnect();
    } finally {
      if (ownerKey) {
        this.clientsByUserId.delete(ownerKey);
        this.messageHandlerRegisteredByUserId.delete(ownerKey);
      }
    }
    if (this.clientsByUserId.size === 0) {
      this.clearSessionPersistSchedule();
    }
    return { ok: true, connected: false };
  }

  async startQrLogin(): Promise<
    | { ok: true; message?: string; qr: QrState }
    | { ok: false; error: string; qr?: QrState }
  > {
    if (!shouldRunUserbotMtproto()) {
      return { ok: false, error: userbotMtprotoHostError() };
    }
    const ownerUserId = await this.getOwnerUserId();
    const currentClient = await this.getCurrentUserClient();
    if ((await this.isClientOwnedByCurrentUser()) && (await this.isClientAuthorized(currentClient))) {
      return {
        ok: true,
        message: 'Userbot уже авторизован.',
        qr: this.getQrStateForUser(ownerUserId),
      };
    }
    if (ownerUserId && this.qrTaskByUserId.get(ownerUserId)) {
      const qrNow = this.getQrStateForUser(ownerUserId);
      if (qrNow.phase === 'error' || qrNow.phase === 'cancelled') {
        await this.stopQrClient(ownerUserId);
        this.clearUserbotQrAuthErrorGate(ownerUserId);
        this.qrTaskByUserId.delete(ownerUserId);
      } else {
        return { ok: true, message: 'QR-вход уже запущен.', qr: qrNow };
      }
    }

    if (!ownerUserId) {
      return { ok: false, error: 'Пользователь не определен для кабинета' };
    }

    let creds: { apiId: number; apiHash: string } | undefined;
    let qrClient: TelegramClient | undefined;
    try {
      creds = await this.getApiCreds();
      const clientOptions = await this.getTelegramClientOptions();
      await this.stopQrClient(ownerUserId);
      this.clearUserbotQrAuthErrorGate(ownerUserId);
      qrClient = new TelegramClient(
        new StringSession(''),
        creds.apiId,
        creds.apiHash,
        clientOptions,
      );
      await qrClient.connect();
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`Userbot QR start failed: ${msg}`);
      this.setQrStateForUser(ownerUserId, {
        phase: 'error',
        error: msg,
        ...QR_STATE_VISUAL_CLEAR,
      });
      if (qrClient) {
        try {
          await qrClient.disconnect();
        } catch {
          /* ignore */
        }
      }
      return { ok: false, error: msg, qr: this.getQrStateForUser(ownerUserId) };
    }

    if (!creds || !qrClient) {
      return {
        ok: false,
        error: 'Не удалось инициализировать Telegram-клиент для QR.',
        qr: this.getQrStateForUser(ownerUserId),
      };
    }

    this.qrClientByUserId.set(ownerUserId, qrClient);
    this.setQrStateForUser(ownerUserId, {
      phase: 'starting',
      ...QR_STATE_VISUAL_CLEAR,
      error: undefined,
    });

    const qrTask = (async () => {
      try {
        await qrClient.signInUserWithQrCode(
          { apiId: creds.apiId, apiHash: creds.apiHash },
          {
            onError: async (err: unknown) => {
              if (this.qrAuthTerminalHandledByUserId.has(ownerUserId)) {
                return false;
              }
              this.qrAuthTerminalHandledByUserId.add(ownerUserId);
              const raw = formatError(err);
              const msg = formatUserbotQrAuthErrorForUser(raw);
              if (/cannot send requests while disconnected/i.test(raw)) {
                this.logger.warn(
                  `Userbot QR: потеряно соединение с Telegram (GramJS), вход по QR прерван.`,
                );
              } else {
                this.logger.warn(`Userbot QR onError: ${raw}`);
              }
              this.setQrStateForUser(ownerUserId, {
                phase: 'error',
                error: msg,
                ...QR_STATE_VISUAL_CLEAR,
              });
              void this.stopQrClient(ownerUserId);
              return false;
            },
            qrCode: async (code: { token: Buffer }) => {
              const loginUrl = `tg://login?token=${code.token.toString('base64url')}`;
              const qrDataUrl = await QRCode.toDataURL(loginUrl);
              this.setQrStateForUser(ownerUserId, {
                phase: 'waiting_scan',
                loginUrl,
                qrDataUrl,
              });
            },
            password: async () =>
              new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => {
                  const cur = this.qrPasswordDeferredByUserId.get(ownerUserId);
                  if (cur?.timer !== timer) return;
                  this.qrPasswordDeferredByUserId.delete(ownerUserId);
                  reject(new Error('Истекло время ввода пароля 2FA (2 мин.)'));
                }, TelegramUserbotClientService.QR_2FA_WAIT_MS);
                this.qrPasswordDeferredByUserId.set(ownerUserId, {
                  resolve,
                  reject,
                  timer,
                });
                this.setQrStateForUser(ownerUserId, {
                  phase: 'need_password',
                  ...QR_STATE_VISUAL_CLEAR,
                });
              }),
          },
        );
        this.setQrStateForUser(ownerUserId, {
          phase: 'completing_login',
          ...QR_STATE_VISUAL_CLEAR,
          error: undefined,
        });
        const authorized = await this.isClientAuthorized(qrClient);
        if (!authorized) {
          this.setQrStateForUser(ownerUserId, {
            phase: 'error',
            error: 'QR авторизация не завершена.',
            ...QR_STATE_VISUAL_CLEAR,
          });
          return;
        }
        const savedSession = (
          qrClient.session as unknown as { save: () => string }
        ).save();
        await this.settings.set('TELEGRAM_USERBOT_SESSION', savedSession);
        await this.settings.set(
          TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY,
          ownerUserId,
        );
        await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
        await this.attachClient(qrClient, ownerUserId);
        this.qrClientByUserId.delete(ownerUserId);
        this.setQrStateForUser(ownerUserId, {
          phase: 'authorized',
          ...QR_STATE_VISUAL_CLEAR,
          error: undefined,
        });
      } catch (e) {
        const raw = formatError(e);
        const msg = formatUserbotQrAuthErrorForUser(raw);
        this.logger.error(`Userbot QR flow failed: ${raw}`);
        this.setQrStateForUser(ownerUserId, {
          phase: 'error',
          error: msg,
          ...QR_STATE_VISUAL_CLEAR,
        });
        await this.stopQrClient(ownerUserId);
      } finally {
        this.rejectQrPasswordWait(ownerUserId, new Error('Вход по QR завершён'));
        this.clearUserbotQrAuthErrorGate(ownerUserId);
        this.qrTaskByUserId.delete(ownerUserId);
      }
    })();
    this.qrTaskByUserId.set(ownerUserId, qrTask);

    return { ok: true, qr: this.getQrStateForUser(ownerUserId) };
  }

  async getQrStatus(): Promise<{
    connected: boolean;
    qr: QrState;
    inProgress: boolean;
  }> {
    const ownerUserId = await this.getOwnerUserId();
    const sameUserClient = await this.isClientOwnedByCurrentUser();
    const client = await this.getCurrentUserClient();
    return {
      connected: sameUserClient && (await this.isClientAuthorized(client)),
      qr: this.getQrStateForUser(ownerUserId),
      inProgress: Boolean(ownerUserId && this.qrTaskByUserId.get(ownerUserId)),
    };
  }

  async cancelQrLogin(): Promise<{ ok: true; qr: QrState }> {
    const ownerUserId = await this.getOwnerUserId();
    this.rejectQrPasswordWait(ownerUserId, new Error('Вход по QR отменён'));
    await this.stopQrClient(ownerUserId);
    this.clearUserbotQrAuthErrorGate(ownerUserId);
    if (ownerUserId) {
      this.qrTaskByUserId.delete(ownerUserId);
      this.setQrStateForUser(ownerUserId, {
        phase: 'cancelled',
        ...QR_STATE_VISUAL_CLEAR,
        error: undefined,
      });
    }
    return { ok: true, qr: this.getQrStateForUser(ownerUserId) };
  }

  async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    if (!client) {
      return false;
    }
    try {
      const res = await client.checkAuthorization();
      return res === true;
    } catch {
      return false;
    }
  }

  async disconnectAll(): Promise<void> {
    this.clearSessionPersistSchedule();
    for (const userId of Array.from(this.qrPasswordDeferredByUserId.keys())) {
      this.rejectQrPasswordWait(userId, new Error('Сервис останавливается'));
    }
    for (const userId of Array.from(this.clientsByUserId.keys())) {
      const client = this.clientsByUserId.get(userId);
      if (!client) continue;
      try {
        await this.persistConnectedSessionStringIfChanged(client);
      } catch (e) {
        this.logger.warn(`Userbot session persist before shutdown: ${formatError(e)}`);
      }
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
    for (const userId of Array.from(this.qrClientByUserId.keys())) {
      const client = this.qrClientByUserId.get(userId);
      if (!client) continue;
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.clientsByUserId.clear();
    this.messageHandlerRegisteredByUserId.clear();
    this.qrClientByUserId.clear();
  }

  private async attachClient(client: TelegramClient, ownerUserId: string): Promise<void> {
    this.authKeyDuplicateBackoffUntilMs = 0;
    const owner = String(ownerUserId ?? '').trim();
    if (!owner) {
      throw new BadRequestException('Пользователь не определен для userbot');
    }
    const prev = this.clientsByUserId.get(owner);
    if (prev && prev !== client) {
      try {
        await this.persistConnectedSessionStringIfChanged(prev);
      } catch (e) {
        this.logger.warn(`Userbot session persist before replace: ${formatError(e)}`);
      }
      await prev.disconnect();
      this.messageHandlerRegisteredByUserId.delete(owner);
    }
    this.clientsByUserId.set(owner, client);
    if (!this.messageHandlerRegisteredByUserId.has(owner)) {
      const handler = this.inboundHandler;
      if (handler) {
        client.addEventHandler(handler, new NewMessage({ incoming: true }));
        client.addEventHandler(handler, new EditedMessage({ incoming: true }));
        this.messageHandlerRegisteredByUserId.add(owner);
      } else {
        this.logger.warn('TelegramUserbotClientService: inboundHandler не задан до addEventHandler');
      }
    }
    if (this.afterAttachHook) {
      await this.afterAttachHook();
    }
    try {
      await this.persistConnectedSessionStringIfChanged(client);
    } catch (e) {
      this.logger.warn(`Userbot session persist after attach: ${formatError(e)}`);
    }
    this.ensureSessionPersistSchedule();
  }

  private async stopQrClient(userId: string | null): Promise<void> {
    if (!userId) {
      return;
    }
    this.rejectQrPasswordWait(userId, new Error('Прервано'));
    const client = this.qrClientByUserId.get(userId);
    if (!client) return;
    try {
      await client.disconnect();
    } finally {
      this.qrClientByUserId.delete(userId);
    }
  }

  private async getApiCreds(): Promise<{ apiId: number; apiHash: string }> {
    const apiIdRaw = (await this.settings.get('TELEGRAM_USERBOT_API_ID'))?.trim();
    const apiHash = (await this.settings.get('TELEGRAM_USERBOT_API_HASH'))?.trim();
    const apiId = apiIdRaw ? parseInt(apiIdRaw, 10) : Number.NaN;
    if (!Number.isFinite(apiId) || !apiHash) {
      throw new BadRequestException(
        'Нужно заполнить TELEGRAM_USERBOT_API_ID и TELEGRAM_USERBOT_API_HASH в настройках.',
      );
    }
    return { apiId, apiHash };
  }

  private async getTelegramClientOptions(): Promise<Record<string, unknown>> {
    const options: Record<string, unknown> = { connectionRetries: 5 };
    const mtProxy = await this.getMtProxyConfig();
    if (mtProxy) {
      options.proxy = mtProxy;
    }
    return options;
  }

  private async getMtProxyConfig(): Promise<
    { ip: string; port: number; secret: string; MTProxy: true } | null
  > {
    const raw = (await this.settings.get('TELEGRAM_USERBOT_MTPROXY_URL'))?.trim();
    if (!raw) {
      return null;
    }

    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new BadRequestException(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: ожидается ссылка вида https://t.me/proxy?server=...&port=...&secret=...',
      );
    }

    const server = url.searchParams.get('server')?.trim() ?? '';
    const secret = url.searchParams.get('secret')?.trim() ?? '';
    const portRaw = url.searchParams.get('port')?.trim() ?? '';
    const port = Number.parseInt(portRaw, 10);

    if (!server || !secret || !Number.isFinite(port) || port < 1 || port > 65535) {
      throw new BadRequestException(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: нужны параметры server, port (1..65535) и secret.',
      );
    }

    return {
      ip: server,
      port,
      secret,
      MTProxy: true,
    };
  }
}
