import { formatDateTimeRu } from '../../lib/datetime';
import { DeleteTradeButton } from './delete-trade-button';
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
                    <PnlDisplay pnl={s.realizedPnl} />
                  </td>
                  <td>{formatDateTimeRu(s.createdAt)}</td>
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
                  <PnlDisplay pnl={s.realizedPnl} />
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
