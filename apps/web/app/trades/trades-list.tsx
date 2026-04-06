import { formatDateTimeRu } from '../../lib/datetime';
import { DeleteTradeButton } from './delete-trade-button';
import { PnlEditControl } from './pnl-edit-control';
import { RestoreTradeButton } from './restore-trade-button';
import { SourceSelect } from './source-select';
import { TelegramSourceLink } from './telegram-source-link';
import { TradeParamsBlock } from './trade-params-block';

type TradeListItem = {
  id: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  realizedPnl: number | null;
  createdAt: string;
  deletedAt?: string | null;
  entries: string | number[];
  stopLoss: number;
  takeProfits: string | number[];
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  martingaleStep?: number | null;
  finalPnl?: number | null;
  pnlBreakdown?: {
    source: 'closed_pnl' | 'execution_fallback' | 'unavailable';
    requestWindow: {
      startTime: number;
      endTime: number;
    };
    grossPnl: number | null;
    fees: {
      openFee: number | null;
      closeFee: number | null;
      execFee: number | null;
      total: number | null;
    };
    details?: string;
    error?: string;
  } | null;
  events?: Array<{
    id: string;
    type: string;
    payload: string | null;
    createdAt: string;
  }>;
};

type TradeEvent = {
  id: string;
  type: string;
  payload: string | null;
  createdAt: string;
};

type Props = {
  items: TradeListItem[];
  sourceOptions: string[];
};

function getTradeOutcomeLabel(status: string, pnl: number | null | undefined): string {
  if (status === 'CLOSED_WIN') return 'прибыль';
  if (status === 'CLOSED_LOSS') return 'убыток';
  if (status === 'CLOSED_MIXED') return 'смешанный результат';
  if (status === 'FAILED') return 'ошибка';
  if (status === 'ORDERS_PLACED' || status === 'OPEN' || status === 'PARSED') {
    return 'в работе';
  }
  if (typeof pnl === 'number' && Number.isFinite(pnl)) {
    if (pnl > 0) return 'прибыль';
    if (pnl < 0) return 'убыток';
  }
  return status.toLowerCase();
}

function formatNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4);
}

function buildPnlTooltip(s: TradeListItem): string {
  const finalPnl = s.finalPnl ?? s.realizedPnl;
  const base = [
    `Итог сделки: ${getTradeOutcomeLabel(s.status, finalPnl ?? null)}`,
    `Финальный PnL (Bybit): ${formatNum(finalPnl)}`,
  ];
  if (!s.pnlBreakdown) {
    return base.join('\n');
  }
  const rows = [
    ...base,
    `startTime: ${String(s.pnlBreakdown.requestWindow.startTime)}`,
    `endTime: ${String(s.pnlBreakdown.requestWindow.endTime)}`,
    `PnL до комиссий (gross): ${formatNum(s.pnlBreakdown.grossPnl)}`,
    `openFee: ${formatNum(s.pnlBreakdown.fees.openFee)}`,
    `closeFee: ${formatNum(s.pnlBreakdown.fees.closeFee)}`,
    `execFee: ${formatNum(s.pnlBreakdown.fees.execFee)}`,
    `Всего комиссий: ${formatNum(s.pnlBreakdown.fees.total)}`,
  ];
  if (s.pnlBreakdown.source === 'closed_pnl') rows.push('Источник: closed PnL Bybit');
  if (s.pnlBreakdown.source === 'execution_fallback') rows.push('Источник: execution fallback');
  if (s.pnlBreakdown.details) rows.push(`Примечание: ${s.pnlBreakdown.details}`);
  if (s.pnlBreakdown.error) rows.push(`Ошибка: ${s.pnlBreakdown.error}`);
  return rows.join('\n');
}

function PnlDisplay({
  pnl,
  title,
}: {
  pnl: number | null | undefined;
  title?: string;
}) {
  if (pnl === null || pnl === undefined) {
    return <span title={title}>—</span>;
  }
  const classes = ['pnl'];
  if (pnl > 0) classes.push('pnlPos');
  else if (pnl < 0) classes.push('pnlNeg');
  else classes.push('pnlZero');
  return (
    <span className={classes.join(' ')} title={title}>
      {pnl.toFixed(4)}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const d = direction.toLowerCase();
  const cls =
    d === 'long'
      ? 'tradeDirBadge tradeDirLong'
      : d === 'short'
        ? 'tradeDirBadge tradeDirShort'
        : 'tradeDirBadge tradeDirNeutral';
  return <span className={cls}>{direction}</span>;
}

export function TradesList({ items, sourceOptions }: Props) {
  const renderEvent = (raw: TradeEvent) => {
    let payload: unknown = null;
    if (raw.payload) {
      try {
        payload = JSON.parse(raw.payload);
      } catch {
        payload = raw.payload;
      }
    }
    let details = '';
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      if (raw.type === 'CANCELLED_BY_CHAT') {
        details =
          typeof p.reason === 'string' && p.reason.trim().length > 0
            ? p.reason
            : 'сигнал отменён сообщением из чата';
      } else if (raw.type === 'BYBIT_CLOSE_SUCCESS') {
        const cancelledOrders =
          typeof p.cancelledOrders === 'number' ? p.cancelledOrders : 0;
        const closedPositions =
          typeof p.closedPositions === 'number' ? p.closedPositions : 0;
        details = `ордера отменены: ${cancelledOrders}, позиции закрыты: ${closedPositions}`;
      } else if (raw.type === 'BYBIT_CLOSE_PENDING') {
        details = `Bybit ещё не подтвердил полное закрытие ордеров/позиции`;
      } else if (raw.type === 'BYBIT_CLOSE_FAILED') {
        const errors = Array.isArray(p.errors)
          ? p.errors
              .map((v) => String(v ?? '').trim())
              .filter(Boolean)
              .slice(0, 2)
              .join(' | ')
          : '';
        details = errors || 'ошибка закрытия сделки на Bybit';
      } else if (raw.type === 'REENTRY_UPDATED') {
        const changed = p.changedFields as Record<string, unknown> | undefined;
        const sl = changed?.stopLoss ? 'SL' : '';
        const tp = changed?.takeProfits ? 'TP' : '';
        details = [sl, tp].filter(Boolean).join(', ');
      } else if (raw.type === 'REENTRY_REPLACED_OLD') {
        details = 'старый сигнал заменен';
      } else if (raw.type === 'REENTRY_REPLACED_NEW') {
        details = 'новый сигнал создан';
      } else if (raw.type === 'TELEGRAM_LINK_UPDATED') {
        const pFrom = p.from as { sourceChatId?: unknown; sourceMessageId?: unknown } | undefined;
        const pTo = p.to as { sourceChatId?: unknown; sourceMessageId?: unknown } | undefined;
        const short = (v: unknown) =>
          typeof v === 'string' && v.length > 10 ? `${v.slice(0, 6)}…` : String(v ?? '—');
        details = `было chat ${short(pFrom?.sourceChatId)} / msg ${short(pFrom?.sourceMessageId)} → стало chat ${short(pTo?.sourceChatId)} / msg ${short(pTo?.sourceMessageId)}`;
      } else if (raw.type === 'TP_SL_STEPPED') {
        const filledCount = typeof p.filledCount === 'number' ? p.filledCount : null;
        const anchorFilledCount =
          typeof p.anchorFilledCount === 'number' ? p.anchorFilledCount : filledCount;
        const startTpNumber =
          typeof p.startTpNumber === 'number' ? p.startTpNumber : 1;
        const prevSl = typeof p.previousSl === 'number' ? p.previousSl : null;
        const nextSl = typeof p.newSl === 'number' ? p.newSl : null;
        const fmtSl = (v: number | null) =>
          v !== null ? v.toLocaleString('ru-RU', { maximumFractionDigits: 8 }) : '—';
        const target =
          anchorFilledCount === 1
            ? 'безубыток'
            : anchorFilledCount !== null
              ? `TP${anchorFilledCount - 1}`
              : '—';
        const startHint =
          startTpNumber > 1 ? ` · старт лестницы с TP${startTpNumber}` : '';
        details = `после TP${filledCount ?? '?'} → SL ${fmtSl(prevSl)} → ${fmtSl(nextSl)} (${target})${startHint}`;
      }
    }
    const titles: Record<string, string> = {
      CANCELLED_BY_CHAT: 'Отмена в чате',
      BYBIT_CLOSE_SUCCESS: 'Сделка закрыта на Bybit',
      BYBIT_CLOSE_PENDING: 'Закрытие ожидает подтверждения Bybit',
      BYBIT_CLOSE_FAILED: 'Ошибка закрытия на Bybit',
      REENTRY_UPDATED: 'Перезаход обновил параметры',
      REENTRY_REPLACED_OLD: 'Старый сигнал заменён',
      REENTRY_REPLACED_NEW: 'Создан новый сигнал',
      TELEGRAM_LINK_UPDATED: 'Привязка к сообщению Telegram',
      TP_SL_STEPPED: 'SL подтянут после TP',
    };
    const title = titles[raw.type] ?? raw.type;
    return details ? `${title}: ${details}` : title;
  };

  return (
    <ul className="tradesCardsGrid">
      {items.map((s) => (
        <li
          key={s.id}
          className="tradeCard tradeCardRich"
          style={s.deletedAt ? { opacity: 0.6 } : undefined}
        >
          <div className="tradeCardTop">
            <div>
              <div className="tradeCardPair">{s.pair}</div>
              <div className="tradeCardSubtleId">{s.id.slice(0, 8)}</div>
            </div>
            <DirectionBadge direction={s.direction} />
          </div>

          <div className="tradeCardMeta tradeCardMetaDense">
            <div className="tradeCardMetaRow">
              <span className="tradeCardLabel">Статус</span>
              <span className="tradeCardValue tradeCardMono">{s.status}</span>
            </div>
            <div className="tradeCardMetaRow">
              <span className="tradeCardLabel">Дата</span>
              <span className="tradeCardValue">{formatDateTimeRu(s.createdAt)}</span>
            </div>
            <div className="tradeCardMetaRow tradeCardPnlRow">
              <span className="tradeCardLabel">Финальный PnL</span>
              <span className="tradeCardValue">
                <PnlEditControl
                  signalId={s.id}
                  status={s.status}
                  realizedPnl={s.realizedPnl}
                  disabled={Boolean(s.deletedAt)}
                >
                  <PnlDisplay
                    pnl={s.finalPnl ?? s.realizedPnl}
                    title={buildPnlTooltip(s)}
                  />
                </PnlEditControl>
              </span>
            </div>
            <div className="tradeCardMetaRow">
              <span className="tradeCardLabel">Итог сделки</span>
              <span className="tradeCardValue">
                {getTradeOutcomeLabel(s.status, s.finalPnl ?? s.realizedPnl)}
              </span>
            </div>
          </div>

          <div className="tradeCardBlock">
            <span className="tradeCardLabel">Источник</span>
            {s.deletedAt ? (
              <span className="tradeCardMuted">{s.source ?? '—'}</span>
            ) : (
              <SourceSelect
                signalId={s.id}
                status={s.status}
                currentSource={s.source}
                options={sourceOptions}
              />
            )}
          </div>

          <div className="tradeCardBlock">
            <span className="tradeCardLabel">Telegram (userbot)</span>
            <TelegramSourceLink
              signalId={s.id}
              status={s.status}
              deletedAt={s.deletedAt}
              sourceChatId={s.sourceChatId ?? null}
              sourceMessageId={s.sourceMessageId ?? null}
            />
          </div>

          <div className="tradeCardParams">
            <TradeParamsBlock signal={s} />
          </div>

          <div className="tradeCardBlock">
            <span className="tradeCardLabel">События</span>
            {s.events && s.events.length > 0 ? (
              <details>
                <summary className="tradeCardSummary">
                  {s.events[0] ? renderEvent(s.events[0]) : 'Показать'}
                </summary>
                <div className="tradeCardMuted" style={{ marginTop: '0.4rem' }}>
                  {s.events.map((e) => (
                    <div key={e.id} style={{ marginBottom: '0.45rem' }}>
                      <div>{renderEvent(e)}</div>
                      <div style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                        {formatDateTimeRu(e.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <span className="tradeCardMuted">—</span>
            )}
          </div>

          <div className="tradeCardActions">
            {s.deletedAt ? (
              <RestoreTradeButton tradeId={s.id} pair={s.pair} />
            ) : (
              <DeleteTradeButton tradeId={s.id} pair={s.pair} status={s.status} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
