import { cookies } from 'next/headers';

import { SessionInfoBar } from '../components/SessionInfoBar';
import { fetchJson } from '../../lib/api';
import { searchParamFirst } from '../../lib/search-param.util';
import type {
  DashboardCabinetCard,
  DashboardCabinetsSummary,
} from '../home-dashboard.types';

import { LEVERAGE_CALCULATOR_PRESET_KEY } from './leverage-calculator-page.constants';

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
  const statsCabinetIdFromQuery = searchParamFirst(sp.statsCabinetId);
  const initialStatsCabinetId = statsCabinetIdFromQuery || cabinetId || '';

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

  const cabinetOptions = items.map((item) => ({ id: item.cabinetId, name: item.name }));

  let initialPresetJson: string | null = null;
  try {
    const eff = await fetchJson<{ settings?: { key: string; value: string }[] }>(
      '/settings/effective',
      undefined,
      cabinetId,
    );
    const row = eff.settings?.find((s) => s.key === LEVERAGE_CALCULATOR_PRESET_KEY);
    const raw = row?.value?.trim();
    initialPresetJson = raw && raw.length > 0 ? raw : null;
  } catch {
    initialPresetJson = null;
  }

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
      <LeverageCalculatorClient
        items={items}
        summary={summary}
        initialStatsCabinetId={initialStatsCabinetId}
        cabinetOptions={cabinetOptions}
        initialPresetJson={initialPresetJson}
        cabinetIdForApi={cabinetId}
      />
    </>
  );
}
