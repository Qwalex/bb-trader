import { formatError } from './format-error';

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1017']);
const TRANSIENT_DB_MESSAGES = [
  'server has closed the connection',
  "can't reach database server",
  'connection terminated unexpectedly',
  'connection reset by peer',
  'terminating connection due to administrator command',
  'the database system is shutting down',
  'too many clients already',
] as const;

export function isTransientPrismaConnectionError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string' && TRANSIENT_PRISMA_CODES.has(maybeCode)) {
      return true;
    }
  }

  const normalized = formatError(error).toLowerCase();
  return TRANSIENT_DB_MESSAGES.some((part) => normalized.includes(part));
}
