import Link from 'next/link';

import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import type {
  DashboardActivityItem,
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

export function DashboardCrossCabinetSection({
  summary,
  activityItems,
  cabinetIdForLinks,
}: {
  summary: DashboardCabinetsSummary | null | undefined;
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
