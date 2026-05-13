import Link from 'next/link';

import { BalanceChart } from './BalanceChart';
import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import type {
  DashboardActivityItem,
  DashboardAggregatedBalancePoint,
  DashboardCabinetsSummary,
} from '../home-dashboard.types';

function formatActivityTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function kindLabel(kind: DashboardActivityItem['kind']): string {
  switch (kind) {
    case 'ingest':
      return 'Userbot';
    case 'signal_open':
      return 'Сигнал';
    case 'signal_close':
      return 'Сделка';
    default:
      return '';
  }
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

/** Ожидаемая сумма Σ equity через n дней: equity × (1 + EV%), где EV% = (1+r)^n − 1, r = ожид. PnL/день ÷ equity. */
function fmtEvProjectedEquityUsd(
  totalEquityUsd: number | null | undefined,
  evReturnPercent: number | null | undefined,
): string {
  if (totalEquityUsd == null || !Number.isFinite(totalEquityUsd) || totalEquityUsd <= 0) {
    return '—';
  }
  if (evReturnPercent == null || !Number.isFinite(evReturnPercent)) {
    return '—';
  }
  const projected = totalEquityUsd * (1 + evReturnPercent / 100);
  if (!Number.isFinite(projected)) {
    return '—';
  }
  return `${projected.toFixed(0)} $`;
}

export function DashboardCrossCabinetSection({
  summary,
  aggregatedBalanceHistory,
  activityItems,
  cabinetIdForLinks,
}: {
  summary: DashboardCabinetsSummary | null | undefined;
  aggregatedBalanceHistory: DashboardAggregatedBalancePoint[];
  activityItems: DashboardActivityItem[];
  /** Активный кабинет для ссылки «Сделки». */
  cabinetIdForLinks?: string | null;
}) {
  if (!summary || summary.cabinetCount < 1) {
    return null;
  }

  const wr = summary.avgWinratePercent;
  const pnlNeg = summary.totalPnl < 0;

  return (
    <section className="dashboardSection dashboardCrossSection" style={{ marginBottom: '1.75rem' }}>
      <div className="dashboardCrossHeader">
        <div>
          <h2 className="pageTitle dashboardSectionTitle dashboardCrossTitle">Все кабинеты</h2>
          <p className="dashboardSectionHint dashboardCrossHint">
            Сводка по {summary.cabinetCount}{' '}
            {summary.cabinetCount === 1 ? 'кабинету' : 'кабинетам'} и события за последние 24 часа.
          </p>
        </div>
        {cabinetIdForLinks ? (
          <Link
            className="dashboardCrossTradesLink"
            href={withCabinetPageHref('/trades', cabinetIdForLinks)}
          >
            Сделки →
          </Link>
        ) : null}
      </div>

      <div className="dashboardCrossKpiGrid">
        <div className="dashboardCrossKpi dashboardCrossKpiAccent">
          <span className="dashboardCrossKpiLabel">Σ PnL</span>
          <span className={`dashboardCrossKpiValue${pnlNeg ? ' dashboardCrossKpiNeg' : ''}`}>
            {summary.totalPnl.toFixed(2)} USDT
          </span>
        </div>
        <div className="dashboardCrossKpi">
          <span className="dashboardCrossKpiLabel">Открыто позиций</span>
          <span className="dashboardCrossKpiValue">{summary.totalOpenSignals}</span>
        </div>
        <div className="dashboardCrossKpi">
          <span className="dashboardCrossKpiLabel">Winrate (Σ W/L)</span>
          <span className="dashboardCrossKpiValue">
            {wr != null && Number.isFinite(wr) ? `${wr.toFixed(1)}%` : '—'}
          </span>
          <span className="dashboardCrossKpiMeta">
            {summary.totalWins}W / {summary.totalLosses}L
          </span>
        </div>
        <div className="dashboardCrossKpi">
          <span className="dashboardCrossKpiLabel">Σ Equity</span>
          <span className="dashboardCrossKpiValue">
            {summary.totalEquityUsd != null && Number.isFinite(summary.totalEquityUsd)
              ? `${summary.totalEquityUsd.toFixed(0)} $`
              : '—'}
          </span>
        </div>
        <div className="dashboardCrossKpi">
          <span className="dashboardCrossKpiLabel">Σ Доступно</span>
          <span className="dashboardCrossKpiValue">
            {summary.totalAvailableUsd != null && Number.isFinite(summary.totalAvailableUsd)
              ? `${summary.totalAvailableUsd.toFixed(0)} $`
              : '—'}
          </span>
        </div>
        <div className="dashboardCrossKpi">
          <span className="dashboardCrossKpiLabel">Сообщений userbot (сегодня)</span>
          <span className="dashboardCrossKpiValue">{summary.userbotReadsToday}</span>
          <span className="dashboardCrossKpiMeta">установок: {summary.signalsPlacedToday}</span>
        </div>
        {(summary.cabinetsWithSetupIssues > 0 || summary.cabinetsBalancePaused > 0) && (
          <div className="dashboardCrossKpi dashboardCrossKpiWarn">
            <span className="dashboardCrossKpiLabel">Внимание</span>
            <span className="dashboardCrossKpiMeta">
              {summary.cabinetsWithSetupIssues > 0
                ? `Настройки: ${summary.cabinetsWithSetupIssues} каб. `
                : ''}
              {summary.cabinetsBalancePaused > 0
                ? `Пауза по балансу: ${summary.cabinetsBalancePaused} каб.`
                : ''}
            </span>
          </div>
        )}
      </div>

      <div className="dashboardCrossYieldBlock">
        <h3 className="dashboardCrossSubheading">Доходность (все кабинеты)</h3>
        <div className="dashboardCrossYieldGrid">
          <div className="dashboardCrossKpi">
            <span className="dashboardCrossKpiLabel">APR (реализ.)</span>
            <span className="dashboardCrossKpiValue">
              {fmtPct(summary.crossCabinetAprRealizedPercent)}
            </span>
          </div>
          <div className="dashboardCrossKpi">
            <span className="dashboardCrossKpiLabel">APY (реализ.)</span>
            <span className="dashboardCrossKpiValue">
              {fmtPct(summary.crossCabinetApyRealizedPercent)}
            </span>
          </div>
          <div className="dashboardCrossKpi">
            <span className="dashboardCrossKpiLabel">Прогноз Σ equity, 7 дн.</span>
            <span className="dashboardCrossKpiValue">
              {fmtEvProjectedEquityUsd(summary.totalEquityUsd, summary.crossCabinetEvReturn7dPercent)}
            </span>
          </div>
          <div className="dashboardCrossKpi">
            <span className="dashboardCrossKpiLabel">Прогноз Σ equity, 30 дн.</span>
            <span className="dashboardCrossKpiValue">
              {fmtEvProjectedEquityUsd(summary.totalEquityUsd, summary.crossCabinetEvReturn30dPercent)}
            </span>
          </div>
          <div className="dashboardCrossKpi">
            <span className="dashboardCrossKpiLabel">Прогноз Σ equity, 365 дн.</span>
            <span className="dashboardCrossKpiValue">
              {fmtEvProjectedEquityUsd(summary.totalEquityUsd, summary.crossCabinetEvReturn365dPercent)}
            </span>
          </div>
        </div>
        <p className="dashboardCrossYieldHint">
          APR/APY: (ΣPnL ÷ Σ equity) и сложная годовая за T = max(окно статистики по кабинетам) — как на
          главной. Прогноз Σ equity: текущая сумма балансов × (1 + ожидаемая доходность за период), где
          доходность считается как (1+r)^n − 1 при r = ожид. PnL/день ÷ Σ equity; не прогноз рынка.
        </p>
      </div>

      <div className="dashboardCrossChartBlock">
        <h3 className="dashboardCrossSubheading">Σ Equity по дням (UTC)</h3>
        <div className="dashboardCrossChartWrap">
          <BalanceChart
            data={aggregatedBalanceHistory}
            compact
            balanceLabel="Σ Equity (USDT)"
          />
        </div>
      </div>

      <div className="dashboardActivityWrap">
        <h3 className="dashboardActivityHeading">История за 24 часа</h3>
        {activityItems.length === 0 ? (
          <p className="dashboardActivityEmpty">За выбранный период событий нет.</p>
        ) : (
          <ul className="dashboardActivityList">
            {activityItems.map((row, idx) => (
              <li
                key={`${row.at}|${row.kind}|${row.cabinetId}|${idx}`}
                className={`dashboardActivityRow dashboardActivityTone_${row.tone}`}
              >
                <div className="dashboardActivityTime">{formatActivityTime(row.at)}</div>
                <div className="dashboardActivityBody">
                  <div className="dashboardActivityTop">
                    <span className="dashboardActivityKind">{kindLabel(row.kind)}</span>
                    <span className="dashboardActivityCabinet">{row.cabinetName}</span>
                  </div>
                  <div className="dashboardActivityTitle">{row.title}</div>
                  {row.subtitle ? (
                    <div className="dashboardActivitySubtitle">{row.subtitle}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
