export type AuthenticatedRequestContext = {
  userId: string;
  email: string | null;
  workspaceId: string | null;
  role: string | null;
};
