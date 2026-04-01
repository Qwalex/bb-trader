type TradeParamsSignal = {
  entries: string | number[];
  stopLoss: number;
  takeProfits: string | number[];
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  martingaleStep?: number | null;
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

export function TradeParamsBlock({ signal }: { signal: TradeParamsSignal }) {
  const entries = parseNumArray(signal.entries);
  const tps = parseNumArray(signal.takeProfits);
  const slStr = Number.isFinite(signal.stopLoss)
    ? signal.stopLoss.toLocaleString('ru-RU', { maximumFractionDigits: 8 })
    : '—';
  const levStr =
    signal.leverage != null ? `${signal.leverage}×` : '—';

  return (
    <details className="tradeParamsDetails">
      <summary className="tradeParamsSummary">Параметры сделки</summary>
      <dl className="tradeParamsGrid">
        <dt>Вход</dt>
        <dd>{fmtPrices(entries)}</dd>
        <dt>SL</dt>
        <dd>{slStr}</dd>
        <dt>TP</dt>
        <dd>{fmtPrices(tps)}</dd>
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
