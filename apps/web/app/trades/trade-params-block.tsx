type TradeParamsOrder = {
  orderKind: string;
  price: number | null;
  status: string;
};

type TradeParamsSignal = {
  entries: string | number[];
  stopLoss: number;
  takeProfits: string | number[];
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  martingaleStep?: number | null;
  orders?: TradeParamsOrder[];
};

function parseNumArray(raw: string | number[] | undefined): number[] {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => !Number.isNaN(n));
  }
  if (!raw || typeof raw !== 'string') return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.map(Number).filter((n) => !Number.isNaN(n));
  } catch {
    return [];
  }
}

function fmtPrices(nums: number[]): string {
  if (nums.length === 0) return '—';
  return nums
    .map((n) =>
      n.toLocaleString('ru-RU', {
        maximumFractionDigits: 8,
        minimumFractionDigits: 0,
      }),
    )
    .join(', ');
}

function fmtUsd(n: number): string {
  if (n > 0) {
    return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`;
  }
  return '—';
}

function fmtSumLine(s: TradeParamsSignal): string {
  if (s.orderUsd > 0) return fmtUsd(s.orderUsd);
  if (s.capitalPercent > 0) return `${s.capitalPercent}% депозита`;
  return '—';
}

function fmtMartingaleStep(step: number | null | undefined): string {
  if (typeof step !== 'number' || !Number.isFinite(step)) return '—';
  if (step <= 0) return 'база';
  return `#${Math.trunc(step)}`;
}

/**
 * Возвращает Set цен TP-уровней, по которым есть Filled TP-ордер.
 * Допуск строго меньше половины минимального расстояния между соседними уровнями,
 * иначе одна цена исполнения на бирже может «зажечь» два соседних TP в UI.
 */
function buildFilledTpPrices(
  tps: number[],
  orders: TradeParamsOrder[] | undefined,
): Set<number> {
  const result = new Set<number>();
  if (!orders || orders.length === 0 || tps.length === 0) return result;

  const sorted = [...tps].sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i]! - sorted[i - 1]!;
    if (diff > 1e-12 && diff < minGap) {
      minGap = diff;
    }
  }
  const eps =
    Number.isFinite(minGap) && minGap < Infinity
      ? minGap * 0.49
      : Math.max(Math.abs(sorted[0] ?? 0) * 1e-8, 1e-9);

  for (const tp of tps) {
    const hasFilled = orders.some(
      (o) =>
        o.orderKind === 'TP' &&
        o.price !== null &&
        Math.abs(Number(o.price) - tp) <= eps &&
        o.status.toLowerCase() === 'filled',
    );
    if (hasFilled) {
      result.add(tp);
    }
  }
  return result;
}

function TpLevelList({
  tps,
  filledPrices,
}: {
  tps: number[];
  filledPrices: Set<number>;
}) {
  if (tps.length === 0) return <span>—</span>;
  return (
    <span>
      {tps.map((tp, i) => {
        const filled = filledPrices.has(tp);
        const priceStr = tp.toLocaleString('ru-RU', { maximumFractionDigits: 8 });
        return (
          <span key={i}>
            {i > 0 && <span style={{ opacity: 0.5 }}>, </span>}
            <span
              style={filled ? { color: 'var(--success, #4caf50)', fontWeight: 600 } : undefined}
              title={filled ? 'TP исполнен' : undefined}
            >
              {priceStr}
              {filled && <span style={{ marginLeft: '0.2em' }}>✓</span>}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function TradeParamsBlock({ signal }: { signal: TradeParamsSignal }) {
  const entries = parseNumArray(signal.entries);
  const tps = parseNumArray(signal.takeProfits);
  const slStr = Number.isFinite(signal.stopLoss)
    ? signal.stopLoss.toLocaleString('ru-RU', { maximumFractionDigits: 8 })
    : '—';
  const levStr =
    signal.leverage != null ? `${signal.leverage}×` : '—';

  const filledTpPrices = buildFilledTpPrices(tps, signal.orders);

  return (
    <details className="tradeParamsDetails">
      <summary className="tradeParamsSummary">Параметры сделки</summary>
      <dl className="tradeParamsGrid">
        <dt>Вход</dt>
        <dd>{fmtPrices(entries)}</dd>
        <dt>SL</dt>
        <dd>{slStr}</dd>
        <dt>TP</dt>
        <dd><TpLevelList tps={tps} filledPrices={filledTpPrices} /></dd>
        <dt>Плечо</dt>
        <dd>{levStr}</dd>
        <dt>Сумма входа</dt>
        <dd title={signal.orderUsd <= 0 && signal.capitalPercent > 0 ? 'Доля от баланса' : undefined}>
          {fmtSumLine(signal)}
        </dd>
        <dt>Мартингейл</dt>
        <dd title="Номер шага для источника на момент создания сделки">
          {fmtMartingaleStep(signal.martingaleStep)}
        </dd>
      </dl>
    </details>
  );
}
