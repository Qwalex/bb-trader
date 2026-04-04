import { cookies } from 'next/headers';

import { DASHBOARD_SESSION_COOKIE } from '@repo/shared';

import { readDashboardSessionFromToken } from './auth';

export async function readDashboardSession() {
  const store = await cookies();
  return readDashboardSessionFromToken(
    store.get(DASHBOARD_SESSION_COOKIE)?.value ?? null,
  );
}
