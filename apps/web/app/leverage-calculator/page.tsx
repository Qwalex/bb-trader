import { cookies } from 'next/headers';

import { SessionInfoBar } from '../components/SessionInfoBar';
import { fetchJson } from '../../lib/api';
import { searchParamFirst } from '../../lib/search-param.util';
import type {
  DashboardCabinetCard,
  DashboardCabinetsSummary,
} from '../home-dashboard.types';

import { LeverageCalculatorClient } from './LeverageCalculatorClient';

type AuthMe = {
  ok: boolean;
  userId?: string | null;
  login?: string | null;
};

type CabinetItem = { id: string; name: string; isDefault: boolean };

export default async function LeverageCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const cabinetIdFromCookie = cookieStore.get('cabinet_id')?.value?.trim() ?? '';
  const sp = await searchParams;
  const cabinetIdFromQuery = searchParamFirst(sp.cabinetId);
  const cabinetId = cabinetIdFromQuery || cabinetIdFromCookie;

  let authMe: AuthMe | null = null;
  let cabinetItems: CabinetItem[] = [];
  let summary: DashboardCabinetsSummary | null = null;
  let items: DashboardCabinetCard[] = [];
  let loadErr: string | null = null;

  try {
    authMe = await fetchJson<AuthMe>('/auth/me', undefined, cabinetId);
  } catch {
    authMe = null;
  }
  try {
    const cabinets = await fetchJson<{ items?: CabinetItem[] }>('/cabinets', undefined, cabinetId);
    cabinetItems = Array.isArray(cabinets.items) ? cabinets.items : [];
  } catch {
    cabinetItems = [];
  }
  const currentCabinet =
    (cabinetId ? cabinetItems.find((c) => c.id === cabinetId) : null) ??
    cabinetItems.find((c) => c.isDefault) ??
    cabinetItems[0] ??
    null;

  try {
    const dc = await fetchJson<{
      items?: DashboardCabinetCard[];
      summary?: DashboardCabinetsSummary;
    }>('/orders/dashboard-cabinets', undefined, cabinetId);
    items = Array.isArray(dc.items) ? dc.items : [];
    summary = dc.summary ?? null;
  } catch {
    items = [];
    summary = null;
    loadErr = 'Не удалось загрузить сводку по кабинетам (проверьте API и авторизацию).';
  }

  const payload = {
    equityUsd: summary?.totalEquityUsd ?? null,
    expectedPnlPerDayUsd: summary?.aggregateExpectedPnlPerDayUsd ?? null,
    realizedPnlPerDayUsd: summary?.aggregateRealizedPnlPerDayUsd ?? null,
    statsPeriodDaysMax: summary?.aggregateStatsPeriodDaysMax ?? null,
    totalPnlUsd: summary?.totalPnl ?? 0,
    cabinetCount: summary?.cabinetCount ?? items.length,
  };

  return (
    <>
      <SessionInfoBar
        login={authMe?.login ?? null}
        userId={authMe?.userId ?? null}
        cabinetName={currentCabinet?.name ?? null}
      />
      {loadErr && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {loadErr}
        </p>
      )}
      <LeverageCalculatorClient payload={payload} />
    </>
  );
}
