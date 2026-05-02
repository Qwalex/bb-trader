import { MAX_DRAFT_TURN_CHARS, MAX_DRAFT_USER_TURNS } from '../constants/telegram.constants';

export function normalizeDraftTurns(turns: string[]): string[] {
  const clipped = turns
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) =>
      v.length > MAX_DRAFT_TURN_CHARS
        ? `${v.slice(0, MAX_DRAFT_TURN_CHARS)}…`
        : v,
    );
  if (clipped.length <= MAX_DRAFT_USER_TURNS) {
    return clipped;
  }
  return clipped.slice(clipped.length - MAX_DRAFT_USER_TURNS);
}
