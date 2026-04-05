export type AppRole = 'admin' | 'user';

export type AuthenticatedRequestContext = {
  userId: string;
  email: string | null;
  workspaceId: string | null;
  role: string | null;
  appRole: AppRole;
};

export type AuthenticateRequestResult =
  | { ok: true; user: AuthenticatedRequestContext }
  | { ok: false; reason: 'unauthorized' };
