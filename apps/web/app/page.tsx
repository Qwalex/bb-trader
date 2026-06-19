import { DashboardCrossCabinetSection } from './components/DashboardCrossCabinetSection';
import { DashboardCabinetInactiveBanner } from './components/DashboardCabinetInactiveBanner';
import { DashboardTutorialCta } from './components/DashboardTutorialCta';
import { BalanceChart, type BalancePoint } from './components/BalanceChart';
import { DashboardTodoList, type DashboardTodoItem } from './components/DashboardTodoList';
import { PnlChart } from './components/PnlChart';
import { LiveExposurePanel } from './components/LiveExposurePanel';
import { StuckTradesBanner } from './trades/stuck-trades-banner';
import { SessionInfoBar } from './components/SessionInfoBar';

import Link from 'next/link';
import { cookies } from 'next/headers';

import { withCabinetPageHref } from '../lib/cabinet-page-href.util';
import { fetchJsonCached } from '../lib/api-server-cache';
import { getServerI18n } from '../lib/i18n/server';
import { searchParamFirst } from '../lib/search-param.util';
import type {
  ConnectedGroupItem,
  DashboardActivityItem,
  DashboardAggregatedBalancePoint,
  DashboardCabinetCard,
  DashboardCabinetsSummary,
} from './home-dashboard.types';
import { formatDashboardDurationMs, formatDashboardRatioPercent, mergeDashboardSourceOptions, sortDashboardCabinetCardsForDisplay } from './home-dashboard.util';

type Stats = {
  source?: string | null;
  winrate: number;
  wins: number;
  losses: number;
  totalClosed: number;
  totalPnl: number;
  openSignals: number;
  avgProfitPnl: number;
  avgLossPnl: number;
  closedPerDayAvg: number;
  statsPeriodDays: number;
  liquidationTotal: number;
  liquidationBySource: Array<{ source: string | null; count: number }>;
  liquidationByLeverage: Array<{ leverage: number | null; count: number }>;
};

type PnlPoint = { date: string; pnl: number };
type SourceStatsItem = {
  source: string | null;
  winrate: number;
  wins: number;
  losses: number;
  wL: string;
  totalClosed: number;
  openSignals: number;
  totalPnl: number;
  statsPeriodDays: number;
};
type TopSources = {
  byPnl: SourceStatsItem[];
  byWinrate: SourceStatsItem[];
  byWorstPnl: SourceStatsItem[];
  byWorstWinrate: SourceStatsItem[];
  worstWinrate: SourceStatsItem | null;
  bestWinrate: SourceStatsItem | null;
};
type SettingsRaw = {
  settings: { key: string; value: string }[];
};
type UserbotStatus = {
  connected?: boolean;
  credentials?: {
    sessionConfigured?: boolean;
  };
  balanceGuard?: {
    minBalanceUsd: number;
    balanceUsd: number | null;
    totalBalanceUsd: number | null;
    paused: boolean;
    reason?: string;
  };
};

type AuthMe = {
  ok: boolean;
  userId?: string | null;
  login?: string | null;
  role?: string | null;
};

type CabinetItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getServerI18n();
  const cookieStore = await cookies();
  const cabinetIdFromCookie = cookieStore.get('cabinet_id')?.value?.trim() ?? '';
  const sp = await searchParams;
  const source = typeof sp.source === 'string' ? sp.source.trim() : '';
  const cabinetIdFromQuery = searchParamFirst(sp.cabinetId);
  const cabinetId = cabinetIdFromQuery || cabinetIdFromCookie;
  let stats: Stats | null = null;
  let pnl: PnlPoint[] = [];
  let top: TopSources | null = null;
  let sourceOptions: string[] = [];
  let userbotStatus: UserbotStatus | null = null;
  let authMe: AuthMe | null = null;
  let cabinetItems: CabinetItem[] = [];
  let dashboardCabinetCards: DashboardCabinetCard[] = [];
  let dashboardCabinetsSummary: DashboardCabinetsSummary | null = null;
  let dashboardAggregatedBalanceHistory: DashboardAggregatedBalancePoint[] = [];
  let dashboardActivityItems: DashboardActivityItem[] = [];
  let connectedGroups: ConnectedGroupItem[] = [];
  let err: string | null = null;
  const q = new URLSearchParams();
  if (source) q.set('source', source);
  const qs = q.toString();
  const [
    statsRes,
    pnlRes,
    topRes,
    sourcesFromDbRes,
    settingsEffectiveRes,
    authMeRes,
    cabinetsRes,
    userbotRes,
    dashboardCabinetsRes,
    activityRes,
    connectedGroupsRes,
    balanceHistoryRes,
    dashboardTodosRes,
  ] = await Promise.allSettled([
    fetchJsonCached<Stats>(`/orders/stats${qs ? `?${qs}` : ''}`, undefined, cabinetId),
    fetchJsonCached<PnlPoint[]>(
      `/orders/pnl-series?bucket=day${source ? `&source=${encodeURIComponent(source)}` : ''}`,
      undefined,
      cabinetId,
    ),
    fetchJsonCached<TopSources>('/orders/top-sources?limit=5', undefined, cabinetId),
    fetchJsonCached<string[]>('/orders/sources', undefined, cabinetId),
    fetchJsonCached<SettingsRaw>('/settings/effective', undefined, cabinetId),
    fetchJsonCached<AuthMe>('/auth/me', undefined, cabinetId),
    fetchJsonCached<{ items?: CabinetItem[] }>('/cabinets', undefined, cabinetId),
    fetchJsonCached<UserbotStatus>('/telegram-userbot/status', undefined, cabinetId),
    fetchJsonCached<{
      items?: DashboardCabinetCard[];
      summary?: DashboardCabinetsSummary;
      aggregatedBalanceHistory?: DashboardAggregatedBalancePoint[];
    }>('/orders/dashboard-cabinets', undefined, cabinetId),
    fetchJsonCached<{ items?: DashboardActivityItem[] }>(
      '/orders/dashboard-activity?hours=24&limit=80',
      undefined,
      cabinetId,
    ),
    fetchJsonCached<{ items?: ConnectedGroupItem[] }>(
      '/telegram-userbot/dashboard-connected-groups',
      undefined,
      cabinetId,
    ),
    fetchJsonCached<{ points: BalancePoint[] }>(
      '/bybit/balance-history?days=30',
      undefined,
      cabinetId,
    ),
    fetchJsonCached<{ items: DashboardTodoItem[] }>(
      '/settings/dashboard-todos',
      undefined,
      cabinetId,
    ),
  ]);
  const loadErrors: string[] = [];
  if (statsRes.status === 'fulfilled') {
    stats = statsRes.value;
  } else {
    loadErrors.push('stats');
  }
  if (pnlRes.status === 'fulfilled') {
    pnl = pnlRes.value;
  } else {
    loadErrors.push('pnl-series');
  }
  if (topRes.status === 'fulfilled') {
    top = topRes.value;
  } else {
    loadErrors.push('top-sources');
  }
  if (sourcesFromDbRes.status === 'fulfilled' && settingsEffectiveRes.status === 'fulfilled') {
    sourceOptions = mergeDashboardSourceOptions(
      sourcesFromDbRes.value,
      settingsEffectiveRes.value.settings,
    );
  } else {
    loadErrors.push('sources');
  }
  if (loadErrors.length > 0) {
    err = `${t('dashboard.partialLoad', { parts: loadErrors.join(', ') })} — ${t('dashboard.apiHint')}`;
  }
  let balanceHistory: BalancePoint[] = [];
  if (authMeRes.status === 'fulfilled') {
    authMe = authMeRes.value;
  }
  if (cabinetsRes.status === 'fulfilled') {
    cabinetItems = Array.isArray(cabinetsRes.value.items) ? cabinetsRes.value.items : [];
  }
  if (userbotRes.status === 'fulfilled') {
    userbotStatus = userbotRes.value;
  }
  if (dashboardCabinetsRes.status === 'fulfilled') {
    const dc = dashboardCabinetsRes.value;
    dashboardCabinetCards = Array.isArray(dc.items) ? dc.items : [];
    dashboardCabinetsSummary = dc.summary ?? null;
    dashboardAggregatedBalanceHistory = Array.isArray(dc.aggregatedBalanceHistory)
      ? dc.aggregatedBalanceHistory
      : [];
  }
  if (activityRes.status === 'fulfilled') {
    dashboardActivityItems = Array.isArray(activityRes.value.items)
      ? activityRes.value.items
      : [];
  }
  if (connectedGroupsRes.status === 'fulfilled') {
    connectedGroups = Array.isArray(connectedGroupsRes.value.items)
      ? connectedGroupsRes.value.items
      : [];
  }
  if (balanceHistoryRes.status === 'fulfilled') {
    balanceHistory = balanceHistoryRes.value.points ?? [];
  }
  let dashboardTodos: DashboardTodoItem[] = [];
  if (dashboardTodosRes.status === 'fulfilled') {
    dashboardTodos = Array.isArray(dashboardTodosRes.value.items)
      ? dashboardTodosRes.value.items
      : [];
  }
  const currentCabinet =
    (cabinetId ? cabinetItems.find((c) => c.id === cabinetId) : null) ??
    cabinetItems.find((c) => c.isDefault) ??
    cabinetItems[0] ??
    null;
  const guard = userbotStatus?.balanceGuard;
  /** Тот же источник, что /telegram-userbot/status на этой странице — не дублируем ложное «подключите». */
  const userbotReadyOnDashboard = Boolean(
    userbotStatus?.connected || userbotStatus?.credentials?.sessionConfigured,
  );
  const equity = guard?.totalBalanceUsd ?? null;
  const wr = stats?.winrate ?? 0;
  const avgProfit = stats?.avgProfitPnl ?? 0;
  const avgLoss = stats?.avgLossPnl ?? 0; // отрицательное число (если есть)
  const tradesPerDay = stats?.closedPerDayAvg ?? 0;

  const avgProfitPct =
    equity && equity > 0 ? (avgProfit / equity) * 100 : null;
  const avgLossPct =
    equity && equity > 0 ? (avgLoss / equity) * 100 : null;
  const evPerTrade =
    (wr / 100) * avgProfit + (1 - wr / 100) * avgLoss; // USDT (loss отрицательный)
  /** Ожидаемый PnL за календарный день (USDT), далее — база для дневной доходности. */
  const expectedPnlPerDay = tradesPerDay * evPerTrade;
  const equityNum = equity != null && equity > 0 ? equity : null;
  /** Дневная доходность как доля от equity: r = PnL_день / equity → баланс через n дней = equity × (1+r)^n */
  const rDaily =
    equityNum != null && equityNum > 0 ? expectedPnlPerDay / equityNum : null;

  const compoundBalanceForecast = (days: number): number | null => {
    if (equityNum == null || rDaily == null) return null;
    return equityNum * Math.pow(1 + rDaily, days);
  };

  const balanceDay = compoundBalanceForecast(1);
  const balanceWeek = compoundBalanceForecast(7);
  const balanceMonth = compoundBalanceForecast(30);
  const balanceYear = compoundBalanceForecast(365);

  const statsPeriodDays = Math.max(1, stats?.statsPeriodDays ?? 1);
  const realizedReturnVsEquity =
    stats && equityNum != null && equityNum > 0 ? stats.totalPnl / equityNum : null;
  const aprRealized =
    realizedReturnVsEquity != null && Number.isFinite(realizedReturnVsEquity)
      ? (realizedReturnVsEquity / statsPeriodDays) * 365 * 100
      : null;
  const apyRealized =
    realizedReturnVsEquity != null &&
    Number.isFinite(realizedReturnVsEquity) &&
    1 + realizedReturnVsEquity > 0
      ? (Math.pow(1 + realizedReturnVsEquity, 365 / statsPeriodDays) - 1) * 100
      : null;

  const formatSourceApr = (row: SourceStatsItem): string => {
    if (equityNum == null || equityNum <= 0) return '—';
    const T = Math.max(1, row.statsPeriodDays ?? 1);
    const apr = (row.totalPnl / equityNum / T) * 365 * 100;
    return Number.isFinite(apr) ? `${apr.toFixed(1)}%` : '—';
  };

  const activeCabinetDisplay =
    currentCabinet?.name?.trim() ||
    (cabinetId.trim() ? `ID ${cabinetId.trim()}` : t('common.notSelected'));
  const selectedDashboardCabinet =
    dashboardCabinetCards.find(
      (c) => c.cabinetId === (currentCabinet?.id ?? cabinetId.trim()),
    ) ?? null;
  const isCurrentCabinetInactive =
    selectedDashboardCabinet?.isActive === false ||
    (currentCabinet != null && currentCabinet.isActive === false);
  const inactiveCabinetCount = dashboardCabinetCards.filter((c) => c.isActive === false).length;
  const displayCabinetCards = sortDashboardCabinetCardsForDisplay(dashboardCabinetCards);

  return (
    <>
      <SessionInfoBar
        login={authMe?.login ?? null}
        userId={authMe?.userId ?? null}
        cabinetName={currentCabinet?.name ?? null}
      />
      <DashboardTutorialCta cabinetId={currentCabinet?.id ?? cabinetId} />
      {err && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {err}
        </p>
      )}
      {guard?.paused && !isCurrentCabinetInactive && (
        <div className="msg err" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            <strong>
              {t('dashboard.balancePausedTitle', {
                name: currentCabinet?.name?.trim() ? currentCabinet.name : t('common.current'),
              })}
            </strong>{' '}
            {guard.reason ??
              t('dashboard.balancePausedDefault', {
                threshold: guard.minBalanceUsd.toFixed(2),
              })}
          </p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.95em', opacity: 0.95 }}>
            {t('dashboard.balancePausedNote')}
          </p>
        </div>
      )}

      <DashboardCrossCabinetSection
        summary={dashboardCabinetsSummary ?? undefined}
        aggregatedBalanceHistory={dashboardAggregatedBalanceHistory}
        activityItems={dashboardActivityItems}
        cabinetIdForLinks={currentCabinet?.id ?? (cabinetId.trim() ? cabinetId : null)}
      />

      {dashboardCabinetCards.length > 0 && (
        <section className="dashboardSection" style={{ marginBottom: '1.5rem' }}>
          <h2 className="pageTitle dashboardSectionTitle">{t('dashboard.cabinetsTitle')}</h2>
          <p className="dashboardSectionHint">
            {t('dashboard.cabinetsHint')}
            {inactiveCabinetCount > 0 ? (
              <>
                {' '}
                {t('dashboard.cabinetsInactive', { count: inactiveCabinetCount })}
              </>
            ) : null}
          </p>
          <div className="dashboardCabinetCards">
            {displayCabinetCards.map((c) => {
              const isSelected =
                (cabinetId && c.cabinetId === cabinetId) ||
                (!cabinetId && currentCabinet?.id === c.cabinetId);
              const cabinetInactive = c.isActive === false;
              const hrefBase =
                source.length > 0
                  ? `/?source=${encodeURIComponent(source)}`
                  : '/';
              const href = withCabinetPageHref(hrefBase, c.cabinetId);
              return (
                <Link
                  key={c.cabinetId}
                  href={href}
                  className={`dashboardCabinetCard${
                    isSelected ? ' dashboardCabinetCardActive' : ''
                  }${cabinetInactive ? ' dashboardCabinetCardInactive' : ''}`}
                >
                  <div className="dashboardCabinetCardHeader">
                    <span className="dashboardCabinetCardName">{c.name}</span>
                    <span className="dashboardCabinetCardBadges">
                      {cabinetInactive ? (
                        <span className="dashboardCabinetBadge dashboardCabinetBadgeInactive">
                          {t('common.inactive')}
                        </span>
                      ) : null}
                      {c.isDefault ? (
                        <span className="dashboardCabinetBadge">{t('common.defaultBadge')}</span>
                      ) : null}
                    </span>
                  </div>
                  {cabinetInactive ? <DashboardCabinetInactiveBanner variant="compact" /> : null}
                  {(() => {
                    const setupWarnings = (c.setupWarnings ?? []).filter((w) => {
                      if (!userbotReadyOnDashboard) return true;
                      return !w.includes(t('dashboard.connectUserbotFilter'));
                    });
                    return setupWarnings.length > 0 ? (
                    <div className="dashboardCabinetWarning">
                      <div className="dashboardCabinetWarningTitle">❗ {t('dashboard.actionsRequired')}</div>
                      <div className="dashboardCabinetWarningList">
                        {setupWarnings.join(' ')}
                      </div>
                    </div>
                    ) : null;
                  })()}
                  {c.balanceGuard?.paused ? (
                    <div className="dashboardCabinetWarning">
                      <div className="dashboardCabinetWarningTitle">
                        ❗ {t('dashboard.autotradePaused')}
                      </div>
                      <div className="dashboardCabinetWarningList">
                        {c.balanceGuard.reason ??
                          t('dashboard.balanceBelow', {
                            threshold: c.balanceGuard.minBalanceUsd.toFixed(2),
                          })}
                      </div>
                    </div>
                  ) : null}
                  <div className="dashboardCabinetCardMetrics">
                    <div>
                      <span className="dashboardCabinetMetricLabel">Winrate</span>
                      <span className="dashboardCabinetMetricValue">{c.winrate.toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.open')}</span>
                      <span className="dashboardCabinetMetricValue">{c.openSignals ?? 0}</span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">W / L</span>
                      <span className="dashboardCabinetMetricValue">
                        {c.wins} / {c.losses}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">PnL</span>
                      <span
                        className={`dashboardCabinetMetricValue${
                          c.totalPnl < 0 ? ' dashboardCabinetMetricNeg' : ''
                        }`}
                      >
                        {c.totalPnl.toFixed(2)} USDT
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.balanceEquity')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {c.totalBalanceUsd != null && Number.isFinite(c.totalBalanceUsd)
                          ? `${c.totalBalanceUsd.toFixed(2)} $`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.available')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {c.availableBalanceUsd != null && Number.isFinite(c.availableBalanceUsd)
                          ? `${c.availableBalanceUsd.toFixed(2)} $`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.avgExecution')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {formatDashboardDurationMs(c.avgSignalExecutionMs)}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.avgIdle')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {formatDashboardDurationMs(c.avgIdlePeriodMs)}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.unused')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {formatDashboardRatioPercent(c.unusedBalanceRatio)}
                      </span>
                    </div>
                    <div>
                      <span className="dashboardCabinetMetricLabel">{t('dashboard.unused30d')}</span>
                      <span className="dashboardCabinetMetricValue">
                        {formatDashboardRatioPercent(c.avgUnusedBalanceRatioMonth)}
                      </span>
                    </div>
                  </div>
                  <span className="dashboardCabinetCardSlug">{c.slug}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {connectedGroups.length > 0 && (
        <section className="dashboardSection" style={{ marginBottom: '1.5rem' }}>
          <h2 className="pageTitle dashboardSectionTitle">{t('dashboard.connectedGroupsTitle')}</h2>
          <p className="dashboardSectionHint">
            {t('dashboard.connectedGroupsHint')}
          </p>
          <ul className="dashboardConnectedGroups">
            {connectedGroups.map((g) => (
              <li key={g.chatId} className="dashboardConnectedGroupChip">
                <span className="dashboardConnectedGroupTitle">{g.title}</span>
                {g.username ? (
                  <span className="dashboardConnectedGroupMeta">@{g.username}</span>
                ) : (
                  <span className="dashboardConnectedGroupMeta mono">{g.chatId}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dashboardSection dashboardActiveCabinetSection">
        <div className="dashboardActiveCabinetHeader">
          <h2 className="pageTitle dashboardSectionTitle dashboardActiveCabinetTitle">
            {t('dashboard.activeCabinetTitle', { name: activeCabinetDisplay })}
          </h2>
          <p className="dashboardSectionHint dashboardActiveCabinetHint">
            {t('dashboard.activeCabinetHint')}
          </p>
          <form className="filters" method="get" action="/">
            {cabinetId ? <input type="hidden" name="cabinetId" value={cabinetId} /> : null}
            <label>
              {t('common.source')}
              <select
                name="source"
                defaultValue={source}
              >
                <option value="">{t('common.all')}</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              style={{
                padding: '0.45rem 0.9rem',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {t('common.show')}
            </button>
            {source && (
              <Link
                href={cabinetId ? withCabinetPageHref('/', cabinetId) : '/'}
                style={{
                  alignSelf: 'end',
                  padding: '0.45rem 0.9rem',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--foreground)',
                  textDecoration: 'none',
                }}
              >
                {t('common.reset')}
              </Link>
            )}
          </form>
          {source ? (
            <p className="dashboardSectionHint dashboardActiveCabinetSourceHint">
              {t('dashboard.sourceFilter', { source })}
            </p>
          ) : null}
        </div>
        {isCurrentCabinetInactive ? (
          <DashboardCabinetInactiveBanner />
        ) : null}
        {stats && (
        <>
          <div className="grid dashboardMetricsGrid">
          <div className="card">
            <h3>Winrate{source ? ` (${t('common.source').toLowerCase()})` : ''}</h3>
            <div className="value">{stats.winrate.toFixed(1)}%</div>
          </div>
          {top?.worstWinrate && (
            <div className="card">
              <h3>{t('dashboard.worstWinrate')}</h3>
              <div className="value">{top.worstWinrate.winrate.toFixed(1)}%</div>
              <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
                {top.worstWinrate.source ?? '—'} | W/L: {top.worstWinrate.wL} | APR:{' '}
                {formatSourceApr(top.worstWinrate)}
              </p>
            </div>
          )}
          {top?.bestWinrate && (
            <div className="card">
              <h3>{t('dashboard.bestWinrate')}</h3>
              <div className="value">{top.bestWinrate.winrate.toFixed(1)}%</div>
              <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
                {top.bestWinrate.source ?? '—'} | W/L: {top.bestWinrate.wL} | APR:{' '}
                {formatSourceApr(top.bestWinrate)}
              </p>
            </div>
          )}
          <div className="card">
            <h3>{source ? t('dashboard.totalPnlSource') : t('dashboard.totalPnl')}</h3>
            <div className="value">{stats.totalPnl.toFixed(2)}</div>
          </div>
          <div className="card">
            <h3>{source ? t('dashboard.aprSource') : 'APR'}</h3>
            <div className="value">
              {aprRealized != null && Number.isFinite(aprRealized)
                ? `${aprRealized.toFixed(1)}%`
                : '—'}
            </div>
            {/* <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              Простая годовая: (ΣPnL ÷ equity) × (365 / T), T = {statsPeriodDays} дн. (окно
              статистики). Без equity — прочерк.
            </p> */}
          </div>
          <div className="card">
            <h3>{source ? t('dashboard.apySource') : 'APY'}</h3>
            <div className="value">
              {apyRealized != null && Number.isFinite(apyRealized)
                ? `${apyRealized.toFixed(1)}%`
                : '—'}
            </div>
            {/* <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              Сложная годовая: (1 + ΣPnL/equity)^(365/T) − 1 за тот же период T.
            </p> */}
          </div>
          <div className="card">
            <h3>{source ? t('dashboard.closedSource') : t('dashboard.closed')}</h3>
            <div className="value">{stats.totalClosed}</div>
          </div>
          <div className="card">
            <h3>W / L</h3>
            <div className="value">
              {stats.wins} / {stats.losses}
            </div>
          </div>
          <div className="card">
            <h3>{source ? t('dashboard.openSignalsSource') : t('dashboard.openSignals')}</h3>
            <div className="value">{stats.openSignals}</div>
          </div>
          <div className="card">
            <h3>{t('dashboard.avgProfit')}</h3>
            <div className="value">{stats.avgProfitPnl.toFixed(2)}</div>
            <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              {avgProfitPct != null
                ? t('dashboard.pctOfEquity', { pct: avgProfitPct.toFixed(2) })
                : t('dashboard.pctUnavailable')}
            </p>
          </div>
          <div className="card">
            <h3>{t('dashboard.avgLoss')}</h3>
            <div className="value">{stats.avgLossPnl.toFixed(2)}</div>
            <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              {avgLossPct != null
                ? t('dashboard.pctOfEquity', { pct: avgLossPct.toFixed(2) })
                : t('dashboard.pctUnavailable')}
            </p>
          </div>
          <div className="card">
            <h3>{t('dashboard.tradesPerDay')}</h3>
            <div className="value">{stats.closedPerDayAvg.toFixed(2)}</div>
          </div>
          <div className="card">
            <h3>{t('dashboard.day1')}</h3>
            <div className="value">
              {balanceDay != null && Number.isFinite(balanceDay)
                ? `${balanceDay.toFixed(2)}$`
                : '—'}
            </div>
            {/* <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              EV/сделка: {evPerTrade.toFixed(2)} · WR {wr.toFixed(1)}% · ожид. PnL/день:{' '}
              {Number.isFinite(expectedPnlPerDay) ? expectedPnlPerDay.toFixed(2) : '—'} USDT
            </p> */}
          </div>
          <div className="card">
            <h3>{t('dashboard.day7')}</h3>
            <div className="value">
              {balanceWeek != null && Number.isFinite(balanceWeek)
                ? `${balanceWeek.toFixed(2)}$`
                : '—'}
            </div>
            {/* <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              Сложный %: equity × (1+r)^n, r = PnL/день ÷ equity
            </p> */}
          </div>
          <div className="card">
            <h3>{t('dashboard.day30')}</h3>
            <div className="value">
              {balanceMonth != null && Number.isFinite(balanceMonth)
                ? `${balanceMonth.toFixed(2)}$`
                : '—'}
            </div>
          </div>
          <div className="card">
            <h3>{t('dashboard.day365')}</h3>
            <div className="value">
              {balanceYear != null && Number.isFinite(balanceYear)
                ? `${balanceYear.toFixed(2)}$`
                : '—'}
            </div>
          </div>
          <div className="card">
            <h3>{t('dashboard.balance')}</h3>
            <div className="value">
              {guard?.totalBalanceUsd != null ? `${guard.totalBalanceUsd.toFixed(2)}$` : '—'}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              {t('dashboard.totalUsdtEquity')}
            </p>
          </div>
          <div className="card">
            <h3>{t('dashboard.availableBalance')}</h3>
            <div className="value">
              {guard?.balanceUsd != null ? `${guard.balanceUsd.toFixed(2)}$` : '—'}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              {t('dashboard.threshold', { value: (guard?.minBalanceUsd ?? 3).toFixed(2) })}
            </p>
          </div>
          </div>
          <DashboardTodoList initialItems={dashboardTodos} layout="below" />
        </>
      )}
      {!stats && <DashboardTodoList initialItems={dashboardTodos} layout="full" />}
      <div className="dashboardActiveChartBlock">
        <h2 className="pageTitle dashboardActiveSubheading">{t('dashboard.aggregateBalanceTitle')}</h2>
        <div className="chartWrap">
          <BalanceChart data={balanceHistory} />
        </div>
      </div>
      {top && (
        <>
          <p className="dashboardActiveFootnote">
            {t('dashboard.aprSourcesHint')}
          </p>
          <div className="grid topSources" style={{ marginTop: '0.5rem' }}>
            <div className="card" style={{ gridColumn: 'span 5' }}>
              <h3>{t('dashboard.topPnl')}</h3>
              <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
                <table className="topSourcesTable">
                  <thead>
                    <tr>
                      <th className="sourceNameCell">{t('dashboard.sourceCol')}</th>
                      <th>PnL</th>
                      <th>APR</th>
                      <th>Winrate</th>
                      <th>W / L</th>
                      <th>{t('dashboard.closed')}</th>
                      <th>{t('dashboard.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.byPnl.map((r) => (
                      <tr key={`pnl-${r.source ?? '—'}`}>
                        <td className="sourceNameCell">
                          <span className="sourceNameText">{r.source ?? '—'}</span>
                        </td>
                        <td>{r.totalPnl.toFixed(2)}</td>
                        <td>{formatSourceApr(r)}</td>
                        <td>{r.winrate.toFixed(1)}%</td>
                        <td>{r.wL}</td>
                        <td>{r.totalClosed}</td>
                        <td>{r.openSignals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ gridColumn: 'span 5' }}>
              <h3>{t('dashboard.topWinrate')}</h3>
              <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
                <table className="topSourcesTable">
                  <thead>
                    <tr>
                      <th className="sourceNameCell">{t('dashboard.sourceCol')}</th>
                      <th>Winrate</th>
                      <th>W / L</th>
                      <th>PnL</th>
                      <th>APR</th>
                      <th>{t('dashboard.closed')}</th>
                      <th>{t('dashboard.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.byWinrate.map((r) => (
                      <tr key={`wr-${r.source ?? '—'}`}>
                        <td className="sourceNameCell">
                          <span className="sourceNameText">{r.source ?? '—'}</span>
                        </td>
                        <td>{r.winrate.toFixed(1)}%</td>
                        <td>{r.wL}</td>
                        <td>{r.totalPnl.toFixed(2)}</td>
                        <td>{formatSourceApr(r)}</td>
                        <td>{r.totalClosed}</td>
                        <td>{r.openSignals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ gridColumn: 'span 5' }}>
              <h3>{t('dashboard.topWorstPnl')}</h3>
              <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
                <table className="topSourcesTable">
                  <thead>
                    <tr>
                      <th className="sourceNameCell">{t('dashboard.sourceCol')}</th>
                      <th>PnL</th>
                      <th>APR</th>
                      <th>Winrate</th>
                      <th>W / L</th>
                      <th>{t('dashboard.closed')}</th>
                      <th>{t('dashboard.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.byWorstPnl.map((r) => (
                      <tr key={`worst-pnl-${r.source ?? '—'}`}>
                        <td className="sourceNameCell">
                          <span className="sourceNameText">{r.source ?? '—'}</span>
                        </td>
                        <td>{r.totalPnl.toFixed(2)}</td>
                        <td>{formatSourceApr(r)}</td>
                        <td>{r.winrate.toFixed(1)}%</td>
                        <td>{r.wL}</td>
                        <td>{r.totalClosed}</td>
                        <td>{r.openSignals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ gridColumn: 'span 5' }}>
              <h3>{t('dashboard.topWorstWinrate')}</h3>
              <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
                <table className="topSourcesTable">
                  <thead>
                    <tr>
                      <th className="sourceNameCell">{t('dashboard.sourceCol')}</th>
                      <th>Winrate</th>
                      <th>W / L</th>
                      <th>PnL</th>
                      <th>APR</th>
                      <th>{t('dashboard.closed')}</th>
                      <th>{t('dashboard.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.byWorstWinrate.map((r) => (
                      <tr key={`worst-wr-${r.source ?? '—'}`}>
                        <td className="sourceNameCell">
                          <span className="sourceNameText">{r.source ?? '—'}</span>
                        </td>
                        <td>{r.winrate.toFixed(1)}%</td>
                        <td>{r.wL}</td>
                        <td>{r.totalPnl.toFixed(2)}</td>
                        <td>{formatSourceApr(r)}</td>
                        <td>{r.totalClosed}</td>
                        <td>{r.openSignals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
      {stats && (
        <div className="grid topSources" style={{ marginTop: '1rem' }}>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>
              {t('dashboard.liquidationsCount', {
                suffix: source ? ` — ${source}` : '',
                count: stats.liquidationTotal,
              })}
            </h3>
            <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
              <table className="topSourcesTable">
                <thead>
                  <tr>
                    <th className="sourceNameCell">{t('dashboard.sourceCol')}</th>
                    <th>{t('dashboard.liquidations')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.liquidationBySource.length === 0 ? (
                    <tr>
                      <td className="sourceNameCell">—</td>
                      <td>0</td>
                    </tr>
                  ) : (
                    stats.liquidationBySource.map((r) => (
                      <tr key={`liq-source-${r.source ?? '—'}`}>
                        <td className="sourceNameCell">
                          <span className="sourceNameText">{r.source ?? '—'}</span>
                        </td>
                        <td>{r.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>{t('dashboard.liquidationsByLeverage')}</h3>
              <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
                <table className="topSourcesTable">
                  <thead>
                    <tr>
                    <th>{t('dashboard.leverage')}</th>
                    <th>{t('dashboard.liquidations')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.liquidationByLeverage.length === 0 ? (
                    <tr>
                      <td>—</td>
                      <td>0</td>
                    </tr>
                  ) : (
                    stats.liquidationByLeverage.map((r) => (
                      <tr key={`liq-lev-${r.leverage ?? '—'}`}>
                        <td>{r.leverage != null ? `${r.leverage}x` : '—'}</td>
                        <td>{r.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <div className="dashboardActiveChartBlock">
        <h2 className="pageTitle dashboardActiveSubheading">
          {t('dashboard.pnlByDay')}{source ? ` — ${source}` : ''}
        </h2>
        <div className="chartWrap">
          <PnlChart data={pnl} />
        </div>
      </div>
      <StuckTradesBanner />
      <LiveExposurePanel />
      </section>
    </>
  );
}
