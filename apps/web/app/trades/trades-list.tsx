import { formatDateTimeRu } from '../../lib/datetime';
import { DeleteTradeButton } from './delete-trade-button';
import { PnlEditControl } from './pnl-edit-control';
import { RestoreTradeButton } from './restore-trade-button';
import { SourceSelect } from './source-select';
import { TradeParamsBlock } from './trade-params-block';

type TradeListItem = {
  id: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  realizedPnl: number | null;
  createdAt: string;
  deletedAt?: string | null;
  entries: string | number[];
  stopLoss: number;
  takeProfits: string | number[];
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
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

function PnlDisplay({ pnl }: { pnl: number | null | undefined }) {
  if (pnl === null || pnl === undefined) {
    return <>—</>;
  }
  const classes = ['pnl'];
  if (pnl > 0) classes.push('pnlPos');
  else if (pnl < 0) classes.push('pnlNeg');
  else classes.push('pnlZero');
  return (
    <span className={classes.join(' ')} title={`PnL: ${pnl}`}>
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
    if (raw.type === 'CANCELLED_BY_CHAT') {
      return 'Отмена в чате';
    }
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
      if (raw.type === 'REENTRY_UPDATED') {
        const changed = p.changedFields as Record<string, unknown> | undefined;
        const sl = changed?.stopLoss ? 'SL' : '';
        const tp = changed?.takeProfits ? 'TP' : '';
        details = [sl, tp].filter(Boolean).join(', ');
      } else if (raw.type === 'REENTRY_REPLACED_OLD') {
        details = 'старый сигнал заменен';
      } else if (raw.type === 'REENTRY_REPLACED_NEW') {
        details = 'новый сигнал создан';
      }
    }
    return details ? `${raw.type}: ${details}` : raw.type;
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
              <span className="tradeCardLabel">PnL</span>
              <span className="tradeCardValue">
                <PnlEditControl
                  signalId={s.id}
                  status={s.status}
                  realizedPnl={s.realizedPnl}
                  disabled={Boolean(s.deletedAt)}
                >
                  <PnlDisplay pnl={s.realizedPnl} />
                </PnlEditControl>
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
                    <div key={e.id} style={{ marginBottom: '0.25rem' }}>
                      {renderEvent(e)}
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
