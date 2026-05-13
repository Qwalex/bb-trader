import type { DashboardActivityItemDto, DashboardActivityTone } from './orders-dashboard-activity.types';

const PREVIEW_MAX = 120;

export const DASHBOARD_ACTIVITY_INGEST_STATUSES = [
  'placed',
  'place_error',
  'parse_error',
  'parse_incomplete',
  'blocked_by_setting',
  'cancelled_by_confirmation',
  'duplicate_signal',
  'reentry_placed',
  'reentry_updated',
] as const;

export function truncatePreview(text: string | null | undefined, max = PREVIEW_MAX): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function ingestStatusTone(status: string): DashboardActivityTone {
  switch (status) {
    case 'placed':
    case 'reentry_placed':
    case 'reentry_updated':
      return 'ok';
    case 'blocked_by_setting':
    case 'cancelled_by_confirmation':
    case 'parse_incomplete':
      return 'warn';
    case 'place_error':
    case 'parse_error':
    case 'duplicate_signal':
      return 'err';
    default:
      return 'info';
  }
}

function ingestStatusTitle(status: string): string {
  switch (status) {
    case 'placed':
      return 'Сигнал установлен с канала';
    case 'reentry_placed':
      return 'Перезаход: новая позиция';
    case 'reentry_updated':
      return 'Перезаход: обновлены уровни';
    case 'place_error':
      return 'Ошибка установки ордера';
    case 'parse_error':
      return 'Ошибка распознавания';
    case 'parse_incomplete':
      return 'Неполные данные сигнала';
    case 'blocked_by_setting':
      return 'Ожидает подтверждение в боте';
    case 'cancelled_by_confirmation':
      return 'Отменено пользователем';
    case 'duplicate_signal':
      return 'Дубликат сигнала';
    default:
      return `Userbot: ${status}`;
  }
}

export function mapIngestRouteToActivity(params: {
  cabinetId: string;
  cabinetName: string;
  status: string;
  chatId: string;
  messageId: string | null;
  textPreview: string;
  error: string | null;
  updatedAt: Date;
  pair: string | null;
  direction: string | null;
}): DashboardActivityItemDto {
  const tone = ingestStatusTone(params.status);
  const parts: string[] = [];
  if (params.pair) {
    parts.push(params.pair);
    if (params.direction) parts.push(params.direction);
  } else {
    parts.push(`чат ${params.chatId}`);
    if (params.messageId) parts.push(`msg ${params.messageId}`);
  }
  const preview = truncatePreview(params.textPreview);
  const err = truncatePreview(params.error ?? '', 160);
  const subtitle = [parts.join(' · '), preview, err ? `Ошибка: ${err}` : '']
    .filter(Boolean)
    .join(' — ');

  return {
    at: params.updatedAt.toISOString(),
    kind: 'ingest',
    cabinetId: params.cabinetId,
    cabinetName: params.cabinetName,
    title: ingestStatusTitle(params.status),
    subtitle: subtitle || undefined,
    tone,
  };
}

export function mapSignalOpenToActivity(params: {
  cabinetId: string;
  cabinetName: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  createdAt: Date;
}): DashboardActivityItemDto {
  const src = params.source?.trim();
  return {
    at: params.createdAt.toISOString(),
    kind: 'signal_open',
    cabinetId: params.cabinetId,
    cabinetName: params.cabinetName,
    title: 'Новый сигнал в системе',
    subtitle: [params.pair, params.direction, params.status, src ? `источник: ${src}` : '']
      .filter(Boolean)
      .join(' · '),
    tone: 'info',
  };
}

export function mapSignalCloseToActivity(params: {
  cabinetId: string;
  cabinetName: string;
  pair: string;
  direction: string;
  status: string;
  realizedPnl: number | null;
  closedAt: Date;
}): DashboardActivityItemDto {
  const pnl = params.realizedPnl;
  const pnlStr =
    pnl != null && Number.isFinite(pnl)
      ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`
      : undefined;
  const tone: DashboardActivityTone =
    pnl != null && pnl < 0 ? 'err' : pnl != null && pnl > 0 ? 'ok' : 'info';
  return {
    at: params.closedAt.toISOString(),
    kind: 'signal_close',
    cabinetId: params.cabinetId,
    cabinetName: params.cabinetName,
    title: 'Сделка закрыта',
    subtitle: [params.pair, params.direction, params.status, pnlStr].filter(Boolean).join(' · '),
    tone,
  };
}
