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
      } else if (raw.type === 'CANCELLED_BY_CHAT') {
        details = 'отмена в чате';
      } else if (raw.type === 'REENTRY_REPLACED_OLD') {
        details = 'старый сигнал заменен';
      } else if (raw.type === 'REENTRY_REPLACED_NEW') {
        details = 'новый сигнал создан';
      }
    }
    return details ? `${raw.type}: ${details}` : raw.type;
  };

  return (
    <>
      <div className="tradesDesktopOnly">
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Пара</th>
                <th>Сторона</th>
                <th>Параметры</th>
                <th>Статус</th>
                <th className="tradeSourceCell">Источник</th>
                <th>PnL</th>
                <th>Дата</th>
                <th>Манипуляции</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} style={s.deletedAt ? { opacity: 0.6 } : undefined}>
                  <td>{s.pair}</td>
                  <td>{s.direction}</td>
                  <td className="tradeParamsCell">
                    <TradeParamsBlock signal={s} />
                  </td>
                  <td>{s.status}</td>
                  <td className="tradeSourceCell">
                    {s.deletedAt ? (
                      <span style={{ color: 'var(--muted)' }}>{s.source ?? '—'}</span>
                    ) : (
                      <SourceSelect
                        signalId={s.id}
                        status={s.status}
                        currentSource={s.source}
                        options={sourceOptions}
                      />
                    )}
                  </td>
                  <td>
                    <PnlEditControl
                      signalId={s.id}
                      status={s.status}
                      realizedPnl={s.realizedPnl}
                      disabled={Boolean(s.deletedAt)}
                    >
                      <PnlDisplay pnl={s.realizedPnl} />
                    </PnlEditControl>
                  </td>
                  <td>{formatDateTimeRu(s.createdAt)}</td>
                  <td style={{ minWidth: 260 }}>
                    {s.events && s.events.length > 0 ? (
                      <details>
                        <summary style={{ cursor: 'pointer' }}>
                          {s.events[0] ? renderEvent(s.events[0]) : 'Показать'}
                        </summary>
                        <div style={{ marginTop: '0.4rem', color: 'var(--muted)' }}>
                          {s.events.map((e) => (
                            <div key={e.id} style={{ marginBottom: '0.25rem' }}>
                              {renderEvent(e)}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {s.deletedAt ? (
                      <RestoreTradeButton tradeId={s.id} pair={s.pair} />
                    ) : (
                      <DeleteTradeButton
                        tradeId={s.id}
                        pair={s.pair}
                        status={s.status}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="tradesMobileOnly">
        {items.map((s) => (
          <li
            key={s.id}
            className="tradeCard"
            style={s.deletedAt ? { opacity: 0.6 } : undefined}
          >
            <div className="tradeCardTop">
              <span className="tradeCardPair">{s.pair}</span>
              <DirectionBadge direction={s.direction} />
            </div>
            <div className="tradeCardMeta">
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
              <span className="tradeCardLabel">Манипуляции</span>
              {s.events && s.events.length > 0 ? (
                <div className="tradeCardMuted">
                  {s.events.slice(0, 3).map((e) => (
                    <div key={e.id}>{renderEvent(e)}</div>
                  ))}
                </div>
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
    </>
  );
}
