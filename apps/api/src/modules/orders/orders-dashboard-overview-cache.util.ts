import type { DashboardCabinetsOverviewDto } from './orders-dashboard-cabinets.types';

const TTL_MS = 20_000;

type CacheEntry = {
  expiresAt: number;
  value: DashboardCabinetsOverviewDto;
};

const cacheByUserId = new Map<string, CacheEntry>();

export function getCachedDashboardCabinetsOverview(
  userId: string,
): DashboardCabinetsOverviewDto | null {
  const id = String(userId ?? '').trim();
  if (!id) return null;
  const hit = cacheByUserId.get(id);
  if (!hit || Date.now() > hit.expiresAt) {
    if (hit) cacheByUserId.delete(id);
    return null;
  }
  return hit.value;
}

export function setCachedDashboardCabinetsOverview(
  userId: string,
  value: DashboardCabinetsOverviewDto,
): void {
  const id = String(userId ?? '').trim();
  if (!id) return;
  cacheByUserId.set(id, { expiresAt: Date.now() + TTL_MS, value });
}

export function invalidateDashboardCabinetsOverviewCache(userId?: string | null): void {
  const id = String(userId ?? '').trim();
  if (id) {
    cacheByUserId.delete(id);
    return;
  }
  cacheByUserId.clear();
}
